import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION, FCC_NOV6_CAMPAIGN_KEY, fccSubjectTestCopy, renderFccEmailDay7 } from "@/lib/fcc-campaign";
import { runFccDailySend, type FccMailbox, type FccSendConfig } from "@/lib/fcc-campaign-sender";
import { fccDailyMax } from "@/lib/fcc-campaign-tick";
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
  assert.deepEqual(result, { status: "RAN", firstEmails: 30, followUps: 0, day7FollowUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 0, remainingToday: 0, followUpsHeldBack: null });
  assert.equal(t.sent.length, 30);
  assert.equal(new Set(t.sent.map((m) => m.to)).size, 30);
  assert.ok(t.sent.every((message) => message.to.startsWith("person")), "named contacts go before unclear ones");
  assert.ok(t.sent.every((message) => message.text.includes("257 Example St,\nKitchener, ON N2C 0A0, Canada") && /Reply "no thanks"/.test(message.text)));
  assert.ok(t.sent.every((message) => message.html?.includes('<a href="https://axiominternational.ca/fcc-filings/" style="color:#1a56c4">axiominternational.ca</a>')),
    "the signature link shows the plain domain and opens the FCC page");
  assert.equal(statusOf(raw, "held"), "held");
  const first = raw.prepare(`SELECT "status","step2DueAt","step1MessageId" FROM "FccCampaignContact" WHERE "id" = 'n1'`).get() as Record<string, string>;
  assert.deepEqual(first, { status: "step1_sent", step2DueAt: "2026-10-29", step1MessageId: `<fcc-${fccSubjectTestCopy("n1")}-n1-1@mail.example>` });

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
    status: "RAN", firstEmails: 2, followUps: 0, day7FollowUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 0, remainingToday: 8, followUpsHeldBack: null,
  });

  const thursday = await runFccDailySend(db, config(t.factory, m.factory), THURSDAY);
  assert.equal(thursday.status === "RAN" && thursday.followUps, 10);
  const followUps = t.sent.slice(12);
  assert.equal(followUps.length, 10);
  for (const message of followUps) {
    const original = t.sent.find((sent) => sent.to === message.to && !sent.subject.startsWith("Re:"))!;
    assert.equal(message.subject, `Re: ${original.subject}`);
    assert.match(message.subject, /^Re: (Question about .+ RMD listing|.+ FCC listing)$/);
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
  assert.equal(nextMonday.status === "RAN" && nextMonday.day7FollowUps, 8, "Monday's day-7 follow-ups wait behind the day-3 ones, inside the cap");
  const tuesday = await runFccDailySend(db, config(t.factory, m.factory), new Date("2026-11-03T15:00:00Z"));
  assert.equal(tuesday.status === "RAN" && tuesday.day7FollowUps, 2);
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), new Date("2026-11-04T15:00:00Z")), { status: "SKIPPED", reason: "nothing to send" },
    "Wednesday's two first emails got their day-3 on Monday, so their day-7 waits until Friday");
});

test("people who got the calmer v3 first email get its follow-up; everyone new gets Aidan's v2 under one of the two test subjects", async () => {
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
  const copy = fccSubjectTestCopy("new");
  assert.equal(first.subject, copy === "v7a" ? "Question about Talktone's RMD listing" : "Talktone's FCC listing");
  assert.match(first.text, /noticed Talktone's listing \(RMD-new\) doesn't show a 2026 recertification yet/);
  assert.equal(first.headers["Message-ID"], `<fcc-${copy}-new-1@mail.example>`);
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
  assert.deepEqual(monday, { status: "RAN", firstEmails: 2, followUps: 0, day7FollowUps: 0, replied: 0, bounced: 1, suppressed: 1, failed: 0, remainingToday: 27, followUpsHeldBack: null });
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
  assert.deepEqual(result, { status: "RAN", firstEmails: 1, followUps: 0, day7FollowUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 1, remainingToday: 27, followUpsHeldBack: null });
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
  assert.deepEqual(thursday, { status: "RAN", firstEmails: 3, followUps: 1, day7FollowUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 0, remainingToday: 0, followUpsHeldBack: null });
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
    status: "RAN", firstEmails: 30, followUps: 0, day7FollowUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 0, remainingToday: 0, followUpsHeldBack: null,
  });
  assert.ok(t.sent.every((message) => message.headers["Message-ID"].startsWith("<fcc-nov6-")), "only hot-list emails on the first day");
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), new Date("2026-10-26T18:00:00Z")), { status: "SKIPPED", reason: "daily cap reached" });

  const tuesday = await runFccDailySend(db, config(t.factory, m.factory), TUESDAY);
  assert.equal(tuesday.status === "RAN" && tuesday.firstEmails, 10);
  assert.ok(t.sent.slice(30, 35).every((message) => message.headers["Message-ID"].startsWith("<fcc-nov6-")), "the last five hot contacts go first on Tuesday");
  assert.ok(t.sent.slice(35).every((message) => /^<fcc-v7[ab]-/.test(message.headers["Message-ID"])), "then the normal first emails");
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
  assert.deepEqual(result, { status: "RAN", firstEmails: 1, followUps: 0, day7FollowUps: 0, replied: 0, bounced: 0, suppressed: 1, failed: 0, remainingToday: 29, followUpsHeldBack: null });
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
  assert.match(to("march-only@three-tel.example")[0].headers["Message-ID"], /^<fcc-v7[ab]-/, "the normal queue still goes");
  assert.match(to("generic-on-both@four-tel.example")[0].headers["Message-ID"], /^<fcc-v7[ab]-/, "a held hot-list row leaves March alone");
});

/**
 * A March contact who already got the first email on `firstDay` and the day-3 follow-up on `secondDay`, as the sender
 * records them: the contact row plus a SENT send row for each step. `inbox` is the second inbox's address (null: the first).
 */
function addFollowedUp(raw: Database.Database, id: string, email: string, options: { firstDay: string; secondDay: string; copy?: "v3" | "v4" | "v5" | "v7a" | "v7b"; inbox?: string; company?: string }) {
  addContact(raw, id, email, { company: options.company });
  const mark = options.copy === "v3" ? "" : `${options.copy ?? "v5"}-`;
  const [first, second] = [1, 2].map((step) => `<fcc-${mark}${id}-${step}@mail.example>`);
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'step2_sent', "step1SentAt" = ?, "step1MessageId" = ?, "step2DueAt" = ?, "step2SentAt" = ?, "senderAddress" = ? WHERE "id" = ?`)
    .run(`${options.firstDay}T15:00:00.000Z`, first, options.firstDay, `${options.secondDay}T15:00:00.000Z`, options.inbox ?? null, id);
  const send = raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status","createdAt","senderAddress") VALUES (?,?,?,?,?,?,'SENT',?,?)`);
  send.run(`${id}-1`, id, 1, email, options.firstDay, first, `${options.firstDay}T15:00:00.000Z`, options.inbox ?? null);
  send.run(`${id}-2`, id, 2, email, options.secondDay, second, `${options.secondDay}T15:00:00.000Z`, options.inbox ?? null);
}

const day7Rows = (raw: Database.Database) =>
  raw.prepare(`SELECT "contactId", "sendDay", "status", COALESCE("senderAddress",'') AS inbox FROM "FccCampaignSend" WHERE "step" = 3 ORDER BY "contactId"`).all();

test("the day-7 follow-up goes 7 days after the first email, in its thread, from its inbox, in Aidan's words, and only once", async () => {
  const { raw, db } = database();
  addContact(raw, "c1", "pat@crocker-tel.example", { company: "Crocker Communications" });
  recordGo(raw);
  const t = fakeTransport();
  const m = fakeMailbox();
  const riley = config(t.factory, m.factory, { primary: false, fromAddress: "riley@mail.example", fromName: "Riley Hinsperger" });
  await runFccDailySend(db, riley, MONDAY);
  await runFccDailySend(db, riley, THURSDAY);
  assert.equal(t.sent.length, 2);
  assert.deepEqual(await runFccDailySend(db, riley, new Date("2026-10-30T14:00:00Z")), { status: "SKIPPED", reason: "nothing to send" }, "not before day 7");

  const monday = await runFccDailySend(db, riley, new Date("2026-11-02T15:00:00Z"));
  assert.deepEqual(monday, { status: "RAN", firstEmails: 0, followUps: 0, day7FollowUps: 1, replied: 0, bounced: 0, suppressed: 0, failed: 0, remainingToday: 29, followUpsHeldBack: null });
  const [first, second, last] = t.sent;
  assert.equal(last.to, "pat@crocker-tel.example");
  assert.equal(last.subject, `Re: ${first.subject}`);
  assert.equal(last.headers["In-Reply-To"], second.headers["Message-ID"], "it answers the day-3 follow-up");
  assert.equal(last.headers.References, `${first.headers["Message-ID"]} ${second.headers["Message-ID"]}`, "and names the whole thread");
  assert.equal(last.headers["Message-ID"], first.headers["Message-ID"].replace("-1@", "-3@"), "its first email's copy stays in the Message-ID");
  const copy = fccSubjectTestCopy("c1");
  assert.equal(last.text, renderFccEmailDay7({ firstName: "Jane", company: "Crocker Communications", filings: [{ rmdNumber: "RMD-c1" }] as never }, copy, ADDRESS, "Riley Hinsperger").bodyPlain);
  assert.match(last.text, /^Hi Jane,\n\nI'll close this out after this one\. For context on why I reached out:/);
  assert.match(last.text, /\n\nCrocker Communications' listing \(RMD-c1\) still shows no 2026 recertification\. If you'd like the free list/);
  assert.ok(last.text.endsWith(`Riley Hinsperger\nAxiom · axiominternational.ca · ${ADDRESS}\nNot useful? Reply "no thanks" and I won't contact you again.`), "the sending inbox's founder signs");
  assert.ok(last.html?.includes("I'll close this out after this one."), "an HTML part, like the rest of the thread");
  assert.deepEqual(day7Rows(raw), [{ contactId: "c1", sendDay: "2026-11-02", status: "SENT", inbox: "riley@mail.example" }]);
  assert.equal(statusOf(raw, "c1"), "step2_sent", "they stay listed, so the daily reply check keeps reading for an answer");

  assert.deepEqual(await runFccDailySend(db, riley, new Date("2026-11-03T15:00:00Z")), { status: "SKIPPED", reason: "nothing to send" }, "no fourth email, ever");
  assert.deepEqual(await runFccDailySend(db, riley, new Date("2026-11-16T15:00:00Z")), { status: "SKIPPED", reason: "nothing to send" }, "no day-14 email");
  assert.equal(t.sent.length, 3);
});

test("a late day-3 follow-up pushes the day-7 one to 4 days after it", async () => {
  const { raw, db } = database();
  addFollowedUp(raw, "late", "late@late-tel.example", { firstDay: "2026-10-28", secondDay: "2026-11-05" });
  addFollowedUp(raw, "prompt", "prompt@prompt-tel.example", { firstDay: "2026-10-26", secondDay: "2026-10-29" });
  recordGo(raw);
  const t = fakeTransport();
  const wednesday = await runFccDailySend(db, config(t.factory, fakeMailbox().factory), new Date("2026-11-04T15:00:00Z"));
  assert.equal(wednesday.status === "RAN" && wednesday.day7FollowUps, 1);
  assert.deepEqual(t.sent.map((message) => message.to), ["prompt@prompt-tel.example"]);
  for (const day of ["2026-11-05", "2026-11-06"]) {
    assert.deepEqual(await runFccDailySend(db, config(t.factory, fakeMailbox().factory), new Date(`${day}T15:00:00Z`)), { status: "SKIPPED", reason: "nothing to send" },
      `${day}: 7 days after its first email, but not 4 after its day-3 follow-up`);
  }
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), new Date("2026-11-09T15:00:00Z"));
  assert.deepEqual(day7Rows(raw), [
    { contactId: "late", sendDay: "2026-11-09", status: "SENT", inbox: "" },
    { contactId: "prompt", sendDay: "2026-11-04", status: "SENT", inbox: "" },
  ]);
});

test("people first emailed on the calmer v3 get the day-7 email as plain text, under its subject, signed by Aidan", async () => {
  const { raw, db } = database();
  addFollowedUp(raw, "old", "pat@old-tel.example", { firstDay: "2026-10-28", secondDay: "2026-11-02", copy: "v3", company: "Talktone, Inc." });
  addFollowedUp(raw, "q", "lee@q-tel.example", { firstDay: "2026-10-29", secondDay: "2026-11-02", copy: "v4", company: "Crocker Communications" });
  recordGo(raw);
  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), new Date("2026-11-06T15:00:00Z"));
  const [old, question] = t.sent;
  assert.equal(old.subject, "Re: Your 2026 RMD recertification");
  assert.equal(old.html, undefined, "the v3 thread stays plain text");
  assert.equal(old.headers["Message-ID"], "<fcc-old-3@mail.example>");
  assert.equal(old.headers["In-Reply-To"], "<fcc-old-2@mail.example>");
  assert.match(old.text, /\n\nTalktone's listing \(RMD-old\) still shows no 2026 recertification\./);
  assert.match(old.text, /\n\nAidan Magee\nAxiom · axiominternational\.ca · /);
  assert.equal(question.subject, "Re: Question about Crocker Communications' RMD listing");
  assert.equal(question.headers["Message-ID"], "<fcc-v4-q-3@mail.example>");
});

test("the day-7 follow-up never goes to anyone on the November 6 list", async () => {
  const { raw, db } = database();
  addFollowedUp(raw, "march", "march@march-tel.example", { firstDay: "2026-10-28", secondDay: "2026-11-02" });
  addFollowedUp(raw, "both", "both@both-tel.example", { firstDay: "2026-10-28", secondDay: "2026-11-02" });
  addNov6Contact(raw, "hboth", "both@both-tel.example");
  addNov6Contact(raw, "hot", "hot@hot-tel.example");
  for (const id of ["hboth", "hot"]) {
    raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'step1_sent', "step1SentAt" = '2026-11-03T15:00:00Z', "step1MessageId" = ? WHERE "id" = ?`).run(`<fcc-nov6-${id}-1@mail.example>`, id);
    raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status") SELECT ?, "id", 1, "email", '2026-11-03', "step1MessageId", 'SENT' FROM "FccCampaignContact" WHERE "id" = ?`).run(`${id}-1`, id);
  }
  recordGo(raw);
  const t = fakeTransport();
  for (const day of ["2026-11-09", "2026-11-10", "2026-11-16"]) await runFccDailySend(db, config(t.factory, fakeMailbox().factory), new Date(`${day}T15:00:00Z`));
  assert.deepEqual(t.sent.map((message) => message.to), ["march@march-tel.example"]);
  assert.ok(!t.sent.some((message) => message.headers["Message-ID"].startsWith("<fcc-nov6-")));
});

test("the day-7 follow-up skips anyone who replied, bounced or is on the do-not-email list, and any company where someone else replied, was stopped, bounced or is held", async () => {
  const { raw, db } = database();
  const due = { firstDay: "2026-10-28", secondDay: "2026-11-02" };
  // Each company's rows share its name, as they do on the real list (two names on one domain mean a shared host).
  const company = (id: string, email: string, extra: { status?: string; holdReason?: string; key?: string } = {}) => {
    if (extra.key === FCC_NOV6_CAMPAIGN_KEY) addNov6Contact(raw, id, email); else addContact(raw, id, email, { company: `${email.split("@")[1]} Co` });
    raw.prepare(`UPDATE "FccCampaignContact" SET "company" = ?, "status" = COALESCE(?, "status"), "holdReason" = ? WHERE "id" = ?`)
      .run(`${email.split("@")[1]} Co`, extra.status ?? null, extra.holdReason ?? null, id);
  };
  const emailed = (id: string, email: string) => addFollowedUp(raw, id, email, { ...due, company: `${email.split("@")[1]} Co` });
  emailed("ok", "ok@ok-tel.example");
  emailed("wrote", "wrote@wrote-tel.example");
  emailed("colleague-wrote", "pat@colleague-tel.example");
  emailed("bounce", "bounce@bounce-tel.example");
  emailed("dnc", "anyone@dnc-tel.example");
  raw.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES ('@dnc-tel.example','DO_NOT_CONTACT')`).run();
  emailed("stopped-co", "pat@stopped-tel.example");
  company("stopped-co-2", "boss@stopped-tel.example", { status: "suppressed" });
  emailed("held-co", "pat@held-tel.example");
  company("held-co-2", "boss@held-tel.example", { status: "held", holdReason: "Their FCC filing reports an investigation" });
  emailed("bounced-co", "pat@bounced-tel.example");
  company("bounced-co-2", "old@bounced-tel.example", { status: "bounced" });
  emailed("hot-replied-co", "pat@hotreply-tel.example");
  company("hot-replied-co-2", "boss@hotreply-tel.example", { status: "replied", key: FCC_NOV6_CAMPAIGN_KEY });
  emailed("generic-co", "pat@generic-tel.example");
  company("generic-co-2", "support@generic-tel.example", { status: "held", holdReason: "Generic inbox (support@/noc@/info@ style). Check before sending." });
  emailed("gmail", "owner123@gmail.com");
  addContact(raw, "gmail-2", "someone.else@gmail.com");
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'replied' WHERE "id" = 'gmail-2'`).run();
  recordGo(raw);
  const t = fakeTransport();
  const m = fakeMailbox({ from: ["wrote@wrote-tel.example", "boss@colleague-tel.example"], bounced: ["bounce@bounce-tel.example"] });
  const result = await runFccDailySend(db, config(t.factory, m.factory), new Date("2026-11-09T15:00:00Z"));
  assert.deepEqual(t.sent.map((message) => message.to).sort(), ["owner123@gmail.com", "ok@ok-tel.example", "pat@generic-tel.example"].sort(),
    "a generic-inbox hold or a shared mail service says nothing about the company");
  assert.ok(result.status === "RAN" && result.day7FollowUps === 3 && result.replied === 2 && result.bounced === 1 && result.suppressed === 5);
  assert.deepEqual(["wrote", "colleague-wrote", "bounce", "dnc", "stopped-co", "held-co", "bounced-co", "hot-replied-co"].map((id) => statusOf(raw, id)),
    ["replied", "replied", "bounced", "suppressed", "suppressed", "suppressed", "suppressed", "suppressed"]);
  assert.match((raw.prepare(`SELECT "stoppedReason" FROM "FccCampaignContact" WHERE "id" = 'held-co'`).get() as { stoppedReason: string }).stoppedReason, /Someone else at this company/);
  assert.ok(raw.prepare(`SELECT 1 FROM "EngineEmailSuppression" WHERE "email" = 'bounce@bounce-tel.example'`).get(), "the bounce goes on the do-not-email list");
});

test("a broken inbox check holds back the day-7 follow-ups; a claimed day-7 email is never sent again", async () => {
  const { raw, db } = database();
  addFollowedUp(raw, "a", "a@a-tel.example", { firstDay: "2026-10-28", secondDay: "2026-11-02" });
  addFollowedUp(raw, "b", "b@b-tel.example", { firstDay: "2026-10-28", secondDay: "2026-11-02" });
  addContact(raw, "new", "new@new-tel.example");
  raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status") VALUES ('crashed','b',3,'b@b-tel.example','2026-11-06','<fcc-v5-b-3@mail.example>','CLAIMED')`).run();
  recordGo(raw);
  const broken = fakeTransport();
  const held = await runFccDailySend(db, config(broken.factory, fakeMailbox({ broken: true }).factory), new Date("2026-11-09T15:00:00Z"));
  assert.ok(held.status === "RAN" && /inbox check failed/.test(held.followUpsHeldBack ?? ""));
  assert.deepEqual(broken.sent.map((message) => message.to), ["new@new-tel.example"], "first emails still go");
  assert.equal(statusOf(raw, "a"), "step2_sent");

  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), new Date("2026-11-10T15:00:00Z"));
  assert.deepEqual(t.sent.map((message) => message.to), ["a@a-tel.example"], "b's claim may have gone out before a crash");
});

test("each inbox sends its own people's day-7 emails, inside its own daily limit and before its new first emails", async () => {
  const { raw, db } = database();
  addFollowedUp(raw, "r1", "r1@r1-tel.example", { firstDay: "2026-11-02", secondDay: "2026-11-05", inbox: "riley@mail.example" });
  addFollowedUp(raw, "a1", "a1@a1-tel.example", { firstDay: "2026-11-02", secondDay: "2026-11-05" });
  addContact(raw, "fresh", "fresh@fresh-tel.example");
  recordGo(raw);
  const monday = new Date("2026-11-09T15:00:00Z");
  const r = fakeTransport();
  const riley = config(r.factory, fakeMailbox().factory, { primary: false, fromAddress: "riley@mail.example", fromName: "Riley Hinsperger" });
  assert.deepEqual(await runFccDailySend(db, riley, monday, { cap: 1 }), {
    status: "RAN", firstEmails: 0, followUps: 0, day7FollowUps: 1, replied: 0, bounced: 0, suppressed: 0, failed: 0, remainingToday: 0, followUpsHeldBack: null,
  });
  assert.deepEqual(r.sent.map((message) => message.to), ["r1@r1-tel.example"]);
  assert.match(r.sent[0]!.text, /\n\nRiley Hinsperger\nAxiom · /);
  assert.deepEqual(await runFccDailySend(db, riley, monday, { cap: 1 }), { status: "SKIPPED", reason: "daily cap reached" }, "the day-7 email counts toward the day");
  const a = fakeTransport();
  await runFccDailySend(db, config(a.factory, fakeMailbox().factory), monday, { cap: 1 });
  assert.deepEqual(a.sent.map((message) => message.to), ["a1@a1-tel.example"], "Aidan's inbox sends only its own day-7 email");
  assert.deepEqual(day7Rows(raw), [
    { contactId: "a1", sendDay: "2026-11-09", status: "SENT", inbox: "" },
    { contactId: "r1", sendDay: "2026-11-09", status: "SENT", inbox: "riley@mail.example" },
  ]);
  assert.equal(statusOf(raw, "fresh"), "ready", "first emails wait behind the day's follow-ups");
});

test("new first emails from both inboxes split between the two test subjects by contact id; follow-ups answer under the same subject", async () => {
  const { raw, db } = database();
  for (let i = 1; i <= 40; i += 1) addContact(raw, `s${i}`, `p${i}@s${i}-tel.example`, { company: `Company ${i}, LLC` });
  addNov6Contact(raw, "hot", "hot@hot-tel.example");
  recordGo(raw);
  const t = fakeTransport();
  const r = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), new Date("2026-11-02T15:00:00Z"), { cap: 21 });
  await runFccDailySend(db, config(r.factory, fakeMailbox().factory, { primary: false, fromAddress: "riley@mail.example" }), new Date("2026-11-02T15:00:00Z"), { cap: 20 });
  assert.equal(t.sent[0]!.subject, "Did hot Telephone get the FCC's RMD notice?", "the November 6 email keeps its own subject");
  assert.match(t.sent[0]!.headers["Message-ID"], /^<fcc-nov6-hot-1@/);
  const firsts = [...t.sent.slice(1), ...r.sent];
  assert.equal(firsts.length, 40);
  for (const message of firsts) {
    const id = /^<fcc-(v7[ab])-(s\d+)-1@/.exec(message.headers["Message-ID"]);
    assert.ok(id, message.headers["Message-ID"]);
    assert.equal(id[1], fccSubjectTestCopy(id[2]!), "the contact id picks the subject");
    const n = id[2]!.slice(1);
    assert.equal(message.subject, id[1] === "v7a" ? `Question about Company ${n}'s RMD listing` : `Company ${n}'s FCC listing`);
  }
  const listing = firsts.filter((message) => message.headers["Message-ID"].startsWith("<fcc-v7b-")).length;
  assert.ok(listing > 10 && listing < 30, `${listing} of 40 got the listing subject`);
  for (const sent of [t.sent.slice(1), r.sent]) assert.ok(new Set(sent.map((message) => message.headers["Message-ID"].slice(0, 9))).size === 2, "each inbox sends both subjects");

  const before = { t: t.sent.length, r: r.sent.length };
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), new Date("2026-11-05T15:00:00Z"));
  await runFccDailySend(db, config(r.factory, fakeMailbox().factory, { primary: false, fromAddress: "riley@mail.example" }), new Date("2026-11-05T15:00:00Z"));
  const followUps = [...t.sent.slice(before.t), ...r.sent.slice(before.r)];
  assert.equal(followUps.length, 40);
  for (const message of followUps) {
    const original = firsts.find((first) => first.to === message.to)!;
    assert.equal(message.subject, `Re: ${original.subject}`);
    assert.equal(message.headers["Message-ID"], original.headers["Message-ID"].replace("-1@", "-2@"));
  }
});

test("a hot-list email claimed just before a crash keeps that person out of the March queue after the list closes", async () => {
  const { raw, db } = database();
  addContact(raw, "m1", "claimed@claimed-tel.example");
  addContact(raw, "m2", "other@other-tel.example");
  addNov6Contact(raw, "h1", "claimed@claimed-tel.example");
  raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status") VALUES ('crashed','h1',1,'claimed@claimed-tel.example','2026-11-05','<fcc-nov6-h1-1@mail.example>','CLAIMED')`).run();
  recordGo(raw);
  const t = fakeTransport();
  await runFccDailySend(db, config(t.factory, fakeMailbox().factory), new Date("2026-11-06T15:00:00Z"));
  assert.deepEqual(t.sent.map((message) => message.to), ["other@other-tel.example"]);
  assert.deepEqual(["h1", "m1"].map((id) => statusOf(raw, id)), ["ready", "ready"]);
});

/**
 * Two weeks of sending from the Nov 1 counts (docs/STATUS.md): 133 people first emailed from Aidan's inbox Oct 28–30
 * waiting for their day-3 follow-up, 197 on the November 6 list (Aidan's inbox sends it first, Mon–Thu), and Riley's
 * inbox starting Mon Nov 2 at 15 a day. Each inbox sends its full day (fccDailyMax) every weekday.
 */
async function simulateFccWeeks(raw: Database.Database, db: ProspectDb, days: string[]) {
  const march = [["2026-10-28", 60, "v3"], ["2026-10-29", 53, "v4"], ["2026-10-30", 20, "v4"]] as const;
  for (const [day, count, copy] of march) {
    for (let i = 0; i < count; i += 1) {
      const id = `m-${day}-${i}`;
      addContact(raw, id, `${id}@${id}.example`);
      const messageId = copy === "v3" ? `<fcc-${id}-1@mail.example>` : `<fcc-${copy}-${id}-1@mail.example>`;
      const due = new Date(`${day}T12:00:00Z`);
      due.setUTCDate(due.getUTCDate() + 3);
      raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'step1_sent', "step1SentAt" = ?, "step1MessageId" = ?, "step2DueAt" = ? WHERE "id" = ?`)
        .run(`${day}T15:00:00.000Z`, messageId, due.toISOString().slice(0, 10), id);
      raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status","createdAt") VALUES (?,?,1,?,?,?,'SENT',?)`)
        .run(`${id}-1`, id, `${id}@${id}.example`, day, messageId, `${day}T15:00:00.000Z`);
    }
  }
  for (let i = 0; i < 197; i += 1) addNov6Contact(raw, `h${i}`, `h${i}@h${i}-tel.example`);
  for (let i = 0; i < 400; i += 1) addContact(raw, `r${i}`, `r${i}@r${i}-tel.example`);
  recordGo(raw);
  const aidan = config(fakeTransport().factory, fakeMailbox().factory);
  const riley = config(fakeTransport().factory, fakeMailbox().factory, { primary: false, fromAddress: "riley@mail.example", fromName: "Riley Hinsperger" });
  const limits: Record<string, number> = {};
  for (const day of days) {
    for (const inbox of [aidan, riley]) {
      const cap = await fccDailyMax(db, inbox, 30, day);
      limits[`${day} ${inbox.primary === false ? "riley" : "aidan"}`] = cap;
      await runFccDailySend(db, inbox, new Date(`${day}T15:00:00Z`), { cap });
    }
  }
  const sends = raw.prepare(`SELECT s."sendDay" AS day, CASE WHEN s."senderAddress" IS NULL THEN 'aidan' ELSE 'riley' END AS inbox,
      CASE WHEN c."campaignKey" = ? THEN 'nov6' WHEN s."step" = 1 THEN 'first' WHEN s."step" = 2 THEN 'day3' ELSE 'day7' END AS kind, COUNT(*) AS n
    FROM "FccCampaignSend" s JOIN "FccCampaignContact" c ON c."id" = s."contactId" WHERE s."status" = 'SENT' AND s."sendDay" >= ? GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)
    .all(FCC_NOV6_CAMPAIGN_KEY, days[0]) as Array<{ day: string; inbox: string; kind: string; n: number }>;
  return { sends, limits };
}

const WEEKDAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];

test("dry run from the Nov 1 counts: the first day-7 emails go Mon Nov 9 from both inboxes, never early and never to the November 6 list", async () => {
  const { raw, db } = database();
  const { sends, limits } = await simulateFccWeeks(raw, db, WEEKDAYS);
  const count = (day: string, inbox: string, kind: string) => sends.find((row) => row.day === day && row.inbox === inbox && row.kind === kind)?.n ?? 0;
  const firstDay7 = (inbox: string) => sends.find((row) => row.inbox === inbox && row.kind === "day7")?.day;
  assert.equal(firstDay7("aidan"), "2026-11-09");
  assert.equal(firstDay7("riley"), "2026-11-09");
  // Aidan's inbox: the November 6 list Mon–Thu, so the day-3 follow-ups start Thursday and the day-7 ones 4 days later.
  assert.deepEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((day) => count(day, "aidan", "nov6")), [60, 60, 60, 17]);
  assert.deepEqual(["2026-11-05", "2026-11-06", "2026-11-09"].map((day) => count(day, "aidan", "day3")), [43, 60, 30]);
  assert.equal(count("2026-11-09", "aidan", "day7"), 30, "Thursday's 43 fall due Monday; the last day-3 follow-ups go first");
  // Riley's inbox: 15 first emails Mon–Wed, their day-3 follow-ups Thu–Mon, and Monday's people get the day-7 email on Nov 9.
  assert.deepEqual(["2026-11-02", "2026-11-03", "2026-11-04"].map((day) => count(day, "riley", "first")), [15, 15, 15]);
  assert.deepEqual(["2026-11-09"].map((day) => [count(day, "riley", "day3"), count(day, "riley", "day7")]), [[15, 15]]);

  for (const row of raw.prepare(`SELECT s3."sendDay" AS d7, s1."sendDay" AS d1, s2."sendDay" AS d2, c."campaignKey" AS key FROM "FccCampaignSend" s3
      JOIN "FccCampaignContact" c ON c."id" = s3."contactId"
      JOIN "FccCampaignSend" s1 ON s1."contactId" = s3."contactId" AND s1."step" = 1
      JOIN "FccCampaignSend" s2 ON s2."contactId" = s3."contactId" AND s2."step" = 2 WHERE s3."step" = 3`).all() as Array<{ d7: string; d1: string; d2: string; key: string }>) {
    assert.equal(row.key, FCC_CAMPAIGN_KEY);
    assert.ok(Date.parse(row.d7) - Date.parse(row.d1) >= 7 * 86_400_000 && Date.parse(row.d7) - Date.parse(row.d2) >= 4 * 86_400_000, JSON.stringify(row));
  }
  for (const [key, limit] of Object.entries(limits)) {
    const [day, inbox] = key.split(" ");
    const total = sends.filter((row) => row.day === day && row.inbox === inbox).reduce((sum, row) => sum + row.n, 0);
    assert.ok(total <= limit, `${key}: ${total} sent, limit ${limit}`);
  }
});
