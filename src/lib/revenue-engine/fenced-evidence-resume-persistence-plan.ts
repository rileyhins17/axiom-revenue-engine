import { createHash } from "node:crypto";

import { z } from "zod";

import {
  FixtureWebsiteEvidenceWorkflowReceiptSchema,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";
import {
  FixtureWebsiteEvidenceCheckpointPayloadSchema,
  FixtureWebsiteEvidenceResumeRequestSchema,
  buildFixtureWebsiteEvidenceResumePlan,
  fixtureWebsiteEvidenceRequestDigest,
  type FixtureWebsiteEvidenceResumeRequest,
} from "@/lib/revenue-engine/fixture-website-evidence-resume-plan";

export const FENCED_EVIDENCE_RESUME_PERSISTENCE_PLAN_VERSION = "fenced-evidence-resume-persistence-plan-v1";
export const FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION = "0057_fenced_evidence_resume_records";

const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
type SqlValue = z.infer<typeof SqlValueSchema>;

const PersistenceEntitySchema = z.enum([
  "WORKFLOW_DEFINITION",
  "WORKFLOW_RUN",
  "WORKFLOW_DELIVERY",
  "WORKFLOW_ATTEMPT",
  "WORKFLOW_LEASE",
  "WORKFLOW_RECEIPT_REVISION",
  "WORKFLOW_ATTEMPT_CLOSURE",
  "CHECKPOINT_PAYLOAD",
  "WORKFLOW_CHECKPOINT",
  "CHECKPOINT_STATE_RECEIPT",
  "CHECKPOINT_DEPENDENCY",
  "ARTIFACT_RECOVERY_PLAN",
  "ARTIFACT_RECOVERY_RECEIPT",
]);
type PersistenceEntity = z.infer<typeof PersistenceEntitySchema>;

const PersistencePreflightSchema = z.object({
  preflightId: z.string().trim().min(1).max(400),
  entity: PersistenceEntitySchema,
  recordId: z.string().trim().min(1).max(300),
  selectSql: z.string().trim().min(1).max(8_000),
  bindings: z.array(SqlValueSchema).max(20),
  expected: z.record(z.string().trim().min(1).max(100), SqlValueSchema),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  rejectMultipleMatches: z.literal(true),
}).strict();

const PersistenceMutationSchema = z.object({
  statementId: z.string().trim().min(1).max(400),
  entity: PersistenceEntitySchema,
  recordId: z.string().trim().min(1).max(300),
  sql: z.string().trim().min(1).max(8_000),
  bindings: z.array(SqlValueSchema).max(40),
  operation: z.literal("INSERT_IF_ABSENT"),
}).strict();

export const FencedEvidenceResumePersistenceRequestSchema = z.object({
  persistencePlanVersion: z.literal(FENCED_EVIDENCE_RESUME_PERSISTENCE_PLAN_VERSION),
  targetSchemaVersion: z.literal(FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION),
  resumeRequest: FixtureWebsiteEvidenceResumeRequestSchema,
}).strict();

export type FencedEvidenceResumePersistenceRequest = z.infer<typeof FencedEvidenceResumePersistenceRequestSchema>;

const ResumeDecisionSchema = z.enum([
  "RETURN_TERMINAL",
  "WAIT_ACTIVE_LEASE",
  "REQUEST_FENCED_LEASE",
  "REQUEST_FENCED_TAKEOVER",
]);

const SummarySchema = z.object({
  workflowDefinitions: z.literal(1),
  workflowRuns: z.literal(1),
  deliveries: z.number().int().positive().max(100),
  attempts: z.number().int().nonnegative().max(100),
  attemptClosures: z.number().int().nonnegative().max(100),
  leases: z.number().int().nonnegative().max(200),
  receiptRevisions: z.number().int().nonnegative().max(100),
  checkpointPayloads: z.number().int().nonnegative().max(800),
  checkpoints: z.number().int().nonnegative().max(800),
  checkpointStateReceipts: z.number().int().nonnegative().max(1_600),
  checkpointDependencies: z.number().int().nonnegative().max(3_200),
  artifactRecoveryPlans: z.number().int().nonnegative().max(500),
  artifactRecoveryReceipts: z.number().int().nonnegative().max(500),
  totalStatements: z.number().int().positive().max(5_000),
  providerOperations: z.literal(0),
  costUsd: z.literal(0),
}).strict();

export const FencedEvidenceResumePersistencePlanSchema = z.object({
  persistencePlanVersion: z.literal(FENCED_EVIDENCE_RESUME_PERSISTENCE_PLAN_VERSION),
  targetSchemaVersion: z.literal(FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION),
  plannedAt: z.string().datetime({ offset: true }),
  mode: z.literal("SHADOW"),
  plannerKind: z.literal("FIXTURE"),
  maxCostUsd: z.literal(0),
  workflowId: z.string().uuid(),
  businessId: z.string().trim().min(1).max(128),
  definitionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  resumeDecision: ResumeDecisionSchema,
  resumePlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  preflights: z.array(PersistencePreflightSchema).min(1).max(5_000),
  mutations: z.array(PersistenceMutationSchema).min(1).max(5_000),
  summary: SummarySchema,
  requiresExactPreflightMatch: z.literal(true),
  blockedResumePlansRejected: z.literal(true),
  mutationAuthorized: z.literal(false),
  resumeAuthorized: z.literal(false),
  executionAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((plan, context) => {
  if (plan.preflights.length !== plan.mutations.length || plan.summary.totalStatements !== plan.mutations.length) {
    context.addIssue({ code: "custom", message: "Every planned insert requires one exact multi-match preflight.", path: ["mutations"] });
  }
  const preflightKeys = new Set(plan.preflights.map((item) => `${item.entity}|${item.recordId}`));
  const mutationKeys = new Set(plan.mutations.map((item) => `${item.entity}|${item.recordId}`));
  if (preflightKeys.size !== plan.preflights.length || mutationKeys.size !== plan.mutations.length) {
    context.addIssue({ code: "custom", message: "Fenced persistence entity IDs must be unique.", path: ["mutations"] });
  }
  for (const key of mutationKeys) {
    if (!preflightKeys.has(key)) {
      context.addIssue({ code: "custom", message: "A planned insert is missing its exact preflight.", path: ["mutations"] });
      break;
    }
  }
});

export type FencedEvidenceResumePersistencePlan = z.infer<typeof FencedEvidenceResumePersistencePlanSchema>;
export type FencedEvidenceResumePersistencePreflight = z.infer<typeof PersistencePreflightSchema>;

function persistedValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      $type: "Uint8Array",
      encoding: "base64",
      data: Buffer.from(value).toString("base64"),
    };
  }
  if (Array.isArray(value)) return value.map(persistedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, persistedValue(child)]));
  }
  return value;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(persistedValue(value));
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function stableId(prefix: string, value: unknown) {
  return `${prefix}:${fingerprint(value)}`;
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
  "WORKFLOW_DEFINITION",
  "WORKFLOW_RUN",
  "WORKFLOW_DELIVERY",
  "WORKFLOW_ATTEMPT",
  "WORKFLOW_LEASE",
  "WORKFLOW_RECEIPT_REVISION",
  "WORKFLOW_ATTEMPT_CLOSURE",
  "CHECKPOINT_PAYLOAD",
  "WORKFLOW_CHECKPOINT",
  "CHECKPOINT_STATE_RECEIPT",
  "CHECKPOINT_DEPENDENCY",
  "ARTIFACT_RECOVERY_PLAN",
  "ARTIFACT_RECOVERY_RECEIPT",
];

function quotedColumns(row: Record<string, SqlValue>) {
  return Object.keys(row).map((column) => `"${column}"`).join(", ");
}

function addRow(rows: Map<string, RowSpec>, spec: RowSpec) {
  const key = `${spec.entity}|${spec.recordId}`;
  const existing = rows.get(key);
  if (existing) {
    if (canonicalJson(existing.row) !== canonicalJson(spec.row)) {
      throw new Error(`Fenced persistence record ${key} was supplied with conflicting content.`);
    }
    return;
  }
  rows.set(key, spec);
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
    if (existing && canonicalJson(existing) !== canonicalJson(value)) {
      throw new Error(`${label} ${key} has conflicting content.`);
    }
    records.set(key, value);
  }
  return [...records.values()].sort((left, right) => keyOf(left).localeCompare(keyOf(right), "en-CA"));
}

function exactLease(
  request: FixtureWebsiteEvidenceResumeRequest,
  attemptId: string,
  fencingToken: number,
) {
  const matches = request.leases.filter((lease) => lease.attemptId === attemptId && lease.fencingToken === fencingToken);
  if (matches.length !== 1) throw new Error(`Attempt ${attemptId} does not have one exact fenced lease for persistence.`);
  return matches[0];
}

export function verifyFencedEvidenceResumePreflight(
  item: FencedEvidenceResumePersistencePreflight,
  existingRows: Record<string, unknown>[] | Record<string, unknown> | null,
) {
  const validated = PersistencePreflightSchema.parse(item);
  const rows = Array.isArray(existingRows) ? existingRows : existingRows ? [existingRows] : [];
  if (rows.length === 0) return { state: "MISSING" as const, matches: true, matchCount: 0 };
  if (rows.length > 1) return { state: "CONFLICT" as const, matches: false, matchCount: rows.length };
  const comparable = Object.fromEntries(
    Object.keys(validated.expected).map((key) => [key, rows[0]?.[key] ?? null]),
  );
  const matches = fingerprint(comparable) === validated.expectedFingerprint;
  return {
    state: matches ? "EXACT_MATCH" as const : "CONFLICT" as const,
    matches,
    matchCount: 1,
  };
}

export function buildFencedEvidenceResumePersistencePlan(value: unknown): FencedEvidenceResumePersistencePlan {
  const input = FencedEvidenceResumePersistenceRequestSchema.parse(value);
  const request = input.resumeRequest;
  const resumePlan = buildFixtureWebsiteEvidenceResumePlan(request);
  if (resumePlan.decision === "BLOCKED") {
    throw new Error(`Blocked resume history cannot be planned for persistence: ${resumePlan.reasonCode}.`);
  }

  const workflow = request.workflowRequest;
  const definition = request.definition;
  const requestDigest = fixtureWebsiteEvidenceRequestDigest(workflow);
  const deliveries = dedupeExact(
    [...request.persistedDeliveries, request.currentDelivery],
    (delivery) => delivery.deliveryId,
    "Delivery",
  );
  const attempts = dedupeExact(request.attempts, (attempt) => attempt.attemptId, "Attempt");
  const leases = dedupeExact(request.leases, (lease) => lease.leaseId, "Lease");
  const receiptRevisions = dedupeExact(request.receiptRevisions, (revision) => revision.receiptId, "Receipt revision");
  const checkpoints = dedupeExact(request.checkpoints, (bundle) => bundle.record.checkpointId, "Checkpoint");
  const recoveries = dedupeExact(request.artifactRecoveries, (recovery) => recovery.recoveryId, "Artifact recovery");

  const rows = new Map<string, RowSpec>();
  const add = (spec: RowSpec) => addRow(rows, spec);

  add({
    entity: "WORKFLOW_DEFINITION",
    table: "RevenueWorkflowDefinition",
    recordId: definition.definitionDigest,
    row: {
      id: definition.definitionDigest,
      workflowKind: "WEBSITE_EVIDENCE",
      definitionVersion: definition.descriptorVersion,
      definitionDigest: definition.definitionDigest,
      definitionJson: canonicalJson(definition),
    },
    alternateWhere: `"workflowKind" = ? AND "definitionVersion" = ?`,
    alternateBindings: ["WEBSITE_EVIDENCE", definition.descriptorVersion],
  });

  add({
    entity: "WORKFLOW_RUN",
    table: "RevenueWorkflowRun",
    recordId: workflow.workflowId,
    row: {
      id: workflow.workflowId,
      workflowKind: "WEBSITE_EVIDENCE",
      workflowVersion: workflow.workflowVersion,
      idempotencyKey: workflow.idempotencyKey,
      businessId: workflow.businessId,
      mode: workflow.mode,
      orchestratorKind: workflow.orchestratorKind,
      requestDigest,
      requestJson: canonicalJson(workflow),
      maxCostUsd: workflow.maxCostUsd,
      requestedAt: workflow.requestedAt,
    },
    alternateWhere: `"workflowKind" = ? AND "idempotencyKey" = ?`,
    alternateBindings: ["WEBSITE_EVIDENCE", workflow.idempotencyKey],
  });

  for (const delivery of deliveries) {
    add({
      entity: "WORKFLOW_DELIVERY",
      table: "RevenueWorkflowDelivery",
      recordId: delivery.deliveryId,
      row: {
        id: delivery.deliveryId,
        workflowRunId: workflow.workflowId,
        definitionId: definition.definitionDigest,
        deliveryVersion: delivery.deliveryVersion,
        workflowVersion: delivery.workflowVersion,
        requestDigest: delivery.requestDigest,
        payloadDigest: delivery.payloadDigest,
        deliveryDigest: fingerprint(delivery),
        deliveryJson: canonicalJson(delivery),
        receivedAt: delivery.receivedAt,
        mode: delivery.mode,
        deliveryKind: delivery.deliveryKind,
      },
    });
  }

  for (const attempt of attempts) {
    const attemptIdentity = {
      attemptVersion: attempt.attemptVersion,
      attemptId: attempt.attemptId,
      workflowId: attempt.workflowId,
      workflowVersion: attempt.workflowVersion,
      definitionDigest: attempt.definitionDigest,
      requestDigest: attempt.requestDigest,
      deliveryId: attempt.deliveryId,
      attemptNumber: attempt.attemptNumber,
      fencingToken: attempt.fencingToken,
      startedAt: attempt.startedAt,
    };
    add({
      entity: "WORKFLOW_ATTEMPT",
      table: "RevenueWorkflowAttempt",
      recordId: attempt.attemptId,
      row: {
        id: attempt.attemptId,
        workflowRunId: workflow.workflowId,
        definitionId: definition.definitionDigest,
        deliveryId: attempt.deliveryId,
        attemptVersion: attempt.attemptVersion,
        workflowVersion: attempt.workflowVersion,
        requestDigest: attempt.requestDigest,
        attemptNumber: attempt.attemptNumber,
        fencingToken: attempt.fencingToken,
        startedAt: attempt.startedAt,
        attemptDigest: fingerprint(attemptIdentity),
        attemptJson: canonicalJson(attemptIdentity),
      },
      alternateWhere: `("workflowRunId" = ? AND "attemptNumber" = ?) OR ("workflowRunId" = ? AND "fencingToken" = ?)`,
      alternateBindings: [workflow.workflowId, attempt.attemptNumber, workflow.workflowId, attempt.fencingToken],
    });
  }

  for (const lease of leases) {
    add({
      entity: "WORKFLOW_LEASE",
      table: "RevenueWorkflowLease",
      recordId: lease.leaseId,
      row: {
        id: lease.leaseId,
        workflowRunId: workflow.workflowId,
        definitionId: definition.definitionDigest,
        attemptId: lease.attemptId,
        deliveryId: lease.deliveryId,
        leaseVersion: lease.leaseVersion,
        workflowVersion: lease.workflowVersion,
        requestDigest: lease.requestDigest,
        attemptNumber: lease.attemptNumber,
        ownerId: lease.ownerId,
        fencingToken: lease.fencingToken,
        acquiredAt: lease.acquiredAt,
        expiresAt: lease.expiresAt,
        mode: lease.mode,
        leaseKind: lease.leaseKind,
        leaseDigest: fingerprint(lease),
        leaseJson: canonicalJson(lease),
      },
      alternateWhere: `"attemptId" = ? OR ("workflowRunId" = ? AND "fencingToken" = ?)`,
      alternateBindings: [lease.attemptId, workflow.workflowId, lease.fencingToken],
    });
  }

  for (const revision of receiptRevisions) {
    const receipt = FixtureWebsiteEvidenceWorkflowReceiptSchema.parse(revision.receipt);
    add({
      entity: "WORKFLOW_RECEIPT_REVISION",
      table: "RevenueWorkflowReceiptRevision",
      recordId: revision.receiptId,
      row: {
        id: revision.receiptId,
        workflowRunId: workflow.workflowId,
        definitionId: definition.definitionDigest,
        attemptId: revision.attemptId,
        revisionVersion: revision.revisionVersion,
        workflowVersion: revision.workflowVersion,
        requestDigest: revision.requestDigest,
        attemptNumber: revision.attemptNumber,
        status: receipt.status,
        receiptDigest: revision.receiptDigest,
        receiptJson: canonicalJson(receipt),
        recordedAt: revision.recordedAt,
      },
      alternateWhere: `"attemptId" = ? OR ("workflowRunId" = ? AND "receiptDigest" = ?)`,
      alternateBindings: [revision.attemptId, workflow.workflowId, revision.receiptDigest],
    });
  }

  for (const attempt of attempts.filter((candidate) => candidate.status !== "RUNNING")) {
    if (!attempt.endedAt) throw new Error(`Ended attempt ${attempt.attemptId} is missing its exact end timestamp.`);
    const closure = {
      attemptId: attempt.attemptId,
      status: attempt.status,
      endedAt: attempt.endedAt,
      terminalReceiptId: attempt.terminalReceiptId,
    };
    const closureDigest = fingerprint(closure);
    const closureId = stableId("workflow-attempt-closure", closure);
    add({
      entity: "WORKFLOW_ATTEMPT_CLOSURE",
      table: "RevenueWorkflowAttemptClosure",
      recordId: closureId,
      row: {
        id: closureId,
        workflowRunId: workflow.workflowId,
        attemptId: attempt.attemptId,
        status: attempt.status,
        endedAt: attempt.endedAt,
        terminalReceiptId: attempt.terminalReceiptId,
        closureDigest,
        closureJson: canonicalJson(closure),
        effectiveAt: attempt.endedAt,
      },
      alternateWhere: `"attemptId" = ?`,
      alternateBindings: [attempt.attemptId],
    });
  }

  for (const bundle of checkpoints) {
    const record = bundle.record;
    const payload = FixtureWebsiteEvidenceCheckpointPayloadSchema.parse(bundle.payload);
    add({
      entity: "CHECKPOINT_PAYLOAD",
      table: "RevenueWorkflowCheckpointPayload",
      recordId: record.locator.payloadDigest,
      row: {
        id: record.locator.payloadDigest,
        checkpointId: record.checkpointId,
        checkpointVersion: payload.checkpointVersion,
        payloadRef: record.locator.payloadRef,
        payloadDigest: record.locator.payloadDigest,
        payloadByteLength: record.locator.payloadByteLength,
        payloadEncoding: "CANONICAL_JSON_V1",
        payloadJson: canonicalJson(payload),
      },
      alternateWhere: `"checkpointId" = ? OR "payloadRef" = ?`,
      alternateBindings: [record.checkpointId, record.locator.payloadRef],
    });
  }

  for (const bundle of checkpoints) {
    const record = bundle.record;
    const lease = exactLease(request, record.attemptId, record.fencingToken);
    add({
      entity: "WORKFLOW_CHECKPOINT",
      table: "RevenueWorkflowCheckpoint",
      recordId: record.checkpointId,
      row: {
        id: record.checkpointId,
        workflowRunId: workflow.workflowId,
        definitionId: definition.definitionDigest,
        attemptId: record.attemptId,
        leaseId: lease.leaseId,
        payloadId: record.locator.payloadDigest,
        checkpointVersion: record.checkpointVersion,
        workflowVersion: record.workflowVersion,
        requestDigest: record.requestDigest,
        attemptNumber: record.attemptNumber,
        fencingToken: record.fencingToken,
        step: record.step,
        stepOrdinal: record.stepOrdinal,
        sitePath: record.sitePath,
        outputDigest: record.outputDigest,
        locatorVersion: record.locator.locatorVersion,
        locatorKind: record.locator.locatorKind,
        completedAt: record.completedAt,
      },
      alternateWhere: `("attemptId" = ? AND "step" = ?) OR ("attemptId" = ? AND "stepOrdinal" = ?)`,
      alternateBindings: [record.attemptId, record.step, record.attemptId, record.stepOrdinal],
    });

    const recordDigest = fingerprint(record);
    const revisionId = stableId("workflow-checkpoint-state", record);
    add({
      entity: "CHECKPOINT_STATE_RECEIPT",
      table: "RevenueWorkflowCheckpointStateReceipt",
      recordId: revisionId,
      row: {
        id: revisionId,
        checkpointId: record.checkpointId,
        commitState: record.commitState,
        recordDigest,
        recordJson: canonicalJson(record),
        recordedAt: record.recordedAt,
      },
      alternateWhere: `"checkpointId" = ? AND "commitState" = ?`,
      alternateBindings: [record.checkpointId, record.commitState],
    });

    for (const dependency of record.dependencies) {
      const dependencyId = `${record.checkpointId}:${dependency.checkpointId}`;
      add({
        entity: "CHECKPOINT_DEPENDENCY",
        table: "RevenueWorkflowCheckpointDependency",
        recordId: dependencyId,
        row: {
          id: dependencyId,
          checkpointId: record.checkpointId,
          dependencyCheckpointId: dependency.checkpointId,
          dependencyPayloadId: dependency.payloadDigest,
        },
        alternateWhere: `"checkpointId" = ? AND "dependencyCheckpointId" = ?`,
        alternateBindings: [record.checkpointId, dependency.checkpointId],
      });
    }
  }

  for (const recovery of recoveries) {
    const lease = exactLease(request, recovery.attemptId, recovery.fencingToken);
    add({
      entity: "ARTIFACT_RECOVERY_PLAN",
      table: "RevenueArtifactRecoveryPlan",
      recordId: recovery.planId,
      row: {
        id: recovery.planId,
        workflowRunId: workflow.workflowId,
        definitionId: definition.definitionDigest,
        recoveryVersion: recovery.recoveryVersion,
        workflowVersion: recovery.workflowVersion,
        requestDigest: recovery.requestDigest,
        pageKind: recovery.pageKind,
        profile: recovery.profile,
        planDigest: recovery.planDigest,
        payloadEncoding: "CANONICAL_JSON_WITH_BASE64_BYTES_V1",
        planJson: canonicalJson(recovery.plan),
      },
    });
    add({
      entity: "ARTIFACT_RECOVERY_RECEIPT",
      table: "RevenueArtifactRecoveryReceipt",
      recordId: recovery.recoveryId,
      row: {
        id: recovery.recoveryId,
        planId: recovery.planId,
        workflowRunId: workflow.workflowId,
        attemptId: recovery.attemptId,
        leaseId: lease.leaseId,
        attemptNumber: recovery.attemptNumber,
        fencingToken: recovery.fencingToken,
        receiptDigest: recovery.receiptDigest,
        outcome: recovery.receipt.outcome,
        failureCode: recovery.receipt.outcome === "FAILED" ? recovery.receipt.failure.code : null,
        receiptJson: canonicalJson(recovery.receipt),
        providerWritePerformed: recovery.receipt.providerWritePerformed ? 1 : 0,
        costUsd: recovery.receipt.costUsd,
        rollbackAction: recovery.receipt.rollbackAction,
        recordedAt: recovery.recordedAt,
      },
      alternateWhere: `"attemptId" = ? AND "planId" = ? AND "receiptDigest" = ?`,
      alternateBindings: [recovery.attemptId, recovery.planId, recovery.receiptDigest],
    });
  }

  const rank = new Map(ENTITY_ORDER.map((entity, index) => [entity, index]));
  const ordered = [...rows.values()].sort((left, right) => (
    (rank.get(left.entity) || 0) - (rank.get(right.entity) || 0)
    || left.recordId.localeCompare(right.recordId, "en-CA")
  ));
  const persistence = ordered.map(persistenceItems);
  const count = (entity: PersistenceEntity) => ordered.filter((item) => item.entity === entity).length;

  return FencedEvidenceResumePersistencePlanSchema.parse({
    persistencePlanVersion: input.persistencePlanVersion,
    targetSchemaVersion: input.targetSchemaVersion,
    plannedAt: request.plannedAt,
    mode: request.mode,
    plannerKind: request.plannerKind,
    maxCostUsd: request.maxCostUsd,
    workflowId: workflow.workflowId,
    businessId: workflow.businessId,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    resumeDecision: resumePlan.decision,
    resumePlanDigest: resumePlan.planDigest,
    preflights: persistence.map((item) => item.preflight),
    mutations: persistence.map((item) => item.mutation),
    summary: {
      workflowDefinitions: 1,
      workflowRuns: 1,
      deliveries: count("WORKFLOW_DELIVERY"),
      attempts: count("WORKFLOW_ATTEMPT"),
      attemptClosures: count("WORKFLOW_ATTEMPT_CLOSURE"),
      leases: count("WORKFLOW_LEASE"),
      receiptRevisions: count("WORKFLOW_RECEIPT_REVISION"),
      checkpointPayloads: count("CHECKPOINT_PAYLOAD"),
      checkpoints: count("WORKFLOW_CHECKPOINT"),
      checkpointStateReceipts: count("CHECKPOINT_STATE_RECEIPT"),
      checkpointDependencies: count("CHECKPOINT_DEPENDENCY"),
      artifactRecoveryPlans: count("ARTIFACT_RECOVERY_PLAN"),
      artifactRecoveryReceipts: count("ARTIFACT_RECOVERY_RECEIPT"),
      totalStatements: persistence.length,
      providerOperations: 0,
      costUsd: 0,
    },
    requiresExactPreflightMatch: true,
    blockedResumePlansRejected: true,
    mutationAuthorized: false,
    resumeAuthorized: false,
    executionAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}
