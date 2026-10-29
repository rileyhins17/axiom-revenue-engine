import { z } from "zod";
import { classifyRevenueEvidencePartitions } from "@/lib/revenue-engine/revenue-evidence-partition";

import {
  PersistedSealedWebsiteReceiptSchema,
  RevenueLeadAssessmentBusinessSchema,
  RevenueLeadAssessmentRequestSchema,
  RevenueLeadAssessmentSchema,
  buildRevenueLeadAssessment,
  revenueLeadAssessmentCanonicalJson,
  revenueLeadAssessmentDigest,
  type RevenueLeadAssessment,
  type RevenueLeadAssessmentRequest,
} from "@/lib/revenue-engine/lead-assessment";

export const REVENUE_LEAD_ASSESSMENT_D1_EXECUTOR_VERSION = "revenue-lead-assessment-d1-v1";
export const REVENUE_LEAD_ASSESSMENT_TARGET_SCHEMA_VERSION = "0061_shadow_lead_assessment_receipts";
export const REVENUE_LEAD_ASSESSMENT_DATABASE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SqlValueSchema = z.union([z.string(), z.number().finite(), z.null()]);
const SqlRowSchema = z.record(z.string(), SqlValueSchema);
type SqlValue = z.infer<typeof SqlValueSchema>;
type SqlRow = z.infer<typeof SqlRowSchema>;

export type RevenueLeadAssessmentD1Statement = Readonly<{
  statementId: string;
  sql: string;
  bindings: readonly SqlValue[];
}>;

export interface RevenueLeadAssessmentD1Boundary {
  batch(statements: readonly RevenueLeadAssessmentD1Statement[]): Promise<readonly unknown[]>;
}

const BatchResultSchema = z.object({
  success: z.literal(true),
  results: z.array(SqlRowSchema).max(250),
  changes: z.number().int().nonnegative(),
}).strict();
const DatabaseTimeRowSchema = z.object({ databaseNow: TimestampSchema }).strict();
const TriggerRowSchema = z.object({ name: z.string(), sql: z.string().min(1) }).strict();

/**
 * Cloudflare adapter for the private persistence boundary. No Worker, route, or
 * queue imports this function; callers must inject the exact D1 binding after a
 * separate release gate.
 */
export function createCloudflareRevenueLeadAssessmentD1Boundary(
  database: Pick<D1Database, "prepare" | "batch">,
): RevenueLeadAssessmentD1Boundary {
  return {
    async batch(statements) {
      const prepared = statements.map((statement) => database.prepare(statement.sql).bind(...statement.bindings));
      const results = await database.batch<SqlRow>(prepared);
      return results.map((result) => ({
        success: result.success,
        results: result.results,
        changes: result.meta.changes,
      }));
    },
  };
}

const SealedReceiptRowSchema = z.object({
  workflowReceiptId: z.string().trim().min(1).max(200),
  workflowRunId: z.string().uuid(),
  rowWorkflowVersion: z.string().trim().min(1).max(100),
  rowStatus: z.enum(["COMPLETED", "PARTIAL"]),
  receiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  receiptJson: z.string().min(2).max(8_388_608),
  recordedAt: z.string().datetime({ offset: true }),
  closureStatus: z.literal("SEALED"),
  terminalReceiptId: z.string().trim().min(1).max(200),
}).strict();

const BusinessRowSchema = RevenueLeadAssessmentBusinessSchema;

export const RevenueLeadAssessmentD1ExecutionSchema = z.object({
  executorVersion: z.literal(REVENUE_LEAD_ASSESSMENT_D1_EXECUTOR_VERSION),
  targetSchemaVersion: z.literal(REVENUE_LEAD_ASSESSMENT_TARGET_SCHEMA_VERSION),
  executionPath: z.enum(["FRESH_COMMIT", "EXACT_REPLAY"]),
  transactionApi: z.literal("D1Database.batch"),
  assessment: RevenueLeadAssessmentSchema,
  insertedRows: z.object({
    websiteSnapshots: z.number().int().min(0).max(1),
    evidenceClaims: z.number().int().min(0).max(100),
    qualificationSnapshots: z.number().int().min(0).max(1),
    assessmentReceipts: z.number().int().min(0).max(1),
  }).strict(),
  committedAndReloaded: z.literal(true),
  runtimeConnected: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export type RevenueLeadAssessmentD1Execution = z.infer<typeof RevenueLeadAssessmentD1ExecutionSchema>;

export const RevenueLeadAssessmentD1DurableReloadSchema = z.object({
  executorVersion: z.literal(REVENUE_LEAD_ASSESSMENT_D1_EXECUTOR_VERSION),
  targetSchemaVersion: z.literal(REVENUE_LEAD_ASSESSMENT_TARGET_SCHEMA_VERSION),
  executionPath: z.literal("DURABLE_RELOAD"),
  transactionApi: z.literal("D1Database.batch"),
  assessment: RevenueLeadAssessmentSchema,
  assessmentReceiptRecordedAt: TimestampSchema,
  databaseNow: TimestampSchema,
  freshnessState: z.enum(["NOT_YET_CURRENT", "CURRENT", "STALE"]),
  reloadedRows: z.object({
    websiteSnapshots: z.literal(1),
    evidenceClaims: z.number().int().min(0).max(100),
    qualificationSnapshots: z.literal(1),
    assessmentReceipts: z.literal(1),
  }).strict(),
  exactSourceRebuilt: z.literal(true),
  immutableWriterGuardsVerified: z.literal(true),
  committedAndReloaded: z.literal(true),
  databaseReadPerformed: z.literal(true),
  databaseMutationPerformed: z.literal(false),
  persistenceScope: z.literal("EXACT_IMMUTABLE_ASSESSMENT_ROW_SET"),
  runtimeConnected: z.literal(false),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  qualificationExecutionAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((result, context) => {
  if (result.reloadedRows.evidenceClaims !== result.assessment.audit.claims.length) {
    context.addIssue({
      code: "custom",
      message: "A durable assessment reload must retain the exact evidence-claim count.",
      path: ["reloadedRows", "evidenceClaims"],
    });
  }
});

export type RevenueLeadAssessmentD1DurableReload = z.infer<
  typeof RevenueLeadAssessmentD1DurableReloadSchema
>;

const trustedAssessmentDurableReloads = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function requireTrustedRevenueLeadAssessmentD1DurableReload(
  value: unknown,
): RevenueLeadAssessmentD1DurableReload {
  RevenueLeadAssessmentD1DurableReloadSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedAssessmentDurableReloads.has(value)) {
    throw new Error("Assessment persistence must be the exact in-process result of the private durable D1 reload boundary.");
  }
  return value as RevenueLeadAssessmentD1DurableReload;
}

export function requireCurrentRevenueLeadAssessmentD1DurableReload(
  value: unknown,
): RevenueLeadAssessmentD1DurableReload & { freshnessState: "CURRENT" } {
  const result = requireTrustedRevenueLeadAssessmentD1DurableReload(value);
  if (result.freshnessState !== "CURRENT") {
    throw new Error("Durable assessment persistence is not current at the database clock.");
  }
  return result as RevenueLeadAssessmentD1DurableReload & { freshnessState: "CURRENT" };
}

type RecordPlan = {
  entity: "WEBSITE_SNAPSHOT" | "EVIDENCE_CLAIM" | "QUALIFICATION_SNAPSHOT" | "ASSESSMENT_RECEIPT";
  recordId: string;
  select: RevenueLeadAssessmentD1Statement;
  expected: Record<string, SqlValue>;
  insert: RevenueLeadAssessmentD1Statement;
};

function statement(statementId: string, sql: string, bindings: readonly SqlValue[] = []): RevenueLeadAssessmentD1Statement {
  return { statementId, sql, bindings };
}

function insertStatement(
  entity: RecordPlan["entity"],
  table: string,
  recordId: string,
  expected: Record<string, SqlValue>,
) {
  const columns = Object.keys(expected);
  return statement(
    `insert:${entity.toLocaleLowerCase("en-CA")}:${recordId}`,
    `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    Object.values(expected),
  );
}

function selectColumns(expected: Record<string, SqlValue>) {
  return Object.keys(expected).map((column) => `"${column}"`).join(", ");
}

function buildRecordPlans(assessment: RevenueLeadAssessment, partitioned: boolean): RecordPlan[] {
  const website = {
    ...(partitioned ? { evidenceMode: "LEGACY" } : {}),
    id: assessment.websiteSnapshotId,
    businessId: assessment.business.id,
    url: assessment.websiteUrl,
    finalUrl: assessment.audit.finalUrl,
    classification: assessment.audit.classification,
    auditVersion: assessment.audit.auditVersion,
    desktopArtifactRef: assessment.audit.desktopArtifactRef,
    mobileArtifactRef: assessment.audit.mobileArtifactRef,
    domArtifactRef: assessment.audit.domArtifactRef,
    deterministicChecksJson: revenueLeadAssessmentCanonicalJson(assessment.audit),
    capturedAt: assessment.audit.capturedAt,
    refreshAfter: assessment.refreshAfter,
  } satisfies Record<string, SqlValue>;
  const plans: RecordPlan[] = [{
    entity: "WEBSITE_SNAPSHOT",
    recordId: assessment.websiteSnapshotId,
    select: statement(
      `select:website_snapshot:${assessment.websiteSnapshotId}`,
      `SELECT ${selectColumns(website)} FROM "RevenueWebsiteSnapshot" WHERE "id" = ? ORDER BY "id"`,
      [assessment.websiteSnapshotId],
    ),
    expected: website,
    insert: insertStatement("WEBSITE_SNAPSHOT", "RevenueWebsiteSnapshot", assessment.websiteSnapshotId, website),
  }];

  for (const claim of assessment.audit.claims) {
    const evidence = {
      ...(partitioned ? { evidenceMode: "LEGACY" } : {}),
      id: claim.claimId,
      businessId: assessment.business.id,
      websiteSnapshotId: assessment.websiteSnapshotId,
      category: claim.category,
      observation: claim.observation,
      sourceUrl: claim.sourceUrl,
      artifactRef: claim.artifactRef,
      method: claim.method,
      confidence: claim.confidence,
      conversionCritical: claim.conversionCritical ? 1 : 0,
      auditVersion: claim.auditVersion,
      capturedAt: claim.capturedAt,
    } satisfies Record<string, SqlValue>;
    plans.push({
      entity: "EVIDENCE_CLAIM",
      recordId: claim.claimId,
      select: statement(
        `select:evidence_claim:${claim.claimId}`,
        `SELECT ${selectColumns(evidence)} FROM "RevenueEvidenceClaim" WHERE "id" = ? ORDER BY "id"`,
        [claim.claimId],
      ),
      expected: evidence,
      insert: insertStatement("EVIDENCE_CLAIM", "RevenueEvidenceClaim", claim.claimId, evidence),
    });
  }

  const qualification = {
    ...(partitioned ? { evidenceMode: "LEGACY" } : {}),
    id: assessment.qualificationSnapshotId,
    snapshotKey: assessment.qualificationSnapshotKey,
    businessId: assessment.business.id,
    policyVersion: assessment.qualification.policyVersion,
    shadowOnly: 1,
    totalScore: assessment.qualification.totalScore,
    rebuildNeedScore: assessment.qualification.scores.rebuildNeed,
    businessFitScore: assessment.qualification.scores.businessFit,
    reachabilityScore: assessment.qualification.scores.reachability,
    timingScore: assessment.qualification.scores.timing,
    evidenceConfidenceScore: assessment.qualification.scores.evidenceConfidence,
    band: assessment.qualification.band,
    recommendedChannel: assessment.qualification.recommendedChannel,
    supportedObservationCount: assessment.qualification.supportedObservationCount,
    conversionCriticalCount: assessment.qualification.conversionCriticalCount,
    failedGatesJson: revenueLeadAssessmentCanonicalJson(assessment.qualification.failedGates),
    evidenceClaimIdsJson: revenueLeadAssessmentCanonicalJson(assessment.qualification.evidenceClaimIds),
    createdAt: assessment.assessedAt,
  } satisfies Record<string, SqlValue>;
  plans.push({
    entity: "QUALIFICATION_SNAPSHOT",
    recordId: assessment.qualificationSnapshotId,
    select: statement(
      `select:qualification_snapshot:${assessment.qualificationSnapshotId}`,
      `SELECT ${selectColumns(qualification)} FROM "RevenueQualificationSnapshot" WHERE "id" = ? OR "snapshotKey" = ? ORDER BY "id"`,
      [assessment.qualificationSnapshotId, assessment.qualificationSnapshotKey],
    ),
    expected: qualification,
    insert: insertStatement("QUALIFICATION_SNAPSHOT", "RevenueQualificationSnapshot", assessment.qualificationSnapshotId, qualification),
  });

  const receipt = {
    ...(partitioned ? { assessmentKind: "LEGACY" } : {}),
    id: assessment.assessmentId,
    assessmentVersion: assessment.assessmentVersion,
    assessmentKey: assessment.assessmentKey,
    businessId: assessment.business.id,
    workflowReceiptId: assessment.workflow.workflowReceiptId,
    websiteSnapshotId: assessment.websiteSnapshotId,
    qualificationSnapshotId: assessment.qualificationSnapshotId,
    auditDigest: assessment.auditDigest,
    qualificationDigest: assessment.qualificationDigest,
    basisDigest: assessment.basisDigest,
    evidenceClaimCount: assessment.audit.claims.length,
    assessmentDigest: assessment.assessmentDigest,
    assessmentJson: revenueLeadAssessmentCanonicalJson(assessment),
    recordedAt: assessment.assessedAt,
    mode: "SHADOW",
    transactionKind: "D1_BATCH",
    outreachAuthorized: 0,
    sendAuthorized: 0,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  } satisfies Record<string, SqlValue>;
  plans.push({
    entity: "ASSESSMENT_RECEIPT",
    recordId: assessment.assessmentId,
    select: statement(
      `select:assessment_receipt:${assessment.assessmentId}`,
      `SELECT ${selectColumns(receipt)} FROM "RevenueLeadAssessmentReceipt" WHERE "id" = ? OR "assessmentKey" = ? ORDER BY "id"`,
      [assessment.assessmentId, assessment.assessmentKey],
    ),
    expected: receipt,
    insert: insertStatement("ASSESSMENT_RECEIPT", "RevenueLeadAssessmentReceipt", assessment.assessmentId, receipt),
  });
  return plans;
}

const REQUIRED_ASSESSMENT_TRIGGER_MARKERS = {
  RevenueWebsiteSnapshot_assessment_immutable_update: "REVENUE_LEAD_ASSESSMENT_APPEND_ONLY",
  RevenueWebsiteSnapshot_assessment_immutable_delete: "REVENUE_LEAD_ASSESSMENT_APPEND_ONLY",
  RevenueEvidenceClaim_assessment_immutable_update: "REVENUE_LEAD_ASSESSMENT_APPEND_ONLY",
  RevenueEvidenceClaim_assessment_immutable_delete: "REVENUE_LEAD_ASSESSMENT_APPEND_ONLY",
  RevenueQualificationSnapshot_assessment_immutable_update: "REVENUE_LEAD_ASSESSMENT_APPEND_ONLY",
  RevenueQualificationSnapshot_assessment_immutable_delete: "REVENUE_LEAD_ASSESSMENT_APPEND_ONLY",
  RevenueLeadAssessmentReceipt_immutable_update: "REVENUE_LEAD_ASSESSMENT_APPEND_ONLY",
  RevenueLeadAssessmentReceipt_immutable_delete: "REVENUE_LEAD_ASSESSMENT_APPEND_ONLY",
} as const;

const ASSESSMENT_TRIGGER_STATEMENT = statement(
  "read:assessment_writer_guards",
  `SELECT "name", "sql" FROM "sqlite_master"
   WHERE "type" = 'trigger' AND "name" IN (${Object.keys(REQUIRED_ASSESSMENT_TRIGGER_MARKERS).map(() => "?").join(", ")})
   ORDER BY "name"`,
  Object.keys(REQUIRED_ASSESSMENT_TRIGGER_MARKERS),
);

const AssessmentReceiptRowSchema = z.object({
  id: z.string().regex(/^assessment:[a-f0-9]{64}$/),
  assessmentVersion: z.literal("revenue-lead-assessment-v1"),
  assessmentKey: z.string().trim().min(8).max(200),
  businessId: z.string().trim().min(1).max(128),
  workflowReceiptId: z.string().trim().min(1).max(200),
  websiteSnapshotId: z.string().regex(/^website:[a-f0-9]{64}$/),
  qualificationSnapshotId: z.string().regex(/^qualification:[a-f0-9]{64}$/),
  auditDigest: Sha256Schema,
  qualificationDigest: Sha256Schema,
  basisDigest: Sha256Schema,
  evidenceClaimCount: z.number().int().min(0).max(100),
  assessmentDigest: Sha256Schema,
  assessmentJson: z.string().min(2).max(8_388_608),
  recordedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  transactionKind: z.literal("D1_BATCH"),
  outreachAuthorized: z.literal(0),
  sendAuthorized: z.literal(0),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

type AssessmentReceiptRow = z.infer<typeof AssessmentReceiptRowSchema>;

const ASSESSMENT_RECEIPT_COLUMNS = Object.keys(
  AssessmentReceiptRowSchema.shape,
) as (keyof AssessmentReceiptRow)[];

const EVIDENCE_CLAIM_COLUMNS = [
  "id",
  "businessId",
  "websiteSnapshotId",
  "category",
  "observation",
  "sourceUrl",
  "artifactRef",
  "method",
  "confidence",
  "conversionCritical",
  "auditVersion",
  "capturedAt",
] as const;

function durableAssessmentReceiptStatement(assessmentId: string, assessmentDigest: string, partitioned: boolean) {
  return statement(
    "read:durable_assessment_receipt",
    `SELECT ${partitioned ? '"assessmentKind", ' : ""}${ASSESSMENT_RECEIPT_COLUMNS.map((column) => `"${column}"`).join(", ")}
     FROM "RevenueLeadAssessmentReceipt"
     WHERE "id" = ? AND "assessmentDigest" = ?
     ORDER BY "id"`,
    [assessmentId, assessmentDigest],
  );
}

function completeAssessmentEvidenceStatement(assessment: RevenueLeadAssessment, partitioned: boolean) {
  return statement(
    "read:complete_assessment_evidence_claims",
    `SELECT ${partitioned ? '"evidenceMode", ' : ""}${EVIDENCE_CLAIM_COLUMNS.map((column) => `"${column}"`).join(", ")}
     FROM "RevenueEvidenceClaim"
     WHERE "businessId" = ? AND "websiteSnapshotId" = ?
     ORDER BY "id"`,
    [assessment.business.id, assessment.websiteSnapshotId],
  );
}

function assertAssessmentWriterGuards(result: z.infer<typeof BatchResultSchema>) {
  const rows = result.results.map((row) => TriggerRowSchema.parse(row));
  const expectedNames = Object.keys(REQUIRED_ASSESSMENT_TRIGGER_MARKERS).sort((left, right) => (
    left.localeCompare(right, "en-CA")
  ));
  if (
    rows.length !== expectedNames.length
    || rows.some((row, index) => row.name !== expectedNames[index])
  ) {
    throw new Error("Durable assessment persistence requires every exact migration-0061 immutable writer guard.");
  }
  for (const row of rows) {
    const marker = REQUIRED_ASSESSMENT_TRIGGER_MARKERS[
      row.name as keyof typeof REQUIRED_ASSESSMENT_TRIGGER_MARKERS
    ];
    if (!marker || !row.sql.includes(marker)) {
      throw new Error(`Durable assessment writer guard drifted: ${row.name}.`);
    }
  }
}

function assessmentFreshnessState(assessment: RevenueLeadAssessment, databaseNow: string) {
  if (Date.parse(databaseNow) < Date.parse(assessment.assessedAt)) return "NOT_YET_CURRENT" as const;
  if (Date.parse(databaseNow) >= Date.parse(assessment.refreshAfter)) return "STALE" as const;
  return "CURRENT" as const;
}

function assessmentFromDurableReceiptRow(raw: SqlRow, partitioned: boolean) {
  const row = partitioned
    ? AssessmentReceiptRowSchema.extend({ assessmentKind: z.literal("LEGACY") }).strict().parse(raw)
    : AssessmentReceiptRowSchema.parse(raw);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(row.assessmentJson) as unknown;
  } catch {
    throw new Error("The durable assessment receipt JSON is invalid.");
  }
  const assessment = RevenueLeadAssessmentSchema.parse(parsedJson);
  const receiptPlan = buildRecordPlans(assessment, partitioned).find((plan) => plan.entity === "ASSESSMENT_RECEIPT");
  if (
    !receiptPlan
    || !rowMatches(row, receiptPlan.expected)
    || row.assessmentJson !== revenueLeadAssessmentCanonicalJson(assessment)
  ) {
    throw new Error("The durable assessment receipt does not exactly mirror its canonical assessment JSON.");
  }
  return { row, assessment };
}

function durableAssessmentResult(input: {
  assessment: RevenueLeadAssessment;
  receiptRecordedAt: string;
  databaseNow: string;
}) {
  const parsed = RevenueLeadAssessmentD1DurableReloadSchema.parse({
    executorVersion: REVENUE_LEAD_ASSESSMENT_D1_EXECUTOR_VERSION,
    targetSchemaVersion: REVENUE_LEAD_ASSESSMENT_TARGET_SCHEMA_VERSION,
    executionPath: "DURABLE_RELOAD",
    transactionApi: "D1Database.batch",
    assessment: input.assessment,
    assessmentReceiptRecordedAt: input.receiptRecordedAt,
    databaseNow: input.databaseNow,
    freshnessState: assessmentFreshnessState(input.assessment, input.databaseNow),
    reloadedRows: {
      websiteSnapshots: 1,
      evidenceClaims: input.assessment.audit.claims.length,
      qualificationSnapshots: 1,
      assessmentReceipts: 1,
    },
    exactSourceRebuilt: true,
    immutableWriterGuardsVerified: true,
    committedAndReloaded: true,
    databaseReadPerformed: true,
    databaseMutationPerformed: false,
    persistenceScope: "EXACT_IMMUTABLE_ASSESSMENT_ROW_SET",
    runtimeConnected: false,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    qualificationExecutionAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
  const trusted = deepFreeze(parsed);
  trustedAssessmentDurableReloads.add(trusted);
  return trusted;
}

function parseBatchResults(raw: readonly unknown[], expectedCount: number) {
  if (raw.length !== expectedCount) throw new Error("D1 returned an unexpected assessment batch result count.");
  return raw.map((result) => BatchResultSchema.parse(result));
}

async function readAssessmentPartition(boundary: RevenueLeadAssessmentD1Boundary) {
  const tables = [
    ["RevenueWebsiteSnapshot", "evidenceMode"],
    ["RevenueEvidenceClaim", "evidenceMode"],
    ["RevenueQualificationSnapshot", "evidenceMode"],
    ["RevenueLeadAssessmentReceipt", "assessmentKind"],
  ] as const;
  const results = parseBatchResults(await boundary.batch(tables.map(([table]) => statement(
    `read:assessment_partition:${table}`, `PRAGMA table_info("${table}")`, [],
  ))), tables.length);
  return classifyRevenueEvidencePartitions(tables.map(([table, column], index) => ({
    table, column, rows: results[index].results,
  })));
}

function comparableRow(row: SqlRow, expected: Record<string, SqlValue>) {
  return Object.fromEntries(Object.keys(expected).map((key) => [key, row[key] ?? null]));
}

function rowMatches(row: SqlRow, expected: Record<string, SqlValue>) {
  return revenueLeadAssessmentDigest(comparableRow(row, expected)) === revenueLeadAssessmentDigest(expected);
}

function classifyPreflight(plan: RecordPlan, rows: SqlRow[]) {
  if (rows.length === 0) return "MISSING" as const;
  if (rows.length !== 1 || !rowMatches(rows[0], plan.expected)) return "CONFLICT" as const;
  return "EXACT" as const;
}

const SEALED_RECEIPT_STATEMENT = (receiptId: string) => statement(
  "read:sealed_workflow_receipt",
  `SELECT
    receipt."id" AS "workflowReceiptId",
    receipt."workflowRunId" AS "workflowRunId",
    receipt."workflowVersion" AS "rowWorkflowVersion",
    receipt."status" AS "rowStatus",
    receipt."receiptDigest" AS "receiptDigest",
    receipt."receiptJson" AS "receiptJson",
    receipt."recordedAt" AS "recordedAt",
    closure."status" AS "closureStatus",
    closure."terminalReceiptId" AS "terminalReceiptId"
  FROM "RevenueWorkflowReceiptRevision" receipt
  JOIN "RevenueWorkflowAttemptClosure" closure
    ON closure."attemptId" = receipt."attemptId"
   AND closure."terminalReceiptId" = receipt."id"
  WHERE receipt."id" = ?
  ORDER BY receipt."id", closure."id"`,
  [receiptId],
);

const BUSINESS_STATEMENT = (businessId: string) => statement(
  "read:assessment_business",
  `SELECT "id", "canonicalName", "independenceStatus", "status"
  FROM "RevenueBusiness" WHERE "id" = ? ORDER BY "id"`,
  [businessId],
);

const DATABASE_TIME_STATEMENT = statement(
  "read:assessment_database_time",
  `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS "databaseNow"`,
);

function assertFreshAssessmentClock(result: z.infer<typeof BatchResultSchema>, assessedAt: string) {
  if (result.results.length !== 1) throw new Error("Fresh assessment persistence requires one database-time row.");
  const { databaseNow } = DatabaseTimeRowSchema.parse(result.results[0]);
  const driftMs = Math.abs(Date.parse(databaseNow) - Date.parse(assessedAt));
  if (!Number.isFinite(driftMs) || driftMs > REVENUE_LEAD_ASSESSMENT_DATABASE_CLOCK_SKEW_MS) {
    throw new Error("Fresh assessment time is outside the database clock window.");
  }
}

export async function executePrivateRevenueLeadAssessmentD1(
  boundary: RevenueLeadAssessmentD1Boundary,
  value: RevenueLeadAssessmentRequest,
): Promise<RevenueLeadAssessmentD1Execution> {
  const request = RevenueLeadAssessmentRequestSchema.parse(value);
  const partitioned = await readAssessmentPartition(boundary);
  const [sourceResult] = parseBatchResults(
    await boundary.batch([SEALED_RECEIPT_STATEMENT(request.workflowReceiptId)]),
    1,
  );
  if (sourceResult.results.length !== 1) throw new Error("The exact sealed workflow receipt is missing or ambiguous.");
  const sealedReceipt = PersistedSealedWebsiteReceiptSchema.parse(SealedReceiptRowSchema.parse(sourceResult.results[0]));

  let rawReceipt: unknown;
  try {
    rawReceipt = JSON.parse(sealedReceipt.receiptJson) as unknown;
  } catch {
    throw new Error("The sealed workflow receipt JSON is invalid.");
  }
  const businessId = z.object({ businessId: z.string().trim().min(1).max(128) }).passthrough().parse(rawReceipt).businessId;
  const [businessResult] = parseBatchResults(await boundary.batch([BUSINESS_STATEMENT(businessId)]), 1);
  if (businessResult.results.length !== 1) throw new Error("The workflow business is missing or ambiguous.");
  const business = BusinessRowSchema.parse(businessResult.results[0]);
  const assessment = buildRevenueLeadAssessment({ request, business, sealedReceipt });
  const plans = buildRecordPlans(assessment, partitioned);

  const preflightResults = parseBatchResults(await boundary.batch(plans.map((plan) => plan.select)), plans.length);
  const states = plans.map((plan, index) => classifyPreflight(plan, preflightResults[index].results));
  const conflictIndex = states.findIndex((state) => state === "CONFLICT");
  if (conflictIndex >= 0) {
    const conflict = plans[conflictIndex];
    throw new Error(`Shadow assessment conflict for ${conflict.entity}:${conflict.recordId}.`);
  }

  const receiptIndex = plans.findIndex((plan) => plan.entity === "ASSESSMENT_RECEIPT");
  const receiptExists = states[receiptIndex] === "EXACT";
  if (receiptExists && states.some((state) => state !== "EXACT")) {
    throw new Error("An assessment receipt exists without its exact complete row set.");
  }
  const missingPlans = plans.filter((_, index) => states[index] === "MISSING");
  if (receiptExists && missingPlans.length === 0) {
    return RevenueLeadAssessmentD1ExecutionSchema.parse({
      executorVersion: REVENUE_LEAD_ASSESSMENT_D1_EXECUTOR_VERSION,
      targetSchemaVersion: REVENUE_LEAD_ASSESSMENT_TARGET_SCHEMA_VERSION,
      executionPath: "EXACT_REPLAY",
      transactionApi: "D1Database.batch",
      assessment,
      insertedRows: { websiteSnapshots: 0, evidenceClaims: 0, qualificationSnapshots: 0, assessmentReceipts: 0 },
      committedAndReloaded: true,
      runtimeConnected: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    });
  }
  if (!missingPlans.some((plan) => plan.entity === "ASSESSMENT_RECEIPT")) {
    throw new Error("A fresh assessment transaction must commit its receipt last.");
  }

  const [databaseTimeResult] = parseBatchResults(await boundary.batch([DATABASE_TIME_STATEMENT]), 1);
  assertFreshAssessmentClock(databaseTimeResult, assessment.assessedAt);
  parseBatchResults(await boundary.batch(missingPlans.map((plan) => plan.insert)), missingPlans.length);
  const reloadResults = parseBatchResults(await boundary.batch(plans.map((plan) => plan.select)), plans.length);
  plans.forEach((plan, index) => {
    if (classifyPreflight(plan, reloadResults[index].results) !== "EXACT") {
      throw new Error(`Committed assessment row failed exact reload: ${plan.entity}:${plan.recordId}.`);
    }
  });

  return RevenueLeadAssessmentD1ExecutionSchema.parse({
    executorVersion: REVENUE_LEAD_ASSESSMENT_D1_EXECUTOR_VERSION,
    targetSchemaVersion: REVENUE_LEAD_ASSESSMENT_TARGET_SCHEMA_VERSION,
    executionPath: "FRESH_COMMIT",
    transactionApi: "D1Database.batch",
    assessment,
    insertedRows: {
      websiteSnapshots: missingPlans.filter((plan) => plan.entity === "WEBSITE_SNAPSHOT").length,
      evidenceClaims: missingPlans.filter((plan) => plan.entity === "EVIDENCE_CLAIM").length,
      qualificationSnapshots: missingPlans.filter((plan) => plan.entity === "QUALIFICATION_SNAPSHOT").length,
      assessmentReceipts: missingPlans.filter((plan) => plan.entity === "ASSESSMENT_RECEIPT").length,
    },
    committedAndReloaded: true,
    runtimeConnected: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

export async function loadPrivateRevenueLeadAssessmentD1(
  boundary: RevenueLeadAssessmentD1Boundary,
  identityValue: unknown,
): Promise<RevenueLeadAssessmentD1DurableReload> {
  const identity = z.object({
    assessmentId: z.string().regex(/^assessment:[a-f0-9]{64}$/),
    assessmentDigest: Sha256Schema,
  }).strict().parse(identityValue);
  const partitioned = await readAssessmentPartition(boundary);

  const [guardResult, timeResult, receiptResult] = parseBatchResults(await boundary.batch([
    ASSESSMENT_TRIGGER_STATEMENT,
    DATABASE_TIME_STATEMENT,
    durableAssessmentReceiptStatement(identity.assessmentId, identity.assessmentDigest, partitioned),
  ]), 3);
  assertAssessmentWriterGuards(guardResult);
  if (timeResult.results.length !== 1) {
    throw new Error("Durable assessment reload requires one database-time row.");
  }
  const { databaseNow } = DatabaseTimeRowSchema.parse(timeResult.results[0]);
  if (receiptResult.results.length !== 1) {
    throw new Error("The exact durable assessment receipt is missing or ambiguous.");
  }
  const { row, assessment } = assessmentFromDurableReceiptRow(receiptResult.results[0], partitioned);
  if (
    assessment.assessmentId !== identity.assessmentId
    || assessment.assessmentDigest !== identity.assessmentDigest
  ) {
    throw new Error("The durable assessment identity does not match the requested assessment.");
  }

  const plans = buildRecordPlans(assessment, partitioned);
  const [sealedResult, businessResult, completeEvidenceResult, ...rowResults] = parseBatchResults(await boundary.batch([
    SEALED_RECEIPT_STATEMENT(assessment.workflow.workflowReceiptId),
    BUSINESS_STATEMENT(assessment.business.id),
    completeAssessmentEvidenceStatement(assessment, partitioned),
    ...plans.map((plan) => plan.select),
  ]), plans.length + 3);
  if (sealedResult.results.length !== 1) {
    throw new Error("The durable assessment's exact sealed workflow receipt is missing or ambiguous.");
  }
  if (businessResult.results.length !== 1) {
    throw new Error("The durable assessment's exact business is missing or ambiguous.");
  }
  const evidencePlans = plans
    .filter((plan) => plan.entity === "EVIDENCE_CLAIM")
    .sort((left, right) => left.recordId.localeCompare(right.recordId, "en-CA"));
  if (
    completeEvidenceResult.results.length !== evidencePlans.length
    || completeEvidenceResult.results.some((rowValue, index) => (
      !rowMatches(rowValue, evidencePlans[index].expected)
    ))
  ) {
    throw new Error("The durable assessment evidence rows are not one exact complete set.");
  }
  const sealedReceipt = PersistedSealedWebsiteReceiptSchema.parse(
    SealedReceiptRowSchema.parse(sealedResult.results[0]),
  );
  const business = BusinessRowSchema.parse(businessResult.results[0]);
  const rebuilt = buildRevenueLeadAssessment({
    request: RevenueLeadAssessmentRequestSchema.parse({
      assessmentVersion: assessment.assessmentVersion,
      idempotencyKey: assessment.assessmentKey,
      workflowReceiptId: assessment.workflow.workflowReceiptId,
      assessedAt: assessment.assessedAt,
      mode: assessment.mode,
      businessFitScore: assessment.qualification.scores.businessFit,
      timingScore: assessment.qualification.scores.timing,
      basisClaims: assessment.basisClaims,
      policyBlocks: assessment.policyBlocks,
    }),
    business,
    sealedReceipt,
  });
  if (
    rebuilt.assessmentDigest !== assessment.assessmentDigest
    || revenueLeadAssessmentCanonicalJson(rebuilt) !== revenueLeadAssessmentCanonicalJson(assessment)
  ) {
    throw new Error("The durable assessment cannot be rebuilt exactly from its sealed source and business.");
  }
  plans.forEach((plan, index) => {
    if (classifyPreflight(plan, rowResults[index].results) !== "EXACT") {
      throw new Error(`Durable assessment row failed exact reload: ${plan.entity}:${plan.recordId}.`);
    }
  });

  return durableAssessmentResult({
    assessment: rebuilt,
    receiptRecordedAt: row.recordedAt,
    databaseNow,
  });
}
