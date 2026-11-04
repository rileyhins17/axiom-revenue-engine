import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION } from "@/lib/fcc-campaign";
import { readFccNotes } from "@/lib/fcc-campaign-control";
import { fccMailboxFromImap, type FccSendConfig } from "@/lib/fcc-campaign-sender";
import { fccBouncesToday, runFccSendTick } from "@/lib/fcc-campaign-tick";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { openImap } from "@/lib/revenue-engine/imap-client";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";
import { deliveryReport, fakeServer, gmailHolding, type HeldMessage } from "@/lib/revenue-engine/test-support/fake-gmail";

/**
 * The real send tick and the real inbox check against a fake Gmail that holds made-up failure notices: the whole
 * path from "a notice from some other mail provider is in the inbox" to "the contact is bounced, the address is
 * on the do-not-email list and the day's pause rules have counted it". No email is sent and nothing is real.
 */

// Wed Nov 4, 2026 is in winter time: 10:05 Toronto is 15:05 UTC.
const WED_10_05 = new Date("2026-11-04T15:05:00Z");
const WED_12_35 = new Date("2026-11-04T17:35:00Z");
const ADDRESS = "257 Example St, Kitchener, ON N2C 0A0, Canada";
const SENT_BEFORE = "2026-11-02";
const SENT_TODAY = "2026-11-04";
const idOf = (contact: string) => `fcc-v8-${contact}-1@mail.example`;

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

/** A contact whose first email went out on `sendDay` (a Toronto day) from the first inbox. */
function sentContact(raw: Database.Database, id: string, email: string, sendDay: string) {
  const at = `${sendDay}T15:00:30.000Z`;
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","step1SentAt","step1MessageId","step2DueAt","createdAt","updatedAt")
    VALUES (?,?,?,?,?,?,?,1,'step1_sent',?,?,NULL,?,?)`).run(id, FCC_CAMPAIGN_KEY, email, "Jane", `Co ${id}`, "[]", "named", at, `<${idOf(id)}>`, at, at);
  raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status","createdAt","finishedAt","senderAddress")
    VALUES (?,?,1,?,?,?,'SENT',?,?,NULL)`).run(`send-${id}`, id, email, sendDay, `<${idOf(id)}>`, at, at);
}

function harness(messages: HeldMessage[]) {
  const logins: string[][] = [];
  const config: FccSendConfig = {
    fromAddress: "aidan@mail.example", mailingAddress: ADDRESS, newId: () => "unused",
    mailbox: async () => {
      const server = fakeServer(gmailHolding(messages));
      logins.push(server.lines);
      return fccMailboxFromImap(await openImap(server.stream, { username: "aidan@mail.example", password: "pw" }));
    },
    transport: async () => ({ async send() { throw new Error("this test must never send an email"); }, async close() {} }),
  };
  return { config, logins, tick: (db: ProspectDb, now: Date) => runFccSendTick(db, config, now, { wait: async () => {}, random: () => 0.5 }) };
}

const statusOf = (raw: Database.Database, id: string) => (raw.prepare(`SELECT "status" FROM "FccCampaignContact" WHERE "id" = ?`).get(id) as { status: string }).status;
const suppressed = (raw: Database.Database) =>
  (raw.prepare(`SELECT "email" FROM "EngineEmailSuppression" WHERE "reason" = 'BOUNCED' ORDER BY "email"`).all() as Array<{ email: string }>).map((row) => row.email);
const enabled = (raw: Database.Database) => (raw.prepare(`SELECT "enabled" FROM "FccCampaignSetting"`).get() as { enabled: number }).enabled;

const gmailSender = "Mail Delivery Subsystem <mailer-daemon@googlemail.com>";
const relayBounce = (contact: string, alias: string) => deliveryReport({
  from: "Mail Administrator <admin@mx.relay.example>", subject: "Message could not be sent", explanation: "Your message could not be passed on.",
  recipient: alias, action: "failed", status: "5.1.1", diagnostic: "550 5.1.1 No such mailbox", originalId: idOf(contact), originalTo: alias,
});
const microsoftBounce = (contact: string, address: string) => deliveryReport({
  from: "Microsoft Outlook <postmaster@zeta.onmicrosoft.example>", subject: `Undeliverable: Question about ${address}`,
  explanation: `Delivery has failed to these recipients or groups: ${address}. The email address you entered couldn't be found.`, html: true,
  recipient: address, action: "failed", status: "5.1.10", diagnostic: "550 5.1.10 RESOLVER.ADR.RecipientNotFound", originalId: idOf(contact),
});
const purelymailBounce = (contact: string, address: string) => deliveryReport({
  from: "noreply@purelymail.com", subject: "Your message was not accepted", explanation: `Delivery to ${address} failed permanently.`,
  recipient: address, action: "failed", status: "5.1.1", diagnostic: "550 5.1.1 The mailbox does not exist.", originalId: idOf(contact),
});

test("the morning sweep marks and suppresses contacts whose bounce came from any mail provider, and leaves delays and automatic replies alone", async () => {
  const { raw, db } = database();
  sentContact(raw, "c1", "jay@onechoice.example", SENT_BEFORE);
  sentContact(raw, "c2", "kim@zeta.example", SENT_BEFORE);
  sentContact(raw, "c3", "seth@retrying.example", SENT_BEFORE);
  sentContact(raw, "c4", "pat@bluepeak.example", SENT_BEFORE);
  sentContact(raw, "c5", "dan@quiet.example", SENT_BEFORE);
  const h = harness([
    relayBounce("c1", "front-desk@alias-host.example"),
    microsoftBounce("c2", "kim@zeta.example"),
    deliveryReport({ from: gmailSender, subject: "Mail delivery status", explanation: "Still trying.", recipient: "seth@retrying.example", action: "delayed", status: "4.4.1", diagnostic: "451 4.4.1 timeout", originalId: idOf("c3") }),
    { from: "postmaster@bluepeak.example", subject: "Auto: Out of office", body: "Your message to pat@bluepeak.example is not delivered to my inbox until Monday." },
  ]);

  const result = await h.tick(db, WED_10_05);

  assert.notEqual(result.status, "PAUSED");
  assert.deepEqual(["c1", "c2", "c3", "c4", "c5"].map((id) => statusOf(raw, id)), ["bounced", "bounced", "step1_sent", "step1_sent", "step1_sent"]);
  assert.deepEqual(suppressed(raw), ["jay@onechoice.example", "kim@zeta.example"], "the address we sent to is suppressed, not the alias the server named");
  const stopped = raw.prepare(`SELECT "stoppedReason" FROM "FccCampaignContact" WHERE "id" = 'c1'`).get() as { stoppedReason: string };
  assert.equal(stopped.stoppedReason, "The email bounced");
  assert.equal(await fccBouncesToday(db, "2026-11-04"), 0, "the sends were on Nov 2: they never count toward Nov 4's pause rules");
  assert.equal(enabled(raw), 1);
});

test("bounces of today's emails from other providers count toward the three-a-day pause", async () => {
  const { raw, db } = database();
  sentContact(raw, "c1", "jay@onechoice.example", SENT_TODAY);
  sentContact(raw, "c2", "kim@zeta.example", SENT_TODAY);
  sentContact(raw, "c3", "lee@fine.example", SENT_TODAY);
  const h = harness([relayBounce("c1", "front-desk@alias-host.example"), microsoftBounce("c2", "kim@zeta.example"), purelymailBounce("c3", "lee@fine.example")]);

  const result = await h.tick(db, WED_10_05);

  assert.equal(result.status, "PAUSED");
  assert.match(result.status === "PAUSED" ? result.reason : "", /3 emails bounced today/);
  assert.equal(enabled(raw), 0);
  assert.equal(await fccBouncesToday(db, "2026-11-04"), 3);
  assert.equal((await readFccNotes(db)).control?.action, "paused");
});

test("two bounces of today's emails from other providers stop the second batch without pausing", async () => {
  const { raw, db } = database();
  sentContact(raw, "c1", "jay@onechoice.example", SENT_TODAY);
  sentContact(raw, "c2", "kim@zeta.example", SENT_TODAY);
  sentContact(raw, "c3", "lee@fine.example", SENT_TODAY);
  const h = harness([relayBounce("c1", "front-desk@alias-host.example"), purelymailBounce("c2", "kim@zeta.example")]);

  const result = await h.tick(db, WED_12_35);

  assert.deepEqual(result, { status: "SKIPPED", reason: "no second batch: too many bounces" });
  assert.equal(enabled(raw), 1);
  assert.equal(statusOf(raw, "c3"), "step1_sent");
  assert.match((await readFccNotes(db)).lastRun?.note ?? "", /No second batch today: 2 emails bounced/);
});

test("a delay notice and an automatic reply today do not count toward any rule", async () => {
  const { raw, db } = database();
  sentContact(raw, "c1", "seth@retrying.example", SENT_TODAY);
  sentContact(raw, "c2", "pat@bluepeak.example", SENT_TODAY);
  sentContact(raw, "c3", "lee@fine.example", SENT_TODAY);
  const h = harness([
    deliveryReport({ from: gmailSender, subject: "Mail delivery status", explanation: "Still trying.", recipient: "seth@retrying.example", action: "delayed", status: "4.4.1", diagnostic: "451 4.4.1 timeout", originalId: idOf("c1") }),
    { from: "Pat <noreply@bluepeak.example>", subject: "Automatic reply: Question", body: "Out of office. Your message to pat@bluepeak.example was received." },
    { from: "Mail Delivery System <Mailer-Daemon@mx.exim.example>", subject: "Warning: could not send message for past 4 hours", body: "Not yet delivered to lee@fine.example. Delivery will continue to be attempted." },
  ]);

  const result = await h.tick(db, WED_12_35);

  assert.notEqual(result.status, "PAUSED");
  assert.equal(await fccBouncesToday(db, "2026-11-04"), 0);
  assert.deepEqual(["c1", "c2", "c3"].map((id) => statusOf(raw, id)), ["step1_sent", "step1_sent", "step1_sent"]);
  assert.deepEqual(suppressed(raw), []);
  assert.equal(h.logins.length, 1, "one inbox login, and the notices were read once");
  assert.equal(h.logins[0]!.filter((line) => line.includes("UID FETCH")).length, 1);
});
