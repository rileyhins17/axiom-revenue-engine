import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION } from "@/lib/fcc-campaign";
import { pauseFcc, resumeFcc, saveFccReplyCheck } from "@/lib/fcc-campaign-control";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

import { alertEmail, recordAndSelectAlerts, runHealthChecks } from "./health";

// Tue Nov 3 2026 (EST, UTC-5).
const TUE_8AM = new Date("2026-11-03T13:00:00Z");
const TUE_1130 = new Date("2026-11-03T16:30:00Z");
const TUE_9PM = new Date("2026-11-04T02:00:00Z");
const SAT_1130 = new Date("2026-11-07T16:30:00Z");
const ENV = { LOGIN_EMAIL: {} };

function database() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
  raw.exec(readFileSync("migrations/0037_kv_store.sql", "utf8"));
  const db: ProspectDb = { prepare(sql) { const s = raw.prepare(sql); return { bind: (...v: unknown[]) => ({
    all: async <T,>() => ({ results: s.all(...v) as T[] }), first: async <T,>() => (s.get(...v) as T | undefined) ?? null, run: async () => s.run(...v),
  }) }; } };
  // Live, with a founder's go on the current email, one company ready and today's reply check done.
  raw.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 1, "approvedCopy" = ?, "goBy" = 'Aidan', "goAt" = '2026-11-01T21:03:00Z' WHERE "id" = 1`).run(FCC_COPY_VERSION);
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","createdAt","updatedAt")
    VALUES ('c1',?,'jo@x.example','Jo','Co','[]','named',1,'ready','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z')`).run(FCC_CAMPAIGN_KEY);
  return { raw, db };
}
const failing = (checks: Awaited<ReturnType<typeof runHealthChecks>>) => checks.filter((c) => !c.ok).map((c) => c.key).sort();
const sendOne = (raw: Database.Database, day: string) => raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status") VALUES ('s1','c1',1,'jo@x.example',?,'<m1>','SENT')`).run(day);

test("a live campaign that sent today and checked its replies reports no problems and sends no email", async () => {
  const { raw, db } = database();
  sendOne(raw, "2026-11-03");
  await saveFccReplyCheck(db, { day: "2026-11-03", at: "2026-11-03T14:00:00Z", found: 0 });
  const checks = await runHealthChecks(db, ENV, TUE_1130);
  assert.deepEqual(failing(checks), []);
  assert.equal(alertEmail(await recordAndSelectAlerts(db, checks, TUE_1130)), null);
});

test("a pause emails both founders once with the reason, reminds daily, and says when it's fixed", async () => {
  const { raw, db } = database();
  sendOne(raw, "2026-11-03");
  await saveFccReplyCheck(db, { day: "2026-11-03", at: "2026-11-03T14:00:00Z", found: 0 });
  await pauseFcc(db, "3 bounces today", "the automatic check", TUE_8AM);
  const paused = await runHealthChecks(db, ENV, TUE_1130);
  assert.deepEqual(failing(paused), ["fcc-paused"]);
  const first = alertEmail(await recordAndSelectAlerts(db, paused, TUE_1130));
  assert.match(first!.subject, /FCC emails are paused/);
  assert.match(first!.text, /3 bounces today \(the automatic check/);
  assert.match(first!.text, /press Resume/);
  assert.equal(alertEmail(await recordAndSelectAlerts(db, paused, new Date(TUE_1130.getTime() + 15 * 60_000))), null, "no repeat 15 minutes later");
  assert.match(alertEmail(await recordAndSelectAlerts(db, paused, new Date(TUE_1130.getTime() + 25 * 3_600_000)))!.text, /Still not fixed/);
  assert.equal(await resumeFcc(db, "Riley", TUE_1130), "RESUMED");
  const fixed = alertEmail(await recordAndSelectAlerts(db, await runHealthChecks(db, ENV, TUE_1130), new Date(TUE_1130.getTime() + 26 * 3_600_000)));
  assert.match(fixed!.subject, /FCC emails are no longer paused/);
  assert.match(fixed!.text, /Fixed now/);
});

test("a new email without a founder's go is reported during weekday send hours only", async () => {
  const { raw, db } = database();
  raw.exec(`UPDATE "FccCampaignSetting" SET "approvedCopy" = 'an-older-version'`);
  await saveFccReplyCheck(db, { day: "2026-11-03", at: "2026-11-03T14:00:00Z", found: 0 });
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), ["fcc-locked"]);
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_9PM)), [], "a release at night doesn't alarm anyone");
  assert.deepEqual(failing(await runHealthChecks(db, ENV, SAT_1130)), []);
});

test("no sends an hour into the weekday window, with people waiting, is reported", async () => {
  const { raw, db } = database();
  await saveFccReplyCheck(db, { day: "2026-11-03", at: "2026-11-03T14:00:00Z", found: 0 });
  const stalled = (await runHealthChecks(db, ENV, TUE_1130)).find((c) => c.key === "fcc-sending")!;
  assert.equal(stalled.ok, false);
  assert.match(stalled.problem, /No FCC emails have gone out today.*1 is waiting/);
  assert.equal((await runHealthChecks(db, ENV, new Date("2026-11-03T15:30:00Z"))).find((c) => c.key === "fcc-sending")!.ok, true, "10:30 is too early to tell");
  assert.equal((await runHealthChecks(db, ENV, SAT_1130)).find((c) => c.key === "fcc-sending")!.ok, true, "weekends don't send");
  sendOne(raw, "2026-11-03");
  assert.equal((await runHealthChecks(db, ENV, TUE_1130)).find((c) => c.key === "fcc-sending")!.ok, true);
});

test("a reply check that hasn't finished by 10:30 is reported", async () => {
  const { raw, db } = database();
  sendOne(raw, "2026-11-03");
  await saveFccReplyCheck(db, { day: "2026-11-02", at: "2026-11-02T14:00:00Z", found: 0 });
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), ["fcc-reply-check"]);
  assert.deepEqual(failing(await runHealthChecks(db, ENV, new Date("2026-11-03T14:30:00Z"))), [], "9:30 is before it's late");
});

test("a missing sign-in email binding is reported", async () => {
  const { raw, db } = database();
  sendOne(raw, "2026-11-03");
  await saveFccReplyCheck(db, { day: "2026-11-03", at: "2026-11-03T14:00:00Z", found: 0 });
  assert.deepEqual(failing(await runHealthChecks(db, {}, TUE_1130)), ["login-email"]);
});
