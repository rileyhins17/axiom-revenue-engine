/**
 * The rules behind the outreach-first screens (Today, Replies, Inboxes, the do-not-email list, the campaign page),
 * on an in-memory database of made-up people. The clock is pinned: Fri Nov 13, 2026, 10:30 a.m. Toronto.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION } from "@/lib/fcc-campaign";
import { addressBlocked } from "@/lib/outreach/outreach-blocked";
import { campaignNextWindow, inboxNext, inboxNextText } from "@/lib/outreach/outreach-inbox-health";
import { checkDoNotEmail, contactStatusText, findContacts, readQuery, recentBlocks } from "@/lib/outreach/outreach-lookup";
import { readCampaign, successLabelOf, type Campaign } from "@/lib/outreach/outreach-model";
import { OUTREACH_REPLY_STATE } from "@/lib/outreach/outreach-replies";
import { FCC_FILTER, getReply, gmailSearchUrl, listReplies, markReply, organisationOf, personOf } from "@/lib/outreach/outreach-reply-list";
import { OUTREACH_AUTO_PAUSE_BY } from "@/lib/outreach/outreach-sender";
import { batchPhase, campaignDetail } from "@/lib/outreach/outreach-status";
import { needsYou, nextEmailText, todayData } from "@/lib/outreach/outreach-today";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

const NOW = new Date("2026-11-13T15:30:00Z");
const TODAY = "2026-11-13";
const FIRST = "first-inbox@axiom.example";   // "Aidan Example"
const SECOND = "second-inbox@axiom.example"; // "Riley Example"
const WORDS = JSON.stringify({ steps: [{ subject: "About {city}'s website", body: "Hi {first_name}" }, { body: "Just checking, {first_name}" }] });

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
  // Made-up inboxes in place of the ones the migration names, and one live campaign approved by Aidan.
  raw.prepare(`DELETE FROM "OutreachInbox"`).run();
  raw.prepare(`INSERT INTO "OutreachInbox" ("address","name","passwordSecret","dailyMax") VALUES (?,?,?,60), (?,?,?,60)`).run(FIRST, "Aidan Example", "P1", SECOND, "Riley Example", "P2");
  raw.prepare(`UPDATE "OutreachCampaign" SET "state" = 'live', "stateReason" = NULL, "stateBy" = 'Riley', "wordsJson" = ?, "wordsVersion" = 'w1', "dailyLimit" = 60, "inboxesJson" = ?,
    "rulesJson" = '{"successLabel":"Price requests"}' WHERE "key" = 'us-cities'`).run(WORDS, JSON.stringify([{ address: FIRST, perDay: 30 }, { address: SECOND, perDay: 30 }]));
  let seq = 0;
  const batch = (id: string, options: { campaign?: string; status?: "waiting" | "approved" | "stopped"; approvedWords?: string | null } = {}) => {
    const status = options.status ?? "approved";
    raw.prepare(`INSERT INTO "OutreachBatch" ("id","campaignKey","name","loadedBy","loadedAt","status","approvedBy","approvedAt","approvedWords","sendOrder","wordsJson","wordsVersion")
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, options.campaign ?? "us-cities", id, "Riley", "2026-11-12T21:00:00.000Z", status, status === "approved" ? "Aidan" : null,
      status === "approved" ? "2026-11-12T22:00:00.000Z" : null, options.approvedWords === undefined ? (status === "approved" ? "w1" : null) : options.approvedWords, ++seq, WORDS, "w1");
    return id;
  };
  /** A person on a list. `sent`: the inbox and the moment of their first email. */
  const person = (batchId: string, place: string, options: { status?: string; sent?: { from: string; at: string }; due?: string | null; hold?: string; stopped?: string; campaign?: string; email?: string } = {}) => {
    const id = `c${++seq}`;
    const email = options.email ?? `clerk@${place.toLowerCase().replace(/[^a-z]/g, "")}.example`;
    const day = options.sent ? new Date(options.sent.at).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }) : null;
    raw.prepare(`INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","holdReason","stoppedReason","stepsSent","senderAddress","firstSentAt","firstSentDay",
      "firstMessageId","nextDueDay","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, options.campaign ?? "us-cities", batchId, seq, email,
      JSON.stringify({ email, first_name: "Pat", title: "City Clerk", city: place }), options.status ?? (options.sent ? "sent" : "ready"), options.hold ?? null, options.stopped ?? null,
      options.sent ? 1 : 0, options.sent?.from ?? null, options.sent?.at ?? null, day, options.sent ? `<m-${id}>` : null, options.due === undefined ? (options.sent ? "2026-11-20" : null) : options.due,
      "2026-11-12T21:00:00.000Z", options.sent?.at ?? "2026-11-12T21:00:00.000Z");
    if (options.sent) {
      raw.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","kind","step","email","senderAddress","sendDay","messageId","subject","status","createdAt")
        VALUES (?,?,?,'real',1,?,?,?,?,'S','SENT',?)`).run(`s-${id}`, options.campaign ?? "us-cities", id, email, options.sent.from, day, `<m-${id}>`, options.sent.at);
    }
    return { id, email };
  };
  const reply = (contact: { id: string; email: string }, kind: "reply" | "automatic" | "no_thanks", text: string, landedIn: string, at: string, from?: string) => {
    const id = `${landedIn}:[Gmail]/All Mail:${++seq}:${contact.id}`;
    raw.prepare(`INSERT INTO "OutreachReply" ("id","campaignKey","contactId","inbox","fromAddress","receivedAt","quote","kind","foundAt","toldFoundersAt") VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, (raw.prepare(`SELECT "campaignKey" AS k FROM "OutreachContact" WHERE "id" = ?`).get(contact.id) as { k: string }).k, contact.id, landedIn, from ?? contact.email, at, text, kind, at, at);
    raw.prepare(`UPDATE "OutreachContact" SET "status" = ?, "nextDueDay" = NULL, "updatedAt" = ? WHERE "id" = ?`).run(kind === "no_thanks" ? "suppressed" : "replied", at, contact.id);
    return id;
  };
  return { raw, db, batch, person, reply };
}

const sentToday = (from: string, minute: number) => ({ from, at: `2026-11-13T14:${String(minute).padStart(2, "0")}:00.000Z` });
const sentMonday = (from: string) => ({ from, at: "2026-11-09T14:10:00.000Z" });

test("Today: each founder sees what needs them, most urgent first, and nothing about FCC", async () => {
  const { raw, db, batch, person, reply } = database();
  // FCC is paused with history: none of it may reach Today.
  raw.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 0, "approvedCopy" = ?, "goBy" = 'Aidan' WHERE "id" = 1`).run(FCC_COPY_VERSION);
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","stoppedReason","createdAt","updatedAt")
    VALUES ('f1', ?, 'owner@telco.example', 'Sam', 'Made-up Telecom', '[]', 'named', 1, 'replied', 'They wrote back', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z')`).run(FCC_CAMPAIGN_KEY);

  const sending = batch("cities-B1");
  const waiting = batch("cities-IT1 A", { status: "waiting" });
  for (const place of ["Alder", "Birch", "Cedar", "Dogwood", "Elm"]) person(waiting, place);
  person(sending, "Fennel");
  const mine = person(sending, "Garnet", { sent: sentMonday(FIRST) });
  const theirs = person(sending, "Hazel", { sent: sentMonday(SECOND) });
  reply(mine, "reply", "Yes please, send the report.", FIRST, "2026-11-12T18:00:00.000Z");
  // A reply can land in the other inbox: the inbox that SENT the email still answers it.
  reply(theirs, "reply", "What would the fixes cost?", FIRST, "2026-11-13T13:00:00.000Z");
  reply(person(sending, "Iris", { sent: sentMonday(FIRST) }), "automatic", "Out of office.", FIRST, "2026-11-10T18:00:00.000Z");
  reply(person(sending, "Juniper", { sent: sentMonday(FIRST) }), "no_thanks", "Not interested.", FIRST, "2026-11-10T19:00:00.000Z");

  // The hourly reply check finished half an hour ago and opened both inboxes.
  raw.prepare(`INSERT INTO "KvStore" ("key","value","updatedAt") VALUES (?,?,?)`).run(OUTREACH_REPLY_STATE, JSON.stringify({ inboxes: {}, at: "2026-11-13T15:00:00.000Z", unread: [] }), NOW.toISOString());

  const data = await todayData(db, null, NOW);
  assert.equal(data.toAnswer.count, 2, "automatic replies and no-thanks need no answer");
  assert.deepEqual(data.waitingBatches.map((row) => [row.name, row.ready, row.why]), [["cities-IT1 A", 5, "waiting"]]);

  const aidan = needsYou(data, "Aidan");
  assert.deepEqual(aidan.cards.map((card) => card.key), ["replies", `approve:${waiting}`], "replies first, then the batch that waits for him");
  assert.equal(aidan.cards[0]!.title, "1 reply for you to answer");
  assert.equal(aidan.cards[0]!.detail, "1 more waits for Riley.");
  assert.match(aidan.cards[0]!.rows![0]!.text, /^Garnet: Yes please/);
  assert.equal(aidan.cards[0]!.rows!.length, 1, "his card lists only the replies he answers");
  assert.equal(aidan.cards[1]!.title, "cities-IT1 A: 5 emails wait for your Approve");
  assert.deepEqual(aidan.cards[1]!.action, { label: "Read the samples", href: `/campaigns/us-cities/batches/${waiting}` });
  assert.deepEqual(aidan.quiet, []);

  // Riley is not this campaign's approver: the batch is one quiet line for him, never a card.
  const riley = needsYou(data, "Riley");
  assert.deepEqual(riley.cards.map((card) => card.key), ["replies"]);
  assert.match(riley.cards[0]!.rows![0]!.text, /^Hazel: What would the fixes cost/);
  assert.match(riley.cards[0]!.rows![0]!.meta!, /answer from your inbox/);
  assert.deepEqual(riley.quiet, ["1 batch (5 emails) waits for Aidan to approve."]);

  // Someone who is neither founder gets no card to act on.
  assert.deepEqual(needsYou(data, null).cards, []);
  assert.doesNotMatch(JSON.stringify([aidan, riley, data.campaigns.map((row) => row.campaign.name)]), /fcc/i, "FCC is nowhere on Today");
});

test("Today: a campaign that paused itself, a reply check that couldn't open an inbox and a resting inbox each get a card; a founder's own pause is a quiet line", async () => {
  const { raw, db, batch, person } = database();
  raw.prepare(`INSERT INTO "OutreachCampaign" ("key","name","state","stateReason","stateBy","stateAt","dailyLimit","inboxesJson","wordsJson","wordsVersion","approversJson","priority")
    VALUES ('districts','School districts','paused','3 of its emails bounced today',?, '2026-11-12T15:07:00.000Z',20,?,?, 'w1','["Aidan"]',20),
           ('agencies','Agencies','paused','Paused from the Campaigns screen','Aidan','2026-11-11T21:24:00.000Z',20,?,?, 'w1','["Riley","Aidan"]',30)`)
    .run(OUTREACH_AUTO_PAUSE_BY, JSON.stringify([{ address: SECOND, perDay: 20 }]), WORDS, JSON.stringify([{ address: FIRST, perDay: 10 }]), WORDS);
  const sending = batch("cities-B1");
  person(sending, "Larch");
  // Three people emailed from the second inbox today have bounced: it rests, and nobody is paused by that.
  for (const [index, place] of ["Maple", "Nutmeg", "Oak"].entries()) person(sending, place, { status: "bounced", sent: sentToday(SECOND, 10 + index * 3), due: null, stopped: "The email bounced" });
  person(sending, "Pine", { sent: sentToday(FIRST, 20) });
  raw.prepare(`INSERT INTO "KvStore" ("key","value","updatedAt") VALUES (?,?,?)`).run(OUTREACH_REPLY_STATE, JSON.stringify({ inboxes: {}, at: "2026-11-13T15:00:00.000Z", unread: [SECOND] }), NOW.toISOString());

  const data = await todayData(db, null, NOW);
  assert.equal(data.sentToday, 4);
  const second = data.inboxes.find((inbox) => inbox.address === SECOND)!;
  assert.deepEqual([second.sentToday, second.dayMax, second.bouncesToday, second.resting, second.nextText], [3, 60, 3, true, "resting today (3 bounces)"]);
  assert.equal(second.replyCheck.couldOpen, false);
  const first = data.inboxes.find((inbox) => inbox.address === FIRST)!;
  assert.deepEqual([first.sentToday, first.resting, first.firstName], [1, false, "Aidan"]);

  const needs = needsYou(data, "Riley");
  assert.deepEqual(needs.cards.map((card) => [card.key, card.tone]), [
    ["paused:districts", "danger"], ["reply-check-inbox", "danger"], [`resting:${SECOND}`, "warning"],
  ]);
  assert.match(needs.cards[0]!.title, /School districts paused itself/);
  assert.match(needs.cards[1]!.title, /couldn't open Riley's inbox/);
  assert.match(needs.cards[2]!.detail!, /Nothing is paused/);
  assert.ok(needs.quiet.some((line) => /^Agencies is paused \(Aidan, /.test(line)), "a founder's own pause needs nothing from anyone");
});

test("Today: once anyone has been emailed, a reply check that hasn't finished for 2 hours is a card", async () => {
  const { raw, db, batch, person } = database();
  person(batch("cities-B1"), "Rue", { sent: sentMonday(FIRST) });
  assert.deepEqual(needsYou(await todayData(db, null, NOW), "Riley").cards.map((card) => card.key), ["reply-check-stale"], "never ran, and it is 10:30");
  raw.prepare(`INSERT INTO "KvStore" ("key","value","updatedAt") VALUES (?,?,?)`).run(OUTREACH_REPLY_STATE, JSON.stringify({ inboxes: {}, at: "2026-11-13T15:00:00.000Z", unread: [] }), NOW.toISOString());
  assert.deepEqual(needsYou(await todayData(db, null, NOW), "Riley").cards, []);
  // Outside its hours (it runs 7:00 to 21:00) an old check is not a problem.
  assert.deepEqual(needsYou(await todayData(db, null, new Date("2026-11-14T08:00:00Z")), "Riley").cards, []);
});

test("Today: with nothing to do it says so in one calm line, with when the next email goes", async () => {
  const { db, batch, person } = database();
  const sending = batch("cities-B1");
  person(sending, "Quince");
  const data = await todayData(db, null, NOW);
  const needs = needsYou(data, "Aidan");
  assert.deepEqual(needs.cards, []);
  // Friday 10:30, inside the send window, with someone waiting and nothing sent yet: emails are going out.
  assert.equal(needs.calm, "Nothing needs you. Emails are going out now.");
  // Friday evening: the next email goes Monday morning.
  const evening = await todayData(db, null, new Date("2026-11-13T23:00:00Z"));
  assert.equal(nextEmailText(evening), "Next email goes at 9:00 a.m. Mon.");
  assert.equal(needsYou(evening, "Riley").calm, "Nothing needs you. Next email goes at 9:00 a.m. Mon.");
});

test("an inbox's next send follows the sender's own rules: the gap, the morning half, bounces, and the campaign's hours", () => {
  const campaign = { key: "c", name: "C", state: "live", problem: null, dailyLimit: 60, sendDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], windowStart: 540, windowEnd: 870, startDay: null, endDay: null } as unknown as Campaign;
  const wanting = (overrides: Partial<{ due: boolean; sentFromInbox: number; sentAll: number; perDay: number; state: "live" | "paused" }> = {}) => [{
    campaign: { ...campaign, state: overrides.state ?? "live" } as Campaign, perDay: overrides.perDay ?? 30, sentFromInbox: overrides.sentFromInbox ?? 0, sentAll: overrides.sentAll ?? 0, due: overrides.due ?? true,
  }];
  const base = { enabled: true, dayMax: 60, sentToday: 0, bouncesToday: 0, lastSendAt: null, lastSendId: null };
  const text = (input: Parameters<typeof inboxNext>[0], now = NOW) => inboxNextText(inboxNext(input, now), TODAY);

  assert.equal(text({ ...base, wanting: wanting() }), "sending now");
  assert.equal(text({ ...base, enabled: false, wanting: wanting() }), "switched off");
  assert.equal(text({ ...base, bouncesToday: 3, wanting: wanting() }), "resting today (3 bounces)");
  assert.equal(text({ ...base, wanting: wanting({ due: false }) }), "nobody waiting");
  assert.equal(text({ ...base, wanting: wanting({ state: "paused" }) }), "its campaigns are paused");
  assert.equal(text({ ...base, wanting: [] }), "nobody waiting");
  // The morning half (30 of 60) is used at 10:30: the rest waits for 12:30, and only with 1 bounce or fewer.
  assert.equal(text({ ...base, sentToday: 30, wanting: wanting({ sentFromInbox: 10, sentAll: 30, perDay: 60 }) }), "next 12:30 p.m.");
  assert.equal(text({ ...base, sentToday: 30, bouncesToday: 2, wanting: wanting({ sentFromInbox: 10, sentAll: 30, perDay: 60 }) }), "no afternoon half today (2 bounces)");
  assert.equal(text({ ...base, sentToday: 60, wanting: wanting({ perDay: 60, sentFromInbox: 10 }) }), "done for today");
  // The campaign's own share of the inbox is used up: nothing more today, next on Monday at its opening time.
  assert.equal(text({ ...base, sentToday: 30, wanting: wanting({ sentFromInbox: 30, sentAll: 30 }) }), "next 9:00 a.m. Mon");
  // Before 9:00 on a send day, and on a Saturday.
  assert.equal(text({ ...base, wanting: wanting() }, new Date("2026-11-13T12:00:00Z")), "next 9:00 a.m.");
  assert.equal(text({ ...base, wanting: wanting() }, new Date("2026-11-14T15:00:00Z")), "next 9:00 a.m. Mon");
  // Just sent: the next one waits out the 1 to 3 minute gap.
  const gap = inboxNext({ ...base, sentToday: 1, lastSendAt: new Date(NOW.getTime() - 5_000).toISOString(), lastSendId: "send-1", wanting: wanting({ sentFromInbox: 1, sentAll: 1 }) }, NOW);
  assert.equal(gap.kind, "at");
  assert.ok(gap.kind === "at" && gap.minute >= 631 && gap.minute <= 634, "between 1 and 3 minutes after 10:30");

  assert.deepEqual(campaignNextWindow(campaign, new Date("2026-11-13T23:00:00Z")), { day: "2026-11-16", minute: 540, open: false });
  assert.equal(campaignNextWindow({ ...campaign, endDay: "2026-11-13" } as Campaign, new Date("2026-11-13T23:00:00Z")), null);
});

test("Replies: To answer is real replies nobody has answered; the filters, the campaign filter and FCC's read-only replies", async () => {
  const { raw, db, batch, person, reply } = database();
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","stoppedReason","createdAt","updatedAt") VALUES
    ('f1', ?, 'owner@telco.example', 'Sam', 'Made-up Telecom', '[]', 'named', 1, 'replied', 'They wrote back: "We already filed."', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'),
    ('f2', ?, 'office@cable.example', 'Lee', 'Made-up Cable', '[]', 'named', 1, 'replied', 'They sent an automatic reply, so no more emails', '2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')`)
    .run(FCC_CAMPAIGN_KEY, FCC_CAMPAIGN_KEY);
  const b = batch("cities-B1");
  const asked = person(b, "Rowan", { sent: sentMonday(SECOND) });
  const referred = person(b, "Sorrel", { sent: sentMonday(FIRST) });
  const askedId = reply(asked, "reply", "Could you send pricing?", SECOND, "2026-11-12T18:00:00.000Z");
  reply(referred, "reply", "Please write to our IT office.", SECOND, "2026-11-11T18:00:00.000Z", "it@sorrel.example");
  reply(person(b, "Tansy", { sent: sentMonday(FIRST) }), "automatic", "Out of office.", FIRST, "2026-11-10T18:00:00.000Z");
  reply(person(b, "Umber", { sent: sentMonday(FIRST) }), "no_thanks", "Not interested.", FIRST, "2026-11-10T19:00:00.000Z");
  // The sender's own check stopped this person as replied and recorded no message.
  const quiet = person(b, "Vetch", { status: "replied", sent: sentMonday(FIRST), due: null, stopped: "They wrote back Nov 12, so no more emails" });

  const toAnswer = await listReplies(db);
  assert.deepEqual(toAnswer.rows.map((row) => row.organisation), ["Rowan", "Sorrel", "Vetch"], "newest first; the one with no stored message is listed too");
  assert.deepEqual(toAnswer.counts, { "to-answer": 3, answered: 0, automatic: 1, "no-thanks": 1, all: 5 });
  const [first, second, third] = toAnswer.rows;
  assert.deepEqual([first!.person, first!.campaign, first!.answerFromName, first!.landedIn, first!.successLabel], ["Pat, City Clerk", "US cities: accessibility", "Riley", SECOND, "Price requests"]);
  assert.equal(first!.gmailUrl, gmailSearchUrl(SECOND, asked.email));
  assert.match(first!.gmailUrl!, /^https:\/\/mail\.google\.com\/mail\/\?authuser=second-inbox%40axiom\.example#search\/from%3Aclerk%40rowan\.example$/);
  // It landed in the second inbox, but the first inbox sent the email, so Aidan answers it; a colleague wrote.
  assert.deepEqual([second!.from, second!.email, second!.landedIn, second!.answerFrom, second!.answerFromName], ["it@sorrel.example", referred.email, SECOND, FIRST, "Aidan"]);
  assert.equal(third!.id, `contact:${quiet.id}`);
  assert.equal(third!.text, "They wrote back Nov 12, so no more emails");

  assert.deepEqual((await listReplies(db, { filter: "automatic" })).rows.map((row) => row.organisation), ["Tansy"]);
  assert.deepEqual((await listReplies(db, { filter: "no-thanks" })).rows.map((row) => row.kind), ["no_thanks"]);
  assert.equal((await listReplies(db, { filter: "all" })).rows.length, 5);
  assert.deepEqual((await listReplies(db, { filter: "all", since: "2026-11-12T00:00:00.000Z" })).rows.map((row) => row.organisation), ["Rowan"]);
  assert.equal((await listReplies(db, { filter: "all", campaign: "no-such" })).rows.length, 0);
  assert.equal(toAnswer.campaigns.find((row) => row.key === "us-cities")!.replies, 5);

  // FCC's replies only appear under its own filter, and can't be marked.
  assert.equal(toAnswer.fccReplies, 2);
  assert.ok(!toAnswer.rows.some((row) => row.source === "fcc"));
  const fcc = await listReplies(db, { filter: "all", campaign: FCC_FILTER });
  assert.deepEqual(fcc.rows.map((row) => [row.organisation, row.kind, row.canMark, row.campaign]), [["Made-up Cable", "automatic", false, "FCC (ended)"], ["Made-up Telecom", "reply", false, "FCC (ended)"]]);
  assert.deepEqual(await markReply(db, "fcc:owner@telco.example", { answered: true }, "Riley", NOW), { ok: false, why: "FCC ended on Nov 12, 2026. Its replies are kept to read and can't be marked." });
  assert.equal((await getReply(db, askedId))!.organisation, "Rowan");
  assert.equal(await getReply(db, "nope"), null);
});

test("the answered mark: a founder marks a reply answered or counted, it can be undone, and nothing about sending changes", async () => {
  const { raw, db, batch, person, reply } = database();
  const b = batch("cities-B1");
  const asked = person(b, "Rowan", { sent: sentMonday(SECOND) });
  const earlier = reply(asked, "reply", "Is this free?", SECOND, "2026-11-11T18:00:00.000Z");
  const later = reply(asked, "reply", "Could you send pricing?", SECOND, "2026-11-12T18:00:00.000Z");
  const auto = reply(person(b, "Tansy", { sent: sentMonday(FIRST) }), "automatic", "Out of office.", FIRST, "2026-11-10T18:00:00.000Z");
  const quiet = person(b, "Vetch", { status: "replied", sent: sentMonday(FIRST), due: null, stopped: "They wrote back, so no more emails" });
  const snapshot = () => JSON.stringify({
    contacts: raw.prepare(`SELECT "id","status","nextDueDay","stepsSent","stoppedReason" FROM "OutreachContact" ORDER BY "id"`).all(),
    batches: raw.prepare(`SELECT "id","status","approvedBy" FROM "OutreachBatch"`).all(),
    campaigns: raw.prepare(`SELECT "key","state" FROM "OutreachCampaign"`).all(),
    blocked: raw.prepare(`SELECT COUNT(*) AS n FROM "EngineEmailSuppression"`).get(),
    sends: raw.prepare(`SELECT COUNT(*) AS n FROM "OutreachSend"`).get(),
  });
  const before = snapshot();

  // Answering the latest reply covers that person's earlier one.
  const marked = await markReply(db, later, { answered: true }, "Riley", NOW);
  assert.ok(marked.ok);
  assert.deepEqual([marked.reply.answeredBy, marked.reply.answeredAt], ["Riley", NOW.toISOString()]);
  assert.equal((await getReply(db, earlier))!.answeredBy, "Riley");
  assert.equal((await listReplies(db)).counts["to-answer"], 1, "only the unrecorded one is left to answer");
  assert.equal((await listReplies(db, { filter: "answered" })).rows.length, 2);

  // It counts toward the campaign's success number, and both marks can be taken back.
  const counted = await markReply(db, later, { success: true }, "Aidan", NOW);
  assert.ok(counted.ok && counted.reply.success && counted.reply.successBy === "Aidan");
  assert.equal((await campaignDetail(db, "us-cities", null, NOW))!.success, 1);
  assert.equal(successLabelOf((await readCampaign(db, "us-cities"))!), "Price requests");
  const undone = await markReply(db, later, { answered: false, success: false }, "Aidan", NOW);
  assert.ok(undone.ok && undone.reply.answeredAt === null && !undone.reply.success);
  assert.equal((await getReply(db, earlier))!.answeredBy, "Riley", "undoing one leaves the other as it was");

  // Only a person's reply can be marked.
  assert.deepEqual(await markReply(db, auto, { answered: true }, "Riley", NOW), { ok: false, why: "Only a person's reply can be marked answered. Automatic replies and no-thanks need no answer." });
  assert.deepEqual(await markReply(db, "contact:nobody", { answered: true }, "Riley", NOW), { ok: false, why: "There's no such reply." });
  assert.deepEqual(await markReply(db, later, {}, "Riley", NOW), { ok: false, why: "Say what to mark: answered, or counts as a success." });

  // The reply with no stored message gets a row to hold its mark, already told, so the hourly check never emails about it.
  const stored = await markReply(db, `contact:${quiet.id}`, { answered: true }, "Aidan", NOW);
  assert.ok(stored.ok && stored.reply.id === `contact:${quiet.id}` && stored.reply.answeredBy === "Aidan");
  const row = raw.prepare(`SELECT "kind","toldFoundersAt","fromAddress" FROM "OutreachReply" WHERE "id" = ?`).get(`contact:${quiet.id}`) as { kind: string; toldFoundersAt: string | null; fromAddress: string };
  assert.deepEqual([row.kind, row.toldFoundersAt, row.fromAddress], ["reply", NOW.toISOString(), quiet.email]);
  assert.equal((await listReplies(db)).counts["to-answer"], 1, "the one un-answered again above");

  assert.equal(snapshot(), before, "no contact, batch, campaign, send or do-not-email row changed");
});

test("the do-not-email list: an address or a whole domain, why it is blocked, when, and in which campaign", async () => {
  const { raw, db, batch, person, reply } = database();
  const b = batch("cities-B1");
  const bounced = person(b, "Willow", { status: "bounced", sent: sentMonday(FIRST), due: null, stopped: "The email bounced" });
  raw.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason","createdAt") VALUES (?, 'BOUNCED', '2026-11-09T15:00:00.000Z'), ('@blocked.example', 'OWNER', '2026-11-01T00:00:00.000Z')`).run(bounced.email);
  const saidNo = person(b, "Yarrow", { sent: sentMonday(FIRST) });
  reply(saidNo, "no_thanks", "Please take us off your list.", FIRST, "2026-11-10T19:00:00.000Z", "manager@yarrow.example");
  raw.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason","createdAt") VALUES (?, 'UNSUBSCRIBED', '2026-11-10T19:00:00.000Z')`).run(saidNo.email);
  const replied = person(b, "Zinnia", { sent: sentMonday(FIRST) });
  reply(replied, "reply", "Tell me more.", FIRST, "2026-11-10T19:00:00.000Z");
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","stoppedReason","createdAt","updatedAt")
    VALUES ('f1', ?, 'gone@telco.example', 'Sam', 'Made-up Telecom', '[]', 'named', 1, 'bounced', 'The email bounced', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z')`).run(FCC_CAMPAIGN_KEY);

  const hit = await checkDoNotEmail(db, ` ${bounced.email.toUpperCase()} `);
  assert.deepEqual([hit.kind, hit.blocked, hit.summary], ["address", true, `${bounced.email} is blocked. No campaign will email it.`]);
  assert.deepEqual(hit.reasons.map((reason) => [reason.kind, reason.why, reason.campaign]), [["bounced", "An email to it bounced", "US cities: accessibility"]]);
  assert.equal(hit.blocked, await addressBlocked(db, bounced.email), "exactly the sender's own rule");

  const no = await checkDoNotEmail(db, saidNo.email);
  assert.equal(no.blocked, true);
  assert.deepEqual([no.reasons[0]!.kind, no.reasons[0]!.why, no.reasons[0]!.detail], ["no_thanks", "A colleague (manager@yarrow.example) said no thanks", "Please take us off your list."]);

  const fcc = await checkDoNotEmail(db, "gone@telco.example");
  assert.deepEqual([fcc.blocked, fcc.reasons[0]!.campaign], [true, "FCC (ended)"]);

  // Not blocked, but someone else there already answered, which holds new emails to that organisation.
  const colleague = await checkDoNotEmail(db, "it@zinnia.example");
  assert.equal(colleague.blocked, false);
  assert.deepEqual(colleague.organisation.map((row) => [row.email, row.status]), [[replied.email, "replied"]]);

  const whole = await checkDoNotEmail(db, "anyone@blocked.example");
  assert.deepEqual([whole.blocked, whole.reasons.map((reason) => reason.address)], [true, ["@blocked.example"]]);
  assert.deepEqual([(await checkDoNotEmail(db, "blocked.example")).blocked, (await checkDoNotEmail(db, "@blocked.example")).kind], [true, "domain"]);
  const domain = await checkDoNotEmail(db, "willow.example");
  assert.deepEqual([domain.blocked, domain.summary], [false, "willow.example is not blocked as a whole, but 1 address at it is."]);
  assert.equal((await checkDoNotEmail(db, "fresh.example")).summary, "Nothing at fresh.example is blocked.");
  assert.equal((await checkDoNotEmail(db, "not an address")).kind, "unreadable");
  assert.deepEqual([readQuery("mailto:A@B.example"), readQuery("x"), readQuery("")], [{ kind: "address", value: "a@b.example" }, null, null]);

  const recent = await recentBlocks(db, 10);
  assert.deepEqual([recent.total, recent.bounced, recent.noThanks, recent.rows[0]!.address], [3, 1, 1, saidNo.email]);
});

test("finding a person: where they stand in every campaign, by address or organisation", async () => {
  const { db, batch, person, reply } = database();
  const b = batch("cities-B1");
  const waiting = batch("cities-IT1 A", { status: "waiting" });
  person(b, "Amber Falls", { sent: sentMonday(FIRST) });
  person(waiting, "Amber Ridge");
  person(b, "Basalt", { status: "held", hold: "verified is no" });
  reply(person(b, "Cobalt", { sent: sentMonday(FIRST) }), "reply", "Yes.", FIRST, "2026-11-10T19:00:00.000Z");

  const amber = await findContacts(db, "AMBER");
  assert.deepEqual(amber.map((hit) => [hit.organisation, hit.statusText, hit.emailsSent]).sort(), [
    ["Amber Falls", "Emailed, follow-up due Fri, Nov 20", 1], ["Amber Ridge", "Waiting for its batch to be approved", 0],
  ]);
  assert.deepEqual((await findContacts(db, "clerk@basalt.example")).map((hit) => [hit.status, hit.reason, hit.batch]), [["held", "verified is no", "cities-B1"]]);
  assert.deepEqual((await findContacts(db, "cobalt")).map((hit) => [hit.statusText, hit.replies]), [["Replied: no more emails", 1]]);
  assert.deepEqual(await findContacts(db, "amber", { campaign: "no-such" }), []);
  assert.deepEqual(await findContacts(db, "a"), [], "one letter is not a search");
  assert.deepEqual(await findContacts(db, "100%"), [], "a wildcard is read as text");
  assert.equal(contactStatusText({ status: "sent", stepsSent: 1, nextDueDay: null, batchStatus: "approved" }), "Emailed, follow-up on hold");
  assert.equal(organisationOf({ company: " Made-up Studio " }, "a@b.example"), "Made-up Studio");
  assert.equal(organisationOf({}, "a@b.example"), "b.example");
  assert.equal(personOf({ first_name: "Pat", last_name: "Lee", title: "Clerk" }), "Pat Lee, Clerk");
});

test("a campaign's batches: waiting first, then sending, then done; held reasons, results and follow-ups on hold", async () => {
  const { raw, db, batch, person, reply } = database();
  const done = batch("cities-A1");
  const sending = batch("cities-B1");
  const waiting = batch("cities-IT1 A", { status: "waiting" });
  const changed = batch("old-batch", { approvedWords: "w0" });
  const stopped = batch("stopped-batch", { status: "stopped" });
  raw.prepare(`UPDATE "OutreachContact" SET "status" = 'done' WHERE 0`).run();
  person(done, "Dune", { status: "done", sent: sentMonday(FIRST), due: null });
  const answered = person(done, "Ember", { sent: sentMonday(FIRST) });
  const replyId = reply(answered, "reply", "Send pricing.", FIRST, "2026-11-10T19:00:00.000Z");
  await markReply(db, replyId, { success: true }, "Riley", NOW);
  person(sending, "Flint");
  person(sending, "Gale", { sent: sentMonday(FIRST), due: "2026-11-16" });
  person(sending, "Heath", { sent: sentMonday(FIRST), due: null }); // follow-up taken off the schedule
  person(waiting, "Isle");
  person(waiting, "Jade", { status: "held", hold: "verified is no" });
  person(waiting, "Kelp", { status: "held", hold: "verified is no" });
  person(waiting, "Lime", { status: "held", hold: "its domain has no mail server" });
  person(changed, "Moss");
  person(stopped, "Nook");

  const detail = (await campaignDetail(db, "us-cities", null, NOW))!;
  const byName = new Map(detail.batches.map((row) => [row.name, row]));
  assert.deepEqual([...byName].map(([name, row]) => [name, row.phase]).sort(), [
    ["cities-A1", "done"], ["cities-B1", "sending"], ["cities-IT1 A", "waiting"], ["old-batch", "waiting"], ["stopped-batch", "stopped"],
  ]);
  assert.deepEqual(byName.get("cities-IT1 A")!.heldReasons, [{ reason: "verified is no", rows: 2 }, { reason: "its domain has no mail server", rows: 1 }]);
  assert.deepEqual([byName.get("cities-A1")!.replies, byName.get("cities-A1")!.success, byName.get("cities-B1")!.followUpsLeft], [1, 1, 2]);
  assert.deepEqual(detail.followUps, { coming: [{ day: "2026-11-16", people: 1 }], onHold: 1 });
  assert.equal(detail.success, 1);

  assert.equal(batchPhase({ status: "approved", wordsCurrent: true, ready: 0 }, 0), "done");
  assert.equal(batchPhase({ status: "approved", wordsCurrent: true, ready: 0 }, 3), "sending");
  assert.equal(batchPhase({ status: "approved", wordsCurrent: false, ready: 0 }, 0), "done");
  assert.equal(batchPhase({ status: "waiting", wordsCurrent: false, ready: 0 }, 0), "waiting");
});
