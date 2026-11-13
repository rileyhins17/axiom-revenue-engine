import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION } from "@/lib/fcc-campaign";
import { readFccWeeklyNumbers } from "@/lib/fcc-campaign-control";
import type { FccOwnerMail } from "@/lib/fcc-campaign-replies";
import { lastWeek, runFccWeeklyNumbers, torontoMidnightIso, type FccWeeklyNumbersConfig } from "@/lib/fcc-weekly-numbers";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

// Mon Nov 9, 2026 is in standard time: 8:00 Toronto is 13:00 UTC. Every name, place and address below is made up.
const MON_8AM = Date.parse("2026-11-09T13:00:00Z");
const HOUR = 3_600_000;
const FIRST_INBOX = "first-inbox@axiom.example";
const SECOND_INBOX = "second-inbox@axiom.example";
const LONG_REPLY = `Thanks for the note. ${"We have been meaning to look at this for a while and would like to hear more. ".repeat(4)}Can you call on Thursday?`;

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

/** FCC rows from the same week: live once, with emails, a reply and a bounce. None of it belongs in the email. */
function seedFcc(raw: Database.Database) {
  raw.prepare(`INSERT OR REPLACE INTO "FccCampaignSetting" ("id","enabled","dailyCap","approvedCopy","goBy","goAt","updatedAt") VALUES (1,0,30,?,'Jordan','2026-11-03T20:18:40Z','2026-11-03T20:18:40Z')`).run(FCC_COPY_VERSION);
  const add = (id: string, status: string, reason: string | null, updatedAt: string) =>
    raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","step1SentAt","step1MessageId","stoppedReason","createdAt","updatedAt")
      VALUES (?,?,?,?,?,'[]','named',1,?,'2026-11-03T15:00:00Z',?,?,'2026-10-26T00:00:00Z',?)`).run(id, FCC_CAMPAIGN_KEY, `${id}@carrier.example`, "Jo", `Carrier ${id}`, status, `<${id}>`, reason, updatedAt);
  add("f1", "replied", 'They wrote back Nov 4, so no more emails: "Yes, call me."', "2026-11-04T14:00:00Z");
  add("f2", "bounced", "The email bounced", "2026-11-03T15:00:05Z");
  for (const id of ["f1", "f2"]) {
    raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status") VALUES (?,?,1,?,'2026-11-03',?,'SENT')`).run(`s-${id}`, id, `${id}@carrier.example`, `<s-${id}>`);
  }
}

/** Two campaigns in the week of Nov 2 to Nov 8, and a third with nothing in it. */
function seed(raw: Database.Database) {
  seedFcc(raw);
  raw.exec(`DELETE FROM "OutreachCampaign"; DELETE FROM "OutreachInbox";`);
  raw.prepare(`INSERT INTO "OutreachInbox" ("address","name","passwordSecret","createdAt") VALUES (?,?,?,?), (?,?,?,?)`)
    .run(FIRST_INBOX, "Jordan Vale", "SENDER_PASSWORD_ONE", "2026-10-01T00:00:00.000Z", SECOND_INBOX, "Casey Brook", "SENDER_PASSWORD_TWO", "2026-10-02T00:00:00.000Z");
  raw.exec(`INSERT INTO "OutreachCampaign" ("key","name","state","stateReason","stateBy","priority","rulesJson") VALUES
    ('towns','Towns: website check','live',NULL,NULL,10,'{"successLabel":"Price requests"}'),
    ('agencies','Agencies: overflow work','paused','Waiting for a new list.','Jordan',20,'{}'),
    ('schools','Schools: website check','paused','Not started','Jordan',30,'{}');
    INSERT INTO "OutreachBatch" ("id","campaignKey","name","loadedBy","loadedAt","status") VALUES
    ('towns-1','towns','Towns 1','Jordan','2026-11-01T00:00:00.000Z','approved'), ('towns-2','towns','Towns 2','Jordan','2026-11-01T00:00:00.000Z','waiting'),
    ('agencies-1','agencies','Agencies 1','Jordan','2026-11-01T00:00:00.000Z','approved');`);
  let row = 1;
  const contact = (id: string, key: string, batch: string, email: string, fields: object, status: string, sender: string | null, updatedAt = "2026-11-01T00:00:00.000Z", due: string | null = null) =>
    raw.prepare(`INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","senderAddress","nextDueDay","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,'2026-11-01T00:00:00.000Z',?)`)
      .run(id, key, batch, (row += 1), email, JSON.stringify(fields), status, sender, due, updatedAt);
  const send = (contactId: string, key: string, step: number, day: string, inbox: string) =>
    raw.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","step","email","senderAddress","sendDay","messageId","subject","status") VALUES (?,?,?,?,?,?,?,?,'S','SENT')`)
      .run(`${contactId}-${step}`, key, contactId, step, `${contactId}@x.example`, inbox, day, `<${contactId}-${step}>`);
  const reply = (id: string, key: string, contactId: string, kind: string, from: string, inbox: string, receivedAt: string, quote: string, marks: { answeredBy?: string; success?: boolean } = {}) =>
    raw.prepare(`INSERT INTO "OutreachReply" ("id","campaignKey","contactId","inbox","fromAddress","receivedAt","quote","kind","foundAt","toldFoundersAt","answeredAt","answeredBy","successAt","successBy") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, key, contactId, inbox, from, receivedAt, quote, kind, receivedAt, receivedAt, marks.answeredBy ? receivedAt : null, marks.answeredBy ?? null, marks.success ? receivedAt : null, marks.success ? "Casey" : null);

  contact("t1", "towns", "towns-1", "clerk@maple-hollow.example", { city: "Maple Hollow" }, "replied", FIRST_INBOX, "2026-11-04T15:05:00.000Z");
  send("t1", "towns", 1, "2026-11-03", FIRST_INBOX);
  reply("r-t1", "towns", "t1", "reply", "clerk@maple-hollow.example", FIRST_INBOX, "2026-11-04T15:00:00.000Z", "Yes, what would it cost?", { answeredBy: "Jordan", success: true });
  contact("t2", "towns", "towns-1", "clerk@cedar-falls.example", { city: "Cedar Falls" }, "suppressed", SECOND_INBOX, "2026-11-05T15:05:00.000Z");
  send("t2", "towns", 1, "2026-11-03", SECOND_INBOX);
  reply("r-t2", "towns", "t2", "no_thanks", "clerk@cedar-falls.example", SECOND_INBOX, "2026-11-05T15:00:00.000Z", "Not interested, thanks.");
  contact("t3", "towns", "towns-1", "clerk@birch-point.example", { city: "Birch Point" }, "replied", FIRST_INBOX, "2026-11-04T14:00:00.000Z");
  send("t3", "towns", 1, "2026-11-03", FIRST_INBOX);
  reply("r-t3", "towns", "t3", "automatic", "clerk@birch-point.example", FIRST_INBOX, "2026-11-04T14:00:00.000Z", "Out of the office until Monday.");
  contact("t4", "towns", "towns-1", "clerk@elm-ridge.example", { city: "Elm Ridge" }, "bounced", FIRST_INBOX, "2026-11-03T15:00:05.000Z");
  send("t4", "towns", 1, "2026-11-03", FIRST_INBOX);
  // Emailed the week before, followed up last week.
  contact("t5", "towns", "towns-1", "clerk@oak-bend.example", { city: "Oak Bend" }, "done", FIRST_INBOX);
  send("t5", "towns", 1, "2026-10-27", FIRST_INBOX);
  send("t5", "towns", 2, "2026-11-03", FIRST_INBOX);
  // Still to do: a follow-up due on Mon Nov 9, two ready, one in a batch nobody approved yet.
  contact("t6", "towns", "towns-1", "clerk@fern-hill.example", { city: "Fern Hill" }, "sent", FIRST_INBOX, "2026-11-04T15:00:00.000Z", "2026-11-09");
  send("t6", "towns", 1, "2026-11-04", FIRST_INBOX);
  contact("t7", "towns", "towns-1", "clerk@sand-cove.example", { city: "Sand Cove" }, "ready", null);
  contact("t8", "towns", "towns-1", "clerk@flint-rock.example", { city: "Flint Rock" }, "ready", null);
  contact("t9", "towns", "towns-2", "clerk@gale-point.example", { city: "Gale Point" }, "ready", null);
  // Agencies: emailed from the second inbox; the reply, a long one, landed in the first.
  contact("a1", "agencies", "agencies-1", "hello@northlight.example", { agency: "Northlight Studio" }, "replied", SECOND_INBOX, "2026-11-06T16:05:00.000Z");
  send("a1", "agencies", 1, "2026-11-05", SECOND_INBOX);
  reply("r-a1", "agencies", "a1", "reply", "hello@northlight.example", FIRST_INBOX, "2026-11-06T16:00:00.000Z", LONG_REPLY);
}

function harness(options: { failMail?: number } = {}) {
  const mails: FccOwnerMail[] = [];
  let failures = options.failMail ?? 0;
  const config: FccWeeklyNumbersConfig = {
    screenUrl: "https://ops.example/dashboard",
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

test("Monday from 8:00 both founders get last week's numbers for every campaign once, in plain words, with nothing about FCC", async () => {
  const { raw, db } = database();
  seed(raw);
  const h = harness();

  assert.deepEqual(await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM - 30 * 60_000)), { status: "SKIPPED", reason: "before 8:00" });
  assert.deepEqual(await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM + 24 * HOUR)), { status: "SKIPPED", reason: "not Monday" });
  assert.equal(h.mails.length, 0);

  const sent = await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM));
  assert.deepEqual(sent, { status: "SENT", weekOf: "2026-11-09", sent: 7, replies: 2 });
  assert.equal(h.mails.length, 1);
  const mail = h.mails[0]!;
  assert.equal(mail.subject, "Last week's numbers (November 2 to November 8)");
  const lines = mail.text.split("\n");
  assert.deepEqual(lines.slice(0, 15), [
    "Last week's numbers for every campaign, November 2 to November 8.",
    "",
    "All campaigns: 7 emails sent (6 first emails and 1 follow-up; Jordan 5, Casey 2), 2 real replies, 1 no thanks, 1 automatic reply, 1 bounce.",
    "",
    "Towns: website check (Live)",
    "Sent last week: 5 first emails and 1 follow-up. 1 real reply, 1 no thanks, 1 bounce.",
    "Price requests: 1 (20 per 100 emailed)",
    "All time: 6 emailed, 1 real reply. Price requests: 1.",
    "Left: 2 ready, 1 waiting for approval, 1 follow-up due.",
    "",
    "Agencies: overflow work (Paused: Waiting for a new list)",
    "Sent last week: 1 first email and 0 follow-ups. 1 real reply, 0 no thanks, 0 bounces.",
    "Interested replies: 0 (0 per 100 emailed)",
    "All time: 1 emailed, 1 real reply. Interested replies: 0.",
    "Left: 0 ready, 0 waiting for approval, 0 follow-ups due.",
  ]);
  assert.ok(!mail.text.includes("Schools"), "a campaign with nothing sent and nothing left is left out");

  // Who wrote back, newest first: the organisation, the address, what they said, and which inbox answers.
  const who = lines.slice(lines.indexOf("Who wrote back:"));
  assert.match(who[1]!, /^1\. Northlight Studio \(hello@northlight\.example\)\. Agencies: overflow work, Nov 6, 11:00/);
  assert.equal(who[2], `   "${LONG_REPLY.slice(0, 200).trimEnd()}..."`, "the first 200 characters");
  assert.equal(who[3], "   Answer from Casey's inbox. It came to Jordan's inbox.");
  assert.match(who[4]!, /^2\. Cedar Falls \(clerk@cedar-falls\.example\), said no thanks\. Towns: website check, Nov 5, 10:00/);
  assert.deepEqual(who.slice(5, 7), [`   "Not interested, thanks."`, "   If you answer, answer from Casey's inbox."]);
  assert.match(who[7]!, /^3\. Maple Hollow \(clerk@maple-hollow\.example\)\. Towns: website check, Nov 4, 10:00/);
  assert.deepEqual(who.slice(8, 10), [`   "Yes, what would it cost?"`, "   Answer from Jordan's inbox. Answered by Jordan."]);
  assert.ok(!mail.text.includes("Birch Point"), "an automatic reply is counted, not listed");
  assert.equal(lines.at(-1), "Everything is on the Today screen: https://ops.example/dashboard");

  assert.match(mail.html, /<strong>November 2 to November 8<\/strong>/);
  assert.match(mail.html, /<strong>Towns: website check \(Live\)<\/strong><br>Sent last week: 5 first emails and 1 follow-up\./);
  assert.match(mail.html, /Price requests: 1 \(20 per 100 emailed\)/);
  assert.match(mail.html, /Answer from Casey's inbox\. It came to Jordan's inbox\./);
  assert.match(mail.html, /<a href="https:\/\/ops\.example\/dashboard">Everything is on the Today screen<\/a>/);
  for (const part of [mail.subject, mail.text, mail.html]) {
    assert.doesNotMatch(part, /fcc/i, "FCC ended: it is not in the email");
    assert.doesNotMatch(part, /carrier/i, "nobody from the FCC list is in the email");
    assert.doesNotMatch(part, /—/, "no long dashes");
  }

  assert.deepEqual(await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM + 15 * 60_000)), { status: "SKIPPED", reason: "already sent this week" });
  assert.deepEqual(await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM + 3 * HOUR)), { status: "SKIPPED", reason: "already sent this week" });
  assert.equal(h.mails.length, 1, "one email a week");
  assert.deepEqual(await readFccWeeklyNumbers(db), { weekOf: "2026-11-09", at: new Date(MON_8AM).toISOString(), from: "2026-11-02", to: "2026-11-08" });

  // The Monday after: nothing went out in the week of Nov 9, but Towns still has people left, so it is still shown.
  const nextMonday = await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM + 7 * 24 * HOUR));
  assert.deepEqual(nextMonday, { status: "SENT", weekOf: "2026-11-16", sent: 0, replies: 0 });
  assert.equal(h.mails.length, 2);
  const next = h.mails[1]!;
  assert.equal(next.subject, "Last week's numbers (November 9 to November 15)");
  assert.match(next.text, /All campaigns: no emails sent, 0 real replies, 0 no thanks, 0 automatic replies, 0 bounces\.\nIt was a silent week: nothing went out and nobody wrote back\./);
  assert.match(next.text, /Towns: website check \(Live\)\nSent last week: 0 first emails and 0 follow-ups\. 0 real replies, 0 no thanks, 0 bounces\.\nPrice requests: 0\nAll time: 6 emailed, 1 real reply\. Price requests: 1\.\nLeft: 2 ready, 1 waiting for approval, 1 follow-up due\./);
  assert.ok(!next.text.includes("Agencies"), "nothing sent and nothing left");
  assert.ok(!next.text.includes("Who wrote back"));
});

test("someone counted as a reply with no stored message is mentioned, not silently dropped from the list", async () => {
  const { raw, db } = database();
  seed(raw);
  raw.prepare(`UPDATE "OutreachContact" SET "status" = 'replied', "stoppedReason" = 'They wrote back, so no follow-up', "nextDueDay" = NULL, "updatedAt" = '2026-11-06T15:00:00.000Z' WHERE "id" = 't6'`).run();
  const h = harness();
  assert.deepEqual(await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM)), { status: "SENT", weekOf: "2026-11-09", sent: 7, replies: 3 });
  assert.match(h.mails[0]!.text, /Answered by Jordan\.\n1 more wrote back and is not listed here\. Look on the Replies screen\.\n\nEverything is on the Today screen/);
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
  seedFcc(raw);
  const h = harness();
  const sent = await runFccWeeklyNumbers(db, h.config, new Date(MON_8AM));
  assert.deepEqual(sent, { status: "SENT", weekOf: "2026-11-09", sent: 0, replies: 0 });
  assert.equal(h.mails[0]!.text, [
    "Last week's numbers for every campaign, November 2 to November 8.",
    "",
    "All campaigns: no emails sent, 0 real replies, 0 no thanks, 0 automatic replies, 0 bounces.",
    "It was a silent week: nothing went out and nobody wrote back.",
    "",
    "Everything is on the Today screen: https://ops.example/dashboard",
  ].join("\n"));
  assert.doesNotMatch(h.mails[0]!.html, /fcc/i);
});
