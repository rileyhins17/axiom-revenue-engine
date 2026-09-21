import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import { readOwnerLeadList } from "../src/lib/revenue-engine/owner-lead-read-model";
import { readOwnerLeadDetail } from "../src/lib/revenue-engine/owner-lead-detail-read-model";
import { createPrivateKwLocalD1Adapter } from "./private-kw-local-d1";
import { FIXTURE_BUSINESS_ID, seedOwnerLead } from "./verify-owner-ui-acceptance";

const migrationRoot = new URL("../migrations/", import.meta.url);
function migrate(database: Database.Database, from: number, to: number) {
  for (const file of readdirSync(migrationRoot).filter((name) => /^\d{4}_.*\.sql$/.test(name)
    && Number(name.slice(0, 4)) >= from && Number(name.slice(0, 4)) <= to).sort()) {
    database.exec(readFileSync(new URL(file, migrationRoot), "utf8"));
  }
}

// These are deliberately constructed reader fixtures, not evidence of an M2 writer.
// Remove/restore only in-memory insert guards to add hostile projected rows.
function cloneRow(database: Database.Database, table: string, overrides: Record<string, unknown>) {
  const original = database.prepare(`SELECT * FROM "${table}" ORDER BY id LIMIT 1`).get() as Record<string, unknown>;
  assert(original, `Missing fixture row: ${table}`);
  const row = { ...original, ...overrides };
  const guards = database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?")
    .all(table) as { name: string; sql: string }[];
  try {
    for (const guard of guards) database.exec(`DROP TRIGGER "${guard.name}"`);
    database.prepare(`INSERT INTO "${table}" (${Object.keys(row).map((key) => `"${key}"`).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`)
      .run(...Object.values(row));
  } catch (error) {
    throw new Error(`Reader fixture ${table}: ${String(error)}`, { cause: error });
  } finally { for (const guard of guards) database.exec(guard.sql); }
}

test("real owner readers preserve 0068 dossiers when newer M2 rows are added on 0069", async () => {
  const database = new Database(":memory:");
  try {
    database.pragma("foreign_keys = ON");
    migrate(database, 54, 68);
    seedOwnerLead(database);
    const adapter = createPrivateKwLocalD1Adapter(database);
    const now = new Date().toISOString();
    const baselineList = await readOwnerLeadList(adapter, now);
    const baselineDetail = await readOwnerLeadDetail(adapter, FIXTURE_BUSINESS_ID, now);
    assert.equal(baselineList.leads.length, 1);
    assert(baselineDetail);
    assert(baselineDetail.routes.length > 0);
    migrate(database, 69, 69);
    assert.deepEqual(await readOwnerLeadList(adapter, now), baselineList);
    assert.deepEqual(await readOwnerLeadDetail(adapter, FIXTURE_BUSINESS_ID, now), baselineDetail);

    cloneRow(database, "RevenueWebsiteSnapshot", {
      id: "website:m2-projection", evidenceMode: "M2_HTML_ONLY", capturedAt: now,
      deterministicChecksJson: "{}", classification: "NO_OPPORTUNITY",
    });
    cloneRow(database, "RevenueQualificationSnapshot", {
      id: "qualification:m2-projection", snapshotKey: "m2-projection", evidenceMode: "M2_HTML_ONLY", createdAt: now,
    });
    const contact = database.prepare('SELECT * FROM RevenueContactPoint ORDER BY id LIMIT 1').get() as Record<string, unknown>;
    const discoveryJson = database.prepare('SELECT resultJson FROM RevenueContactDiscoveryReceipt ORDER BY id LIMIT 1').pluck().get() as string;
    cloneRow(database, "RevenueContactDiscoveryReceipt", {
      id: "discovery:m2-projection",
      requestId: "request:m2-projection",
      resultJson: JSON.stringify({ ...JSON.parse(discoveryJson), discoveryResultId: "discovery:m2-projection", requestId: "request:m2-projection" }),
    });
    cloneRow(database, "RevenueContactPoint", {
      id: "contact:m2-projection", evidenceMode: "M2_HTML_ONLY", discoveryReceiptId: "discovery:m2-projection",
      sourceCapturedAt: now, createdAt: now,
    });
    cloneRow(database, "RevenueVerificationResult", {
      id: "verification:m2-projection", evidenceMode: "M2_HTML_ONLY", verificationResultId: "m2-projection",
      contactPointId: contact.id, verifiedAt: now,
    });
    assert.deepEqual(database.pragma("foreign_key_check"), []);
    const before = database.serialize();
    assert.deepEqual(await readOwnerLeadList(adapter, now), baselineList);
    assert.deepEqual(await readOwnerLeadDetail(adapter, FIXTURE_BUSINESS_ID, now), baselineDetail);
    assert.deepEqual(database.serialize(), before);
    for (const table of ["RevenueWebsiteSnapshot", "RevenueQualificationSnapshot"]) {
      const guards = database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?")
        .all(table) as { name: string; sql: string }[];
      try {
        for (const guard of guards) database.exec(`DROP TRIGGER "${guard.name}"`);
        database.exec(`UPDATE "${table}" SET evidenceMode = 'M2_HTML_ONLY'`);
      } finally { for (const guard of guards) database.exec(guard.sql); }
    }
    const htmlOnly = database.serialize();
    assert.equal((await readOwnerLeadList(adapter, now)).leads.length, 0);
    assert.equal(await readOwnerLeadDetail(adapter, FIXTURE_BUSINESS_ID, now), null);
    assert.deepEqual(database.serialize(), htmlOnly);
  } finally { database.close(); }
});

test("reader metadata failure propagates without executing dossier queries", async () => {
  const queries: string[] = [];
  const database = {
    prepare(query: string): never {
      queries.push(query);
      throw new Error("metadata unavailable");
    },
  };
  await assert.rejects(() => readOwnerLeadList(database, new Date().toISOString()), /metadata unavailable/);
  await assert.rejects(() => readOwnerLeadDetail(database, FIXTURE_BUSINESS_ID, new Date().toISOString()), /metadata unavailable/);
  assert(queries.every((query) => query.startsWith("PRAGMA table_info")));
});
