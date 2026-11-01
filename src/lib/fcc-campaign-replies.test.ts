import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { readFccReplyCheck } from "@/lib/fcc-campaign-control";
import {
  isAutomaticReply, replyQuote, runFccReplyCheck, senderAddress,
  type FccInboxMessage, type FccOwnerMail, type FccReplyCheckConfig,
} from "@/lib/fcc-campaign-replies";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

// Mon Nov 2, 2026 is in standard time: 9:00 Toronto is 14:00 UTC.
const MON_9AM = Date.parse("2026-11-02T14:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SENT_WED = "2026-10-28T14:05:00.000Z";

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

function addContact(raw: Database.Database, id: string, email: string, company: string, status = "step1_sent", key = FCC_CAMPAIGN_KEY) {
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","step1SentAt","createdAt","updatedAt")
    VALUES (?,?,?,?,?,'[]','named',1,?,?,?,?)`).run(id, key, email, "Jane", company, status, SENT_WED, "2026-10-26T23:00:00.000Z", SENT_WED);
}

const contact = (raw: Database.Database, id: string) =>
  raw.prepare(`SELECT "status","stoppedReason" FROM "FccCampaignContact" WHERE "id" = ?`).get(id) as { status: string; stoppedReason: string | null };

function fakeInbox(messages: FccInboxMessage[], quotes: Record<number, string>, onOpen: () => void, error?: Error) {
  return async () => {
    if (error) throw error;
    onOpen();
    return {
      async messagesSince(sinceIso: string) { return messages.filter((message) => !message.date || message.date.slice(0, 10) >= new Date(Date.parse(sinceIso) - DAY).toISOString().slice(0, 10)); },
      async replyText(message: FccInboxMessage) { return quotes[message.uid] ?? ""; },
      async close() {},
    };
  };
}

function harness(inboxMessages: FccInboxMessage[], quotes: Record<number, string> = {}, options: { failMail?: number; inboxError?: Error } = {}) {
  const mails: FccOwnerMail[] = [];
  let failures = options.failMail ?? 0;
  let logins = 0;
  const config: FccReplyCheckConfig = {
    screenUrl: "https://ops.example/fcc",
    inboxes: [{ address: "aidan@gmail.example", open: fakeInbox(inboxMessages, quotes, () => { logins += 1; }, options.inboxError) }],
    async tellFounders(mail) {
      if (failures > 0) { failures -= 1; throw new Error("mail down"); }
      mails.push(mail);
    },
  };
  return { config, mails, logins: () => logins };
}

const message = (uid: number, from: string, date: string, automatic = false): FccInboxMessage => ({ folder: "[Gmail]/All Mail", uid, from, date, automatic });

test("a reply stops that person's emails and both founders hear about it once, with what they said", async () => {
  const { raw, db } = database();
  addContact(raw, "c1", "jane@talktone.example", "Talktone");
  addContact(raw, "c2", "bob@quietco.example", "Quiet Co");
  const h = harness([message(7, "jane@talktone.example", "2026-10-30T15:00:00.000Z")], { 7: "Yes, please call me at 555-0100." });

  const first = await runFccReplyCheck(db, h.config, new Date(MON_9AM));
  assert.deepEqual(first, { status: "RAN", since: SENT_WED, messages: 1, found: 1, unreadInboxes: [] });
  assert.equal(contact(raw, "c1").status, "replied");
  assert.match(contact(raw, "c1").stoppedReason!, /^They wrote back Oct 30, so no more emails: "Yes, please call me at 555-0100\."$/);
  assert.equal(contact(raw, "c2").status, "step1_sent");
  assert.equal(h.mails.length, 1);
  assert.equal(h.mails[0]!.subject, "FCC: 1 new reply");
  assert.match(h.mails[0]!.text, /1\. Talktone \(jane@talktone\.example\), Oct 30 · came to aidan@gmail\.example\n {3}"Yes, please call me at 555-0100\."/);
  assert.match(h.mails[0]!.text, /Answer each one from the inbox it came to/);

  assert.deepEqual(await runFccReplyCheck(db, h.config, new Date(MON_9AM + 15 * 60_000)), { status: "SKIPPED", reason: "already checked today" });
  const nextDay = await runFccReplyCheck(db, h.config, new Date(MON_9AM + DAY));
  assert.equal(nextDay.status === "RAN" && nextDay.found, 0);
  assert.equal(h.mails.length, 1, "nobody is reported twice");
});

test("a reply to the November 6 email is reported once and stops every row that person has", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "jane@talktone.example", "Talktone");
  addContact(raw, "h1", "jane@talktone.example", "Talktone", "step1_sent", FCC_NOV6_CAMPAIGN_KEY);
  addContact(raw, "h2", "pat@hotonly.example", "Hot Only", "step1_sent", FCC_NOV6_CAMPAIGN_KEY);
  const h = harness([message(7, "jane@talktone.example", "2026-10-30T15:00:00.000Z"), message(8, "pat@hotonly.example", "2026-10-30T16:00:00.000Z")]);

  const result = await runFccReplyCheck(db, h.config, new Date(MON_9AM));
  assert.ok(result.status === "RAN" && result.found === 2);
  assert.deepEqual(["m1", "h1", "h2"].map((id) => contact(raw, id).status), ["replied", "replied", "replied"]);
  assert.equal(h.mails.length, 1);
  assert.equal(h.mails[0]!.subject, "FCC: 2 new replies");
});

test("a colleague's reply counts, but a stranger on a shared mail service does not", async () => {
  const { raw, db } = database();
  addContact(raw, "c1", "owner@acme.example", "Acme Wireless");
  addContact(raw, "c2", "someone@gmail.com", "Gmail Telecom");
  const h = harness([
    message(1, "sales@acme.example", "2026-10-29T15:00:00.000Z"),
    message(2, "stranger@gmail.com", "2026-10-29T16:00:00.000Z"),
  ]);
  await runFccReplyCheck(db, h.config, new Date(MON_9AM));
  assert.equal(contact(raw, "c1").status, "replied");
  assert.match(contact(raw, "c1").stoppedReason!, /^A colleague \(sales@acme\.example\) wrote back Oct 29/);
  assert.equal(contact(raw, "c2").status, "step1_sent");
  assert.match(h.mails[0]!.text, /Open the email in Gmail to read it/);
});

test("mail from before someone was emailed is not their reply; an automatic reply is labelled", async () => {
  const { raw, db } = database();
  addContact(raw, "c1", "old@friend.example", "Old Friend");
  addContact(raw, "c2", "away@ooo.example", "Away Co");
  const h = harness([
    message(1, "old@friend.example", "2026-10-20T15:00:00.000Z"),
    message(2, "away@ooo.example", "2026-10-28T15:00:00.000Z", true),
  ], { 2: "I'm out of the office until Nov 4." });
  await runFccReplyCheck(db, h.config, new Date(MON_9AM));
  assert.equal(contact(raw, "c1").status, "step1_sent");
  assert.equal(contact(raw, "c2").status, "replied");
  assert.match(contact(raw, "c2").stoppedReason!, /^They sent an automatic reply Oct 28/);
  assert.match(h.mails[0]!.text, /Away Co \(away@ooo\.example\), Oct 28 \(automatic reply\)/);
});

test("nothing before 9:00 Toronto, one try an hour, and a failed founders' email is retried with the same replies", async () => {
  const { raw, db } = database();
  addContact(raw, "c1", "jane@talktone.example", "Talktone");
  const h = harness([message(7, "jane@talktone.example", "2026-10-30T15:00:00.000Z")], { 7: "Interested." }, { failMail: 1 });

  assert.deepEqual(await runFccReplyCheck(db, h.config, new Date(MON_9AM - 60_000)), { status: "SKIPPED", reason: "before 9:00" });
  await assert.rejects(runFccReplyCheck(db, h.config, new Date(MON_9AM)), /mail down/);
  assert.equal(contact(raw, "c1").status, "step1_sent", "nothing is marked until the founders have been told");
  assert.equal(await readFccReplyCheck(db), null);
  assert.deepEqual(await runFccReplyCheck(db, h.config, new Date(MON_9AM + 30 * 60_000)), { status: "SKIPPED", reason: "already tried this hour" });

  const retry = await runFccReplyCheck(db, h.config, new Date(MON_9AM + HOUR));
  assert.equal(retry.status === "RAN" && retry.found, 1);
  assert.equal(h.mails.length, 1);
  assert.equal(contact(raw, "c1").status, "replied");
  assert.equal(h.logins(), 2);
});

test("a reply the follow-up check found after the morning run is in the next morning's email", async () => {
  const { raw, db } = database();
  addContact(raw, "c1", "jane@talktone.example", "Talktone");
  const inbox: FccInboxMessage[] = [];
  const h = harness(inbox, { 9: "Send me the price." });
  await runFccReplyCheck(db, h.config, new Date(MON_9AM));
  assert.equal(h.mails.length, 0);

  // 9:40 she writes; at 10:05 the follow-up check sees it and stops her follow-up.
  inbox.push(message(9, "jane@talktone.example", new Date(MON_9AM + 40 * 60_000).toISOString()));
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'replied', "stoppedReason" = 'They wrote back, so no follow-up', "updatedAt" = ? WHERE "id" = 'c1'`)
    .run(new Date(MON_9AM + 65 * 60_000).toISOString());

  const tuesday = await runFccReplyCheck(db, h.config, new Date(MON_9AM + DAY));
  assert.equal(tuesday.status === "RAN" && tuesday.found, 1);
  assert.match(h.mails[0]!.text, /Talktone .*\n {3}"Send me the price\."/);
  assert.equal(contact(raw, "c1").stoppedReason, "They wrote back, so no follow-up", "the follow-up check's note is kept");
});

test("new mail from someone a founder stopped is reported, without changing why they were stopped", async () => {
  const { raw, db } = database();
  addContact(raw, "c1", "early@stopped.example", "Stopped Early");
  addContact(raw, "c2", "later@stopped.example", "Stopped Later");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'suppressed', "stoppedReason" = 'Do not contact (Aidan)', "updatedAt" = '2026-10-29T12:00:00.000Z'`).run();
  const h = harness([
    message(1, "early@stopped.example", "2026-10-28T20:00:00.000Z"),
    message(2, "later@stopped.example", "2026-10-30T20:00:00.000Z"),
  ], { 2: "We already filed in January." });
  const result = await runFccReplyCheck(db, h.config, new Date(MON_9AM));
  assert.equal(result.status === "RAN" && result.found, 1, "the reply from before they were stopped is old news");
  assert.match(h.mails[0]!.text, /Stopped Later \(later@stopped\.example\), Oct 30 \(we had already stopped emailing them\).*\n {3}"We already filed in January\."/);
  assert.equal(contact(raw, "c2").status, "suppressed");
  assert.equal(contact(raw, "c2").stoppedReason, "Do not contact (Aidan)");
  const nextDay = await runFccReplyCheck(db, h.config, new Date(MON_9AM + DAY));
  assert.equal(nextDay.status === "RAN" && nextDay.found, 0, "and it is reported once");
});

test("no inbox, no check; an inbox that won't open is tried again next hour", async () => {
  const { raw, db } = database();
  addContact(raw, "c1", "jane@talktone.example", "Talktone");
  const off = harness([]);
  assert.deepEqual(await runFccReplyCheck(db, { ...off.config, inboxes: [] }, new Date(MON_9AM)), { status: "SKIPPED", reason: "inbox not configured" });
  const broken = harness([], {}, { inboxError: new Error("IMAP NO login refused") });
  await assert.rejects(runFccReplyCheck(db, broken.config, new Date(MON_9AM)), /login refused/);
  const fixed = harness([]);
  assert.equal((await runFccReplyCheck(db, fixed.config, new Date(MON_9AM + HOUR))).status, "RAN");
});

test("both inboxes are read; one that won't open is read from where it left off the next day", async () => {
  const { raw, db } = database();
  addContact(raw, "c1", "jane@talktone.example", "Talktone");
  addContact(raw, "c2", "max@acme.example", "Acme Wireless");
  raw.prepare(`UPDATE "FccCampaignContact" SET "senderAddress" = 'riley@gmail.example' WHERE "id" = 'c2'`).run();
  const mails: FccOwnerMail[] = [];
  let rileyDown = true;
  const rileyMessages = [message(4, "max@acme.example", "2026-11-01T18:00:00.000Z")];
  const config: FccReplyCheckConfig = {
    screenUrl: "https://ops.example/fcc",
    inboxes: [
      { address: "aidan@gmail.example", open: fakeInbox([message(3, "jane@talktone.example", "2026-10-30T15:00:00.000Z")], { 3: "Call me." }, () => {}) },
      { address: "riley@gmail.example", open: async () => { if (rileyDown) throw new Error("IMAP NO login refused"); return fakeInbox(rileyMessages, { 4: "How much?" }, () => {})(); } },
    ],
    async tellFounders(mail) { mails.push(mail); },
  };
  const monday = await runFccReplyCheck(db, config, new Date(MON_9AM));
  assert.equal(monday.status === "RAN" && monday.found, 1);
  assert.deepEqual(monday.status === "RAN" && monday.unreadInboxes, ["riley@gmail.example"]);
  assert.match(mails[0]!.text, /Talktone .* came to aidan@gmail\.example/);
  assert.equal(contact(raw, "c2").status, "step1_sent");

  rileyDown = false;
  const tuesday = await runFccReplyCheck(db, config, new Date(MON_9AM + DAY));
  assert.equal(tuesday.status === "RAN" && tuesday.found, 1, "Sunday's reply in Riley's inbox is still found on Tuesday");
  assert.match(mails[1]!.text, /Acme Wireless \(max@acme\.example\), Nov 1 · came to riley@gmail\.example\n {3}"How much\?"/);
  assert.equal(contact(raw, "c2").status, "replied");
});

test("the quote is what they wrote, not our email under it", () => {
  const gmail = [
    "--000000000000abc",
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Hi Aidan,",
    "",
    "Yes we missed it. Can you handle the filing for us? Call me =E2=80=93 any time=",
    " after 2.",
    "",
    "On Wed, Oct 28, 2026 at 10:02 AM Aidan Magee <aidan@gmail.example>",
    "wrote:",
    "",
    "> Hi Jane, your company's FCC filing...",
    "",
    "--000000000000abc",
    "Content-Type: text/html; charset=\"UTF-8\"",
    "",
    "<div>Hi Aidan</div>",
    "--000000000000abc--",
  ].join("\r\n");
  assert.equal(replyQuote("Content-Type: multipart/alternative; boundary=\"000000000000abc\"", gmail),
    "Hi Aidan, Yes we missed it. Can you handle the filing for us? Call me – any time after 2.");

  const base64 = btoa("Not interested, please remove us.\r\n\r\n-----Original Message-----\r\nFrom: Aidan");
  assert.equal(replyQuote("Content-Type: text/plain\r\nContent-Transfer-Encoding: base64", base64), "Not interested, please remove us.");
  assert.equal(replyQuote("Content-Type: text/html", "<p>Sounds good &amp; thanks</p><div class=\"gmail_quote\">On Thu, Oct 29 wrote: old</div>"), "Sounds good & thanks");
  assert.equal(replyQuote("", "x".repeat(400)).length, 240);
});

test("reads the sender and spots automatic replies", () => {
  assert.equal(senderAddress("\"Jane Doe\" <Jane@Talktone.example>"), "jane@talktone.example");
  assert.equal(senderAddress("jane@talktone.example"), "jane@talktone.example");
  assert.equal(isAutomaticReply("Subject: Automatic reply: FCC filing"), true);
  assert.equal(isAutomaticReply("Auto-Submitted: auto-replied\r\nSubject: Re: FCC"), true);
  assert.equal(isAutomaticReply("Auto-Submitted: no\r\nSubject: Re: FCC filing"), false);
});
