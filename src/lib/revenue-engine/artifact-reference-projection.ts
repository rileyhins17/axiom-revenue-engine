import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ArtifactEvidenceUseSchema,
  ArtifactEvidenceUseTypeSchema,
  ArtifactManifestSchema,
  ArtifactPromotionPlanSchema,
  ArtifactPromotionReceiptSchema,
  artifactManifestDigest,
  artifactManifestFromPromotionReceipt,
  type ArtifactEvidenceUse,
  type ArtifactManifest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  type ArtifactRetentionClass,
} from "@/lib/revenue-engine/content-addressed-artifact-store";

export const ARTIFACT_EVIDENCE_USE_END_VERSION = "artifact-evidence-use-end-v1";
export const ARTIFACT_REFERENCE_PROJECTION_VERSION = "artifact-reference-projection-v1";
export const ARTIFACT_REFERENCE_SNAPSHOT_VERSION = "artifact-reference-snapshot-v1";
export const ARTIFACT_REFERENCE_MAX_FRESHNESS_MS = 5 * 60 * 1_000;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RequiredRetentionClassSchema = z.enum(["QUALIFICATION_180D", "OUTREACH_ACTIVE", "LEGAL_HOLD"]);

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function artifactReferenceCanonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function artifactReferenceDigest(value: unknown) {
  return createHash("sha256").update(artifactReferenceCanonicalJson(value)).digest("hex");
}

function exactEqual(left: unknown, right: unknown) {
  return artifactReferenceCanonicalJson(left) === artifactReferenceCanonicalJson(right);
}

function requiredRetentionForUse(use: ArtifactEvidenceUse): z.infer<typeof RequiredRetentionClassSchema> {
  if (use.useType === "LEGAL_HOLD") return "LEGAL_HOLD";
  if (["OUTREACH_APPROVAL", "CONSENT_EVIDENCE", "OUTREACH_TOUCH"].includes(use.useType)) return "OUTREACH_ACTIVE";
  return "QUALIFICATION_180D";
}

const RETENTION_RANK: Record<ArtifactRetentionClass, number> = {
  SHADOW_30D: 0,
  QUALIFICATION_180D: 1,
  OUTREACH_ACTIVE: 2,
  LEGAL_HOLD: 3,
};

const EvidenceUseEndBasisSchema = z.object({
  basisType: z.enum(["OWNER_RETENTION_REVIEW", "EVIDENCE_USE_REPLACEMENT", "LEGAL_CLEARANCE"]),
  basisRecordId: z.string().trim().min(1).max(160),
  basisRecordVersion: z.string().trim().min(1).max(100),
  basisDigest: Sha256Schema,
}).strict();

const EvidenceUseEndActorSchema = z.object({
  actorUserId: z.string().trim().min(1).max(128),
  role: z.enum(["OWNER", "COMPLIANCE"]),
}).strict();

export const ArtifactEvidenceUseEndRequestSchema = z.object({
  endVersion: z.literal(ARTIFACT_EVIDENCE_USE_END_VERSION),
  endId: z.string().uuid(),
  endedUse: ArtifactEvidenceUseSchema,
  endedAt: z.string().datetime({ offset: true }),
  recordedAt: z.string().datetime({ offset: true }),
  reasonCode: z.enum(["RECORD_RETENTION_COMPLETE", "REPLACED_BY_EVIDENCE_USE", "LEGAL_HOLD_CLEARED"]),
  basis: EvidenceUseEndBasisSchema,
  replacementUse: ArtifactEvidenceUseSchema.nullable(),
  actor: EvidenceUseEndActorSchema,
  mode: z.literal("SHADOW"),
  recorderKind: z.literal("FIXTURE"),
  maxCostUsd: z.literal(0),
}).strict().superRefine((request, context) => {
  const endedMs = Date.parse(request.endedAt);
  if (endedMs < Date.parse(request.endedUse.recordedAt)) {
    context.addIssue({ code: "custom", message: "An evidence use cannot end before it was recorded.", path: ["endedAt"] });
  }
  if (Date.parse(request.recordedAt) < endedMs) {
    context.addIssue({ code: "custom", message: "An evidence-use ending cannot be recorded before it becomes effective.", path: ["recordedAt"] });
  }
  if (request.reasonCode === "REPLACED_BY_EVIDENCE_USE") {
    if (request.basis.basisType !== "EVIDENCE_USE_REPLACEMENT" || !request.replacementUse) {
      context.addIssue({ code: "custom", message: "Replacement endings require the exact replacement evidence use.", path: ["replacementUse"] });
    } else {
      if (request.replacementUse.useId === request.endedUse.useId) {
        context.addIssue({ code: "custom", message: "An evidence use cannot replace itself.", path: ["replacementUse", "useId"] });
      }
      if (request.replacementUse.businessId !== request.endedUse.businessId) {
        context.addIssue({ code: "custom", message: "Replacement evidence must belong to the same business.", path: ["replacementUse", "businessId"] });
      }
      if (Date.parse(request.replacementUse.recordedAt) > endedMs) {
        context.addIssue({ code: "custom", message: "Replacement evidence must exist when the prior use ends.", path: ["replacementUse", "recordedAt"] });
      }
      if (request.basis.basisRecordId !== request.replacementUse.useId) {
        context.addIssue({ code: "custom", message: "Replacement basis must identify the replacement evidence use.", path: ["basis", "basisRecordId"] });
      }
      if (
        request.basis.basisRecordVersion !== request.replacementUse.recordVersion
        || request.basis.basisDigest !== artifactReferenceDigest(request.replacementUse)
      ) {
        context.addIssue({ code: "custom", message: "Replacement basis must bind the exact replacement evidence-use version.", path: ["basis", "basisDigest"] });
      }
    }
  } else if (request.replacementUse !== null) {
    context.addIssue({ code: "custom", message: "Only replacement endings may carry replacement evidence.", path: ["replacementUse"] });
  }
  if (request.endedUse.useType === "LEGAL_HOLD") {
    if (request.reasonCode !== "LEGAL_HOLD_CLEARED" || request.basis.basisType !== "LEGAL_CLEARANCE" || request.actor.role !== "COMPLIANCE") {
      context.addIssue({ code: "custom", message: "A legal hold requires an explicit compliance clearance record.", path: ["reasonCode"] });
    }
  } else if (request.reasonCode === "LEGAL_HOLD_CLEARED" || request.basis.basisType === "LEGAL_CLEARANCE") {
    context.addIssue({ code: "custom", message: "Legal-clearance semantics apply only to a legal-hold use.", path: ["reasonCode"] });
  }
  if (request.reasonCode === "RECORD_RETENTION_COMPLETE" && request.basis.basisType !== "OWNER_RETENTION_REVIEW") {
    context.addIssue({ code: "custom", message: "Retention completion requires an owner/compliance review basis.", path: ["basis", "basisType"] });
  }
});

const ArtifactEvidenceUseEndCoreSchema = z.object({
  endVersion: z.literal(ARTIFACT_EVIDENCE_USE_END_VERSION),
  endId: z.string().uuid(),
  evidenceUseId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  useType: ArtifactEvidenceUseTypeSchema,
  useDigest: Sha256Schema,
  endedAt: z.string().datetime({ offset: true }),
  recordedAt: z.string().datetime({ offset: true }),
  reasonCode: z.enum(["RECORD_RETENTION_COMPLETE", "REPLACED_BY_EVIDENCE_USE", "LEGAL_HOLD_CLEARED"]),
  basis: EvidenceUseEndBasisSchema,
  replacementEvidenceUseId: z.string().uuid().nullable(),
  replacementEvidenceUseVersion: z.string().trim().min(1).max(100).nullable(),
  replacementEvidenceUseDigest: Sha256Schema.nullable(),
  actor: EvidenceUseEndActorSchema,
  mode: z.literal("SHADOW"),
  recorderKind: z.literal("FIXTURE"),
});

export const ArtifactEvidenceUseEndRecordSchema = ArtifactEvidenceUseEndCoreSchema.extend({
  endDigest: Sha256Schema,
  requiresRetentionReview: z.literal(true),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  providerDeleteAuthorized: z.literal(false),
  providerDeletePerformed: z.literal(false),
  costUsd: z.literal(0),
}).strict().superRefine((record, context) => {
  const core = ArtifactEvidenceUseEndCoreSchema.parse({
    endVersion: record.endVersion,
    endId: record.endId,
    evidenceUseId: record.evidenceUseId,
    businessId: record.businessId,
    useType: record.useType,
    useDigest: record.useDigest,
    endedAt: record.endedAt,
    recordedAt: record.recordedAt,
    reasonCode: record.reasonCode,
    basis: record.basis,
    replacementEvidenceUseId: record.replacementEvidenceUseId,
    replacementEvidenceUseVersion: record.replacementEvidenceUseVersion,
    replacementEvidenceUseDigest: record.replacementEvidenceUseDigest,
    actor: record.actor,
    mode: record.mode,
    recorderKind: record.recorderKind,
  });
  if (record.endDigest !== artifactReferenceDigest(core)) {
    context.addIssue({ code: "custom", message: "Evidence-use ending digest must bind the exact ending.", path: ["endDigest"] });
  }
  if (Date.parse(record.recordedAt) < Date.parse(record.endedAt)) {
    context.addIssue({ code: "custom", message: "An ending cannot be recorded before its effective time.", path: ["recordedAt"] });
  }
  const replacementFieldsPresent = record.replacementEvidenceUseId !== null
    && record.replacementEvidenceUseVersion !== null
    && record.replacementEvidenceUseDigest !== null;
  const replacementFieldsAbsent = record.replacementEvidenceUseId === null
    && record.replacementEvidenceUseVersion === null
    && record.replacementEvidenceUseDigest === null;
  if (record.reasonCode === "REPLACED_BY_EVIDENCE_USE") {
    if (
      record.basis.basisType !== "EVIDENCE_USE_REPLACEMENT"
      || !replacementFieldsPresent
      || record.basis.basisRecordId !== record.replacementEvidenceUseId
      || record.basis.basisRecordVersion !== record.replacementEvidenceUseVersion
      || record.basis.basisDigest !== record.replacementEvidenceUseDigest
      || record.replacementEvidenceUseId === record.evidenceUseId
    ) {
      context.addIssue({ code: "custom", message: "Replacement ending must bind the exact replacement identity, version, and digest.", path: ["replacementEvidenceUseId"] });
    }
  } else if (!replacementFieldsAbsent) {
    context.addIssue({ code: "custom", message: "Only replacement endings may bind replacement evidence.", path: ["replacementEvidenceUseId"] });
  }
  if (record.reasonCode === "RECORD_RETENTION_COMPLETE" && record.basis.basisType !== "OWNER_RETENTION_REVIEW") {
    context.addIssue({ code: "custom", message: "Retention completion requires an owner retention-review basis.", path: ["basis", "basisType"] });
  }
  if (record.useType === "LEGAL_HOLD") {
    if (record.reasonCode !== "LEGAL_HOLD_CLEARED" || record.basis.basisType !== "LEGAL_CLEARANCE" || record.actor.role !== "COMPLIANCE") {
      context.addIssue({ code: "custom", message: "Legal-hold ending records require explicit compliance clearance.", path: ["reasonCode"] });
    }
  } else if (record.reasonCode === "LEGAL_HOLD_CLEARED" || record.basis.basisType === "LEGAL_CLEARANCE") {
    context.addIssue({ code: "custom", message: "Only a legal hold may use legal-clearance semantics.", path: ["reasonCode"] });
  }
});

export type ArtifactEvidenceUseEndRecord = z.infer<typeof ArtifactEvidenceUseEndRecordSchema>;

export function createArtifactEvidenceUseEndRecord(value: unknown): ArtifactEvidenceUseEndRecord {
  const request = ArtifactEvidenceUseEndRequestSchema.parse(value);
  const core = ArtifactEvidenceUseEndCoreSchema.parse({
    endVersion: request.endVersion,
    endId: request.endId,
    evidenceUseId: request.endedUse.useId,
    businessId: request.endedUse.businessId,
    useType: request.endedUse.useType,
    useDigest: artifactReferenceDigest(request.endedUse),
    endedAt: request.endedAt,
    recordedAt: request.recordedAt,
    reasonCode: request.reasonCode,
    basis: request.basis,
    replacementEvidenceUseId: request.replacementUse?.useId || null,
    replacementEvidenceUseVersion: request.replacementUse?.recordVersion || null,
    replacementEvidenceUseDigest: request.replacementUse ? artifactReferenceDigest(request.replacementUse) : null,
    actor: request.actor,
    mode: request.mode,
    recorderKind: request.recorderKind,
  });
  return ArtifactEvidenceUseEndRecordSchema.parse({
    ...core,
    endDigest: artifactReferenceDigest(core),
    requiresRetentionReview: true,
    releaseAuthorized: false,
    deletionAuthorized: false,
    providerDeleteAuthorized: false,
    providerDeletePerformed: false,
    costUsd: 0,
  });
}

const ArtifactPromotionBundleSchema = z.object({
  plan: ArtifactPromotionPlanSchema,
  receipt: ArtifactPromotionReceiptSchema,
}).strict();

export const ArtifactManifestEvidenceUseLinkSchema = z.object({
  linkId: z.string().trim().min(1).max(300),
  manifestId: z.string().uuid(),
  evidenceUse: ArtifactEvidenceUseSchema,
  viaPromotionId: z.string().uuid(),
  linkedAt: z.string().datetime({ offset: true }),
}).strict();

const ArtifactManifestAvailabilityCoreSchema = z.object({
  manifestId: z.string().uuid(),
  availabilityVersion: z.literal("artifact-manifest-availability-v1"),
  state: z.enum(["VERIFIED_PRESENT", "MISSING", "UNKNOWN"]),
  checkedAt: z.string().datetime({ offset: true }),
  validThrough: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  checkerKind: z.literal("FIXTURE"),
}).strict();

export const ArtifactManifestAvailabilitySchema = ArtifactManifestAvailabilityCoreSchema.extend({
  receiptDigest: Sha256Schema,
}).strict().superRefine((availability, context) => {
  if (Date.parse(availability.validThrough) < Date.parse(availability.checkedAt)) {
    context.addIssue({ code: "custom", message: "Manifest availability cannot expire before it is checked.", path: ["validThrough"] });
  }
  const core = ArtifactManifestAvailabilityCoreSchema.parse({
    manifestId: availability.manifestId,
    availabilityVersion: availability.availabilityVersion,
    state: availability.state,
    checkedAt: availability.checkedAt,
    validThrough: availability.validThrough,
    expiresAt: availability.expiresAt,
    checkerKind: availability.checkerKind,
  });
  if (availability.receiptDigest !== artifactReferenceDigest(core)) {
    context.addIssue({ code: "custom", message: "Manifest availability digest must bind the complete availability receipt.", path: ["receiptDigest"] });
  }
});

export function createFixtureArtifactManifestAvailability(
  value: z.input<typeof ArtifactManifestAvailabilityCoreSchema>,
) {
  const core = ArtifactManifestAvailabilityCoreSchema.parse(value);
  return ArtifactManifestAvailabilitySchema.parse({ ...core, receiptDigest: artifactReferenceDigest(core) });
}

export const ArtifactReferenceWorkflowIdentitySchema = z.object({
  workflowRunId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  workflowKind: z.literal("WEBSITE_EVIDENCE"),
  workflowVersion: z.string().trim().min(1).max(100),
  requestDigest: Sha256Schema,
}).strict();

export const ArtifactReferenceSourceFactsSchema = z.object({
  workflowRun: ArtifactReferenceWorkflowIdentitySchema,
  manifests: z.array(ArtifactManifestSchema).min(1).max(100),
  promotions: z.array(ArtifactPromotionBundleSchema).max(200),
  evidenceUses: z.array(ArtifactEvidenceUseSchema).max(1_000),
  manifestEvidenceUses: z.array(ArtifactManifestEvidenceUseLinkSchema).max(1_000),
  evidenceUseEnds: z.array(ArtifactEvidenceUseEndRecordSchema).max(1_000),
  availability: z.array(ArtifactManifestAvailabilitySchema).min(1).max(100),
}).strict();

export type ArtifactReferenceSourceFacts = z.infer<typeof ArtifactReferenceSourceFactsSchema>;

const ArtifactReferenceSourceCountsSchema = z.object({
  manifests: z.number().int().min(1).max(100),
  promotions: z.number().int().nonnegative().max(200),
  manifestEvidenceUses: z.number().int().nonnegative().max(1_000),
  evidenceUses: z.number().int().nonnegative().max(1_000),
  evidenceUseEnds: z.number().int().nonnegative().max(1_000),
  availability: z.number().int().min(1).max(100),
}).strict();

export const ArtifactReferenceSnapshotReceiptSchema = z.object({
  snapshotVersion: z.literal(ARTIFACT_REFERENCE_SNAPSHOT_VERSION),
  snapshotCapturedAt: z.string().datetime({ offset: true }),
  freshUntil: z.string().datetime({ offset: true }),
  sourceKind: z.literal("FIXTURE_ASSERTED_SNAPSHOT"),
  snapshotComplete: z.literal(false),
  completenessAssurance: z.literal("FIXTURE_ASSERTED"),
  sourceCounts: ArtifactReferenceSourceCountsSchema,
  sourceFactsDigest: Sha256Schema,
}).strict().superRefine((receipt, context) => {
  if (Date.parse(receipt.freshUntil) < Date.parse(receipt.snapshotCapturedAt)) {
    context.addIssue({ code: "custom", message: "A reference snapshot cannot be stale when captured.", path: ["freshUntil"] });
  }
  if (Date.parse(receipt.freshUntil) - Date.parse(receipt.snapshotCapturedAt) > ARTIFACT_REFERENCE_MAX_FRESHNESS_MS) {
    context.addIssue({ code: "custom", message: "A fixture reference snapshot cannot claim more than five minutes of freshness.", path: ["freshUntil"] });
  }
});

export type ArtifactReferenceSnapshotReceipt = z.infer<typeof ArtifactReferenceSnapshotReceiptSchema>;

function uniqueUses(facts: ArtifactReferenceSourceFacts) {
  const uses = new Map<string, ArtifactEvidenceUse>();
  for (const use of facts.evidenceUses) {
    const existing = uses.get(use.useId);
    if (existing) throw new Error(`Evidence use ${use.useId} appears more than once in the asserted source set.`);
    uses.set(use.useId, use);
  }
  return [...uses.values()].sort((left, right) => left.useId.localeCompare(right.useId, "en-CA"));
}

function normalizedSourceFacts(value: unknown): ArtifactReferenceSourceFacts {
  const facts = ArtifactReferenceSourceFactsSchema.parse(value);
  return {
    workflowRun: facts.workflowRun,
    manifests: [...facts.manifests].sort((left, right) => left.manifestId.localeCompare(right.manifestId, "en-CA")),
    promotions: [...facts.promotions].sort((left, right) => left.plan.promotionId.localeCompare(right.plan.promotionId, "en-CA")),
    evidenceUses: [...facts.evidenceUses].sort((left, right) => left.useId.localeCompare(right.useId, "en-CA")),
    manifestEvidenceUses: [...facts.manifestEvidenceUses].sort((left, right) => left.linkId.localeCompare(right.linkId, "en-CA")),
    evidenceUseEnds: [...facts.evidenceUseEnds].sort((left, right) => left.endId.localeCompare(right.endId, "en-CA")),
    availability: [...facts.availability].sort((left, right) => left.manifestId.localeCompare(right.manifestId, "en-CA")),
  };
}

export function artifactReferenceSourceFactsDigest(value: unknown) {
  return artifactReferenceDigest(normalizedSourceFacts(value));
}

export function createFixtureArtifactReferenceSnapshotReceipt(value: {
  snapshotCapturedAt: string;
  freshUntil: string;
  sourceFacts: ArtifactReferenceSourceFacts;
}): ArtifactReferenceSnapshotReceipt {
  const facts = normalizedSourceFacts(value.sourceFacts);
  return ArtifactReferenceSnapshotReceiptSchema.parse({
    snapshotVersion: ARTIFACT_REFERENCE_SNAPSHOT_VERSION,
    snapshotCapturedAt: value.snapshotCapturedAt,
    freshUntil: value.freshUntil,
    sourceKind: "FIXTURE_ASSERTED_SNAPSHOT",
    snapshotComplete: false,
    completenessAssurance: "FIXTURE_ASSERTED",
    sourceCounts: {
      manifests: facts.manifests.length,
      promotions: facts.promotions.length,
      manifestEvidenceUses: facts.manifestEvidenceUses.length,
      evidenceUses: facts.evidenceUses.length,
      evidenceUseEnds: facts.evidenceUseEnds.length,
      availability: facts.availability.length,
    },
    sourceFactsDigest: artifactReferenceDigest(facts),
  });
}

export const ArtifactReferenceProjectionRequestSchema = z.object({
  projectionVersion: z.literal(ARTIFACT_REFERENCE_PROJECTION_VERSION),
  projectionId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  lineageRootManifestId: z.string().uuid(),
  projectedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  projectorKind: z.literal("FIXTURE"),
  maxCostUsd: z.literal(0),
  sourceFacts: ArtifactReferenceSourceFactsSchema,
  snapshot: ArtifactReferenceSnapshotReceiptSchema,
}).strict();

const ArtifactReferenceProjectionAssignmentCoreSchema = z.object({
  assignmentId: z.string().trim().min(1).max(300),
  projectionUseId: z.string().trim().min(1).max(300),
  manifestId: z.string().uuid(),
  manifestDigest: Sha256Schema,
  retentionClass: RequiredRetentionClassSchema,
  lineageDepth: z.number().int().min(0).max(100),
  assignmentKind: z.enum(["UNIQUE_CURRENT", "AMBIGUOUS_CURRENT"]),
}).strict();

export const ArtifactReferenceProjectionAssignmentSchema = ArtifactReferenceProjectionAssignmentCoreSchema.extend({
  assignmentDigest: Sha256Schema,
}).strict().superRefine((assignment, context) => {
  const core = ArtifactReferenceProjectionAssignmentCoreSchema.parse({
    assignmentId: assignment.assignmentId,
    projectionUseId: assignment.projectionUseId,
    manifestId: assignment.manifestId,
    manifestDigest: assignment.manifestDigest,
    retentionClass: assignment.retentionClass,
    lineageDepth: assignment.lineageDepth,
    assignmentKind: assignment.assignmentKind,
  });
  if (assignment.assignmentDigest !== artifactReferenceDigest(core)) {
    context.addIssue({ code: "custom", message: "Reference assignment digest must bind its exact content.", path: ["assignmentDigest"] });
  }
});

const ArtifactReferenceProjectionUseCoreSchema = z.object({
  projectionUseId: z.string().trim().min(1).max(300),
  evidenceUseId: z.string().uuid(),
  useDigest: Sha256Schema,
  state: z.enum(["ACTIVE", "ENDED", "INDETERMINATE"]),
  evidenceUseEndId: z.string().uuid().nullable(),
  requiredRetentionClass: RequiredRetentionClassSchema,
  assignmentState: z.enum(["UNIQUE", "AMBIGUOUS", "UNASSIGNED", "ENDED"]),
  currentCandidateCount: z.number().int().min(0).max(100),
}).strict();

export const ArtifactReferenceProjectionUseSchema = ArtifactReferenceProjectionUseCoreSchema.extend({
  rowDigest: Sha256Schema,
  assignments: z.array(ArtifactReferenceProjectionAssignmentSchema).max(100),
}).strict().superRefine((use, context) => {
  const core = ArtifactReferenceProjectionUseCoreSchema.parse({
    projectionUseId: use.projectionUseId,
    evidenceUseId: use.evidenceUseId,
    useDigest: use.useDigest,
    state: use.state,
    evidenceUseEndId: use.evidenceUseEndId,
    requiredRetentionClass: use.requiredRetentionClass,
    assignmentState: use.assignmentState,
    currentCandidateCount: use.currentCandidateCount,
  });
  if (use.rowDigest !== artifactReferenceDigest(core)) {
    context.addIssue({ code: "custom", message: "Projected-use digest must bind its exact content.", path: ["rowDigest"] });
  }
  if (use.assignments.length !== use.currentCandidateCount) {
    context.addIssue({ code: "custom", message: "Projected-use candidate count must match its assignments.", path: ["assignments"] });
  }
  if (use.state === "ENDED") {
    if (!use.evidenceUseEndId || use.assignmentState !== "ENDED" || use.currentCandidateCount !== 0) {
      context.addIssue({ code: "custom", message: "Ended uses cannot retain current assignments.", path: ["state"] });
    }
  } else if (use.evidenceUseEndId) {
    context.addIssue({ code: "custom", message: "Only ended uses can reference an ending record.", path: ["evidenceUseEndId"] });
  }
  const expectedState = use.currentCandidateCount === 0 ? "UNASSIGNED" : use.currentCandidateCount === 1 ? "UNIQUE" : "AMBIGUOUS";
  if (use.state !== "ENDED" && use.assignmentState !== expectedState) {
    context.addIssue({ code: "custom", message: "Assignment state must match the current candidate count.", path: ["assignmentState"] });
  }
});

const ArtifactReferenceProjectionCoreSchema = z.object({
  projectionVersion: z.literal(ARTIFACT_REFERENCE_PROJECTION_VERSION),
  projectionId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  lineageRootManifestId: z.string().uuid(),
  snapshotCapturedAt: z.string().datetime({ offset: true }),
  projectedAt: z.string().datetime({ offset: true }),
  freshUntil: z.string().datetime({ offset: true }),
  snapshotComplete: z.literal(false),
  completenessAssurance: z.literal("FIXTURE_ASSERTED"),
  sourceCounts: ArtifactReferenceSourceCountsSchema,
  sourceFactsDigest: Sha256Schema,
  state: z.enum(["ACTIVE_REFERENCES", "LEGAL_HOLD_ACTIVE", "NO_CURRENT_REFERENCES", "INDETERMINATE"]),
  activeUseCount: z.number().int().nonnegative().max(1_000),
  endedUseCount: z.number().int().nonnegative().max(1_000),
  ambiguousUseCount: z.number().int().nonnegative().max(1_000),
  unassignedUseCount: z.number().int().nonnegative().max(1_000),
  requiredRetentionClass: RequiredRetentionClassSchema.nullable(),
  unassignedManifestIds: z.array(z.string().uuid()).max(100),
}).strict();

export const ArtifactReferenceProjectionSchema = ArtifactReferenceProjectionCoreSchema.extend({
  projectionDigest: Sha256Schema,
  sourceFacts: ArtifactReferenceSourceFactsSchema,
  uses: z.array(ArtifactReferenceProjectionUseSchema).max(1_000),
  retentionReviewSuggested: z.boolean(),
  validOnlyForSourceFactsDigest: z.literal(true),
  requiresFreshReferenceCheck: z.literal(true),
  releaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  providerDeleteAuthorized: z.literal(false),
  providerDeletePerformed: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((projection, context) => {
  const core = ArtifactReferenceProjectionCoreSchema.parse({
    projectionVersion: projection.projectionVersion,
    projectionId: projection.projectionId,
    businessId: projection.businessId,
    lineageRootManifestId: projection.lineageRootManifestId,
    snapshotCapturedAt: projection.snapshotCapturedAt,
    projectedAt: projection.projectedAt,
    freshUntil: projection.freshUntil,
    snapshotComplete: projection.snapshotComplete,
    completenessAssurance: projection.completenessAssurance,
    sourceCounts: projection.sourceCounts,
    sourceFactsDigest: projection.sourceFactsDigest,
    state: projection.state,
    activeUseCount: projection.activeUseCount,
    endedUseCount: projection.endedUseCount,
    ambiguousUseCount: projection.ambiguousUseCount,
    unassignedUseCount: projection.unassignedUseCount,
    requiredRetentionClass: projection.requiredRetentionClass,
    unassignedManifestIds: projection.unassignedManifestIds,
  });
  if (projection.projectionDigest !== artifactReferenceDigest({ core, uses: projection.uses })) {
    context.addIssue({ code: "custom", message: "Reference projection digest must bind the exact projection and use assignments.", path: ["projectionDigest"] });
  }
  if (projection.sourceFactsDigest !== artifactReferenceSourceFactsDigest(projection.sourceFacts)) {
    context.addIssue({ code: "custom", message: "Reference projection source digest must bind all source facts.", path: ["sourceFactsDigest"] });
  }
  const sourceUses = uniqueUses(projection.sourceFacts);
  const expectedCounts = {
    manifests: projection.sourceFacts.manifests.length,
    promotions: projection.sourceFacts.promotions.length,
    manifestEvidenceUses: projection.sourceFacts.manifestEvidenceUses.length,
    evidenceUses: projection.sourceFacts.evidenceUses.length,
    evidenceUseEnds: projection.sourceFacts.evidenceUseEnds.length,
    availability: projection.sourceFacts.availability.length,
  };
  if (!exactEqual(projection.sourceCounts, expectedCounts)) {
    context.addIssue({ code: "custom", message: "Reference projection counts must match its exact source facts.", path: ["sourceCounts"] });
  }
  if (
    new Set(projection.uses.map((use) => use.projectionUseId)).size !== projection.uses.length
    || new Set(projection.uses.map((use) => use.evidenceUseId)).size !== projection.uses.length
  ) {
    context.addIssue({ code: "custom", message: "Projected evidence uses must have unique identities.", path: ["uses"] });
  }
  const active = projection.uses.filter((use) => use.state !== "ENDED");
  const ended = projection.uses.filter((use) => use.state === "ENDED");
  const ambiguous = active.filter((use) => use.assignmentState === "AMBIGUOUS");
  const unassigned = active.filter((use) => use.assignmentState === "UNASSIGNED");
  if (
    projection.activeUseCount !== active.length
    || projection.endedUseCount !== ended.length
    || projection.ambiguousUseCount !== ambiguous.length
    || projection.unassignedUseCount !== unassigned.length
    || projection.uses.length !== sourceUses.length
  ) {
    context.addIssue({ code: "custom", message: "Reference projection use counts must match its exact use rows.", path: ["activeUseCount"] });
  }
  const expectedRequired = active.length
    ? active.map((use) => use.requiredRetentionClass).sort((left, right) => RETENTION_RANK[right] - RETENTION_RANK[left])[0]
    : null;
  if (projection.requiredRetentionClass !== expectedRequired) {
    context.addIssue({ code: "custom", message: "Projection retention must be derived from active uses.", path: ["requiredRetentionClass"] });
  }
  const expectedState = ambiguous.length || unassigned.length || active.length === 0
    ? "INDETERMINATE"
    : expectedRequired === "LEGAL_HOLD"
      ? "LEGAL_HOLD_ACTIVE"
      : "ACTIVE_REFERENCES";
  if (projection.state !== expectedState || projection.retentionReviewSuggested) {
    context.addIssue({ code: "custom", message: "Projection state and review suggestion must match current use assignments.", path: ["state"] });
  }
  const manifests = new Map(projection.sourceFacts.manifests.map((manifest) => [manifest.manifestId, manifest]));
  const sourceUseById = new Map(sourceUses.map((use) => [use.useId, use]));
  const sourceEndByUse = new Map(projection.sourceFacts.evidenceUseEnds.map((ending) => [ending.evidenceUseId, ending]));
  const selected = new Set<string>();
  for (const [useIndex, use] of projection.uses.entries()) {
    const sourceUse = sourceUseById.get(use.evidenceUseId);
    const sourceEnd = sourceEndByUse.get(use.evidenceUseId);
    if (
      !sourceUse
      || use.useDigest !== (sourceUse ? artifactReferenceDigest(sourceUse) : "")
      || use.requiredRetentionClass !== (sourceUse ? requiredRetentionForUse(sourceUse) : use.requiredRetentionClass)
      || (sourceEnd ? use.evidenceUseEndId !== sourceEnd.endId || use.state !== "ENDED" : use.evidenceUseEndId !== null || use.state === "ENDED")
    ) {
      context.addIssue({ code: "custom", message: "Projected use must match its exact source use, ending, and retention policy.", path: ["uses", useIndex] });
    }
    for (const [assignmentIndex, assignment] of use.assignments.entries()) {
      const manifest = manifests.get(assignment.manifestId);
      if (
        assignment.projectionUseId !== use.projectionUseId
        || !manifest
        || assignment.manifestDigest !== (manifest ? artifactManifestDigest(manifest) : "")
        || assignment.retentionClass !== manifest?.retentionClass
        || RETENTION_RANK[assignment.retentionClass] < RETENTION_RANK[use.requiredRetentionClass]
      ) {
        context.addIssue({ code: "custom", message: "Projection assignment must match its use and exact sufficient manifest.", path: ["uses", useIndex, "assignments", assignmentIndex] });
      }
      selected.add(assignment.manifestId);
    }
    if (new Set(use.assignments.map((assignment) => assignment.manifestId)).size !== use.assignments.length) {
      context.addIssue({ code: "custom", message: "One projected use cannot assign the same manifest twice.", path: ["uses", useIndex, "assignments"] });
    }
  }
  const expectedUnassignedManifestIds = [...manifests.keys()].filter((id) => !selected.has(id)).sort((left, right) => left.localeCompare(right, "en-CA"));
  if (!exactEqual(projection.unassignedManifestIds, expectedUnassignedManifestIds)) {
    context.addIssue({ code: "custom", message: "Unassigned manifest IDs must be derived from current assignments.", path: ["unassignedManifestIds"] });
  }
});

export type ArtifactReferenceProjection = z.infer<typeof ArtifactReferenceProjectionSchema>;

function requireUniqueBy<T>(values: T[], keyOf: (value: T) => string, label: string) {
  const records = new Map<string, T>();
  for (const value of values) {
    const key = keyOf(value);
    const existing = records.get(key);
    if (existing) throw new Error(`${label} ${key} appears more than once in the asserted source set.`);
    records.set(key, value);
  }
  return records;
}

function validateSnapshot(facts: ArtifactReferenceSourceFacts, snapshot: ArtifactReferenceSnapshotReceipt) {
  const expected = createFixtureArtifactReferenceSnapshotReceipt({
    snapshotCapturedAt: snapshot.snapshotCapturedAt,
    freshUntil: snapshot.freshUntil,
    sourceFacts: facts,
  });
  if (!exactEqual(expected, snapshot)) throw new Error("Reference snapshot counts or source digest do not match its asserted fact set.");
}

function manifestAvailable(
  manifest: ArtifactManifest,
  availability: z.infer<typeof ArtifactManifestAvailabilitySchema>,
  projectedAt: string,
  freshUntil: string,
) {
  if (availability.state !== "VERIFIED_PRESENT") return false;
  if (Date.parse(availability.validThrough) < Date.parse(projectedAt)) return false;
  if (["SHADOW_30D", "QUALIFICATION_180D"].includes(manifest.retentionClass)) {
    return availability.expiresAt !== null
      && Date.parse(availability.expiresAt) > Date.parse(projectedAt)
      && Date.parse(availability.expiresAt) > Date.parse(freshUntil);
  }
  return availability.expiresAt === null;
}

export function createArtifactReferenceProjection(value: unknown): ArtifactReferenceProjection {
  const request = ArtifactReferenceProjectionRequestSchema.parse(value);
  const facts = normalizedSourceFacts(request.sourceFacts);
  validateSnapshot(facts, request.snapshot);
  if (Date.parse(request.projectedAt) < Date.parse(request.snapshot.snapshotCapturedAt)) {
    throw new Error("A reference projection cannot predate its asserted snapshot.");
  }
  if (Date.parse(request.projectedAt) > Date.parse(request.snapshot.freshUntil)) {
    throw new Error("A stale reference snapshot cannot create a current projection.");
  }

  const manifests = requireUniqueBy(facts.manifests, (manifest) => manifest.manifestId, "Manifest");
  const root = manifests.get(request.lineageRootManifestId);
  if (!root) throw new Error("Lineage root manifest is absent from the asserted snapshot.");
  const rootManifest = root;
  if (
    rootManifest.provenance.receiptType !== "ARTIFACT_WRITE"
    || rootManifest.retentionClass !== "SHADOW_30D"
    || rootManifest.provenance.receiptId !== rootManifest.manifestId
  ) {
    throw new Error("Lineage root must match the original SHADOW_30D ARTIFACT_WRITE manifest identity.");
  }
  if (facts.workflowRun.workflowRunId !== rootManifest.workflowId || facts.workflowRun.businessId !== request.businessId) {
    throw new Error("Lineage root does not match the exact workflow and business identity snapshot.");
  }
  if ([...manifests.values()].some((manifest) => manifest.workflowId !== facts.workflowRun.workflowRunId)) {
    throw new Error("Reference snapshot contains a manifest from another workflow.");
  }
  if ([...manifests.values()].some((manifest) => Date.parse(manifest.verifiedAt) > Date.parse(request.snapshot.snapshotCapturedAt))) {
    throw new Error("A lineage manifest cannot postdate the asserted snapshot.");
  }
  const availability = requireUniqueBy(facts.availability, (record) => record.manifestId, "Manifest availability");
  if (availability.size !== manifests.size || [...manifests.keys()].some((id) => !availability.has(id))) {
    throw new Error("Every lineage manifest requires exactly one availability fact.");
  }
  for (const [manifestId, record] of availability) {
    const manifest = manifests.get(manifestId);
    if (!manifest) throw new Error("Availability references a manifest outside the lineage snapshot.");
    if (Date.parse(record.checkedAt) < Date.parse(manifest.verifiedAt)) {
      throw new Error("Manifest availability cannot claim verification before the manifest existed.");
    }
    if (Date.parse(record.checkedAt) > Date.parse(request.snapshot.snapshotCapturedAt)) {
      throw new Error("Manifest availability cannot postdate the snapshot capture.");
    }
    if (Date.parse(record.validThrough) < Date.parse(request.snapshot.freshUntil)) {
      throw new Error("Every availability receipt must remain valid through the projection freshness window.");
    }
    if (["SHADOW_30D", "QUALIFICATION_180D"].includes(manifest.retentionClass) && record.expiresAt === null) {
      throw new Error("Expiring manifest classes require an exact expiry fact.");
    }
    if (["OUTREACH_ACTIVE", "LEGAL_HOLD"].includes(manifest.retentionClass) && record.expiresAt !== null) {
      throw new Error("Protected manifest classes cannot invent an automatic expiry.");
    }
  }

  const promotions = requireUniqueBy(facts.promotions, (bundle) => bundle.plan.promotionId, "Promotion");
  const completedResults = new Map<string, string>();
  const edges = new Map<string, string[]>();
  const depth = new Map<string, number>([[rootManifest.manifestId, 0]]);
  for (const bundle of promotions.values()) {
    const { plan, receipt } = bundle;
    if (plan.businessId !== request.businessId || plan.workflowId !== rootManifest.workflowId || receipt.workflowId !== rootManifest.workflowId) {
      throw new Error("Promotion lineage crosses its business or workflow boundary.");
    }
    if (
      receipt.promotionId !== plan.promotionId
      || receipt.sourceRetentionClass !== plan.sourceManifest.retentionClass
      || receipt.targetRetentionClass !== plan.targetRetentionClass
      || receipt.action !== plan.action
      || receipt.plannedItemCount !== plan.items.length
    ) {
      throw new Error("Promotion receipt does not match its exact plan identity and retention contract.");
    }
    if (
      Date.parse(plan.requestedAt) > Date.parse(receipt.startedAt)
      || Date.parse(receipt.completedAt) > Date.parse(request.snapshot.snapshotCapturedAt)
    ) {
      throw new Error("Promotion request and receipt times must be ordered within the asserted snapshot.");
    }
    for (const [index, receiptItem] of receipt.items.entries()) {
      const plannedItem = plan.items[index];
      if (
        !plannedItem
        || receiptItem.kind !== plannedItem.kind
        || receiptItem.artifactRef !== plannedItem.artifactRef
        || receiptItem.objectKey !== plannedItem.targetObjectKey
        || receiptItem.byteLength !== plannedItem.byteLength
        || receiptItem.sha256 !== plannedItem.sha256
      ) {
        throw new Error("Promotion receipt items do not match the exact plan prefix.");
      }
    }
    const source = manifests.get(plan.sourceManifest.manifestId);
    if (!source || !exactEqual(source, plan.sourceManifest)) throw new Error("Promotion source manifest is missing or divergent.");
    if (receipt.outcome === "COMPLETED") {
      const result = artifactManifestFromPromotionReceipt(plan, receipt);
      const storedResult = manifests.get(result.manifestId);
      if (!storedResult || !exactEqual(storedResult, result)) throw new Error("Completed promotion result manifest is missing or divergent.");
      const existingPromotion = completedResults.get(result.manifestId);
      if (result.manifestId !== source.manifestId && existingPromotion && existingPromotion !== plan.promotionId) {
        throw new Error("A promoted manifest cannot be produced by multiple completed promotions.");
      }
      if (result.manifestId !== source.manifestId) completedResults.set(result.manifestId, plan.promotionId);
      if (RETENTION_RANK[result.retentionClass] < RETENTION_RANK[source.retentionClass]) {
        throw new Error("Artifact retention lineage cannot decrease.");
      }
      if (result.manifestId !== source.manifestId) {
        edges.set(source.manifestId, [...(edges.get(source.manifestId) || []), result.manifestId]);
      }
    }
  }
  for (const manifest of manifests.values()) {
    if (manifest.manifestId === rootManifest.manifestId) continue;
    if (
      manifest.provenance.receiptType !== "ARTIFACT_PROMOTION"
      || completedResults.get(manifest.manifestId) !== manifest.provenance.receiptId
    ) {
      throw new Error("Every promoted lineage manifest requires its exact completed promotion and source chain.");
    }
  }

  let visiting = new Set<string>();
  const visited = new Set<string>();
  function walk(manifestId: string, currentDepth: number) {
    if (visiting.has(manifestId)) throw new Error("Artifact promotion lineage contains a cycle.");
    const previousDepth = depth.get(manifestId);
    if (previousDepth !== undefined && previousDepth !== currentDepth && manifestId !== rootManifest.manifestId) {
      throw new Error("Artifact promotion lineage gives one manifest multiple incompatible parents.");
    }
    depth.set(manifestId, currentDepth);
    if (visited.has(manifestId)) return;
    visiting.add(manifestId);
    for (const child of edges.get(manifestId) || []) walk(child, currentDepth + 1);
    visiting = new Set([...visiting].filter((id) => id !== manifestId));
    visited.add(manifestId);
  }
  walk(rootManifest.manifestId, 0);
  if (visited.size !== manifests.size) throw new Error("Reference snapshot contains a disconnected or multiple-root manifest lineage.");

  const links = requireUniqueBy(facts.manifestEvidenceUses, (link) => link.linkId, "Manifest evidence-use link");
  const uses = uniqueUses(facts);
  const useMap = new Map(uses.map((use) => [use.useId, use]));
  const linkPairs = new Set<string>();
  for (const link of links.values()) {
    const pair = `${link.manifestId}|${link.evidenceUse.useId}`;
    if (linkPairs.has(pair)) throw new Error(`Manifest evidence-use pair ${pair} appears more than once.`);
    linkPairs.add(pair);
    const manifest = manifests.get(link.manifestId);
    const promotion = promotions.get(link.viaPromotionId);
    const assertedUse = useMap.get(link.evidenceUse.useId);
    if (!manifest || !promotion || promotion.receipt.outcome !== "COMPLETED") {
      throw new Error("Manifest evidence use lacks its exact completed promotion lineage.");
    }
    const result = artifactManifestFromPromotionReceipt(promotion.plan, promotion.receipt);
    const promotedUse = promotion.plan.evidenceUses.find((use) => use.useId === link.evidenceUse.useId);
    if (!assertedUse || !exactEqual(assertedUse, link.evidenceUse)) {
      throw new Error("Manifest evidence use is absent or divergent from the explicit evidence-use source set.");
    }
    if (!exactEqual(result, manifest) || !promotedUse || !exactEqual(promotedUse, link.evidenceUse)) {
      throw new Error("Manifest evidence use does not match its promotion result and promotion-use fact.");
    }
    if (link.evidenceUse.businessId !== request.businessId || link.linkedAt !== promotion.receipt.completedAt) {
      throw new Error("Manifest evidence use crosses business identity or link time.");
    }
    if (Date.parse(link.linkedAt) > Date.parse(request.snapshot.snapshotCapturedAt)) {
      throw new Error("Manifest evidence-use link cannot postdate the snapshot.");
    }
  }
  for (const bundle of promotions.values()) {
    for (const promotedUse of bundle.plan.evidenceUses) {
      const assertedUse = useMap.get(promotedUse.useId);
      if (!assertedUse || !exactEqual(assertedUse, promotedUse)) {
        throw new Error("Every promotion evidence use must exist exactly in the explicit evidence-use source set.");
      }
      if (bundle.receipt.outcome === "COMPLETED") {
        const result = artifactManifestFromPromotionReceipt(bundle.plan, bundle.receipt);
        const linked = [...links.values()].some((link) => (
          link.manifestId === result.manifestId
          && link.evidenceUse.useId === promotedUse.useId
          && exactEqual(link.evidenceUse, promotedUse)
        ));
        if (!linked) {
          throw new Error("Every completed promotion use requires an exact result-manifest evidence-use link.");
        }
      }
    }
  }
  for (const use of uses) {
    if (use.businessId !== request.businessId || Date.parse(use.recordedAt) > Date.parse(request.snapshot.snapshotCapturedAt)) {
      throw new Error("Evidence uses must belong to the projection business and cannot postdate the asserted snapshot.");
    }
    if (![...links.values()].some((link) => link.evidenceUse.useId === use.useId)) {
      throw new Error("Every explicit evidence use requires at least one exact manifest link.");
    }
  }
  const ends = requireUniqueBy(facts.evidenceUseEnds, (ending) => ending.evidenceUseId, "Evidence-use ending");
  for (const ending of ends.values()) {
    const use = useMap.get(ending.evidenceUseId);
    if (!use || ending.businessId !== request.businessId || ending.useType !== use.useType || ending.useDigest !== artifactReferenceDigest(use)) {
      throw new Error("Evidence-use ending does not match an exact use in this lineage.");
    }
    if (Date.parse(ending.endedAt) < Date.parse(use.recordedAt)) {
      throw new Error("Evidence-use ending cannot predate its exact original use.");
    }
    if (ending.reasonCode === "REPLACED_BY_EVIDENCE_USE") {
      const replacement = ending.replacementEvidenceUseId ? useMap.get(ending.replacementEvidenceUseId) : undefined;
      if (
        !replacement
        || replacement.businessId !== ending.businessId
        || replacement.recordVersion !== ending.replacementEvidenceUseVersion
        || artifactReferenceDigest(replacement) !== ending.replacementEvidenceUseDigest
        || Date.parse(replacement.recordedAt) > Date.parse(ending.endedAt)
      ) {
        throw new Error("Replacement ending must bind an exact same-business replacement use present before the ending.");
      }
    }
    if (Date.parse(ending.recordedAt) > Date.parse(request.snapshot.snapshotCapturedAt)) {
      throw new Error("Evidence-use ending cannot postdate the asserted snapshot.");
    }
  }

  const projectedUses: z.infer<typeof ArtifactReferenceProjectionUseSchema>[] = [];
  const selectedManifestIds = new Set<string>();
  for (const use of uses) {
    const projectionUseId = `${request.projectionId}:${use.useId}`;
    const requiredRetentionClass = requiredRetentionForUse(use);
    const ending = ends.get(use.useId);
    if (ending) {
      const core = ArtifactReferenceProjectionUseCoreSchema.parse({
        projectionUseId,
        evidenceUseId: use.useId,
        useDigest: artifactReferenceDigest(use),
        state: "ENDED",
        evidenceUseEndId: ending.endId,
        requiredRetentionClass,
        assignmentState: "ENDED",
        currentCandidateCount: 0,
      });
      projectedUses.push(ArtifactReferenceProjectionUseSchema.parse({ ...core, rowDigest: artifactReferenceDigest(core), assignments: [] }));
      continue;
    }
    const candidates = [...links.values()]
      .filter((link) => link.evidenceUse.useId === use.useId)
      .map((link) => manifests.get(link.manifestId))
      .filter((manifest): manifest is ArtifactManifest => Boolean(manifest))
      .filter((manifest) => RETENTION_RANK[manifest.retentionClass] >= RETENTION_RANK[requiredRetentionClass])
      .filter((manifest) => manifestAvailable(
        manifest,
        availability.get(manifest.manifestId)!,
        request.projectedAt,
        request.snapshot.freshUntil,
      ));
    const minimumRank = candidates.length ? Math.min(...candidates.map((manifest) => RETENTION_RANK[manifest.retentionClass])) : null;
    const current = candidates
      .filter((manifest) => RETENTION_RANK[manifest.retentionClass] === minimumRank)
      .sort((left, right) => left.manifestId.localeCompare(right.manifestId, "en-CA"));
    const assignmentState = current.length === 0 ? "UNASSIGNED" : current.length === 1 ? "UNIQUE" : "AMBIGUOUS";
    const state = current.length === 0 ? "INDETERMINATE" : "ACTIVE";
    const core = ArtifactReferenceProjectionUseCoreSchema.parse({
      projectionUseId,
      evidenceUseId: use.useId,
      useDigest: artifactReferenceDigest(use),
      state,
      evidenceUseEndId: null,
      requiredRetentionClass,
      assignmentState,
      currentCandidateCount: current.length,
    });
    const assignmentKind = current.length === 1 ? "UNIQUE_CURRENT" : "AMBIGUOUS_CURRENT";
    const assignments = current.map((manifest) => {
      selectedManifestIds.add(manifest.manifestId);
      const assignmentCore = ArtifactReferenceProjectionAssignmentCoreSchema.parse({
        assignmentId: `${projectionUseId}:${manifest.manifestId}`,
        projectionUseId,
        manifestId: manifest.manifestId,
        manifestDigest: artifactManifestDigest(manifest),
        retentionClass: manifest.retentionClass,
        lineageDepth: depth.get(manifest.manifestId),
        assignmentKind,
      });
      return ArtifactReferenceProjectionAssignmentSchema.parse({
        ...assignmentCore,
        assignmentDigest: artifactReferenceDigest(assignmentCore),
      });
    });
    projectedUses.push(ArtifactReferenceProjectionUseSchema.parse({
      ...core,
      rowDigest: artifactReferenceDigest(core),
      assignments,
    }));
  }

  projectedUses.sort((left, right) => left.evidenceUseId.localeCompare(right.evidenceUseId, "en-CA"));
  const activeUses = projectedUses.filter((use) => use.state !== "ENDED");
  const endedUses = projectedUses.filter((use) => use.state === "ENDED");
  const ambiguousUseCount = activeUses.filter((use) => use.assignmentState === "AMBIGUOUS").length;
  const unassignedUseCount = activeUses.filter((use) => use.assignmentState === "UNASSIGNED").length;
  const requiredRetentionClass = activeUses.length
    ? activeUses.map((use) => use.requiredRetentionClass).sort((left, right) => RETENTION_RANK[right] - RETENTION_RANK[left])[0]
    : null;
  const state = ambiguousUseCount || unassignedUseCount || activeUses.length === 0
    ? "INDETERMINATE"
    : requiredRetentionClass === "LEGAL_HOLD"
      ? "LEGAL_HOLD_ACTIVE"
      : "ACTIVE_REFERENCES";
  const sourceCounts = request.snapshot.sourceCounts;
  const core = ArtifactReferenceProjectionCoreSchema.parse({
    projectionVersion: request.projectionVersion,
    projectionId: request.projectionId,
    businessId: request.businessId,
    lineageRootManifestId: request.lineageRootManifestId,
    snapshotCapturedAt: request.snapshot.snapshotCapturedAt,
    projectedAt: request.projectedAt,
    freshUntil: request.snapshot.freshUntil,
    snapshotComplete: false,
    completenessAssurance: "FIXTURE_ASSERTED",
    sourceCounts,
    sourceFactsDigest: request.snapshot.sourceFactsDigest,
    state,
    activeUseCount: activeUses.length,
    endedUseCount: endedUses.length,
    ambiguousUseCount,
    unassignedUseCount,
    requiredRetentionClass,
    unassignedManifestIds: [...manifests.keys()].filter((id) => !selectedManifestIds.has(id)).sort((left, right) => left.localeCompare(right, "en-CA")),
  });
  return ArtifactReferenceProjectionSchema.parse({
    ...core,
    projectionDigest: artifactReferenceDigest({ core, uses: projectedUses }),
    sourceFacts: facts,
    uses: projectedUses,
    retentionReviewSuggested: false,
    validOnlyForSourceFactsDigest: true,
    requiresFreshReferenceCheck: true,
    releaseAuthorized: false,
    deletionAuthorized: false,
    providerDeleteAuthorized: false,
    providerDeletePerformed: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

export function reproduceArtifactReferenceProjection(
  value: unknown,
  sourceFacts?: ArtifactReferenceSourceFacts,
): ArtifactReferenceProjection {
  const projection = ArtifactReferenceProjectionSchema.parse(value);
  return createArtifactReferenceProjection({
    projectionVersion: projection.projectionVersion,
    projectionId: projection.projectionId,
    businessId: projection.businessId,
    lineageRootManifestId: projection.lineageRootManifestId,
    projectedAt: projection.projectedAt,
    mode: "SHADOW",
    projectorKind: "FIXTURE",
    maxCostUsd: 0,
    sourceFacts: sourceFacts ?? projection.sourceFacts,
    snapshot: {
      snapshotVersion: ARTIFACT_REFERENCE_SNAPSHOT_VERSION,
      snapshotCapturedAt: projection.snapshotCapturedAt,
      freshUntil: projection.freshUntil,
      sourceKind: "FIXTURE_ASSERTED_SNAPSHOT",
      snapshotComplete: false,
      completenessAssurance: "FIXTURE_ASSERTED",
      sourceCounts: projection.sourceCounts,
      sourceFactsDigest: projection.sourceFactsDigest,
    },
  });
}

export function verifyArtifactReferenceProjectionCurrent(
  value: unknown,
  current: { checkedAt: string; sourceFacts: ArtifactReferenceSourceFacts },
) {
  const projection = ArtifactReferenceProjectionSchema.parse(value);
  const checkedAt = z.string().datetime({ offset: true }).parse(current.checkedAt);
  const currentSourceFactsDigest = artifactReferenceSourceFactsDigest(current.sourceFacts);
  const sourceFactsMatch = currentSourceFactsDigest === projection.sourceFactsDigest;
  let reproducesExactly = false;
  if (sourceFactsMatch) {
    try {
      reproducesExactly = exactEqual(reproduceArtifactReferenceProjection(projection, current.sourceFacts), projection);
    } catch {
      reproducesExactly = false;
    }
  }
  const state = Date.parse(checkedAt) < Date.parse(projection.projectedAt) || (sourceFactsMatch && !reproducesExactly)
    ? "CONFLICT"
    : Date.parse(checkedAt) > Date.parse(projection.freshUntil) || !sourceFactsMatch
      ? "STALE"
      : "CURRENT";
  return {
    state,
    sourceFactsMatch,
    reproducesExactly,
    withinFreshnessWindow: Date.parse(checkedAt) <= Date.parse(projection.freshUntil),
    sourceSnapshotTransactionallyComplete: false as const,
    retentionConclusionAuthorized: false as const,
    releaseAuthorized: false as const,
    deletionAuthorized: false as const,
    providerDeleteAuthorized: false as const,
  };
}
