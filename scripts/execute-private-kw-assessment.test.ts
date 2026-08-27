import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
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
import { buildPrivateKwPersistencePlan } from "../src/lib/revenue-engine/private-kw-persistence-plan";
import {
  revenueLeadAssessmentCanonicalJson,
  revenueLeadAssessmentDigest,
} from "../src/lib/revenue-engine/lead-assessment";
import { auditWebsiteDeterministically } from "../src/lib/revenue-engine/website-audit";
import { executePrivateKwAssessmentFile } from "./execute-private-kw-assessment";
import {
  resolvePrivateKwDataPath,
  resolvePrivateKwDatabasePath,
  writePrivateKwJson,
} from "./private-kw-files";

test("private assessment databases stay as direct ignored local SQLite files", () => {
  const database = resolvePrivateKwDatabasePath("data/kw-evaluation/shadow.sqlite");
  assert.match(database.replaceAll("\\", "/"), /\/data\/kw-evaluation\/shadow\.sqlite$/);
  assert.throws(() => resolvePrivateKwDatabasePath("wrangler-state.sqlite"), /must stay inside/);
  assert.throws(() => resolvePrivateKwDatabasePath("data/kw-evaluation/../../shadow.sqlite"), /must stay inside/);
  assert.throws(() => resolvePrivateKwDatabasePath("data/kw-evaluation/shadow.db"), /\.sqlite extension/);
  assert.throws(() => resolvePrivateKwDatabasePath("data/kw-evaluation/nested/shadow.sqlite"), /direct children/);
});

function applyShadowMigrations(database: Database.Database) {
  const migrationRoot = new URL("../migrations/", import.meta.url);
  const migrationFiles = readdirSync(migrationRoot)
    .filter((name) => /^(0054|0055|0056|0057|0058|0059|0060|0061|0062|0063|0064)_.*\.sql$/.test(name))
    .sort();
  assert.equal(migrationFiles.length, 11);
  for (const migrationFile of migrationFiles) {
    database.exec(readFileSync(new URL(migrationFile, migrationRoot), "utf8"));
  }
}

test("executes one approved assessment locally, replays exactly, and rejects hidden source collisions", async () => {
  const suffix = randomUUID();
  const sourceRelative = `data/kw-evaluation/test-assessment-source-${suffix}.json`;
  const invocationRelative = `data/kw-evaluation/test-assessment-invocation-${suffix}.json`;
  const databaseRelative = `data/kw-evaluation/test-assessment-${suffix}.sqlite`;
  const sourceFile = resolvePrivateKwDataPath(sourceRelative);
  const invocationFile = resolvePrivateKwDataPath(invocationRelative);
  const databaseFile = resolvePrivateKwDatabasePath(databaseRelative);
  const now = Date.now();
  const capturedAt = new Date(now - 4 * 60_000).toISOString();
  const completedAt = new Date(now - 3 * 60_000).toISOString();
  const recordedAt = new Date(now - 2 * 60_000).toISOString();
  const assessedAt = new Date(now - 60_000).toISOString();
  const workflowId = randomUUID();
  const deliveryId = randomUUID();
  const attemptId = randomUUID();
  const sourceUrl = "https://directory.axiomfixtures.ca/local-invocation";
  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: `kw-local-assessment-${suffix}`,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic local assessment fixture",
    filters: { synthetic: true },
    capturedAt,
    costUsd: 0,
    records: [{
      sourceOwnedId: "local-assessment-1",
      sourceEvidenceUrl: sourceUrl,
      businessName: "Synthetic Cambridge Landscaping",
      city: "CAMBRIDGE",
      region: "ON",
      country: "CA",
      niche: "LANDSCAPING",
      websiteUrl: null,
      phone: "519-555-0188",
      addressLine: "8 Fixture Avenue",
      postalCode: "N1R 1A1",
      independenceStatus: "INDEPENDENT",
      capturedAt,
      sourcePayload: { synthetic: true },
    }],
  });
  const selected = source.records[0];
  const persistencePlan = buildPrivateKwPersistencePlan(source);
  const audit = auditWebsiteDeterministically({
    businessId: selected.business.id,
    businessName: selected.business.canonicalName,
    niche: "landscaping",
    expectedServices: ["landscaping"],
    expectedLocations: ["Cambridge"],
    sourceEvidenceUrl: sourceUrl,
    siteState: "NO_SITE",
    requestedUrl: null,
    finalUrl: null,
    statusCode: 0,
    redirectCount: 0,
    capturedAt,
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
  const receipt = {
    workflowVersion: "website-evidence-workflow-v1",
    workflowId,
    businessId: selected.business.id,
    completedAt,
    mode: "SHADOW" as const,
    status: "COMPLETED" as const,
    audit,
    budget: { totalCostUsd: 0, providerOperations: 0 },
  };
  const receiptJson = revenueLeadAssessmentCanonicalJson(receipt);
  const receiptDigest = revenueLeadAssessmentDigest(receipt);
  const receiptId = `workflow-receipt:${revenueLeadAssessmentDigest({ workflowId, receiptDigest })}`;
  const definitionDigest = "d".repeat(64);
  const requestDigest = "a".repeat(64);
  const invocation: PrivateKwAssessmentInvocationInput = {
    invocationVersion: PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION,
    sourceImportId: source.importId,
    sourcePlanDigest: persistencePlan.sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    workflowReceiptId: receiptId,
    assessedAt,
    businessFitScore: 75,
    timingScore: 30,
    basisClaims: [{
      basisId: "basis:local:fit",
      dimension: "BUSINESS_FIT",
      observation: "The reviewed fixture identifies an independent Cambridge landscaping business.",
      sourceUrl,
      capturedAt,
      method: "owner_review",
      confidence: 100,
    }, {
      basisId: "basis:local:timing",
      dimension: "TIMING",
      observation: "No stronger timing signal is supported by this owner-reviewed fixture.",
      sourceUrl,
      capturedAt,
      method: "owner_review",
      confidence: 100,
    }],
    policyBlocks: [],
    approval: {
      decision: "APPROVED_FOR_LOCAL_SHADOW_ASSESSMENT",
      reviewedBy: "RILEY",
      reviewedAt: assessedAt,
      rationale: "Approved synthetic fixture for local shadow assessment verification.",
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
    await writePrivateKwJson(invocationFile, invocation);
    const database = new Database(databaseFile);
    try {
      database.pragma("foreign_keys = ON");
      applyShadowMigrations(database);
      for (const item of persistencePlan.mutations) database.prepare(item.sql).run(...item.bindings);
      database.prepare(`INSERT INTO "RevenueWorkflowRun"
        ("id", "workflowKind", "workflowVersion", "idempotencyKey", "businessId", "mode", "orchestratorKind", "requestDigest", "requestJson", "maxCostUsd", "requestedAt")
        VALUES (?, 'WEBSITE_EVIDENCE', ?, ?, ?, 'SHADOW', 'FIXTURE', ?, '{}', 0, ?)`)
        .run(workflowId, receipt.workflowVersion, `local-${suffix}`, selected.business.id, requestDigest, capturedAt);
      database.prepare(`INSERT INTO "RevenueWorkflowDefinition"
        ("id", "workflowKind", "definitionVersion", "definitionDigest", "definitionJson")
        VALUES (?, 'WEBSITE_EVIDENCE', 'fixture-definition-v1', ?, '{}')`)
        .run(definitionDigest, definitionDigest);
      database.prepare(`INSERT INTO "RevenueWorkflowDelivery"
        ("id", "workflowRunId", "definitionId", "deliveryVersion", "workflowVersion", "requestDigest", "payloadDigest", "deliveryDigest", "deliveryJson", "receivedAt", "mode", "deliveryKind")
        VALUES (?, ?, ?, 'fixture-delivery-v1', ?, ?, ?, ?, '{}', ?, 'SHADOW', 'FIXTURE')`)
        .run(deliveryId, workflowId, definitionDigest, receipt.workflowVersion, requestDigest, requestDigest, "b".repeat(64), capturedAt);
      database.prepare(`INSERT INTO "RevenueWorkflowAttempt"
        ("id", "workflowRunId", "definitionId", "deliveryId", "attemptVersion", "workflowVersion", "requestDigest", "attemptNumber", "fencingToken", "startedAt", "attemptDigest", "attemptJson")
        VALUES (?, ?, ?, ?, 'fixture-attempt-v1', ?, ?, 1, 1, ?, ?, '{}')`)
        .run(attemptId, workflowId, definitionDigest, deliveryId, receipt.workflowVersion, requestDigest, capturedAt, "c".repeat(64));
      database.prepare(`INSERT INTO "RevenueWorkflowReceiptRevision"
        ("id", "workflowRunId", "definitionId", "attemptId", "revisionVersion", "workflowVersion", "requestDigest", "attemptNumber", "status", "receiptDigest", "receiptJson", "recordedAt")
        VALUES (?, ?, ?, ?, 'fixture-receipt-revision-v1', ?, ?, 1, 'COMPLETED', ?, ?, ?)`)
        .run(receiptId, workflowId, definitionDigest, attemptId, receipt.workflowVersion, requestDigest, receiptDigest, receiptJson, recordedAt);
      database.prepare(`INSERT INTO "RevenueWorkflowAttemptClosure"
        ("id", "workflowRunId", "attemptId", "status", "endedAt", "terminalReceiptId", "closureDigest", "closureJson", "effectiveAt")
        VALUES (?, ?, ?, 'SEALED', ?, ?, ?, '{}', ?)`)
        .run(`closure:${suffix}`, workflowId, attemptId, recordedAt, receiptId, "e".repeat(64), recordedAt);
    } finally {
      database.close();
    }

    const args = ["--source-plan", sourceRelative, "--invocation", invocationRelative, "--database", databaseRelative];
    const first = await executePrivateKwAssessmentFile(args);
    assert.equal(first.executionPath, "FRESH_COMMIT");
    assert.equal(first.localOnly, true);
    assert.equal(first.sourceMutationPerformed, false);
    assert.equal(first.outreachAuthorized, false);
    assert.equal(first.providerOperationsAuthorized, 0);
    const second = await executePrivateKwAssessmentFile(args);
    assert.equal(second.executionPath, "EXACT_REPLAY");
    assert.deepEqual(second.insertedRows, {
      websiteSnapshots: 0,
      evidenceClaims: 0,
      qualificationSnapshots: 0,
      assessmentReceipts: 0,
    });

    const collisionDatabase = new Database(databaseFile);
    try {
      collisionDatabase.prepare(`INSERT INTO "RevenueBusiness"
        ("id", "canonicalName", "normalizedDomain", "normalizedPhone", "independenceStatus", "status")
        VALUES (?, 'Hidden collision', NULL, ?, 'UNKNOWN', 'RESEARCH_ONLY')`)
        .run(`business:collision-${suffix}`, selected.business.normalizedPhone);
    } finally {
      collisionDatabase.close();
    }
    await assert.rejects(executePrivateKwAssessmentFile(args), /BUSINESS:CONFLICT/);

    const alteredSchemaDatabase = new Database(databaseFile);
    try {
      alteredSchemaDatabase.prepare('DELETE FROM "RevenueBusiness" WHERE "id" = ?')
        .run(`business:collision-${suffix}`);
      alteredSchemaDatabase.exec(`
        CREATE TRIGGER "unexpected_assessment_side_effect"
        AFTER INSERT ON "RevenueLeadAssessmentReceipt"
        BEGIN
          UPDATE "RevenueBusiness" SET "canonicalName" = "canonicalName" WHERE "id" = NEW."businessId";
        END;
      `);
    } finally {
      alteredSchemaDatabase.close();
    }
    await assert.rejects(executePrivateKwAssessmentFile(args), /differs from canonical migrations/);
  } finally {
    await rm(sourceFile, { force: true });
    await rm(invocationFile, { force: true });
    await rm(databaseFile, { force: true });
    await rm(`${databaseFile}-shm`, { force: true });
    await rm(`${databaseFile}-wal`, { force: true });
  }
});
