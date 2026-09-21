import assert from "node:assert/strict";
import test from "node:test";

import { executePrivateKwLocalDurableEvidencePlan } from "./private-kw-local-plan-executor";

test("guarded local plan executor rejects divergent alternate identities instead of ignoring them", () => {
  const database = {
    prepare() {
      return {
        all() { return [{ id: "same", value: "different" }, { id: "same", value: "different-2" }]; },
      };
    },
  } as never;
  const plan = {
    preflights: [{
      preflightId: "preflight:test",
      entity: "WORKFLOW_RUN",
      recordId: "same",
      selectSql: "SELECT \"id\", \"value\" FROM \"RevenueWorkflowRun\" WHERE \"id\" = ?",
      bindings: ["same"],
      expected: { id: "same", value: "expected" },
      expectedFingerprint: "0".repeat(64),
      rejectMultipleMatches: true,
    }],
    mutations: [{
      statementId: "insert:test",
      entity: "WORKFLOW_RUN",
      recordId: "same",
      sql: "INSERT OR IGNORE INTO \"RevenueWorkflowRun\" (\"id\", \"value\") VALUES (?, ?)",
      bindings: ["same", "expected"],
      operation: "INSERT_IF_ABSENT",
    }],
  };
  assert.throws(
    () => executePrivateKwLocalDurableEvidencePlan(database, plan as never),
    /multiple|conflict|alternate/i,
  );
});
