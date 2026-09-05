import { z } from "zod";

import { artifactReferenceDigest } from "@/lib/revenue-engine/artifact-reference-projection";
import {
  classifyPrivateKwOwnerAuthReservation,
  requireInProcessPrivateKwOwnerAuthOperationClaim,
  requireInProcessPrivateKwOwnerAuthReservationObservation,
  requireInProcessPrivateKwOwnerAuthReservationRecoveryDecision,
  type PrivateKwOwnerAuthReservationObservation,
  type PrivateKwOwnerAuthReservationRecoveryDecision,
} from "@/lib/revenue-engine/private-kw-owner-auth-idempotency-recovery";

/**
 * Source-only contracts for recovering a reservation that cannot be safely
 * reclaimed in place. These values describe a future additive D1 migration;
 * they do not write a receipt, delete a reservation, issue a replacement key,
 * or authorize the owner operation.
 */
export const PRIVATE_KW_OWNER_AUTH_RECOVERY_PROOF_VERSION =
  "kw-owner-auth-recovery-proof-v1";
export const PRIVATE_KW_OWNER_AUTH_RECOVERY_MIN_RETENTION_MS =
  365 * 24 * 60 * 60 * 1_000;
export const PRIVATE_KW_OWNER_AUTH_RECOVERY_MAX_RETENTION_MS =
  730 * 24 * 60 * 60 * 1_000;

const TimestampSchema = z.string().datetime({ offset: true }).refine(
  (value) => Number.isFinite(Date.parse(value)),
  "Recovery timestamps must resolve to a finite epoch.",
);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IdempotencyKeySchema = z.string().regex(
  /^kw-owner-mutation-idempotency:[a-f0-9]{64}$/,
);
const BoundaryIdSchema = z.string().regex(
  /^kw-owner-auth-server-boundary:[a-f0-9]{64}$/,
);
const OperationSchema = z.string().trim().regex(/^[a-z][a-z0-9._:-]{2,159}$/);
const OwnerSchema = z.enum(["RILEY", "AIDAN"]);

const RecoveryAuthoritySchema = z.object({
  validationOnly: z.literal(true),
  abandonmentReceiptCreationAuthorized: z.literal(false),
  reservationReclaimAuthorized: z.literal(false),
  reservationDeleteAuthorized: z.literal(false),
  replacementKeyIssuanceAuthorized: z.literal(false),
  operationMutationAuthorized: z.literal(false),
  databaseReadAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  routeAuthorized: z.literal(false),
  uiMutationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export type PrivateKwOwnerAuthRecoveryProofAuthority = z.infer<
  typeof RecoveryAuthoritySchema
>;

function authority(): PrivateKwOwnerAuthRecoveryProofAuthority {
  return RecoveryAuthoritySchema.parse({
    validationOnly: true,
    abandonmentReceiptCreationAuthorized: false,
    reservationReclaimAuthorized: false,
    reservationDeleteAuthorized: false,
    replacementKeyIssuanceAuthorized: false,
    operationMutationAuthorized: false,
    databaseReadAuthorized: false,
    databaseMutationAuthorized: false,
    routeAuthorized: false,
    uiMutationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

const RetentionPolicySchema = z.object({
  policyVersion: z.literal(PRIVATE_KW_OWNER_AUTH_RECOVERY_PROOF_VERSION),
  minimumRetentionMs: z.literal(PRIVATE_KW_OWNER_AUTH_RECOVERY_MIN_RETENTION_MS),
  maximumRetentionMs: z.literal(PRIVATE_KW_OWNER_AUTH_RECOVERY_MAX_RETENTION_MS),
  originalReservationPreserved: z.literal(true),
  recoveryReceiptAppendOnly: z.literal(true),
  originalReservationDeleteAuthorized: z.literal(false),
  recoveryReceiptDeleteAuthorized: z.literal(false),
  sameKeyReuseAllowed: z.literal(false),
  replacementKeyRequiredForRetry: z.literal(true),
  deletionRequiresSeparateOwnerRelease: z.literal(true),
  authority: RecoveryAuthoritySchema,
}).strict();

export type PrivateKwOwnerAuthRecoveryRetentionPolicy = z.infer<
  typeof RetentionPolicySchema
>;

export function buildPrivateKwOwnerAuthRecoveryRetentionPolicy():
  PrivateKwOwnerAuthRecoveryRetentionPolicy {
  const policy = deepFreeze(RetentionPolicySchema.parse({
    policyVersion: PRIVATE_KW_OWNER_AUTH_RECOVERY_PROOF_VERSION,
    minimumRetentionMs: PRIVATE_KW_OWNER_AUTH_RECOVERY_MIN_RETENTION_MS,
    maximumRetentionMs: PRIVATE_KW_OWNER_AUTH_RECOVERY_MAX_RETENTION_MS,
    originalReservationPreserved: true,
    recoveryReceiptAppendOnly: true,
    originalReservationDeleteAuthorized: false,
    recoveryReceiptDeleteAuthorized: false,
    sameKeyReuseAllowed: false,
    replacementKeyRequiredForRetry: true,
    deletionRequiresSeparateOwnerRelease: true,
    authority: authority(),
  }));
  trustedRetentionPolicies.add(policy);
  return policy;
}

const trustedRetentionPolicies = new WeakSet<object>();
const trustedRecoveryReceipts = new WeakSet<object>();
const trustedMutationProofs = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

const retentionPolicy = buildPrivateKwOwnerAuthRecoveryRetentionPolicy();

export function requireInProcessPrivateKwOwnerAuthRecoveryRetentionPolicy(
  value: unknown,
): PrivateKwOwnerAuthRecoveryRetentionPolicy {
  RetentionPolicySchema.parse(value);
  if (!value || typeof value !== "object" || !trustedRetentionPolicies.has(value)) {
    throw new Error("An exact in-process owner-auth recovery retention policy is required.");
  }
  return value as PrivateKwOwnerAuthRecoveryRetentionPolicy;
}

const RecoveryReasonSchema = z.enum([
  "UNKNOWN_WRITER",
  "PARTIAL_BATCH",
  "SESSION_EXPIRED",
  "OPERATION_TIMEOUT",
  "MANUAL_STOP",
]);

const RecoveryReceiptCoreSchema = z.object({
  receiptVersion: z.literal(PRIVATE_KW_OWNER_AUTH_RECOVERY_PROOF_VERSION),
  receiptKind: z.literal("OWNER_AUTH_RESERVATION_ABANDONMENT"),
  assurance: z.literal("RECOVERY_CANDIDATE_ONLY"),
  durableExecutionProven: z.literal(false),
  recoveryState: z.literal("ABANDONED"),
  reservationState: z.literal("RESERVED"),
  idempotencyKey: IdempotencyKeySchema,
  boundaryId: BoundaryIdSchema,
  boundaryDigest: Sha256Schema,
  owner: OwnerSchema,
  operation: OperationSchema,
  payloadDigest: Sha256Schema,
  observationDigest: Sha256Schema,
  decisionDigest: Sha256Schema,
  recoveryAction: z.enum([
    "BLOCK_VISIBLE_RESERVED",
    "BLOCK_STALE_RESERVED",
    "BLOCK_EXPIRED_SESSION_RESERVED",
  ]),
  abandonmentReason: RecoveryReasonSchema,
  reservedAt: TimestampSchema,
  observedDatabaseNow: TimestampSchema,
  recordedAt: TimestampSchema,
  replacementKey: z.null(),
  sameKeyReuseAllowed: z.literal(false),
  replacementKeyIssuanceAuthorized: z.literal(false),
  reservationMutationAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  retention: RetentionPolicySchema,
  authority: RecoveryAuthoritySchema,
}).strict();

export const PrivateKwOwnerAuthAbandonmentReceiptSchema =
  RecoveryReceiptCoreSchema.extend({
    receiptId: z.string().regex(/^kw-owner-auth-recovery:[a-f0-9]{64}$/),
    receiptDigest: Sha256Schema,
  }).strict().superRefine((receipt, context) => {
    const { receiptId: _receiptId, receiptDigest: _receiptDigest, ...core } = receipt;
    void _receiptId;
    void _receiptDigest;
    const expectedDigest = artifactReferenceDigest(core);
    if (
      receipt.receiptDigest !== expectedDigest
      || receipt.receiptId !== `kw-owner-auth-recovery:${expectedDigest}`
    ) {
      context.addIssue({
        code: "custom",
        message: "Owner-auth abandonment receipt identity must bind its exact content.",
        path: ["receiptDigest"],
      });
    }
    if (Date.parse(receipt.recordedAt) < Date.parse(receipt.observedDatabaseNow)) {
      context.addIssue({
        code: "custom",
        message: "An abandonment receipt cannot be recorded before its database observation.",
        path: ["recordedAt"],
      });
    }
  });

export type PrivateKwOwnerAuthAbandonmentReceipt = z.infer<
  typeof PrivateKwOwnerAuthAbandonmentReceiptSchema
>;

function assertObservationDecisionPair(
  observation: PrivateKwOwnerAuthReservationObservation,
  decision: PrivateKwOwnerAuthReservationRecoveryDecision,
) {
  if (
    artifactReferenceDigest(classifyPrivateKwOwnerAuthReservation(observation)) !== artifactReferenceDigest(decision)
    ||
    observation.idempotencyKey !== decision.idempotencyKey
    || observation.boundaryDigest !== decision.boundaryDigest
    || observation.owner !== decision.owner
    || observation.operation !== decision.operation
    || observation.payloadDigest !== decision.payloadDigest
    || observation.state !== decision.state
  ) {
    throw new Error("The recovery receipt requires an observation and decision for the exact same reservation.");
  }
  if (
    observation.state !== "RESERVED"
    || decision.action === "REPLAY_EXACT_RESULT"
    || !decision.recoveryReceiptRequired
  ) {
    throw new Error("Only a blocked RESERVED reservation can receive an abandonment receipt.");
  }
}

export function buildPrivateKwOwnerAuthAbandonmentReceipt(input: {
  observationValue: unknown;
  decisionValue: unknown;
  abandonmentReason: z.infer<typeof RecoveryReasonSchema>;
  recordedAt: string;
}): PrivateKwOwnerAuthAbandonmentReceipt {
  const observation = requireInProcessPrivateKwOwnerAuthReservationObservation(input.observationValue);
  const decision = requireInProcessPrivateKwOwnerAuthReservationRecoveryDecision(input.decisionValue);
  assertObservationDecisionPair(observation, decision);
  const retention = requireInProcessPrivateKwOwnerAuthRecoveryRetentionPolicy(retentionPolicy);
  const core = RecoveryReceiptCoreSchema.parse({
    receiptVersion: PRIVATE_KW_OWNER_AUTH_RECOVERY_PROOF_VERSION,
    receiptKind: "OWNER_AUTH_RESERVATION_ABANDONMENT",
    assurance: "RECOVERY_CANDIDATE_ONLY",
    durableExecutionProven: false,
    recoveryState: "ABANDONED",
    reservationState: "RESERVED",
    idempotencyKey: observation.idempotencyKey,
    boundaryId: observation.boundaryId,
    boundaryDigest: observation.boundaryDigest,
    owner: observation.owner,
    operation: observation.operation,
    payloadDigest: observation.payloadDigest,
    observationDigest: artifactReferenceDigest(observation),
    decisionDigest: decision.decisionDigest,
    recoveryAction: decision.action,
    abandonmentReason: input.abandonmentReason,
    reservedAt: observation.reservedAt,
    observedDatabaseNow: observation.databaseNow,
    recordedAt: input.recordedAt,
    replacementKey: null,
    sameKeyReuseAllowed: false,
    replacementKeyIssuanceAuthorized: false,
    reservationMutationAuthorized: false,
    deletionAuthorized: false,
    retention,
    authority: authority(),
  });
  const digest = artifactReferenceDigest(core);
  const receipt = deepFreeze(PrivateKwOwnerAuthAbandonmentReceiptSchema.parse({
    ...core,
    receiptId: `kw-owner-auth-recovery:${digest}`,
    receiptDigest: digest,
  }));
  trustedRecoveryReceipts.add(receipt);
  return receipt;
}

export function requireInProcessPrivateKwOwnerAuthAbandonmentReceipt(
  value: unknown,
): PrivateKwOwnerAuthAbandonmentReceipt {
  PrivateKwOwnerAuthAbandonmentReceiptSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedRecoveryReceipts.has(value)) {
    throw new Error("An exact in-process owner-auth abandonment receipt is required.");
  }
  return value as PrivateKwOwnerAuthAbandonmentReceipt;
}

const MutationExecutionPathSchema = z.enum(["FRESH_COMMIT", "EXACT_REPLAY", "ROLLBACK"]);
const MutationFailureReasonSchema = z.enum([
  "PROCESS_LOSS",
  "CLAIM_NOT_MATCHED",
  "INTEGRITY_FAILURE",
  "OWNER_STOP",
]);

const MutationProofCoreSchema = z.object({
  proofVersion: z.literal(PRIVATE_KW_OWNER_AUTH_RECOVERY_PROOF_VERSION),
  proofKind: z.literal("OWNER_AUTH_MUTATION_AFFECTED_ROW_PROOF"),
  assurance: z.literal("CALLER_COUNTS_VALIDATED_ONLY"),
  durableExecutionProven: z.literal(false),
  claimDigest: Sha256Schema,
  rowCountScope: z.literal("EXACT_IDEMPOTENCY_KEY"),
  idempotencyKey: IdempotencyKeySchema,
  boundaryId: BoundaryIdSchema,
  operation: OperationSchema,
  executionPath: MutationExecutionPathSchema,
  claimMatched: z.boolean(),
  expectedOperationRows: z.literal(1),
  operationRowsAffected: z.number().int().min(0).max(1),
  idempotencyRowsInserted: z.number().int().min(0).max(1),
  idempotencyRowsAfter: z.number().int().min(0).max(1),
  outboxRowsInserted: z.number().int().min(0).max(1),
  outboxRowsAfter: z.number().int().min(0).max(1),
  ownerMutationRowsChanged: z.number().int().min(0).max(1),
  unrelatedRowsChanged: z.literal(0),
  transactionState: z.enum(["COMMITTED", "ROLLED_BACK"]),
  rollbackWholeBatch: z.literal(true),
  failureReason: MutationFailureReasonSchema.nullable(),
  authority: RecoveryAuthoritySchema,
}).strict().superRefine((proof, context) => {
  const fresh = proof.executionPath === "FRESH_COMMIT";
  const replay = proof.executionPath === "EXACT_REPLAY";
  const rollback = proof.executionPath === "ROLLBACK";
  if (fresh && (
    !proof.claimMatched
    || proof.transactionState !== "COMMITTED"
    || proof.operationRowsAffected !== 1
    || proof.idempotencyRowsInserted !== 1
    || proof.idempotencyRowsAfter !== 1
    || proof.outboxRowsInserted !== 1
    || proof.outboxRowsAfter !== 1
    || proof.ownerMutationRowsChanged !== 1
    || proof.failureReason !== null
  )) {
    context.addIssue({ code: "custom", message: "A fresh owner mutation must affect exactly one operation row and add one ledger/outbox row in one committed batch.", path: ["operationRowsAffected"] });
  }
  if (replay && (
    proof.claimMatched
    || proof.transactionState !== "COMMITTED"
    || proof.operationRowsAffected !== 0
    || proof.idempotencyRowsInserted !== 0
    || proof.idempotencyRowsAfter !== 1
    || proof.outboxRowsInserted !== 0
    || proof.outboxRowsAfter !== 1
    || proof.ownerMutationRowsChanged !== 0
    || proof.failureReason !== null
  )) {
    context.addIssue({ code: "custom", message: "An exact replay must perform no owner mutation and add no duplicate ledger or outbox row.", path: ["operationRowsAffected"] });
  }
  if (rollback && (
    proof.transactionState !== "ROLLED_BACK"
    || proof.operationRowsAffected !== 0
    || proof.idempotencyRowsInserted !== 0
    || proof.idempotencyRowsAfter !== 0
    || proof.outboxRowsInserted !== 0
    || proof.outboxRowsAfter !== 0
    || proof.ownerMutationRowsChanged !== 0
    || proof.failureReason === null
  )) {
    context.addIssue({ code: "custom", message: "A rolled-back owner mutation must leave zero rows and identify the failure reason.", path: ["transactionState"] });
  }
});

export const PrivateKwOwnerAuthMutationAffectedRowProofSchema =
  MutationProofCoreSchema.extend({
    proofId: z.string().regex(/^kw-owner-auth-mutation-proof:[a-f0-9]{64}$/),
    proofDigest: Sha256Schema,
  }).strict().superRefine((proof, context) => {
    const { proofId: _proofId, proofDigest: _proofDigest, ...core } = proof;
    void _proofId;
    void _proofDigest;
    const expectedDigest = artifactReferenceDigest(core);
    if (
      proof.proofDigest !== expectedDigest
      || proof.proofId !== `kw-owner-auth-mutation-proof:${expectedDigest}`
    ) {
      context.addIssue({
        code: "custom",
        message: "Affected-row proof identity must bind its exact claim and transaction counts.",
        path: ["proofDigest"],
      });
    }
  });

export type PrivateKwOwnerAuthMutationAffectedRowProof = z.infer<
  typeof PrivateKwOwnerAuthMutationAffectedRowProofSchema
>;

export function buildPrivateKwOwnerAuthMutationAffectedRowProof(input: {
  claimValue: unknown;
  executionPath: z.infer<typeof MutationExecutionPathSchema>;
  claimMatched: boolean;
  operationRowsAffected: number;
  idempotencyRowsInserted: number;
  idempotencyRowsAfter: number;
  outboxRowsInserted: number;
  outboxRowsAfter: number;
  ownerMutationRowsChanged: number;
  unrelatedRowsChanged: number;
  transactionState: "COMMITTED" | "ROLLED_BACK";
  failureReason: z.infer<typeof MutationFailureReasonSchema> | null;
}): PrivateKwOwnerAuthMutationAffectedRowProof {
  const claim = requireInProcessPrivateKwOwnerAuthOperationClaim(input.claimValue);
  const core = MutationProofCoreSchema.parse({
    proofVersion: PRIVATE_KW_OWNER_AUTH_RECOVERY_PROOF_VERSION,
    proofKind: "OWNER_AUTH_MUTATION_AFFECTED_ROW_PROOF",
    assurance: "CALLER_COUNTS_VALIDATED_ONLY",
    durableExecutionProven: false,
    claimDigest: claim.claimDigest,
    rowCountScope: "EXACT_IDEMPOTENCY_KEY",
    idempotencyKey: claim.idempotencyKey,
    boundaryId: claim.boundaryId,
    operation: claim.operation,
    executionPath: input.executionPath,
    claimMatched: input.claimMatched,
    expectedOperationRows: 1,
    operationRowsAffected: input.operationRowsAffected,
    idempotencyRowsInserted: input.idempotencyRowsInserted,
    idempotencyRowsAfter: input.idempotencyRowsAfter,
    outboxRowsInserted: input.outboxRowsInserted,
    outboxRowsAfter: input.outboxRowsAfter,
    ownerMutationRowsChanged: input.ownerMutationRowsChanged,
    unrelatedRowsChanged: input.unrelatedRowsChanged,
    transactionState: input.transactionState,
    rollbackWholeBatch: true,
    failureReason: input.failureReason,
    authority: authority(),
  });
  const digest = artifactReferenceDigest(core);
  const proof = deepFreeze(PrivateKwOwnerAuthMutationAffectedRowProofSchema.parse({
    ...core,
    proofId: `kw-owner-auth-mutation-proof:${digest}`,
    proofDigest: digest,
  }));
  trustedMutationProofs.add(proof);
  return proof;
}

export function requireInProcessPrivateKwOwnerAuthMutationAffectedRowProof(
  value: unknown,
): PrivateKwOwnerAuthMutationAffectedRowProof {
  PrivateKwOwnerAuthMutationAffectedRowProofSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedMutationProofs.has(value)) {
    throw new Error("An exact in-process owner-auth affected-row proof is required.");
  }
  return value as PrivateKwOwnerAuthMutationAffectedRowProof;
}
