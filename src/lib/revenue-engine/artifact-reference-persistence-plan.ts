import { createHash } from "node:crypto";

import { z } from "zod";

import { ArtifactEvidenceUseSchema } from "@/lib/revenue-engine/artifact-lifecycle";
import {
  ARTIFACT_REFERENCE_SNAPSHOT_VERSION,
  ArtifactEvidenceUseEndRecordSchema,
  ArtifactReferenceProjectionSchema,
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
  createArtifactReferenceProjection,
} from "@/lib/revenue-engine/artifact-reference-projection";

export const ARTIFACT_REFERENCE_PERSISTENCE_PLAN_VERSION = "artifact-reference-persistence-plan-v1";
export const ARTIFACT_REFERENCE_TARGET_SCHEMA_VERSION = "0058_artifact_reference_projections";

const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
type SqlValue = z.infer<typeof SqlValueSchema>;

const PersistenceEntitySchema = z.enum([
  "EVIDENCE_USE_END",
  "REFERENCE_PROJECTION",
  "REFERENCE_PROJECTION_USE",
  "REFERENCE_ASSIGNMENT",
]);
type PersistenceEntity = z.infer<typeof PersistenceEntitySchema>;

const PersistencePreflightSchema = z.object({
  preflightId: z.string().trim().min(1).max(500),
  entity: PersistenceEntitySchema,
  recordId: z.string().trim().min(1).max(400),
  selectSql: z.string().trim().min(1).max(10_000),
  bindings: z.array(SqlValueSchema).max(20),
  expected: z.record(z.string().trim().min(1).max(100), SqlValueSchema),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  rejectMultipleMatches: z.literal(true),
}).strict();

const PersistenceMutationSchema = z.object({
  statementId: z.string().trim().min(1).max(500),
  entity: PersistenceEntitySchema,
  recordId: z.string().trim().min(1).max(400),
  sql: z.string().trim().min(1).max(12_000),
  bindings: z.array(SqlValueSchema).max(50),
  operation: z.literal("INSERT_IF_ABSENT"),
}).strict();

const EvidenceUseEndBundleSchema = z.object({
  record: ArtifactEvidenceUseEndRecordSchema,
  evidenceUse: ArtifactEvidenceUseSchema,
}).strict();

export const ArtifactReferencePersistenceRequestSchema = z.object({
  persistencePlanVersion: z.literal(ARTIFACT_REFERENCE_PERSISTENCE_PLAN_VERSION),
  targetSchemaVersion: z.literal(ARTIFACT_REFERENCE_TARGET_SCHEMA_VERSION),
  plannedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  plannerKind: z.literal("FIXTURE"),
  maxCostUsd: z.literal(0),
  evidenceUseEnds: z.array(EvidenceUseEndBundleSchema).max(1_000),
  projections: z.array(ArtifactReferenceProjectionSchema).max(50),
}).strict().superRefine((request, context) => {
  if (request.evidenceUseEnds.length + request.projections.length === 0) {
    context.addIssue({ code: "custom", message: "Reference persistence requires at least one ending or projection.", path: ["projections"] });
  }
});

const SummarySchema = z.object({
  evidenceUseEnds: z.number().int().nonnegative().max(1_000),
  projections: z.number().int().nonnegative().max(50),
  projectionUses: z.number().int().nonnegative().max(50_000),
  assignments: z.number().int().nonnegative().max(5_000),
  totalStatements: z.number().int().positive().max(10_000),
  providerOperations: z.literal(0),
  costUsd: z.literal(0),
}).strict();

export const ArtifactReferencePersistencePlanSchema = z.object({
  persistencePlanVersion: z.literal(ARTIFACT_REFERENCE_PERSISTENCE_PLAN_VERSION),
  targetSchemaVersion: z.literal(ARTIFACT_REFERENCE_TARGET_SCHEMA_VERSION),
  plannedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  plannerKind: z.literal("FIXTURE"),
  maxCostUsd: z.literal(0),
  preflights: z.array(PersistencePreflightSchema).min(1).max(10_000),
  mutations: z.array(PersistenceMutationSchema).min(1).max(10_000),
  summary: SummarySchema,
  requiresCompleteSnapshot: z.literal(true),
  requiresExactPreflightMatch: z.literal(true),
  requiresFreshReferenceCheck: z.literal(true),
  mutationAuthorized: z.literal(false),
  retentionReleaseAuthorized: z.literal(false),
  deletionAuthorized: z.literal(false),
  providerDeleteAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((plan, context) => {
  if (plan.preflights.length !== plan.mutations.length || plan.summary.totalStatements !== plan.mutations.length) {
    context.addIssue({ code: "custom", message: "Every reference mutation requires one collision-complete preflight.", path: ["mutations"] });
  }
  const preflightKeys = new Set(plan.preflights.map((item) => `${item.entity}|${item.recordId}`));
  const mutationKeys = new Set(plan.mutations.map((item) => `${item.entity}|${item.recordId}`));
  if (preflightKeys.size !== plan.preflights.length || mutationKeys.size !== plan.mutations.length) {
    context.addIssue({ code: "custom", message: "Reference persistence identities must be unique.", path: ["mutations"] });
  }
  for (const key of mutationKeys) {
    if (!preflightKeys.has(key)) {
      context.addIssue({ code: "custom", message: "A reference mutation is missing its exact preflight.", path: ["mutations"] });
      break;
    }
  }
});

export type ArtifactReferencePersistencePlan = z.infer<typeof ArtifactReferencePersistencePlanSchema>;
export type ArtifactReferencePersistencePreflight = z.infer<typeof PersistencePreflightSchema>;

function fingerprint(value: unknown) {
  return createHash("sha256").update(artifactReferenceCanonicalJson(value)).digest("hex");
}

function bool(value: boolean) {
  return value ? 1 : 0;
}

type RowSpec = {
  entity: PersistenceEntity;
  table: string;
  recordId: string;
  row: Record<string, SqlValue>;
  alternateWhere?: string;
  alternateBindings?: SqlValue[];
};

const ENTITY_ORDER: PersistenceEntity[] = [
  "EVIDENCE_USE_END",
  "REFERENCE_PROJECTION",
  "REFERENCE_PROJECTION_USE",
  "REFERENCE_ASSIGNMENT",
];

function addRow(rows: Map<string, RowSpec>, spec: RowSpec) {
  const key = `${spec.entity}|${spec.recordId}`;
  const existing = rows.get(key);
  if (existing) {
    if (artifactReferenceCanonicalJson(existing.row) !== artifactReferenceCanonicalJson(spec.row)) {
      throw new Error(`Artifact reference persistence identity ${key} has conflicting content.`);
    }
    return;
  }
  rows.set(key, spec);
}

function quotedColumns(row: Record<string, SqlValue>) {
  return Object.keys(row).map((column) => `"${column}"`).join(", ");
}

function persistenceItems(spec: RowSpec) {
  const columns = Object.keys(spec.row);
  const where = spec.alternateWhere ? `"id" = ? OR (${spec.alternateWhere})` : `"id" = ?`;
  return {
    preflight: PersistencePreflightSchema.parse({
      preflightId: `preflight:${spec.entity.toLocaleLowerCase("en-CA")}:${spec.recordId}`,
      entity: spec.entity,
      recordId: spec.recordId,
      selectSql: `SELECT ${quotedColumns(spec.row)} FROM "${spec.table}" WHERE ${where}`,
      bindings: [spec.recordId, ...(spec.alternateBindings || [])],
      expected: spec.row,
      expectedFingerprint: fingerprint(spec.row),
      rejectMultipleMatches: true,
    }),
    mutation: PersistenceMutationSchema.parse({
      statementId: `insert:${spec.entity.toLocaleLowerCase("en-CA")}:${spec.recordId}`,
      entity: spec.entity,
      recordId: spec.recordId,
      sql: `INSERT OR IGNORE INTO "${spec.table}" (${quotedColumns(spec.row)}) VALUES (${columns.map(() => "?").join(", ")})`,
      bindings: Object.values(spec.row),
      operation: "INSERT_IF_ABSENT",
    }),
  };
}

function dedupeExact<T>(values: T[], keyOf: (value: T) => string, label: string) {
  const records = new Map<string, T>();
  for (const value of values) {
    const key = keyOf(value);
    const existing = records.get(key);
    if (existing && artifactReferenceCanonicalJson(existing) !== artifactReferenceCanonicalJson(value)) {
      throw new Error(`${label} ${key} has conflicting content.`);
    }
    records.set(key, value);
  }
  return [...records.values()].sort((left, right) => keyOf(left).localeCompare(keyOf(right), "en-CA"));
}

export function verifyArtifactReferencePersistencePreflight(
  item: ArtifactReferencePersistencePreflight,
  existingRows: Record<string, unknown>[] | Record<string, unknown> | null,
) {
  const validated = PersistencePreflightSchema.parse(item);
  const rows = Array.isArray(existingRows) ? existingRows : existingRows ? [existingRows] : [];
  if (rows.length === 0) return { state: "MISSING" as const, matches: true, matchCount: 0 };
  if (rows.length > 1) return { state: "CONFLICT" as const, matches: false, matchCount: rows.length };
  const comparable = Object.fromEntries(Object.keys(validated.expected).map((key) => [key, rows[0]?.[key] ?? null]));
  const matches = fingerprint(comparable) === validated.expectedFingerprint;
  return { state: matches ? "EXACT_MATCH" as const : "CONFLICT" as const, matches, matchCount: 1 };
}

export function buildArtifactReferencePersistencePlan(value: unknown): ArtifactReferencePersistencePlan {
  const request = ArtifactReferencePersistenceRequestSchema.parse(value);
  const endings = dedupeExact(request.evidenceUseEnds, (bundle) => bundle.record.endId, "Evidence-use ending");
  const projections = dedupeExact(request.projections, (projection) => projection.projectionId, "Reference projection");
  const endingByUse = new Map<string, (typeof endings)[number]>();
  for (const bundle of endings) {
    const { record, evidenceUse } = bundle;
    if (
      record.evidenceUseId !== evidenceUse.useId
      || record.businessId !== evidenceUse.businessId
      || record.useType !== evidenceUse.useType
      || record.useDigest !== artifactReferenceDigest(evidenceUse)
      || Date.parse(record.endedAt) < Date.parse(evidenceUse.recordedAt)
    ) {
      throw new Error("Evidence-use ending bundle does not match its exact original use.");
    }
    const existing = endingByUse.get(record.evidenceUseId);
    if (existing && existing.record.endId !== record.endId) throw new Error(`Evidence use ${record.evidenceUseId} cannot end twice.`);
    endingByUse.set(record.evidenceUseId, bundle);
  }
  for (const projection of projections) {
    const recomputed = createArtifactReferenceProjection({
      projectionVersion: projection.projectionVersion,
      projectionId: projection.projectionId,
      businessId: projection.businessId,
      lineageRootManifestId: projection.lineageRootManifestId,
      projectedAt: projection.projectedAt,
      mode: "SHADOW",
      projectorKind: "FIXTURE",
      maxCostUsd: 0,
      sourceFacts: projection.sourceFacts,
      snapshot: {
        snapshotVersion: ARTIFACT_REFERENCE_SNAPSHOT_VERSION,
        snapshotCapturedAt: projection.snapshotCapturedAt,
        freshUntil: projection.freshUntil,
        sourceKind: "FIXTURE_COMPLETE_SNAPSHOT",
        snapshotComplete: projection.snapshotComplete,
        sourceCounts: projection.sourceCounts,
        sourceFactsDigest: projection.sourceFactsDigest,
      },
    });
    if (artifactReferenceCanonicalJson(recomputed) !== artifactReferenceCanonicalJson(projection)) {
      throw new Error("Reference projection must exactly reproduce from its complete source snapshot before persistence.");
    }
    for (const ending of projection.sourceFacts.evidenceUseEnds) {
      const supplied = endingByUse.get(ending.evidenceUseId)?.record;
      if (!supplied || artifactReferenceCanonicalJson(supplied) !== artifactReferenceCanonicalJson(ending)) {
        throw new Error("Projection ending must have an exact evidence-use ending persistence bundle.");
      }
    }
  }

  const rows = new Map<string, RowSpec>();
  for (const { record } of endings) {
    addRow(rows, {
      entity: "EVIDENCE_USE_END",
      table: "RevenueArtifactEvidenceUseEnd",
      recordId: record.endId,
      row: {
        id: record.endId,
        endVersion: record.endVersion,
        evidenceUseId: record.evidenceUseId,
        businessId: record.businessId,
        useType: record.useType,
        useDigest: record.useDigest,
        endedAt: record.endedAt,
        recordedAt: record.recordedAt,
        reasonCode: record.reasonCode,
        basisType: record.basis.basisType,
        basisRecordId: record.basis.basisRecordId,
        basisRecordVersion: record.basis.basisRecordVersion,
        basisDigest: record.basis.basisDigest,
        replacementEvidenceUseId: record.replacementEvidenceUseId,
        actorUserId: record.actor.actorUserId,
        actorRole: record.actor.role,
        mode: record.mode,
        recorderKind: record.recorderKind,
        endDigest: record.endDigest,
        endJson: artifactReferenceCanonicalJson(record),
        requiresRetentionReview: bool(record.requiresRetentionReview),
        releaseAuthorized: bool(record.releaseAuthorized),
        deletionAuthorized: bool(record.deletionAuthorized),
        providerDeleteAuthorized: bool(record.providerDeleteAuthorized),
        providerDeletePerformed: bool(record.providerDeletePerformed),
        costUsd: record.costUsd,
      },
      alternateWhere: `"evidenceUseId" = ? OR "endDigest" = ?`,
      alternateBindings: [record.evidenceUseId, record.endDigest],
    });
  }

  for (const projection of projections) {
    addRow(rows, {
      entity: "REFERENCE_PROJECTION",
      table: "RevenueArtifactReferenceProjection",
      recordId: projection.projectionId,
      row: {
        id: projection.projectionId,
        projectionVersion: projection.projectionVersion,
        businessId: projection.businessId,
        lineageRootManifestId: projection.lineageRootManifestId,
        snapshotCapturedAt: projection.snapshotCapturedAt,
        projectedAt: projection.projectedAt,
        freshUntil: projection.freshUntil,
        snapshotComplete: bool(projection.snapshotComplete),
        sourceManifestCount: projection.sourceCounts.manifests,
        sourcePromotionCount: projection.sourceCounts.promotions,
        sourceManifestUseCount: projection.sourceCounts.manifestEvidenceUses,
        sourceEvidenceUseCount: projection.sourceCounts.evidenceUses,
        sourceUseEndCount: projection.sourceCounts.evidenceUseEnds,
        sourceAvailabilityCount: projection.sourceCounts.availability,
        sourceFactsDigest: projection.sourceFactsDigest,
        sourceFactsJson: artifactReferenceCanonicalJson(projection.sourceFacts),
        state: projection.state,
        activeUseCount: projection.activeUseCount,
        endedUseCount: projection.endedUseCount,
        ambiguousUseCount: projection.ambiguousUseCount,
        unassignedUseCount: projection.unassignedUseCount,
        requiredRetentionClass: projection.requiredRetentionClass,
        projectionDigest: projection.projectionDigest,
        projectionJson: artifactReferenceCanonicalJson(projection),
        retentionReviewSuggested: bool(projection.retentionReviewSuggested),
        validOnlyForSourceFactsDigest: bool(projection.validOnlyForSourceFactsDigest),
        requiresFreshReferenceCheck: bool(projection.requiresFreshReferenceCheck),
        releaseAuthorized: bool(projection.releaseAuthorized),
        deletionAuthorized: bool(projection.deletionAuthorized),
        providerDeleteAuthorized: bool(projection.providerDeleteAuthorized),
        providerDeletePerformed: bool(projection.providerDeletePerformed),
        providerOperationsAuthorized: projection.providerOperationsAuthorized,
        costAuthorizedUsd: projection.costAuthorizedUsd,
      },
      alternateWhere: `("lineageRootManifestId" = ? AND "projectionVersion" = ? AND "snapshotCapturedAt" = ?) OR "projectionDigest" = ?`,
      alternateBindings: [projection.lineageRootManifestId, projection.projectionVersion, projection.snapshotCapturedAt, projection.projectionDigest],
    });
    for (const use of projection.uses) {
      addRow(rows, {
        entity: "REFERENCE_PROJECTION_USE",
        table: "RevenueArtifactReferenceProjectionUse",
        recordId: use.projectionUseId,
        row: {
          id: use.projectionUseId,
          projectionId: projection.projectionId,
          evidenceUseId: use.evidenceUseId,
          useDigest: use.useDigest,
          state: use.state,
          evidenceUseEndId: use.evidenceUseEndId,
          requiredRetentionClass: use.requiredRetentionClass,
          assignmentState: use.assignmentState,
          currentCandidateCount: use.currentCandidateCount,
          rowDigest: use.rowDigest,
          rowJson: artifactReferenceCanonicalJson(use),
        },
        alternateWhere: `("projectionId" = ? AND "evidenceUseId" = ?) OR "rowDigest" = ?`,
        alternateBindings: [projection.projectionId, use.evidenceUseId, use.rowDigest],
      });
      for (const assignment of use.assignments) {
        addRow(rows, {
          entity: "REFERENCE_ASSIGNMENT",
          table: "RevenueArtifactReferenceProjectionAssignment",
          recordId: assignment.assignmentId,
          row: {
            id: assignment.assignmentId,
            projectionUseId: assignment.projectionUseId,
            manifestId: assignment.manifestId,
            manifestDigest: assignment.manifestDigest,
            retentionClass: assignment.retentionClass,
            lineageDepth: assignment.lineageDepth,
            assignmentKind: assignment.assignmentKind,
            assignmentDigest: assignment.assignmentDigest,
            assignmentJson: artifactReferenceCanonicalJson(assignment),
          },
          alternateWhere: `("projectionUseId" = ? AND "manifestId" = ?) OR "assignmentDigest" = ?`,
          alternateBindings: [assignment.projectionUseId, assignment.manifestId, assignment.assignmentDigest],
        });
      }
    }
  }

  const ordered = [...rows.values()].sort((left, right) => {
    const entity = ENTITY_ORDER.indexOf(left.entity) - ENTITY_ORDER.indexOf(right.entity);
    return entity || left.recordId.localeCompare(right.recordId, "en-CA");
  });
  const items = ordered.map(persistenceItems);
  const count = (entity: PersistenceEntity) => ordered.filter((item) => item.entity === entity).length;
  return ArtifactReferencePersistencePlanSchema.parse({
    persistencePlanVersion: request.persistencePlanVersion,
    targetSchemaVersion: request.targetSchemaVersion,
    plannedAt: request.plannedAt,
    mode: request.mode,
    plannerKind: request.plannerKind,
    maxCostUsd: request.maxCostUsd,
    preflights: items.map((item) => item.preflight),
    mutations: items.map((item) => item.mutation),
    summary: {
      evidenceUseEnds: count("EVIDENCE_USE_END"),
      projections: count("REFERENCE_PROJECTION"),
      projectionUses: count("REFERENCE_PROJECTION_USE"),
      assignments: count("REFERENCE_ASSIGNMENT"),
      totalStatements: items.length,
      providerOperations: 0,
      costUsd: 0,
    },
    requiresCompleteSnapshot: true,
    requiresExactPreflightMatch: true,
    requiresFreshReferenceCheck: true,
    mutationAuthorized: false,
    retentionReleaseAuthorized: false,
    deletionAuthorized: false,
    providerDeleteAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}
