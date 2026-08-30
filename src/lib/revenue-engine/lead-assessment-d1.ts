import { z } from "zod";

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
const DatabaseTimeRowSchema = z.object({ databaseNow: z.string() }).strict();

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

function buildRecordPlans(assessment: RevenueLeadAssessment): RecordPlan[] {
  const website = {
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

function parseBatchResults(raw: readonly unknown[], expectedCount: number) {
  if (raw.length !== expectedCount) throw new Error("D1 returned an unexpected assessment batch result count.");
  return raw.map((result) => BatchResultSchema.parse(result));
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
  const plans = buildRecordPlans(assessment);

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
