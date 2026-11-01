import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION, FCC_NOV6_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { runFccDailySend, type FccMailbox, type FccSendConfig } from "@/lib/fcc-campaign-sender";
import { PermanentEmailError, type OutgoingEmail } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

const MONDAY = new Date("2026-10-26T14:00:00Z");
const TUESDAY = new Date("2026-10-27T14:00:00Z");
const THURSDAY = new Date("2026-10-29T14:00:00Z");
const SATURDAY = new Date("2026-10-31T14:00:00Z");
const ADDRESS = "257 Example St, Kitchener, ON N2C 0A0, Canada";

function database() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
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

let created = 0;
function addContact(raw: Database.Database, id: string, email: string, options: { company?: string; kind?: string; sendable?: boolean } = {}) {
  const sendable = options.sendable ?? true;
  const at = new Date(Date.UTC(2026, 9, 24, 20, 0, 0) + created++ * 1000).toISOString();
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","contactName","title","phone","company","filingsJson","emailKind","sendable","holdReason","status","createdAt","updatedAt")
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, FCC_CAMPAIGN_KEY, email, "Jane", "Jane Doe", "Manager", "555", options.company ?? `${id} Telephone Co`,
    JSON.stringify([{ company: options.company ?? `${id} Telephone Co`, rmdNumber: `RMD-${id}`, state: "IA", lastFilingDate: "2024-03-29", filingUrl: "https://example.test" }]),
    options.kind ?? "named", sendable ? 1 : 0, sendable ? null : "Generic inbox", sendable ? "ready" : "held", at, at,
  );
}

/** A November 6 hot-list contact, as the importer writes it (listing line and short name in filingsJson). */
function addNov6Contact(raw: Database.Database, id: string, email: string, options: { sendable?: boolean } = {}) {
  const sendable = options.sendable ?? true;
  const at = new Date(Date.UTC(2026, 9, 24, 20, 0, 0) + created++ * 1000).toISOString();
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","contactName","title","phone","company","filingsJson","emailKind","sendable","holdReason","status","createdAt","updatedAt")
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, FCC_NOV6_CAMPAIGN_KEY, email, "Jane", "Jane Doe", "Owner", "", `${id} Telephone Co`,
    JSON.stringify([{ company: `${id} Telephone Co`, rmdNumber: `RMD-${id}`, state: "", lastFilingDate: "2024-04-15", filingUrl: "https://example.test",
      companyShort: `${id} Telephone`, listingLine: `${id} Telephone's public listing (RMD-${id}) still shows no 2026 recertification.` }]),
    "named", sendable ? 1 : 0, sendable ? null : "Generic inbox", sendable ? "ready" : "held", at, at,
  );
}

const recordGo = (raw: Database.Database, copy = FCC_COPY_VERSION) =>
  raw.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 1, "approvedCopy" = ?, "goBy" = 'Aidan', "goAt" = '2026-10-25T20:00:00Z' WHERE "id" = 1`).run(copy);

const statusOf = (raw: Database.Database, id: string) =>
  (raw.prepare(`SELECT "status" FROM "FccCampaignContact" WHERE "id" = ?`).get(id) as { status: string }).status;

function fakeTransport(fail?: (message: OutgoingEmail) => Error | null) {
  const sent: OutgoingEmail[] = [];
  let opened = 0;
  return {
    sent,
    opened: () => opened,
    factory: async () => {
      opened += 1;
      return { async send(message: OutgoingEmail) { const error = fail?.(message); if (error) throw error; sent.push(message); }, async close() {} };
    },
  };
}

function fakeMailbox(state: { from?: string[]; bounced?: string[]; broken?: boolean } = {}) {
  const searches: string[][] = [];
  const factory = async (): Promise<FccMailbox> => {
    if (state.broken) throw new Error("IMAP NO [AUTHENTICATIONFAILED] Invalid credentials");
    return {
      async hasMessagesFrom(patterns) {
        searches.push(patterns);
        return patterns.some((pattern) => (state.from ?? []).some((sender) => pattern.startsWith("@") ? sender.endsWith(pattern) : sender === pattern));
      },
      async hasBounceFor(email) { return (state.bounced ?? []).includes(email); },
      async bounceCount() { return (state.bounced ?? []).length; },
      async bouncedAmong(emails) { return emails.filter((email) => (state.bounced ?? []).includes(email)); },
      async googleWarning() { return null; },
      async close() {},
    };
  };
  return { searches, factory };
}

let ids = 0;
const config = (transport: FccSendConfig["transport"], mailbox: FccSendConfig["mailbox"], overrides: Partial<FccSendConfig> = {}): FccSendConfig => ({
  fromAddress: "aidan@mail.example", mailingAddress: ADDRESS, transport, mailbox, newId: () => `send-${++ids}`, ...overrides,
});

test("stays locked until a founder records the go for this exact copy", async () => {
  const { raw, db } = database();
  addContact(raw, "a", "a@a-tel.example");
  const t = fakeTransport();
  const m = fakeMailbox();
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), MONDAY), { status: "SKIPPED", reason: "locked until a founder records the go" });
  raw.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 1, "approvedCopy" = ?`).run(FCC_COPY_VERSION);
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), MONDAY), { status: "SKIPPED", reason: "locked until a founder records the go" });
  recordGo(raw, "an-older-copy");
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), MONDAY), { status: "SKIPPED", reason: "this copy version is not approved" });
  recordGo(raw, FCC_CAMPAIGN_KEY); // the go Aidan gave the calmer v3 does not cover his v2 email
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), MONDAY), { status: "SKIPPED", reason: "this copy version is not approved" });
  recordGo(raw);
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory, { mailingAddress: "" }), MONDAY), { status: "SKIPPED", reason: "no mailing address" });
  assert.deepEqual(await runFccDailySend(db, config(null, m.factory), MONDAY), { status: "SKIPPED", reason: "sender not configured" });
  assert.deepEqual(await runFccDailySend(db, config(t.factory, null), MONDAY), { status: "SKIPPED", reason: "sender not configured" });
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), SATURDAY), { status: "SKIPPED", reason: "weekend" });
  assert.equal(t.sent.length, 0);
  assert.equal(t.opened(), 0);
  assert.throws(() => raw.prepare(`UPDATE "FccCampaignSetting" SET "dailyCap" = 31`).run(), /CHECK/);
});

test("sends at most 30 a day, named contacts first, never held inboxes, and never twice", async () => {
  const { raw, db } = database();
  for (let i = 1; i <= 5; i += 1) addContact(raw, `u${i}`, `ops${i}@unclear${i}.example`, { kind: "unclear" });
  for (let i = 1; i <= 35; i += 1) addContact(raw, `n${i}`, `person${i}@co${i}.example`);
  addContact(raw, "held", "support@held.example", { kind: "generic", sendable: false });
  recordGo(raw);
  const t = fakeTransport();
  const m = fakeMailbox();

  const result = await runFccDailySend(db, config(t.factory, m.factory), MONDAY);
  assert.deepEqual(result, { status: "RAN", firstEmails: 30, followUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 0, remainingToday: 0, followUpsHeldBack: null });
  assert.equal(t.sent.length, 30);
  assert.equal(new Set(t.sent.map((m) => m.to)).size, 30);
  assert.ok(t.sent.every((message) => message.to.startsWith("person")), "named contacts go before unclear ones");
  assert.ok(t.sent.every((message) => message.text.includes("257 Example St,\nKitchener, ON N2C 0A0, Canada") && /Reply "no thanks"/.test(message.text)));
  assert.ok(t.sent.every((message) => message.html?.includes('<a href="https://axiominternational.ca/fcc-filings/" style="color:#1a56c4">axiominternational.ca</a>')),
    "the signature link shows the plain domain and opens the FCC page");
  assert.equal(statusOf(raw, "held"), "held");
  const first = raw.prepare(`SELECT "status","step2DueAt","step1MessageId" FROM "FccCampaignContact" WHERE "id" = 'n1'`).get() as Record<string, string>;
  assert.deepEqual(first, { status: "step1_sent", step2DueAt: "2026-10-29", step1MessageId: "<fcc-v5-n1-1@mail.example>" });

  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), new Date("2026-10-26T18:00:00Z")), { status: "SKIPPED", reason: "daily cap reached" });
  const tuesday = await runFccDailySend(db, config(t.factory, m.factory), TUESDAY);
  assert.equal(tuesday.status === "RAN" && tuesday.firstEmails, 10);
  assert.equal(new Set(t.sent.map((m) => m.to)).size, 40, "nobody is emailed twice");
  assert.ok(!t.sent.some((message) => message.to === "support@held.example"));
});

test("follow-ups go out 3 days later in the same thread, before any new first emails", async () => {
  const { raw, db } = database();
  for (let i = 1; i <= 12; i += 1) addContact(raw, `c${i}`, `person${i}@co${i}.example`);
  recordGo(raw);
  raw.prepare(`UPDATE "FccCampaignSetting" SET "dailyCap" = 10`).run();
  const t = fakeTransport();
  const m = fakeMailbox();
  await runFccDailySend(db, config(t.factory, m.factory), MONDAY);
  assert.equal(t.sent.length, 10);
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), new Date("2026-10-28T14:00:00Z")), {
    status: "RAN", firstEmails: 2, followUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 0, remainingToday: 8, followUpsHeldBack: null,
  });

  const thursday = await runFccDailySend(db, config(t.factory, m.factory), THURSDAY);
  assert.equal(thursday.status === "RAN" && thursday.followUps, 10);
  const followUps = t.sent.slice(12);
  assert.equal(followUps.length, 10);
  for (const message of followUps) {
    const original = t.sent.find((sent) => sent.to === message.to && !sent.subject.startsWith("Re:"))!;
    assert.equal(message.subject, `Re: ${original.subject}`);
    assert.match(message.subject, /^Re: Question about .+ RMD listing$/);
    assert.match(message.text, /^Hi Jane,\n\nBumping this in case it got buried\./);
    assert.equal(message.headers["In-Reply-To"], original.headers["Message-ID"]);
    assert.equal(message.headers.References, original.headers["Message-ID"]);
    assert.notEqual(message.headers["Message-ID"], original.headers["Message-ID"]);
  }
  assert.equal(statusOf(raw, "c1"), "step2_sent");
  assert.equal(statusOf(raw, "c11"), "step1_sent", "Wednesday's first emails wait for their own follow-up day");
  const saturdayDue = await runFccDailySend(db, config(t.factory, m.factory), SATURDAY);
  assert.equal(saturdayDue.status, "SKIPPED");
  const nextMonday = await runFccDailySend(db, config(t.factory, m.factory), new Date("2026-11-02T15:00:00Z"));
  assert.equal(nextMonday.status === "RAN" && nextMonday.followUps, 2, "a follow-up due on the weekend goes on Monday");
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), new Date("2026-11-03T15:00:00Z")), { status: "SKIPPED", reason: "nothing to send" });
});

test("people who got the calmer v3 first email get its follow-up; everyone new gets Aidan's v2", async () => {
  const { raw, db } = database();
  addContact(raw, "old", "pat@old-tel.example");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'step1_sent', "step1SentAt" = '2026-10-28T15:00:00Z',
    "step1MessageId" = '<fcc-old-1@mail.example>', "step2DueAt" = '2026-10-31' WHERE "id" = 'old'`).run();
  raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status")
    VALUES ('v3-first','old',1,'pat@old-tel.example','2026-10-28','<fcc-old-1@mail.example>','SENT')`).run();
  addContact(raw, "new", "lee@new-tel.example", { company: "Talktone" });
  recordGo(raw);
  const t = fakeTransport();
  const monday = await runFccDailySend(db, config(t.factory, fakeMailbox().factory), new Date("2026-11-02T15:00:00Z"));
  assert.equal(monday.status === "RAN" && `${monday.followUps}+${monday.firstEmails}`, "1+1");
  const [followUp, first] = t.sent;
  assert.equal(followUp.to, "pat@old-tel.example");
  assert.equal(followUp.subject, "Re: Your 2026 RMD recertification");
  assert.equal(followUp.headers["In-Reply-To"], "<fcc-old-1@mail.example>");
  assert.equal(followUp.headers["Message-ID"], "<fcc-old-2@mail.example>");
  assert.equal(first.to, "lee@new-tel.example");
  assert.equal(first.subject, "Question about Talktone's RMD listing");
  assert.match(first.text, /noticed Talktone's listing \(RMD-new\) doesn't show a 2026 recertification yet/);
  assert.equal(first.headers["Message-ID"], "<fcc-v5-new-1@mail.example>");
});

test("anyone at the company writing back stops the follow-up; shared mail services don't", async () => {
  const { raw, db } = database();
  addContact(raw, "a", "jane@alpha-tel.example");
  addContact(raw, "b", "sam@beta-tel.example");
  addContact(raw, "c", "kim@gamma-tel.example");
  addContact(raw, "d", "fenton@coop-host.example", { company: "Fenton Cooperative" });
  addContact(raw, "e", "superior@coop-host.example", { company: "Superior Cooperative" });
  addContact(raw, "f", "owner123@gmail.com");
  recordGo(raw);
  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), MONDAY);
  assert.equal(t.sent.length, 6);

  const m = fakeMailbox({ from: ["jane@alpha-tel.example", "boss@beta-tel.example", "superior@coop-host.example", "someone.else@gmail.com"] });
  const result = await runFccDailySend(db, config(t.factory, m.factory), THURSDAY);
  assert.equal(result.status === "RAN" && result.replied, 3);
  assert.deepEqual(["a", "b", "c", "d", "e", "f"].map((id) => statusOf(raw, id)), ["replied", "replied", "step2_sent", "step2_sent", "replied", "step2_sent"]);
  assert.deepEqual(m.searches.find((patterns) => patterns[0] === "fenton@coop-host.example"), ["fenton@coop-host.example"], "a host shared by two companies is matched by exact address only");
  assert.deepEqual(m.searches.find((patterns) => patterns[0] === "owner123@gmail.com"), ["owner123@gmail.com"]);
  assert.deepEqual(m.searches.find((patterns) => patterns[0] === "kim@gamma-tel.example"), ["kim@gamma-tel.example", "@gamma-tel.example"]);
});

test("bounces and the do-not-email list stop sending for good", async () => {
  const { raw, db } = database();
  addContact(raw, "bad", "nobody@gone.example");
  addContact(raw, "later", "later@bounces.example");
  addContact(raw, "fine", "fine@ok.example");
  addContact(raw, "blocked", "anyone@blocked.example");
  raw.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES ('@blocked.example','DO_NOT_CONTACT')`).run();
  recordGo(raw);
  const t = fakeTransport((message) => message.to === "nobody@gone.example" ? new PermanentEmailError("SMTP 550 no such user") : null);
  const monday = await runFccDailySend(db, config(t.factory, fakeMailbox().factory), MONDAY);
  assert.deepEqual(monday, { status: "RAN", firstEmails: 2, followUps: 0, replied: 0, bounced: 1, suppressed: 1, failed: 0, remainingToday: 27, followUpsHeldBack: null });
  assert.deepEqual(["bad", "later", "fine", "blocked"].map((id) => statusOf(raw, id)), ["bounced", "step1_sent", "step1_sent", "suppressed"]);

  const thursday = await runFccDailySend(db, config(t.factory, fakeMailbox({ bounced: ["later@bounces.example"] }).factory), THURSDAY);
  assert.equal(thursday.status === "RAN" && thursday.bounced, 1);
  assert.equal(statusOf(raw, "later"), "bounced");
  assert.equal(statusOf(raw, "fine"), "step2_sent");
  const suppressed = raw.prepare(`SELECT "email","reason" FROM "EngineEmailSuppression" ORDER BY "email"`).all();
  assert.deepEqual(suppressed, [
    { email: "@blocked.example", reason: "DO_NOT_CONTACT" },
    { email: "later@bounces.example", reason: "BOUNCED" },
    { email: "nobody@gone.example", reason: "BOUNCED" },
  ]);
  assert.ok(!t.sent.some((message) => message.to.endsWith("@blocked.example")));
});

test("provider trouble stops the day, and an email claimed before a crash is never sent again", async () => {
  const { raw, db } = database();
  for (const id of ["c1", "c2", "c3", "c4"]) addContact(raw, id, `${id}@co-${id}.example`);
  recordGo(raw);
  raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status") VALUES ('crashed','c1',1,'c1@co-c1.example','2026-10-26','<fcc-c1-1@mail.example>','CLAIMED')`).run();
  let calls = 0;
  const t = fakeTransport(() => (++calls === 2 ? new Error("SMTP 421 try again later") : null));
  const result = await runFccDailySend(db, config(t.factory, fakeMailbox().factory), MONDAY);
  assert.deepEqual(result, { status: "RAN", firstEmails: 1, followUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 1, remainingToday: 27, followUpsHeldBack: null });
  assert.deepEqual(t.sent.map((message) => message.to), ["c2@co-c2.example"]);
  assert.deepEqual(["c1", "c2", "c3", "c4"].map((id) => statusOf(raw, id)), ["ready", "step1_sent", "failed", "ready"]);
  assert.equal((raw.prepare(`SELECT "detail" FROM "FccCampaignSend" WHERE "contactId" = 'c3'`).get() as { detail: string }).detail, "SMTP 421 try again later");

  const tuesday = await runFccDailySend(db, config(fakeTransport().factory, fakeMailbox().factory), TUESDAY);
  assert.equal(tuesday.status === "RAN" && tuesday.firstEmails, 1, "only c4 is left; the crashed claim and the failed one wait for a person");
  assert.throws(() => raw.prepare(`DELETE FROM "FccCampaignSend"`).run(), /FCC_CAMPAIGN_SEND_NO_DELETE/);
  assert.throws(() => raw.prepare(`UPDATE "FccCampaignSend" SET "status" = 'CLAIMED' WHERE "status" = 'SENT'`).run(), /FCC_CAMPAIGN_SEND_FORWARD_ONLY/);

  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'ready' WHERE "id" = 'c3'`).run();
  const retry = await runFccDailySend(db, config(fakeTransport().factory, fakeMailbox().factory), new Date("2026-10-28T14:00:00Z"));
  assert.equal(retry.status === "RAN" && retry.firstEmails, 1, "a person can put a failed contact back in line");
});

test("a broken inbox check holds back follow-ups but first emails still go; a refused login marks nobody", async () => {
  const { raw, db } = database();
  for (const id of ["early", "new"]) addContact(raw, id, `${id}@co-${id}.example`);
  recordGo(raw);
  raw.prepare(`UPDATE "FccCampaignSetting" SET "dailyCap" = 1`).run();
  await runFccDailySend(db, config(fakeTransport().factory, fakeMailbox().factory), MONDAY);
  raw.prepare(`UPDATE "FccCampaignSetting" SET "dailyCap" = 30`).run();

  const t = fakeTransport();
  const result = await runFccDailySend(db, config(t.factory, fakeMailbox({ broken: true }).factory), THURSDAY);
  assert.equal(result.status, "RAN");
  assert.match(result.status === "RAN" ? result.followUpsHeldBack ?? "" : "", /inbox check failed: IMAP NO/);
  assert.deepEqual(t.sent.map((message) => message.to), ["new@co-new.example"]);
  assert.equal(statusOf(raw, "early"), "step1_sent");

  addContact(raw, "third", "third@co-third.example");
  const refused = async () => { throw new Error("SMTP 535 5.7.8 Username and Password not accepted"); };
  await assert.rejects(runFccDailySend(db, config(refused, fakeMailbox().factory), new Date("2026-10-30T14:00:00Z")), /535/);
  assert.equal(statusOf(raw, "third"), "ready");
  assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM "FccCampaignSend" WHERE "contactId" = 'third'`).get() as { n: number }).n, 0);
});

test("Gmail's own limits and blocks stop the day without blaming the recipient", async () => {
  const { raw, db } = database();
  for (const id of ["c1", "c2", "c3"]) addContact(raw, id, `${id}@co-${id}.example`);
  recordGo(raw);
  let calls = 0;
  const t = fakeTransport(() => (++calls === 2 ? new PermanentEmailError("SMTP 550-5.4.5 Daily user sending limit exceeded. 550 5.4.5 gsmtp") : null));
  const result = await runFccDailySend(db, config(t.factory, fakeMailbox().factory), MONDAY);
  assert.equal(result.status === "RAN" && result.failed, 1);
  assert.equal(result.status === "RAN" && result.bounced, 0);
  assert.deepEqual(["c1", "c2", "c3"].map((id) => statusOf(raw, id)), ["step1_sent", "failed", "ready"]);
  assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM "EngineEmailSuppression"`).get() as { n: number }).n, 0, "nobody is put on the do-not-email list");
});

test("the November 6 hot list goes first, one first email each, and no follow-up is ever scheduled for it", async () => {
  const { raw, db } = database();
  addContact(raw, "due", "due@due-tel.example");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'step1_sent', "step1SentAt" = '2026-10-26T15:00:00Z',
    "step1MessageId" = '<fcc-due-1@mail.example>', "step2DueAt" = '2026-10-29' WHERE "id" = 'due'`).run();
  addContact(raw, "fresh", "fresh@fresh-tel.example");
  for (const id of ["h1", "h2", "h3"]) addNov6Contact(raw, id, `${id}@${id}-tel.example`);
  recordGo(raw);
  const t = fakeTransport();
  const m = fakeMailbox();

  const thursday = await runFccDailySend(db, config(t.factory, m.factory), THURSDAY, { cap: 4 });
  assert.deepEqual(thursday, { status: "RAN", firstEmails: 3, followUps: 1, replied: 0, bounced: 0, suppressed: 0, failed: 0, remainingToday: 0, followUpsHeldBack: null });
  assert.deepEqual(t.sent.map((message) => message.to), ["h1@h1-tel.example", "h2@h2-tel.example", "h3@h3-tel.example", "due@due-tel.example"]);
  assert.equal(t.sent[0].subject, "Did h1 Telephone get the FCC's RMD notice?");
  assert.equal(t.sent[0].headers["Message-ID"], "<fcc-nov6-h1-1@mail.example>");
  assert.equal(t.sent[3].headers["In-Reply-To"], "<fcc-due-1@mail.example>", "the follow-up for the March contact still threads");
  for (const id of ["h1", "h2", "h3"]) {
    assert.deepEqual(raw.prepare(`SELECT "status","step2DueAt" FROM "FccCampaignContact" WHERE "id" = ?`).get(id), { status: "step1_sent", step2DueAt: null });
  }
  assert.equal(statusOf(raw, "fresh"), "ready", "the normal first emails wait until the hot list is empty");

  // Three days later, and on every run after, the hot list gets nothing more; the normal queue now goes.
  const monday = await runFccDailySend(db, config(t.factory, m.factory), new Date("2026-11-02T15:00:00Z"));
  assert.equal(monday.status === "RAN" && monday.firstEmails, 1);
  assert.deepEqual(t.sent.slice(4).map((message) => message.to), ["fresh@fresh-tel.example"]);
  assert.ok(!t.sent.some((message) => /^h\d@/.test(message.to) && message.subject.startsWith("Re:")), "no follow-up to the hot list");
});

test("the hot list counts toward the same 30 a day and goes before any normal first email", async () => {
  const { raw, db } = database();
  for (let i = 1; i <= 35; i += 1) addNov6Contact(raw, `h${i}`, `hot${i}@hot-tel.example`);
  for (let i = 1; i <= 5; i += 1) addContact(raw, `n${i}`, `person${i}@co${i}.example`);
  recordGo(raw);
  const t = fakeTransport();
  const m = fakeMailbox();

  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), MONDAY), {
    status: "RAN", firstEmails: 30, followUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 0, remainingToday: 0, followUpsHeldBack: null,
  });
  assert.ok(t.sent.every((message) => message.headers["Message-ID"].startsWith("<fcc-nov6-")), "only hot-list emails on the first day");
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), new Date("2026-10-26T18:00:00Z")), { status: "SKIPPED", reason: "daily cap reached" });

  const tuesday = await runFccDailySend(db, config(t.factory, m.factory), TUESDAY);
  assert.equal(tuesday.status === "RAN" && tuesday.firstEmails, 10);
  assert.ok(t.sent.slice(30, 35).every((message) => message.headers["Message-ID"].startsWith("<fcc-nov6-")), "the last five hot contacts go first on Tuesday");
  assert.ok(t.sent.slice(35).every((message) => message.headers["Message-ID"].startsWith("<fcc-v5-")), "then the normal first emails");
  assert.equal(new Set(t.sent.map((message) => message.to)).size, 40, "nobody is emailed twice");
});

test("a held hot-list inbox is never sent, and a do-not-email contact on the hot list is skipped", async () => {
  const { raw, db } = database();
  addNov6Contact(raw, "held", "support@held.example", { sendable: false });
  addNov6Contact(raw, "blocked", "anyone@blocked.example");
  addNov6Contact(raw, "ok", "ok@ok-tel.example");
  raw.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES ('@blocked.example','DO_NOT_CONTACT')`).run();
  recordGo(raw);
  const t = fakeTransport();
  const result = await runFccDailySend(db, config(t.factory, fakeMailbox().factory), MONDAY);
  assert.deepEqual(result, { status: "RAN", firstEmails: 1, followUps: 0, replied: 0, bounced: 0, suppressed: 1, failed: 0, remainingToday: 29, followUpsHeldBack: null });
  assert.deepEqual(t.sent.map((message) => message.to), ["ok@ok-tel.example"]);
  assert.deepEqual(["held", "blocked", "ok"].map((id) => statusOf(raw, id)), ["held", "suppressed", "step1_sent"]);
});

test("the hot list skips anyone who already replied, bounced or was suppressed on the March pack", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "said-no@no-tel.example");
  addContact(raw, "m2", "gone@gone-tel.example");
  addContact(raw, "m3", "still-open@open-tel.example");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'replied' WHERE "id" = 'm1'`).run();
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'bounced' WHERE "id" = 'm2'`).run();
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'step1_sent', "step1MessageId" = '<x>', "step1SentAt" = '2026-10-20T14:00:00Z', "step2DueAt" = '2026-12-01' WHERE "id" = 'm3'`).run();
  addNov6Contact(raw, "h1", "said-no@no-tel.example");
  addNov6Contact(raw, "h2", "gone@gone-tel.example");
  addNov6Contact(raw, "h3", "still-open@open-tel.example");
  recordGo(raw);
  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), MONDAY);
  assert.deepEqual(t.sent.map((message) => message.to), ["still-open@open-tel.example"]);
  assert.equal(statusOf(raw, "h1"), "ready");
  assert.equal(statusOf(raw, "h2"), "ready");
});

test("a hold or failure on someone's March row also stops their hot-list email", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "under-investigation@probe-tel.example");
  addContact(raw, "m2", "stuck@failed-tel.example");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'held', "holdReason" = 'Their FCC filing reports an investigation' WHERE "id" = 'm1'`).run();
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'failed' WHERE "id" = 'm2'`).run();
  addNov6Contact(raw, "h1", "under-investigation@probe-tel.example");
  addNov6Contact(raw, "h2", "stuck@failed-tel.example");
  addNov6Contact(raw, "h3", "fine@fine-tel.example");
  recordGo(raw);
  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), MONDAY);
  assert.deepEqual(t.sent.map((message) => message.to), ["fine@fine-tel.example"]);
  assert.deepEqual(["h1", "h2"].map((id) => statusOf(raw, id)), ["ready", "ready"], "their rows wait in case the hold is lifted");
});

test("a stop that only says they signed a 2026 declaration doesn't block the hot-list email written for them", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "signed@signed-tel.example");
  addContact(raw, "m2", "also-signed@held-tel.example");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'suppressed', "stoppedReason" = 'Signed a 2026 RMD declaration (Jan-Feb), so a follow-up would wrongly say overdue' WHERE "id" = 'm1'`).run();
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'held', "holdReason" = 'Signed a 2026 RMD declaration (Jan-Feb), so they have most likely recertified' WHERE "id" = 'm2'`).run();
  addNov6Contact(raw, "h1", "signed@signed-tel.example");
  addNov6Contact(raw, "h2", "also-signed@held-tel.example");
  addNov6Contact(raw, "h3", "colleague@signed-tel.example");
  recordGo(raw);
  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), MONDAY);
  assert.deepEqual(t.sent.map((message) => message.to).sort(), ["also-signed@held-tel.example", "colleague@signed-tel.example", "signed@signed-tel.example"]);
  assert.equal(statusOf(raw, "m1"), "suppressed", "they still get no March follow-up");
});

test("a reply, stop or company hold at another mailbox stops the hot-list email, but a generic inbox hold or a shared host does not", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "boss@replied-tel.example");
  addContact(raw, "m2", "boss@stopped-tel.example");
  addContact(raw, "m3", "boss@probe-tel.example");
  addContact(raw, "m4", "support@generic-tel.example", { sendable: false });
  addContact(raw, "m5", "friend@gmail.com");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'replied' WHERE "id" IN ('m1','m5')`).run();
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'suppressed' WHERE "id" = 'm2'`).run();
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'held', "holdReason" = 'Their FCC filing reports an investigation' WHERE "id" = 'm3'`).run();
  raw.prepare(`UPDATE "FccCampaignContact" SET "holdReason" = 'Generic inbox (support@/noc@/info@ style). Check before sending.' WHERE "id" = 'm4'`).run();
  addNov6Contact(raw, "h1", "other@replied-tel.example");
  addNov6Contact(raw, "h2", "other@stopped-tel.example");
  addNov6Contact(raw, "h3", "other@probe-tel.example");
  addNov6Contact(raw, "h4", "owner@generic-tel.example");
  addNov6Contact(raw, "h5", "someone@gmail.com");
  recordGo(raw);
  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), MONDAY);
  assert.deepEqual(t.sent.map((message) => message.to).sort(), ["owner@generic-tel.example", "someone@gmail.com"]);
  assert.deepEqual(["h1", "h2", "h3"].map((id) => statusOf(raw, id)), ["suppressed", "suppressed", "suppressed"]);
});

test("a stop on someone's hot-list row also stops the rest of that company's hot list", async () => {
  const { raw, db } = database();
  addNov6Contact(raw, "h1", "first@stopped-tel.example");
  addNov6Contact(raw, "h2", "second@stopped-tel.example");
  addNov6Contact(raw, "h3", "fine@fine-tel.example");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'suppressed', "stoppedReason" = 'Do not contact (Aidan)' WHERE "id" = 'h1'`).run();
  recordGo(raw);
  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), MONDAY);
  assert.deepEqual(t.sent.map((message) => message.to), ["fine@fine-tel.example"]);
  assert.equal(statusOf(raw, "h2"), "suppressed");
});

test("only the first inbox sends the hot list, and an added inbox leaves its people alone", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "on-both@both-tel.example");
  addContact(raw, "m2", "march-only@march-tel.example");
  addNov6Contact(raw, "h1", "on-both@both-tel.example");
  addNov6Contact(raw, "h2", "hot-only@hot-tel.example");
  recordGo(raw);
  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory, { primary: false, fromAddress: "riley@mail.example", fromName: "Riley Hinsperger" }), MONDAY);
  assert.deepEqual(t.sent.map((message) => message.to), ["march-only@march-tel.example"]);
  assert.deepEqual(["h1", "h2", "m1"].map((id) => statusOf(raw, id)), ["ready", "ready", "ready"]);
});

test("the hot list closes after its last day, and anyone it never reached rejoins the March queue", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "reached@reached-tel.example");
  addContact(raw, "m2", "leftover@left-tel.example");
  addNov6Contact(raw, "h1", "reached@reached-tel.example");
  addNov6Contact(raw, "h2", "leftover@left-tel.example");
  recordGo(raw);
  const thursday = new Date("2026-11-05T15:00:00Z");
  const first = fakeTransport();
  await runFccDailySend(db, config(first.factory, fakeMailbox().factory), thursday, { limit: 1 });
  assert.deepEqual(first.sent.map((message) => message.to), ["reached@reached-tel.example"], "the last day still sends");
  assert.match(first.sent[0]!.headers["Message-ID"], /^<fcc-nov6-/);

  const friday = new Date("2026-11-06T15:00:00Z");
  const after = fakeTransport();
  await runFccDailySend(db, config(after.factory, fakeMailbox().factory), friday);
  assert.deepEqual(after.sent.map((message) => message.to), ["leftover@left-tel.example"], "nobody the hot list reached gets the March email too");
  assert.doesNotMatch(after.sent[0]!.headers["Message-ID"], /^<fcc-nov6-/, "no November 6 line after it has passed");
  assert.equal(statusOf(raw, "h2"), "ready");
  assert.equal(statusOf(raw, "m2"), "step1_sent");
});

test("the hot list reads the inbox first for anyone emailed in March, and holds them if it can't", async () => {
  const opened = (raw: Database.Database, id: string) =>
    raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'step1_sent', "step1MessageId" = '<x>', "step1SentAt" = '2026-10-20T14:00:00Z', "step2DueAt" = '2026-12-01' WHERE "id" = ?`).run(id);

  // A reply that isn't recorded yet, and a bounce that isn't recorded yet: neither gets the hot-list email.
  const first = database();
  for (const [id, email] of [["m1", "wrote-back@back-tel.example"], ["m2", "bounced@gone-tel.example"], ["m3", "quiet@quiet-tel.example"]]) {
    addContact(first.raw, id, email);
    opened(first.raw, id);
  }
  addNov6Contact(first.raw, "h1", "wrote-back@back-tel.example");
  addNov6Contact(first.raw, "h2", "bounced@gone-tel.example");
  addNov6Contact(first.raw, "h3", "quiet@quiet-tel.example");
  addNov6Contact(first.raw, "h4", "never-emailed@new-tel.example");
  recordGo(first.raw);
  const t1 = fakeTransport();
  const m1 = fakeMailbox({ from: ["wrote-back@back-tel.example"], bounced: ["bounced@gone-tel.example"] });
  const result = await runFccDailySend(first.db, config(t1.factory, m1.factory), MONDAY);
  assert.deepEqual(t1.sent.map((message) => message.to), ["quiet@quiet-tel.example", "never-emailed@new-tel.example"]);
  assert.equal(statusOf(first.raw, "h1"), "replied");
  assert.equal(statusOf(first.raw, "h2"), "bounced");
  assert.ok(result.status === "RAN" && result.replied === 1 && result.bounced === 1);
  assert.ok(first.raw.prepare(`SELECT 1 FROM "EngineEmailSuppression" WHERE "email" = 'bounced@gone-tel.example'`).get(), "the bounce goes on the do-not-email list");

  // The inbox can't be read: everyone on the hot list waits and stays ready.
  const second = database();
  addContact(second.raw, "m1", "emailed@march-tel.example");
  opened(second.raw, "m1");
  addNov6Contact(second.raw, "h1", "emailed@march-tel.example");
  addNov6Contact(second.raw, "h2", "never-emailed@new-tel.example");
  recordGo(second.raw);
  const t2 = fakeTransport();
  const m2 = fakeMailbox({ broken: true });
  const held = await runFccDailySend(second.db, config(t2.factory, m2.factory), MONDAY);
  assert.deepEqual(t2.sent.map((message) => message.to), []);
  assert.deepEqual(["h1", "h2"].map((id) => statusOf(second.raw, id)), ["ready", "ready"]);
  assert.ok(held.status === "RAN" && /inbox check failed/.test(held.followUpsHeldBack ?? ""));
});

test("an unrecorded reply from someone else at the company stops a hot-list contact with no March row", async () => {
  const { raw, db } = database();
  addNov6Contact(raw, "h1", "bob@replied-tel.example");
  addNov6Contact(raw, "h2", "sam@quiet-tel.example");
  recordGo(raw);
  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox({ from: ["alice@replied-tel.example"] }).factory), MONDAY);
  assert.deepEqual(t.sent.map((message) => message.to), ["sam@quiet-tel.example"]);
  assert.equal(statusOf(raw, "h1"), "replied");
});

test("a reply found by the hot-list check also stops that person's March email in the same run", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "not-yet-emailed@back-tel.example");
  addContact(raw, "m2", "already-emailed@back2-tel.example");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'step1_sent', "step1MessageId" = '<x>', "step1SentAt" = '2026-10-20T14:00:00Z', "step2DueAt" = '2026-10-23' WHERE "id" = 'm2'`).run();
  addNov6Contact(raw, "h1", "not-yet-emailed@back-tel.example");
  addNov6Contact(raw, "h2", "already-emailed@back2-tel.example");
  recordGo(raw);
  const t = fakeTransport();
  const m = fakeMailbox({ from: ["not-yet-emailed@back-tel.example", "already-emailed@back2-tel.example"] });
  await runFccDailySend(db, config(t.factory, m.factory), MONDAY);
  assert.equal(t.sent.length, 0, "no hot-list email, March email or follow-up");
  for (const id of ["h1", "h2", "m1", "m2"]) assert.equal(statusOf(raw, id), "replied");
});

test("when the inbox can't be read, someone on both lists gets neither email that run", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "both-one@one-tel.example");
  addContact(raw, "m2", "both-two@two-tel.example");
  addContact(raw, "m3", "march-only@three-tel.example");
  addNov6Contact(raw, "h1", "both-one@one-tel.example");
  addNov6Contact(raw, "h2", "both-two@two-tel.example");
  recordGo(raw);
  const t = fakeTransport();
  const result = await runFccDailySend(db, config(t.factory, fakeMailbox({ broken: true }).factory), MONDAY);
  assert.deepEqual(t.sent.map((message) => message.to), ["march-only@three-tel.example"]);
  for (const id of ["h1", "h2", "m1", "m2"]) assert.equal(statusOf(raw, id), "ready");
  assert.ok(result.status === "RAN" && /inbox check failed/.test(result.followUpsHeldBack ?? ""));
});

test("anyone on the hot list gets the November 6 email once and nothing from the March queue, then or later", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "not-yet-emailed@one-tel.example");
  addContact(raw, "m2", "already-emailed@two-tel.example");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'step1_sent', "step1MessageId" = '<x>', "step1SentAt" = '2026-10-20T14:00:00Z', "step2DueAt" = '2026-10-23' WHERE "id" = 'm2'`).run();
  addContact(raw, "m3", "march-only@three-tel.example");
  addContact(raw, "m4", "generic-on-both@four-tel.example");
  addNov6Contact(raw, "h1", "not-yet-emailed@one-tel.example");
  addNov6Contact(raw, "h2", "already-emailed@two-tel.example");
  addNov6Contact(raw, "h4", "generic-on-both@four-tel.example", { sendable: false });
  recordGo(raw);
  const t = fakeTransport();
  const m = fakeMailbox();
  await runFccDailySend(db, config(t.factory, m.factory), MONDAY);
  await runFccDailySend(db, config(t.factory, m.factory), TUESDAY);
  await runFccDailySend(db, config(t.factory, m.factory), THURSDAY);
  const to = (email: string) => t.sent.filter((message) => message.to === email);
  assert.equal(to("not-yet-emailed@one-tel.example").length, 1);
  assert.match(to("not-yet-emailed@one-tel.example")[0].headers["Message-ID"], /^<fcc-nov6-/);
  assert.equal(to("already-emailed@two-tel.example").length, 1);
  assert.match(to("already-emailed@two-tel.example")[0].headers["Message-ID"], /^<fcc-nov6-/);
  assert.equal(to("march-only@three-tel.example")[0].headers["Message-ID"].startsWith("<fcc-v5-"), true, "the normal queue still goes");
  assert.equal(to("generic-on-both@four-tel.example")[0].headers["Message-ID"].startsWith("<fcc-v5-"), true, "a held hot-list row leaves March alone");
});

test("the worker's weekday 10am schedule runs only the retired website batch; the FCC tick has its own schedule", async () => {
  const source = readFileSync(new URL("../../worker.mjs", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, "")
    .replace(/^export \{[^}]+\};\s*/gm, "")
    .replace("export default exportedWorker;", "return exportedWorker;");
  const runs: string[] = [];
  const worker = new Function("deps", `const {openNextWorkerModule,setCloudflareBindings,clearServerEnvCache,runEngineEmailCron,runFccCampaignCron,getCronTimeoutBudgets,runCallerSyncTick}=deps;\n${source}`)({
    openNextWorkerModule: {}, setCloudflareBindings: () => {}, clearServerEnvCache: () => {},
    runEngineEmailCron: async () => { runs.push("website"); return { status: "SKIPPED", reason: "test" }; },
    runFccCampaignCron: async () => { runs.push("fcc"); return { status: "SKIPPED", reason: "test" }; },
    getCronTimeoutBudgets: () => { throw new Error("Discovery must not run"); },
    runCallerSyncTick: async () => { throw new Error("Caller sync must not run"); },
  }) as { scheduled(controller: { cron: string }, env: object, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> };
  const tasks: Promise<unknown>[] = [];
  await worker.scheduled({ cron: "0 14 * * MON-FRI" }, {}, { waitUntil: (p) => tasks.push(p) });
  await Promise.all(tasks);
  assert.deepEqual(runs, ["website"]);
  await worker.scheduled({ cron: "* 14-19 * * *" }, {}, { waitUntil: (p) => tasks.push(p) });
  await Promise.all(tasks);
  assert.deepEqual(runs, ["website", "fcc"]);
});
