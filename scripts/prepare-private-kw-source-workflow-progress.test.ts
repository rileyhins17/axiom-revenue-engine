import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { PrivateKwShadowSlicePhaseReceiptInputSchema } from "../src/lib/revenue-engine/private-kw-shadow-slice-progress";
import { createPrivateKwShadowSourceWorkflowFixture } from "../src/lib/revenue-engine/test-support/private-kw-shadow-source-workflow-fixture";
import { executePrivateKwSourceWorkflowPlanForLocalDatabase } from "./materialize-private-kw-source-workflow";
import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import {
  resolvePrivateKwDataPath,
  resolvePrivateKwDatabasePath,
  writePrivateKwJson,
} from "./private-kw-files";
import { preparePrivateKwSourceWorkflowProgressFile } from "./prepare-private-kw-source-workflow-progress";

function count(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as { count: number }).count;
}

test("the read-only adapter verifies stored receipts and writes one no-overwrite progress input", async () => {
  const suffix = randomUUID();
  const now = new Date();
  const fixture = createPrivateKwShadowSourceWorkflowFixture({ suffix, now });
  const manifestRelative = `data/kw-evaluation/test-progress-manifest-${suffix}.json`;
  const sourceRelative = `data/kw-evaluation/test-progress-source-${suffix}.json`;
  const materializationRelative = `data/kw-evaluation/test-progress-materialization-${suffix}.json`;
  const databaseRelative = `data/kw-evaluation/test-progress-${suffix}.sqlite`;
  const outputRelative = `data/kw-evaluation/test-progress-receipt-${suffix}.json`;
  const manifestFile = resolvePrivateKwDataPath(manifestRelative);
  const sourceFile = resolvePrivateKwDataPath(sourceRelative);
  const materializationFile = resolvePrivateKwDataPath(materializationRelative);
  const databaseFile = resolvePrivateKwDatabasePath(databaseRelative);
  const outputFile = resolvePrivateKwDataPath(outputRelative);

  try {
    await mkdir(path.dirname(databaseFile), { recursive: true });
    await writePrivateKwJson(manifestFile, fixture.manifest);
    await writePrivateKwJson(sourceFile, fixture.source);
    await writePrivateKwJson(materializationFile, fixture.materialization);
    const database = new Database(databaseFile);
    let beforeCounts: { materializations: number; workflowReceipts: number };
    try {
      database.pragma("foreign_keys = ON");
      applyCanonicalPrivateKwMigrations(database);
      const execution = executePrivateKwSourceWorkflowPlanForLocalDatabase(database, fixture.plan);
      assert.equal(execution.executionPath, "FRESH_COMMIT");
      beforeCounts = {
        materializations: count(database, "RevenuePrivateKwMaterializationReceipt"),
        workflowReceipts: count(database, "RevenueWorkflowReceiptRevision"),
      };
    } finally {
      database.close();
    }

    const args = [
      "--manifest", manifestRelative,
      "--source-plan", sourceRelative,
      "--materialization", materializationRelative,
      "--database", databaseRelative,
      "--output", outputRelative,
    ];
    const result = await preparePrivateKwSourceWorkflowProgressFile(args, () => now);
    assert.equal(result.businessId, fixture.plan.businessId);
    assert.equal(result.materializationReceiptId, fixture.plan.materializationId);
    assert.equal(result.workflowReceiptId, fixture.plan.workflowReceiptId);
    assert.equal(result.verifiedRecords, fixture.plan.records.length);
    assert.equal(result.progressRecordingOnly, true);
    assert.equal(result.phaseExecutionAuthorized, false);
    assert.equal(result.databaseMutationAuthorized, false);
    assert.equal(result.providerOperationsAuthorized, 0);
    assert.equal(result.costAuthorizedUsd, 0);

    const saved = PrivateKwShadowSlicePhaseReceiptInputSchema.parse(
      JSON.parse(await readFile(outputFile, "utf8")),
    );
    assert.equal(saved.phase, "SOURCE_WORKFLOW");
    assert.equal(saved.proof.primaryReceiptId, fixture.plan.materializationId);

    const verification = new Database(databaseFile, { readonly: true });
    try {
      assert.deepEqual({
        materializations: count(verification, "RevenuePrivateKwMaterializationReceipt"),
        workflowReceipts: count(verification, "RevenueWorkflowReceiptRevision"),
      }, beforeCounts);
    } finally {
      verification.close();
    }

    await assert.rejects(
      preparePrivateKwSourceWorkflowProgressFile(args, () => now),
      /EEXIST/,
    );
    await assert.rejects(
      preparePrivateKwSourceWorkflowProgressFile([
        "--manifest", manifestRelative,
        "--source-plan", sourceRelative,
        "--materialization", materializationRelative,
        "--database", databaseRelative,
        "--output", manifestRelative,
      ], () => now),
      /must be different files/i,
    );
  } finally {
    await rm(manifestFile, { force: true });
    await rm(sourceFile, { force: true });
    await rm(materializationFile, { force: true });
    await rm(outputFile, { force: true });
    await rm(databaseFile, { force: true });
    await rm(`${databaseFile}-shm`, { force: true });
    await rm(`${databaseFile}-wal`, { force: true });
  }
});
