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
const SAT_1130 = new Date("2026-11-07T16:30:00Z");
const ENV = { LOGIN_EMAIL: {} };
const MINUTES = 60_000;
const HOURS = 3_600_000;

function database() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
  raw.exec(readFileSync("migrations/0037_kv_store.sql", "utf8"));
  const db: ProspectDb = { prepare(sql) { const s = raw.prepare(sql); return { bind: (...v: unknown[]) => ({
    all: async <T,>() => ({ results: s.all(...v) as T[] }), first: async <T,>() => (s.get(...v) as T | undefined) ?? null, run: async () => s.run(...v),
  }) }; } };
  // FCC as it is since it ended: paused, with a founder's go on its last email and one company it never reached.
  raw.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 0, "approvedCopy" = ?, "goBy" = 'Aidan', "goAt" = '2026-11-01T21:03:00Z' WHERE "id" = 1`).run(FCC_COPY_VERSION);
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","createdAt","updatedAt")
    VALUES ('c1',?,'jo@x.example','Jo','Co','[]','named',1,'ready','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z')`).run(FCC_CAMPAIGN_KEY);
  return { raw, db };
}
type Checks = Awaited<ReturnType<typeof runHealthChecks>>;
const failing = (checks: Checks) => checks.filter((c) => !c.ok).map((c) => c.key).sort();
const keys = (checks: Checks) => checks.map((c) => c.key);
const replyCheckDone = (db: ProspectDb) => saveFccReplyCheck(db, { day: "2026-11-03", at: "2026-11-03T14:00:00Z", found: 0 });
const pauseItself = (raw: Database.Database) => raw.prepare(`UPDATE "OutreachCampaign" SET "state" = 'paused', "stateBy" = 'the automatic safety check', "stateReason" = 'Aidan''s inbox: 3 emails bounced today', "stateAt" = ? WHERE "key" = 'us-cities'`)
  .run(TUE_8AM.toISOString());

test("FCC paused is normal now: no problem, no check about it, and no email", async () => {
  const { db } = database();
  await replyCheckDone(db);
  const checks = await runHealthChecks(db, ENV, TUE_1130);
  assert.deepEqual(failing(checks), []);
  for (const gone of ["fcc-paused", "fcc-locked", "fcc-sending"]) assert.ok(!keys(checks).includes(gone), `${gone} is no longer checked`);
  assert.equal(checks.find((c) => c.key === "fcc-live")!.ok, true);
  assert.equal(alertEmail(await recordAndSelectAlerts(db, checks, TUE_1130)), null);
  await saveFccReplyCheck(db, { day: "2026-11-07", at: "2026-11-07T14:00:00Z", found: 0 });
  assert.equal(alertEmail(await recordAndSelectAlerts(db, await runHealthChecks(db, ENV, SAT_1130), SAT_1130)), null, "days later, still paused, still nothing");
});

test("an alert about FCC being paused that was open when FCC ended sends nothing more: no reminder and no 'fixed'", async () => {
  const { raw, db } = database();
  await replyCheckDone(db);
  // Last told two days ago, so a daily reminder would be due if the check were still made.
  for (const key of ["fcc-paused", "fcc-locked", "fcc-sending"]) {
    raw.prepare(`INSERT INTO "HealthAlertState" ("checkKey","status","summary","since","lastNotifiedAt","updatedAt") VALUES (?,'PROBLEM','FCC emails are paused','2026-11-01T13:00:00Z','2026-11-01T13:00:00Z','2026-11-03T13:00:00Z')`).run(key);
  }
  const alerts = await recordAndSelectAlerts(db, await runHealthChecks(db, ENV, TUE_1130), TUE_1130);
  assert.deepEqual(alerts, { newProblems: [], reminders: [], fixed: [] });
  assert.equal(alertEmail(alerts), null);
  assert.equal(alertEmail(await recordAndSelectAlerts(db, await runHealthChecks(db, ENV, TUE_1130), new Date(TUE_1130.getTime() + 25 * HOURS))), null, "nor a day later");
  const stored = raw.prepare(`SELECT "checkKey" FROM "HealthAlertState" WHERE "status" = 'PROBLEM' ORDER BY 1`).all() as Array<{ checkKey: string }>;
  assert.deepEqual(stored.map((row) => row.checkKey), ["fcc-locked", "fcc-paused", "fcc-sending"], "the old rows are left as they were, never marked fixed");
});

test("FCC switched on again emails both founders once, reminds daily, and says when it is paused again", async () => {
  const { db } = database();
  await replyCheckDone(db);
  assert.equal(await resumeFcc(db, "Riley", TUE_8AM), "RESUMED");
  const live = await runHealthChecks(db, ENV, TUE_1130);
  assert.deepEqual(failing(live), ["fcc-live"]);
  const first = alertEmail(await recordAndSelectAlerts(db, live, TUE_1130));
  assert.match(first!.subject, /FCC emails are switched on again$/);
  assert.match(first!.text, /FCC ended on Nov 12, 2026 and should stay paused\./);
  assert.match(first!.text, /What to do: Open More, FCC archive and press Pause, unless you both decided to restart it\./);
  assert.equal(alertEmail(await recordAndSelectAlerts(db, live, new Date(TUE_1130.getTime() + 15 * MINUTES))), null, "no repeat 15 minutes later");
  assert.match(alertEmail(await recordAndSelectAlerts(db, live, new Date(TUE_1130.getTime() + 25 * HOURS)))!.text, /Still not fixed/);
  assert.equal(await pauseFcc(db, "FCC ended", "Riley", TUE_1130), true);
  const fixed = alertEmail(await recordAndSelectAlerts(db, await runHealthChecks(db, ENV, TUE_1130), new Date(TUE_1130.getTime() + 26 * HOURS)));
  assert.match(fixed!.subject, /FCC emails are paused again$/);
  assert.match(fixed!.text, /Fixed now/);
});

test("an FCC email without a founder's go can't send, so it is not a problem either", async () => {
  const { raw, db } = database();
  await replyCheckDone(db);
  raw.exec(`UPDATE "FccCampaignSetting" SET "enabled" = 1, "approvedCopy" = 'an-older-version'`);
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), []);
});

test("FCC numbers that can't be read are reported, and every campaign and inbox check still runs", async () => {
  const { raw, db } = database();
  await replyCheckDone(db);
  pauseItself(raw);
  const noFcc: ProspectDb = { prepare(sql) { if (sql.includes(`"FccCampaignSetting"`)) throw new Error("no such table: FccCampaignSetting"); return db.prepare(sql); } };
  const checks = await runHealthChecks(noFcc, ENV, TUE_1130);
  assert.deepEqual(failing(checks), ["campaign-paused:us-cities", "fcc-screen"]);
  const unread = checks.find((c) => c.key === "fcc-screen")!;
  assert.match(unread.problem, /The old FCC numbers can't be read, so the FCC archive screen may not load\. Campaign emails are not affected\./);
  assert.ok(!keys(checks).includes("fcc-live"), "nothing is said about FCC sending when it can't be seen");
  for (const key of ["campaigns-screen", "campaign-paused:us-cities", "campaign-sending:us-cities", "fcc-reply-check"]) assert.ok(keys(checks).includes(key), `${key} still runs`);
  assert.equal(keys(checks).filter((key) => key.startsWith("inbox-resting:")).length, 2, "both inboxes are still checked");
  const mail = alertEmail(await recordAndSelectAlerts(db, checks, TUE_1130));
  assert.match(mail!.subject, /2 things need attention/);
});

test("a database that can't be reached is reported in words about the campaigns and the screens", async () => {
  const down: ProspectDb = { prepare() { throw new Error("D1 is down"); } };
  const checks = await runHealthChecks(down, ENV, TUE_1130);
  assert.deepEqual(failing(checks), ["database"]);
  assert.equal(checks[0]!.problem, "The app can't reach its database, so no campaign emails can go out and the screens won't load.");
});

test("a reply check that hasn't finished by 10:30 is reported", async () => {
  const { db } = database();
  await saveFccReplyCheck(db, { day: "2026-11-02", at: "2026-11-02T14:00:00Z", found: 0 });
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), ["fcc-reply-check"]);
  assert.deepEqual(failing(await runHealthChecks(db, ENV, new Date("2026-11-03T14:30:00Z"))), [], "9:30 is before it's late");
});

test("a missing sign-in email binding is reported", async () => {
  const { db } = database();
  await replyCheckDone(db);
  assert.deepEqual(failing(await runHealthChecks(db, {}, TUE_1130)), ["login-email"]);
});

test("a campaign that paused itself emails both founders once with the reason, reminds daily, and says when it's fixed; a founder's own pause and a new campaign don't", async () => {
  const { raw, db } = database();
  await replyCheckDone(db);
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), [], "the new cities campaign starts paused by Riley's Claude: no alert");
  pauseItself(raw);
  const checks = await runHealthChecks(db, ENV, TUE_1130);
  assert.deepEqual(failing(checks), ["campaign-paused:us-cities"]);
  const mail = alertEmail(await recordAndSelectAlerts(db, checks, TUE_1130));
  assert.match(mail!.text, /US cities: accessibility campaign paused itself: Aidan's inbox: 3 emails bounced today/);
  assert.match(mail!.text, /press Resume/);
  assert.equal(alertEmail(await recordAndSelectAlerts(db, checks, new Date(TUE_1130.getTime() + 15 * MINUTES))), null, "no repeat 15 minutes later");
  assert.match(alertEmail(await recordAndSelectAlerts(db, checks, new Date(TUE_1130.getTime() + 25 * HOURS)))!.text, /Still not fixed/);
  raw.prepare(`UPDATE "OutreachCampaign" SET "state" = 'live', "stateBy" = 'Riley', "stateReason" = NULL WHERE "key" = 'us-cities'`).run();
  const fixed = alertEmail(await recordAndSelectAlerts(db, await runHealthChecks(db, ENV, TUE_1130), new Date(TUE_1130.getTime() + 26 * HOURS)));
  assert.match(fixed!.subject, /The us-cities campaign is no longer paused/);
  assert.match(fixed!.text, /Fixed now/);
});

test("a live campaign with people waiting that has sent nothing an hour into its send hours is reported", async () => {
  const { raw, db } = database();
  await replyCheckDone(db);
  raw.prepare(`UPDATE "OutreachCampaign" SET "state" = 'live', "stateBy" = 'Riley', "stateReason" = NULL, "startDay" = NULL WHERE "key" = 'us-cities'`).run();
  raw.prepare(`INSERT INTO "OutreachBatch" ("id","campaignKey","name","loadedBy","loadedAt","status") VALUES ('b','us-cities','B','Riley','2026-11-02T00:00:00Z','approved')`).run();
  raw.prepare(`INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","createdAt","updatedAt") VALUES ('oc','us-cities','b',2,'clerk@town.example','{}','ready','x','x')`).run();
  const sending = async (now: Date) => (await runHealthChecks(db, ENV, now)).find((c) => c.key === "campaign-sending:us-cities")!;
  const silent = await sending(TUE_1130);
  assert.equal(silent.ok, false);
  assert.match(silent.problem, /No US cities: accessibility emails have gone out today, though it is live and 1 is waiting\./);
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), ["campaign-sending:us-cities"]);
  assert.equal((await sending(new Date("2026-11-03T14:30:00Z"))).ok, true, "9:30 is too early to tell");
  assert.equal((await sending(SAT_1130)).ok, true, "it doesn't send on weekends");
  raw.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","step","email","senderAddress","sendDay","messageId","subject","status") VALUES ('o1','us-cities','oc',1,'clerk@town.example','first-inbox@axiom.example','2026-11-03','<o1>','S','SENT')`).run();
  assert.equal((await sending(TUE_1130)).ok, true);
});

test("an inbox with 3 bounces today is reported as stopped for the day, and it clears the next day", async () => {
  const { raw, db } = database();
  await replyCheckDone(db);
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
  assert.match(mail!.text, /Aidan's inbox \(aidanmageebusiness@gmail\.com\) has stopped sending for today: 3 of its emails bounced today\. Nothing is paused; it starts again tomorrow\./);
  assert.match(mail!.text, /What to do: Look at who bounced on the campaign's screen\. If one list is bad, pause that campaign before tomorrow\./);
  assert.doesNotMatch(mail!.text, /FCC/);
  const wednesday = await runHealthChecks(db, { ...ENV, FCC_SENDER_ADDRESS: "aidanmageebusiness@gmail.com" }, new Date("2026-11-04T16:30:00Z"));
  assert.ok(!failing(wednesday).includes("inbox-resting:aidanmageebusiness@gmail.com"));
});

test("once a campaign has emailed anyone, a reply check that hasn't finished for 2 hours, or an inbox it couldn't open, is reported", async () => {
  const { raw, db } = database();
  await replyCheckDone(db);
  raw.prepare(`INSERT INTO "OutreachBatch" ("id","campaignKey","name","loadedBy","loadedAt","status") VALUES ('b','us-cities','B','Riley','2026-11-02T00:00:00Z','approved')`).run();
  raw.prepare(`INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","firstSentAt","createdAt","updatedAt")
    VALUES ('oc','us-cities','b',2,'a@b.gov','{}','sent','2026-11-02T15:00:00Z','x','x')`).run();
  const state = (value: unknown) => raw.prepare(`INSERT INTO "KvStore" ("key","value","updatedAt") VALUES ('outreach.replyCheck',?,'x')
    ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`).run(JSON.stringify(value));
  state({ inboxes: {}, at: "2026-11-03T13:05:00Z", unread: [] }); // 8:05 am
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_8AM)), [], "before 9:00 nothing is late yet");
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), ["campaign-reply-check"], "11:30, last finished 8:05");
  state({ inboxes: {}, at: "2026-11-03T16:05:00Z", unread: ["rileyhinspergerbusiness@gmail.com"] }); // 11:05 am
  const checks = await runHealthChecks(db, ENV, TUE_1130);
  assert.deepEqual(failing(checks), ["campaign-reply-inboxes"]);
  assert.match(checks.find((check) => check.key === "campaign-reply-inboxes")!.problem, /couldn't open rileyhinspergerbusiness@gmail\.com/);
  state({ inboxes: {}, at: "2026-11-03T16:05:00Z", unread: [] });
  assert.deepEqual(failing(await runHealthChecks(db, ENV, TUE_1130)), []);
});
