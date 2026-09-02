import { createHmac } from "node:crypto";

import { z } from "zod";

import {
  artifactReferenceCanonicalJson,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_CONFIRMATION,
  PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_DECISION_VERSION,
  PrivateKwOwnerDossierAcceptanceProofSchema,
  buildPrivateKwOwnerDossierAcceptanceProof,
} from "@/lib/revenue-engine/private-kw-owner-dossier-progress-proof";
import {
  privateKwShadowSliceProgressDigest,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";

export const PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_RECORD_VERSION =
  "kw-authenticated-owner-dossier-decision-v1";
export const PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION =
  "kw-owner-dossier-decision-declaration-v1";
export const PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION =
  PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_CONFIRMATION;
export const PRIVATE_KW_OWNER_SESSION_CONTRACT_VERSION =
  "better-auth-owner-session-v1";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IdentitySchema = z.string().trim().min(1).max(300);
const PrivateAuthIdentifierSchema = z.string().trim().min(1).max(128);
const BindingKeyVersionSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);

const AuthorizedOwnerByEmail = {
  "riley@getaxiom.ca": "RILEY",
  "aidan@getaxiom.ca": "AIDAN",
} as const;

const PrivateKwAuthenticatedOwnerDecisionDeclarationSchema = z.object({
  declarationVersion: z.literal(
    PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_DECLARATION_VERSION,
  ),
  dossierDigest: Sha256Schema,
  businessId: IdentitySchema,
  decision: z.literal("ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS"),
  rationale: z.string().trim().min(1).max(1_000),
  confirmation: z.literal(PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION),
  mode: z.literal("SHADOW"),
}).strict();

const BetterAuthOwnerSessionSchema = z.object({
  sessionContractVersion: z.literal(PRIVATE_KW_OWNER_SESSION_CONTRACT_VERSION),
  authenticationProvider: z.literal("BETTER_AUTH"),
  authenticatedUserId: PrivateAuthIdentifierSchema,
  authenticatedSessionId: PrivateAuthIdentifierSchema,
  authenticatedEmail: z.string().trim().toLowerCase().email().max(320),
  authenticatedEmailVerified: z.literal(true),
  sessionCreatedAt: TimestampSchema,
  sessionExpiresAt: TimestampSchema,
}).strict();

const AuthenticatedOwnerDecisionAuthoritySchema = z.object({
  contractValidationOnly: z.literal(true),
  currentOwnerSessionRequiredAtFutureWrite: z.literal(true),
  exactTrustedDecisionInstanceRequiredAtFutureWrite: z.literal(true),
  durableExactReloadRequiredBeforeProgress: z.literal(true),
  durableDecisionRecorded: z.literal(false),
  ownerDecisionPersistenceAuthorized: z.literal(false),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  fileReadAuthorized: z.literal(false),
  fileMutationAuthorized: z.literal(false),
  databaseReadAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  browserCaptureAuthorized: z.literal(false),
  contactDiscoveryExecutionAuthorized: z.literal(false),
  contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  mailboxSyncAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const AuthenticationBindingSchema = z.object({
  sessionContractVersion: z.literal(PRIVATE_KW_OWNER_SESSION_CONTRACT_VERSION),
  authenticationProvider: z.literal("BETTER_AUTH"),
  authorizationSource: z.literal("EXPLICIT_AXIOM_OWNER_EMAIL_ALLOWLIST"),
  authenticatedOwner: z.enum(["RILEY", "AIDAN"]),
  emailVerified: z.literal(true),
  subjectBindingDigest: Sha256Schema,
  sessionBindingDigest: Sha256Schema,
  decisionBindingDigest: Sha256Schema,
  bindingKeyVersion: BindingKeyVersionSchema,
  observedAt: TimestampSchema,
  sessionExpiresAt: TimestampSchema,
  assurance: z.literal(
    "CURRENT_BETTER_AUTH_SESSION_CONTEXT_BOUND_WITH_HMAC_SHA256",
  ),
  futureWriteRequirement: z.literal(
    "RECHECK_CURRENT_SESSION_AND_EXACT_IN_PROCESS_DECISION",
  ),
}).strict();

const AuthenticatedOwnerDecisionCoreSchema = z.object({
  recordVersion: z.literal(PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_RECORD_VERSION),
  recordKind: z.literal("AUTHENTICATED_OWNER_DOSSIER_DECISION"),
  mode: z.literal("SHADOW"),
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  sourceImportId: IdentitySchema,
  sourcePlanDigest: Sha256Schema,
  businessId: IdentitySchema,
  evaluationCandidateId: IdentitySchema,
  sourceRecordId: IdentitySchema,
  parentCheckpoint: PrivateKwOwnerDossierAcceptanceProofSchema.shape.parentCheckpoint,
  previousPhaseReceipt:
    PrivateKwOwnerDossierAcceptanceProofSchema.shape.previousPhaseReceipt,
  ownerDossier: PrivateKwOwnerDossierAcceptanceProofSchema.shape.ownerDossier,
  acceptanceProof: PrivateKwOwnerDossierAcceptanceProofSchema,
  decision: z.object({
    decisionVersion: z.literal(
      PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_DECISION_VERSION,
    ),
    decision: z.literal("ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS"),
    decidedBy: z.enum(["RILEY", "AIDAN"]),
    decidedAt: TimestampSchema,
    rationale: z.string().trim().min(1).max(1_000),
    confirmation: z.literal(PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_CONFIRMATION),
  }).strict(),
  authentication: AuthenticationBindingSchema,
  preparedAt: TimestampSchema,
  authority: AuthenticatedOwnerDecisionAuthoritySchema,
}).strict();

export const PrivateKwAuthenticatedOwnerDecisionRecordSchema =
  AuthenticatedOwnerDecisionCoreSchema.extend({
    recordId: z.string().regex(/^kw-owner-decision:[a-f0-9]{64}$/),
    recordDigest: Sha256Schema,
  }).strict().superRefine((record, context) => {
    const { recordId: _recordId, recordDigest: _recordDigest, ...core } = record;
    void _recordId;
    void _recordDigest;
    const expectedDigest = privateKwShadowSliceProgressDigest(core);
    if (
      record.recordDigest !== expectedDigest
      || record.recordId !== `kw-owner-decision:${expectedDigest}`
    ) {
      context.addIssue({
        code: "custom",
        message: "Authenticated owner decision identity must bind its exact record.",
        path: ["recordDigest"],
      });
    }

    const proof = record.acceptanceProof;
    const mirrored = {
      manifestId: record.manifestId,
      manifestDigest: record.manifestDigest,
      sourceImportId: record.sourceImportId,
      sourcePlanDigest: record.sourcePlanDigest,
      businessId: record.businessId,
      evaluationCandidateId: record.evaluationCandidateId,
      sourceRecordId: record.sourceRecordId,
      parentCheckpoint: record.parentCheckpoint,
      previousPhaseReceipt: record.previousPhaseReceipt,
      ownerDossier: record.ownerDossier,
      decision: record.decision,
    };
    const expectedMirrored = {
      manifestId: proof.manifestId,
      manifestDigest: proof.manifestDigest,
      sourceImportId: proof.sourceImportId,
      sourcePlanDigest: proof.sourcePlanDigest,
      businessId: proof.businessId,
      evaluationCandidateId: proof.evaluationCandidateId,
      sourceRecordId: proof.sourceRecordId,
      parentCheckpoint: proof.parentCheckpoint,
      previousPhaseReceipt: proof.previousPhaseReceipt,
      ownerDossier: proof.ownerDossier,
      decision: {
        decisionVersion: proof.acceptance.decisionVersion,
        decision: proof.acceptance.decision,
        decidedBy: proof.acceptance.acceptedBy,
        decidedAt: proof.acceptance.acceptedAt,
        rationale: proof.acceptance.rationale,
        confirmation: proof.acceptance.confirmation,
      },
    };
    if (
      artifactReferenceCanonicalJson(mirrored)
      !== artifactReferenceCanonicalJson(expectedMirrored)
    ) {
      context.addIssue({
        code: "custom",
        message: "Authenticated owner decision must mirror its exact acceptance proof.",
        path: ["acceptanceProof"],
      });
    }
    if (
      record.authentication.authenticatedOwner !== record.decision.decidedBy
      || record.authentication.observedAt !== record.decision.decidedAt
      || record.preparedAt !== record.decision.decidedAt
      || Date.parse(record.authentication.sessionExpiresAt)
        <= Date.parse(record.authentication.observedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Authenticated owner decision session and decision chronology must match.",
        path: ["authentication"],
      });
    }
  });

export type PrivateKwAuthenticatedOwnerDecisionRecord = z.infer<
  typeof PrivateKwAuthenticatedOwnerDecisionRecordSchema
>;

export const PrivateKwAuthenticatedOwnerDecisionStorageRowSchema = z.object({
  id: z.string().regex(/^kw-owner-decision:[a-f0-9]{64}$/),
  decisionVersion: z.literal(PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_RECORD_VERSION),
  recordKind: z.literal("AUTHENTICATED_OWNER_DOSSIER_DECISION"),
  decisionDigest: Sha256Schema,
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  sourceImportId: IdentitySchema,
  sourcePlanDigest: Sha256Schema,
  businessId: IdentitySchema,
  evaluationCandidateId: IdentitySchema,
  sourceRecordId: IdentitySchema,
  parentCheckpointId: z.string().regex(/^kw-shadow-progress:[a-f0-9]{64}$/),
  parentCheckpointDigest: Sha256Schema,
  previousPhaseReceiptId: z.string().regex(/^kw-shadow-phase:[a-f0-9]{64}$/),
  previousPhaseReceiptDigest: Sha256Schema,
  dossierDigest: Sha256Schema,
  dossierGeneratedAt: TimestampSchema,
  websiteSnapshotId: IdentitySchema,
  qualificationSnapshotId: IdentitySchema,
  contactInvocationId: z.string().regex(/^kw-contact-invocation:[a-f0-9]{64}$/),
  contactInvocationDigest: Sha256Schema,
  contactReviewId: z.string().regex(/^kw-contact-review:[a-f0-9]{64}$/),
  acceptanceProofId: z.string().regex(/^owner-dossier-acceptance:[a-f0-9]{64}$/),
  acceptanceProofDigest: Sha256Schema,
  decision: z.literal("ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS"),
  decidedBy: z.enum(["RILEY", "AIDAN"]),
  decidedAt: TimestampSchema,
  authProvider: z.literal("BETTER_AUTH"),
  authSubjectBindingDigest: Sha256Schema,
  authSessionBindingDigest: Sha256Schema,
  authDecisionBindingDigest: Sha256Schema,
  authBindingKeyVersion: BindingKeyVersionSchema,
  sessionExpiresAt: TimestampSchema,
  decisionJson: z.string().min(2).max(1_048_576),
  preparedAt: TimestampSchema,
  recordScope: z.literal("OWNER_DECISION_RECORD_ONLY"),
  authenticatedSessionRequired: z.literal(1),
  verifiedOwnerEmailRequired: z.literal(1),
  currentSessionRecheckAtFutureWriteRequired: z.literal(1),
  exactTrustedDecisionInstanceRequired: z.literal(1),
  durableExactReloadRequiredBeforeProgress: z.literal(1),
  ownerDecisionPersistenceAuthorized: z.literal(0),
  phaseInputCreationAuthorized: z.literal(0),
  progressReceiptCreationAuthorized: z.literal(0),
  phaseAdvancementAuthorized: z.literal(0),
  browserCaptureAuthorized: z.literal(0),
  contactDiscoveryAuthorized: z.literal(0),
  contactVerificationAuthorized: z.literal(0),
  consentDecisionAuthorized: z.literal(0),
  qualificationAuthorized: z.literal(0),
  mailboxSyncAuthorized: z.literal(0),
  outreachAuthorized: z.literal(0),
  sendAuthorized: z.literal(0),
  deploymentAuthorized: z.literal(0),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export type PrivateKwAuthenticatedOwnerDecisionStorageRow = z.infer<
  typeof PrivateKwAuthenticatedOwnerDecisionStorageRowSchema
>;

const trustedAuthenticatedOwnerDecisionRecords = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function bindingKey(value: Uint8Array) {
  if (!(value instanceof Uint8Array) || value.byteLength < 32) {
    throw new Error("Owner decision binding keys must contain at least 32 bytes.");
  }
  return value;
}

function hmacDigest(key: Uint8Array, value: unknown) {
  return createHmac("sha256", key)
    .update(artifactReferenceCanonicalJson(value))
    .digest("hex");
}

function authorizedOwner(email: string) {
  const owner = AuthorizedOwnerByEmail[email as keyof typeof AuthorizedOwnerByEmail];
  if (!owner) {
    throw new Error("An authorized Axiom owner session is required.");
  }
  return owner;
}

function authority() {
  return AuthenticatedOwnerDecisionAuthoritySchema.parse({
    contractValidationOnly: true,
    currentOwnerSessionRequiredAtFutureWrite: true,
    exactTrustedDecisionInstanceRequiredAtFutureWrite: true,
    durableExactReloadRequiredBeforeProgress: true,
    durableDecisionRecorded: false,
    ownerDecisionPersistenceAuthorized: false,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    fileReadAuthorized: false,
    fileMutationAuthorized: false,
    databaseReadAuthorized: false,
    databaseMutationAuthorized: false,
    browserCaptureAuthorized: false,
    contactDiscoveryExecutionAuthorized: false,
    contactVerificationExecutionAuthorized: false,
    consentDecisionAuthorized: false,
    qualificationAuthorized: false,
    mailboxSyncAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

export function requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord(
  value: unknown,
): PrivateKwAuthenticatedOwnerDecisionRecord {
  PrivateKwAuthenticatedOwnerDecisionRecordSchema.parse(value);
  if (
    !value
    || typeof value !== "object"
    || !trustedAuthenticatedOwnerDecisionRecords.has(value)
  ) {
    throw new Error(
      "An exact in-process authenticated owner decision is required.",
    );
  }
  return value as PrivateKwAuthenticatedOwnerDecisionRecord;
}

/**
 * Mirrors one exact trusted record into migration-0069 column values. It emits
 * no SQL and grants no database read or mutation authority.
 */
export function projectPrivateKwAuthenticatedOwnerDecisionStorageRow(
  value: unknown,
): PrivateKwAuthenticatedOwnerDecisionStorageRow {
  const record = requireInProcessPrivateKwAuthenticatedOwnerDecisionRecord(value);
  return deepFreeze(PrivateKwAuthenticatedOwnerDecisionStorageRowSchema.parse({
    id: record.recordId,
    decisionVersion: record.recordVersion,
    recordKind: record.recordKind,
    decisionDigest: record.recordDigest,
    manifestId: record.manifestId,
    manifestDigest: record.manifestDigest,
    sourceImportId: record.sourceImportId,
    sourcePlanDigest: record.sourcePlanDigest,
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    sourceRecordId: record.sourceRecordId,
    parentCheckpointId: record.parentCheckpoint.checkpointId,
    parentCheckpointDigest: record.parentCheckpoint.checkpointDigest,
    previousPhaseReceiptId: record.previousPhaseReceipt.phaseReceiptId,
    previousPhaseReceiptDigest: record.previousPhaseReceipt.phaseReceiptDigest,
    dossierDigest: record.ownerDossier.dossierDigest,
    dossierGeneratedAt: record.ownerDossier.generatedAt,
    websiteSnapshotId: record.ownerDossier.websiteSnapshotId,
    qualificationSnapshotId: record.ownerDossier.qualificationSnapshotId,
    contactInvocationId: record.previousPhaseReceipt.contactInvocationId,
    contactInvocationDigest: record.previousPhaseReceipt.contactInvocationDigest,
    contactReviewId: record.ownerDossier.contactReviewId,
    acceptanceProofId: record.acceptanceProof.proofId,
    acceptanceProofDigest: record.acceptanceProof.proofDigest,
    decision: record.decision.decision,
    decidedBy: record.decision.decidedBy,
    decidedAt: record.decision.decidedAt,
    authProvider: record.authentication.authenticationProvider,
    authSubjectBindingDigest: record.authentication.subjectBindingDigest,
    authSessionBindingDigest: record.authentication.sessionBindingDigest,
    authDecisionBindingDigest: record.authentication.decisionBindingDigest,
    authBindingKeyVersion: record.authentication.bindingKeyVersion,
    sessionExpiresAt: record.authentication.sessionExpiresAt,
    decisionJson: artifactReferenceCanonicalJson(record),
    preparedAt: record.preparedAt,
    recordScope: "OWNER_DECISION_RECORD_ONLY",
    authenticatedSessionRequired: 1,
    verifiedOwnerEmailRequired: 1,
    currentSessionRecheckAtFutureWriteRequired: 1,
    exactTrustedDecisionInstanceRequired: 1,
    durableExactReloadRequiredBeforeProgress: 1,
    ownerDecisionPersistenceAuthorized: 0,
    phaseInputCreationAuthorized: 0,
    progressReceiptCreationAuthorized: 0,
    phaseAdvancementAuthorized: 0,
    browserCaptureAuthorized: 0,
    contactDiscoveryAuthorized: 0,
    contactVerificationAuthorized: 0,
    consentDecisionAuthorized: 0,
    qualificationAuthorized: 0,
    mailboxSyncAuthorized: 0,
    outreachAuthorized: 0,
    sendAuthorized: 0,
    deploymentAuthorized: 0,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  }));
}

/**
 * Builds one authenticated decision record candidate. The caller must supply
 * current Better Auth session context obtained in the same server request. This
 * module does not read Better Auth, persist, append progress, or authorize any
 * operation.
 */
export function buildPrivateKwAuthenticatedOwnerDecisionRecord(
  input: {
    manifestValue: unknown;
    contactReviewProgressCheckpointValue: unknown;
    ownerDossierValue: unknown;
    declarationValue: unknown;
    authenticatedSessionValue: unknown;
  },
  dependencies: {
    bindingKey: Uint8Array;
    bindingKeyVersion: string;
    now?: () => Date;
  },
): PrivateKwAuthenticatedOwnerDecisionRecord {
  const declaration = PrivateKwAuthenticatedOwnerDecisionDeclarationSchema.parse(
    input.declarationValue,
  );
  const session = BetterAuthOwnerSessionSchema.parse(
    input.authenticatedSessionValue,
  );
  const key = bindingKey(dependencies.bindingKey);
  const keyVersion = BindingKeyVersionSchema.parse(dependencies.bindingKeyVersion);
  const now = (dependencies.now ?? (() => new Date()))();
  const decidedAtMs = now.getTime();
  if (!Number.isFinite(decidedAtMs)) {
    throw new Error("Owner decision time must be a valid server timestamp.");
  }
  const decidedAt = now.toISOString();
  if (
    decidedAtMs < Date.parse(session.sessionCreatedAt)
    || decidedAtMs >= Date.parse(session.sessionExpiresAt)
  ) {
    throw new Error("The authenticated owner session must be active at the decision time.");
  }
  const owner = authorizedOwner(session.authenticatedEmail);

  const proof = buildPrivateKwOwnerDossierAcceptanceProof({
    manifestValue: input.manifestValue,
    contactReviewProgressCheckpointValue:
      input.contactReviewProgressCheckpointValue,
    ownerDossierValue: input.ownerDossierValue,
    acceptanceValue: {
      decisionVersion: PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_DECISION_VERSION,
      dossierDigest: declaration.dossierDigest,
      businessId: declaration.businessId,
      decision: declaration.decision,
      acceptedBy: owner,
      acceptedAt: decidedAt,
      rationale: declaration.rationale,
      confirmation: declaration.confirmation,
      mode: declaration.mode,
    },
  });

  const subjectBindingDigest = hmacDigest(key, {
    bindingVersion: "kw-owner-decision-subject-binding-v1",
    authenticationProvider: session.authenticationProvider,
    authenticatedUserId: session.authenticatedUserId,
    authenticatedEmail: session.authenticatedEmail,
    authenticatedEmailVerified: session.authenticatedEmailVerified,
  });
  const sessionBindingDigest = hmacDigest(key, {
    bindingVersion: "kw-owner-decision-session-binding-v1",
    subjectBindingDigest,
    authenticatedSessionId: session.authenticatedSessionId,
    sessionCreatedAt: session.sessionCreatedAt,
    sessionExpiresAt: session.sessionExpiresAt,
  });
  const decisionBindingDigest = hmacDigest(key, {
    bindingVersion: "kw-owner-decision-proof-binding-v1",
    bindingKeyVersion: keyVersion,
    subjectBindingDigest,
    sessionBindingDigest,
    acceptanceProofId: proof.proofId,
    acceptanceProofDigest: proof.proofDigest,
    decision: proof.acceptance.decision,
    decidedBy: owner,
    decidedAt,
  });

  const core = AuthenticatedOwnerDecisionCoreSchema.parse({
    recordVersion: PRIVATE_KW_AUTHENTICATED_OWNER_DECISION_RECORD_VERSION,
    recordKind: "AUTHENTICATED_OWNER_DOSSIER_DECISION",
    mode: "SHADOW",
    manifestId: proof.manifestId,
    manifestDigest: proof.manifestDigest,
    sourceImportId: proof.sourceImportId,
    sourcePlanDigest: proof.sourcePlanDigest,
    businessId: proof.businessId,
    evaluationCandidateId: proof.evaluationCandidateId,
    sourceRecordId: proof.sourceRecordId,
    parentCheckpoint: proof.parentCheckpoint,
    previousPhaseReceipt: proof.previousPhaseReceipt,
    ownerDossier: proof.ownerDossier,
    acceptanceProof: proof,
    decision: {
      decisionVersion: proof.acceptance.decisionVersion,
      decision: proof.acceptance.decision,
      decidedBy: proof.acceptance.acceptedBy,
      decidedAt: proof.acceptance.acceptedAt,
      rationale: proof.acceptance.rationale,
      confirmation: proof.acceptance.confirmation,
    },
    authentication: {
      sessionContractVersion: session.sessionContractVersion,
      authenticationProvider: session.authenticationProvider,
      authorizationSource: "EXPLICIT_AXIOM_OWNER_EMAIL_ALLOWLIST",
      authenticatedOwner: owner,
      emailVerified: session.authenticatedEmailVerified,
      subjectBindingDigest,
      sessionBindingDigest,
      decisionBindingDigest,
      bindingKeyVersion: keyVersion,
      observedAt: decidedAt,
      sessionExpiresAt: session.sessionExpiresAt,
      assurance: "CURRENT_BETTER_AUTH_SESSION_CONTEXT_BOUND_WITH_HMAC_SHA256",
      futureWriteRequirement:
        "RECHECK_CURRENT_SESSION_AND_EXACT_IN_PROCESS_DECISION",
    },
    preparedAt: decidedAt,
    authority: authority(),
  });
  const recordDigest = privateKwShadowSliceProgressDigest(core);
  const record = deepFreeze(PrivateKwAuthenticatedOwnerDecisionRecordSchema.parse({
    ...core,
    recordId: `kw-owner-decision:${recordDigest}`,
    recordDigest,
  }));
  trustedAuthenticatedOwnerDecisionRecords.add(record);
  return record;
}
