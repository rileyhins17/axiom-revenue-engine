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
  const locked = async (now: Date) => (await runHealthChecks(db, ENV, now)).find((c) => c.key === "fcc-locked")!.ok;
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), ["fcc-locked"]);
  assert.equal(await locked(TUE_9PM), true, "a release at night doesn't alarm anyone");
  assert.equal(await locked(SAT_1130), true);
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

test("a campaign that paused itself emails both founders; a founder's own pause and a new campaign don't", async () => {
  const { raw, db } = database();
  sendOne(raw, "2026-11-03");
  await saveFccReplyCheck(db, { day: "2026-11-03", at: "2026-11-03T14:00:00Z", found: 0 });
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), [], "the new cities campaign starts paused by Riley's Claude: no alert");
  raw.prepare(`UPDATE "OutreachCampaign" SET "state" = 'paused', "stateBy" = 'the automatic safety check', "stateReason" = 'Aidan''s inbox: 3 emails bounced today', "stateAt" = ? WHERE "key" = 'us-cities'`)
    .run(TUE_8AM.toISOString());
  const checks = await runHealthChecks(db, ENV, TUE_1130);
  assert.deepEqual(failing(checks), ["campaign-paused:us-cities"]);
  const mail = alertEmail(await recordAndSelectAlerts(db, checks, TUE_1130));
  assert.match(mail!.text, /US cities: accessibility campaign paused itself: Aidan's inbox: 3 emails bounced today/);
});

test("FCC isn't reported stuck at 11:00 when campaign emails used the inbox's morning; by 1:30 it is", async () => {
  const { raw, db } = database();
  await saveFccReplyCheck(db, { day: "2026-11-03", at: "2026-11-03T14:00:00Z", found: 0 });
  raw.prepare(`INSERT INTO "OutreachBatch" ("id","campaignKey","name","loadedBy","loadedAt","status") VALUES ('b','us-cities','B','Riley','2026-11-02T00:00:00Z','approved')`).run();
  raw.prepare(`INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","createdAt","updatedAt") VALUES ('oc','us-cities','b',2,'a@b.gov','{}','sent','x','x')`).run();
  raw.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","step","email","senderAddress","sendDay","messageId","subject","status") VALUES ('o1','us-cities','oc',1,'a@b.gov','aidanmageebusiness@gmail.com','2026-11-03','<o1>','S','SENT')`).run();
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), []);
  assert.deepEqual(failing(await runHealthChecks(db, ENV, new Date("2026-11-03T18:31:00Z"))), ["fcc-sending"]);
});

test("an inbox with 3 bounces today, campaigns and FCC together, is reported as stopped for the day, and it clears the next day", async () => {
  const { raw, db } = database();
  sendOne(raw, "2026-11-03");
  await saveFccReplyCheck(db, { day: "2026-11-03", at: "2026-11-03T14:00:00Z", found: 0 });
  raw.prepare(`INSERT INTO "OutreachBatch" ("id","campaignKey","name","loadedBy","loadedAt","status") VALUES ('b','us-cities','B','Riley','2026-11-02T00:00:00Z','approved')`).run();
  for (const i of [1, 2, 3]) {
    raw.prepare(`INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","createdAt","updatedAt") VALUES (?,'us-cities','b',?,?,'{}','bounced','x','x')`)
      .run(`oc${i}`, i + 1, `clerk${i}@city${i}.gov`);
    raw.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","step","email","senderAddress","sendDay","messageId","subject","status") VALUES (?,'us-cities',?,1,?,'aidanmageebusiness@gmail.com','2026-11-03',?,'S','SENT')`)
      .run(`o${i}`, `oc${i}`, `clerk${i}@city${i}.gov`, `<o${i}>`);
  }
  const checks = await runHealthChecks(db, { ...ENV, FCC_SENDER_ADDRESS: "aidanmageebusiness@gmail.com" }, TUE_1130);
  assert.deepEqual(failing(checks), ["inbox-resting:aidanmageebusiness@gmail.com"]);
  const mail = alertEmail(await recordAndSelectAlerts(db, checks, TUE_1130));
  assert.match(mail!.text, /Aidan's inbox \(aidanmageebusiness@gmail\.com\) has stopped sending for today: 3 of its emails bounced today/);
  const wednesday = await runHealthChecks(db, { ...ENV, FCC_SENDER_ADDRESS: "aidanmageebusiness@gmail.com" }, new Date("2026-11-04T16:30:00Z"));
  assert.ok(!failing(wednesday).includes("inbox-resting:aidanmageebusiness@gmail.com"));
});
