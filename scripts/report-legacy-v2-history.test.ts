import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Database from "better-sqlite3";

import { normalizeLegacySqliteUtcTimestamp, reportLegacyV2History, resolveLegacyReportPath, resolveLegacySnapshotPath } from "./report-legacy-v2-history";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const asOf = "2026-09-22T12:00:00.000Z";

function fixture(file: string) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE "Lead" ("id" INTEGER PRIMARY KEY, "websiteDomain" TEXT, "phone" TEXT, "email" TEXT, "outreachStatus" TEXT, "firstContactedAt" TEXT, "lastContactedAt" TEXT, "lastReplyAt" TEXT, "createdAt" TEXT);
    CREATE TABLE "OutreachSuppression" ("id" TEXT PRIMARY KEY, "domain" TEXT, "email" TEXT, "leadId" INTEGER, "reason" TEXT, "createdAt" TEXT, "expiresAt" TEXT);
    CREATE TABLE "OutreachEmail" ("id" TEXT PRIMARY KEY, "leadId" INTEGER, "status" TEXT, "sentAt" TEXT, "subject" TEXT, "bodyPlain" TEXT);
    CREATE TABLE "OutreachSequence" ("id" TEXT PRIMARY KEY, "leadId" INTEGER, "status" TEXT, "lastSentAt" TEXT, "replyDetectedAt" TEXT, "stopReason" TEXT, "createdAt" TEXT, "updatedAt" TEXT, "sequenceConfigSnapshot" TEXT);
    CREATE TABLE "OutreachSequenceStep" ("id" TEXT PRIMARY KEY, "sequenceId" TEXT, "status" TEXT, "scheduledFor" TEXT, "sentAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT, "subject" TEXT, "bodyPlain" TEXT);
    CREATE TABLE "FunnelEvent" ("id" TEXT PRIMARY KEY, "eventType" TEXT, "leadId" INTEGER, "sequenceId" TEXT, "occurredAt" TEXT, "metadataJson" TEXT);
    CREATE TABLE "RevenueBusiness" ("id" TEXT PRIMARY KEY, "normalizedDomain" TEXT, "normalizedPhone" TEXT);
    CREATE TABLE "RevenueLocation" ("id" TEXT PRIMARY KEY, "businessId" TEXT);
    CREATE TABLE "RevenueContactPoint" ("id" TEXT PRIMARY KEY, "businessId" TEXT, "channel" TEXT, "value" TEXT);
    CREATE TABLE "RevenueBusinessStopEvent" ("businessId" TEXT, "reason" TEXT, "createdAt" TEXT);
    INSERT INTO "Lead" VALUES (1, 'acme.example', '+1 (519) 555-0100', 'Private@Acme.Example', 'SENT', NULL, '2026-09-20T10:00:00.000Z', NULL, '2026-09-19T10:00:00.000Z');
    INSERT INTO "Lead" VALUES (2, 'acme.example', '+1 (519) 555-0100', NULL, 'CONTACTED', '2026-09-20T10:00:00.000Z', NULL, NULL, '2026-09-19T10:00:00.000Z');
    INSERT INTO "Lead" VALUES (3, 'acme.example', '+1 (519) 555-0100', NULL, 'NOT_CONTACTED', NULL, NULL, '2026-09-21 10:00:00', '2026-09-19T10:00:00.000Z');
    INSERT INTO "Lead" VALUES (4, 'acme.example', '+1 (519) 555-0100', NULL, 'SENT', NULL, NULL, NULL, '2026-09-19T10:00:00.000Z');
    INSERT INTO "Lead" VALUES (5, 'acme.example', '+1 (519) 555-0100', NULL, 'NOT_CONTACTED', NULL, NULL, NULL, '2026-09-19T10:00:00.000Z');
    INSERT INTO "Lead" VALUES (6, 'acme.example', '+1 (519) 555-0100', NULL, 'NOT_CONTACTED', NULL, NULL, NULL, '2026-09-19T10:00:00.000Z');
    INSERT INTO "Lead" VALUES (7, 'acme.example', '+1 (519) 555-0100', NULL, 'NOT_CONTACTED', NULL, NULL, NULL, '2026-09-19T10:00:00.000Z');
    INSERT INTO "Lead" VALUES (8, 'only-phone.example', '+1 (519) 555-0200', NULL, 'NOT_CONTACTED', NULL, NULL, NULL, '2026-09-19T10:00:00.000Z');
    INSERT INTO "Lead" VALUES (9, 'email-inconsistent.example', '+1 (519) 555-0900', NULL, 'NOT_CONTACTED', NULL, NULL, NULL, '2026-09-19T10:00:00.000Z');
    INSERT INTO "Lead" VALUES (10, 'step-inconsistent.example', '+1 (519) 555-1000', NULL, 'NOT_CONTACTED', NULL, NULL, NULL, '2026-09-19T10:00:00.000Z');
    INSERT INTO "Lead" VALUES (11, 'failed-step.example', '+1 (519) 555-1100', NULL, 'NOT_CONTACTED', NULL, NULL, NULL, '2026-09-19T10:00:00.000Z');
    INSERT INTO "OutreachSuppression" VALUES ('s1', NULL, 'PRIVATE@ACME.EXAMPLE', 1, 'UNSUBSCRIBE', '2026-09-21T10:00:00.000Z', NULL);
    INSERT INTO "OutreachEmail" VALUES ('e1', 1, 'sent', '2026-09-20T10:00:00.000Z', 'SECRET SUBJECT', 'SECRET BODY');
    INSERT INTO "OutreachEmail" VALUES ('e2', 9, 'FAILED', '2026-09-21T10:00:00.000Z', 'SECRET SUBJECT', 'SECRET BODY');
    INSERT INTO "OutreachSequence" VALUES ('q1', 1, 'SENT', '2026-09-20T10:00:00.000Z', NULL, NULL, '2026-09-19T10:00:00.000Z', '2026-09-20T10:00:00.000Z', 'SECRET CONFIG');
    INSERT INTO "OutreachSequence" VALUES ('q2', 1, 'STOPPED', '2026-09-19T10:00:00.000Z', '2026-09-21T10:00:00.000Z', 'BOUNCED', '2026-09-19T10:00:00.000Z', '2026-09-21T10:00:00.000Z', 'SECRET CONFIG');
    INSERT INTO "OutreachSequence" VALUES ('q3', 10, 'QUEUED', NULL, NULL, NULL, '2026-09-19T10:00:00.000Z', '2026-09-19T10:00:00.000Z', 'SECRET CONFIG');
    INSERT INTO "OutreachSequence" VALUES ('q4', 11, 'QUEUED', NULL, NULL, NULL, '2026-09-19T10:00:00.000Z', '2026-09-19T10:00:00.000Z', 'SECRET CONFIG');
    INSERT INTO "OutreachSequenceStep" VALUES ('st1', 'q1', 'SCHEDULED', '2027-09-20T10:00:00.000Z', NULL, '2026-09-19T10:00:00.000Z', '2026-09-20T10:00:00.000Z', 'SECRET STEP', 'SECRET STEP BODY');
    INSERT INTO "OutreachSequenceStep" VALUES ('st2', 'q3', 'FAILED', '2026-09-20T10:00:00.000Z', '2026-09-20T10:00:00.000Z', '2026-09-19T10:00:00.000Z', '2026-09-20T10:00:00.000Z', 'SECRET STEP', 'SECRET STEP BODY');
    INSERT INTO "OutreachSequenceStep" VALUES ('st3', 'q4', 'FAILED', '2026-09-20T10:00:00.000Z', NULL, '2026-09-19T10:00:00.000Z', '2026-09-20T10:00:00.000Z', 'SECRET STEP', 'SECRET STEP BODY');
    INSERT INTO "FunnelEvent" VALUES ('f1', 'OUTREACH_SENT', 1, NULL, '2026-09-20T10:00:00.000Z', 'SECRET METADATA');
    INSERT INTO "FunnelEvent" VALUES ('f2', 'LEAD_DISCOVERED', 1, NULL, '2026-09-20T10:00:00.000Z', 'SECRET METADATA');
    INSERT INTO "FunnelEvent" VALUES ('f3', 'REPLY_DETECTED', 1, 'q2', '2026-09-21T10:00:00.000Z', 'SECRET METADATA');
    INSERT INTO "FunnelEvent" VALUES ('f4', 'OUTREACH_SENT', 5, NULL, '2026-09-21T10:00:00.000Z', 'SECRET METADATA');
    INSERT INTO "FunnelEvent" VALUES ('f5', 'BOUNCE_DETECTED', 6, NULL, '2026-09-21T10:00:00.000Z', 'SECRET METADATA');
    INSERT INTO "FunnelEvent" VALUES ('f6', 'UNSUBSCRIBE', 7, NULL, '2026-09-21T10:00:00.000Z', 'SECRET METADATA');
    INSERT INTO "RevenueBusiness" VALUES ('b1', 'acme.example', '15195550100');
    INSERT INTO "RevenueBusiness" VALUES ('b2', NULL, NULL);
    INSERT INTO "RevenueLocation" VALUES ('l1', 'b1');
    INSERT INTO "RevenueLocation" VALUES ('l2', 'b2');
    INSERT INTO "RevenueContactPoint" VALUES ('cp1', 'b1', 'EMAIL', 'private@acme.example');
    INSERT INTO "RevenueContactPoint" VALUES ('cp2', 'b2', 'PHONE', '+1 (519) 555-0200');
    INSERT INTO "RevenueBusinessStopEvent" VALUES ('b1', 'PROSPECT_REQUEST', '2026-09-21T10:00:00.000Z');
  `);
  db.close();
}

test("legacy history report uses an explicit snapshot time, writes safe JSON once, and preserves the source", () => {
  const data = path.join(root, "data");
  mkdirSync(data, { recursive: true });
  const token = randomBytes(12).toString("hex");
  const snapshotName = `legacy-history-${token}.sqlite`;
  const outputName = `legacy-history-${token}.json`;
  const database = path.join(data, snapshotName);
  const output = path.join(data, outputName);
  try {
    fixture(database);
    const before = readFileSync(database);
    const result = reportLegacyV2History(["--database", `data/${snapshotName}`, "--as-of", asOf, "--output", `data/${outputName}`]);
    const json = readFileSync(output, "utf8");
    const report = JSON.parse(json) as { asOf: string; source: { snapshotSha256: string; schemaSha256: string; rowCounts: Record<string, number> }; mappings: Array<{ legacyLeadId: string; candidates: Array<{ businessId: string; contactPointIds: string[]; matchedBy: string[] }>; blockers: string[] }>; history: Array<{ legacyLeadId: string; status: string; suppressionActive: boolean; sentEvidence: boolean; replyEvidence: boolean; unresolved: boolean; reportedContacted: boolean; reportedReplied: boolean }> };
    assert.equal(report.asOf, asOf);
    assert.equal(report.history[0]?.status, "SUPPRESSIVE");
    assert.equal(report.history[0]?.suppressionActive, true);
    assert.equal(report.history[0]?.sentEvidence, true);
    assert.equal(report.history[0]?.replyEvidence, false);
    assert.equal(report.history[0]?.unresolved, true);
    assert.equal(report.mappings[0]?.candidates[0]?.businessId, "b1");
    assert.ok(report.mappings[0]?.candidates[0]?.matchedBy.includes("EXACT_PHONE"));
    assert.ok(report.mappings[0]?.candidates[0]?.matchedBy.includes("EXACT_EMAIL"));
    assert.ok(report.mappings[0]?.blockers.includes("SUPPRESSIVE_HISTORY"));
    assert.equal(report.source.rowCounts.Lead, 11);
    assert.equal(report.history.find((item) => item.legacyLeadId === "2")?.status, "UNRESOLVED");
    assert.equal(report.history.find((item) => item.legacyLeadId === "2")?.unresolved, true);
    assert.equal(report.history.find((item) => item.legacyLeadId === "2")?.reportedContacted, true);
    assert.equal(report.history.find((item) => item.legacyLeadId === "3")?.status, "UNRESOLVED");
    assert.equal(report.history.find((item) => item.legacyLeadId === "3")?.replyEvidence, false);
    assert.equal(report.history.find((item) => item.legacyLeadId === "3")?.unresolved, true);
    assert.equal(report.history.find((item) => item.legacyLeadId === "3")?.reportedReplied, true);
    assert.equal(report.history.find((item) => item.legacyLeadId === "4")?.status, "UNRESOLVED");
    assert.equal(report.history.find((item) => item.legacyLeadId === "5")?.status, "CONTACTED");
    assert.equal(report.history.find((item) => item.legacyLeadId === "5")?.sentEvidence, true);
    assert.equal(report.history.find((item) => item.legacyLeadId === "5")?.replyEvidence, false);
    assert.equal(report.history.find((item) => item.legacyLeadId === "6")?.status, "BOUNCED");
    assert.equal(report.history.find((item) => item.legacyLeadId === "6")?.replyEvidence, false);
    assert.equal(report.history.find((item) => item.legacyLeadId === "7")?.status, "SUPPRESSIVE");
    assert.equal(report.history.find((item) => item.legacyLeadId === "7")?.replyEvidence, false);
    const phoneOnlyMatch = report.mappings.find((item) => item.legacyLeadId === "8")?.candidates.find((item) => item.businessId === "b2");
    assert.ok(phoneOnlyMatch);
    assert.ok(phoneOnlyMatch.matchedBy.includes("EXACT_PHONE"));
    assert.deepEqual(phoneOnlyMatch.contactPointIds, ["cp2"]);
    assert.ok(report.mappings.find((item) => item.legacyLeadId === "8")?.blockers.includes("IDENTITY_REVIEW"));
    for (const leadId of ["9", "10"]) {
      assert.equal(report.history.find((item) => item.legacyLeadId === leadId)?.status, "UNRESOLVED");
      assert.equal(report.history.find((item) => item.legacyLeadId === leadId)?.sentEvidence, false);
      assert.equal(report.history.find((item) => item.legacyLeadId === leadId)?.replyEvidence, false);
    }
    assert.equal(report.history.find((item) => item.legacyLeadId === "11")?.status, "NO_HISTORY");
    assert.equal(report.history.find((item) => item.legacyLeadId === "11")?.sentEvidence, false);
    assert.equal(report.history.find((item) => item.legacyLeadId === "11")?.replyEvidence, false);
    assert.match(report.source.schemaSha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof result.unresolvedHistory, "boolean");
    assert.deepEqual(readFileSync(database), before);
    for (const privateValue of ["Private@Acme.Example", "private@acme.example", "+1 (519) 555-0200", "SECRET SUBJECT", "SECRET BODY", "SECRET CONFIG", "SECRET METADATA"]) assert.equal(json.includes(privateValue), false);
    assert.throws(() => reportLegacyV2History(["--database", `data/${snapshotName}`, "--as-of", asOf, "--output", `data/${outputName}`]), /EEXIST/);
  } finally {
    rmSync(database, { force: true });
    rmSync(output, { force: true });
  }
});

test("snapshot and output paths stay at ignored data root and as-of is mandatory/canonical", () => {
  assert.equal(resolveLegacySnapshotPath("data/snapshot.sqlite"), path.join(root, "data", "snapshot.sqlite"));
  assert.equal(resolveLegacyReportPath("data/report.json"), path.join(root, "data", "report.json"));
  assert.throws(() => resolveLegacySnapshotPath("wrangler-state.sqlite"), /ignored data/);
  assert.throws(() => resolveLegacySnapshotPath("data/nested/snapshot.sqlite"), /ignored data/);
  assert.throws(() => resolveLegacySnapshotPath("data/snapshot.db"), /ignored data/);
  assert.throws(() => resolveLegacyReportPath("data/report.txt"), /ignored data/);
  assert.throws(() => reportLegacyV2History(["--database", "data/a.sqlite", "--as-of", "yesterday", "--output", "data/r.json"]), /canonical UTC/);
  assert.equal(normalizeLegacySqliteUtcTimestamp("2026-09-21 10:00:00"), "2026-09-21T10:00:00.000Z");
  assert.equal(normalizeLegacySqliteUtcTimestamp("2026-09-21T10:00:00Z"), "2026-09-21T10:00:00.000Z");
  assert.throws(() => normalizeLegacySqliteUtcTimestamp("2026-09-21T10:00:00-04:00"), /ambiguous timestamp/);
  assert.throws(() => normalizeLegacySqliteUtcTimestamp("2026-02-30 10:00:00"), /invalid timestamp/);
});

test("schema and timestamp failures leave the snapshot untouched and create no report", () => {
  const data = path.join(root, "data");
  mkdirSync(data, { recursive: true });
  const token = randomBytes(12).toString("hex");
  const cases = [
    { name: `legacy-history-missing-table-${token}.sqlite`, mutate(db: Database.Database) { db.exec(`DROP TABLE "RevenueBusinessStopEvent"`); }, error: /missing required table/ },
    { name: `legacy-history-missing-column-${token}.sqlite`, mutate(db: Database.Database) { db.exec(`ALTER TABLE "Lead" DROP COLUMN "lastReplyAt"`); }, error: /missing required column/ },
    { name: `legacy-history-invalid-date-${token}.sqlite`, mutate(db: Database.Database) { db.prepare(`UPDATE "Lead" SET "lastReplyAt" = ? WHERE "id" = 3`).run("2026-09-21T10:00:00-04:00"); }, error: /unsupported or ambiguous timestamp/ },
  ];
  const created: string[] = [];
  try {
    for (const item of cases) {
      const outputName = item.name.replace(".sqlite", ".json");
      const database = path.join(data, item.name);
      const output = path.join(data, outputName);
      fixture(database);
      created.push(database, output);
      const mutate = new Database(database);
      item.mutate(mutate);
      mutate.close();
      const before = readFileSync(database);
      assert.throws(() => reportLegacyV2History(["--database", `data/${item.name}`, "--as-of", asOf, "--output", `data/${outputName}`]), item.error);
      assert.deepEqual(readFileSync(database), before);
      assert.equal(existsSync(output), false);
    }
  } finally {
    for (const file of created) rmSync(file, { force: true });
  }
});
