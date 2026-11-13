import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION } from "@/lib/fcc-campaign";
import type { FccMailbox, FccSendConfig } from "@/lib/fcc-campaign-sender";
import { runFccSendTick } from "@/lib/fcc-campaign-tick";
import { addressBlocked } from "@/lib/outreach/outreach-blocked";
import { approveBatch, pauseCampaign, resumeCampaign } from "@/lib/outreach/outreach-control";
import { parseCsv } from "@/lib/outreach/outreach-csv";
import { importSql, importToDb, planImport } from "@/lib/outreach/outreach-import";
import { inboxDayMax, inboxRef } from "@/lib/outreach/outreach-inboxes";
import { readCampaign, readInboxes, type Inbox } from "@/lib/outreach/outreach-model";
import { addBusinessDays, runOutreachTick, type OutreachInboxConfig, type OutreachTickResult } from "@/lib/outreach/outreach-sender";
import { batchReview } from "@/lib/outreach/outreach-status";
import { findLink, parseStepText, renderEmail, wordsVersion, type CampaignWords } from "@/lib/outreach/outreach-words";
import { PermanentEmailError, type OutgoingEmail } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

const ADDRESS = "257 Example St, Kitchener, ON N2C 0A0, Canada";
const AIDAN = "aidanmageebusiness@gmail.com";
const RILEY = "rileyhinspergerbusiness@gmail.com";
const MINUTE = 60_000;
// Mon Nov 9, 2026 is winter time: 9:00 Toronto is 14:00 UTC.
const MON_9AM = Date.parse("2026-11-09T14:00:00Z");
const HEADERS = "email,first_name,title,city,state,population,website,contact_page,verified,error_count,worst_problem,pdf_date,pdf_url,scan_date";

const FIRST = `Subject: {city}'s website: {error_count} accessibility errors before the April 2027 deadline

Hi {first_name},

We ran a free check of {city}'s website against WCAG 2.1 AA. It found {error_count} errors. The biggest: {worst_problem}. Your {pdf_date} agenda PDF also can't be read by a screen reader.

Would the full report be useful? It's free either way.

{sender_name}, Axiom`;
const FOLLOW = `Hi {first_name}, just checking you saw my note about {city}'s website. Happy to send the full report.

{sender_first_name}`;

const words = (): CampaignWords => ({ steps: [parseStepText(FIRST, 1), parseStepText(FOLLOW, 2)] });

function cityRow(i: number, overrides: Partial<Record<string, string>> = {}) {
  const row: Record<string, string> = {
    email: `clerk${i}@city${i}.gov`, first_name: `Pat${i}`, title: "City Clerk", city: `Springfield ${i}`, state: "OR", population: "60,000",
    website: `https://city${i}.gov`, contact_page: `https://city${i}.gov/contact`, verified: "yes", error_count: String(100 + i),
    worst_problem: "images have no text description", pdf_date: "Oct 21", pdf_url: `https://city${i}.gov/a.pdf`, scan_date: "2026-11-07", ...overrides,
  };
  return HEADERS.split(",").map((column) => `"${(row[column] ?? "").replace(/"/g, '""')}"`).join(",");
}
const csvOf = (count: number, overrides: (i: number) => Partial<Record<string, string>> = () => ({})) =>
  [HEADERS, ...Array.from({ length: count }, (_, index) => cityRow(index + 1, overrides(index + 1)))].join("\n");

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
  return { raw, db };
}

async function setUpCities(raw: Database.Database, db: ProspectDb, options: { rows?: number; approve?: boolean; live?: boolean; csv?: string } = {}) {
  const w = words();
  raw.prepare(`UPDATE "OutreachCampaign" SET "wordsJson" = ?, "wordsVersion" = ? WHERE "key" = 'us-cities'`).run(JSON.stringify(w), wordsVersion(w));
  const campaign = (await readCampaign(db, "us-cities"))!;
  let ids = 0;
  const plan = planImport(campaign, options.csv ?? csvOf(options.rows ?? 40), {
    batchId: "batch-1", name: "Cities batch 1", loadedBy: "Riley's Claude", now: new Date("2026-11-07T15:00:00Z"), newId: () => `contact-${++ids}`,
    sender: { name: "Aidan Magee", address: AIDAN }, mailingAddress: ADDRESS,
  });
  assert.deepEqual(plan.errors, []);
  await importToDb(db, plan);
  if (options.approve !== false) assert.deepEqual(await approveBatch(db, "batch-1", "Aidan", null, new Date("2026-11-08T20:00:00Z")), { ok: true });
  if (options.live !== false) assert.equal((await resumeCampaign(db, "us-cities", "Riley", new Date("2026-11-08T21:00:00Z"))).result, "RESUMED");
  return plan;
}

function fakeInbox(state: { bounced?: string[]; replied?: string[]; warning?: string | null; refuse?: (message: OutgoingEmail) => Error | null } = {}) {
  const sent: Array<OutgoingEmail & { at: number; from: string }> = [];
  let clock = 0;
  const mailbox = async (): Promise<FccMailbox> => ({
    async hasMessagesFrom(patterns) { return patterns.some((pattern) => (state.replied ?? []).some((email) => email === pattern || email.endsWith(pattern))); },
    async hasBounceFor(email) { return (state.bounced ?? []).includes(email); },
    async bounceCount() { return (state.bounced ?? []).filter((email) => sent.some((send) => send.to === email)).length; },
    async bouncedAmong(emails) { return emails.filter((email) => (state.bounced ?? []).includes(email)); },
    async googleWarning() { return state.warning ?? null; },
    async close() {},
  });
  const transport = (from: string) => async () => ({
    async send(message: OutgoingEmail) { const error = state.refuse?.(message); if (error) throw error; sent.push({ ...message, at: clock, from }); },
    async close() {},
  });
  return { sent, mailbox, transport, setClock: (at: number) => { clock = at; }, advance: (ms: number) => { clock += ms; }, now: () => clock };
}

async function harness(db: ProspectDb, fake: ReturnType<typeof fakeInbox>, withFcc = false) {
  let ids = 0;
  const inboxes = await readInboxes(db);
  const outreach = (inbox: Inbox): OutreachInboxConfig => ({
    inbox, ref: inboxRef(inbox.address, AIDAN), sender: { name: inbox.name, address: inbox.address }, mailingAddress: ADDRESS,
    transport: fake.transport(inbox.address), mailbox: fake.mailbox, newId: () => `send-${++ids}`,
  });
  const fcc = (address: string, primary: boolean): FccSendConfig => ({
    fromAddress: address, fromName: primary ? "Aidan Magee" : "Riley Hinsperger", primary, mailingAddress: ADDRESS, newId: () => `fcc-send-${++ids}`,
    transport: fake.transport(address), mailbox: fake.mailbox,
  });
  /** One minute of the Worker's send cron for every inbox: campaigns first, FCC only if no campaign email went. */
  const minute = async (at: number) => {
    const results: Record<string, { campaign: OutreachTickResult; fcc?: unknown }> = {};
    for (const inbox of inboxes) {
      fake.setClock(at);
      const options = { wait: async (ms: number) => { fake.advance(ms); }, random: () => 0.5 };
      const campaign = await runOutreachTick(db, outreach(inbox), new Date(at), options);
      let fccResult: unknown;
      if (withFcc && campaign.status !== "SENT") {
        fake.setClock(at);
        fccResult = await runFccSendTick(db, fcc(inbox.address, inbox.address === AIDAN), new Date(at), options);
      }
      results[inbox.address] = { campaign, fcc: fccResult };
    }
    return results;
  };
  const run = async (from: number, to: number) => { for (let at = from; at < to; at += MINUTE) await minute(at); };
  return { minute, run, inboxes };
}

function addFccContacts(raw: Database.Database, count: number) {
  raw.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 1, "approvedCopy" = ?, "goBy" = 'Aidan', "goAt" = '2026-11-05T05:02:40Z' WHERE "id" = 1`).run(FCC_COPY_VERSION);
  for (let i = 1; i <= count; i += 1) {
    const at = new Date(Date.UTC(2026, 9, 26, 23, 0, 0) + i * 1000).toISOString();
    raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","createdAt","updatedAt")
      VALUES (?,?,?,?,?,?,?,1,'ready',?,?)`).run(`f${i}`, FCC_CAMPAIGN_KEY, `person${i}@co${i}.example`, "Jane", `Co ${i}`,
      JSON.stringify([{ company: `Co ${i}`, companyShort: `Co ${i}`, rmdNumber: `RMD${i}`, state: "IA", lastFilingDate: "2024-03-29", filingUrl: "https://example.test" }]), "named", at, at);
  }
}

const count = (raw: Database.Database, sql: string, ...binds: unknown[]) => Number((raw.prepare(sql).get(...binds) as { n: number }).n);

test("CSV: quotes, commas and line breaks inside quotes, a byte-order mark and any column names", () => {
  const table = parseCsv('﻿Email,First Name,"Worst problem"\r\n"a@b.gov","Pat","Images, ""no alt""\nand more"\r\n\r\nc@d.gov,Sam,x\n');
  assert.deepEqual(table.columns, ["email", "first_name", "worst_problem"]);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0]!.worst_problem, 'Images, "no alt"\nand more');
  assert.throws(() => parseCsv("email,email\na,b"), /twice/);
});

test("words: blanks fill from the row, the engine adds the footer, the follow-up answers under the first subject", () => {
  const fields = parseCsv(`${HEADERS}
${cityRow(3)}`).rows[0]!;
  const sender = { name: "Aidan Magee", address: AIDAN };
  const first = renderEmail(words(), 1, fields, sender, ADDRESS, { noLinksInFirst: true });
  assert.ok(first.ok);
  assert.equal(first.email.subject, "Springfield 3's website: 103 accessibility errors before the April 2027 deadline");
  assert.match(first.email.text, /^Hi Pat3,/);
  assert.match(first.email.text, /Aidan Magee, Axiom\n\nAxiom · 257 Example St, Kitchener, ON N2C 0A0, Canada\nNot useful\? Reply "no thanks" and we won't email you again\.$/);
  const follow = renderEmail(words(), 2, fields, sender, ADDRESS, { firstSubject: first.email.subject });
  assert.ok(follow.ok);
  assert.equal(follow.email.subject, `Re: ${first.email.subject}`);
  assert.match(follow.email.text, /\n\nAidan\n\nAxiom · 257/);
  assert.equal(findLink(first.email.text), null, "no link in the first email, footer included");
  const blank = renderEmail(words(), 1, { ...fields, worst_problem: " " }, sender, ADDRESS);
  assert.deepEqual(blank, { ok: false, reason: "Blank {worst_problem} in this row" });
  const linked = renderEmail({ steps: [{ subject: "Hi", body: "See {website}" }] }, 1, fields, sender, ADDRESS, { noLinksInFirst: true });
  assert.equal(linked.ok, false);
  assert.match((linked as { reason: string }).reason, /link or web address/);
  assert.equal(findLink("visit springfield.gov today"), "springfield.gov");
  assert.equal(findLink("WCAG 2.1 AA, U.S. cities, St. Louis"), null);
  assert.equal(renderEmail(words(), 1, fields, sender, "").ok, false, "no mailing address, no email");
});

test("loading a list holds every row that can't go, with the reason, and skips an address already in the campaign", async () => {
  const { raw, db } = database();
  const csv = csvOf(8, (i) => i === 2 ? { verified: "no" } : i === 3 ? { worst_problem: "" } : i === 4 ? { email: "not-an-email" }
    : i === 5 ? { email: "clerk1@city1.gov" } : i === 6 ? { pdf_date: "see https://x.gov" } : {});
  raw.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES ('clerk7@city7.gov','UNSUBSCRIBED')`).run();
  await setUpCities(raw, db, { csv, approve: false, live: false });
  const rows = raw.prepare(`SELECT "rowNumber","status","holdReason" FROM "OutreachContact" ORDER BY "rowNumber"`).all() as Array<{ rowNumber: number; status: string; holdReason: string | null }>;
  assert.deepEqual(rows.map((row) => [row.rowNumber, row.status]), [[2, "ready"], [3, "held"], [4, "held"], [5, "held"], [6, "held"], [7, "held"], [8, "held"], [9, "ready"]]);
  assert.match(rows[1]!.holdReason!, /Not verified \(verified is "no"\)/);
  assert.match(rows[2]!.holdReason!, /Blank \{worst_problem\}/);
  assert.match(rows[3]!.holdReason!, /not a valid email address/);
  assert.match(rows[4]!.holdReason!, /Same email address as row 2/);
  assert.match(rows[5]!.holdReason!, /link or web address/);
  assert.match(rows[6]!.holdReason!, /do-not-email list/);
  const batch = raw.prepare(`SELECT "rows","ready","held","status" FROM "OutreachBatch"`).get();
  assert.deepEqual(batch, { rows: 8, ready: 2, held: 6, status: "waiting" });
  // The same file again as a second batch: every address is already in the campaign, so nothing is added.
  const campaign = (await readCampaign(db, "us-cities"))!;
  let ids = 100;
  const again = planImport(campaign, csvOf(2), { batchId: "batch-2", name: "Again", loadedBy: "Riley", now: new Date(), newId: () => `c-${++ids}`, sender: { name: "Aidan Magee", address: AIDAN }, mailingAddress: ADDRESS });
  const result = await importToDb(db, again);
  assert.deepEqual(result, { rows: 0, ready: 0, held: 0, skipped: 2 });
  // The SQL file route loads the same thing and can be run twice.
  const { raw: raw2, db: db2 } = database();
  const w = words();
  raw2.prepare(`UPDATE "OutreachCampaign" SET "wordsJson" = ?, "wordsVersion" = ? WHERE "key" = 'us-cities'`).run(JSON.stringify(w), wordsVersion(w));
  const plan2 = planImport((await readCampaign(db2, "us-cities"))!, csv, { batchId: "b", name: "Cities batch 1", loadedBy: "Riley's Claude", now: new Date(), newId: () => `id-${++ids}`, sender: { name: "Aidan Magee", address: AIDAN }, mailingAddress: ADDRESS });
  raw2.exec(importSql(plan2));
  raw2.exec(importSql(plan2));
  assert.equal(count(raw2, `SELECT COUNT(*) AS n FROM "OutreachContact"`), 8);
});

test("nothing sends before Aidan approves, while paused, or on words other than the ones he approved", async () => {
  const { raw, db } = database();
  await setUpCities(raw, db, { rows: 20, approve: false });
  const fake = fakeInbox();
  const { run } = await harness(db, fake);
  await run(MON_9AM, MON_9AM + 20 * MINUTE);
  assert.equal(fake.sent.length, 0, "a waiting batch never sends");
  assert.deepEqual(await approveBatch(db, "batch-1", "Riley", null), { ok: false, why: "Only Aidan can approve this campaign's batches." });
  assert.deepEqual(await approveBatch(db, "batch-1", "Aidan", "Looked at the 10 samples"), { ok: true });
  await pauseCampaign(db, "us-cities", "Paused from the screen", "Riley");
  await run(MON_9AM + 20 * MINUTE, MON_9AM + 40 * MINUTE);
  assert.equal(fake.sent.length, 0, "a paused campaign never sends");
  await resumeCampaign(db, "us-cities", "Riley");
  // New words for the campaign: the batch keeps the words it was loaded and approved with.
  const changed: CampaignWords = { steps: [{ ...words().steps[0]!, body: `${words().steps[0]!.body}\n\nP.S. new line` }, words().steps[1]!] };
  raw.prepare(`UPDATE "OutreachCampaign" SET "wordsJson" = ?, "wordsVersion" = ? WHERE "key" = 'us-cities'`).run(JSON.stringify(changed), wordsVersion(changed));
  await run(MON_9AM + 40 * MINUTE, MON_9AM + 60 * MINUTE);
  assert.ok(fake.sent.length > 0, "the approved batch sends");
  assert.ok(fake.sent.every((mail) => !/P\.S\. new line/.test(mail.text)), "on exactly the words Aidan approved");
  // A batch from before batches kept their own words follows the campaign's: changed words lock it until approved again.
  raw.prepare(`UPDATE "OutreachBatch" SET "wordsJson" = NULL, "wordsVersion" = NULL WHERE "id" = 'batch-1'`).run();
  const before = fake.sent.length;
  await run(MON_9AM + 60 * MINUTE, MON_9AM + 80 * MINUTE);
  assert.equal(fake.sent.length, before, "changed words lock an older batch");
  assert.deepEqual(await approveBatch(db, "batch-1", "Aidan", null), { ok: true });
  await run(MON_9AM + 80 * MINUTE, MON_9AM + 100 * MINUTE);
  assert.ok(fake.sent.length > before);
  assert.match(fake.sent.at(-1)!.text, /P\.S\. new line/);
});

test("two batches of one campaign carry different words (B without the PDF sentence): each is approved on its own samples and sent with its own words, inside the same 30 a day", async () => {
  const { raw, db } = database();
  await setUpCities(raw, db, { rows: 20 }); // batch-1: words A, approved, campaign live
  const sentenceA = " Your {pdf_date} agenda PDF also can't be read by a screen reader.";
  assert.ok(FIRST.includes(sentenceA));
  const wordsB: CampaignWords = { steps: [parseStepText(FIRST.replace(sentenceA, ""), 1), parseStepText(FOLLOW, 2)] };
  const csvB = [HEADERS, ...Array.from({ length: 15 }, (_, k) => cityRow(21 + k, { pdf_date: "", pdf_url: "" }))].join("\n");
  let ids = 1000;
  const planB = planImport({ ...(await readCampaign(db, "us-cities"))!, words: wordsB }, csvB, {
    batchId: "batch-2", name: "Cities batch B1", loadedBy: "Riley's Claude", now: new Date("2026-11-07T16:00:00Z"), newId: () => `b-contact-${++ids}`,
    sender: { name: "Aidan Magee", address: AIDAN }, mailingAddress: ADDRESS,
  });
  assert.deepEqual(planB.errors, []);
  assert.equal(planB.contacts.filter((contact) => contact.status === "ready").length, 15, "blank PDF fields don't hold B rows: B's words don't use them");
  await importToDb(db, planB);
  const review = await batchReview(db, "batch-2", ADDRESS, 10);
  assert.ok(review!.samples.every((sample) => sample.first && !/agenda PDF/.test(sample.first.text)), "B's samples are written with B's words");
  assert.ok((await batchReview(db, "batch-1", ADDRESS, 10))!.samples.every((sample) => /agenda PDF/.test(sample.first!.text)), "A's keep A's");

  const fake = fakeInbox();
  const { run } = await harness(db, fake);
  await run(MON_9AM, MON_9AM + 90 * MINUTE);
  assert.equal(fake.sent.length, 20, "only A sends while B waits for its approval");
  assert.deepEqual(await approveBatch(db, "batch-2", "Aidan", "Read the 10 B samples"), { ok: true });
  await run(MON_9AM + 90 * MINUTE, MON_9AM + 330 * MINUTE);
  assert.equal(fake.sent.length, 30, "A and B share the campaign's 30 a day");
  const toB = fake.sent.filter((mail) => /clerk(2[1-9]|3[0-5])@/.test(mail.to));
  assert.equal(toB.length, 10);
  assert.ok(toB.every((mail) => !/agenda PDF/.test(mail.text)), "B rows get B's words");
  assert.ok(fake.sent.filter((mail) => !toB.includes(mail)).every((mail) => /Oct 21 agenda PDF/.test(mail.text)), "A rows get A's");
});

test("Mon Nov 9: 30 city emails from 9:00 in Aidan's inbox, then FCC in the afternoon; the inbox never passes 60 and never sends two within a minute", async () => {
  const { raw, db } = database();
  await setUpCities(raw, db, { rows: 40 });
  addFccContacts(raw, 100);
  // Riley's inbox first sent FCC emails on Nov 2 (as live), so this is its second week: 30 a day.
  raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status","createdAt","senderAddress") VALUES ('old','f100',1,'person100@co100.example','2026-11-02','<old>','SENT','2026-11-02T15:00:00.000Z',?)`).run(RILEY);
  raw.prepare(`UPDATE "FccCampaignContact" SET "status" = 'step1_sent' WHERE "id" = 'f100'`).run();
  const fake = fakeInbox();
  const { run } = await harness(db, fake, true);
  await run(MON_9AM, MON_9AM + 6 * 60 * MINUTE);
  const aidan = fake.sent.filter((send) => send.from === AIDAN);
  const cities = aidan.filter((send) => send.to.endsWith(".gov"));
  const fcc = aidan.filter((send) => !send.to.endsWith(".gov"));
  assert.equal(cities.length, 30, "30 a day for cities");
  assert.ok(cities.every((send) => send.at < MON_9AM + 120 * MINUTE), "the city emails all go in the morning");
  assert.ok(Math.min(...cities.map((send) => send.at)) < MON_9AM + 2 * MINUTE, "the first one goes at 9:00");
  assert.ok(fcc.every((send) => send.at >= Date.parse("2026-11-09T17:30:00Z")), "FCC waits until 12:30, after the morning half went to cities");
  assert.equal(fcc.length, 30, "FCC gets the rest of the inbox's 60");
  assert.equal(aidan.length, 60, "the inbox's day is 60, all campaigns together");
  const times = aidan.map((send) => send.at).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i]! - times[i - 1]! >= 50_000, `two emails ${times[i]! - times[i - 1]!} ms apart`);
  // Riley's inbox is in its second week (30 a day) and FCC uses it alone: 15 in the morning, 15 after 12:30.
  const riley = fake.sent.filter((send) => send.from === RILEY);
  assert.equal(riley.length, 30);
  assert.ok(riley.every((send) => !send.to.endsWith(".gov")), "cities don't use Riley's inbox before the Nov 13 review");
  // The city emails: plain text, no links, the engine's footer, in CSV order.
  assert.ok(cities.every((send) => !send.html && findLink(send.text.split("\n\nAxiom · ")[0]!) === null));
  assert.equal(cities[0]!.to, "clerk1@city1.gov");
  assert.equal(cities[0]!.headers["Message-ID"], "<ax-us-cities-contact-1-1@gmail.com>");
  assert.equal(count(raw, `SELECT COUNT(*) AS n FROM "OutreachContact" WHERE "status" = 'sent' AND "nextDueDay" = '2026-11-16'`), 30, "follow-up due 5 business days later");
});

test("the follow-up goes 5 business days later in the same thread from the same inbox, and a reply or bounce stops it for good", async () => {
  const { raw, db } = database();
  await setUpCities(raw, db, { rows: 4 });
  const fake = fakeInbox();
  const first = await harness(db, fake);
  await first.run(MON_9AM, MON_9AM + 30 * MINUTE);
  assert.equal(fake.sent.length, 4);
  fake.sent.length = 0;
  // Fri Nov 13 is only 4 business days later: nothing yet.
  await first.run(Date.parse("2026-11-13T14:00:00Z"), Date.parse("2026-11-13T14:30:00Z"));
  assert.equal(fake.sent.length, 0);
  assert.equal(addBusinessDays("2026-11-09", 5), "2026-11-16");
  // Someone at city2 replied (a colleague), city3 bounced late; Mon Nov 16 the other two get their follow-up.
  const later = fakeInbox({ replied: ["it@city2.gov"], bounced: ["clerk3@city3.gov"] });
  const second = await harness(db, later);
  await second.run(Date.parse("2026-11-16T14:00:00Z"), Date.parse("2026-11-16T15:00:00Z"));
  assert.deepEqual(later.sent.map((send) => send.to).sort(), ["clerk1@city1.gov", "clerk4@city4.gov"]);
  const follow = later.sent.find((send) => send.to === "clerk1@city1.gov")!;
  assert.match(follow.subject, /^Re: Springfield 1's website/);
  assert.equal(follow.headers["In-Reply-To"], "<ax-us-cities-contact-1-1@gmail.com>");
  assert.equal(follow.from, AIDAN);
  const statuses = Object.fromEntries((raw.prepare(`SELECT "email","status" FROM "OutreachContact"`).all() as Array<{ email: string; status: string }>).map((row) => [row.email, row.status]));
  assert.deepEqual(statuses, { "clerk1@city1.gov": "done", "clerk2@city2.gov": "replied", "clerk3@city3.gov": "bounced", "clerk4@city4.gov": "done" });
  assert.ok(await addressBlocked(db, "clerk3@city3.gov"), "a bounce is on the do-not-email list for every campaign and FCC");
  // Nothing more ever goes to anyone: done, replied and bounced are final.
  await second.run(Date.parse("2026-11-23T14:00:00Z"), Date.parse("2026-11-23T15:00:00Z"));
  assert.equal(later.sent.length, 2);
});

test("a Google warning, 3 bounces in a day or a refused send pauses the campaign until a founder resumes it", async () => {
  {
    const { raw, db } = database();
    await setUpCities(raw, db, { rows: 10 });
    const fake = fakeInbox({ warning: "Google sent a critical security alert" });
    const { minute } = await harness(db, fake);
    const result = await minute(MON_9AM);
    assert.equal(result[AIDAN]!.campaign.status, "PAUSED");
    assert.equal(fake.sent.length, 0);
    const campaign = await readCampaign(db, "us-cities");
    assert.equal(campaign!.state, "paused");
    assert.match(campaign!.stateReason!, /Aidan's inbox: Google sent a critical security alert/);
  }
  {
    const { raw, db } = database();
    await setUpCities(raw, db, { rows: 10 });
    const bouncing = ["clerk1@city1.gov", "clerk2@city2.gov", "clerk3@city3.gov"];
    const fake = fakeInbox({ refuse: (message) => (bouncing.includes(message.to) ? new PermanentEmailError("550 5.1.1 no such user") : null) });
    const { run } = await harness(db, fake);
    await run(MON_9AM, MON_9AM + 30 * MINUTE);
    assert.equal(fake.sent.length, 0, "three bounces in a row, then the pause");
    assert.equal((await readCampaign(db, "us-cities"))!.state, "paused");
    assert.equal(count(raw, `SELECT COUNT(*) AS n FROM "EngineEmailSuppression" WHERE "reason" = 'BOUNCED'`), 3);
  }
  {
    const { raw, db } = database();
    await setUpCities(raw, db, { rows: 10 });
    const fake = fakeInbox({ refuse: () => new Error("421 4.7.0 Try again later") });
    const { minute } = await harness(db, fake);
    await minute(MON_9AM);
    const campaign = await readCampaign(db, "us-cities");
    assert.equal(campaign!.state, "paused");
    assert.match(campaign!.stateReason!, /Gmail refused an email/);
  }
});

test("a city that bounced or said no thanks is never emailed by FCC or any campaign", async () => {
  const { raw, db } = database();
  await setUpCities(raw, db, { rows: 3 });
  raw.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES ('clerk2@city2.gov','UNSUBSCRIBED')`).run();
  const fake = fakeInbox();
  const { run } = await harness(db, fake);
  await run(MON_9AM, MON_9AM + 20 * MINUTE);
  assert.deepEqual(fake.sent.map((send) => send.to), ["clerk1@city1.gov", "clerk3@city3.gov"]);
  assert.equal((raw.prepare(`SELECT "status" FROM "OutreachContact" WHERE "email" = 'clerk2@city2.gov'`).get() as { status: string }).status, "held");
});

test("inbox limits: Riley's inbox ramps 15, 30, then 60; a lowered limit on the settings row binds FCC too", async () => {
  const { db, raw } = database();
  const riley = (await readInboxes(db)).find((inbox) => inbox.address === RILEY)!;
  assert.equal(inboxDayMax(riley, "2026-11-06"), 15);
  assert.equal(inboxDayMax(riley, "2026-11-09"), 30);
  assert.equal(inboxDayMax(riley, "2026-11-16"), 60);
  // Aidan's inbox lowered to 20: FCC sends 10 in the morning and 20 in the day, no more.
  raw.prepare(`UPDATE "OutreachInbox" SET "dailyMax" = 20 WHERE "address" = ?`).run(AIDAN);
  addFccContacts(raw, 50);
  const fake = fakeInbox();
  const { run } = await harness(db, fake, true);
  await run(MON_9AM, MON_9AM + 6 * 60 * MINUTE);
  assert.equal(fake.sent.filter((send) => send.from === AIDAN).length, 20);
});

test("the hourly reply check reads every inbox, stops whoever wrote back, puts a no thanks on the do-not-email list and tells both founders once", async () => {
  const { raw, db } = database();
  await setUpCities(raw, db, { rows: 4 });
  const fake = fakeInbox();
  await (await harness(db, fake)).run(MON_9AM, MON_9AM + 30 * MINUTE);
  assert.equal(fake.sent.length, 4);
  // The sender stamps firstSentAt with the real clock after each send; pin it to the simulated Monday morning,
  // or every reply below (Mon Nov 9) counts as older than the email and is skipped once that day has passed.
  raw.prepare(`UPDATE "OutreachContact" SET "firstSentAt" = ? WHERE "firstSentAt" IS NOT NULL`).run(new Date(MON_9AM).toISOString());
  const messages = [
    { folder: "[Gmail]/All Mail", uid: 11, from: "clerk1@city1.gov", date: "2026-11-09T18:00:00.000Z", automatic: false, text: "Yes please, send the full report." },
    { folder: "[Gmail]/All Mail", uid: 12, from: "it@city2.gov", date: "2026-11-09T19:00:00.000Z", automatic: false, text: "Not interested, thanks." },
    { folder: "[Gmail]/All Mail", uid: 13, from: "clerk3@city3.gov", date: "2026-11-09T19:30:00.000Z", automatic: true, text: "I'm out of the office until Monday." },
    { folder: "[Gmail]/All Mail", uid: 14, from: "someone@else.org", date: "2026-11-09T19:40:00.000Z", automatic: false, text: "Unrelated" },
  ];
  // The reply to the city came to Riley's inbox, which never emailed it: it is still found.
  const inbox = (list: typeof messages) => async () => ({
    async messagesSince() { return list.map(({ folder, uid, from, date, automatic }) => ({ folder, uid, from, date, automatic })); },
    async replyText(message: { uid: number }) { return list.find((item) => item.uid === message.uid)!.text; },
    async close() {},
  });
  const told: Array<{ subject: string; text: string }> = [];
  let fail = true;
  const config = {
    screenUrl: "https://operations.getaxiom.ca/campaigns",
    inboxes: [{ address: AIDAN, open: inbox([]) }, { address: RILEY, open: inbox(messages) }],
    tellFounders: async (mail: { subject: string; text: string }) => { if (fail) throw new Error("mail down"); told.push(mail); },
  };
  const { runOutreachReplyCheck } = await import("@/lib/outreach/outreach-replies");
  await assert.rejects(runOutreachReplyCheck(db, config, new Date("2026-11-09T20:05:00Z")), /mail down/);
  const statuses = Object.fromEntries((raw.prepare(`SELECT "email","status" FROM "OutreachContact"`).all() as Array<{ email: string; status: string }>).map((row) => [row.email, row.status]));
  assert.deepEqual(statuses, { "clerk1@city1.gov": "replied", "clerk2@city2.gov": "suppressed", "clerk3@city3.gov": "replied", "clerk4@city4.gov": "sent" });
  assert.ok(await addressBlocked(db, "clerk2@city2.gov"), "a colleague's no thanks stops the whole organisation");
  assert.ok(await addressBlocked(db, "it@city2.gov"));
  assert.equal(await addressBlocked(db, "clerk1@city1.gov"), false, "an interested reply is not a no");
  // The email failed, so the next hour tells them, once, with both real replies and not the automatic one.
  fail = false;
  const result = await runOutreachReplyCheck(db, config, new Date("2026-11-09T21:05:00Z"));
  assert.equal(result.status, "RAN");
  assert.equal(told.length, 1);
  assert.equal(told[0]!.subject, "Campaigns: 2 new replies");
  assert.match(told[0]!.text, /Springfield 1 \(clerk1@city1\.gov\)/);
  assert.match(told[0]!.text, /"Yes please, send the full report\."/);
  assert.match(told[0]!.text, /It came to rileyhinspergerbusiness@gmail\.com; answer from aidanmageebusiness@gmail\.com, which sent the email\./);
  assert.match(told[0]!.text, /said no thanks: never emailed again/);
  assert.doesNotMatch(told[0]!.text, /out of the office/);
  await runOutreachReplyCheck(db, config, new Date("2026-11-09T22:05:00Z"));
  assert.equal(told.length, 1, "nobody is reported twice");
  assert.deepEqual((await runOutreachReplyCheck(db, config, new Date("2026-11-09T22:20:00Z"))).status, "SKIPPED", "once an hour");
});

test("loading checks that every domain takes mail: no mail server, a null MX or no such domain holds the row; a lookup that keeps failing stops the load", async () => {
  const { checkMailServers } = await import("@/lib/outreach/outreach-mail-servers");
  const calls: string[] = [];
  const answers: Record<string, unknown> = {
    "city1.gov": { Status: 0, Answer: [{ type: 15, data: "10 mail.city1.gov." }] },
    "city2.gov": { Status: 0, Answer: [] },
    "city3.gov": { Status: 0, Answer: [{ type: 15, data: "0 ." }] },
    "city4.gov": { Status: 3 },
    "city5.gov": { Status: 2 },
    "city6.gov": { Status: 0, Answer: [{ type: 5, data: "alias.city6.gov." }, { type: 15, data: "5 mx.city6.gov." }] },
  };
  const fakeFetch = async (url: string) => {
    const name = new URL(url).searchParams.get("name")!;
    calls.push(name);
    if (name === "city7.gov") throw new Error("network down");
    return new Response(JSON.stringify(answers[name]), { status: 200 });
  };
  const check = await checkMailServers(["city1.gov", "CITY1.gov", "city2.gov", "city3.gov", "city4.gov", "city5.gov", "city6.gov"], { fetch: fakeFetch });
  assert.deepEqual([...check.noMailServer].sort(), [["city2.gov", "has no mail server"], ["city3.gov", "takes no mail (null MX)"], ["city4.gov", "doesn't exist"], ["city5.gov", "has no working mail server (DNS error)"]]);
  assert.deepEqual(check.unreadable, []);
  assert.equal(calls.filter((name) => name === "city1.gov").length, 1, "each domain is looked up once");
  assert.equal(calls.filter((name) => name === "city5.gov").length, 3, "a DNS error is tried three times");
  assert.deepEqual((await checkMailServers(["city7.gov"], { fetch: fakeFetch })).unreadable, ["city7.gov"]);
  // The rows of a domain without a mail server are held with the reason; the rest are ready.
  const { raw, db } = database();
  const w = words();
  raw.prepare(`UPDATE "OutreachCampaign" SET "wordsJson" = ?, "wordsVersion" = ? WHERE "key" = 'us-cities'`).run(JSON.stringify(w), wordsVersion(w));
  let ids = 0;
  const plan = planImport((await readCampaign(db, "us-cities"))!, csvOf(3), { batchId: "b", name: "Cities batch 1", loadedBy: "Riley's Claude", now: new Date(),
    newId: () => `id-${++ids}`, sender: { name: "Aidan Magee", address: AIDAN }, mailingAddress: ADDRESS, noMailServer: check.noMailServer });
  assert.deepEqual(plan.contacts.map((contact) => [contact.email, contact.status, contact.holdReason]), [
    ["clerk1@city1.gov", "ready", null],
    ["clerk2@city2.gov", "held", "city2.gov has no mail server, so the email would bounce"],
    ["clerk3@city3.gov", "held", "city3.gov takes no mail (null MX), so the email would bounce"],
  ]);
});

test("a city bounce never pauses FCC: 3 city bounces pause cities only, Aidan's inbox sends nothing more that day, and FCC sends from it again the next day", async () => {
  const { raw, db } = database();
  await setUpCities(raw, db, { rows: 12 });
  addFccContacts(raw, 120);
  const bouncing = ["clerk1@city1.gov", "clerk2@city2.gov", "clerk3@city3.gov"];
  const fake = fakeInbox({ refuse: (message) => (bouncing.includes(message.to) ? new PermanentEmailError("550 5.1.1 no such user") : null) });
  const { run } = await harness(db, fake, true);
  await run(MON_9AM, MON_9AM + 6 * 60 * MINUTE);
  const city = (await readCampaign(db, "us-cities"))!;
  assert.equal(city.state, "paused");
  assert.match(city.stateReason!, /3 of its emails bounced today/);
  assert.equal(count(raw, `SELECT "enabled" AS n FROM "FccCampaignSetting" WHERE "id" = 1`), 1, "FCC is not paused");
  assert.equal(fake.sent.filter((mail) => mail.from === AIDAN).length, 0, "Aidan's inbox rests for the day after its 3rd bounce");
  assert.ok(fake.sent.filter((mail) => mail.from === RILEY).length > 0, "Riley's inbox had no bounces and kept sending FCC");
  // Tuesday: FCC sends from Aidan's inbox again; the cities stay paused until a founder resumes them.
  const before = fake.sent.length;
  await run(MON_9AM + 24 * 60 * MINUTE, MON_9AM + 30 * 60 * MINUTE);
  const tuesday = fake.sent.slice(before);
  assert.ok(tuesday.filter((mail) => mail.from === AIDAN).length > 0);
  assert.ok(tuesday.every((mail) => !mail.to.endsWith(".gov")), "no city email while the cities are paused");
});

test("bounces from cities and FCC together: the inbox rests for the rest of the day, nobody is paused, and both send again the next day", async () => {
  const { raw, db } = database();
  await setUpCities(raw, db, { rows: 15 });
  raw.prepare(`UPDATE "OutreachCampaign" SET "dailyLimit" = 5, "inboxesJson" = ? WHERE "key" = 'us-cities'`).run(JSON.stringify([{ address: AIDAN, perDay: 5 }]));
  addFccContacts(raw, 120);
  const bouncing = ["clerk1@city1.gov", "clerk2@city2.gov", "person1@co1.example"];
  const refused: Array<{ to: string; at: number }> = [];
  const fake = fakeInbox({ refuse: (message) => {
    if (!bouncing.includes(message.to)) return null;
    refused.push({ to: message.to, at: fake.now() });
    return new PermanentEmailError("550 5.1.1 no such user");
  } });
  const { run } = await harness(db, fake, true);
  await run(MON_9AM, MON_9AM + 6 * 60 * MINUTE);
  assert.equal((await readCampaign(db, "us-cities"))!.state, "live", "2 city bounces don't pause the cities");
  assert.equal(count(raw, `SELECT "enabled" AS n FROM "FccCampaignSetting" WHERE "id" = 1`), 1, "1 FCC bounce doesn't pause FCC");
  const fromAidan = fake.sent.filter((mail) => mail.from === AIDAN);
  assert.equal(fromAidan.filter((mail) => mail.to.endsWith(".gov")).length, 5, "the cities' 5 for the day (two bounced, so rows 3 to 7)");
  assert.deepEqual(refused.map((row) => row.to).sort(), [...bouncing].sort(), "all three bounced from Aidan's inbox");
  const third = Math.max(...refused.map((row) => row.at));
  assert.deepEqual(fromAidan.filter((mail) => mail.at > third).map((mail) => mail.to), [], "nothing more from Aidan's inbox that day after its third bounce");
  const before = fake.sent.length;
  await run(MON_9AM + 24 * 60 * MINUTE, MON_9AM + 30 * 60 * MINUTE);
  const tuesday = fake.sent.slice(before).filter((mail) => mail.from === AIDAN);
  assert.equal(tuesday.filter((mail) => mail.to.endsWith(".gov")).length, 5, "the cities send again on Tuesday");
  assert.ok(tuesday.some((mail) => mail.to.endsWith(".example")), "FCC sends from Aidan's inbox again on Tuesday");
});

test("loading from the screen: Check saves nothing and shows the counts, holds and samples; Load saves a waiting batch; new words go with their batch", async () => {
  const { loadList } = await import("@/lib/outreach/outreach-load");
  const { raw, db } = database();
  let ids = 0;
  const mailOk = async () => ({ noMailServer: new Map<string, string>(), unreadable: [] as string[] });
  const context = { loadedBy: "Aidan", now: new Date("2026-11-07T15:00:00Z"), newId: () => `x-${++ids}`, mailingAddress: ADDRESS, checkMail: mailOk };
  const base = { campaign: "us-cities", name: "Cities batch 1", csv: csvOf(5, (i) => (i === 4 ? { verified: "no" } : {})), save: false };

  assert.deepEqual(await loadList(db, { ...base, campaign: "nope" }, context), { ok: false, error: "That campaign doesn't exist." });
  assert.match((await loadList(db, base, context) as { error: string }).error, /no words yet/, "the cities campaign starts with no words");
  assert.match((await loadList(db, { ...base, first: FIRST }, context) as { error: string }).error, /follow-up's words too/);

  raw.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES ('clerk5@city5.gov','BOUNCED')`).run();
  const check = await loadList(db, { ...base, first: FIRST, followUp: FOLLOW }, context);
  assert.ok(check.ok);
  assert.equal(check.saved, false);
  assert.deepEqual([check.rows, check.ready, check.held], [5, 3, 2]);
  assert.deepEqual(check.holds.map((hold) => [hold.row, hold.reason.slice(0, 22)]), [[5, "Not verified (verified"], [6, "On the do-not-email li"]]);
  assert.equal(check.samples.length, 3);
  assert.equal(check.samples[0]!.subject, "Springfield 1's website: 101 accessibility errors before the April 2027 deadline");
  assert.match(check.samples[0]!.text, /Hi Pat1,[\s\S]*Aidan Magee, Axiom[\s\S]*Not useful\? Reply "no thanks"/);
  assert.equal(check.samples[0]!.followUp!.subject, `Re: ${check.samples[0]!.subject}`);
  assert.equal(check.wordsChanged, true);
  assert.equal(count(raw, `SELECT COUNT(*) AS n FROM "OutreachBatch"`), 0, "Check writes nothing");
  assert.equal((await readCampaign(db, "us-cities"))!.wordsVersion, null, "nor the words");

  const loaded = await loadList(db, { ...base, first: FIRST, followUp: FOLLOW, save: true }, context);
  assert.ok(loaded.ok && loaded.saved && loaded.batchId);
  assert.deepEqual([loaded.rows, loaded.ready, loaded.held], [5, 3, 2]);
  const batch = raw.prepare(`SELECT "status","loadedBy","source" FROM "OutreachBatch" WHERE "id" = ?`).get(loaded.batchId);
  assert.deepEqual(batch, { status: "waiting", loadedBy: "Aidan", source: "the Campaigns screen" });
  assert.equal((await readCampaign(db, "us-cities"))!.wordsVersion, wordsVersion(words()), "the pasted words are saved");
  assert.deepEqual(await approveBatch(db, loaded.batchId, "Aidan", null), { ok: true });

  // A second list with the campaign's own words (none pasted): nothing about the approval changes.
  const second = await loadList(db, { ...base, name: "Cities batch 2", csv: [HEADERS, cityRow(7), cityRow(8)].join("\n"), save: true }, context);
  assert.ok(second.ok && second.wordsChanged === false);
  const { campaignDetail } = await import("@/lib/outreach/outreach-status");
  const approvedOnItsWords = async (id: string) => (await campaignDetail(db, "us-cities", null))!.batches.find((batch) => batch.id === id)!.wordsCurrent;
  assert.equal(await approvedOnItsWords(loaded.batchId), true);
  // New words with a third list: they go with that batch (and become the campaign's latest); batch 1 keeps its approved words.
  const third = await loadList(db, { ...base, name: "Cities batch 3", csv: [HEADERS, cityRow(9)].join("\n"), first: FIRST.replace("free check", "quick check"), followUp: FOLLOW, save: true }, context);
  assert.ok(third.ok && third.wordsChanged && third.batchId);
  assert.equal(await approvedOnItsWords(loaded.batchId), true, "an approved batch keeps sending exactly what Aidan approved");
  const thirdWords = raw.prepare(`SELECT "wordsJson" FROM "OutreachBatch" WHERE "id" = ?`).get(third.batchId) as { wordsJson: string };
  assert.match(thirdWords.wordsJson, /quick check/, "the third batch carries its own new words");

  // Limits and lookups that fail: nothing is written.
  const before = count(raw, `SELECT COUNT(*) AS n FROM "OutreachContact"`);
  const many = await loadList(db, { ...base, name: "Big", csv: [HEADERS, ...Array.from({ length: 41 }, (_, i) => cityRow(100 + i))].join("\n"), save: true }, context);
  assert.match((many as { error: string }).error, /41 different email domains; the screen checks up to 40/);
  const down = await loadList(db, { ...base, name: "Down", save: true }, { ...context, checkMail: async () => ({ noMailServer: new Map<string, string>(), unreadable: ["city1.gov"] }) });
  assert.match((down as { error: string }).error, /Couldn't look up the mail servers of city1\.gov\. Nothing was loaded/);
  assert.equal(count(raw, `SELECT COUNT(*) AS n FROM "OutreachContact"`), before);
});

test("an inbox that can't be read directly (Proton) has its checks read in the inbox it forwards to; no chains", async () => {
  const { mailboxOwner } = await import("@/lib/outreach/outreach-inboxes");
  const gmail = { address: "aidanmageebusiness@gmail.com", imapHost: "imap.gmail.com" };
  const proton = { address: "aidan@getaxiom.ca", imapHost: "aidanmageebusiness@gmail.com" };
  const chained = { address: "x@getaxiom.ca", imapHost: "aidan@getaxiom.ca" };
  assert.equal(mailboxOwner(gmail, [gmail, proton]), gmail, "a Gmail inbox reads itself");
  assert.equal(mailboxOwner(proton, [gmail, proton]), gmail, "the Proton inbox is read in Aidan's Gmail");
  assert.equal(mailboxOwner(proton, [proton]), null, "not a sending inbox: nothing to read, so it can't send");
  assert.equal(mailboxOwner(chained, [gmail, proton, chained]), null, "no chains");
});

test("a signed inbox ends its emails with the founder's signature; a no-links first email leaves out the link and logo", () => {
  const fields = { first_name: "Dana", city: "Springfield", worst_problem: "5 images with no description" };
  const signedWords: CampaignWords = { steps: [
    { subject: "{city}'s website", body: "Hi {first_name},\n\nWe checked {city}. The biggest: {worst_problem}.\n\n{sender_name}\nAxiom, Kitchener-Waterloo" },
    { body: "Following up on {city}.\n\n{sender_name}\nAxiom" },
  ] };
  const plain = { name: "Riley Example", address: "riley@example.com" };
  const signed = { ...plain, signature: { title: "Co-founder, Axiom", phone: "555-0100" } };

  const first = renderEmail(signedWords, 1, fields, signed, ADDRESS, { noLinksInFirst: true });
  assert.ok(first.ok);
  assert.match(first.email.text, /Co-founder, Axiom\n257 Example St,\nKitchener, ON N2C 0A0, Canada\nC: 555-0100\n\nNot useful\? Reply "no thanks"/);
  assert.doesNotMatch(first.email.text, /getaxiom\.ca/);
  assert.equal(first.email.text.match(/Riley Example/g)?.length, 1, "the name the words sign with is not repeated");
  assert.ok(first.email.html);
  assert.doesNotMatch(first.email.html, /<a |<img /);
  assert.match(first.email.html, /no thanks/);

  const follow = renderEmail(signedWords, 2, fields, signed, ADDRESS, { firstSubject: first.email.subject });
  assert.ok(follow.ok);
  assert.match(follow.email.text, /C: 555-0100\ngetaxiom\.ca\n\nNot useful/);
  assert.match(follow.email.html ?? "", /<a href="https:\/\/getaxiom\.ca\/"><img src="https:\/\/operations\.getaxiom\.ca\/brand\/axiom-lockup-tile-328\.png"/);
  assert.match(follow.email.html ?? "", /Following up on Springfield\./);

  const unsigned = renderEmail(signedWords, 2, fields, plain, ADDRESS, { firstSubject: first.email.subject });
  assert.ok(unsigned.ok);
  assert.equal(unsigned.email.html, undefined);
  assert.match(unsigned.email.text, /Axiom · 257 Example St/);
});
