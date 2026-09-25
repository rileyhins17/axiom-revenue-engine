import { z } from "zod";

import {
  ArtifactEvidenceUseSchema,
  ArtifactManifestSchema,
  ArtifactPromotionPlanSchema,
  ArtifactPromotionReceiptSchema,
  artifactManifestDigest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import { ArtifactManifestAvailabilityReceiptSchema } from "@/lib/revenue-engine/artifact-manifest-availability";
import {
  ArtifactEvidenceUseEndRecordSchema,
  ArtifactManifestEvidenceUseLinkSchema,
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION,
  FixtureWebsiteEvidenceDefinitionDescriptorSchema,
  FixtureWorkflowDeliveryRecordSchema,
  FixtureWorkflowLeaseClaimSchema,
  FixtureWorkflowReceiptRevisionSchema,
} from "@/lib/revenue-engine/fixture-website-evidence-resume-plan";
import {
  FixtureWebsiteEvidenceWorkflowReceiptSchema,
  FixtureWebsiteEvidenceWorkflowRequestSchema,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const StoredTimestampSchema = z.string().trim().min(1);
const JsonSchema = z.string().trim().min(2);
const ZeroSchema = z.literal(0);
const OneSchema = z.literal(1);

export const RevenueWorkflowRunRowSchema = z.object({
  id: z.string().uuid(), workflowKind: z.literal("WEBSITE_EVIDENCE"), workflowVersion: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(8), businessId: z.string().trim().min(1), mode: z.literal("SHADOW"),
  orchestratorKind: z.literal("FIXTURE"), requestDigest: Sha256Schema, requestJson: JsonSchema,
  maxCostUsd: ZeroSchema, requestedAt: StoredTimestampSchema, createdAt: StoredTimestampSchema,
}).strict();

export const RevenueWorkflowDefinitionRowSchema = z.object({
  id: Sha256Schema, workflowKind: z.literal("WEBSITE_EVIDENCE"), definitionVersion: z.string().trim().min(1),
  definitionDigest: Sha256Schema, definitionJson: JsonSchema, createdAt: StoredTimestampSchema,
}).strict();

export const RevenueWorkflowDeliveryRowSchema = z.object({
  id: z.string().trim().min(8), workflowRunId: z.string().uuid(), definitionId: Sha256Schema,
  deliveryVersion: z.string().trim().min(1), workflowVersion: z.string().trim().min(1), requestDigest: Sha256Schema,
  payloadDigest: Sha256Schema, deliveryDigest: Sha256Schema, deliveryJson: JsonSchema, receivedAt: StoredTimestampSchema,
  mode: z.literal("SHADOW"), deliveryKind: z.literal("FIXTURE"), createdAt: StoredTimestampSchema,
}).strict();

export const RevenueWorkflowAttemptRowSchema = z.object({
  id: z.string().uuid(), workflowRunId: z.string().uuid(), definitionId: Sha256Schema, deliveryId: z.string().trim().min(8),
  attemptVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION), workflowVersion: z.string().trim().min(1),
  requestDigest: Sha256Schema, attemptNumber: z.number().int().min(1).max(10_000),
  fencingToken: z.number().int().min(1).max(2_147_483_647), startedAt: StoredTimestampSchema,
  attemptDigest: Sha256Schema, attemptJson: JsonSchema, createdAt: StoredTimestampSchema,
}).strict();

export const RevenueWorkflowLeaseRowSchema = z.object({
  id: z.string().uuid(), workflowRunId: z.string().uuid(), definitionId: Sha256Schema, attemptId: z.string().uuid(),
  deliveryId: z.string().trim().min(8), leaseVersion: z.string().trim().min(1), workflowVersion: z.string().trim().min(1),
  requestDigest: Sha256Schema, attemptNumber: z.number().int().min(1).max(10_000), ownerId: z.string().trim().min(1),
  fencingToken: z.number().int().min(1).max(2_147_483_647), acquiredAt: StoredTimestampSchema, expiresAt: StoredTimestampSchema,
  mode: z.literal("SHADOW"), leaseKind: z.literal("FIXTURE"), leaseDigest: Sha256Schema, leaseJson: JsonSchema,
  createdAt: StoredTimestampSchema,
}).strict();

export const RevenueWorkflowReceiptRevisionRowSchema = z.object({
  id: z.string().trim().min(1), workflowRunId: z.string().uuid(), definitionId: Sha256Schema, attemptId: z.string().uuid(),
  revisionVersion: z.string().trim().min(1), workflowVersion: z.string().trim().min(1), requestDigest: Sha256Schema,
  attemptNumber: z.number().int().min(1).max(10_000), status: z.enum(["COMPLETED", "PARTIAL", "FAILED"]),
  receiptDigest: Sha256Schema, receiptJson: JsonSchema, recordedAt: StoredTimestampSchema, createdAt: StoredTimestampSchema,
}).strict();

export const RevenueWorkflowAttemptClosureRowSchema = z.object({
  id: z.string().trim().min(1), workflowRunId: z.string().uuid(), attemptId: z.string().uuid(),
  status: z.enum(["FAILED", "SEALED", "ABANDONED"]), endedAt: StoredTimestampSchema,
  terminalReceiptId: z.string().trim().min(1).nullable(), closureDigest: Sha256Schema, closureJson: JsonSchema,
  effectiveAt: StoredTimestampSchema, createdAt: StoredTimestampSchema,
}).strict();

export const RevenueArtifactManifestRowSchema = z.object({
  id: z.string().uuid(), workflowRunId: z.string().uuid(), manifestVersion: z.string().trim().min(1),
  retentionClass: z.enum(["SHADOW_30D", "QUALIFICATION_180D", "OUTREACH_ACTIVE", "LEGAL_HOLD"]),
  provenanceReceiptType: z.enum(["ARTIFACT_WRITE", "ARTIFACT_PROMOTION"]), provenanceReceiptId: z.string().uuid(),
  verifiedAt: StoredTimestampSchema, manifestDigest: Sha256Schema, manifestJson: JsonSchema, createdAt: StoredTimestampSchema,
}).strict();

export const RevenueArtifactManifestItemRowSchema = z.object({
  id: z.string().trim().min(1), manifestId: z.string().uuid(), kind: z.enum(["BROWSER_SCREENSHOT", "BROWSER_MEASUREMENT"]),
  artifactRef: z.string().regex(/^artifact:sha256:[a-f0-9]{64}$/), objectKey: z.string().trim().min(1),
  byteLength: z.number().int().positive(), sha256: Sha256Schema, etag: z.string().trim().min(1),
  uploadedAt: StoredTimestampSchema, createdAt: StoredTimestampSchema,
}).strict();

export const RevenueArtifactPromotionRowSchema = z.object({
  id: z.string().uuid(), workflowRunId: z.string().uuid(), businessId: z.string().trim().min(1),
  sourceManifestId: z.string().uuid(), resultManifestId: z.string().uuid().nullable(), contractVersion: z.string().trim().min(1),
  sourceRetentionClass: z.enum(["SHADOW_30D", "QUALIFICATION_180D", "OUTREACH_ACTIVE", "LEGAL_HOLD"]),
  targetRetentionClass: z.enum(["SHADOW_30D", "QUALIFICATION_180D", "OUTREACH_ACTIVE", "LEGAL_HOLD"]),
  action: z.enum(["NO_COPY_REQUIRED", "COPY_REQUIRED"]), outcome: z.enum(["COMPLETED", "FAILED"]),
  planDigest: Sha256Schema, receiptDigest: Sha256Schema, planJson: JsonSchema, receiptJson: JsonSchema,
  providerCopyPerformed: ZeroSchema, costUsd: ZeroSchema, completedAt: StoredTimestampSchema, createdAt: StoredTimestampSchema,
}).strict();

export const RevenueArtifactPromotionUseRowSchema = z.object({
  id: z.string().trim().min(1), promotionId: z.string().uuid(), evidenceUseId: z.string().uuid(), createdAt: StoredTimestampSchema,
}).strict();

export const RevenueArtifactManifestUseRowSchema = z.object({
  id: z.string().trim().min(1), manifestId: z.string().uuid(), evidenceUseId: z.string().uuid(),
  viaPromotionId: z.string().uuid(), linkedAt: StoredTimestampSchema, createdAt: StoredTimestampSchema,
}).strict();

export const RevenueArtifactEvidenceUseRowSchema = z.object({
  id: z.string().uuid(), businessId: z.string().trim().min(1),
  useType: z.enum(["QUALIFICATION_SNAPSHOT", "OUTREACH_APPROVAL", "CONSENT_EVIDENCE", "OUTREACH_TOUCH", "LEGAL_HOLD"]),
  recordId: z.string().trim().min(1), recordVersion: z.string().trim().min(1), recordedAt: StoredTimestampSchema,
  createdAt: StoredTimestampSchema,
}).strict();

export const RevenueArtifactEvidenceUseEndRowSchema = z.object({
  id: z.string().uuid(), endVersion: z.string().trim().min(1), evidenceUseId: z.string().uuid(), businessId: z.string().trim().min(1),
  useType: z.enum(["QUALIFICATION_SNAPSHOT", "OUTREACH_APPROVAL", "CONSENT_EVIDENCE", "OUTREACH_TOUCH", "LEGAL_HOLD"]),
  useDigest: Sha256Schema, endedAt: StoredTimestampSchema, recordedAt: StoredTimestampSchema,
  reasonCode: z.enum(["RECORD_RETENTION_COMPLETE", "REPLACED_BY_EVIDENCE_USE", "LEGAL_HOLD_CLEARED"]),
  basisType: z.enum(["OWNER_RETENTION_REVIEW", "EVIDENCE_USE_REPLACEMENT", "LEGAL_CLEARANCE"]),
  basisRecordId: z.string().trim().min(1), basisRecordVersion: z.string().trim().min(1), basisDigest: Sha256Schema,
  replacementEvidenceUseId: z.string().uuid().nullable(), replacementEvidenceUseVersion: z.string().trim().min(1).nullable(),
  replacementEvidenceUseDigest: Sha256Schema.nullable(), actorUserId: z.string().trim().min(1), actorRole: z.enum(["OWNER", "COMPLIANCE"]),
  mode: z.literal("SHADOW"), recorderKind: z.literal("FIXTURE"), endDigest: Sha256Schema, endJson: JsonSchema,
  requiresRetentionReview: OneSchema, releaseAuthorized: ZeroSchema, deletionAuthorized: ZeroSchema,
  providerDeleteAuthorized: ZeroSchema, providerDeletePerformed: ZeroSchema, costUsd: ZeroSchema,
  createdAt: StoredTimestampSchema,
}).strict();

export const RevenueArtifactAvailabilityRowSchema = z.object({
  id: z.string().uuid(), availabilityVersion: z.literal("artifact-manifest-availability-v2"), manifestId: z.string().uuid(),
  state: z.enum(["VERIFIED_PRESENT", "MISSING", "UNKNOWN"]), checkedAt: StoredTimestampSchema,
  validThrough: StoredTimestampSchema, expiresAt: StoredTimestampSchema.nullable(), checkerKind: z.enum(["FIXTURE", "R2_HEAD"]),
  objectSetDigest: Sha256Schema, receiptDigest: Sha256Schema, receiptJson: JsonSchema, providerReadPerformed: z.union([ZeroSchema, OneSchema]),
  providerOperationsAuthorized: ZeroSchema, releaseAuthorized: ZeroSchema, deletionAuthorized: ZeroSchema, costUsd: ZeroSchema,
  createdAt: StoredTimestampSchema,
}).strict();

const AttemptIdentitySchema = z.object({
  attemptVersion: z.literal(FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION), attemptId: z.string().uuid(), workflowId: z.string().uuid(),
  workflowVersion: z.string().trim().min(1), definitionDigest: Sha256Schema, requestDigest: Sha256Schema,
  deliveryId: z.string().trim().min(8), attemptNumber: z.number().int().min(1).max(10_000),
  fencingToken: z.number().int().min(1).max(2_147_483_647), startedAt: z.string().datetime({ offset: true }),
}).strict();

const AttemptClosureSchema = z.object({
  attemptId: z.string().uuid(), status: z.enum(["FAILED", "SEALED", "ABANDONED"]),
  endedAt: z.string().datetime({ offset: true }), terminalReceiptId: z.string().trim().min(1).nullable(),
}).strict();

function parseCanonicalJson<T>(json: string, schema: z.ZodType<T>, label: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
  const parsed = schema.parse(raw);
  if (json !== artifactReferenceCanonicalJson(parsed)) throw new Error(`${label} is not exact canonical JSON.`);
  return parsed;
}

function assertMirror(label: string, row: Record<string, unknown>, expected: Record<string, unknown>) {
  for (const [column, value] of Object.entries(expected)) {
    if (row[column] !== value) throw new Error(`${label} column ${column} does not match its canonical domain payload.`);
  }
}

export function decodeWorkflowRunRow(value: unknown) {
  const row = RevenueWorkflowRunRowSchema.parse(value);
  const request = parseCanonicalJson(row.requestJson, FixtureWebsiteEvidenceWorkflowRequestSchema, `Workflow run ${row.id}`);
  assertMirror(`Workflow run ${row.id}`, row, {
    id: request.workflowId, workflowVersion: request.workflowVersion, idempotencyKey: request.idempotencyKey,
    businessId: request.businessId, mode: request.mode, orchestratorKind: request.orchestratorKind,
    requestDigest: artifactReferenceDigest(request), maxCostUsd: request.maxCostUsd, requestedAt: request.requestedAt,
  });
  return { row, request };
}

export function decodeWorkflowDefinitionRow(value: unknown) {
  const row = RevenueWorkflowDefinitionRowSchema.parse(value);
  const definition = parseCanonicalJson(row.definitionJson, FixtureWebsiteEvidenceDefinitionDescriptorSchema, `Workflow definition ${row.id}`);
  assertMirror(`Workflow definition ${row.id}`, row, {
    id: definition.definitionDigest, definitionVersion: definition.descriptorVersion, definitionDigest: definition.definitionDigest,
  });
  return { row, definition };
}

export function decodeWorkflowDeliveryRow(value: unknown) {
  const row = RevenueWorkflowDeliveryRowSchema.parse(value);
  const delivery = parseCanonicalJson(row.deliveryJson, FixtureWorkflowDeliveryRecordSchema, `Workflow delivery ${row.id}`);
  assertMirror(`Workflow delivery ${row.id}`, row, {
    id: delivery.deliveryId, workflowRunId: delivery.workflowId, definitionId: delivery.definitionDigest,
    deliveryVersion: delivery.deliveryVersion, workflowVersion: delivery.workflowVersion, requestDigest: delivery.requestDigest,
    payloadDigest: delivery.payloadDigest, deliveryDigest: artifactReferenceDigest(delivery), receivedAt: delivery.receivedAt,
    mode: delivery.mode, deliveryKind: delivery.deliveryKind,
  });
  return { row, delivery };
}

export function decodeWorkflowAttemptRow(value: unknown) {
  const row = RevenueWorkflowAttemptRowSchema.parse(value);
  const identity = parseCanonicalJson(row.attemptJson, AttemptIdentitySchema, `Workflow attempt ${row.id}`);
  assertMirror(`Workflow attempt ${row.id}`, row, {
    id: identity.attemptId, workflowRunId: identity.workflowId, definitionId: identity.definitionDigest,
    deliveryId: identity.deliveryId, attemptVersion: identity.attemptVersion, workflowVersion: identity.workflowVersion,
    requestDigest: identity.requestDigest, attemptNumber: identity.attemptNumber, fencingToken: identity.fencingToken,
    startedAt: identity.startedAt, attemptDigest: artifactReferenceDigest(identity),
  });
  return { row, identity };
}

export function decodeWorkflowLeaseRow(value: unknown) {
  const row = RevenueWorkflowLeaseRowSchema.parse(value);
  const lease = parseCanonicalJson(row.leaseJson, FixtureWorkflowLeaseClaimSchema, `Workflow lease ${row.id}`);
  assertMirror(`Workflow lease ${row.id}`, row, {
    id: lease.leaseId, workflowRunId: lease.workflowId, definitionId: lease.definitionDigest,
    attemptId: lease.attemptId, deliveryId: lease.deliveryId, leaseVersion: lease.leaseVersion,
    workflowVersion: lease.workflowVersion, requestDigest: lease.requestDigest, attemptNumber: lease.attemptNumber,
    ownerId: lease.ownerId, fencingToken: lease.fencingToken, acquiredAt: lease.acquiredAt, expiresAt: lease.expiresAt,
    mode: lease.mode, leaseKind: lease.leaseKind, leaseDigest: artifactReferenceDigest(lease),
  });
  return { row, lease };
}

export function decodeWorkflowReceiptRevisionRow(value: unknown) {
  const row = RevenueWorkflowReceiptRevisionRowSchema.parse(value);
  const receipt = parseCanonicalJson(row.receiptJson, FixtureWebsiteEvidenceWorkflowReceiptSchema, `Workflow receipt revision ${row.id}`);
  const revision = FixtureWorkflowReceiptRevisionSchema.parse({
    revisionVersion: row.revisionVersion, receiptId: row.id, workflowId: row.workflowRunId,
    workflowVersion: row.workflowVersion, definitionDigest: row.definitionId, requestDigest: row.requestDigest,
    attemptId: row.attemptId, attemptNumber: row.attemptNumber, receiptDigest: row.receiptDigest,
    receipt, recordedAt: row.recordedAt,
  });
  assertMirror(`Workflow receipt revision ${row.id}`, row, {
    id: `workflow-receipt:${artifactReferenceDigest(receipt)}`, status: receipt.status,
    receiptDigest: artifactReferenceDigest(receipt),
  });
  return { row, revision, receipt };
}

export function decodeWorkflowAttemptClosureRow(value: unknown) {
  const row = RevenueWorkflowAttemptClosureRowSchema.parse(value);
  const closure = parseCanonicalJson(row.closureJson, AttemptClosureSchema, `Workflow attempt closure ${row.id}`);
  const closureDigest = artifactReferenceDigest(closure);
  assertMirror(`Workflow attempt closure ${row.id}`, row, {
    id: `workflow-attempt-closure:${closureDigest}`, workflowRunId: row.workflowRunId, attemptId: closure.attemptId,
    status: closure.status, endedAt: closure.endedAt, terminalReceiptId: closure.terminalReceiptId,
    closureDigest, effectiveAt: closure.endedAt,
  });
  return { row, closure };
}

export function decodeArtifactManifestRow(value: unknown) {
  const row = RevenueArtifactManifestRowSchema.parse(value);
  const manifest = parseCanonicalJson(row.manifestJson, ArtifactManifestSchema, `Artifact manifest ${row.id}`);
  assertMirror(`Artifact manifest ${row.id}`, row, {
    id: manifest.manifestId, workflowRunId: manifest.workflowId, manifestVersion: manifest.manifestVersion,
    retentionClass: manifest.retentionClass, provenanceReceiptType: manifest.provenance.receiptType,
    provenanceReceiptId: manifest.provenance.receiptId, verifiedAt: manifest.verifiedAt,
    manifestDigest: artifactManifestDigest(manifest),
  });
  return { row, manifest };
}

export function decodeArtifactManifestItemRow(value: unknown) {
  const row = RevenueArtifactManifestItemRowSchema.parse(value);
  const item = {
    kind: row.kind, artifactRef: row.artifactRef, objectKey: row.objectKey, byteLength: row.byteLength,
    sha256: row.sha256, etag: row.etag, uploadedAt: row.uploadedAt,
  } as const;
  assertMirror(`Artifact manifest item ${row.id}`, row, { id: `${row.manifestId}:${row.kind}` });
  return { row, item };
}

export function decodeArtifactPromotionRow(value: unknown) {
  const row = RevenueArtifactPromotionRowSchema.parse(value);
  const plan = parseCanonicalJson(row.planJson, ArtifactPromotionPlanSchema, `Artifact promotion plan ${row.id}`);
  const receipt = parseCanonicalJson(row.receiptJson, ArtifactPromotionReceiptSchema, `Artifact promotion receipt ${row.id}`);
  assertMirror(`Artifact promotion ${row.id}`, row, {
    id: plan.promotionId, workflowRunId: plan.workflowId, businessId: plan.businessId,
    sourceManifestId: plan.sourceManifest.manifestId,
    resultManifestId: receipt.outcome === "COMPLETED" ? receipt.resultManifest.manifestId : null,
    contractVersion: receipt.contractVersion, sourceRetentionClass: receipt.sourceRetentionClass,
    targetRetentionClass: receipt.targetRetentionClass, action: receipt.action, outcome: receipt.outcome,
    planDigest: artifactReferenceDigest(plan), receiptDigest: artifactReferenceDigest(receipt),
    providerCopyPerformed: receipt.providerCopyPerformed ? 1 : 0, costUsd: receipt.costUsd, completedAt: receipt.completedAt,
  });
  if (
    receipt.promotionId !== plan.promotionId || receipt.workflowId !== plan.workflowId
    || receipt.sourceRetentionClass !== plan.sourceManifest.retentionClass
    || receipt.targetRetentionClass !== plan.targetRetentionClass || receipt.action !== plan.action
  ) throw new Error(`Artifact promotion ${row.id} plan and receipt identities do not match.`);
  return { row, plan, receipt };
}

export function decodeArtifactPromotionUseRow(value: unknown) {
  const row = RevenueArtifactPromotionUseRowSchema.parse(value);
  assertMirror(`Artifact promotion use ${row.id}`, row, { id: `${row.promotionId}:${row.evidenceUseId}` });
  return row;
}

export function decodeArtifactEvidenceUseRow(value: unknown) {
  const row = RevenueArtifactEvidenceUseRowSchema.parse(value);
  const use = ArtifactEvidenceUseSchema.parse({
    useId: row.id, useType: row.useType, recordId: row.recordId, recordVersion: row.recordVersion,
    businessId: row.businessId, recordedAt: row.recordedAt,
  });
  return { row, use };
}

export function decodeArtifactManifestUseRow(value: unknown, evidenceUse: unknown) {
  const row = RevenueArtifactManifestUseRowSchema.parse(value);
  assertMirror(`Artifact manifest use ${row.id}`, row, { id: `${row.manifestId}:${row.evidenceUseId}` });
  const link = ArtifactManifestEvidenceUseLinkSchema.parse({
    linkId: row.id, manifestId: row.manifestId, evidenceUse, viaPromotionId: row.viaPromotionId, linkedAt: row.linkedAt,
  });
  return { row, link };
}

export function decodeArtifactEvidenceUseEndRow(value: unknown) {
  const row = RevenueArtifactEvidenceUseEndRowSchema.parse(value);
  const record = parseCanonicalJson(row.endJson, ArtifactEvidenceUseEndRecordSchema, `Artifact evidence-use ending ${row.id}`);
  assertMirror(`Artifact evidence-use ending ${row.id}`, row, {
    id: record.endId, endVersion: record.endVersion, evidenceUseId: record.evidenceUseId, businessId: record.businessId,
    useType: record.useType, useDigest: record.useDigest, endedAt: record.endedAt, recordedAt: record.recordedAt,
    reasonCode: record.reasonCode, basisType: record.basis.basisType, basisRecordId: record.basis.basisRecordId,
    basisRecordVersion: record.basis.basisRecordVersion, basisDigest: record.basis.basisDigest,
    replacementEvidenceUseId: record.replacementEvidenceUseId, replacementEvidenceUseVersion: record.replacementEvidenceUseVersion,
    replacementEvidenceUseDigest: record.replacementEvidenceUseDigest, actorUserId: record.actor.actorUserId,
    actorRole: record.actor.role, mode: record.mode, recorderKind: record.recorderKind, endDigest: record.endDigest,
    requiresRetentionReview: record.requiresRetentionReview ? 1 : 0, releaseAuthorized: record.releaseAuthorized ? 1 : 0,
    deletionAuthorized: record.deletionAuthorized ? 1 : 0, providerDeleteAuthorized: record.providerDeleteAuthorized ? 1 : 0,
    providerDeletePerformed: record.providerDeletePerformed ? 1 : 0, costUsd: record.costUsd,
  });
  return { row, record };
}

export function decodeArtifactAvailabilityRow(value: unknown) {
  const row = RevenueArtifactAvailabilityRowSchema.parse(value);
  const receipt = parseCanonicalJson(row.receiptJson, ArtifactManifestAvailabilityReceiptSchema, `Artifact availability ${row.id}`);
  assertMirror(`Artifact availability ${row.id}`, row, {
    id: receipt.receiptId, availabilityVersion: receipt.availabilityVersion, manifestId: receipt.manifestId,
    state: receipt.state, checkedAt: receipt.checkedAt, validThrough: receipt.validThrough, expiresAt: receipt.expiresAt,
    checkerKind: receipt.checkerKind, objectSetDigest: receipt.objectSetDigest, receiptDigest: receipt.receiptDigest,
    providerReadPerformed: receipt.providerReadPerformed ? 1 : 0,
    providerOperationsAuthorized: receipt.providerOperationsAuthorized ? 1 : 0,
    releaseAuthorized: receipt.releaseAuthorized ? 1 : 0, deletionAuthorized: receipt.deletionAuthorized ? 1 : 0,
    costUsd: receipt.costUsd,
  });
  return { row, receipt };
}
