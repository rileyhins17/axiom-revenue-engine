import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

const migrationRoot = new URL("../migrations/", import.meta.url);
const migrationFiles = readdirSync(migrationRoot)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

function applyMigration(database: Database.Database, name: string) {
  database.exec(readFileSync(new URL(name, migrationRoot), "utf8"));
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function snapshotExistingRows(database: Database.Database) {
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;

  return new Map(tables.map(({ name }) => {
    const columns = database.pragma(`table_info(${quoteIdentifier(name)})`) as Array<{ name: string }>;
    const query = `SELECT ${columns.map((column) => quoteIdentifier(column.name)).join(", ")} FROM ${quoteIdentifier(name)}`;
    const rows = (database.prepare(query).all() as Array<Record<string, unknown>>)
      .map((row) => JSON.stringify(row))
      .sort();
    return [name, { columns: columns.map((column) => column.name), rows }] as const;
  }));
}

test("an existing 0055 staging-shaped database retains its rows and stops through 0074", () => {
  const baseline = migrationFiles.filter((name) => name.slice(0, 4) <= "0055");
  const upgrade = migrationFiles.filter((name) => name.slice(0, 4) > "0055" && name.slice(0, 4) <= "0074");
  assert.equal(baseline.length, 55);
  assert.equal(baseline.at(-1), "0055_outreach_human_approval.sql");
  assert.equal(upgrade.length, 19);
  assert.equal(upgrade.at(-1), "0074_revenue_owner_observed_replies.sql");

  const database = new Database(":memory:");
  try {
    database.pragma("foreign_keys = ON");
    for (const name of baseline) applyMigration(database, name);

    database.exec(`
      INSERT INTO "User" ("id", "name", "email", "role", "updatedAt")
      VALUES ('fixture-admin', 'Fixture Admin', 'owner@example.test', 'admin', '2026-09-23T00:00:00.000Z');
      INSERT INTO "OutreachAutomationSetting"
        ("id", "enabled", "globalPaused", "emergencyPaused", "intakePaused", "followUpsPaused", "updatedAt")
      VALUES ('fixture-stops', 0, 1, 1, 1, 1, '2026-09-23T00:00:00.000Z');
      INSERT INTO "RevenueBusiness" ("id", "canonicalName", "normalizedDomain")
      VALUES ('fixture-business-1', 'Fixture Heating', 'example.test'),
             ('fixture-business-2', 'Fixture Roofing', 'example.org');
      INSERT INTO "RevenueContactPoint"
        ("id", "businessId", "channel", "value", "sourceUrl", "sourceCapturedAt", "automationPermitted")
      VALUES ('fixture-contact-1', 'fixture-business-1', 'EMAIL', 'info@example.test',
              'https://example.test/contact', '2026-09-23T00:00:00.000Z', 0),
             ('fixture-contact-2', 'fixture-business-2', 'EMAIL', 'info@example.org',
              'https://example.org/contact', '2026-09-23T00:00:00.000Z', 0);
      INSERT INTO "RevenueVerificationResult"
        ("id", "contactPointId", "provider", "status", "verifiedAt")
      VALUES ('fixture-verification', 'fixture-contact-1', 'FIXTURE', 'UNKNOWN', '2026-09-23T00:00:00.000Z');
      INSERT INTO "RevenueWebsiteSnapshot"
        ("id", "businessId", "url", "classification", "auditVersion", "capturedAt", "refreshAfter")
      VALUES ('fixture-website', 'fixture-business-1', 'https://example.test/', 'UNKNOWN', 'fixture-v1',
              '2026-09-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z');
      INSERT INTO "RevenueEvidenceClaim"
        ("id", "businessId", "websiteSnapshotId", "category", "observation", "sourceUrl", "method", "confidence", "auditVersion", "capturedAt")
      VALUES ('fixture-claim', 'fixture-business-1', 'fixture-website', 'WEBSITE', 'Fixture observation',
              'https://example.test/', 'OWNER_REVIEW', 50, 'fixture-v1', '2026-09-23T00:00:00.000Z');
      INSERT INTO "RevenueQualificationSnapshot"
        ("id", "snapshotKey", "businessId", "policyVersion", "totalScore", "rebuildNeedScore", "businessFitScore", "reachabilityScore", "timingScore", "evidenceConfidenceScore", "band", "recommendedChannel", "supportedObservationCount", "conversionCriticalCount")
      VALUES ('fixture-qualification', 'fixture-key', 'fixture-business-1', 'fixture-v1',
              0, 0, 0, 0, 0, 0, 'UNKNOWN', 'NONE', 0, 0);
    `);

    const before = snapshotExistingRows(database);
    assert.deepEqual(database.pragma("foreign_key_check"), []);
    for (const name of upgrade) applyMigration(database, name);

    for (const [name, snapshot] of before) {
      const current = database.prepare(
        `SELECT ${snapshot.columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(name)}`,
      ).all() as Array<Record<string, unknown>>;
      assert.deepEqual(current.map((row) => JSON.stringify(row)).sort(), snapshot.rows, `${name} changed during upgrade`);
    }
    assert.deepEqual(database.pragma("foreign_key_check"), []);
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(database.prepare(
      `SELECT "enabled", "globalPaused", "emergencyPaused", "intakePaused", "followUpsPaused"
       FROM "OutreachAutomationSetting" WHERE "id" = 'fixture-stops'`,
    ).get(), { enabled: 0, globalPaused: 1, emergencyPaused: 1, intakePaused: 1, followUpsPaused: 1 });
    assert.deepEqual(database.prepare(
      `SELECT "persistenceVersion", "discoveryReceiptId", "candidateId", "evidenceMode"
       FROM "RevenueContactPoint" WHERE "id" = 'fixture-contact-1'`,
    ).get(), { persistenceVersion: null, discoveryReceiptId: null, candidateId: null, evidenceMode: "LEGACY" });
    assert.deepEqual(database.prepare(
      `SELECT "persistenceVersion", "verificationResultId", "evidenceMode"
       FROM "RevenueVerificationResult" WHERE "id" = 'fixture-verification'`,
    ).get(), { persistenceVersion: null, verificationResultId: null, evidenceMode: "LEGACY" });
    for (const table of ["RevenueWebsiteSnapshot", "RevenueEvidenceClaim", "RevenueQualificationSnapshot"]) {
      const row = database.prepare(`SELECT "evidenceMode" FROM ${quoteIdentifier(table)}`).get() as { evidenceMode: string };
      assert.equal(row.evidenceMode, "LEGACY");
    }

    const fingerprint = "a".repeat(64);
    const addReply = database.prepare(`
      INSERT INTO "RevenueOwnerObservedReply"
        ("replyId", "businessId", "contactPointId", "contactFingerprint", "idempotencyKey", "category",
         "summary", "observedAt", "owner", "actionText", "dueAt", "actorUserId", "taskId")
      VALUES (?, ?, ?, ?, ?, 'QUESTION', 'Fixture reply', '2026-09-23T12:00:00.000Z',
              'RILEY', 'Review fixture', '2026-09-24T12:00:00.000Z', 'fixture-admin', ?)
    `);
    addReply.run("fixture-reply-1", "fixture-business-1", "fixture-contact-1", fingerprint, "fixture-key-1", "fixture-task-1");
    assert.deepEqual(database.prepare(
      `SELECT "taskId", "businessId", "idempotencyKey" FROM "RevenueOwnerTask" WHERE "taskId" = 'fixture-task-1'`,
    ).get(), { taskId: "fixture-task-1", businessId: "fixture-business-1", idempotencyKey: "owner-reply:fixture-key-1" });

    database.prepare(`
      INSERT INTO "RevenueBusinessStopEvent"
        ("stopId", "businessId", "idempotencyKey", "reason", "note", "actorUserId")
      VALUES ('fixture-stop', 'fixture-business-1', 'fixture-stop-key', 'OWNER_DECISION', 'Fixture stop', 'fixture-admin')
    `).run();
    assert.throws(() => addReply.run(
      "fixture-reply-2", "fixture-business-1", "fixture-contact-1", fingerprint, "fixture-key-2", "fixture-task-2",
    ), /REVENUE_OWNER_REPLY_BUSINESS_STOPPED/);

    database.prepare(`
      INSERT INTO "RevenueContactSuppressionEvent"
        ("suppressionId", "businessId", "contactPointId", "contactFingerprint", "idempotencyKey",
         "reason", "note", "actorUserId", "observedAt")
      VALUES ('fixture-suppression', 'fixture-business-2', 'fixture-contact-2', ?, 'fixture-suppression-key',
              'UNSUBSCRIBE', 'Fixture stop', 'fixture-admin', '2026-09-23T12:00:00.000Z')
    `).run(fingerprint);
    assert.throws(() => addReply.run(
      "fixture-reply-3", "fixture-business-2", "fixture-contact-2", fingerprint, "fixture-key-3", "fixture-task-3",
    ), /REVENUE_OWNER_REPLY_CONTACT_SUPPRESSED/);
    const taskCount = database.prepare("SELECT COUNT(*) AS count FROM RevenueOwnerTask").get() as { count: number };
    assert.equal(taskCount.count, 1);
  } finally {
    database.close();
  }
});
