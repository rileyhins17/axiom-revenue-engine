import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import {
  executePrivateRevenueLeadAssessmentD1,
  type RevenueLeadAssessmentD1Boundary,
  type RevenueLeadAssessmentD1Statement,
} from "@/lib/revenue-engine/lead-assessment-d1";
import {
  REVENUE_LEAD_ASSESSMENT_VERSION,
  buildRevenueLeadAssessment,
  revenueLeadAssessmentCanonicalJson,
  revenueLeadAssessmentDigest,
  type RevenueLeadAssessmentRequest,
} from "@/lib/revenue-engine/lead-assessment";
import { OWNER_LEAD_CANDIDATE_QUERY } from "@/lib/revenue-engine/owner-lead-read-model";
import { auditWebsiteDeterministically } from "@/lib/revenue-engine/website-audit";

const BUSINESS_ID = "business:assessment-d1-fixture";
const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const DELIVERY_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const TEST_NOW_MS = Date.now();
const CAPTURED_AT = new Date(TEST_NOW_MS - 5 * 60 * 1_000).toISOString();
const COMPLETED_AT = new Date(TEST_NOW_MS - 4 * 60 * 1_000).toISOString();
const RECORDED_AT = new Date(TEST_NOW_MS - 3 * 60 * 1_000).toISOString();
const ASSESSED_AT = new Date(TEST_NOW_MS - 60 * 1_000).toISOString();
const WORKFLOW_VERSION = "website-evidence-workflow-v1";

function audit() {
  return auditWebsiteDeterministically({
    businessId: BUSINESS_ID,
    businessName: "D1 Fixture Roofing",
    niche: "roofing",
    expectedServices: ["roofing"],
    expectedLocations: ["Kitchener"],
    sourceEvidenceUrl: "https://directory.axiomfixtures.ca/d1-fixture",
    siteState: "NO_SITE",
    requestedUrl: null,
    finalUrl: null,
    statusCode: 0,
    redirectCount: 0,
    capturedAt: CAPTURED_AT,
    desktopArtifactRef: null,
    mobileArtifactRef: null,
    domArtifactRef: null,
    pageSetComplete: true,
    pages: [],
    resourceProbes: [],
    mobile: {
      captured: false,
      horizontalOverflow: null,
      navigationUsable: null,
      textReadable: null,
      minimumTapTargetPx: null,
    },
  });
}

function workflowReceipt() {
  return {
    workflowVersion: WORKFLOW_VERSION,
    workflowId: WORKFLOW_ID,
    businessId: BUSINESS_ID,
    completedAt: COMPLETED_AT,
    mode: "SHADOW",
    status: "COMPLETED",
    audit: audit(),
    budget: { totalCostUsd: 0, providerOperations: 0 },
  } as const;
}

function request(receiptId: string, overrides: Partial<RevenueLeadAssessmentRequest> = {}): RevenueLeadAssessmentRequest {
  return {
    assessmentVersion: REVENUE_LEAD_ASSESSMENT_VERSION,
    idempotencyKey: "assessment-d1-fixture:2026-08-26",
    workflowReceiptId: receiptId,
    assessedAt: ASSESSED_AT,
    mode: "SHADOW",
    businessFitScore: 80,
    timingScore: 30,
    basisClaims: [{
      basisId: "basis:d1:fit",
      dimension: "BUSINESS_FIT",
      observation: "The fixture source identifies an independent local roofing business.",
      sourceUrl: "https://directory.axiomfixtures.ca/d1-fixture",
      capturedAt: CAPTURED_AT,
      method: "source_api",
      confidence: 90,
    }, {
      basisId: "basis:d1:timing",
      dimension: "TIMING",
      observation: "No stronger current timing signal is supported in this fixture.",
      sourceUrl: "https://directory.axiomfixtures.ca/d1-fixture",
      capturedAt: CAPTURED_AT,
      method: "owner_review",
      confidence: 100,
    }],
    policyBlocks: [],
    ...overrides,
  };
}

function freshDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const migrationRoot = new URL("../../../migrations/", import.meta.url);
  const migrationFiles = readdirSync(migrationRoot)
    .filter((name) => /^(0054|0055|0056|0057|0058|0059|0060|0061)_.*\.sql$/.test(name))
    .sort();
  assert.equal(migrationFiles.length, 8);
  for (const migrationFile of migrationFiles) {
    database.exec(readFileSync(new URL(migrationFile, migrationRoot), "utf8"));
  }
  return database;
}

function seedSealedSource(database: Database.Database, options: { wrongDigest?: boolean; omitClosure?: boolean } = {}) {
  const receipt = workflowReceipt();
  const receiptJson = revenueLeadAssessmentCanonicalJson(receipt);
  const receiptDigest = options.wrongDigest ? "f".repeat(64) : revenueLeadAssessmentDigest(receipt);
  const receiptId = `workflow-receipt:${revenueLeadAssessmentDigest({ workflowId: WORKFLOW_ID, receiptDigest })}`;
  const definitionDigest = "d".repeat(64);
  const requestDigest = "a".repeat(64);

  database.prepare(`INSERT INTO "RevenueBusiness"
    ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status")
    VALUES (?, ?, NULL, 'INDEPENDENT', 'RESEARCH_ONLY')`).run(BUSINESS_ID, "D1 Fixture Roofing");
  database.prepare(`INSERT INTO "RevenueLocation"
    ("id", "businessId", "city", "region", "country", "geoCell")
    VALUES ('location:d1-fixture', ?, 'KITCHENER', 'ON', 'CA', 'kw:kitchener:fixture')`).run(BUSINESS_ID);
  database.prepare(`INSERT INTO "RevenueSourceRun"
    ("id", "adapter", "niche", "city", "region", "country", "queryText", "status", "resultCount", "startedAt")
    VALUES ('source-run:d1-fixture', 'FIXTURE', 'ROOFING', 'KITCHENER', 'ON', 'CA', 'D1 assessment fixture', 'COMPLETED', 1, ?)`)
    .run(CAPTURED_AT);
  database.prepare(`INSERT INTO "RevenueSourceRecord"
    ("id", "sourceRunId", "sourceOwnedId", "businessId", "rawPayloadJson", "identitySignalsJson", "capturedAt")
    VALUES ('source-record:d1-fixture', 'source-run:d1-fixture', 'fixture-owned-id', ?, ?, '{}', ?)`)
    .run(BUSINESS_ID, JSON.stringify({
      sourceEvidenceUrl: "https://directory.axiomfixtures.ca/d1-fixture",
      websiteUrl: null,
      niche: "ROOFING",
      sourcePayload: { synthetic: true },
    }), CAPTURED_AT);
  database.prepare(`INSERT INTO "RevenueWorkflowRun"
    ("id", "workflowKind", "workflowVersion", "idempotencyKey", "businessId", "mode", "orchestratorKind", "requestDigest", "requestJson", "maxCostUsd", "requestedAt")
    VALUES (?, 'WEBSITE_EVIDENCE', ?, 'd1-fixture-workflow', ?, 'SHADOW', 'FIXTURE', ?, '{}', 0, ?)`)
    .run(WORKFLOW_ID, WORKFLOW_VERSION, BUSINESS_ID, requestDigest, CAPTURED_AT);
  database.prepare(`INSERT INTO "RevenueWorkflowDefinition"
    ("id", "workflowKind", "definitionVersion", "definitionDigest", "definitionJson")
    VALUES (?, 'WEBSITE_EVIDENCE', 'fixture-definition-v1', ?, '{}')`)
    .run(definitionDigest, definitionDigest);
  database.prepare(`INSERT INTO "RevenueWorkflowDelivery"
    ("id", "workflowRunId", "definitionId", "deliveryVersion", "workflowVersion", "requestDigest", "payloadDigest", "deliveryDigest", "deliveryJson", "receivedAt", "mode", "deliveryKind")
    VALUES (?, ?, ?, 'fixture-delivery-v1', ?, ?, ?, ?, '{}', ?, 'SHADOW', 'FIXTURE')`)
    .run(DELIVERY_ID, WORKFLOW_ID, definitionDigest, WORKFLOW_VERSION, requestDigest, requestDigest, "b".repeat(64), CAPTURED_AT);
  database.prepare(`INSERT INTO "RevenueWorkflowAttempt"
    ("id", "workflowRunId", "definitionId", "deliveryId", "attemptVersion", "workflowVersion", "requestDigest", "attemptNumber", "fencingToken", "startedAt", "attemptDigest", "attemptJson")
    VALUES (?, ?, ?, ?, 'fixture-attempt-v1', ?, ?, 1, 1, ?, ?, '{}')`)
    .run(ATTEMPT_ID, WORKFLOW_ID, definitionDigest, DELIVERY_ID, WORKFLOW_VERSION, requestDigest, CAPTURED_AT, "c".repeat(64));
  database.prepare(`INSERT INTO "RevenueWorkflowReceiptRevision"
    ("id", "workflowRunId", "definitionId", "attemptId", "revisionVersion", "workflowVersion", "requestDigest", "attemptNumber", "status", "receiptDigest", "receiptJson", "recordedAt")
    VALUES (?, ?, ?, ?, 'fixture-receipt-revision-v1', ?, ?, 1, 'COMPLETED', ?, ?, ?)`)
    .run(receiptId, WORKFLOW_ID, definitionDigest, ATTEMPT_ID, WORKFLOW_VERSION, requestDigest, receiptDigest, receiptJson, RECORDED_AT);
  if (!options.omitClosure) {
    database.prepare(`INSERT INTO "RevenueWorkflowAttemptClosure"
      ("id", "workflowRunId", "attemptId", "status", "endedAt", "terminalReceiptId", "closureDigest", "closureJson", "effectiveAt")
      VALUES ('closure:d1-fixture', ?, ?, 'SEALED', ?, ?, ?, '{}', ?)`)
      .run(WORKFLOW_ID, ATTEMPT_ID, RECORDED_AT, receiptId, "e".repeat(64), RECORDED_AT);
  }
  return { receipt, receiptId, receiptDigest, receiptJson };
}

function createBoundary(database: Database.Database): RevenueLeadAssessmentD1Boundary {
  const transaction = database.transaction((statements: readonly RevenueLeadAssessmentD1Statement[]) => statements.map((item) => {
    const prepared = database.prepare(item.sql);
    if (prepared.reader) {
      return { success: true, results: prepared.all(...item.bindings) as Record<string, string | number | null>[], changes: 0 };
    }
    const result = prepared.run(...item.bindings);
    return { success: true, results: [], changes: result.changes };
  }));
  return { async batch(statements) { return transaction(statements); } };
}

function count(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
}

test("atomically commits and exactly replays one owner-readable shadow assessment", async () => {
  const database = freshDatabase();
  try {
    const source = seedSealedSource(database);
    const boundary = createBoundary(database);
    const first = await executePrivateRevenueLeadAssessmentD1(boundary, request(source.receiptId));

    assert.equal(first.executionPath, "FRESH_COMMIT");
    assert.deepEqual(first.insertedRows, {
      websiteSnapshots: 1,
      evidenceClaims: 1,
      qualificationSnapshots: 1,
      assessmentReceipts: 1,
    });
    assert.equal(first.assessment.qualification.recommendedChannel, "RESEARCH");
    assert.equal(first.runtimeConnected, false);
    assert.equal(first.outreachAuthorized, false);
    assert.equal(count(database, "RevenueWebsiteSnapshot"), 1);
    assert.equal(count(database, "RevenueEvidenceClaim"), 1);
    assert.equal(count(database, "RevenueQualificationSnapshot"), 1);
    assert.equal(count(database, "RevenueLeadAssessmentReceipt"), 1);
    assert.equal((database.prepare(OWNER_LEAD_CANDIDATE_QUERY).all(50) as unknown[]).length, 1);

    const second = await executePrivateRevenueLeadAssessmentD1(boundary, request(source.receiptId));
    assert.equal(second.executionPath, "EXACT_REPLAY");
    assert.deepEqual(second.insertedRows, {
      websiteSnapshots: 0,
      evidenceClaims: 0,
      qualificationSnapshots: 0,
      assessmentReceipts: 0,
    });
    assert.equal(second.assessment.assessmentDigest, first.assessment.assessmentDigest);

    assert.throws(
      () => database.prepare(`UPDATE "RevenueWebsiteSnapshot" SET "classification" = 'REBUILD'`).run(),
      /REVENUE_LEAD_ASSESSMENT_APPEND_ONLY/,
    );
    assert.throws(
      () => database.prepare(`DELETE FROM "RevenueLeadAssessmentReceipt"`).run(),
      /REVENUE_LEAD_ASSESSMENT_APPEND_ONLY/,
    );
  } finally {
    database.close();
  }
});

test("rejects alternate qualification-key collisions before creating an assessment receipt", async () => {
  const database = freshDatabase();
  try {
    const source = seedSealedSource(database);
    const nextRequest = request(source.receiptId, { idempotencyKey: "assessment-d1-collision:2026-08-26" });
    const assessment = buildRevenueLeadAssessment({
      request: nextRequest,
      business: { id: BUSINESS_ID, canonicalName: "D1 Fixture Roofing", independenceStatus: "INDEPENDENT", status: "RESEARCH_ONLY" },
      sealedReceipt: {
        workflowReceiptId: source.receiptId,
        workflowRunId: WORKFLOW_ID,
        rowWorkflowVersion: WORKFLOW_VERSION,
        rowStatus: "COMPLETED",
        receiptDigest: source.receiptDigest,
        receiptJson: source.receiptJson,
        recordedAt: RECORDED_AT,
        closureStatus: "SEALED",
        terminalReceiptId: source.receiptId,
      },
    });
    database.prepare(`INSERT INTO "RevenueQualificationSnapshot"
      ("id", "snapshotKey", "businessId", "policyVersion", "shadowOnly", "totalScore", "rebuildNeedScore", "businessFitScore", "reachabilityScore", "timingScore", "evidenceConfidenceScore", "band", "recommendedChannel", "supportedObservationCount", "conversionCriticalCount", "failedGatesJson", "evidenceClaimIdsJson", "createdAt")
      VALUES ('qualification:collision', ?, ?, 'revenue-shadow-v3', 1, 0, 0, 0, 0, 0, 0, 'RESEARCH', 'RESEARCH', 0, 0, '[]', '[]', ?)`)
      .run(assessment.qualificationSnapshotKey, BUSINESS_ID, ASSESSED_AT);

    await assert.rejects(
      () => executePrivateRevenueLeadAssessmentD1(createBoundary(database), nextRequest),
      /Shadow assessment conflict for QUALIFICATION_SNAPSHOT/i,
    );
    assert.equal(count(database, "RevenueLeadAssessmentReceipt"), 0);
    assert.equal(count(database, "RevenueWebsiteSnapshot"), 0);
  } finally {
    database.close();
  }
});

test("D1 batch rollback removes every partial assessment row when the final receipt insert fails", async () => {
  const database = freshDatabase();
  try {
    const source = seedSealedSource(database);
    const atomicRequest = request(source.receiptId, { idempotencyKey: "assessment-d1-atomic:2026-08-26" });
    database.exec(`CREATE TRIGGER "fixture_assessment_receipt_failure"
      BEFORE INSERT ON "RevenueLeadAssessmentReceipt"
      WHEN NEW."assessmentKey" = '${atomicRequest.idempotencyKey}'
      BEGIN SELECT RAISE(ABORT, 'FIXTURE_FINAL_RECEIPT_FAILURE'); END;`);

    await assert.rejects(
      () => executePrivateRevenueLeadAssessmentD1(createBoundary(database), atomicRequest),
      /FIXTURE_FINAL_RECEIPT_FAILURE/,
    );
    assert.equal(count(database, "RevenueWebsiteSnapshot"), 0);
    assert.equal(count(database, "RevenueEvidenceClaim"), 0);
    assert.equal(count(database, "RevenueQualificationSnapshot"), 0);
    assert.equal(count(database, "RevenueLeadAssessmentReceipt"), 0);
  } finally {
    database.close();
  }
});

test("unsealed or digest-drifted workflow sources fail before any shadow row is written", async () => {
  for (const options of [{ omitClosure: true }, { wrongDigest: true }]) {
    const database = freshDatabase();
    try {
      const source = seedSealedSource(database, options);
      await assert.rejects(
        () => executePrivateRevenueLeadAssessmentD1(createBoundary(database), request(source.receiptId)),
        options.omitClosure ? /sealed workflow receipt is missing/i : /digest does not bind/i,
      );
      assert.equal(count(database, "RevenueLeadAssessmentReceipt"), 0);
      assert.equal(count(database, "RevenueWebsiteSnapshot"), 0);
    } finally {
      database.close();
    }
  }
});

test("fresh writes reject caller time outside the D1 clock window", async () => {
  const database = freshDatabase();
  try {
    const source = seedSealedSource(database);
    await assert.rejects(
      () => executePrivateRevenueLeadAssessmentD1(createBoundary(database), request(source.receiptId, {
        assessedAt: new Date(TEST_NOW_MS + 6 * 60 * 1_000).toISOString(),
      })),
      /database clock window/i,
    );
    assert.equal(count(database, "RevenueLeadAssessmentReceipt"), 0);
    assert.equal(count(database, "RevenueWebsiteSnapshot"), 0);
  } finally {
    database.close();
  }
});
