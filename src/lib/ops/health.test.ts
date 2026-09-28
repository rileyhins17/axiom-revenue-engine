import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

import { alertEmail, recordAndSelectAlerts, runHealthChecks } from "./health";

function database() {
  const raw = new Database(":memory:");
  raw.exec(readFileSync("migrations/0080_health_alerts.sql", "utf8"));
  raw.exec(`CREATE TABLE OutreachAutomationSetting (enabled INT, globalPaused INT, emergencyPaused INT, intakePaused INT, followUpsPaused INT);
    INSERT INTO OutreachAutomationSetting VALUES (0,1,1,1,1);
    CREATE TABLE CallerProjection (status TEXT, nextAttemptAt TEXT);
    CREATE TABLE CallerStopDelivery (status TEXT, nextAttemptAt TEXT);
    CREATE TABLE EngineEmailSend (status TEXT, createdAt TEXT);
    CREATE TABLE AiUsage (month TEXT, costMicroUsd INT);`);
  const db: ProspectDb = { prepare(sql) { const s = raw.prepare(sql); return { bind: (...v: unknown[]) => ({
    all: async <T,>() => ({ results: s.all(...v) as T[] }), first: async <T,>() => (s.get(...v) as T | undefined) ?? null, run: async () => s.run(...v),
  }) }; } };
  return { raw, db };
}
const ENV = { LOGIN_EMAIL: {}, CALLER_V2_ENABLED: "true", AI_MONTHLY_BUDGET_USD: "5" };
const NOW = new Date("2026-09-25T20:00:00Z");

test("a healthy system reports no problems and sends no email", async () => {
  const { db } = database();
  const checks = await runHealthChecks(db, ENV, NOW);
  assert.equal(checks.every((c) => c.ok), true, JSON.stringify(checks.filter((c) => !c.ok)));
  assert.equal(alertEmail(await recordAndSelectAlerts(db, checks, NOW)), null);
});

test("problems email once, remind daily, and announce the fix", async () => {
  const { raw, db } = database();
  raw.exec(`INSERT INTO CallerProjection VALUES ('pending','2026-09-25T10:00:00Z'); UPDATE OutreachAutomationSetting SET enabled=1;`);
  const broken = await runHealthChecks(db, { ...ENV, CALLER_V2_ENABLED: "false" }, NOW);
  assert.deepEqual(broken.filter((c) => !c.ok).map((c) => c.key).sort(), ["caller-enabled", "caller-sync", "safety-switches"]);
  const first = alertEmail(await recordAndSelectAlerts(db, broken, NOW));
  assert.match(first!.subject, /3 things need attention/);
  assert.match(first!.text, /What to do:/);
  assert.equal(alertEmail(await recordAndSelectAlerts(db, broken, new Date(NOW.getTime() + 15 * 60_000))), null, "no repeat email 15 minutes later");
  const nextDay = alertEmail(await recordAndSelectAlerts(db, broken, new Date(NOW.getTime() + 25 * 3_600_000)));
  assert.match(nextDay!.text, /Still not fixed/);
  raw.exec(`DELETE FROM CallerProjection; UPDATE OutreachAutomationSetting SET enabled=0;`);
  const fixed = alertEmail(await recordAndSelectAlerts(db, await runHealthChecks(db, ENV, NOW), new Date(NOW.getTime() + 26 * 3_600_000)));
  assert.match(fixed!.subject, /fixed/);
  assert.match(fixed!.text, /working again/);
});

test("missing sign-in email and a near-empty AI budget are reported", async () => {
  const { raw, db } = database();
  raw.exec(`INSERT INTO AiUsage VALUES ('2026-09', 4700000)`);
  const checks = await runHealthChecks(db, { CALLER_V2_ENABLED: "true" }, NOW);
  assert.deepEqual(checks.filter((c) => !c.ok).map((c) => c.key).sort(), ["ai-budget", "login-email"]);
});

test("the morning lead search is checked on weekdays after 8:30, and a key Google refuses is reported", async () => {
  const { raw, db } = database();
  raw.exec(readFileSync("migrations/0081_cloud_discovery.sql", "utf8"));
  const leadSearch = async (now: Date) => (await runHealthChecks(db, ENV, now)).find((c) => c.key === "lead-search")!;
  const friday4pm = new Date("2026-09-25T20:00:00Z");
  assert.equal((await leadSearch(friday4pm)).ok, false, "no run this morning");
  assert.match((await leadSearch(friday4pm)).problem, /didn't run/);
  assert.equal((await leadSearch(new Date("2026-09-25T12:00:00Z"))).ok, true, "before 8:30 it is too early to tell");
  assert.equal((await leadSearch(new Date("2026-09-26T20:00:00Z"))).ok, true, "weekends have no scheduled search");
  raw.exec(`INSERT INTO "DiscoveryRun" ("runId","trigger","startedAt","requests","added") VALUES ('r1','SCHEDULE','2026-09-25T11:00:05Z',30,7)`);
  assert.equal((await leadSearch(friday4pm)).ok, true);
  raw.exec(`INSERT INTO "DiscoveryRun" ("runId","trigger","actor","startedAt","requests","stopReason") VALUES ('r2','OWNER','AIDAN','2026-09-25T15:00:00Z',1,'Google returned an error (403).')`);
  const refused = await leadSearch(friday4pm);
  assert.equal(refused.ok, false);
  assert.match(refused.problem, /Google turned down/);
  raw.exec(`INSERT INTO "DiscoveryRun" ("runId","trigger","actor","startedAt","requests","stopReason") VALUES ('r3','OWNER','AIDAN','2026-09-25T16:00:00Z',1,'Google''s daily search limit was reached; it continues tomorrow.')`);
  assert.equal((await leadSearch(friday4pm)).ok, true, "the daily limit is expected, not a fault");
});
