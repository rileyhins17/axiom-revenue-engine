import { z } from "zod";

import {
  requireFreshMaterializedArtifactReferenceD1Execution,
} from "@/lib/revenue-engine/artifact-reference-d1-executor";
import {
  ARTIFACT_REFERENCE_PROJECTION_VERSION,
  ArtifactReferenceProjectionSchema,
  type ArtifactReferenceSourceFacts,
  artifactReferenceDigest,
  artifactReferenceSourceFactsDigest,
  createArtifactReferenceProjection,
  createFixtureArtifactManifestAvailability,
  createFixtureArtifactReferenceSnapshotReceipt,
} from "@/lib/revenue-engine/artifact-reference-projection";

export const ARTIFACT_REFERENCE_TRUSTED_PROJECTION_VERSION = "artifact-reference-trusted-projection-v2";
export const ARTIFACT_REFERENCE_TRUSTED_PROJECTOR_VERSION = "artifact-reference-trusted-projector-v1";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RequiredRetentionClassSchema = z.enum(["SHADOW_30D", "QUALIFICATION_180D", "OUTREACH_ACTIVE", "LEGAL_HOLD"]);

const ProjectionRequestSchema = z.object({
  projectionVersion: z.literal(ARTIFACT_REFERENCE_TRUSTED_PROJECTION_VERSION),
  projectionId: z.string().uuid(),
  projectedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  projectorKind: z.literal("FRESH_D1_EXECUTION_FIXTURE"),
  maxCostUsd: z.literal(0),
  execution: z.unknown(),
}).strict();

const TrustedProjectionCoreSchema = z.object({
  projectionVersion: z.literal(ARTIFACT_REFERENCE_TRUSTED_PROJECTION_VERSION),
  projectorVersion: z.literal(ARTIFACT_REFERENCE_TRUSTED_PROJECTOR_VERSION),
  projectionId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  workflowRunId: z.string().uuid(),
  lineageRootManifestId: z.string().uuid(),
  projectedAt: z.string().datetime({ offset: true }),
  snapshotCapturedAt: z.string().datetime({ offset: true }),
  freshUntil: z.string().datetime({ offset: true }),
  completenessReceiptId: z.string().uuid(),
  completenessReceiptDigest: Sha256Schema,
  sourceFactsDigest: Sha256Schema,
  basisProjectionSourceFactsDigest: Sha256Schema,
  executorVersion: z.string().trim().min(1).max(100),
  executionDigest: Sha256Schema,
  basisProjectionDigest: Sha256Schema,
  referenceState: z.enum(["ACTIVE_REFERENCES", "LEGAL_HOLD_ACTIVE", "NO_CURRENT_REFERENCES", "INDETERMINATE"]),
  activeUseCount: z.number().int().nonnegative().max(1_000),
  endedUseCount: z.number().int().nonnegative().max(1_000),
  ambiguousUseCount: z.number().int().nonnegative().max(1_000),
  unassignedUseCount: z.number().int().nonnegative().max(1_000),
  requiredRetentionClass: RequiredRetentionClassSchema.nullable(),
  noCurrentReferencesObserved: z.boolean(),
  manualReviewRequired: z.boolean(),
}).strict();

export const ArtifactReferenceTrustedProjectionSchema = TrustedProjectionCoreSchema.extend({
  projectionDigest: Sha256Schema,
  basisProjection: ArtifactReferenceProjectionSchema,
  lineageReplayComplete: z.literal(true),
  executionPath: z.literal("FRESH_COMMIT"),
  sourceRowsMaterialized: z.literal(true),
  committedReceiptReloaded: z.literal(true),
  transactionallyTrustedSource: z.literal(true),
  snapshotComplete: z.literal(true),
  completenessAssurance: z.literal("D1_ATOMIC_RECHECK_AND_RELOAD"),
  availabilityAssurance: z.literal("R2_HEAD_PER_MANIFEST"),
  projectionClockAssurance: z.literal("CALLER_ASSERTED_FIXTURE_ONLY"),
  validOnlyForExecutionDigest: z.literal(true),
  requiresFreshReferenceCheck: z.literal(true),
  retentionConclusionAuthorized: z.literal(false),
  projectionPersistenceAuthorized: z.literal(false),
  projectionPersistencePerformed: z.literal(false),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  providerDeleteAuthorized: z.literal(false),
  providerDeletePerformed: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((projection, context) => {
  const core = TrustedProjectionCoreSchema.parse({
    projectionVersion: projection.projectionVersion,
    projectorVersion: projection.projectorVersion,
    projectionId: projection.projectionId,
    businessId: projection.businessId,
    workflowRunId: projection.workflowRunId,
    lineageRootManifestId: projection.lineageRootManifestId,
    projectedAt: projection.projectedAt,
    snapshotCapturedAt: projection.snapshotCapturedAt,
    freshUntil: projection.freshUntil,
    completenessReceiptId: projection.completenessReceiptId,
    completenessReceiptDigest: projection.completenessReceiptDigest,
    sourceFactsDigest: projection.sourceFactsDigest,
    basisProjectionSourceFactsDigest: projection.basisProjectionSourceFactsDigest,
    executorVersion: projection.executorVersion,
    executionDigest: projection.executionDigest,
    basisProjectionDigest: projection.basisProjectionDigest,
    referenceState: projection.referenceState,
    activeUseCount: projection.activeUseCount,
    endedUseCount: projection.endedUseCount,
    ambiguousUseCount: projection.ambiguousUseCount,
    unassignedUseCount: projection.unassignedUseCount,
    requiredRetentionClass: projection.requiredRetentionClass,
    noCurrentReferencesObserved: projection.noCurrentReferencesObserved,
    manualReviewRequired: projection.manualReviewRequired,
  });
  if (projection.projectionDigest !== artifactReferenceDigest({ core, basisProjection: projection.basisProjection })) {
    context.addIssue({ code: "custom", message: "Trusted reference projection digest must bind its exact source replay.", path: ["projectionDigest"] });
  }
  if (
    projection.basisProjection.projectionId !== projection.projectionId
    || projection.basisProjection.businessId !== projection.businessId
    || projection.basisProjection.lineageRootManifestId !== projection.lineageRootManifestId
    || projection.basisProjection.projectedAt !== projection.projectedAt
    || projection.basisProjection.snapshotCapturedAt !== projection.snapshotCapturedAt
    || projection.basisProjection.freshUntil !== projection.freshUntil
    || projection.basisProjection.sourceFactsDigest !== projection.basisProjectionSourceFactsDigest
    || projection.basisProjection.projectionDigest !== projection.basisProjectionDigest
  ) {
    context.addIssue({ code: "custom", message: "Trusted reference projection must mirror its exact deterministic lineage replay.", path: ["basisProjection"] });
  }
  if (artifactReferenceSourceFactsDigest(projection.basisProjection.sourceFacts) !== projection.basisProjectionSourceFactsDigest) {
    context.addIssue({ code: "custom", message: "Trusted reference projection source facts must match its deterministic compatibility replay digest.", path: ["basisProjectionSourceFactsDigest"] });
  }
  const expectedState = projection.activeUseCount === 0
    ? "NO_CURRENT_REFERENCES"
    : projection.ambiguousUseCount > 0 || projection.unassignedUseCount > 0
      ? "INDETERMINATE"
      : projection.requiredRetentionClass === "LEGAL_HOLD"
        ? "LEGAL_HOLD_ACTIVE"
        : "ACTIVE_REFERENCES";
  if (
    projection.referenceState !== expectedState
    || projection.noCurrentReferencesObserved !== (expectedState === "NO_CURRENT_REFERENCES")
    || projection.manualReviewRequired !== (expectedState === "INDETERMINATE")
  ) {
    context.addIssue({ code: "custom", message: "Trusted reference state must be derived from exact active, ended, ambiguous, and unassigned uses.", path: ["referenceState"] });
  }
  if (
    projection.activeUseCount !== projection.basisProjection.activeUseCount
    || projection.endedUseCount !== projection.basisProjection.endedUseCount
    || projection.ambiguousUseCount !== projection.basisProjection.ambiguousUseCount
    || projection.unassignedUseCount !== projection.basisProjection.unassignedUseCount
    || projection.requiredRetentionClass !== projection.basisProjection.requiredRetentionClass
  ) {
    context.addIssue({ code: "custom", message: "Trusted reference counts must exactly mirror the deterministic replay.", path: ["activeUseCount"] });
  }
});

export type ArtifactReferenceTrustedProjection = z.infer<typeof ArtifactReferenceTrustedProjectionSchema>;

/**
 * Replays the existing deterministic lineage projector over the source rows
 * materialized by one fresh, atomically committed D1 executor result. This is a
 * diagnostic fixture boundary only: it persists nothing and grants no
 * retention, release, deletion, provider, or spend authority.
 */
export function createArtifactReferenceTrustedProjection(value: unknown): ArtifactReferenceTrustedProjection {
  const request = ProjectionRequestSchema.parse(value);
  const execution = requireFreshMaterializedArtifactReferenceD1Execution(request.execution);
  const decoded = execution.decodedSnapshot;
  const receipt = execution.receipt;
  if (
    decoded.snapshotCapturedAt !== receipt.snapshotCapturedAt
    || decoded.selectedLineage.rootManifestId !== receipt.lineageRootManifestId
    || decoded.selectedLineage.facts.workflowRun.workflowRunId !== receipt.workflowRunId
    || decoded.selectedLineage.facts.workflowRun.businessId !== receipt.businessId
    || decoded.selectedLineage.sourceFactsDigest !== receipt.sourceFactsDigest
    || Date.parse(decoded.selectedAvailabilityFreshUntil) < Date.parse(receipt.freshUntil)
  ) {
    throw new Error("Fresh D1 execution facts do not exactly match the committed completeness receipt.");
  }
  if (Date.parse(request.projectedAt) < Date.parse(receipt.recordedAt)) {
    throw new Error("Trusted reference projection cannot predate the committed completeness receipt.");
  }
  if (Date.parse(request.projectedAt) >= Date.parse(receipt.freshUntil)) {
    throw new Error("Trusted reference projection requires a fresh half-open completeness window.");
  }

  const sourceFacts: ArtifactReferenceSourceFacts = {
    workflowRun: decoded.selectedLineage.facts.workflowRun,
    manifests: decoded.selectedLineage.facts.manifests,
    promotions: decoded.selectedLineage.facts.promotions,
    evidenceUses: decoded.selectedLineage.facts.evidenceUses,
    manifestEvidenceUses: decoded.selectedLineage.facts.manifestEvidenceUses,
    evidenceUseEnds: decoded.selectedLineage.facts.evidenceUseEnds,
    availability: decoded.selectedLineage.facts.availability.map((availability) => createFixtureArtifactManifestAvailability({
      manifestId: availability.manifestId,
      availabilityVersion: "artifact-manifest-availability-v1",
      state: availability.state,
      checkedAt: availability.checkedAt,
      validThrough: availability.validThrough,
      expiresAt: availability.expiresAt,
      checkerKind: "FIXTURE",
    })),
  };
  const snapshot = createFixtureArtifactReferenceSnapshotReceipt({
    snapshotCapturedAt: receipt.snapshotCapturedAt,
    freshUntil: receipt.freshUntil,
    sourceFacts,
  });
  const basisProjection = createArtifactReferenceProjection({
    projectionVersion: ARTIFACT_REFERENCE_PROJECTION_VERSION,
    projectionId: request.projectionId,
    businessId: receipt.businessId,
    lineageRootManifestId: receipt.lineageRootManifestId,
    projectedAt: request.projectedAt,
    mode: "SHADOW",
    projectorKind: "FIXTURE",
    maxCostUsd: 0,
    sourceFacts,
    snapshot,
  });
  const referenceState = basisProjection.activeUseCount === 0
    ? "NO_CURRENT_REFERENCES"
    : basisProjection.ambiguousUseCount > 0 || basisProjection.unassignedUseCount > 0
      ? "INDETERMINATE"
      : basisProjection.requiredRetentionClass === "LEGAL_HOLD"
        ? "LEGAL_HOLD_ACTIVE"
        : "ACTIVE_REFERENCES";
  const core = TrustedProjectionCoreSchema.parse({
    projectionVersion: request.projectionVersion,
    projectorVersion: ARTIFACT_REFERENCE_TRUSTED_PROJECTOR_VERSION,
    projectionId: request.projectionId,
    businessId: receipt.businessId,
    workflowRunId: receipt.workflowRunId,
    lineageRootManifestId: receipt.lineageRootManifestId,
    projectedAt: request.projectedAt,
    snapshotCapturedAt: receipt.snapshotCapturedAt,
    freshUntil: receipt.freshUntil,
    completenessReceiptId: receipt.receiptId,
    completenessReceiptDigest: receipt.receiptDigest,
    sourceFactsDigest: receipt.sourceFactsDigest,
    basisProjectionSourceFactsDigest: snapshot.sourceFactsDigest,
    executorVersion: execution.executorVersion,
    executionDigest: execution.executionDigest,
    basisProjectionDigest: basisProjection.projectionDigest,
    referenceState,
    activeUseCount: basisProjection.activeUseCount,
    endedUseCount: basisProjection.endedUseCount,
    ambiguousUseCount: basisProjection.ambiguousUseCount,
    unassignedUseCount: basisProjection.unassignedUseCount,
    requiredRetentionClass: basisProjection.requiredRetentionClass,
    noCurrentReferencesObserved: referenceState === "NO_CURRENT_REFERENCES",
    manualReviewRequired: referenceState === "INDETERMINATE",
  });
  return ArtifactReferenceTrustedProjectionSchema.parse({
    ...core,
    projectionDigest: artifactReferenceDigest({ core, basisProjection }),
    basisProjection,
    lineageReplayComplete: true,
    executionPath: "FRESH_COMMIT",
    sourceRowsMaterialized: true,
    committedReceiptReloaded: true,
    transactionallyTrustedSource: true,
    snapshotComplete: true,
    completenessAssurance: "D1_ATOMIC_RECHECK_AND_RELOAD",
    availabilityAssurance: "R2_HEAD_PER_MANIFEST",
    projectionClockAssurance: "CALLER_ASSERTED_FIXTURE_ONLY",
    validOnlyForExecutionDigest: true,
    requiresFreshReferenceCheck: true,
    retentionConclusionAuthorized: false,
    projectionPersistenceAuthorized: false,
    projectionPersistencePerformed: false,
    releaseAuthorized: false,
    deletionAuthorized: false,
    providerDeleteAuthorized: false,
    providerDeletePerformed: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}
