import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION } from "@/lib/fcc-campaign";
import { pauseFcc, readFccNotes, resumeFcc } from "@/lib/fcc-campaign-control";
import type { FccMailbox, FccSendConfig } from "@/lib/fcc-campaign-sender";
import { FCC_GAP_MAX_MS, FCC_GAP_MIN_MS, gapAfter, runFccSendTick, torontoMinute, type FccTickResult } from "@/lib/fcc-campaign-tick";
import { PermanentEmailError, type OutgoingEmail } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

// Wed Oct 28, 2026 is in summer time: 10:00 Toronto is 14:00 UTC.
const WED_10AM = Date.parse("2026-10-28T14:00:00Z");
const MINUTE = 60_000;
const ADDRESS = "257 Example St, Kitchener, ON N2C 0A0, Canada";

function database() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
  raw.exec(readFileSync(new URL("../../migrations/0037_kv_store.sql", import.meta.url), "utf8"));
  const db: ProspectDb = {
    prepare(sql) {
      const statement = raw.prepare(sql);
      return { bind: (...values: unknown[]) => ({
        all: async <T,>() => ({ results: statement.all(...values) as T[] }),
        first: async <T,>() => (statement.get(...values) as T | undefined) ?? null,
        run: async () => statement.run(...values),
      }) };
    },
  };
  raw.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 1, "approvedCopy" = ?, "goBy" = 'Aidan', "goAt" = '2026-10-27T16:29:22Z' WHERE "id" = 1`).run(FCC_COPY_VERSION);
  return { raw, db };
}

function addContacts(raw: Database.Database, count: number) {
  for (let i = 1; i <= count; i += 1) {
    const at = new Date(Date.UTC(2026, 9, 26, 23, 0, 0) + i * 1000).toISOString();
    raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","createdAt","updatedAt")
      VALUES (?,?,?,?,?,?,?,1,'ready',?,?)`).run(`c${i}`, FCC_CAMPAIGN_KEY, `person${i}@co${i}.example`, "Jane", `Co ${i}`,
      JSON.stringify([{ company: `Co ${i}`, rmdNumber: `RMD${i}`, state: "IA", lastFilingDate: "2024-03-29", filingUrl: "https://example.test" }]), "named", at, at);
  }
}

function harness(state: { bounced?: string[]; warning?: string | null; refuse?: (message: OutgoingEmail) => Error | null; inboxError?: Error } = {}) {
  const sent: Array<{ to: string; at: number }> = [];
  let clock = 0;
  let ids = 0;
  let scans = 0;
  let logins = 0;
  const mailbox = async (): Promise<FccMailbox> => {
    if (state.inboxError) throw state.inboxError;
    logins += 1;
    return {
      async hasMessagesFrom() { return false; },
      async hasBounceFor(email) { return (state.bounced ?? []).includes(email); },
      async bounceCount() { return (state.bounced ?? []).filter((email) => sent.some((send) => send.to === email)).length; },
      async bouncedAmong(emails) { scans += 1; return emails.filter((email) => (state.bounced ?? []).includes(email)); },
      async googleWarning() { return state.warning ?? null; },
      async close() {},
    };
  };
  const config: FccSendConfig = {
    fromAddress: "aidan@mail.example", mailingAddress: ADDRESS, newId: () => `send-${++ids}`, mailbox,
    transport: async () => ({
      async send(message: OutgoingEmail) { const error = state.refuse?.(message); if (error) throw error; sent.push({ to: message.to, at: clock }); },
      async close() {},
    }),
  };
  /** One tick at `at` ms; waiting moves the fake clock instead of sleeping. */
  const tick = (db: ProspectDb, at: number): Promise<FccTickResult> => {
    clock = at;
    return runFccSendTick(db, config, new Date(at), { wait: async (ms) => { clock += ms; }, random: () => 0.5 });
  };
  /** Runs one tick a minute from `from` up to (not including) `to`. */
  const run = async (db: ProspectDb, from: number, to: number) => {
    const results: FccTickResult[] = [];
    for (let at = from; at < to; at += MINUTE) results.push(await tick(db, at));
    return results;
  };
  return { sent, tick, run, config, scans: () => scans, logins: () => logins };
}

const statusCount = (raw: Database.Database, status: string) =>
  (raw.prepare(`SELECT COUNT(*) AS n FROM "FccCampaignContact" WHERE "status" = ?`).get(status) as { n: number }).n;
const enabled = (raw: Database.Database) => (raw.prepare(`SELECT "enabled" FROM "FccCampaignSetting"`).get() as { enabled: number }).enabled;

test("the gap after each email is 1 to 3 minutes and every run agrees on it", () => {
  const gaps = Array.from({ length: 500 }, () => gapAfter(crypto.randomUUID()));
  assert.ok(gaps.every((gap) => gap >= FCC_GAP_MIN_MS && gap <= FCC_GAP_MAX_MS));
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 100_000, "the gaps really vary");
  assert.equal(gapAfter("send-7"), gapAfter("send-7"));
});

test("Toronto time keeps 10am at 10am when the clocks change", () => {
  assert.equal(torontoMinute(new Date("2026-10-28T14:00:00Z")), 10 * 60, "summer time");
  assert.equal(torontoMinute(new Date("2026-11-02T15:00:00Z")), 10 * 60, "winter time");
  assert.equal(torontoMinute(new Date("2026-11-02T14:00:00Z")), 9 * 60);
});

test("the first 30 go from 10:00, 1 to 3 minutes apart, in about an hour; nothing before 10 or between batches", async () => {
  const { raw, db } = database();
  addContacts(raw, 80);
  const h = harness();
  const early = await h.run(db, WED_10AM - 30 * MINUTE, WED_10AM);
  assert.ok(early.every((result) => result.status === "SKIPPED" && result.reason === "outside the send windows"));
  assert.equal(h.sent.length, 0);

  await h.run(db, WED_10AM, WED_10AM + 2 * 60 * MINUTE);
  assert.equal(h.sent.length, 30, "the first batch stops at 30");
  assert.ok(h.sent[0]!.at - WED_10AM < 20_000, "the first email goes at 10:00");
  const gaps = h.sent.slice(1).map((send, i) => send.at - h.sent[i]!.at);
  assert.ok(gaps.every((gap) => gap >= FCC_GAP_MIN_MS && gap <= FCC_GAP_MAX_MS + 15_000), `gaps: ${gaps.join(",")}`);
  const minutes = (h.sent.at(-1)!.at - h.sent[0]!.at) / MINUTE;
  assert.ok(minutes > 40 && minutes < 95, `30 emails took ${minutes} minutes`);
  assert.equal(new Set(h.sent.map((send) => send.to)).size, 30, "nobody twice");

  const lull = await h.run(db, WED_10AM + 2 * 60 * MINUTE, WED_10AM + 150 * MINUTE);
  assert.ok(lull.every((result) => result.status === "SKIPPED"));
  assert.equal(h.sent.length, 30, "nothing between 12:00 and 12:30");
});

test("the second 30 go from 12:30 when the morning had 1 bounce or fewer, and 60 is the ceiling", async () => {
  const { raw, db } = database();
  addContacts(raw, 80);
  const h = harness({ bounced: ["person3@co3.example"] });
  await h.run(db, WED_10AM, WED_10AM + 270 * MINUTE);
  assert.equal(statusCount(raw, "bounced"), 1);
  assert.ok(h.sent.some((send) => send.at >= WED_10AM + 150 * MINUTE), "the second batch went after 12:30");
  assert.ok(h.sent.filter((send) => send.at < WED_10AM + 150 * MINUTE).length <= 30);
  assert.equal(h.sent.length, 60, "60 a day, no more");
  assert.equal(enabled(raw), 1);
  const notes = await readFccNotes(db);
  assert.match(notes.lastRun?.note ?? "", /today's limit reached|Sent email 60/);
});

test("2 bounces by noon means no second batch; 3 pauses everything until a founder resumes", async () => {
  const { raw, db } = database();
  addContacts(raw, 80);
  const two = harness({ bounced: ["person1@co1.example", "person2@co2.example"] });
  await two.run(db, WED_10AM, WED_10AM + 150 * MINUTE);
  const loginsByNoon = two.logins();
  await two.run(db, WED_10AM + 150 * MINUTE, WED_10AM + 270 * MINUTE);
  assert.equal(two.sent.length, 30, "no second batch");
  assert.equal(two.logins(), loginsByNoon, "once the second batch is off, nothing logs in to Gmail");
  assert.ok(two.scans() <= 2, `bounces are matched only when a new one arrives (${two.scans()} scans)`);
  assert.equal(enabled(raw), 1, "2 bounces don't pause the campaign");
  assert.match((await readFccNotes(db)).lastRun?.note ?? "", /No second batch today: 2 emails bounced/);

  const fresh = database();
  addContacts(fresh.raw, 80);
  const three = harness({ bounced: ["person1@co1.example", "person2@co2.example", "person3@co3.example"] });
  const results = await three.run(fresh.db, WED_10AM, WED_10AM + 120 * MINUTE);
  assert.ok(results.some((result) => result.status === "PAUSED" && /3 emails bounced today/.test(result.reason)));
  assert.equal(enabled(fresh.raw), 0);
  assert.ok(three.sent.length < 30, "it stopped mid-batch");
  const stoppedAt = three.sent.length;
  await three.run(fresh.db, WED_10AM + 120 * MINUTE, WED_10AM + 270 * MINUTE);
  assert.equal(three.sent.length, stoppedAt, "nothing more while paused");
  const control = (await readFccNotes(fresh.db)).control;
  assert.equal(control?.action, "paused");
  assert.match(control?.reason ?? "", /3 emails bounced today/);
});

test("a Google warning in the inbox pauses before anything is sent", async () => {
  const { raw, db } = database();
  addContacts(raw, 10);
  const h = harness({ warning: "Google sent a critical security alert" });
  assert.deepEqual(await h.tick(db, WED_10AM), { status: "PAUSED", reason: "Google sent a critical security alert" });
  assert.equal(h.sent.length, 0);
  assert.equal(enabled(raw), 0);
  assert.equal(await pauseFcc(db, "again", "Riley"), false, "a second pause keeps the first reason");
  assert.equal((await readFccNotes(db)).control?.reason, "Google sent a critical security alert");
});

test("an email Gmail refuses pauses the campaign; the contact is not marked as a bounce", async () => {
  const { raw, db } = database();
  addContacts(raw, 10);
  const h = harness({ refuse: (message) => message.to === "person2@co2.example" ? new PermanentEmailError("SMTP 550 5.4.5 Daily user sending limit exceeded") : null });
  const results = await h.run(db, WED_10AM, WED_10AM + 30 * MINUTE);
  assert.ok(results.some((result) => result.status === "PAUSED" && /Gmail refused an email \(SMTP 550 5\.4\.5/.test(result.reason)));
  assert.equal(h.sent.length, 1);
  assert.equal(enabled(raw), 0);
  assert.equal(statusCount(raw, "bounced"), 0);
  assert.equal(statusCount(raw, "failed"), 1);
});

test("a refused login pauses; a flaky inbox connection sends nothing and tries again", async () => {
  const { raw, db } = database();
  addContacts(raw, 10);
  const flaky = harness({ inboxError: new Error("socket closed") });
  const result = await flaky.tick(db, WED_10AM);
  assert.equal(result.status, "SKIPPED");
  assert.equal(flaky.sent.length, 0);
  assert.equal(enabled(raw), 1);
  assert.match((await readFccNotes(db)).lastRun?.note ?? "", /Couldn't check the Gmail inbox/);

  const refused = harness({ inboxError: new Error("IMAP NO [AUTHENTICATIONFAILED] Invalid credentials") });
  const paused = await refused.tick(db, WED_10AM + MINUTE);
  assert.equal(paused.status, "PAUSED");
  assert.equal(enabled(raw), 0);
});

test("resume reopens only a campaign a founder already approved, and never on the weekend", async () => {
  const { raw, db } = database();
  addContacts(raw, 5);
  assert.equal(await pauseFcc(db, "Checking the inbox first", "aidan@getaxiom.ca"), true);
  const h = harness();
  assert.deepEqual(await h.tick(db, WED_10AM), { status: "SKIPPED", reason: "locked until a founder records the go" });
  assert.equal(await resumeFcc(db, "aidan@getaxiom.ca"), "RESUMED");
  assert.equal(await resumeFcc(db, "aidan@getaxiom.ca"), "ALREADY_LIVE");
  assert.equal((await readFccNotes(db)).control?.action, "resumed");
  assert.equal((await h.tick(db, WED_10AM + MINUTE)).status, "RAN");
  assert.equal(h.sent.length, 1);
  assert.deepEqual(await h.tick(db, Date.parse("2026-10-31T14:00:00Z")), { status: "SKIPPED", reason: "weekend" });

  raw.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 0, "approvedCopy" = 'an-older-copy'`).run();
  assert.equal(await resumeFcc(db, "aidan@getaxiom.ca"), "LOCKED", "a new copy version needs a new go, not a resume");
  assert.equal(enabled(raw), 0);
});

test("two runs at the same moment never send two emails at once", async () => {
  const { raw, db } = database();
  addContacts(raw, 5);
  const a = harness();
  const b = harness();
  await Promise.all([a.tick(db, WED_10AM), b.tick(db, WED_10AM)]);
  assert.equal(a.sent.length + b.sent.length, 1);
  assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM "FccCampaignSend"`).get() as { n: number }).n, 1);
});
