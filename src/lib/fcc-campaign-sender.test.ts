import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
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

const recordGo = (raw: Database.Database, copy = FCC_CAMPAIGN_KEY) =>
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
  raw.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 1, "approvedCopy" = ?`).run(FCC_CAMPAIGN_KEY);
  assert.deepEqual(await runFccDailySend(db, config(t.factory, m.factory), MONDAY), { status: "SKIPPED", reason: "locked until a founder records the go" });
  recordGo(raw, "an-older-copy");
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
  assert.ok(t.sent.every((message) => message.text.includes(ADDRESS) && /Reply "stop"/.test(message.text)));
  assert.equal(statusOf(raw, "held"), "held");
  const first = raw.prepare(`SELECT "status","step2DueAt","step1MessageId" FROM "FccCampaignContact" WHERE "id" = 'n1'`).get() as Record<string, string>;
  assert.deepEqual(first, { status: "step1_sent", step2DueAt: "2026-10-29", step1MessageId: "<fcc-n1-1@mail.example>" });

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
    assert.match(message.subject, /^Re: Your 2026 RMD recertification$/);
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

test("the worker's weekday 10am batch runs the FCC sender next to the website batch", async () => {
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
  assert.deepEqual(runs.sort(), ["fcc", "website"]);
});
