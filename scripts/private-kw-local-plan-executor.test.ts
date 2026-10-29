import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import test from "node:test";

import {
  DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
  DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
  buildDurableEvidencePersistencePlan,
} from "../src/lib/revenue-engine/durable-evidence-persistence-plan";
import { createPrivateKwCurrentWebsiteEvidenceFixture } from "../src/lib/revenue-engine/test-support/private-kw-current-website-evidence-fixture";
import { executePrivateKwLocalDurableEvidencePlan } from "./private-kw-local-plan-executor";

function sqliteType(value: unknown) {
  return typeof value === "number" ? "INTEGER" : "TEXT";
}

test("guarded local plan executor reaches collision-complete duplicate detection", async () => {
  const fixture = await createPrivateKwCurrentWebsiteEvidenceFixture({
    suffix: "executor-" + Date.now().toString(36),
    now: new Date(Date.now() - 3.8 * 60_000),
  });
  const plan = buildDurableEvidencePersistencePlan({
    ...fixture.durableEvidenceRequest,
    persistencePlanVersion: DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
  });
  const database = new Database(":memory:");
  try {
    const tableColumns = new Map<string, Map<string, string>>();
    for (const preflight of plan.preflights) {
      const match = /\bFROM\s+"([A-Za-z0-9_]+)"/i.exec(preflight.selectSql);
      const table = match?.[1];
      if (!table) throw new Error("Test fixture could not identify preflight table: " + preflight.selectSql);
      const columns = tableColumns.get(table) ?? new Map<string, string>();
      for (const [column, value] of Object.entries(preflight.expected)) columns.set(column, sqliteType(value));
      tableColumns.set(table, columns);
    }
    for (const [table, columns] of tableColumns) {
      const columnSql = [...columns.entries()].map(([column, type]) => "\"" + column + "\" " + type).join(", ");
      database.exec("CREATE TABLE \"" + table + "\" (" + columnSql + ")");
    }
    const workflowPreflight = plan.preflights.find((item) => item.entity === "WORKFLOW_RUN");
    assert.ok(workflowPreflight);
    const columns = Object.keys(workflowPreflight.expected);
    const quotedColumns = columns.map((column) => "\"" + column + "\"").join(", ");
    const insert = database.prepare("INSERT INTO \"RevenueWorkflowRun\" (" + quotedColumns + ") VALUES (" + columns.map(() => "?").join(", ") + ")");
    insert.run(...Object.values(workflowPreflight.expected));
    insert.run(...columns.map((column) => column === "id"
      ? "alternate-" + createHash("sha256").update(workflowPreflight.recordId).digest("hex")
      : workflowPreflight.expected[column]));
    assert.equal((database.prepare("SELECT COUNT(*) AS \"count\" FROM \"RevenueWorkflowRun\"").get() as { count: number }).count, 2);
    assert.throws(
      () => executePrivateKwLocalDurableEvidencePlan(database, plan),
      /duplicate or divergent alternate identity/,
    );
    assert.equal((database.prepare("SELECT COUNT(*) AS \"count\" FROM \"RevenueWorkflowRun\"").get() as { count: number }).count, 2, "collision detection must reject before mutation");
  } finally {
    database.close();
  }
});
