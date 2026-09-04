import { z } from "zod";

import { artifactReferenceDigest } from "@/lib/revenue-engine/artifact-reference-projection";
import {
  requireInProcessPrivateKwOwnerAuthServerBoundary,
  type PrivateKwOwnerAuthServerBoundary,
} from "@/lib/revenue-engine/private-kw-owner-auth-server-boundary";

/**
 * This module is a validation-only design boundary. It describes how a
 * future D1 adapter must treat a visible reservation and how an
 * operation-specific SQL mutation proves it owns that reservation. It has no
 * database binding, SQL executor, route, provider, or operator entry point.
 */
export const PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_RECOVERY_VERSION =
  "kw-owner-auth-idempotency-recovery-v1";
export const PRIVATE_KW_OWNER_AUTH_RESERVATION_EXPECTED_MAX_AGE_MS = 120_000;

/**
 * This predicate is deliberately content-addressed and parameterized. A
 * future operation statement must embed the `EXISTS` form below, while the
 * idempotency finalization statement may use this inner form directly.
 */
export const PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_PREDICATE =
  `"id" = ? AND "state" = 'RESERVED' AND "boundaryDigest" = ? AND "owner" = ? AND "operation" = ? AND "payloadDigest" = ?`;
export const PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE =
  `EXISTS (SELECT 1 FROM "RevenuePrivateKwOwnerAuthIdempotency" WHERE ${PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_PREDICATE})`;

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IdempotencyKeySchema = z.string().regex(
  /^kw-owner-mutation-idempotency:[a-f0-9]{64}$/,
);
const BoundaryIdSchema = z.string().regex(
  /^kw-owner-auth-server-boundary:[a-f0-9]{64}$/,
);
const RecordIdSchema = z.string().regex(
  /^kw-owner-auth-idempotency:[a-f0-9]{64}$/,
);
const OperationSchema = z.string().trim().regex(/^[a-z][a-z0-9._:-]{2,159}$/);
const OwnerSchema = z.enum(["RILEY", "AIDAN"]);

const AuthoritySchema = z.object({
  validationOnly: z.literal(true),
  visibleReservationRecoveryAuthorized: z.literal(false),
  reservationReclaimAuthorized: z.literal(false),
  operationMutationAuthorized: z.literal(false),
  ownerDecisionPersistenceAuthorized: z.literal(false),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
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

export type PrivateKwOwnerAuthRecoveryAuthority = z.infer<
  typeof AuthoritySchema
>;

function authority(): PrivateKwOwnerAuthRecoveryAuthority {
  return AuthoritySchema.parse({
    validationOnly: true,
    visibleReservationRecoveryAuthorized: false,
    reservationReclaimAuthorized: false,
    operationMutationAuthorized: false,
    ownerDecisionPersistenceAuthorized: false,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
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

const RecoveryPolicySchema = z.object({
  policyVersion: z.literal(PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_RECOVERY_VERSION),
  reservationState: z.literal("RESERVED"),
  committedState: z.literal("COMMITTED"),
  expectedMaxReservationAgeMs: z.literal(
    PRIVATE_KW_OWNER_AUTH_RESERVATION_EXPECTED_MAX_AGE_MS,
  ),
  visibleReservationAction: z.literal("BLOCK_AND_ESCALATE"),
  staleReservationAction: z.literal("BLOCK_AND_ESCALATE"),
  expiredSessionReservationAction: z.literal("BLOCK_AND_ESCALATE"),
  committedRetryAction: z.literal("REPLAY_EXACT_RESULT"),
  sameKeyRetryAfterReservation: z.literal("FAIL_CLOSED_UNTIL_NEW_KEY"),
  reservationMayBeFinalizedByRecovery: z.literal(false),
  reservationMayBeDeletedByRecovery: z.literal(false),
  reservationMayBeReusedByRecovery: z.literal(false),
  recoveryTransition: z.literal("SEPARATE_ADDITIVE_MIGRATION_REQUIRED"),
  recoveryReceiptRequired: z.literal(true),
  authority: AuthoritySchema,
}).strict();

export type PrivateKwOwnerAuthIdempotencyRecoveryPolicy = z.infer<
  typeof RecoveryPolicySchema
>;

const ReservationObservationSchema = z.object({
  observationVersion: z.literal(PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_RECOVERY_VERSION),
  idempotencyKey: IdempotencyKeySchema,
  boundaryId: BoundaryIdSchema,
  boundaryDigest: Sha256Schema,
  owner: OwnerSchema,
  operation: OperationSchema,
  payloadDigest: Sha256Schema,
  recordId: RecordIdSchema.nullable(),
  state: z.enum(["RESERVED", "COMMITTED"]),
  reservedAt: TimestampSchema,
  databaseNow: TimestampSchema,
  sessionCreatedAt: TimestampSchema,
  sessionExpiresAt: TimestampSchema,
  resultAvailable: z.boolean(),
  authority: AuthoritySchema,
}).strict().superRefine((observation, context) => {
  const reservedAt = Date.parse(observation.reservedAt);
  const databaseNow = Date.parse(observation.databaseNow);
  const sessionCreatedAt = Date.parse(observation.sessionCreatedAt);
  const sessionExpiresAt = Date.parse(observation.sessionExpiresAt);
  if (databaseNow < reservedAt) {
    context.addIssue({
      code: "custom",
      message: "Reservation recovery cannot trust a database clock before reservation time.",
      path: ["databaseNow"],
    });
  }
  if (sessionExpiresAt <= sessionCreatedAt) {
    context.addIssue({
      code: "custom",
      message: "Reservation recovery requires a forward-moving owner session window.",
      path: ["sessionExpiresAt"],
    });
  }
  if (reservedAt < sessionCreatedAt || reservedAt >= sessionExpiresAt) {
    context.addIssue({
      code: "custom",
      message: "Reservation time must remain inside the owner session window.",
      path: ["reservedAt"],
    });
  }
  if (observation.state === "RESERVED") {
    if (observation.recordId !== null || observation.resultAvailable) {
      context.addIssue({
        code: "custom",
        message: "A RESERVED observation cannot carry a committed result.",
        path: ["recordId"],
      });
    }
  } else if (observation.recordId === null || !observation.resultAvailable) {
    context.addIssue({
      code: "custom",
      message: "A COMMITTED observation must carry an exact stored result.",
      path: ["recordId"],
    });
  }
});

export type PrivateKwOwnerAuthReservationObservation = z.infer<
  typeof ReservationObservationSchema
>;

const RecoveryDecisionSchema = z.object({
  decisionVersion: z.literal(PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_RECOVERY_VERSION),
  decisionDigest: Sha256Schema,
  idempotencyKey: IdempotencyKeySchema,
  boundaryDigest: Sha256Schema,
  owner: OwnerSchema,
  operation: OperationSchema,
  payloadDigest: Sha256Schema,
  state: z.enum(["RESERVED", "COMMITTED"]),
  action: z.enum([
    "REPLAY_EXACT_RESULT",
    "BLOCK_VISIBLE_RESERVED",
    "BLOCK_STALE_RESERVED",
    "BLOCK_EXPIRED_SESSION_RESERVED",
  ]),
  reservationAgeMs: z.number().int().nonnegative().max(2_592_000_000),
  sameKeyRetryAllowed: z.boolean(),
  operationMutationAllowed: z.literal(false),
  reservationRecoveryMutationAllowed: z.literal(false),
  recoveryReceiptRequired: z.boolean(),
  authority: AuthoritySchema,
}).strict().superRefine((decision, context) => {
  const committed = decision.state === "COMMITTED";
  if (committed && decision.action !== "REPLAY_EXACT_RESULT") {
    context.addIssue({
      code: "custom",
      message: "Only COMMITTED rows may produce an exact replay decision.",
      path: ["action"],
    });
  }
  if (committed !== decision.sameKeyRetryAllowed) {
    context.addIssue({
      code: "custom",
      message: "Only a COMMITTED row may allow a same-key replay.",
      path: ["sameKeyRetryAllowed"],
    });
  }
  if (decision.operationMutationAllowed || decision.reservationRecoveryMutationAllowed) {
    context.addIssue({
      code: "custom",
      message: "Recovery decisions never authorize a mutation.",
      path: ["operationMutationAllowed"],
    });
  }
});

export type PrivateKwOwnerAuthReservationRecoveryDecision = z.infer<
  typeof RecoveryDecisionSchema
>;

const ClaimCoreSchema = z.object({
  claimVersion: z.literal(PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_RECOVERY_VERSION),
  statementId: z.literal("mutation:owner_auth_operation"),
  mutationKind: z.enum(["INSERT", "UPDATE", "DELETE"]),
  targetTable: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/),
  idempotencyKey: IdempotencyKeySchema,
  boundaryId: BoundaryIdSchema,
  boundaryDigest: Sha256Schema,
  owner: OwnerSchema,
  operation: OperationSchema,
  payloadDigest: Sha256Schema,
  claimPredicate: z.literal(PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE),
  claimBindings: z.tuple([
    IdempotencyKeySchema,
    Sha256Schema,
    OwnerSchema,
    OperationSchema,
    Sha256Schema,
  ]),
  sql: z.string().trim().min(1).max(16_000),
  claimEmbedded: z.literal(true),
  singleStatement: z.literal(true),
  mustShareD1Batch: z.literal(true),
  executableByThisContract: z.literal(false),
  authority: AuthoritySchema,
}).strict().superRefine((claim, context) => {
  const normalizedSql = claim.sql.replace(/\s+/g, " ").trim();
  if (!new RegExp(`^${claim.mutationKind}\\b`, "i").test(normalizedSql)) {
    context.addIssue({
      code: "custom",
      message: "The operation claim must begin with its declared single DML kind.",
      path: ["sql"],
    });
  }
  if (
    normalizedSql.includes(";")
    || /--|\/\*|\*\//.test(claim.sql)
    || /\b(?:CREATE|ALTER|DROP|TRUNCATE|PRAGMA|ATTACH|DETACH|VACUUM)\b/i.test(normalizedSql)
    || /\bRETURNING\b/i.test(normalizedSql)
  ) {
    context.addIssue({
      code: "custom",
      message: "The operation claim must be one parameterized DML statement without DDL, comments, or RETURNING.",
      path: ["sql"],
    });
  }
  const normalizedClaim = PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedSql.includes(normalizedClaim)) {
    context.addIssue({
      code: "custom",
      message: "The operation claim must embed the exact reservation predicate.",
      path: ["sql"],
    });
  }
  if (!normalizedSql.includes(`"${claim.targetTable}"`)) {
    context.addIssue({
      code: "custom",
      message: "The operation claim target table must match its declaration.",
      path: ["targetTable"],
    });
  }
  if (
    claim.targetTable === "RevenuePrivateKwOwnerAuthIdempotency"
    || claim.targetTable === "RevenuePrivateKwOwnerAuthMutationOutbox"
  ) {
    context.addIssue({
      code: "custom",
      message: "The operation claim cannot mutate the idempotency ledger or outbox.",
      path: ["targetTable"],
    });
  }
  if ((claim.sql.match(/\?/g) ?? []).length < claim.claimBindings.length) {
    context.addIssue({
      code: "custom",
      message: "The operation claim must remain parameterized for every reservation binding.",
      path: ["sql"],
    });
  }
  const [idempotencyKey, boundaryDigest, owner, operation, payloadDigest] = claim.claimBindings;
  if (
    idempotencyKey !== claim.idempotencyKey
    || boundaryDigest !== claim.boundaryDigest
    || owner !== claim.owner
    || operation !== claim.operation
    || payloadDigest !== claim.payloadDigest
  ) {
    context.addIssue({
      code: "custom",
      message: "Operation claim bindings must mirror the exact owner-auth intent.",
      path: ["claimBindings"],
    });
  }
  for (const forbiddenLiteral of [
    claim.idempotencyKey,
    claim.boundaryId,
    claim.boundaryDigest,
    claim.operation,
    claim.payloadDigest,
  ]) {
    if (claim.sql.includes(forbiddenLiteral)) {
      context.addIssue({
        code: "custom",
        message: "Operation claim identity values must remain SQL bindings, not interpolated literals.",
        path: ["sql"],
      });
      break;
    }
  }
});

export type PrivateKwOwnerAuthOperationClaim = z.infer<typeof ClaimCoreSchema> & {
  claimDigest: string;
};

const OperationClaimSchema = ClaimCoreSchema.extend({
  claimDigest: Sha256Schema,
}).strict();

const trustedObservations = new WeakSet<object>();
const trustedDecisions = new WeakSet<object>();
const trustedPolicies = new WeakSet<object>();
const trustedClaims = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function exactBoundary(value: unknown): PrivateKwOwnerAuthServerBoundary {
  return requireInProcessPrivateKwOwnerAuthServerBoundary(value);
}

export function buildPrivateKwOwnerAuthIdempotencyRecoveryPolicy():
  PrivateKwOwnerAuthIdempotencyRecoveryPolicy {
  const policy = deepFreeze(RecoveryPolicySchema.parse({
    policyVersion: PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_RECOVERY_VERSION,
    reservationState: "RESERVED",
    committedState: "COMMITTED",
    expectedMaxReservationAgeMs: PRIVATE_KW_OWNER_AUTH_RESERVATION_EXPECTED_MAX_AGE_MS,
    visibleReservationAction: "BLOCK_AND_ESCALATE",
    staleReservationAction: "BLOCK_AND_ESCALATE",
    expiredSessionReservationAction: "BLOCK_AND_ESCALATE",
    committedRetryAction: "REPLAY_EXACT_RESULT",
    sameKeyRetryAfterReservation: "FAIL_CLOSED_UNTIL_NEW_KEY",
    reservationMayBeFinalizedByRecovery: false,
    reservationMayBeDeletedByRecovery: false,
    reservationMayBeReusedByRecovery: false,
    recoveryTransition: "SEPARATE_ADDITIVE_MIGRATION_REQUIRED",
    recoveryReceiptRequired: true,
    authority: authority(),
  }));
  trustedPolicies.add(policy);
  return policy;
}

export function requireInProcessPrivateKwOwnerAuthIdempotencyRecoveryPolicy(
  value: unknown,
): PrivateKwOwnerAuthIdempotencyRecoveryPolicy {
  RecoveryPolicySchema.parse(value);
  if (!value || typeof value !== "object" || !trustedPolicies.has(value)) {
    throw new Error("An exact in-process owner-auth recovery policy is required.");
  }
  return value as PrivateKwOwnerAuthIdempotencyRecoveryPolicy;
}

export function buildPrivateKwOwnerAuthReservationObservation(input: {
  boundaryValue: unknown;
  state: "RESERVED" | "COMMITTED";
  reservedAt: string;
  databaseNow: string;
  recordId: string | null;
  resultAvailable: boolean;
}): PrivateKwOwnerAuthReservationObservation {
  const boundary = exactBoundary(input.boundaryValue);
  const observation = deepFreeze(ReservationObservationSchema.parse({
    observationVersion: PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_RECOVERY_VERSION,
    idempotencyKey: boundary.idempotencyKey,
    boundaryId: boundary.boundaryId,
    boundaryDigest: boundary.boundaryDigest,
    owner: boundary.owner,
    operation: boundary.operation,
    payloadDigest: boundary.payloadDigest,
    recordId: input.recordId,
    state: input.state,
    reservedAt: input.reservedAt,
    databaseNow: input.databaseNow,
    sessionCreatedAt: boundary.sessionCreatedAt,
    sessionExpiresAt: boundary.sessionExpiresAt,
    resultAvailable: input.resultAvailable,
    authority: authority(),
  }));
  trustedObservations.add(observation);
  return observation;
}

export function requireInProcessPrivateKwOwnerAuthReservationObservation(
  value: unknown,
): PrivateKwOwnerAuthReservationObservation {
  ReservationObservationSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedObservations.has(value)) {
    throw new Error("An exact in-process owner-auth reservation observation is required.");
  }
  return value as PrivateKwOwnerAuthReservationObservation;
}

export function classifyPrivateKwOwnerAuthReservation(
  value: unknown,
): PrivateKwOwnerAuthReservationRecoveryDecision {
  const observation = requireInProcessPrivateKwOwnerAuthReservationObservation(value);
  const reservationAgeMs = Date.parse(observation.databaseNow) - Date.parse(observation.reservedAt);
  const sessionExpired = Date.parse(observation.databaseNow) >= Date.parse(observation.sessionExpiresAt);
  const stale = reservationAgeMs >= PRIVATE_KW_OWNER_AUTH_RESERVATION_EXPECTED_MAX_AGE_MS;
  const action = observation.state === "COMMITTED"
    ? "REPLAY_EXACT_RESULT"
    : sessionExpired
      ? "BLOCK_EXPIRED_SESSION_RESERVED"
      : stale
        ? "BLOCK_STALE_RESERVED"
        : "BLOCK_VISIBLE_RESERVED";
  const core = {
    decisionVersion: PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_RECOVERY_VERSION,
    idempotencyKey: observation.idempotencyKey,
    boundaryDigest: observation.boundaryDigest,
    owner: observation.owner,
    operation: observation.operation,
    payloadDigest: observation.payloadDigest,
    state: observation.state,
    action,
    reservationAgeMs,
    sameKeyRetryAllowed: observation.state === "COMMITTED",
    operationMutationAllowed: false as const,
    reservationRecoveryMutationAllowed: false as const,
    recoveryReceiptRequired: observation.state === "RESERVED",
    authority: authority(),
  };
  const decision = deepFreeze(RecoveryDecisionSchema.parse({
    ...core,
    decisionDigest: artifactReferenceDigest(core),
  }));
  trustedDecisions.add(decision);
  return decision;
}

export function requireInProcessPrivateKwOwnerAuthReservationRecoveryDecision(
  value: unknown,
): PrivateKwOwnerAuthReservationRecoveryDecision {
  RecoveryDecisionSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedDecisions.has(value)) {
    throw new Error("An exact in-process owner-auth recovery decision is required.");
  }
  return value as PrivateKwOwnerAuthReservationRecoveryDecision;
}

export function buildPrivateKwOwnerAuthOperationClaim(input: {
  boundaryValue: unknown;
  mutationKind: "INSERT" | "UPDATE" | "DELETE";
  targetTable: string;
  sql: string;
}): PrivateKwOwnerAuthOperationClaim {
  const boundary = exactBoundary(input.boundaryValue);
  const core = ClaimCoreSchema.parse({
    claimVersion: PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_RECOVERY_VERSION,
    statementId: "mutation:owner_auth_operation",
    mutationKind: input.mutationKind,
    targetTable: input.targetTable,
    idempotencyKey: boundary.idempotencyKey,
    boundaryId: boundary.boundaryId,
    boundaryDigest: boundary.boundaryDigest,
    owner: boundary.owner,
    operation: boundary.operation,
    payloadDigest: boundary.payloadDigest,
    claimPredicate: PRIVATE_KW_OWNER_AUTH_MUTATION_CLAIM_EXISTS_PREDICATE,
    claimBindings: [
      boundary.idempotencyKey,
      boundary.boundaryDigest,
      boundary.owner,
      boundary.operation,
      boundary.payloadDigest,
    ],
    sql: input.sql,
    claimEmbedded: true,
    singleStatement: true,
    mustShareD1Batch: true,
    executableByThisContract: false,
    authority: authority(),
  });
  const claim = deepFreeze({
    ...core,
    claimDigest: artifactReferenceDigest(core),
  });
  trustedClaims.add(claim);
  return claim;
}

export function requireInProcessPrivateKwOwnerAuthOperationClaim(
  value: unknown,
): PrivateKwOwnerAuthOperationClaim {
  OperationClaimSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedClaims.has(value)) {
    throw new Error("An exact in-process owner-auth operation claim is required.");
  }
  const claim = value as PrivateKwOwnerAuthOperationClaim;
  if (artifactReferenceDigest({
    claimVersion: claim.claimVersion,
    statementId: claim.statementId,
    mutationKind: claim.mutationKind,
    targetTable: claim.targetTable,
    idempotencyKey: claim.idempotencyKey,
    boundaryId: claim.boundaryId,
    boundaryDigest: claim.boundaryDigest,
    owner: claim.owner,
    operation: claim.operation,
    payloadDigest: claim.payloadDigest,
    claimPredicate: claim.claimPredicate,
    claimBindings: claim.claimBindings,
    sql: claim.sql,
    claimEmbedded: claim.claimEmbedded,
    singleStatement: claim.singleStatement,
    mustShareD1Batch: claim.mustShareD1Batch,
    executableByThisContract: claim.executableByThisContract,
    authority: claim.authority,
  }) !== claim.claimDigest) {
    throw new Error("Owner-auth operation claim digest does not match its content.");
  }
  return claim;
}
