import { z } from "zod";

import {
  privateKwShadowSliceProgressDigest,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import {
  recheckPrivateKwAuthenticatedOwnerDecisionStoredSessionBinding,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision";
import {
  requireTrustedPrivateKwAuthenticatedOwnerDecisionD1Result,
} from "@/lib/revenue-engine/private-kw-authenticated-owner-decision-d1";

export const PRIVATE_KW_OWNER_DOSSIER_PROGRESS_AUTHORIZATION_VERSION =
  "kw-owner-dossier-progress-authorization-v1";
export const PRIVATE_KW_OWNER_DOSSIER_PROGRESS_AUTHORIZATION_WINDOW_MS =
  60_000;

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IdentitySchema = z.string().trim().min(1).max(300);

const CurrentSessionBindingSchema = z.object({
  authenticationProvider: z.literal("BETTER_AUTH"),
  authenticatedOwner: z.enum(["RILEY", "AIDAN"]),
  emailVerified: z.literal(true),
  bindingKeyVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
  subjectBindingDigest: Sha256Schema,
  sessionBindingDigest: Sha256Schema,
  decisionBindingDigest: Sha256Schema,
  sessionCreatedAt: TimestampSchema,
  sessionExpiresAt: TimestampSchema,
  observedAt: TimestampSchema,
  bindingIntegrityVerified: z.literal(true),
}).strict();

const AuthoritySchema = z.object({
  validationOnly: z.literal(true),
  exactTrustedDurableDecisionRequired: z.literal(true),
  serverOnlyCurrentVerifiedSessionRequired: z.literal(true),
  durableDecisionRecorded: z.literal(true),
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

const AuthorizationCoreSchema = z.object({
  authorizationVersion: z.literal(
    PRIVATE_KW_OWNER_DOSSIER_PROGRESS_AUTHORIZATION_VERSION,
  ),
  authorizationKind: z.literal("OWNER_DOSSIER_PROGRESS_AUTHORIZATION"),
  mode: z.literal("SHADOW"),
  state: z.literal("VALIDATED_NOT_ACTIVATED"),
  decision: z.object({
    recordId: z.string().regex(/^kw-owner-decision:[a-f0-9]{64}$/),
    recordDigest: Sha256Schema,
    executionPath: z.literal("DURABLE_RELOAD"),
    decisionRecordedAt: TimestampSchema,
    databaseNow: TimestampSchema,
    bindingKeyVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
    bindingIntegrityVerified: z.literal(true),
  }).strict(),
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  sourceImportId: IdentitySchema,
  sourcePlanDigest: Sha256Schema,
  businessId: IdentitySchema,
  evaluationCandidateId: IdentitySchema,
  sourceRecordId: IdentitySchema,
  parentCheckpoint: z.object({
    checkpointId: z.string().regex(/^kw-shadow-progress:[a-f0-9]{64}$/),
    checkpointDigest: Sha256Schema,
  }).strict(),
  previousPhaseReceipt: z.object({
    phaseReceiptId: z.string().regex(/^kw-shadow-phase:[a-f0-9]{64}$/),
    phaseReceiptDigest: Sha256Schema,
    contactInvocationId: z.string().regex(/^kw-contact-invocation:[a-f0-9]{64}$/),
    contactInvocationDigest: Sha256Schema,
  }).strict(),
  dossier: z.object({
    dossierDigest: Sha256Schema,
    generatedAt: TimestampSchema,
    websiteSnapshotId: IdentitySchema,
    qualificationSnapshotId: IdentitySchema,
    contactReviewId: z.string().regex(/^kw-contact-review:[a-f0-9]{64}$/),
  }).strict(),
  acceptanceProof: z.object({
    proofId: z.string().regex(/^owner-dossier-acceptance:[a-f0-9]{64}$/),
    proofDigest: Sha256Schema,
    acceptedBy: z.enum(["RILEY", "AIDAN"]),
    acceptedAt: TimestampSchema,
  }).strict(),
  currentSession: CurrentSessionBindingSchema,
  progress: z.object({
    phase: z.literal("OWNER_DOSSIER"),
    proofKind: z.literal("READ_ONLY_OWNER_DOSSIER_ACCEPTANCE"),
    primaryReceiptId: z.string().regex(/^owner-dossier-acceptance:[a-f0-9]{64}$/),
    primaryReceiptDigest: Sha256Schema,
    nextRequiredGate: z.literal("OWNER_DOSSIER_ACCEPTANCE"),
  }).strict(),
  authorizedAt: TimestampSchema,
  authority: AuthoritySchema,
}).strict();

export const PrivateKwOwnerDossierProgressAuthorizationSchema =
  AuthorizationCoreSchema.extend({
    authorizationId: z.string().regex(
      /^kw-owner-dossier-progress-authorization:[a-f0-9]{64}$/,
    ),
    authorizationDigest: Sha256Schema,
  }).strict().superRefine((authorization, context) => {
    const {
      authorizationId: _authorizationId,
      authorizationDigest: _authorizationDigest,
      ...core
    } = authorization;
    void _authorizationId;
    void _authorizationDigest;
    const expectedDigest = privateKwShadowSliceProgressDigest(core);
    if (
      authorization.authorizationDigest !== expectedDigest
      || authorization.authorizationId
        !== `kw-owner-dossier-progress-authorization:${expectedDigest}`
    ) {
      context.addIssue({
        code: "custom",
        message: "Owner-dossier progress authorization identity must bind its exact content.",
        path: ["authorizationDigest"],
      });
    }
    if (
      authorization.acceptanceProof.acceptedBy
        !== authorization.currentSession.authenticatedOwner
      || authorization.decision.recordId
        !== `kw-owner-decision:${authorization.decision.recordDigest}`
      || authorization.progress.primaryReceiptId
        !== authorization.acceptanceProof.proofId
      || authorization.progress.primaryReceiptDigest
        !== authorization.acceptanceProof.proofDigest
      || authorization.authorizedAt !== authorization.currentSession.observedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "Owner-dossier progress authorization must preserve exact decision and session lineage.",
        path: ["currentSession"],
      });
    }
  });

export type PrivateKwOwnerDossierProgressAuthorization = z.infer<
  typeof PrivateKwOwnerDossierProgressAuthorizationSchema
>;

const trustedOwnerDossierProgressAuthorizations = new WeakSet<object>();
const authorizationContexts = new WeakMap<object, {
  durableDecision: object;
}>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function authority() {
  return AuthoritySchema.parse({
    validationOnly: true,
    exactTrustedDurableDecisionRequired: true,
    serverOnlyCurrentVerifiedSessionRequired: true,
    durableDecisionRecorded: true,
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

export function requireInProcessPrivateKwOwnerDossierProgressAuthorization(
  value: unknown,
): PrivateKwOwnerDossierProgressAuthorization {
  PrivateKwOwnerDossierProgressAuthorizationSchema.parse(value);
  if (
    !value
    || typeof value !== "object"
    || !trustedOwnerDossierProgressAuthorizations.has(value)
  ) {
    throw new Error(
      "An exact in-process owner-dossier progress authorization is required.",
    );
  }
  return value as PrivateKwOwnerDossierProgressAuthorization;
}

export function requireInProcessPrivateKwOwnerDossierProgressAuthorizationForDecision(
  value: unknown,
  durableDecisionValue: unknown,
): PrivateKwOwnerDossierProgressAuthorization {
  const authorization =
    requireInProcessPrivateKwOwnerDossierProgressAuthorization(value);
  const durableDecision =
    requireTrustedPrivateKwAuthenticatedOwnerDecisionD1Result(
      durableDecisionValue,
    );
  const context = authorizationContexts.get(authorization);
  if (!context || context.durableDecision !== durableDecision) {
    throw new Error(
      "Owner-dossier progress authorization requires its exact durable decision reload.",
    );
  }
  return authorization;
}

function authorizationNow(dependencies: { now?: () => Date }) {
  const value = (dependencies.now ?? (() => new Date()))();
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error("Owner-dossier progress authorization time must be valid.");
  }
  return { value, milliseconds };
}

/**
 * Validates the bridge from one exact durable owner-decision reload to a newly
 * obtained server-only Better Auth session. It creates no phase input, receipt,
 * checkpoint, database operation, provider call, route, or UI action.
 */
export function buildPrivateKwOwnerDossierProgressAuthorization(
  input: {
    durableDecisionResultValue: unknown;
    currentServerSessionValue: unknown;
  },
  dependencies: {
    bindingKey: Uint8Array;
    bindingKeyVersion: string;
    now?: () => Date;
  },
): PrivateKwOwnerDossierProgressAuthorization {
  const durable = requireTrustedPrivateKwAuthenticatedOwnerDecisionD1Result(
    input.durableDecisionResultValue,
  );
  if (durable.executionPath !== "DURABLE_RELOAD") {
    throw new Error(
      "Owner-dossier progress authorization requires a process-loss durable reload.",
    );
  }
  const { value: now, milliseconds: authorizedAtMs } = authorizationNow(dependencies);
  const durableNowMs = Date.parse(durable.databaseNow);
  const sessionRecheck =
    recheckPrivateKwAuthenticatedOwnerDecisionStoredSessionBinding(
      durable.record,
      input.currentServerSessionValue,
      dependencies,
    );
  if (
    authorizedAtMs < Date.parse(sessionRecheck.sessionCreatedAt)
    || authorizedAtMs >= Date.parse(sessionRecheck.sessionExpiresAt)
  ) {
    throw new Error(
      "The verified owner session must be current at authorization time.",
    );
  }
  if (authorizedAtMs < durableNowMs) {
    throw new Error(
      "Owner-dossier authorization cannot predate the durable reload.",
    );
  }
  if (
    authorizedAtMs - durableNowMs
      > PRIVATE_KW_OWNER_DOSSIER_PROGRESS_AUTHORIZATION_WINDOW_MS
  ) {
    throw new Error(
      "A fresh durable reload is required immediately before owner-dossier authorization.",
    );
  }

  const record = durable.record;
  const proof = record.acceptanceProof;
  const authorizationCore = AuthorizationCoreSchema.parse({
    authorizationVersion:
      PRIVATE_KW_OWNER_DOSSIER_PROGRESS_AUTHORIZATION_VERSION,
    authorizationKind: "OWNER_DOSSIER_PROGRESS_AUTHORIZATION",
    mode: "SHADOW",
    state: "VALIDATED_NOT_ACTIVATED",
    decision: {
      recordId: record.recordId,
      recordDigest: record.recordDigest,
      executionPath: durable.executionPath,
      decisionRecordedAt: durable.decisionRecordedAt,
      databaseNow: durable.databaseNow,
      bindingKeyVersion: durable.bindingKeyVersion,
      bindingIntegrityVerified: durable.bindingIntegrityVerified,
    },
    manifestId: record.manifestId,
    manifestDigest: record.manifestDigest,
    sourceImportId: record.sourceImportId,
    sourcePlanDigest: record.sourcePlanDigest,
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    sourceRecordId: record.sourceRecordId,
    parentCheckpoint: {
      checkpointId: record.parentCheckpoint.checkpointId,
      checkpointDigest: record.parentCheckpoint.checkpointDigest,
    },
    previousPhaseReceipt: {
      phaseReceiptId: record.previousPhaseReceipt.phaseReceiptId,
      phaseReceiptDigest: record.previousPhaseReceipt.phaseReceiptDigest,
      contactInvocationId: record.previousPhaseReceipt.contactInvocationId,
      contactInvocationDigest: record.previousPhaseReceipt.contactInvocationDigest,
    },
    dossier: {
      dossierDigest: record.ownerDossier.dossierDigest,
      generatedAt: record.ownerDossier.generatedAt,
      websiteSnapshotId: record.ownerDossier.websiteSnapshotId,
      qualificationSnapshotId: record.ownerDossier.qualificationSnapshotId,
      contactReviewId: record.ownerDossier.contactReviewId,
    },
    acceptanceProof: {
      proofId: proof.proofId,
      proofDigest: proof.proofDigest,
      acceptedBy: proof.acceptance.acceptedBy,
      acceptedAt: proof.acceptance.acceptedAt,
    },
    currentSession: {
      authenticationProvider: sessionRecheck.authenticationProvider,
      authenticatedOwner: sessionRecheck.authenticatedOwner,
      emailVerified: sessionRecheck.emailVerified,
      bindingKeyVersion: sessionRecheck.bindingKeyVersion,
      subjectBindingDigest: sessionRecheck.subjectBindingDigest,
      sessionBindingDigest: sessionRecheck.sessionBindingDigest,
      decisionBindingDigest: sessionRecheck.decisionBindingDigest,
      sessionCreatedAt: sessionRecheck.sessionCreatedAt,
      sessionExpiresAt: sessionRecheck.sessionExpiresAt,
      observedAt: now.toISOString(),
      bindingIntegrityVerified: sessionRecheck.bindingIntegrityVerified,
    },
    progress: {
      phase: "OWNER_DOSSIER",
      proofKind: "READ_ONLY_OWNER_DOSSIER_ACCEPTANCE",
      primaryReceiptId: proof.proofId,
      primaryReceiptDigest: proof.proofDigest,
      nextRequiredGate: "OWNER_DOSSIER_ACCEPTANCE",
    },
    authorizedAt: now.toISOString(),
    authority: authority(),
  });
  const authorizationDigest = privateKwShadowSliceProgressDigest(authorizationCore);
  const trusted = deepFreeze(
    PrivateKwOwnerDossierProgressAuthorizationSchema.parse({
      ...authorizationCore,
      authorizationId: `kw-owner-dossier-progress-authorization:${authorizationDigest}`,
      authorizationDigest,
    }),
  );
  trustedOwnerDossierProgressAuthorizations.add(trusted);
  authorizationContexts.set(trusted, {
    durableDecision: input.durableDecisionResultValue as object,
  });
  return trusted;
}
