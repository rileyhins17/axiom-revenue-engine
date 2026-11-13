import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { lastWeek, thisWeek, torontoMidnightIso, weekNumbers } from "@/lib/outreach/outreach-week";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

// Every name, place and address here is made up. November 2026 is winter time in Toronto (UTC-5).
const FIRST_INBOX = "first-inbox@axiom.example";
const SECOND_INBOX = "second-inbox@axiom.example";
const OLD_INBOX = "old-inbox@axiom.example";
const FRI_NOV_13_NOON = new Date("2026-11-13T17:00:00Z");
const MON_NOV_16_8AM = new Date("2026-11-16T13:00:00Z");

function database() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
  raw.exec(readFileSync(new URL("../../../migrations/0037_kv_store.sql", import.meta.url), "utf8"));
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
  // Start from nothing: the migrations add one campaign and the two live inboxes.
  raw.exec(`DELETE FROM "OutreachCampaign"; DELETE FROM "OutreachInbox";`);
  return { raw, db };
}

function seed(raw: Database.Database) {
  raw.prepare(`INSERT INTO "OutreachInbox" ("address","name","passwordSecret","createdAt") VALUES (?,?,?,?), (?,?,?,?)`)
    .run(FIRST_INBOX, "Jordan Vale", "SENDER_PASSWORD_ONE", "2026-10-01T00:00:00.000Z", SECOND_INBOX, "Casey Brook", "SENDER_PASSWORD_TWO", "2026-10-02T00:00:00.000Z");
  // Added out of order: the week lists campaigns by priority.
  const campaign = (key: string, name: string, state: string, reason: string | null, priority: number, rules: string) =>
    raw.prepare(`INSERT INTO "OutreachCampaign" ("key","name","state","stateReason","stateBy","priority","rulesJson") VALUES (?,?,?,?,?,?,?)`).run(key, name, state, reason, reason ? "Jordan" : null, priority, rules);
  campaign("schools", "Schools: website check", "paused", null, 30, "{}");
  campaign("agencies", "Agencies: overflow work", "paused", "Waiting for a new list", 20, "{}");
  campaign("towns", "Towns: website check", "live", null, 10, `{"successLabel":"Price requests"}`);
  const batch = (id: string, key: string, status: string) =>
    raw.prepare(`INSERT INTO "OutreachBatch" ("id","campaignKey","name","loadedBy","loadedAt","status") VALUES (?,?,?,'Jordan','2026-11-01T00:00:00.000Z',?)`).run(id, key, id, status);
  batch("towns-1", "towns", "approved");
  batch("towns-2", "towns", "waiting");
  batch("agencies-1", "agencies", "approved");

  let row = 1;
  const contact = (id: string, key: string, email: string, fields: object, status: string, extra: { batch?: string; reason?: string; updatedAt?: string; sender?: string; due?: string } = {}) =>
    raw.prepare(`INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","stoppedReason","senderAddress","nextDueDay","createdAt","updatedAt")
      VALUES (?,?,?,?,?,?,?,?,?,?,'2026-11-01T00:00:00.000Z',?)`)
      .run(id, key, extra.batch ?? `${key}-1`, (row += 1), email, JSON.stringify(fields), status, extra.reason ?? null, extra.sender ?? null, extra.due ?? null, extra.updatedAt ?? "2026-11-01T00:00:00.000Z");
  const send = (contactId: string, key: string, step: number, day: string, inbox: string, status = "SENT") =>
    raw.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","step","email","senderAddress","sendDay","messageId","subject","status") VALUES (?,?,?,?,?,?,?,?,'S',?)`)
      .run(`${contactId}-${step}-${status}`, key, contactId, step, `${contactId}@x.example`, inbox, day, `<${contactId}-${step}-${status}>`, status);
  const reply = (id: string, key: string, contactId: string, kind: string, receivedAt: string | null, foundAt: string, extra: { inbox?: string; from?: string; quote?: string; answeredAt?: string; answeredBy?: string; successAt?: string } = {}) =>
    raw.prepare(`INSERT INTO "OutreachReply" ("id","campaignKey","contactId","inbox","fromAddress","receivedAt","quote","kind","foundAt","toldFoundersAt","answeredAt","answeredBy","successAt","successBy")
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, key, contactId, extra.inbox ?? FIRST_INBOX, extra.from ?? `${contactId}@x.example`, receivedAt, extra.quote ?? null, kind, foundAt, foundAt,
        extra.answeredAt ?? null, extra.answeredBy ?? null, extra.successAt ?? null, extra.successAt ? "Casey" : null);

  // Towns. t1: emailed the week before, followed up this week, wrote back, was answered and counts as a price request.
  contact("t1", "towns", "clerk@maple-hollow.example", { city: "Maple Hollow" }, "replied", { sender: FIRST_INBOX, updatedAt: "2026-11-11T15:05:00.000Z" });
  send("t1", "towns", 1, "2026-11-03", FIRST_INBOX);
  send("t1", "towns", 2, "2026-11-10", FIRST_INBOX);
  reply("r-t1", "towns", "t1", "reply", "2026-11-11T15:00:00.000Z", "2026-11-11T15:05:00.000Z",
    { quote: "Yes, please send the full report.", answeredAt: "2026-11-11T16:00:00.000Z", answeredBy: "Jordan", successAt: "2026-11-12T16:00:00.000Z" });
  // t2: said no thanks.
  contact("t2", "towns", "clerk@cedar-falls.example", { city: "Cedar Falls" }, "suppressed", { sender: SECOND_INBOX, updatedAt: "2026-11-12T16:35:00.000Z" });
  send("t2", "towns", 1, "2026-11-10", SECOND_INBOX);
  reply("r-t2", "towns", "t2", "no_thanks", "2026-11-12T16:30:00.000Z", "2026-11-12T16:35:00.000Z", { inbox: SECOND_INBOX, quote: "Not interested, thanks." });
  // t3: an automatic reply that carried no date, so it counts for the week it was found in.
  contact("t3", "towns", "clerk@birch-point.example", { city: "Birch Point" }, "replied", { sender: FIRST_INBOX, reason: "They sent an automatic reply, so no more emails", updatedAt: "2026-11-12T14:00:00.000Z" });
  send("t3", "towns", 1, "2026-11-10", FIRST_INBOX);
  reply("r-t3", "towns", "t3", "automatic", null, "2026-11-12T14:00:00.000Z", { quote: "Out of the office until Monday." });
  // t4: bounced.
  contact("t4", "towns", "clerk@elm-ridge.example", { city: "Elm Ridge" }, "bounced", { sender: FIRST_INBOX, reason: "The email bounced", updatedAt: "2026-11-10T15:00:05.000Z" });
  send("t4", "towns", 1, "2026-11-10", FIRST_INBOX);
  // t5: marked replied by the sender's own inbox look just before a follow-up, with no stored message.
  contact("t5", "towns", "clerk@oak-bend.example", { city: "Oak Bend" }, "replied", { sender: FIRST_INBOX, reason: "They wrote back, so no follow-up", updatedAt: "2026-11-10T14:30:00.000Z" });
  send("t5", "towns", 1, "2026-11-03", FIRST_INBOX);
  // t6: the same, the week before, and it was an automatic reply.
  contact("t6", "towns", "clerk@pine-gap.example", { city: "Pine Gap" }, "replied", { sender: FIRST_INBOX, reason: "They sent an automatic reply Nov 4, so no more emails", updatedAt: "2026-11-04T15:00:00.000Z" });
  send("t6", "towns", 1, "2026-11-03", FIRST_INBOX);
  // t7: wrote back at 11:30 pm Toronto on Sunday Nov 15 (already Monday in UTC). No town or company in its row.
  contact("t7", "towns", "clerk@ash-grove.example", {}, "replied", { sender: SECOND_INBOX, updatedAt: "2026-11-16T04:35:00.000Z" });
  send("t7", "towns", 1, "2026-11-04", SECOND_INBOX);
  reply("r-t7", "towns", "t7", "reply", "2026-11-16T04:30:00.000Z", "2026-11-16T12:05:00.000Z", { inbox: SECOND_INBOX, from: "clerk@ash-grove.example", quote: "What would it cost?" });
  // t8: wrote back at 11:30 pm Toronto on Sunday Nov 8, the week before; a founder marked it a price request on Nov 10.
  contact("t8", "towns", "clerk@willow-creek.example", { city: "Willow Creek" }, "replied", { sender: FIRST_INBOX, updatedAt: "2026-11-09T04:35:00.000Z" });
  send("t8", "towns", 1, "2026-11-03", FIRST_INBOX);
  reply("r-t8", "towns", "t8", "reply", "2026-11-09T04:30:00.000Z", "2026-11-09T12:05:00.000Z", { quote: "Send me a price.", successAt: "2026-11-10T15:00:00.000Z" });
  // t9 and t10 wait for a follow-up (due Fri Nov 13 and Mon Nov 16); t14's email was claimed and never confirmed.
  contact("t9", "towns", "clerk@fern-hill.example", { city: "Fern Hill" }, "sent", { sender: FIRST_INBOX, due: "2026-11-13" });
  send("t9", "towns", 1, "2026-11-06", FIRST_INBOX);
  contact("t10", "towns", "clerk@moss-lake.example", { city: "Moss Lake" }, "sent", { sender: FIRST_INBOX, due: "2026-11-16" });
  send("t10", "towns", 1, "2026-11-09", FIRST_INBOX);
  contact("t14", "towns", "clerk@reed-bay.example", { city: "Reed Bay" }, "sent", { sender: FIRST_INBOX, due: "2026-11-19" });
  send("t14", "towns", 1, "2026-11-12", FIRST_INBOX, "CLAIMED");
  // An email Gmail refused and a test email to our own inbox: neither is an email that left for a contact.
  raw.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","kind","step","email","senderAddress","sendDay","messageId","subject","status") VALUES
    ('refused','towns','t9','real',2,'t9@x.example',?,'2026-11-12','<refused>','S','FAILED'), ('test-1','towns',NULL,'test',1,?,?,'2026-11-12','<test-1>','S','SENT')`).run(FIRST_INBOX, FIRST_INBOX, FIRST_INBOX);
  // Still to email: two in the approved batch, one in a batch nobody has approved yet.
  contact("t11", "towns", "clerk@sand-cove.example", { city: "Sand Cove" }, "ready");
  contact("t12", "towns", "clerk@flint-rock.example", { city: "Flint Rock" }, "ready");
  contact("t13", "towns", "clerk@gale-point.example", { city: "Gale Point" }, "ready", { batch: "towns-2" });

  // Agencies. a1: emailed from the second inbox, and the reply landed in the first one.
  contact("a1", "agencies", "hello@northlight.example", { agency: "Northlight Studio" }, "replied", { sender: SECOND_INBOX, updatedAt: "2026-11-12T18:05:00.000Z" });
  send("a1", "agencies", 1, "2026-11-11", SECOND_INBOX);
  reply("r-a1", "agencies", "a1", "reply", "2026-11-12T18:00:00.000Z", "2026-11-12T18:05:00.000Z", { inbox: FIRST_INBOX, quote: "Can we talk next week?" });
  // a2: emailed from an inbox that is no longer a sending inbox.
  contact("a2", "agencies", "team@tidewater.example", { agency: "Tidewater Digital" }, "done", { sender: OLD_INBOX });
  send("a2", "agencies", 1, "2026-11-05", OLD_INBOX);
  send("a2", "agencies", 2, "2026-11-12", OLD_INBOX);
  // a3: wrote twice in the week, which is one person who wrote back and two messages to read.
  contact("a3", "agencies", "info@harbour-works.example", { company: "Harbour Works" }, "replied", { sender: SECOND_INBOX, updatedAt: "2026-11-12T13:05:00.000Z" });
  send("a3", "agencies", 1, "2026-11-11", SECOND_INBOX);
  reply("r-a3-1", "agencies", "a3", "reply", "2026-11-12T13:00:00.000Z", "2026-11-12T13:05:00.000Z", { inbox: SECOND_INBOX, quote: "Tell me more." });
  reply("r-a3-2", "agencies", "a3", "reply", "2026-11-13T15:00:00.000Z", "2026-11-13T15:05:00.000Z", { inbox: SECOND_INBOX, quote: "Also, do you do audits?" });
}

test("this week runs from Monday to today and last week is the Monday to Sunday before, in Toronto days", () => {
  assert.deepEqual(thisWeek(FRI_NOV_13_NOON), { from: "2026-11-09", to: "2026-11-13" });
  assert.deepEqual(thisWeek(new Date("2026-11-09T05:00:00Z")), { from: "2026-11-09", to: "2026-11-09" }, "Monday at midnight Toronto starts a new week");
  assert.deepEqual(thisWeek(new Date("2026-11-16T04:30:00Z")), { from: "2026-11-09", to: "2026-11-15" }, "Sunday 11:30 pm Toronto is still that week");
  assert.deepEqual(thisWeek(new Date("2026-11-01T16:00:00Z")), { from: "2026-10-26", to: "2026-11-01" }, "the Sunday the clocks go back");
  assert.deepEqual(lastWeek(FRI_NOV_13_NOON), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(lastWeek(MON_NOV_16_8AM), { from: "2026-11-09", to: "2026-11-15" });
  assert.equal(torontoMidnightIso("2026-11-09"), "2026-11-09T05:00:00.000Z");
  assert.equal(torontoMidnightIso("2026-11-01"), "2026-11-01T04:00:00.000Z", "the day the clocks go back starts in daylight time");
});

test("a week's numbers for every campaign: sends by step and inbox, each kind of reply, bounces, the success number, all time and what is left", async () => {
  const { raw, db } = database();
  seed(raw);
  const week = await weekNumbers(db, "2026-11-09", "2026-11-15", MON_NOV_16_8AM);

  assert.deepEqual([week.from, week.to], ["2026-11-09", "2026-11-15"]);
  assert.deepEqual(week.campaigns.map((campaign) => campaign.key), ["towns", "agencies", "schools"], "every campaign, by priority");
  const [towns, agencies, schools] = week.campaigns;
  assert.deepEqual(towns, {
    key: "towns", name: "Towns: website check", state: "live", stateReason: null,
    sent: { first: 5, followUps: 1 }, // t2, t3, t4, t10 and t14 (claimed counts); t1's follow-up. Not the refused one or the test.
    replies: 3, // t1, t7 (Sunday 11:30 pm Toronto) and t5 (no stored message); not t8 from the Sunday before
    noThanks: 1, automatic: 1, bounced: 1,
    success: 2, successLabel: "Price requests", // t1, and t8: marked this week though the reply came the week before
    allTime: { emailed: 10, followUps: 1, replies: 4, noThanks: 1, automatic: 2, bounced: 1, success: 2 },
    left: { ready: 2, waitingApproval: 1, followUpsDue: 2 },
  });
  assert.deepEqual(agencies, {
    key: "agencies", name: "Agencies: overflow work", state: "paused", stateReason: "Waiting for a new list",
    sent: { first: 2, followUps: 1 }, replies: 2, noThanks: 0, automatic: 0, bounced: 0, success: 0, successLabel: "Interested replies",
    allTime: { emailed: 3, followUps: 1, replies: 2, noThanks: 0, automatic: 0, bounced: 0, success: 0 },
    left: { ready: 0, waitingApproval: 0, followUpsDue: 0 },
  });
  assert.deepEqual(schools, {
    key: "schools", name: "Schools: website check", state: "paused", stateReason: null,
    sent: { first: 0, followUps: 0 }, replies: 0, noThanks: 0, automatic: 0, bounced: 0, success: 0, successLabel: "Interested replies",
    allTime: { emailed: 0, followUps: 0, replies: 0, noThanks: 0, automatic: 0, bounced: 0, success: 0 },
    left: { ready: 0, waitingApproval: 0, followUpsDue: 0 },
  });
  assert.deepEqual(week.totals, { sent: 9, first: 7, followUps: 2, replies: 5, noThanks: 1, automatic: 1, bounced: 1, success: 2 });
  assert.deepEqual(week.byInbox, [
    { address: FIRST_INBOX, name: "Jordan Vale", sent: 5 },
    { address: SECOND_INBOX, name: "Casey Brook", sent: 3 },
    { address: OLD_INBOX, name: OLD_INBOX, sent: 1 },
  ]);
});

test("who wrote back in the week: real replies and no-thanks, newest first, with where to answer from and the founders' marks", async () => {
  const { raw, db } = database();
  seed(raw);
  const { people } = await weekNumbers(db, "2026-11-09", "2026-11-15", MON_NOV_16_8AM);
  assert.deepEqual(people.map((reply) => reply.id), ["r-t7", "r-a3-2", "r-a1", "r-t2", "r-a3-1", "r-t1"], "no automatic reply, nothing from the week before");
  assert.deepEqual(people.map((reply) => reply.label), ["clerk@ash-grove.example", "Harbour Works", "Northlight Studio", "Cedar Falls", "Harbour Works", "Maple Hollow"], "city, else company, else agency, else the address");
  assert.deepEqual(people.at(-1), {
    id: "r-t1", campaignKey: "towns", campaign: "Towns: website check", contactId: "t1", label: "Maple Hollow", from: "t1@x.example", kind: "reply",
    at: "2026-11-11T15:00:00.000Z", quote: "Yes, please send the full report.", answerFrom: FIRST_INBOX, answerFromName: "Jordan Vale", inbox: FIRST_INBOX, inboxName: "Jordan Vale",
    answeredAt: "2026-11-11T16:00:00.000Z", answeredBy: "Jordan", success: true,
  });
  const landedElsewhere = people.find((reply) => reply.id === "r-a1")!;
  assert.deepEqual([landedElsewhere.answerFrom, landedElsewhere.answerFromName, landedElsewhere.inbox, landedElsewhere.inboxName], [SECOND_INBOX, "Casey Brook", FIRST_INBOX, "Jordan Vale"]);
  const noThanks = people.find((reply) => reply.id === "r-t2")!;
  assert.deepEqual([noThanks.kind, noThanks.answeredAt, noThanks.answeredBy, noThanks.success], ["no_thanks", null, null, false]);
});

test("the week ends at Toronto midnight: Sunday 11:30 pm belongs to the week it is in, and a contact with no stored message counts in the week it was marked", async () => {
  const { raw, db } = database();
  seed(raw);
  const before = await weekNumbers(db, "2026-11-02", "2026-11-08", FRI_NOV_13_NOON);
  const [towns, agencies] = before.campaigns;
  assert.deepEqual(towns!.sent, { first: 6, followUps: 0 });
  assert.equal(towns!.replies, 1, "t8, at 11:30 pm Toronto on Sunday Nov 8");
  assert.equal(towns!.automatic, 1, "t6: marked replied with no stored message, and its note says automatic reply");
  assert.deepEqual([towns!.noThanks, towns!.bounced, towns!.success], [0, 0, 0], "t8's price request was marked the week after");
  assert.deepEqual(towns!.left, { ready: 2, waitingApproval: 1, followUpsDue: 1 }, "on Fri Nov 13 only t9's follow-up is due");
  assert.deepEqual(agencies!.sent, { first: 1, followUps: 0 });
  assert.deepEqual(before.byInbox, [{ address: FIRST_INBOX, name: "Jordan Vale", sent: 5 }, { address: SECOND_INBOX, name: "Casey Brook", sent: 1 }, { address: OLD_INBOX, name: OLD_INBOX, sent: 1 }]);
  assert.deepEqual(before.people.map((reply) => reply.id), ["r-t8"]);
  assert.equal(before.people[0]!.success, true);

  // Monday to Friday of the week after: Sunday night's reply is not in yet.
  const soFar = await weekNumbers(db, "2026-11-09", "2026-11-13", FRI_NOV_13_NOON);
  assert.equal(soFar.campaigns[0]!.replies, 2, "t1 and t5; t7 writes on Sunday");
  assert.ok(!soFar.people.some((reply) => reply.id === "r-t7"));

  // Once the hourly check stores t5's message, the message counts (in the week it was received) instead of the mark.
  raw.prepare(`INSERT INTO "OutreachReply" ("id","campaignKey","contactId","inbox","fromAddress","receivedAt","kind","foundAt") VALUES ('r-t5','towns','t5',?,'t5@x.example','2026-11-10T14:00:00.000Z','reply','2026-11-10T15:05:00.000Z')`).run(FIRST_INBOX);
  const stored = await weekNumbers(db, "2026-11-09", "2026-11-13", FRI_NOV_13_NOON);
  assert.equal(stored.campaigns[0]!.replies, 2, "still one reply from t5, not two");
  assert.equal(stored.campaigns[0]!.allTime.replies, 4);
});

test("an empty week lists every campaign with zeros, keeps all time and what is left, and has nobody to list", async () => {
  const { raw, db } = database();
  seed(raw);
  const week = await weekNumbers(db, "2026-11-16", "2026-11-22", MON_NOV_16_8AM);
  assert.deepEqual(week.totals, { sent: 0, first: 0, followUps: 0, replies: 0, noThanks: 0, automatic: 0, bounced: 0, success: 0 });
  assert.deepEqual(week.byInbox, []);
  assert.deepEqual(week.people, []);
  assert.equal(week.campaigns.length, 3);
  assert.deepEqual(week.campaigns[0]!.allTime, { emailed: 10, followUps: 1, replies: 4, noThanks: 1, automatic: 2, bounced: 1, success: 2 });
  assert.deepEqual(week.campaigns[0]!.left, { ready: 2, waitingApproval: 1, followUpsDue: 2 });

  const nothing = database();
  const none = await weekNumbers(nothing.db, "2026-11-09", "2026-11-15", MON_NOV_16_8AM);
  assert.deepEqual([none.campaigns, none.byInbox, none.people], [[], [], []], "no campaign at all");
  assert.equal(none.totals.sent, 0);
});

test("a week that isn't two days in order is refused before anything is read", async () => {
  const { db } = database();
  await assert.rejects(weekNumbers(db, "2026-11-15", "2026-11-09", MON_NOV_16_8AM), /first and a last day/);
  await assert.rejects(weekNumbers(db, "last week", "2026-11-09", MON_NOV_16_8AM), /first and a last day/);
});
