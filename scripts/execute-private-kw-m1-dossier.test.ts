import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { createPrivateKwCurrentWebsiteEvidenceFixture } from "../src/lib/revenue-engine/test-support/private-kw-current-website-evidence-fixture";
import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import { executePrivateKwM1WebsiteCheckpoint } from "./execute-private-kw-m1-website-checkpoint";

const DATA_ROOT = new URL("../data/kw-evaluation/", import.meta.url);

test("executes one bounded synthetic business through the durable offline website checkpoint and replays exactly", async () => {
  const suffix = `task-4b1-${Date.now().toString(36)}`;
  const now = new Date(Date.now() + 10_000);
  const fixture = await createPrivateKwCurrentWebsiteEvidenceFixture({
    suffix,
    now: new Date(now.getTime() - 3.8 * 60_000),
  });
  await mkdir(DATA_ROOT, { recursive: true });
  const names = {
    source: `task-4b1-${suffix}-source.json`,
    materialization: `task-4b1-${suffix}-materialization.json`,
    manifest: `task-4b1-${suffix}-manifest.json`,
    database: `task-4b1-${suffix}.sqlite`,
    output: `task-4b1-${suffix}-checkpoint.json`,
  };
  const files = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, new URL(name, DATA_ROOT)])) as Record<keyof typeof names, URL>;
  const database = new Database(fileURLToPath(files.database));
  try {
    database.pragma("foreign_keys = ON");
    applyCanonicalPrivateKwMigrations(database);
  } finally {
    database.close();
  }
  await Promise.all([
    writeFile(files.source, JSON.stringify(fixture.source, null, 2) + "\n"),
    writeFile(files.materialization, JSON.stringify(fixture.materialization, null, 2) + "\n"),
    writeFile(files.manifest, JSON.stringify(fixture.manifest, null, 2) + "\n"),
  ]);
  const operation = {
    sourcePlan: `data/kw-evaluation/${names.source}`,
    materialization: `data/kw-evaluation/${names.materialization}`,
    manifest: `data/kw-evaluation/${names.manifest}`,
    database: `data/kw-evaluation/${names.database}`,
    output: `data/kw-evaluation/${names.output}`,
    now: now.toISOString(),
  };
  try {
    await assert.rejects(
      executePrivateKwM1WebsiteCheckpoint(operation, { afterCompleteness: () => { throw new Error("injected completeness crash"); } }),
      /injected completeness crash/,
    );
    const rolledBack = new Database(fileURLToPath(files.database), { fileMustExist: true });
    try {
      for (const table of [
        "RevenueArtifactReferenceSnapshotAttempt",
        "RevenueArtifactReferenceCompletenessReceipt",
        "RevenueArtifactReferenceSourceSetProof",
        "RevenueCurrentWebsiteEvidenceEligibilityReceipt",
      ]) {
        assert.equal((rolledBack.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as { count: number }).count, 0, `${table} must roll back after injected crash`);
      }
    } finally {
      rolledBack.close();
    }
    const trackedTables = [
      "RevenueSourceRun", "RevenueBusiness", "RevenueLocation", "RevenueSourceRecord", "RevenuePrivateKwMaterializationReceipt",
      "RevenueWorkflowDefinition", "RevenueWorkflowRun", "RevenueWorkflowDelivery", "RevenueWorkflowAttempt", "RevenueWorkflowLease",
      "RevenueWorkflowReceiptRevision", "RevenueWorkflowAttemptClosure", "RevenueWorkflowStepReceipt", "RevenueWorkflowCheckpointPayload",
      "RevenueWorkflowCheckpoint", "RevenueWorkflowCheckpointStateReceipt", "RevenueWorkflowCheckpointDependency", "RevenueArtifactRecoveryPlan",
      "RevenueArtifactRecoveryReceipt", "RevenueWebsitePageSelection", "RevenueWebsiteSelectedPage", "RevenueWebsitePageCandidate", "RevenueWebsiteAuditAssembly",
      "RevenueArtifactManifest", "RevenueArtifactManifestItem", "RevenueArtifactEvidenceUse", "RevenueArtifactEvidenceUseEnd", "RevenueArtifactPromotionReceipt",
      "RevenueArtifactPromotionUse", "RevenueArtifactManifestEvidenceUse", "RevenueArtifactReleaseRecord", "RevenueArtifactReleaseUse",
      "RevenueArtifactManifestAvailabilityReceipt", "RevenueArtifactReferenceSnapshotAttempt", "RevenueArtifactReferenceCompletenessReceipt",
      "RevenueArtifactReferenceSourceSetProof", "RevenueCurrentWebsiteEvidenceEligibilityReceipt",
    ];
    const countMap = (file: URL, tables: readonly string[]) => {
      const instance = new Database(fileURLToPath(file), { fileMustExist: true });
      try {
        return Object.fromEntries(tables.map((table) => [table, (instance.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as { count: number }).count]));
      } finally {
        instance.close();
      }
    };
    const preFirstCounts = countMap(files.database, trackedTables);
    for (const table of [
      "RevenueArtifactReferenceSnapshotAttempt",
      "RevenueArtifactReferenceCompletenessReceipt",
      "RevenueArtifactReferenceSourceSetProof",
      "RevenueCurrentWebsiteEvidenceEligibilityReceipt",
    ]) assert.equal(preFirstCounts[table], 0, `${table} must be empty before same-file retry`);
    assert.ok((preFirstCounts.RevenueSourceRun ?? 0) > 0, "same-file retry must retain the committed source materialization");
    const first = await executePrivateKwM1WebsiteCheckpoint(operation);
    const firstBytes = await readFile(files.output);
    const postFirstCounts = countMap(files.database, trackedTables);
    const preReplayCounts = countMap(files.database, trackedTables);
    const second = await executePrivateKwM1WebsiteCheckpoint(operation);
    const secondBytes = await readFile(files.output);
    const postReplayCounts = countMap(files.database, trackedTables);
    assert.equal(first.checkpoint.outputExecutionPath, "FRESH_WRITE");
    assert.equal(second.checkpoint.outputExecutionPath, "EXACT_REPLAY");
    assert.deepEqual(secondBytes, firstBytes);
    assert.equal(first.checkpoint.checkpointId, second.checkpoint.checkpointId);
    assert.equal(first.checkpoint.checkpointDigest, second.checkpoint.checkpointDigest);
    assert.deepEqual(first.rowCounts, second.rowCounts);
    assert.deepEqual(postFirstCounts, preReplayCounts);
    assert.deepEqual(preReplayCounts, postReplayCounts);
    for (const [table, count] of Object.entries(postFirstCounts)) assert.equal(first.rowCounts[table], count);
    assert.equal(first.source.executionPath, "EXACT_REPLAY");
    assert.equal(second.source.executionPath, "EXACT_REPLAY");
    assert.equal(first.source.workflowReceiptDigest, first.source.workflowReceiptId.slice("workflow-receipt:".length));
    assert.equal(first.authority.fixtureOnly, true);
    assert.equal(first.authority.synthetic, true);
    assert.equal(first.authority.workerRuntimeConnected, false);
    assert.equal(first.authority.contactDiscoveryExecutionAuthorized, false);
    assert.equal(first.authority.contactVerificationExecutionAuthorized, false);
    assert.equal(first.authority.consentDecisionAuthorized, false);
    assert.equal(first.authority.qualificationExecutionAuthorized, false);
    assert.equal(first.authority.outreachAuthorized, false);
    assert.equal(first.authority.sendAuthorized, false);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.authority), true);
    assert.equal(first.eligibility.executionPath, "FRESH_COMMIT");
    assert.equal(second.eligibility.executionPath, "EXACT_REPLAY");
    assert.equal(first.websiteEvidence.workflowExecutionPath, "FIXTURE");
    assert.equal(first.websiteEvidence.networkOperationsPerformed, 0);
    assert.equal(first.websiteEvidence.providerOperationsAuthorized, 0);
    assert.equal(first.websiteEvidence.costAuthorizedUsd, 0);
    assert.equal(first.authority.providerOperationsAuthorized, 0);
    assert.equal(first.authority.networkOperationsPerformed, 0);
    assert.equal(first.authority.costAuthorizedUsd, 0);
    for (const table of [
      "RevenueArtifactReferenceSnapshotAttempt",
      "RevenueArtifactReferenceCompletenessReceipt",
      "RevenueArtifactReferenceSourceSetProof",
      "RevenueCurrentWebsiteEvidenceEligibilityReceipt",
      "RevenueWorkflowLease",
      "RevenueArtifactManifestAvailabilityReceipt",
      "RevenuePrivateKwMaterializationReceipt",
    ]) assert.equal(typeof first.rowCounts[table], "number", `rowCounts must include ${table}`);
  } finally {
    await Promise.all(Object.values(files).map((file) => rm(file, { force: true })));
  }
});

test("rejects missing or extra operation fields before touching local state", async () => {
  await assert.rejects(
    executePrivateKwM1WebsiteCheckpoint({ sourcePlan: "data/kw-evaluation/plan.json" }),
    /schema|operation|sourcePlan|materialization/i,
  );
});
