import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ArtifactEvidenceUseSchema,
  ArtifactManifestSchema,
  ArtifactPromotionPlanSchema,
  ArtifactPromotionReceiptSchema,
  ArtifactReleaseRecordSchema,
  artifactEvidenceUsesDigest,
  artifactManifestDigest,
  artifactManifestFromPromotionReceipt,
  type ArtifactEvidenceUse,
  type ArtifactManifest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  FixtureWebsiteEvidenceWorkflowReceiptSchema,
  FixtureWebsiteEvidenceWorkflowRequestSchema,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";

export const DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION = "durable-evidence-persistence-plan-v1";
export const DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION = "0056_durable_evidence_receipts";

const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
type SqlValue = z.infer<typeof SqlValueSchema>;

const PersistenceEntitySchema = z.enum([
  "WORKFLOW_RUN",
  "WORKFLOW_RECEIPT",
  "WORKFLOW_STEP",
  "PAGE_SELECTION",
  "SELECTED_PAGE",
  "PAGE_CANDIDATE",
  "AUDIT_ASSEMBLY",
  "ARTIFACT_MANIFEST",
  "ARTIFACT_MANIFEST_ITEM",
  "EVIDENCE_USE",
  "PROMOTION_RECEIPT",
  "PROMOTION_USE",
  "MANIFEST_USE",
  "RELEASE_RECORD",
  "RELEASE_USE",
]);
type PersistenceEntity = z.infer<typeof PersistenceEntitySchema>;

const PersistencePreflightSchema = z.object({
  preflightId: z.string().trim().min(1).max(220),
  entity: PersistenceEntitySchema,
  recordId: z.string().trim().min(1).max(200),
  selectSql: z.string().trim().min(1).max(6_000),
  bindings: z.array(SqlValueSchema).max(12),
  expected: z.record(z.string().trim().min(1).max(100), SqlValueSchema),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const PersistenceMutationSchema = z.object({
  statementId: z.string().trim().min(1).max(220),
  entity: PersistenceEntitySchema,
  recordId: z.string().trim().min(1).max(200),
  sql: z.string().trim().min(1).max(8_000),
  bindings: z.array(SqlValueSchema).max(40),
  operation: z.literal("INSERT_IF_ABSENT"),
}).strict();

const PromotionBundleSchema = z.object({
  plan: ArtifactPromotionPlanSchema,
  receipt: ArtifactPromotionReceiptSchema,
}).strict();

const ReleaseBundleSchema = z.object({
  record: ArtifactReleaseRecordSchema,
  manifest: ArtifactManifestSchema,
  activeEvidenceUses: z.array(ArtifactEvidenceUseSchema).min(1).max(50),
}).strict();

export const DurableEvidencePersistenceRequestSchema = z.object({
  persistencePlanVersion: z.literal(DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION),
  targetSchemaVersion: z.literal(DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION),
  plannedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  plannerKind: z.literal("FIXTURE"),
  maxCostUsd: z.literal(0),
  workflowAttemptNumber: z.number().int().positive().max(100),
  workflowRequest: FixtureWebsiteEvidenceWorkflowRequestSchema,
  workflowReceipt: FixtureWebsiteEvidenceWorkflowReceiptSchema,
  promotions: z.array(PromotionBundleSchema).max(20),
  releases: z.array(ReleaseBundleSchema).max(20),
}).strict();

export type DurableEvidencePersistenceRequest = z.infer<typeof DurableEvidencePersistenceRequestSchema>;

const SummarySchema = z.object({
  workflowRuns: z.literal(1),
  workflowReceipts: z.literal(1),
  workflowSteps: z.number().int().min(8).max(64),
  pageSelections: z.number().int().nonnegative().max(1),
  selectedPages: z.number().int().nonnegative().max(4),
  pageCandidates: z.number().int().nonnegative().max(100),
  auditAssemblies: z.number().int().nonnegative().max(1),
  artifactManifests: z.number().int().nonnegative().max(50),
  artifactManifestItems: z.number().int().nonnegative().max(100),
  evidenceUses: z.number().int().nonnegative().max(200),
  promotionReceipts: z.number().int().nonnegative().max(20),
  promotionUses: z.number().int().nonnegative().max(1_000),
  manifestUses: z.number().int().nonnegative().max(1_000),
  releaseRecords: z.number().int().nonnegative().max(20),
  releaseUses: z.number().int().nonnegative().max(1_000),
  totalStatements: z.number().int().positive().max(2_500),
  providerOperations: z.literal(0),
  costUsd: z.literal(0),
}).strict();

export const DurableEvidencePersistencePlanSchema = z.object({
  persistencePlanVersion: z.literal(DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION),
  targetSchemaVersion: z.literal(DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION),
  plannedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  plannerKind: z.literal("FIXTURE"),
  maxCostUsd: z.literal(0),
  workflowId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  workflowAttemptNumber: z.number().int().positive().max(100),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  receiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  preflights: z.array(PersistencePreflightSchema).min(1).max(2_500),
  mutations: z.array(PersistenceMutationSchema).min(1).max(2_500),
  summary: SummarySchema,
  requiresExactPreflightMatch: z.literal(true),
  mutationAuthorized: z.literal(false),
  resumeAuthorized: z.literal(false),
}).strict().superRefine((plan, context) => {
  if (plan.preflights.length !== plan.mutations.length || plan.summary.totalStatements !== plan.mutations.length) {
    context.addIssue({ code: "custom", message: "Every durable mutation requires one exact preflight.", path: ["mutations"] });
  }
  const preflightKeys = new Set(plan.preflights.map((item) => `${item.entity}|${item.recordId}`));
  const mutationKeys = new Set(plan.mutations.map((item) => `${item.entity}|${item.recordId}`));
  if (preflightKeys.size !== plan.preflights.length || mutationKeys.size !== plan.mutations.length) {
    context.addIssue({ code: "custom", message: "Durable persistence entity IDs must be unique.", path: ["mutations"] });
  }
  for (const key of mutationKeys) {
    if (!preflightKeys.has(key)) {
      context.addIssue({ code: "custom", message: "A durable mutation is missing its exact preflight.", path: ["mutations"] });
      break;
    }
  }
});

export type DurableEvidencePersistencePlan = z.infer<typeof DurableEvidencePersistencePlanSchema>;
export type DurableEvidencePersistencePreflight = z.infer<typeof PersistencePreflightSchema>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function stableId(prefix: string, value: unknown) {
  return `${prefix}:${fingerprint(value)}`;
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

function quotedColumns(row: Record<string, SqlValue>) {
  return Object.keys(row).map((column) => `"${column}"`).join(", ");
}

function addRow(
  rows: Map<string, RowSpec>,
  spec: RowSpec,
) {
  const key = `${spec.entity}|${spec.recordId}`;
  const existing = rows.get(key);
  if (existing) {
    if (canonicalJson(existing.row) !== canonicalJson(spec.row)) {
      throw new Error(`Durable persistence record ${key} was supplied with conflicting content.`);
    }
    return;
  }
  rows.set(key, spec);
}

function persistenceItems(spec: RowSpec) {
  const columns = Object.keys(spec.row);
  const where = spec.alternateWhere ? `"id" = ? OR (${spec.alternateWhere})` : `"id" = ?`;
  const bindings = [spec.recordId, ...(spec.alternateBindings || [])];
  return {
    preflight: PersistencePreflightSchema.parse({
      preflightId: `preflight:${spec.entity.toLocaleLowerCase("en-CA")}:${spec.recordId}`,
      entity: spec.entity,
      recordId: spec.recordId,
      selectSql: `SELECT ${quotedColumns(spec.row)} FROM "${spec.table}" WHERE ${where} LIMIT 1`,
      bindings,
      expected: spec.row,
      expectedFingerprint: fingerprint(spec.row),
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

function promotionMatchesPlan(
  plan: z.infer<typeof ArtifactPromotionPlanSchema>,
  receipt: z.infer<typeof ArtifactPromotionReceiptSchema>,
) {
  return receipt.promotionId === plan.promotionId
    && receipt.workflowId === plan.workflowId
    && receipt.sourceRetentionClass === plan.sourceManifest.retentionClass
    && receipt.targetRetentionClass === plan.targetRetentionClass
    && receipt.action === plan.action
    && receipt.plannedItemCount === plan.items.length;
}

function addExactUse(uses: Map<string, ArtifactEvidenceUse>, value: ArtifactEvidenceUse) {
  const use = ArtifactEvidenceUseSchema.parse(value);
  const existing = uses.get(use.useId);
  if (existing && canonicalJson(existing) !== canonicalJson(use)) {
    throw new Error(`Evidence use ${use.useId} was supplied with conflicting content.`);
  }
  uses.set(use.useId, use);
}

function addExactManifest(manifests: Map<string, ArtifactManifest>, value: ArtifactManifest, workflowId: string) {
  const manifest = ArtifactManifestSchema.parse(value);
  if (manifest.workflowId !== workflowId) throw new Error("Every persisted artifact manifest must belong to the workflow run.");
  const existing = manifests.get(manifest.manifestId);
  if (existing && canonicalJson(existing) !== canonicalJson(manifest)) {
    throw new Error(`Artifact manifest ${manifest.manifestId} was supplied with conflicting content.`);
  }
  manifests.set(manifest.manifestId, manifest);
}

function requireExistingExactManifest(
  manifests: Map<string, ArtifactManifest>,
  value: ArtifactManifest,
  workflowId: string,
  purpose: "promotion" | "release",
) {
  const manifest = ArtifactManifestSchema.parse(value);
  if (manifest.workflowId !== workflowId) throw new Error("Every persisted artifact manifest must belong to the workflow run.");
  const existing = manifests.get(manifest.manifestId);
  if (!existing) {
    throw new Error(`Artifact ${purpose} must reference a manifest already produced by this workflow or an earlier promotion.`);
  }
  if (canonicalJson(existing) !== canonicalJson(manifest)) {
    throw new Error(`Artifact manifest ${manifest.manifestId} was supplied with conflicting content.`);
  }
  return existing;
}

export function verifyDurableEvidencePreflight(
  item: DurableEvidencePersistencePreflight,
  existingRow: Record<string, unknown> | null,
) {
  const validated = PersistencePreflightSchema.parse(item);
  if (!existingRow) return { state: "MISSING" as const, matches: true };
  const comparable = Object.fromEntries(
    Object.keys(validated.expected).map((key) => [key, existingRow[key] ?? null]),
  );
  const actualFingerprint = fingerprint(comparable);
  return {
    state: actualFingerprint === validated.expectedFingerprint ? "EXACT_MATCH" as const : "CONFLICT" as const,
    matches: actualFingerprint === validated.expectedFingerprint,
  };
}

export function buildDurableEvidencePersistencePlan(value: unknown): DurableEvidencePersistencePlan {
  const input = DurableEvidencePersistenceRequestSchema.parse(value);
  const request = input.workflowRequest;
  const receipt = input.workflowReceipt;
  if (
    receipt.workflowId !== request.workflowId
    || receipt.businessId !== request.businessId
    || receipt.idempotencyKey !== request.idempotencyKey
    || receipt.workflowVersion !== request.workflowVersion
    || receipt.requestedAt !== request.requestedAt
    || receipt.mode !== request.mode
    || receipt.orchestratorKind !== request.orchestratorKind
  ) {
    throw new Error("Workflow request and receipt identities must match exactly before persistence planning.");
  }
  if (Date.parse(receipt.completedAt) < Date.parse(request.requestedAt)) {
    throw new Error("Workflow completion cannot predate its request.");
  }
  if (Date.parse(input.plannedAt) < Date.parse(receipt.completedAt)) {
    throw new Error("Persistence planning cannot predate the workflow receipt.");
  }

  const requestDigest = fingerprint(request);
  const receiptDigest = fingerprint(receipt);
  const workflowReceiptId = `workflow-receipt:${receiptDigest}`;
  const manifests = new Map<string, ArtifactManifest>();
  const evidenceUses = new Map<string, ArtifactEvidenceUse>();
  for (const manifest of receipt.artifactManifests) addExactManifest(manifests, manifest, request.workflowId);

  const promotions = input.promotions.map((bundle) => {
    const plan = ArtifactPromotionPlanSchema.parse(bundle.plan);
    const promotionReceipt = ArtifactPromotionReceiptSchema.parse(bundle.receipt);
    if (!promotionMatchesPlan(plan, promotionReceipt)) {
      throw new Error("Artifact promotion receipt does not match its exact persistence plan.");
    }
    if (plan.workflowId !== request.workflowId || plan.businessId !== request.businessId) {
      throw new Error("Artifact promotion must belong to the persisted workflow and business.");
    }
    requireExistingExactManifest(manifests, plan.sourceManifest, request.workflowId, "promotion");
    for (const use of plan.evidenceUses) {
      if (use.businessId !== request.businessId) throw new Error("Artifact evidence use belongs to another business.");
      addExactUse(evidenceUses, use);
    }
    const resultManifest = promotionReceipt.outcome === "COMPLETED"
      ? artifactManifestFromPromotionReceipt(plan, promotionReceipt)
      : null;
    if (resultManifest) addExactManifest(manifests, resultManifest, request.workflowId);
    return { plan, receipt: promotionReceipt, resultManifest };
  });

  const releases = input.releases.map((bundle) => {
    const record = ArtifactReleaseRecordSchema.parse(bundle.record);
    const manifest = ArtifactManifestSchema.parse(bundle.manifest);
    const uses = z.array(ArtifactEvidenceUseSchema).min(1).max(50).parse(bundle.activeEvidenceUses);
    if (
      record.businessId !== request.businessId
      || manifest.workflowId !== request.workflowId
      || manifest.manifestId !== record.manifestId
      || manifest.retentionClass !== record.retentionClass
      || artifactManifestDigest(manifest) !== record.manifestDigest
      || artifactEvidenceUsesDigest(uses) !== record.evidenceUseDigest
    ) {
      throw new Error("Artifact release bundle does not match its manifest, evidence uses, workflow, and business.");
    }
    const useIds = uses.map((use) => use.useId).sort((left, right) => left.localeCompare(right, "en-CA"));
    if (JSON.stringify(useIds) !== JSON.stringify(record.reviewedUseIds)) {
      throw new Error("Artifact release persistence requires the exact reviewed evidence-use set.");
    }
    requireExistingExactManifest(manifests, manifest, request.workflowId, "release");
    for (const use of uses) {
      if (use.businessId !== request.businessId) throw new Error("Artifact release evidence use belongs to another business.");
      addExactUse(evidenceUses, use);
    }
    return { record, manifest, uses };
  });
  if (manifests.size > 50 || evidenceUses.size > 200) throw new Error("Durable evidence persistence input exceeds its bounded record budget.");

  const rows = new Map<string, RowSpec>();
  const add = (spec: RowSpec) => addRow(rows, spec);
  add({
    entity: "WORKFLOW_RUN",
    table: "RevenueWorkflowRun",
    recordId: request.workflowId,
    row: {
      id: request.workflowId,
      workflowKind: "WEBSITE_EVIDENCE",
      workflowVersion: request.workflowVersion,
      idempotencyKey: request.idempotencyKey,
      businessId: request.businessId,
      mode: request.mode,
      orchestratorKind: request.orchestratorKind,
      requestDigest,
      requestJson: canonicalJson(request),
      maxCostUsd: request.maxCostUsd,
      requestedAt: request.requestedAt,
    },
    alternateWhere: `"workflowKind" = ? AND "idempotencyKey" = ?`,
    alternateBindings: ["WEBSITE_EVIDENCE", request.idempotencyKey],
  });
  add({
    entity: "WORKFLOW_RECEIPT",
    table: "RevenueWorkflowReceipt",
    recordId: workflowReceiptId,
    row: {
      id: workflowReceiptId,
      workflowRunId: request.workflowId,
      attemptNumber: input.workflowAttemptNumber,
      status: receipt.status,
      sitePath: receipt.sitePath,
      currentStep: receipt.failure?.step || null,
      receiptDigest,
      receiptJson: canonicalJson(receipt),
      totalCostUsd: receipt.budget.totalCostUsd,
      completedAt: receipt.completedAt,
      recordedAt: input.plannedAt,
    },
    alternateWhere: `("workflowRunId" = ? AND "attemptNumber" = ?) OR ("workflowRunId" = ? AND "receiptDigest" = ?)`,
    alternateBindings: [request.workflowId, input.workflowAttemptNumber, request.workflowId, receiptDigest],
  });
  for (const [index, step] of receipt.steps.entries()) {
    const stepId = `${workflowReceiptId}:${String(index + 1).padStart(2, "0")}`;
    add({
      entity: "WORKFLOW_STEP",
      table: "RevenueWorkflowStepReceipt",
      recordId: stepId,
      row: {
        id: stepId,
        workflowReceiptId,
        stepOrdinal: index + 1,
        stepName: step.step,
        status: step.status,
        attempts: step.attempts,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        outputDigest: step.outputDigest,
        itemCount: step.itemCount,
        warningCodesJson: canonicalJson(step.warningCodes),
        failureJson: step.failure ? canonicalJson(step.failure) : null,
      },
      alternateWhere: `("workflowReceiptId" = ? AND "stepOrdinal" = ?) OR ("workflowReceiptId" = ? AND "stepName" = ?)`,
      alternateBindings: [workflowReceiptId, index + 1, workflowReceiptId, step.step],
    });
  }

  if (receipt.pageSelection) {
    const selection = receipt.pageSelection;
    add({
      entity: "PAGE_SELECTION",
      table: "RevenueWebsitePageSelection",
      recordId: selection.selectionId,
      row: {
        id: selection.selectionId,
        workflowRunId: request.workflowId,
        businessId: request.businessId,
        selectionVersion: selection.selectionVersion,
        status: selection.status,
        discoveryComplete: bool(selection.discoveryComplete),
        sourceCapturedAt: selection.sourceCapturedAt,
        plannedAt: selection.plannedAt,
        planDigest: fingerprint(selection),
        planJson: canonicalJson(selection),
      },
      alternateWhere: `"workflowRunId" = ?`,
      alternateBindings: [request.workflowId],
    });
    for (const page of selection.selectedPages) {
      const pageId = `${selection.selectionId}:${page.pageKind}`;
      add({
        entity: "SELECTED_PAGE",
        table: "RevenueWebsiteSelectedPage",
        recordId: pageId,
        row: {
          id: pageId,
          selectionId: selection.selectionId,
          pageKind: page.pageKind,
          url: page.url,
          label: page.label,
          score: page.score,
          reasonCodesJson: canonicalJson(page.reasonCodes),
        },
        alternateWhere: `("selectionId" = ? AND "pageKind" = ?) OR ("selectionId" = ? AND "url" = ?)`,
        alternateBindings: [selection.selectionId, page.pageKind, selection.selectionId, page.url],
      });
    }
    for (const candidate of selection.candidateEvaluations) {
      const candidateId = stableId("page-candidate", { selectionId: selection.selectionId, url: candidate.url });
      add({
        entity: "PAGE_CANDIDATE",
        table: "RevenueWebsitePageCandidate",
        recordId: candidateId,
        row: {
          id: candidateId,
          selectionId: selection.selectionId,
          url: candidate.url,
          label: candidate.label,
          kindHint: candidate.kindHint,
          serviceScore: candidate.scores.SERVICE,
          aboutScore: candidate.scores.ABOUT,
          contactScore: candidate.scores.CONTACT,
          eligibleKindsJson: canonicalJson(candidate.eligibleKinds),
          selectedAs: candidate.selectedAs,
          decision: candidate.decision,
          reasonCodesJson: canonicalJson(candidate.reasonCodes),
        },
        alternateWhere: `"selectionId" = ? AND "url" = ?`,
        alternateBindings: [selection.selectionId, candidate.url],
      });
    }
  }

  if (receipt.auditAssembly) {
    const assembly = receipt.auditAssembly;
    add({
      entity: "AUDIT_ASSEMBLY",
      table: "RevenueWebsiteAuditAssembly",
      recordId: assembly.assemblyId,
      row: {
        id: assembly.assemblyId,
        workflowRunId: request.workflowId,
        businessId: request.businessId,
        assemblyVersion: assembly.assemblyVersion,
        status: assembly.status,
        pageSetComplete: bool(assembly.pageSetComplete),
        assemblyDigest: fingerprint(assembly),
        assemblyJson: canonicalJson(assembly),
        assembledAt: assembly.assembledAt,
      },
      alternateWhere: `"workflowRunId" = ?`,
      alternateBindings: [request.workflowId],
    });
  }

  for (const manifest of manifests.values()) {
    add({
      entity: "ARTIFACT_MANIFEST",
      table: "RevenueArtifactManifest",
      recordId: manifest.manifestId,
      row: {
        id: manifest.manifestId,
        workflowRunId: request.workflowId,
        manifestVersion: manifest.manifestVersion,
        retentionClass: manifest.retentionClass,
        provenanceReceiptType: manifest.provenance.receiptType,
        provenanceReceiptId: manifest.provenance.receiptId,
        verifiedAt: manifest.verifiedAt,
        manifestDigest: artifactManifestDigest(manifest),
        manifestJson: canonicalJson(manifest),
      },
      alternateWhere: `"provenanceReceiptType" = ? AND "provenanceReceiptId" = ?`,
      alternateBindings: [manifest.provenance.receiptType, manifest.provenance.receiptId],
    });
    for (const item of manifest.items) {
      const itemId = `${manifest.manifestId}:${item.kind}`;
      add({
        entity: "ARTIFACT_MANIFEST_ITEM",
        table: "RevenueArtifactManifestItem",
        recordId: itemId,
        row: {
          id: itemId,
          manifestId: manifest.manifestId,
          kind: item.kind,
          artifactRef: item.artifactRef,
          objectKey: item.objectKey,
          byteLength: item.byteLength,
          sha256: item.sha256,
          etag: item.etag,
          uploadedAt: item.uploadedAt,
        },
        alternateWhere: `"manifestId" = ? AND "kind" = ?`,
        alternateBindings: [manifest.manifestId, item.kind],
      });
    }
  }

  for (const use of evidenceUses.values()) {
    add({
      entity: "EVIDENCE_USE",
      table: "RevenueArtifactEvidenceUse",
      recordId: use.useId,
      row: {
        id: use.useId,
        businessId: use.businessId,
        useType: use.useType,
        recordId: use.recordId,
        recordVersion: use.recordVersion,
        recordedAt: use.recordedAt,
      },
    });
  }

  for (const promotion of promotions) {
    const plan = promotion.plan;
    const promotionReceipt = promotion.receipt;
    add({
      entity: "PROMOTION_RECEIPT",
      table: "RevenueArtifactPromotionReceipt",
      recordId: promotionReceipt.promotionId,
      row: {
        id: promotionReceipt.promotionId,
        workflowRunId: request.workflowId,
        businessId: request.businessId,
        sourceManifestId: plan.sourceManifest.manifestId,
        resultManifestId: promotion.resultManifest?.manifestId || null,
        contractVersion: promotionReceipt.contractVersion,
        sourceRetentionClass: promotionReceipt.sourceRetentionClass,
        targetRetentionClass: promotionReceipt.targetRetentionClass,
        action: promotionReceipt.action,
        outcome: promotionReceipt.outcome,
        planDigest: fingerprint(plan),
        receiptDigest: fingerprint(promotionReceipt),
        planJson: canonicalJson(plan),
        receiptJson: canonicalJson(promotionReceipt),
        providerCopyPerformed: bool(promotionReceipt.providerCopyPerformed),
        costUsd: promotionReceipt.costUsd,
        completedAt: promotionReceipt.completedAt,
      },
    });
    for (const use of plan.evidenceUses) {
      const promotionUseId = `${promotionReceipt.promotionId}:${use.useId}`;
      add({
        entity: "PROMOTION_USE",
        table: "RevenueArtifactPromotionUse",
        recordId: promotionUseId,
        row: {
          id: promotionUseId,
          promotionId: promotionReceipt.promotionId,
          evidenceUseId: use.useId,
        },
        alternateWhere: `"promotionId" = ? AND "evidenceUseId" = ?`,
        alternateBindings: [promotionReceipt.promotionId, use.useId],
      });
      if (promotion.resultManifest) {
        const manifestUseId = `${promotion.resultManifest.manifestId}:${use.useId}`;
        add({
          entity: "MANIFEST_USE",
          table: "RevenueArtifactManifestEvidenceUse",
          recordId: manifestUseId,
          row: {
            id: manifestUseId,
            manifestId: promotion.resultManifest.manifestId,
            evidenceUseId: use.useId,
            viaPromotionId: promotionReceipt.promotionId,
            linkedAt: promotionReceipt.completedAt,
          },
          alternateWhere: `"manifestId" = ? AND "evidenceUseId" = ?`,
          alternateBindings: [promotion.resultManifest.manifestId, use.useId],
        });
      }
    }
  }

  for (const release of releases) {
    const record = release.record;
    add({
      entity: "RELEASE_RECORD",
      table: "RevenueArtifactReleaseRecord",
      recordId: record.releaseId,
      row: {
        id: record.releaseId,
        businessId: record.businessId,
        manifestId: record.manifestId,
        contractVersion: record.contractVersion,
        retentionClass: record.retentionClass,
        manifestDigest: record.manifestDigest,
        evidenceUseDigest: record.evidenceUseDigest,
        actorUserId: record.actor.actorUserId,
        actorRole: record.actor.role,
        decision: record.decision,
        reasonCode: record.reasonCode,
        rationale: record.rationale,
        releaseApproved: bool(record.releaseApproved),
        requiresFreshReferenceCheck: bool(record.requiresFreshReferenceCheckBeforeDeletion),
        requiresSeparateDeletionGate: bool(record.requiresSeparateDeletionReleaseGate),
        providerDeleteAuthorized: bool(record.providerDeleteAuthorized),
        providerDeletePerformed: bool(record.providerDeletePerformed),
        costUsd: record.costUsd,
        decisionDigest: record.decisionDigest,
        recordJson: canonicalJson(record),
        decidedAt: record.decidedAt,
      },
    });
    for (const use of release.uses) {
      const releaseUseId = `${record.releaseId}:${use.useId}`;
      add({
        entity: "RELEASE_USE",
        table: "RevenueArtifactReleaseUse",
        recordId: releaseUseId,
        row: {
          id: releaseUseId,
          releaseId: record.releaseId,
          evidenceUseId: use.useId,
        },
        alternateWhere: `"releaseId" = ? AND "evidenceUseId" = ?`,
        alternateBindings: [record.releaseId, use.useId],
      });
    }
  }

  const ordered = [...rows.values()];
  const persistence = ordered.map(persistenceItems);
  const count = (entity: PersistenceEntity) => ordered.filter((item) => item.entity === entity).length;
  return DurableEvidencePersistencePlanSchema.parse({
    persistencePlanVersion: input.persistencePlanVersion,
    targetSchemaVersion: input.targetSchemaVersion,
    plannedAt: input.plannedAt,
    mode: input.mode,
    plannerKind: input.plannerKind,
    maxCostUsd: input.maxCostUsd,
    workflowId: request.workflowId,
    businessId: request.businessId,
    workflowAttemptNumber: input.workflowAttemptNumber,
    requestDigest,
    receiptDigest,
    preflights: persistence.map((item) => item.preflight),
    mutations: persistence.map((item) => item.mutation),
    summary: {
      workflowRuns: 1,
      workflowReceipts: 1,
      workflowSteps: count("WORKFLOW_STEP"),
      pageSelections: count("PAGE_SELECTION"),
      selectedPages: count("SELECTED_PAGE"),
      pageCandidates: count("PAGE_CANDIDATE"),
      auditAssemblies: count("AUDIT_ASSEMBLY"),
      artifactManifests: count("ARTIFACT_MANIFEST"),
      artifactManifestItems: count("ARTIFACT_MANIFEST_ITEM"),
      evidenceUses: count("EVIDENCE_USE"),
      promotionReceipts: count("PROMOTION_RECEIPT"),
      promotionUses: count("PROMOTION_USE"),
      manifestUses: count("MANIFEST_USE"),
      releaseRecords: count("RELEASE_RECORD"),
      releaseUses: count("RELEASE_USE"),
      totalStatements: persistence.length,
      providerOperations: 0,
      costUsd: 0,
    },
    requiresExactPreflightMatch: true,
    mutationAuthorized: false,
    resumeAuthorized: false,
  });
}
