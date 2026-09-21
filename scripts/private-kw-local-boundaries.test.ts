import assert from "node:assert/strict";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import Database from "better-sqlite3";

import type { D1DatabaseLike } from "../src/lib/cloudflare";
import type { RevenueLeadAssessmentD1Boundary } from "../src/lib/revenue-engine/lead-assessment-d1";
import { readOwnerLeadDetail } from "../src/lib/revenue-engine/owner-lead-detail-read-model";
import type { PrivateKwWebsiteEvidenceEligibilityD1Boundary } from "../src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1";
import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import {
  resolvePrivateKwDataPath,
  writeOrVerifyPrivateKwJson,
} from "./private-kw-files";
import { createPrivateKwLocalD1Adapter } from "./private-kw-local-d1";

let sequence = 0;
function unique(relativePrefix: string) {
  sequence += 1;
  return `data/kw-evaluation/${relativePrefix}-${process.pid}-${Date.now()}-${sequence}.json`;
}

function database() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  return database;
}

test("local D1 uses only the supplied handle and preserves ordered atomic batch semantics", async () => {
  const first = database();
  const second = database();
  first.exec('CREATE TABLE "items" ("id" INTEGER PRIMARY KEY, "label" TEXT NOT NULL)');
  second.exec('CREATE TABLE "items" ("id" INTEGER PRIMARY KEY, "label" TEXT NOT NULL)');
  const adapter = createPrivateKwLocalD1Adapter(first);

  const results = await adapter.batch([
    { sql: 'INSERT INTO "items" ("label") VALUES (?)', bindings: ["alpha"] },
    { sql: 'SELECT "id", "label" FROM "items" ORDER BY "id"', bindings: [] },
    { sql: 'INSERT INTO "items" ("label") VALUES (?)', bindings: ["beta"] },
    { sql: 'SELECT COUNT(*) AS "count" FROM "items"', bindings: [] },
  ]);
  assert.deepEqual(results.map((result) => result.changes), [1, 0, 1, 0]);
  assert.deepEqual(results[1]?.results, [{ id: 1, label: "alpha" }]);
  assert.deepEqual(results[3]?.results, [{ count: 2 }]);
  assert.equal((second.prepare('SELECT COUNT(*) AS "count" FROM "items"').get() as { count: number }).count, 0);

  await assert.rejects(
    adapter.batch([
      { sql: 'INSERT INTO "items" ("label") VALUES (?)', bindings: ["rolled back"] },
      { sql: 'INSERT INTO "missing" ("label") VALUES (?)', bindings: ["boom"] },
    ]),
    /no such table: missing/,
  );
  assert.equal((first.prepare('SELECT COUNT(*) AS "count" FROM "items"').get() as { count: number }).count, 2);
  first.close();
  second.close();
});

test("local D1 prepared statements implement bound values, first, run, and metadata", async () => {
  const databaseHandle = database();
  databaseHandle.exec('CREATE TABLE "items" ("id" INTEGER PRIMARY KEY, "label" TEXT, "score" REAL)');
  const adapter = createPrivateKwLocalD1Adapter(databaseHandle);
  const mutation = await adapter.prepare('INSERT INTO "items" ("label", "score") VALUES (?, ?)').bind("value", 1.5).run();
  assert.deepEqual(mutation, { meta: { changes: 1, last_row_id: 1 } });
  assert.deepEqual(await adapter.prepare('SELECT "id", "label" FROM "items" WHERE "id" = ?').bind(1).first(), { id: 1, label: "value" });
  assert.equal(await adapter.prepare('SELECT "label" FROM "items" WHERE "id" = ?').bind(99).first(), null);
  assert.deepEqual((await adapter.prepare('SELECT "id", "label" FROM "items"').bind().all()).results, [{ id: 1, label: "value" }]);
  for (const value of [undefined, {}, [], Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => adapter.prepare("SELECT ?").bind(value), /unsupported SQLite binding/i);
  }
  databaseHandle.close();
  assert.throws(() => adapter.prepare("SELECT 1"), /closed/);
});

test("local D1 remains assignable to the eligibility, assessment, and owner reader boundaries", async () => {
  const databaseHandle = database();
  applyCanonicalPrivateKwMigrations(databaseHandle);
  const adapter = createPrivateKwLocalD1Adapter(databaseHandle);
  const eligibility: PrivateKwWebsiteEvidenceEligibilityD1Boundary = adapter;
  const assessment: RevenueLeadAssessmentD1Boundary = adapter;
  const ownerDatabase: D1DatabaseLike = adapter;
  const eligibilityResult = await eligibility.batch([{ statementId: "test", sql: "SELECT 1 AS \"ok\"", bindings: [] }]);
  const assessmentResult = await assessment.batch([{ statementId: "test", sql: "SELECT 1 AS \"ok\"", bindings: [] }]);
  assert.equal((eligibilityResult[0] as { success: boolean }).success, true);
  assert.equal((assessmentResult[0] as { success: boolean }).success, true);
  assert.equal(await readOwnerLeadDetail(ownerDatabase, "business:missing", "2026-09-21T12:00:00.000Z"), null);
  databaseHandle.close();
});

test("private KW JSON output writes exact bytes and accepts only exact replay", async () => {
  const relative = unique("boundary-output");
  const file = resolvePrivateKwDataPath(relative);
  try {
    assert.deepEqual(await writeOrVerifyPrivateKwJson(relative, { b: 2, a: ["x"] }), { file, executionPath: "FRESH_WRITE" });
    const expected = '{\n  "b": 2,\n  "a": [\n    "x"\n  ]\n}\n';
    assert.equal((await readFile(file, "utf8")), expected);
    assert.deepEqual(await writeOrVerifyPrivateKwJson(relative, { b: 2, a: ["x"] }), { file, executionPath: "EXACT_REPLAY" });
    await writeFile(file, '{"b":2,"a":["x"]}\n', "utf8");
    await assert.rejects(writeOrVerifyPrivateKwJson(relative, { b: 2, a: ["x"] }), /conflict|exact/i);
    assert.equal(await readFile(file, "utf8"), '{"b":2,"a":["x"]}\n');
  } finally {
    await rm(file, { force: true });
  }
});

test("private KW JSON output rejects malformed, truncated, symlinked, and oversized existing files without overwrite", async (t) => {
  const cases = [
    ["malformed", "{\n"],
    ["truncated", '{\n  "ok":'],
  ] as const;
  for (const [name, contents] of cases) {
    const relative = unique(`boundary-${name}`);
    const file = resolvePrivateKwDataPath(relative);
    try {
      await writeFile(file, contents, "utf8");
      await assert.rejects(writeOrVerifyPrivateKwJson(relative, { ok: true }), /malformed|invalid|exact|conflict/i);
      assert.equal(await readFile(file, "utf8"), contents);
    } finally {
      await rm(file, { force: true });
    }
  }

  const oversized = unique("boundary-oversized");
  const oversizedFile = resolvePrivateKwDataPath(oversized);
  try {
    await writeFile(oversizedFile, "0123456789", "utf8");
    await assert.rejects(writeOrVerifyPrivateKwJson(oversized, "x", 4), /larger|size/i);
    assert.equal(await readFile(oversizedFile, "utf8"), "0123456789");
  } finally {
    await rm(oversizedFile, { force: true });
  }

  const target = unique("boundary-symlink-target");
  const link = unique("boundary-symlink");
  const targetFile = resolvePrivateKwDataPath(target);
  const linkFile = resolvePrivateKwDataPath(link);
  try {
    await writeFile(targetFile, '{\n  "ok": true\n}\n', "utf8");
    try {
      await symlink(targetFile, linkFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("Windows symlink creation requires the developer-mode privilege in this environment.");
        return;
      }
      throw error;
    }
    await assert.rejects(writeOrVerifyPrivateKwJson(link, { ok: true }), /symbolic|symlink/i);
    assert.equal(await readFile(targetFile, "utf8"), '{\n  "ok": true\n}\n');
  } finally {
    await rm(linkFile, { force: true });
    await rm(targetFile, { force: true });
  }
});
