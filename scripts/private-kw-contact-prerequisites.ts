import Database from "better-sqlite3";

import {
  PersistedSealedWebsiteReceiptSchema,
  RevenueLeadAssessmentBusinessSchema,
  RevenueLeadAssessmentRequestSchema,
  RevenueLeadAssessmentSchema,
  buildRevenueLeadAssessment,
  revenueLeadAssessmentCanonicalJson,
  type RevenueLeadAssessment,
} from "../src/lib/revenue-engine/lead-assessment";
import {
  PrivateKwAssessmentReferenceSchema,
  type PrivateKwAssessmentReference,
} from "../src/lib/revenue-engine/private-kw-contact-invocation";
import {
  PrivateKwImportPlanSchema,
  type PrivateKwImportPlan,
} from "../src/lib/revenue-engine/private-kw-import";
import {
  buildPrivateKwPersistencePlan,
  verifyPersistencePreflight,
} from "../src/lib/revenue-engine/private-kw-persistence-plan";

type SqlRow = Record<string, unknown>;

export function assertExactPrivateKwSourceMaterialization(
  database: Database.Database,
  sourceValue: unknown,
): PrivateKwImportPlan {
  const source = PrivateKwImportPlanSchema.parse(sourceValue);
  const persistencePlan = buildPrivateKwPersistencePlan(source);
  for (const item of persistencePlan.preflights) {
    const rows = database.prepare(item.selectSql).all(...item.bindings) as SqlRow[];
    const result = verifyPersistencePreflight(item, rows);
    if (result.state !== "EXACT_MATCH") {
      throw new Error(`Private KW source plan is not exactly materialized (${item.entity}:${result.state}).`);
    }
  }
  return source;
}

function parseAssessmentJson(value: unknown): RevenueLeadAssessment {
  if (typeof value !== "string") throw new Error("Persisted assessment JSON is missing.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Persisted assessment JSON is invalid.");
  }
  const assessment = RevenueLeadAssessmentSchema.parse(parsed);
  if (revenueLeadAssessmentCanonicalJson(assessment) !== value) {
    throw new Error("Persisted assessment JSON is not the exact canonical assessment.");
  }
  return assessment;
}

function assessmentReceiptRows(database: Database.Database, reference: PrivateKwAssessmentReference) {
  return database.prepare(`
    SELECT
      "id", "assessmentVersion", "assessmentKey", "businessId", "workflowReceiptId",
      "websiteSnapshotId", "qualificationSnapshotId", "auditDigest", "qualificationDigest",
      "basisDigest", "evidenceClaimCount", "assessmentDigest", "assessmentJson", "recordedAt",
      "mode", "transactionKind", "outreachAuthorized", "sendAuthorized",
      "providerOperationsAuthorized", "costAuthorizedUsd"
    FROM "RevenueLeadAssessmentReceipt"
    WHERE "id" = ? OR "assessmentDigest" = ?
    ORDER BY "id"
  `).all(reference.assessmentReceiptId, reference.assessmentDigest) as SqlRow[];
}

function sealedReceipt(database: Database.Database, workflowReceiptId: string) {
  const rows = database.prepare(`
    SELECT
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
    ORDER BY receipt."id", closure."id"
  `).all(workflowReceiptId) as SqlRow[];
  if (rows.length !== 1) throw new Error("The assessment workflow receipt is missing or ambiguous.");
  return PersistedSealedWebsiteReceiptSchema.parse(rows[0]);
}

function assessmentBusiness(database: Database.Database, businessId: string) {
  const rows = database.prepare(`
    SELECT "id", "canonicalName", "independenceStatus", "status"
    FROM "RevenueBusiness"
    WHERE "id" = ?
    ORDER BY "id"
  `).all(businessId) as SqlRow[];
  if (rows.length !== 1) throw new Error("The assessed business is missing or ambiguous.");
  return RevenueLeadAssessmentBusinessSchema.parse(rows[0]);
}

function assertReceiptColumns(row: SqlRow, assessment: RevenueLeadAssessment) {
  const expected = {
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
  };
  const actual = Object.fromEntries(Object.keys(expected).map((key) => [key, row[key] ?? null]));
  if (revenueLeadAssessmentCanonicalJson(actual) !== revenueLeadAssessmentCanonicalJson(expected)) {
    throw new Error("Assessment receipt columns do not match the exact persisted assessment.");
  }
}

export function loadExactPrivateKwLeadAssessment(
  database: Database.Database,
  referenceValue: PrivateKwAssessmentReference,
): RevenueLeadAssessment {
  const reference = PrivateKwAssessmentReferenceSchema.parse(referenceValue);
  const rows = assessmentReceiptRows(database, reference);
  if (rows.length !== 1) throw new Error("The exact assessment receipt is missing or ambiguous.");
  const stored = parseAssessmentJson(rows[0]?.assessmentJson);
  if (
    stored.assessmentId !== reference.assessmentReceiptId
    || stored.assessmentDigest !== reference.assessmentDigest
    || stored.workflow.workflowReceiptId !== reference.workflowReceiptId
    || stored.websiteSnapshotId !== reference.websiteSnapshotId
    || stored.qualificationSnapshotId !== reference.qualificationSnapshotId
  ) {
    throw new Error("Assessment reference does not bind the exact persisted assessment.");
  }
  const request = RevenueLeadAssessmentRequestSchema.parse({
    assessmentVersion: stored.assessmentVersion,
    idempotencyKey: stored.assessmentKey,
    workflowReceiptId: stored.workflow.workflowReceiptId,
    assessedAt: stored.assessedAt,
    mode: stored.mode,
    businessFitScore: stored.qualification.scores.businessFit,
    timingScore: stored.qualification.scores.timing,
    basisClaims: stored.basisClaims,
    policyBlocks: stored.policyBlocks,
  });
  const rebuilt = buildRevenueLeadAssessment({
    request,
    business: assessmentBusiness(database, stored.business.id),
    sealedReceipt: sealedReceipt(database, stored.workflow.workflowReceiptId),
  });
  if (revenueLeadAssessmentCanonicalJson(rebuilt) !== revenueLeadAssessmentCanonicalJson(stored)) {
    throw new Error("Persisted assessment does not match its exact source and workflow lineage.");
  }
  assertReceiptColumns(rows[0]!, rebuilt);
  return rebuilt;
}
