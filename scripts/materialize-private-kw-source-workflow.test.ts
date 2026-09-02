import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  PRIVATE_KW_ASSESSMENT_APPROVAL_CONFIRMATION,
  PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION,
  type PrivateKwAssessmentInvocationInput,
} from "../src/lib/revenue-engine/private-kw-assessment-invocation";
import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
} from "../src/lib/revenue-engine/private-kw-import";
import {
  buildPrivateKwPersistencePlan,
} from "../src/lib/revenue-engine/private-kw-persistence-plan";
import {
  PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION,
  PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
  buildPrivateKwSourceWorkflowMaterializationPlan,
  privateKwSourceWorkflowDigest,
  type PrivateKwSourceWorkflowMaterializationInput,
} from "../src/lib/revenue-engine/private-kw-source-workflow-materialization";
import { executePrivateKwAssessmentFile } from "./execute-private-kw-assessment";
import {
  executePrivateKwSourceWorkflowPlanForLocalDatabase,
  materializePrivateKwSourceWorkflowFile,
} from "./materialize-private-kw-source-workflow";
import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import {
  resolvePrivateKwDataPath,
  resolvePrivateKwDatabasePath,
  writePrivateKwJson,
} from "./private-kw-files";

function count(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as { count: number }).count;
}

test("separate approval atomically materializes source/workflow before assessment and replays exactly", async () => {
  const suffix = randomUUID();
  const sourceRelative = `data/kw-evaluation/test-materialization-source-${suffix}.json`;
  const materializationRelative = `data/kw-evaluation/test-materialization-approval-${suffix}.json`;
  const assessmentRelative = `data/kw-evaluation/test-materialization-assessment-${suffix}.json`;
  const databaseRelative = `data/kw-evaluation/test-materialization-${suffix}.sqlite`;
  const sourceFile = resolvePrivateKwDataPath(sourceRelative);
  const materializationFile = resolvePrivateKwDataPath(materializationRelative);
  const assessmentFile = resolvePrivateKwDataPath(assessmentRelative);
  const databaseFile = resolvePrivateKwDatabasePath(databaseRelative);
  const now = Date.now();
  const sourceCapturedAt = new Date(now - 4 * 60_000).toISOString();
  const auditCapturedAt = new Date(now - 3 * 60_000).toISOString();
  const evidenceCompletedAt = new Date(now - 2 * 60_000).toISOString();
  const reviewedAt = new Date(now - 60_000).toISOString();
  const assessedAt = new Date(now - 10_000).toISOString();
  const sourceUrl = "https://directory.axiomfixtures.ca/materialization-e2e";
  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: `kw-materialization-${suffix}`,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic local source workflow materialization fixture",
    filters: { synthetic: true },
    capturedAt: sourceCapturedAt,
    costUsd: 0,
    records: [{
      sourceOwnedId: "materialization-e2e-1",
      sourceEvidenceUrl: sourceUrl,
      businessName: "Synthetic Waterloo HVAC Materialization",
      city: "WATERLOO",
      region: "ON",
      country: "CA",
      niche: "HVAC",
      websiteUrl: null,
      phone: "519-555-0194",
      addressLine: "94 Fixture Lane",
      postalCode: "N2L 2A2",
      independenceStatus: "INDEPENDENT",
      capturedAt: sourceCapturedAt,
      sourcePayload: { synthetic: true },
    }],
  });
  const selected = source.records[0];
  const sourcePlanDigest = buildPrivateKwPersistencePlan(source).sourcePlanDigest;
  const auditInput = {
    businessId: selected.business.id,
    businessName: selected.business.canonicalName,
    niche: "hvac",
    expectedServices: ["HVAC"],
    expectedLocations: ["Waterloo"],
    sourceEvidenceUrl: sourceUrl,
    siteState: "NO_SITE" as const,
    requestedUrl: null,
    finalUrl: null,
    statusCode: 0,
    redirectCount: 0,
    capturedAt: auditCapturedAt,
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
  };
  const materialization: PrivateKwSourceWorkflowMaterializationInput = {
    materializationVersion: PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
    sourceImportId: source.importId,
    sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    auditInputDigest: privateKwSourceWorkflowDigest(auditInput),
    auditInput,
    evidenceCompletedAt,
    approval: {
      decision: "APPROVED_FOR_LOCAL_SOURCE_WORKFLOW_MATERIALIZATION",
      reviewedBy: "RILEY",
      reviewedAt,
      rationale: "Approved synthetic source and evidence for local materialization verification.",
      confirmation: PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION,
    },
    mode: "SHADOW",
    executionKind: "IGNORED_LOCAL_SQLITE",
    localDatabaseAccessAuthorized: true,
    localSourceMutationAuthorized: true,
    localWorkflowMutationAuthorized: true,
    localAssessmentMutationAuthorized: false,
    schemaMutationAuthorized: false,
    captureAuthorized: false,
    contactDiscoveryAuthorized: false,
    contactVerificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
  const plan = buildPrivateKwSourceWorkflowMaterializationPlan(source, materialization);
  const assessment: PrivateKwAssessmentInvocationInput = {
    invocationVersion: PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION,
    sourceImportId: source.importId,
    sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    workflowReceiptId: plan.workflowReceiptId,
    assessedAt,
    businessFitScore: 78,
    timingScore: 30,
    basisClaims: [{
      basisId: "basis:materialization-e2e:fit",
      dimension: "BUSINESS_FIT",
      observation: "The reviewed fixture identifies an independent Waterloo HVAC business.",
      sourceUrl,
      capturedAt: sourceCapturedAt,
      method: "owner_review",
      confidence: 100,
    }, {
      basisId: "basis:materialization-e2e:timing",
      dimension: "TIMING",
      observation: "No stronger current timing signal is supported by this owner-reviewed fixture.",
      sourceUrl,
      capturedAt: sourceCapturedAt,
      method: "owner_review",
      confidence: 100,
    }],
    policyBlocks: [],
    approval: {
      decision: "APPROVED_FOR_LOCAL_SHADOW_ASSESSMENT",
      reviewedBy: "RILEY",
      reviewedAt: assessedAt,
      rationale: "Separately approved synthetic fixture for local assessment verification.",
      confirmation: PRIVATE_KW_ASSESSMENT_APPROVAL_CONFIRMATION,
    },
    mode: "SHADOW",
    localAssessmentMutationAuthorized: true,
    sourceMutationAuthorized: false,
    workflowMutationAuthorized: false,
    contactDiscoveryAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };

  try {
    await mkdir(path.dirname(databaseFile), { recursive: true });
    await writePrivateKwJson(sourceFile, source);
    await writePrivateKwJson(materializationFile, materialization);
    await writePrivateKwJson(assessmentFile, assessment);
    const database = new Database(databaseFile);
    try {
      database.pragma("foreign_keys = ON");
      applyCanonicalPrivateKwMigrations(database);
    } finally {
      database.close();
    }

    const assessmentArgs = ["--source-plan", sourceRelative, "--invocation", assessmentRelative, "--database", databaseRelative];
    await assert.rejects(
      executePrivateKwAssessmentFile(assessmentArgs),
      /source plan is not exactly materialized/i,
    );

    const materializationArgs = ["--source-plan", sourceRelative, "--materialization", materializationRelative, "--database", databaseRelative];
    const first = await materializePrivateKwSourceWorkflowFile(materializationArgs);
    assert.equal(first.executionPath, "FRESH_COMMIT");
    assert.deepEqual(first.insertedRows, { source: 4, workflow: 6, materializationReceipts: 1 });
    assert.equal(first.workflowReceiptId, plan.workflowReceiptId);
    assert.equal(first.localAssessmentMutationAuthorized, false);
    assert.equal(first.captureAuthorized, false);
    assert.equal(first.outreachAuthorized, false);
    assert.equal(first.providerOperationsAuthorized, 0);

    const replay = await materializePrivateKwSourceWorkflowFile(materializationArgs);
    assert.equal(replay.executionPath, "EXACT_REPLAY");
    assert.deepEqual(replay.insertedRows, { source: 0, workflow: 0, materializationReceipts: 0 });

    const assessmentResult = await executePrivateKwAssessmentFile(assessmentArgs);
    assert.equal(assessmentResult.executionPath, "FRESH_COMMIT");
    assert.equal(assessmentResult.sourceMutationPerformed, false);
    assert.equal(assessmentResult.workflowMutationPerformed, false);
    assert.equal(assessmentResult.outreachAuthorized, false);

    const verificationDatabase = new Database(databaseFile);
    try {
      assert.equal(count(verificationDatabase, "RevenuePrivateKwMaterializationReceipt"), 1);
      assert.equal(count(verificationDatabase, "RevenueWorkflowReceiptRevision"), 1);
      assert.equal(count(verificationDatabase, "RevenueLeadAssessmentReceipt"), 1);
      assert.throws(
        () => verificationDatabase.prepare(`UPDATE "RevenuePrivateKwMaterializationReceipt" SET "sourceImportId" = "sourceImportId"`).run(),
        /REVENUE_PRIVATE_KW_MATERIALIZATION_APPEND_ONLY/,
      );
      verificationDatabase.exec(`CREATE TRIGGER "unexpected_materialization_side_effect"
        AFTER INSERT ON "RevenuePrivateKwMaterializationReceipt"
        BEGIN SELECT 1; END;`);
    } finally {
      verificationDatabase.close();
    }
    await assert.rejects(
      materializePrivateKwSourceWorkflowFile(materializationArgs),
      /differs from canonical migrations 0054-0069/i,
    );
  } finally {
    await rm(sourceFile, { force: true });
    await rm(materializationFile, { force: true });
    await rm(assessmentFile, { force: true });
    await rm(databaseFile, { force: true });
    await rm(`${databaseFile}-shm`, { force: true });
    await rm(`${databaseFile}-wal`, { force: true });
  }
});

test("materialization transaction rolls back source and workflow rows when its final receipt fails", () => {
  const suffix = randomUUID();
  const now = Date.now();
  const sourceCapturedAt = new Date(now - 4 * 60_000).toISOString();
  const auditCapturedAt = new Date(now - 3 * 60_000).toISOString();
  const evidenceCompletedAt = new Date(now - 2 * 60_000).toISOString();
  const reviewedAt = new Date(now - 60_000).toISOString();
  const sourceUrl = "https://directory.axiomfixtures.ca/materialization-rollback";
  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: `kw-materialization-rollback-${suffix}`,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic rollback fixture",
    filters: { synthetic: true },
    capturedAt: sourceCapturedAt,
    costUsd: 0,
    records: [{
      sourceOwnedId: "rollback-1",
      sourceEvidenceUrl: sourceUrl,
      businessName: "Synthetic Cambridge Landscaping Rollback",
      city: "CAMBRIDGE",
      region: "ON",
      country: "CA",
      niche: "LANDSCAPING",
      websiteUrl: null,
      phone: "519-555-0164",
      addressLine: "64 Fixture Street",
      postalCode: "N1R 3A3",
      independenceStatus: "INDEPENDENT",
      capturedAt: sourceCapturedAt,
      sourcePayload: { synthetic: true },
    }],
  });
  const selected = source.records[0];
  const auditInput = {
    businessId: selected.business.id,
    businessName: selected.business.canonicalName,
    niche: "landscaping",
    expectedServices: ["landscaping"],
    expectedLocations: ["Cambridge"],
    sourceEvidenceUrl: sourceUrl,
    siteState: "NO_SITE" as const,
    requestedUrl: null,
    finalUrl: null,
    statusCode: 0,
    redirectCount: 0,
    capturedAt: auditCapturedAt,
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
  };
  const materialization: PrivateKwSourceWorkflowMaterializationInput = {
    materializationVersion: PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
    sourceImportId: source.importId,
    sourcePlanDigest: buildPrivateKwPersistencePlan(source).sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    auditInputDigest: privateKwSourceWorkflowDigest(auditInput),
    auditInput,
    evidenceCompletedAt,
    approval: {
      decision: "APPROVED_FOR_LOCAL_SOURCE_WORKFLOW_MATERIALIZATION",
      reviewedBy: "RILEY",
      reviewedAt,
      rationale: "Approved synthetic rollback fixture for local transaction verification.",
      confirmation: PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION,
    },
    mode: "SHADOW",
    executionKind: "IGNORED_LOCAL_SQLITE",
    localDatabaseAccessAuthorized: true,
    localSourceMutationAuthorized: true,
    localWorkflowMutationAuthorized: true,
    localAssessmentMutationAuthorized: false,
    schemaMutationAuthorized: false,
    captureAuthorized: false,
    contactDiscoveryAuthorized: false,
    contactVerificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
  const plan = buildPrivateKwSourceWorkflowMaterializationPlan(source, materialization);
  const database = new Database(":memory:");
  try {
    database.pragma("foreign_keys = ON");
    applyCanonicalPrivateKwMigrations(database);
    database.exec(`CREATE TRIGGER "fixture_materialization_receipt_failure"
      BEFORE INSERT ON "RevenuePrivateKwMaterializationReceipt"
      BEGIN SELECT RAISE(ABORT, 'FIXTURE_MATERIALIZATION_RECEIPT_FAILURE'); END;`);
    assert.throws(
      () => executePrivateKwSourceWorkflowPlanForLocalDatabase(database, plan),
      /FIXTURE_MATERIALIZATION_RECEIPT_FAILURE/,
    );
    assert.equal(count(database, "RevenueSourceRun"), 0);
    assert.equal(count(database, "RevenueBusiness"), 0);
    assert.equal(count(database, "RevenueWorkflowRun"), 0);
    assert.equal(count(database, "RevenueWorkflowReceiptRevision"), 0);
    assert.equal(count(database, "RevenuePrivateKwMaterializationReceipt"), 0);

    database.exec(`DROP TRIGGER "fixture_materialization_receipt_failure"`);
    const expectedBusiness = plan.records.find((record) => record.entity === "BUSINESS");
    assert.ok(expectedBusiness);
    database.prepare(expectedBusiness.insertSql).run(...expectedBusiness.insertBindings);
    database.prepare(`INSERT INTO "RevenueBusiness"
      ("id", "canonicalName", "normalizedDomain", "normalizedPhone", "independenceStatus", "status")
      VALUES (?, 'Hidden alternate identity', NULL, ?, 'UNKNOWN', 'RESEARCH_ONLY')`)
      .run(`business:hidden-${suffix}`, selected.business.normalizedPhone);
    assert.throws(
      () => executePrivateKwSourceWorkflowPlanForLocalDatabase(database, plan),
      /materialization conflict for BUSINESS/i,
    );
    assert.equal(count(database, "RevenueSourceRun"), 0);
    assert.equal(count(database, "RevenueWorkflowRun"), 0);
    assert.equal(count(database, "RevenuePrivateKwMaterializationReceipt"), 0);
  } finally {
    database.close();
  }
});
