import assert from "node:assert/strict";
import { lstat, readFile, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";

import Database from "better-sqlite3";

import type { D1DatabaseLike } from "../src/lib/cloudflare";
import { readOwnerLeadDetail } from "../src/lib/revenue-engine/owner-lead-detail-read-model";
import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import {
  resolvePrivateKwDataPath,
  assertPrivateKwOutputFileIdentity,
  writeOrVerifyPrivateKwJson,
} from "./private-kw-files";
import { createPrivateKwLocalD1Adapter } from "./private-kw-local-d1";
import { FIXTURE_BUSINESS_ID, seedOwnerLead } from "./verify-owner-ui-acceptance";

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

test("local D1 drives the owner reader against the materialized current dossier fixture", async () => {
  const databaseHandle = database();
  applyCanonicalPrivateKwMigrations(databaseHandle);
  seedOwnerLead(databaseHandle);
  const adapter = createPrivateKwLocalD1Adapter(databaseHandle);
  const ownerDatabase: D1DatabaseLike = adapter;
  const detail = await readOwnerLeadDetail(ownerDatabase, FIXTURE_BUSINESS_ID, new Date().toISOString());
  assert.ok(detail);
  assert.equal(detail.lead.business.businessId, FIXTURE_BUSINESS_ID);
  assert.equal(detail.lead.business.canonicalName, "Tri-City Roofing Fixture");
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

test("private KW JSON output rejects top-level values that JSON.stringify cannot serialize", async () => {
  const values: unknown[] = [undefined, () => "not JSON", Symbol("not JSON")];
  for (const value of values) {
    const relative = unique("boundary-non-json");
    const file = resolvePrivateKwDataPath(relative);
    try {
      await assert.rejects(writeOrVerifyPrivateKwJson(relative, value), /JSON|serializ|string/i);
      await assert.rejects(lstat(file), { code: "ENOENT" });
    } finally {
      await rm(file, { force: true });
    }
  }
});

test("private KW output identity verification rejects symlinks, non-files, and drift", () => {
  const regular = { isFile: () => true, isSymbolicLink: () => false, dev: BigInt(1), ino: BigInt(2) } as const;
  assert.doesNotThrow(() => assertPrivateKwOutputFileIdentity(regular, regular));
  assert.throws(
    () => assertPrivateKwOutputFileIdentity({ ...regular, isSymbolicLink: () => true }, regular),
    /symbolic|symlink/i,
  );
  assert.throws(
    () => assertPrivateKwOutputFileIdentity({ ...regular, isFile: () => false }, regular),
    /regular file/i,
  );
  assert.throws(
    () => assertPrivateKwOutputFileIdentity({ ...regular, ino: BigInt(3) }, regular),
    /identity|changed|race/i,
  );
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
