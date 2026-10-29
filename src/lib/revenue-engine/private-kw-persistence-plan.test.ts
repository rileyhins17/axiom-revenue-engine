import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
  type PrivateKwImportInput,
} from "@/lib/revenue-engine/private-kw-import";
import {
  buildPrivateKwPersistencePlan,
  verifyPersistencePreflight,
} from "@/lib/revenue-engine/private-kw-persistence-plan";

function sourceInput(): PrivateKwImportInput {
  return {
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: "kw-persistence-fixture",
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic persistence plan fixture",
    filters: { synthetic: true },
    capturedAt: "2026-08-22T21:00:00.000Z",
    costUsd: 0,
    records: [{
      sourceOwnedId: "synthetic-roofer-1",
      sourceEvidenceUrl: "https://example.com/source/roofer-1",
      businessName: "Synthetic Kitchener Roofing Inc.",
      city: "KITCHENER",
      region: "ON",
      country: "CA",
      niche: "ROOFING",
      websiteUrl: "https://synthetic-roofing.ca",
      phone: "519-555-0199",
      addressLine: "99 Test Street",
      postalCode: "N2G 1A1",
      independenceStatus: "UNKNOWN",
      capturedAt: "2026-08-22T20:55:00.000Z",
      sourcePayload: { synthetic: true, listingId: "fixture-1" },
    }],
  };
}

function freshShadowDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  const migration = readFileSync(
    new URL("../../../migrations/0054_revenue_shadow_kernel.sql", import.meta.url),
    "utf8",
  );
  database.exec(migration);
  return database;
}

function tableCount(database: Database.Database, table: "RevenueSourceRun" | "RevenueBusiness" | "RevenueLocation" | "RevenueSourceRecord") {
  return (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
}

test("builds deterministic preflight plus insert-if-absent plans with no authority", () => {
  const source = preparePrivateKwImport(sourceInput());
  const first = buildPrivateKwPersistencePlan(source);
  const second = buildPrivateKwPersistencePlan(source);
  assert.deepEqual(first, second);
  assert.equal(first.targetSchemaVersion, "0054_revenue_shadow_kernel");
  assert.equal(first.mutationAuthorized, false);
  assert.equal(first.requiresExactPreflightMatch, true);
  assert.equal(first.preflights.length, 4);
  assert.equal(first.mutations.length, 4);
  assert.equal(first.summary.qualificationRows, 0);
  assert.equal(first.summary.contactRows, 0);
  assert.equal(first.summary.outreachRows, 0);
  assert.equal(first.summary.costUsd, 0);
  assert.ok(first.mutations.every((item) => item.sql.startsWith("INSERT OR IGNORE INTO")));
  assert.ok(first.mutations.every((item) => !/Qualification|ContactPoint|Outreach|Email/i.test(item.sql)));
});

test("planned SQL matches migration 0054 and remains idempotent in isolated memory", () => {
  const plan = buildPrivateKwPersistencePlan(preparePrivateKwImport(sourceInput()));
  const database = freshShadowDatabase();
  try {
    for (const item of plan.preflights) {
      const existing = database.prepare(item.selectSql).all(...item.bindings) as Record<string, unknown>[];
      assert.deepEqual(verifyPersistencePreflight(item, existing), { state: "MISSING", matches: true });
    }
    for (const item of plan.mutations) database.prepare(item.sql).run(...item.bindings);

    assert.equal(tableCount(database, "RevenueSourceRun"), 1);
    assert.equal(tableCount(database, "RevenueBusiness"), 1);
    assert.equal(tableCount(database, "RevenueLocation"), 1);
    assert.equal(tableCount(database, "RevenueSourceRecord"), 1);
    assert.deepEqual(
      database.prepare('SELECT "status", "qualifiedCount", "costUsd" FROM "RevenueSourceRun"').get(),
      { status: "PREPARED", qualifiedCount: 0, costUsd: 0 },
    );
    assert.equal((database.prepare('SELECT "status" FROM "RevenueBusiness"').get() as { status: string }).status, "RESEARCH_ONLY");

    for (const item of plan.preflights) {
      const existing = database.prepare(item.selectSql).all(...item.bindings) as Record<string, unknown>[];
      assert.deepEqual(verifyPersistencePreflight(item, existing), { state: "EXACT_MATCH", matches: true });
    }
    for (const item of plan.mutations) database.prepare(item.sql).run(...item.bindings);
    assert.equal(tableCount(database, "RevenueBusiness"), 1);
    assert.equal(tableCount(database, "RevenueSourceRecord"), 1);
  } finally {
    database.close();
  }
});

test("preflight fingerprint detects drift before an insert can be treated as idempotent", () => {
  const plan = buildPrivateKwPersistencePlan(preparePrivateKwImport(sourceInput()));
  const database = freshShadowDatabase();
  try {
    for (const item of plan.mutations) database.prepare(item.sql).run(...item.bindings);
    database.prepare('UPDATE "RevenueBusiness" SET "canonicalName" = ?').run("Conflicting Name");
    const businessCheck = plan.preflights.find((item) => item.entity === "BUSINESS");
    assert.ok(businessCheck);
    const existing = database.prepare(businessCheck.selectSql).all(...businessCheck.bindings) as Record<string, unknown>[];
    assert.deepEqual(verifyPersistencePreflight(businessCheck, existing), { state: "CONFLICT", matches: false });
  } finally {
    database.close();
  }
});

test("preflight detects unique-domain and source-owned-ID collisions under different record IDs", () => {
  const plan = buildPrivateKwPersistencePlan(preparePrivateKwImport(sourceInput()));
  const database = freshShadowDatabase();
  try {
    const businessMutation = plan.mutations.find((item) => item.entity === "BUSINESS");
    const businessCheck = plan.preflights.find((item) => item.entity === "BUSINESS");
    assert.ok(businessMutation && businessCheck);
    const normalizedDomain = businessMutation.bindings[2];
    database.prepare(`
      INSERT INTO "RevenueBusiness"
        ("id", "canonicalName", "normalizedDomain", "normalizedPhone", "independenceStatus", "status")
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("business:conflict", "Conflicting Business", normalizedDomain, null, "UNKNOWN", "RESEARCH_ONLY");
    const domainConflict = database.prepare(businessCheck.selectSql).all(...businessCheck.bindings) as Record<string, unknown>[];
    assert.deepEqual(verifyPersistencePreflight(businessCheck, domainConflict), { state: "CONFLICT", matches: false });

    const sourceRunMutation = plan.mutations.find((item) => item.entity === "SOURCE_RUN");
    const sourceRecordMutation = plan.mutations.find((item) => item.entity === "SOURCE_RECORD");
    const sourceRecordCheck = plan.preflights.find((item) => item.entity === "SOURCE_RECORD");
    assert.ok(sourceRunMutation && sourceRecordMutation && sourceRecordCheck);
    database.prepare(sourceRunMutation.sql).run(...sourceRunMutation.bindings);
    database.prepare(`
      INSERT INTO "RevenueSourceRecord"
        ("id", "sourceRunId", "sourceOwnedId", "businessId", "rawPayloadJson", "identitySignalsJson", "capturedAt")
      VALUES (?, ?, ?, NULL, '{}', '{}', ?)
    `).run("source-record:conflict", sourceRecordMutation.bindings[1], sourceRecordMutation.bindings[2], "2026-08-22T20:55:00.000Z");
    const sourceConflict = database.prepare(sourceRecordCheck.selectSql).all(...sourceRecordCheck.bindings) as Record<string, unknown>[];
    assert.deepEqual(verifyPersistencePreflight(sourceRecordCheck, sourceConflict), { state: "CONFLICT", matches: false });
  } finally {
    database.close();
  }
});

test("preflight rejects multiple identity matches even when the first row is exact", () => {
  const plan = buildPrivateKwPersistencePlan(preparePrivateKwImport(sourceInput()));
  const database = freshShadowDatabase();
  try {
    for (const item of plan.mutations) database.prepare(item.sql).run(...item.bindings);
    const businessCheck = plan.preflights.find((item) => item.entity === "BUSINESS");
    const businessMutation = plan.mutations.find((item) => item.entity === "BUSINESS");
    assert.ok(businessCheck && businessMutation);

    database.prepare(`
      INSERT INTO "RevenueBusiness"
        ("id", "canonicalName", "normalizedDomain", "normalizedPhone", "independenceStatus", "status")
      VALUES (?, ?, NULL, ?, ?, ?)
    `).run(
      "business:alternate-phone-collision",
      "Alternate Collision",
      businessMutation.bindings[3],
      "UNKNOWN",
      "RESEARCH_ONLY",
    );

    const matches = database.prepare(businessCheck.selectSql).all(...businessCheck.bindings) as Record<string, unknown>[];
    assert.equal(matches.length, 2);
    assert.deepEqual(verifyPersistencePreflight(businessCheck, matches), { state: "CONFLICT", matches: false });
  } finally {
    database.close();
  }
});
