import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION, FCC_NOV6_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { readFccWeeklyNumbers } from "@/lib/fcc-campaign-control";
import type { FccOwnerMail } from "@/lib/fcc-campaign-replies";
import { fccWeekNumbers, lastWeek, runFccWeeklyNumbers, torontoMidnightIso, type FccWeeklyNumbersConfig } from "@/lib/fcc-weekly-numbers";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

// Mon Nov 9, 2026 is in standard time: 8:00 Toronto is 13:00 UTC.
const MON_8AM = Date.parse("2026-11-09T13:00:00Z");
const HOUR = 3_600_000;
const INBOXES = [{ key: "", name: "Aidan" }, { key: "riley@mail.example", name: "Riley" }];

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
  return { raw, db };
}

function seed(raw: Database.Database) {
  raw.prepare(`INSERT OR REPLACE INTO "FccCampaignSetting" ("id","enabled","dailyCap","approvedCopy","goBy","goAt","updatedAt") VALUES (1,1,30,?,'Aidan','2026-11-03T20:18:40Z','2026-11-03T20:18:40Z')`).run(FCC_COPY_VERSION);
  const add = (id: string, key: string, status: string, sentAt: string | null, reason: string | null, updatedAt: string, inbox: string | null = null) =>
    raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","step1SentAt","step1MessageId","stoppedReason","senderAddress","createdAt","updatedAt")
      VALUES (?,?,?,?,?,'[]','named',1,?,?,?,?,?,'2026-10-26T00:00:00Z',?)`)
      .run(id, key, `${id}@x.example`, "Jo", `Co ${id}`, status, sentAt, sentAt ? `<fcc-v4-${id}-1@gmail.com>` : null, reason, inbox, updatedAt);
  // Last week (Nov 2 to Nov 8): one real reply, one no, one automatic reply, one bounce; a reply from the week before; one still ready.
  add("a", FCC_CAMPAIGN_KEY, "replied", "2026-11-03T15:00:00Z", 'They wrote back Nov 4, so no more emails: "Yes, call me."', "2026-11-04T14:00:00Z");
  add("b", FCC_CAMPAIGN_KEY, "replied", "2026-11-03T15:00:00Z", 'They wrote back Nov 5, so no more emails: "Not interested, thanks."', "2026-11-05T14:00:00Z", "riley@mail.example");
  add("c", FCC_CAMPAIGN_KEY, "replied", "2026-11-03T15:00:00Z", 'They sent an automatic reply Nov 3, so no more emails: "Out until Monday."', "2026-11-04T14:00:00Z");
  add("d", FCC_CAMPAIGN_KEY, "bounced", "2026-11-03T15:00:00Z", "The email bounced", "2026-11-03T15:00:05Z");
  add("e", FCC_CAMPAIGN_KEY, "replied", "2026-10-28T15:00:00Z", 'They wrote back Oct 30, so no more emails: "Stop."', "2026-10-30T14:00:00Z");
  add("f", FCC_CAMPAIGN_KEY, "ready", null, null, "2026-10-26T00:00:00Z");
  // Sunday night Toronto is already Monday in UTC: a reply marked at 11 pm Sunday still counts for last week.
  add("g", FCC_NOV6_CAMPAIGN_KEY, "replied", "2026-11-04T15:00:00Z", 'They wrote back Nov 8, so no more emails: "Which form?"', "2026-11-09T04:00:00Z");
  const send = (id: string, contact: string, step: number, day: string, inbox: string | null) =>
    raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status","senderAddress") VALUES (?,?,?,?,?,?,'SENT',?)`)
      .run(id, contact, step, `${contact}@x.example`, day, `<${id}>`, inbox);
  send("s1", "a", 1, "2026-11-03", null);
  send("s2", "b", 1, "2026-11-03", "riley@mail.example");
  send("s3", "c", 1, "2026-11-03", null);
  send("s4", "d", 1, "2026-11-03", null);
  send("s5", "g", 1, "2026-11-04", null);
  send("s6", "a", 2, "2026-11-06", null);
  send("s7", "e", 1, "2026-10-28", null);
  send("s8", "e", 2, "2026-11-09", null);
}

function harness(options: { failMail?: number } = {}) {
  const mails: FccOwnerMail[] = [];
  let failures = options.failMail ?? 0;
  const config: FccWeeklyNumbersConfig = {
    screenUrl: "https://ops.example/fcc",
    inboxes: INBOXES,
    async tellFounders(mail) {
      if (failures > 0) { failures -= 1; throw new Error("mail down"); }
      mails.push(mail);
    },
  };
  return { config, mails };
}

test("last week is Monday to Sunday in Toronto days, and Toronto midnight is right on both sides of the clock change", () => {
  assert.deepEqual(lastWeek(new Date(MON_8AM)), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(lastWeek(new Date("2026-11-11T20:00:00Z")), { from: "2026-11-02", to: "2026-11-08" }, "a Wednesday looks back to the same week");
  assert.deepEqual(lastWeek(new Date("2026-11-16T04:30:00Z")), { from: "2026-11-02", to: "2026-11-08" }, "Sunday 11:30 pm Toronto is still last week's Sunday");
  assert.equal(torontoMidnightIso("2026-11-02"), "2026-11-02T05:00:00.000Z", "standard time");
  assert.equal(torontoMidnightIso("2026-10-26"), "2026-10-26T04:00:00.000Z", "daylight time");
  assert.equal(torontoMidnightIso("2026-11-01"), "2026-11-01T04:00:00.000Z", "the day the clocks go back starts in daylight time");
});

test("the week's numbers count sends by inbox and step, replies and bounces by Toronto week, and leave out the week before", async () => {
  const { raw, db } = database();
  seed(raw);
  const week = await fccWeekNumbers(db, INBOXES, "2026-11-02", "2026-11-08");
  assert.deepEqual(week.sent, { first: 5, followUps: 1, byInbox: [{ name: "Aidan", sent: 5 }, { name: "Riley", sent: 1 }] });
  assert.equal(week.replies.real, 3, "a, b and g (Sunday 11 pm Toronto); not e from the week before, not c's automatic reply");
  assert.equal(week.replies.automatic, 1);
  assert.equal(week.replies.saidNo, 1);
  assert.deepEqual(week.replies.people.map((person) => person.company), ["Co g", "Co b", "Co a"]);
  assert.equal(week.bounced, 1);
});

test("Monday from 8:00 both founders get last week's numbers once, in plain words", async () => {
  const { raw, db } = database();
  seed(raw);
  const h = harness();

  assert.deepEqual(await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM - 30 * 60_000)), { status: "SKIPPED", reason: "before 8:00" });
  assert.deepEqual(await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM + 24 * HOUR)), { status: "SKIPPED", reason: "not Monday" });
  assert.equal(h.mails.length, 0);

  const sent = await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM));
  assert.deepEqual(sent, { status: "SENT", weekOf: "2026-11-09", sent: 6, replies: 3 });
  assert.equal(h.mails.length, 1);
  const mail = h.mails[0]!;
  assert.equal(mail.subject, "FCC: last week's numbers (November 2 to November 8)");
  assert.match(mail.text, /^FCC numbers for November 2 to November 8\./);
  assert.match(mail.text, /6 FCC emails went out last week: 5 first emails and 1 follow-up \(Aidan 5, Riley 1\)\./);
  assert.match(mail.text, /3 people wrote back last week, 1 of them saying no, plus 1 automatic reply\./);
  assert.match(mail.text, /1 email bounced last week\./);
  assert.match(mail.text, /Who wrote back:\n1\. Co g \(g@x\.example\): They wrote back Nov 8, so no more emails: "Which form\?"\n2\. Co b/);
  assert.match(mail.text, /All time: 6 companies emailed, 4 real replies \(reply rate 66\.7%\), 1 bounce \(16\.7%\)\./);
  assert.match(mail.text, /Sending is live\./);
  assert.match(mail.text, /Left on the list: 1 company ready for a first email, 0 follow-ups due now and 0 coming; at \d+ new companies a weekday the list lasts about 1 more weekday\./);
  assert.match(mail.text, /By email version, all time:\n- Question email \(Oct 29–Nov 1\): 6 emailed, 4 replies \(66\.7%\)/);
  assert.match(mail.text, /Everything is on the FCC screen: https:\/\/ops\.example\/fcc$/);
  assert.match(mail.html, /<strong>November 2 to November 8<\/strong>/);
  assert.match(mail.html, /<a href="https:\/\/ops\.example\/fcc">/);

  assert.deepEqual(await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM + 15 * 60_000)), { status: "SKIPPED", reason: "already sent this week" });
  assert.deepEqual(await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM + 3 * HOUR)), { status: "SKIPPED", reason: "already sent this week" });
  assert.equal(h.mails.length, 1, "one email a week");
  assert.deepEqual(await readFccWeeklyNumbers(db), { weekOf: "2026-11-09", at: new Date(MON_8AM).toISOString(), from: "2026-11-02", to: "2026-11-08" });

  const nextMonday = await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM + 7 * 24 * HOUR));
  assert.equal(nextMonday.status, "SENT");
  assert.equal(h.mails.length, 2);
  assert.match(h.mails[1]!.text, /1 FCC email went out last week: 0 first emails and 1 follow-up \(Aidan 1\)\./);
  assert.match(h.mails[1]!.text, /Nobody wrote back last week\./);
  assert.match(h.mails[1]!.text, /Nothing bounced last week\./);
});

test("when the email fails it is tried again next hour, not next minute, and the week is not marked done", async () => {
  const { raw, db } = database();
  seed(raw);
  const h = harness({ failMail: 1 });
  await assert.rejects(runFccWeeklyNumbers(db, h.config, new Date(MON_8AM)), /mail down/);
  assert.equal(await readFccWeeklyNumbers(db), null);
  assert.deepEqual(await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM + 15 * 60_000)), { status: "SKIPPED", reason: "already tried this hour" });
  assert.equal((await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM + HOUR))).status, "SENT");
  assert.equal(h.mails.length, 1);
});

test("a week with nothing sent still gets its email, so a silent week is noticed", async () => {
  const { raw, db } = database();
  raw.prepare(`INSERT OR REPLACE INTO "FccCampaignSetting" ("id","enabled","dailyCap","approvedCopy","goBy","goAt","updatedAt") VALUES (1,0,30,?,'Aidan','2026-11-03T20:18:40Z','2026-11-03T20:18:40Z')`).run(FCC_COPY_VERSION);
  const h = harness();
  const sent = await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM));
  assert.deepEqual(sent, { status: "SENT", weekOf: "2026-11-09", sent: 0, replies: 0 });
  assert.match(h.mails[0]!.text, /No FCC emails went out last week\.\nNobody wrote back last week\.\nNothing bounced last week\./);
  assert.match(h.mails[0]!.text, /Sending is PAUSED\./);
  assert.match(h.mails[0]!.text, /All time: 0 companies emailed, 0 real replies \(reply rate n\/a\), 0 bounces \(n\/a\)\./);
});
