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

test("the website check is flagged only when businesses wait during weekday hours and it stopped or can't open sites", async () => {
  const { raw, db } = database();
  raw.exec(readFileSync("migrations/0081_cloud_discovery.sql", "utf8"));
  raw.exec(`CREATE TABLE "EngineProspect" ("prospectId" TEXT)`);
  raw.exec(readFileSync("migrations/0084_site_check.sql", "utf8"));
  const siteCheck = async (now: Date) => (await runHealthChecks(db, ENV, now)).find((c) => c.key === "website-check")!;
  const friday2pm = new Date("2026-09-25T18:00:00Z");
  assert.equal((await siteCheck(friday2pm)).ok, true, "nothing waiting, nothing to judge");
  raw.exec(`INSERT INTO "DiscoveryHeld" ("placeId","name","city","niche","websiteUrl","firstSeenAt") VALUES ('p1','Held','GUELPH','HVAC','https://held.example/','2026-09-25')`);
  assert.equal((await siteCheck(friday2pm)).ok, false, "waiting and no run in the last hour");
  assert.match((await siteCheck(friday2pm)).problem, /hasn't run/);
  assert.equal((await siteCheck(new Date("2026-09-26T18:00:00Z"))).ok, true, "weekends are not judged");
  assert.equal((await siteCheck(new Date("2026-09-25T23:30:00Z"))).ok, true, "evenings are not judged");
  raw.exec(`INSERT INTO "SiteCheckRun" ("runId","startedAt","checked","failed") VALUES ('r1','2026-09-25T17:50:00Z',4,0)`);
  assert.equal((await siteCheck(friday2pm)).ok, true);
  raw.exec(`INSERT INTO "SiteCheckRun" ("runId","startedAt","checked","failed") VALUES ('r2','2026-09-25T15:40:00Z',0,6),('r3','2026-09-25T16:50:00Z',0,6)`);
  raw.exec(`UPDATE "SiteCheckRun" SET "checked"=0,"failed"=6 WHERE "runId"='r1'`);
  const failing = await siteCheck(friday2pm);
  assert.equal(failing.ok, false);
  assert.match(failing.problem, /can't open any websites/);
});
