// The Claude connector end to end, on made-up data in an in-memory database: keys, the two addresses, the MCP
// protocol, every tool, and proof that nothing here can approve a batch or start a paused campaign again.
//
// The audit log and the rate limiter are the real ones (src/lib/audit.ts, src/lib/rate-limit.ts): the test binds
// its in-memory database as the Worker's database, so they write to it. Every person, place and address is invented.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";

import Database from "better-sqlite3";
import { z } from "zod";

import { setCloudflareBindings, type D1DatabaseLike } from "@/lib/cloudflare";
import { KEY_PREFIX, founderForKey, keysStatus, makeKey, sha256Hex, turnOffKey, type Founder } from "@/lib/connector/connector-keys";
import { NO_KEY_CALLS_PER_MINUTE, handleMcpPost, liveMcpEnv, methodNotAllowed } from "@/lib/connector/mcp-http";
import { VERSIONS, answer, answerBody, type AuditEvent, type RpcAnswer, type ServerContext } from "@/lib/connector/mcp-server";
import { CONNECTOR_MAX_LIST_ROWS, TOOLS, torontoText, withTorontoTimes } from "@/lib/connector/mcp-tools";
import { FCC_CAMPAIGN_KEY as FCC_KEY } from "@/lib/fcc-campaign";
import { OUTREACH_REPLY_STATE } from "@/lib/outreach/outreach-replies";
import { OUTREACH_AUTO_PAUSE_BY } from "@/lib/outreach/outreach-sender";
import { parseStepText, wordsVersion } from "@/lib/outreach/outreach-words";
import { OWNER_LOGINS } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

// Fri Nov 13, 2026, 1:01 p.m. in Toronto (winter time).
const NOW = new Date("2026-11-13T18:01:00.000Z");
const TODAY = "2026-11-13";
const BASE = "https://engine.test";
const MAILING = "100 Example Street, Kitchener, ON N0N 0N0, Canada";
const AIDAN = "aidan@axiom-test.example";
const RILEY = "riley@axiom-test.example";
const READ_TOOLS = ["engine_today", "list_campaigns", "get_campaign", "list_batches", "get_batch", "list_replies", "get_reply", "find_contact", "inbox_health", "check_do_not_email"];
const WRITE_TOOLS = ["pause_campaign", "check_list", "load_list", "send_test", "mark_reply_answered"];

const FIRST = `Subject: {city}'s website: {error_count} accessibility problems

Hi {first_name},

We checked {city}'s website and found {error_count} problems. Would the full report be useful?

{sender_name}
Axiom`;
const FOLLOW = `Hi {first_name}, just checking you saw my note about {city}'s website.

{sender_first_name}`;
const WORDS = { steps: [parseStepText(FIRST, 1), parseStepText(FOLLOW, 2)] };
const VERSION = wordsVersion(WORDS);
const COLUMNS = ["email", "first_name", "city", "verified", "error_count"];
const CSV = [
  "email,first_name,city,verified,error_count",
  "dana@marrowsound.example,Dana,Marrow Sound,yes,41",
  "omar@yarrowby.example,Omar,Yarrowby,yes,58",
  "ines@bramblewick.example,Ines,Bramblewick,no,12",
].join("\n");

type Raw = Database.Database;
/** A tool's result, read loosely: the assertions below say what each must hold. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function setup() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
  raw.exec(readFileSync(new URL("../../../migrations/0037_kv_store.sql", import.meta.url), "utf8"));
  // The audit log and the rate limiter's tables, exactly as the first migration makes them.
  const first = readFileSync(new URL("../../../migrations/0001_cloudflare_auth_security.sql", import.meta.url), "utf8");
  for (const table of ["AuditEvent", "RateLimitWindow"]) raw.exec(new RegExp(`CREATE TABLE "${table}" \\([^;]+;`).exec(first)![0]);
  raw.exec(/CREATE UNIQUE INDEX "RateLimitWindow_key_key"[^;]+;/.exec(first)![0]);
  let broken = false;
  const queries = { count: 0 };
  const db: ProspectDb = {
    prepare(sql) {
      return { bind: (...values: unknown[]) => {
        const statement = () => { queries.count += 1; if (broken) throw new Error("D1_ERROR: the database is not answering"); return raw.prepare(sql); };
        return {
          all: async <T,>() => ({ results: statement().all(...values) as T[] }),
          first: async <T,>() => (statement().get(...values) as T | undefined) ?? null,
          run: async () => { const info = statement().run(...values); return { meta: { changes: info.changes } }; },
        };
      } };
    },
  };
  setCloudflareBindings({ DB: db as unknown as D1DatabaseLike, FCC_CAMPAIGN_MAILING_ADDRESS: MAILING, FCC_SENDER_ADDRESS: AIDAN, APP_BASE_URL: BASE });
  seed(raw);
  let ids = 0;
  const audits: AuditEvent[] = [];
  const context = (founder: Founder = "Riley", extra: Partial<ServerContext> = {}): ServerContext => ({
    db, founder, settings: { fccFirstInbox: AIDAN, mailingAddress: MAILING }, now: () => NOW, newId: () => `new-${++ids}`,
    checkMail: async () => ({ noMailServer: new Map(), unreadable: [] }), audit: async (event) => { audits.push(event); }, ...extra,
  });
  let rpc = 0;
  /** One tool call, straight into the server (no HTTP). */
  const call = async (name: string, args: Record<string, unknown> = {}, founder: Founder = "Riley", extra: Partial<ServerContext> = {}) => {
    const answered = await answer({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }, context(founder, extra));
    assert.ok(answered && "result" in answered, `${name} answered a JSON-RPC error`);
    const result = answered.result as { content: Array<{ type: string; text: string }>; structuredContent?: Json; isError?: boolean };
    assert.equal(result.content[0]!.type, "text");
    if (!result.isError) assert.deepEqual(JSON.parse(result.content[0]!.text), result.structuredContent, "the text and the data are the same object");
    return { error: Boolean(result.isError), text: result.content[0]!.text, data: result.structuredContent };
  };
  /** What an MCP client sends: JSON-RPC in a POST, with the key in the header or in the address. */
  const http = async (options: { key?: string | null; path?: string; body?: unknown; headers?: Record<string, string>; method?: string; env?: Partial<ReturnType<typeof liveMcpEnv>> }) => {
    const path = options.path ?? "/api/mcp";
    const pathKey = path.startsWith("/api/mcp/k/") ? decodeURIComponent(path.slice("/api/mcp/k/".length)) : null;
    const request = new Request(`${BASE}${path}`, {
      method: "POST", body: typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? { jsonrpc: "2.0", id: 1, method: "ping" }),
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(options.key ? { authorization: `Bearer ${options.key}` } : {}), ...options.headers },
    });
    const response = await handleMcpPost(request, pathKey, { ...liveMcpEnv(request), now: () => NOW, checkMail: async () => ({ noMailServer: new Map(), unreadable: [] }), ...options.env });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };
  const all = <T = Record<string, unknown>>(sql: string, ...values: unknown[]) => raw.prepare(sql).all(...values) as T[];
  return { raw, db, context, call, http, all, audits, queries, breakDatabase: () => { broken = true; } };
}

function seed(raw: Raw) {
  const iso = (text: string) => new Date(text).toISOString();
  raw.prepare(`DELETE FROM "OutreachInbox"`).run();
  const inbox = raw.prepare(`INSERT INTO "OutreachInbox" ("address","name","passwordSecret","dailyMax","rampJson","rampFrom","note") VALUES (?,?,?,60,'[]',NULL,'Made-up inbox')`);
  inbox.run(AIDAN, "Aidan Sample", "TEST_PASSWORD_1");
  inbox.run(RILEY, "Riley Sample", "TEST_PASSWORD_2");

  const campaign = raw.prepare(`INSERT OR REPLACE INTO "OutreachCampaign" ("key","name","state","stateReason","stateBy","stateAt","priority","startDay","sendDays","windowStart","windowEnd","dailyLimit",
    "inboxesJson","followUps","followUpBusinessDays","wordsJson","wordsVersion","rulesJson","approversJson","note") VALUES (?,?,?,?,?,?,?,'2026-11-02','Mon,Tue,Wed,Thu,Fri',540,870,?,?,1,5,?,?,?,?,NULL)`);
  const rules = { holdUnless: { verified: ["yes", "true"] }, noLinksInFirst: true };
  campaign.run("us-cities", "US cities: accessibility", "live", null, "Riley", iso("2026-11-08T21:00:00Z"), 10, 30,
    JSON.stringify([{ address: AIDAN, perDay: 15 }, { address: RILEY, perDay: 15 }]), JSON.stringify(WORDS), VERSION, JSON.stringify({ ...rules, successLabel: "Price requests" }), '["Aidan"]');
  campaign.run("school-districts", "School districts: accessibility", "live", null, "Riley", iso("2026-11-10T21:00:00Z"), 20, 20,
    JSON.stringify([{ address: RILEY, perDay: 20 }]), JSON.stringify(WORDS), VERSION, JSON.stringify(rules), '["Riley"]');
  campaign.run("county-it", "Counties: IT and web contacts", "paused", "3 of its emails bounced today", OUTREACH_AUTO_PAUSE_BY, iso("2026-11-12T19:30:00Z"), 15, 10,
    JSON.stringify([{ address: AIDAN, perDay: 10 }]), JSON.stringify(WORDS), VERSION, JSON.stringify(rules), '["Aidan"]');

  const batch = raw.prepare(`INSERT INTO "OutreachBatch" ("id","campaignKey","name","source","columnsJson","rows","ready","held","loadedBy","loadedAt","status","approvedBy","approvedAt","approvedWords",
    "approvalNote","sendOrder","wordsJson","wordsVersion") VALUES (?,?,?,'from the Campaigns screen',?,0,0,0,'Riley',?,?,?,?,?,NULL,?,?,?)`);
  const addBatch = (id: string, key: string, name: string, loadedAt: string, order: number, approved: boolean) => batch.run(id, key, name, JSON.stringify(COLUMNS), iso(loadedAt),
    approved ? "approved" : "waiting", approved ? "Aidan" : null, approved ? iso("2026-11-08T20:00:00Z") : null, approved ? VERSION : null, order, JSON.stringify(WORDS), VERSION);
  addBatch("b-test-1", "us-cities", "cities-A1", "2026-11-07T15:00:00Z", 1, true);
  addBatch("b-test-2", "us-cities", "cities-B1", "2026-11-12T15:00:00Z", 2, false);
  addBatch("b-test-3", "school-districts", "districts-D1", "2026-11-13T14:00:00Z", 1, false);

  const contact = raw.prepare(`INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","holdReason","stoppedReason","stepsSent","senderAddress",
    "firstSentAt","firstSentDay","firstMessageId","firstSubject","lastMessageId","nextDueDay","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const send = raw.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","kind","step","email","senderAddress","sendDay","messageId","subject","status","createdAt","finishedAt")
    VALUES (?,?,?,'real',1,?,?,?,?,?,'SENT',?,?)`);
  let row = 1;
  const add = (id: string, key: string, batchId: string, name: string, city: string, status: string, options: { sentAt?: string; from?: string; due?: string | null; hold?: string; stopped?: string; updatedAt?: string } = {}) => {
    const slug = city.toLowerCase().replace(/[^a-z]/g, "");
    const email = `${name.toLowerCase()}@${slug}.example`;
    const subject = `${city}'s website: 40 accessibility problems`;
    const sentAt = options.sentAt ? iso(options.sentAt) : null;
    const messageId = sentAt ? `<ax-${id}-1@axiom-test.example>` : null;
    contact.run(id, key, batchId, ++row, email, JSON.stringify({ email, first_name: name, city, verified: options.hold ? "no" : "yes", error_count: "40" }), status, options.hold ?? null, options.stopped ?? null,
      sentAt ? 1 : 0, options.from ?? null, sentAt, sentAt ? sentAt.slice(0, 10) : null, messageId, sentAt ? subject : null, messageId, options.due ?? null, iso("2026-11-07T15:00:00Z"), iso(options.updatedAt ?? options.sentAt ?? "2026-11-07T15:00:00Z"));
    if (sentAt) send.run(`s-${id}`, key, id, email, options.from, sentAt.slice(0, 10), messageId, subject, sentAt, sentAt);
    return email;
  };
  // cities-A1: approved and sending. Emailed Mon Nov 9; two more went out today.
  add("c1", "us-cities", "b-test-1", "Dana", "Port Halden", "sent", { sentAt: "2026-11-09T15:00:00Z", from: AIDAN, due: "2026-11-16" });
  add("c2", "us-cities", "b-test-1", "Sam", "Maplewood Springs", "replied", { sentAt: "2026-11-09T15:02:00Z", from: RILEY, stopped: "They wrote back, so no more emails", updatedAt: "2026-11-13T16:30:00Z" });
  add("c3", "us-cities", "b-test-1", "Priya", "Elm Hollow", "replied", { sentAt: "2026-11-09T15:04:00Z", from: AIDAN, stopped: "They wrote back, so no more emails", updatedAt: "2026-11-10T19:00:00Z" });
  const saidNo = add("c4", "us-cities", "b-test-1", "Marcus", "Stonebridge Flats", "suppressed", { sentAt: "2026-11-09T15:06:00Z", from: AIDAN, stopped: "They said no thanks", updatedAt: "2026-11-11T17:00:00Z" });
  const bounced = add("c5", "us-cities", "b-test-1", "Elena", "Northmere", "bounced", { sentAt: "2026-11-13T15:00:00Z", from: AIDAN, stopped: "The email bounced", updatedAt: "2026-11-13T15:00:05Z" });
  add("c6", "us-cities", "b-test-1", "Tobias", "Cinder Creek", "sent", { sentAt: "2026-11-13T15:05:00Z", from: RILEY, due: "2026-11-20" });
  add("c7", "us-cities", "b-test-1", "Noor", "Brackenridge", "ready");
  // The sender's own check found this reply before a follow-up: the contact says replied, no message was recorded.
  add("c8", "us-cities", "b-test-1", "Callum", "Fennimore Bay", "replied", { sentAt: "2026-11-09T15:08:00Z", from: AIDAN, stopped: "They wrote back Nov 12, so no more emails", updatedAt: "2026-11-12T16:00:00Z" });
  // cities-B1 waits for Aidan; districts-D1 waits for Riley.
  add("c9", "us-cities", "b-test-2", "Ines", "Alder Ridge", "ready");
  add("c10", "us-cities", "b-test-2", "Rafael", "Tallow Point", "ready");
  add("c11", "us-cities", "b-test-2", "Greta", "Quillfeather", "held", { hold: "Not verified (verified is \"no\")" });
  add("d1", "school-districts", "b-test-3", "Lucia", "Harrow Glen", "ready");
  add("d2", "school-districts", "b-test-3", "Henrik", "Wexley", "ready");

  const reply = raw.prepare(`INSERT INTO "OutreachReply" ("id","campaignKey","contactId","inbox","fromAddress","receivedAt","quote","kind","foundAt","toldFoundersAt","answeredAt","answeredBy","successAt","successBy")
    VALUES (?,'us-cities',?,?,?,?,?,?,?,?,?,?,?,?)`);
  reply.run(`${RILEY}:[Gmail]/All Mail:9001:c2`, "c2", RILEY, "sam@maplewoodsprings.example", iso("2026-11-13T16:30:00Z"), "Yes please, send the full report. What would the fixes cost?", "reply",
    iso("2026-11-13T17:00:00Z"), iso("2026-11-13T17:00:00Z"), null, null, null, null);
  reply.run(`${AIDAN}:[Gmail]/All Mail:9002:c3`, "c3", AIDAN, "priya@elmhollow.example", iso("2026-11-10T19:00:00Z"), "Could you send pricing for fixing the forms?", "reply",
    iso("2026-11-10T19:30:00Z"), iso("2026-11-10T19:30:00Z"), iso("2026-11-10T20:00:00Z"), "Aidan", iso("2026-11-10T20:01:00Z"), "Aidan");
  reply.run(`${AIDAN}:[Gmail]/All Mail:9003:c4`, "c4", AIDAN, saidNo, iso("2026-11-11T17:00:00Z"), "Not interested, please take us off your list.", "no_thanks",
    iso("2026-11-11T17:30:00Z"), iso("2026-11-11T17:30:00Z"), null, null, null, null);
  const block = raw.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason","createdAt") VALUES (?,?,?)`);
  block.run(saidNo, "UNSUBSCRIBED", iso("2026-11-11T17:30:00Z"));
  block.run(bounced, "BOUNCED", iso("2026-11-13T15:00:05Z"));

  raw.prepare(`INSERT INTO "KvStore" ("key","value","updatedAt") VALUES (?,?,?)`).run(OUTREACH_REPLY_STATE,
    JSON.stringify({ inboxes: { [AIDAN]: iso("2026-11-13T17:35:00Z"), [RILEY]: iso("2026-11-13T17:35:00Z") }, at: iso("2026-11-13T17:35:00Z"), unread: [] }), NOW.toISOString());
  // FCC ended: one reply stays to read.
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","step1SentAt","stoppedReason","createdAt","updatedAt")
    SELECT 'f-test-1', "campaignKey", 'pat@haldentelecom.example', 'Pat', 'Halden Telecom', '[]', 'named', 1, 'replied', ?, 'They wrote back: "We already filed this ourselves."', ?, ?
    FROM (SELECT ? AS "campaignKey")`).run(iso("2026-10-28T15:00:00Z"), iso("2026-10-20T15:00:00Z"), iso("2026-10-29T15:00:00Z"), FCC_KEY);
}
after(() => setCloudflareBindings(null));

/** What must never change through the connector: who is approved, which campaigns are live, the do-not-email list, the inboxes. */
const guarded = (s: ReturnType<typeof setup>) => JSON.stringify({
  batches: s.all(`SELECT "id","status","approvedBy","approvedAt","approvedWords" FROM "OutreachBatch" WHERE "id" LIKE 'b-test-%' ORDER BY "id"`),
  live: s.all(`SELECT "key" FROM "OutreachCampaign" WHERE "state" = 'live' ORDER BY "key"`),
  doNotEmail: s.all(`SELECT * FROM "EngineEmailSuppression" ORDER BY "email"`),
  inboxes: s.all(`SELECT * FROM "OutreachInbox" ORDER BY "address"`),
  limits: s.all(`SELECT "key","dailyLimit","inboxesJson","sendDays","windowStart","windowEnd","approversJson" FROM "OutreachCampaign" ORDER BY "key"`),
  fcc: s.all(`SELECT * FROM "FccCampaignSetting"`),
});

// ---------- keys ----------
test("a key is made and only its hash is stored; a new key replaces the old one; a wrong key, a key turned off and a key of the wrong kind are refused", async () => {
  const s = setup();
  const first = await makeKey(s.db, "Riley", "header", NOW);
  assert.match(first, /^axe_[A-Za-z0-9_-]{32}$/);
  const stored = s.all<{ founder: string; kind: string; keyHash: string; lastFour: string }>(`SELECT * FROM "EngineConnectorKey"`);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.keyHash, await sha256Hex(first));
  assert.equal(stored[0]!.lastFour, first.slice(-4));
  assert.ok(!JSON.stringify(stored).includes(first), "the key itself is never stored");
  assert.deepEqual(await keysStatus(s.db, "Riley"), { header: { exists: true, lastFour: first.slice(-4), createdAt: NOW.toISOString(), lastUsedAt: null }, link: { exists: false, lastFour: null, createdAt: null, lastUsedAt: null } });
  assert.equal((await keysStatus(s.db, "Aidan")).header.exists, false);

  assert.equal((await s.http({ key: first })).status, 200);
  assert.equal(await founderForKey(s.db, first, "header", NOW), "Riley");
  assert.equal((await keysStatus(s.db, "Riley")).header.lastUsedAt, NOW.toISOString());
  // "Last used" is written at most every 10 minutes.
  await founderForKey(s.db, first, "header", new Date(NOW.getTime() + 9 * 60_000));
  assert.equal((await keysStatus(s.db, "Riley")).header.lastUsedAt, NOW.toISOString());
  await founderForKey(s.db, first, "header", new Date(NOW.getTime() + 11 * 60_000));
  assert.equal((await keysStatus(s.db, "Riley")).header.lastUsedAt, new Date(NOW.getTime() + 11 * 60_000).toISOString());

  // No key, a wrong key, and the sign-in cookie all get the same answer: make a key in Settings.
  for (const options of [{ key: null }, { key: `axe_${"0".repeat(32)}` }, { key: "not-a-key" }, { key: null, headers: { cookie: "better-auth.session_token=anything" } }]) {
    const refused = await s.http({ ...options, headers: { "cf-connecting-ip": "203.0.113.5", ...("headers" in options ? options.headers : {}) } });
    assert.equal(refused.status, 401);
    assert.equal(refused.headers.get("www-authenticate"), 'Bearer realm="Axiom Revenue Engine"');
    assert.deepEqual(refused.body, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "No valid connector key. Make one in the engine: Settings, Claude connector." } });
  }

  // A new key replaces the old one at once; Aidan's key is his own.
  const second = await makeKey(s.db, "Riley", "header", NOW);
  assert.notEqual(second, first);
  assert.equal((await s.http({ key: first })).status, 401);
  assert.equal((await s.http({ key: second })).status, 200);
  const aidan = await makeKey(s.db, "Aidan", "header", NOW);
  assert.equal(await founderForKey(s.db, aidan, "header", NOW), "Aidan");
  assert.equal(await founderForKey(s.db, second, "header", NOW), "Riley");

  // A link key is refused in the header, and a header key is refused in the address.
  const link = await makeKey(s.db, "Riley", "link", NOW);
  assert.ok(link.startsWith(KEY_PREFIX.link));
  assert.equal((await s.http({ key: link })).status, 401);
  assert.equal((await s.http({ path: `/api/mcp/k/${second}` })).status, 401);
  assert.equal(await founderForKey(s.db, link, "header", NOW), null);
  assert.equal(await founderForKey(s.db, second, "link", NOW), null);

  // Turned off: the row is gone and the key stops working. The other kind keeps working.
  await turnOffKey(s.db, "Riley", "header");
  assert.equal((await s.http({ key: second })).status, 401);
  assert.equal((await keysStatus(s.db, "Riley")).header.exists, false);
  assert.equal((await s.http({ path: `/api/mcp/k/${link}` })).status, 200);
});

test("the link form works: the key in the address and no header, for claude.ai", async () => {
  const s = setup();
  const link = await makeKey(s.db, "Aidan", "link", NOW);
  assert.match(link, /^axel_[A-Za-z0-9_-]{32}$/);
  const init = await s.http({ path: `/api/mcp/k/${link}`, body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } } });
  assert.equal(init.status, 200);
  assert.match(init.body.result.instructions, /You are connected as Aidan\./);
  // A header on the link address changes nothing: only the address's key counts.
  const header = await makeKey(s.db, "Riley", "header", NOW);
  const today = await s.http({ path: `/api/mcp/k/${link}`, key: header, body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "engine_today", arguments: {} } } });
  assert.equal(today.body.result.structuredContent.founder, "Aidan");
  const wrong = await s.http({ path: `/api/mcp/k/axel_${"0".repeat(32)}` });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("www-authenticate"), null);
  assert.equal((await keysStatus(s.db, "Aidan")).link.lastUsedAt, NOW.toISOString());
});

test("a web page on another site is refused even with a key; the app's own address and Claude's are let in; anything but POST gets 405", async () => {
  const s = setup();
  const key = await makeKey(s.db, "Riley", "header", NOW);
  assert.equal((await s.http({ key, headers: { origin: "https://other.example" } })).status, 403);
  assert.equal((await s.http({ key, headers: { origin: "null" } })).status, 403);
  for (const origin of [BASE, "https://claude.ai", "https://claude.com"]) assert.equal((await s.http({ key, headers: { origin } })).status, 200, origin);
  const refused = methodNotAllowed();
  assert.equal(refused.status, 405);
  assert.equal(refused.headers.get("allow"), "POST");
});

test("calls without a valid key are limited per IP address, and a key's calls per minute, with a plain 429", async () => {
  const s = setup();
  const seen: number[] = [];
  for (let attempt = 0; attempt < 3 * NO_KEY_CALLS_PER_MINUTE && seen.at(-1) !== 429; attempt += 1) {
    seen.push((await s.http({ key: `axe_${String(attempt).padStart(32, "0")}`, headers: { "cf-connecting-ip": "203.0.113.9" } })).status);
  }
  // Ten guesses are answered, then the address is told to wait (a minute boundary mid-test can only add answers).
  assert.equal(seen.at(-1), 429);
  assert.ok(seen.filter((status) => status === 401).length >= NO_KEY_CALLS_PER_MINUTE);
  // Another address, and a real key from the limited address, are not held up by it.
  assert.equal((await s.http({ key: "axe_wrong", headers: { "cf-connecting-ip": "203.0.113.10" } })).status, 401);
  const key = await makeKey(s.db, "Riley", "header", NOW);
  assert.equal((await s.http({ key, headers: { "cf-connecting-ip": "203.0.113.9" } })).status, 200);

  const limited = await s.http({ key, env: { rateLimit: async (options) => ({ allowed: options.scope !== "connector-key" }) } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(limited.body.error.message, "Too many calls in a minute. Wait a minute, then try again.");
  // The limiter counts by founder and kind, never by the key.
  const windows = s.all<{ key: string }>(`SELECT "key" FROM "RateLimitWindow"`).map((row) => row.key);
  assert.ok(windows.some((name) => name.startsWith("connector-key:Riley:header:")));
  assert.ok(!windows.some((name) => name.includes(key)));
});

// ---------- the protocol ----------
test("initialize answers in each protocol version it speaks and falls back to the newest; ping; a notification gets no answer; unknown method; bad JSON; a batch in order", async () => {
  const s = setup();
  const key = await makeKey(s.db, "Riley", "header", NOW);
  assert.deepEqual(VERSIONS, ["2025-06-18", "2025-03-26", "2024-11-05"]);
  for (const version of VERSIONS) {
    const init = await s.http({ key, body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "test", version: "1" } } } });
    assert.equal(init.status, 200);
    assert.equal(init.body.result.protocolVersion, version);
    assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } });
    assert.deepEqual(init.body.result.serverInfo, { name: "axiom-engine", title: "Axiom Revenue Engine", version: "1.0.0" });
    assert.match(init.body.result.instructions, /You are connected as Riley\. Start with engine_today/);
    assert.match(init.body.result.instructions, /You cannot approve a batch, resume a paused campaign, stop a batch/);
    assert.ok(!init.body.result.instructions.includes("—"), "no em dash in what a founder's Claude reads");
  }
  for (const params of [{ protocolVersion: "2099-01-01" }, {}, undefined]) {
    assert.equal((await s.http({ key, body: { jsonrpc: "2.0", id: 2, method: "initialize", params } })).body.result.protocolVersion, "2025-06-18");
  }
  assert.deepEqual((await s.http({ key, body: { jsonrpc: "2.0", id: "p", method: "ping" } })).body, { jsonrpc: "2.0", id: "p", result: {} });

  const notice = await s.http({ key, body: { jsonrpc: "2.0", method: "notifications/initialized" } });
  assert.equal(notice.status, 202);
  assert.equal(notice.body, null);
  assert.equal(await answer({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} }, s.context()), null);
  assert.equal(await answer({ jsonrpc: "2.0", id: 9, result: {} }, s.context()), null, "a reply to something this server never asked");

  assert.equal((await s.http({ key, body: { jsonrpc: "2.0", id: 3, method: "resources/list" } })).body.error.code, -32601);
  assert.equal((await s.http({ key, body: { jsonrpc: "1.0", id: 3, method: "ping" } })).body.error.code, -32600);
  assert.equal((await s.http({ key, body: '"just text"' })).body.error.code, -32600);
  const unknown = await s.http({ key, body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "approve_batch", arguments: { batch: "b-test-2" } } } });
  assert.deepEqual(unknown.body.error, { code: -32602, message: "There is no tool called approve_batch" });

  const bad = await s.http({ key, body: "{ not json" });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "The request is not JSON" } });

  const batch = await s.http({ key, body: [{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", id: "b", method: "tools/list" }] });
  assert.deepEqual(batch.body.map((item: RpcAnswer) => item.id), ["a", "b"]);
  assert.equal((await s.http({ key, body: [{ jsonrpc: "2.0", method: "notifications/initialized" }] })).status, 202);
  // One request runs one tool, so it stays inside the database's per-request limit.
  const two = await answerBody([1, 2].map((id) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "list_campaigns", arguments: {} } })), s.context());
  const answers = two.body as RpcAnswer[];
  assert.ok("result" in answers[0]!);
  assert.deepEqual("error" in answers[1]! && answers[1].error, { code: -32600, message: "One tool call per request: send this one again by itself" });
});

test("tools/list: every tool has a name, title, description, input schema and annotations; read tools are read-only; the schema Claude sees matches what is checked", async () => {
  const s = setup();
  const listed = await answer({ jsonrpc: "2.0", id: 1, method: "tools/list" }, s.context());
  const tools = (listed as { result: { tools: Array<{ name: string; title: string; description: string; inputSchema: Json; annotations: Record<string, boolean> }> } }).result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), [...READ_TOOLS, ...WRITE_TOOLS]);
  for (const tool of tools) {
    assert.deepEqual(Object.keys(tool).sort(), ["annotations", "description", "inputSchema", "name", "title"]);
    assert.ok(tool.title.length > 2 && tool.description.length > 40, tool.name);
    assert.ok(!/—/.test(tool.title + tool.description + JSON.stringify(tool.inputSchema)), `${tool.name}: no em dash`);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.openWorldHint, false);
    if (READ_TOOLS.includes(tool.name)) assert.deepEqual(tool.annotations, { readOnlyHint: true, openWorldHint: false });
    else assert.deepEqual({ ...tool.annotations, idempotentHint: true }, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  }
  assert.deepEqual(tools.filter((tool) => tool.annotations.idempotentHint).map((tool) => tool.name), ["pause_campaign", "check_list", "mark_reply_answered"]);
  // The connector says plainly what it can't do, so Claude explains instead of trying.
  const about = (name: string) => tools.find((tool) => tool.name === name)!.description;
  for (const name of ["list_batches", "get_batch", "load_list"]) assert.match(about(name), /this connector can't approve/);
  for (const name of ["get_campaign", "pause_campaign"]) assert.match(about(name), /this connector can't resume/);
  assert.match(about("send_test"), /nowhere else/);

  for (const tool of TOOLS) {
    const shape = (tool.args as z.ZodObject).shape as Record<string, z.ZodType>;
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), Object.keys(shape).sort(), `${tool.name}: the same arguments`);
    assert.deepEqual([...tool.inputSchema.required].sort(), Object.keys(shape).filter((name) => !shape[name]!.safeParse(undefined).success).sort(), `${tool.name}: the same required arguments`);
    assert.equal(tool.saves, ["pause_campaign", "load_list", "send_test", "mark_reply_answered"].includes(tool.name), tool.name);
  }
});

test("every time in a result is also given in Toronto time", () => {
  assert.equal(torontoText("2026-11-13T18:01:00.000Z"), "Fri Nov 13, 1:01 p.m.");
  assert.equal(torontoText("2026-07-01T04:30:00Z"), "Wed Jul 1, 12:30 a.m.");
  assert.equal(torontoText("2026-11-13 18:01:00"), "Fri Nov 13, 1:01 p.m.", "the database's own timestamps are UTC");
  assert.equal(torontoText("2026-11-16"), null, "a day is already a Toronto day");
  assert.equal(torontoText("Fri"), null);
  assert.deepEqual(withTorontoTimes({ at: "2026-11-13T18:01:00.000Z", day: "2026-11-13", rows: [{ loadedAt: "2026-11-09T14:00:00Z", name: "x" }], none: null }),
    { at: "2026-11-13T18:01:00.000Z", atToronto: "Fri Nov 13, 1:01 p.m.", day: "2026-11-13", rows: [{ loadedAt: "2026-11-09T14:00:00Z", loadedAtToronto: "Mon Nov 9, 9:00 a.m.", name: "x" }], none: null });
});

// ---------- the read tools ----------
test("engine_today: what needs this founder, what today's sending looks like, pauses and every campaign's row", async () => {
  const s = setup();
  const riley = (await s.call("engine_today")).data;
  assert.equal(riley.founder, "Riley");
  assert.equal(riley.day, TODAY);
  assert.equal(riley.atToronto, "Fri Nov 13, 1:01 p.m.");
  assert.equal(riley.summary, "3 things need Riley.");
  assert.deepEqual(riley.needsYou.map((card: { title: string }) => card.title),
    ["Counties: IT and web contacts paused itself", "1 reply for you to answer", "districts-D1: 2 emails wait for your Approve"]);
  assert.equal(riley.needsYou[1].detail, "1 more waits for Aidan.");
  assert.equal(riley.needsYou[2].onScreen, "Read the samples: /campaigns/school-districts/batches/b-test-3");
  assert.ok(riley.alsoToKnow.includes("1 batch (2 emails) waits for Aidan to approve."));
  assert.equal(riley.sendingToday.emails, 2);
  assert.deepEqual(riley.sendingToday.inboxes.map((inbox: Json) => [inbox.address, inbox.owner, inbox.sentToday, inbox.limitToday, inbox.bouncesToday, inbox.resting]),
    [[AIDAN, "Aidan", 1, 60, 1, false], [RILEY, "Riley", 1, 60, 0, false]]);
  assert.deepEqual(riley.pauses, [{ campaign: "county-it", name: "Counties: IT and web contacts", reason: "3 of its emails bounced today", by: OUTREACH_AUTO_PAUSE_BY,
    at: "2026-11-12T19:30:00.000Z", atToronto: "Thu Nov 12, 2:30 p.m.", pausedItself: true }]);
  const cities = riley.campaigns.find((row: { key: string }) => row.key === "us-cities");
  assert.deepEqual([cities.state, cities.sentToday, cities.dailyLimit, cities.waitingToSend, cities.batchesWaitingForApproval, cities.replies, cities.bounced], ["live", 2, 30, 1, 1, 3, 1]);
  assert.deepEqual(riley.batchesWaitingForApproval.map((batch: Json) => [batch.id, batch.campaign, batch.ready, batch.held, batch.approvers.join()]).sort(),
    [["b-test-2", "us-cities", 2, 1, "Aidan"], ["b-test-3", "school-districts", 2, 0, "Riley"]]);
  assert.equal(riley.repliesToAnswer.count, 2);
  assert.deepEqual([...riley.repliesToAnswer.byInbox].sort((a: Json, b: Json) => a.inbox.localeCompare(b.inbox)), [{ inbox: AIDAN, owner: "Aidan", count: 1 }, { inbox: RILEY, owner: "Riley", count: 1 }]);
  assert.equal(riley.repliesToAnswer.newest[0].atToronto, "Fri Nov 13, 11:30 a.m.");
  assert.deepEqual(riley.replyCheck, { lastFinishedAt: "2026-11-13T17:35:00.000Z", lastFinishedAtToronto: "Fri Nov 13, 12:35 p.m.", couldNotOpen: [], stopped: false });

  // Aidan sees his own cards: the cities batch is his to approve.
  const aidan = (await s.call("engine_today", {}, "Aidan")).data;
  assert.deepEqual(aidan.needsYou.map((card: { title: string }) => card.title),
    ["Counties: IT and web contacts paused itself", "1 reply for you to answer", "cities-B1: 2 emails wait for your Approve"]);
  assert.deepEqual(await s.call("engine_today", { founder: "Aidan" }), { error: true, text: 'This tool doesn\'t take "founder". It takes no arguments.', data: undefined });
});

test("list_campaigns and get_campaign: state, today, totals, the success number and its label, batches, schedule, limits, the words and follow-ups", async () => {
  const s = setup();
  const list = (await s.call("list_campaigns")).data.campaigns;
  assert.deepEqual(list.map((row: Json) => [row.key, row.state]), [["us-cities", "live"], ["county-it", "paused"], ["school-districts", "live"]]);
  const cities = list[0];
  assert.deepEqual(cities.today, { sent: 2, dailyLimit: 30, followUpsDue: 0 });
  assert.deepEqual(cities.totals, { emailed: 7, followUpsSent: 0, replies: 3, automaticReplies: 0, noThanks: 1, bounced: 1, stoppedForGood: 1, failedToSend: 0, waitingToSend: 1, waitingForApproval: 2, held: 1 });
  assert.deepEqual(cities.success, { label: "Price requests", count: 1 });
  assert.deepEqual(list[2].success, { label: "Interested replies", count: 0 });
  assert.equal(list[1].pausedBecause, "3 of its emails bounced today");
  assert.equal(list[1].nextSend, "Paused. Nothing sends until a founder presses Resume.");
  assert.equal(list[1].stateAtToronto, "Thu Nov 12, 2:30 p.m.");

  const detail = (await s.call("get_campaign", { campaign: "us-cities" })).data;
  assert.equal(detail.name, "US cities: accessibility");
  assert.deepEqual(detail.numbers.success, { label: "Price requests", count: 1 });
  assert.equal(detail.numbers.emailed, 7);
  assert.deepEqual(detail.schedule, { sendDays: ["Mon", "Tue", "Wed", "Thu", "Fri"], sendHours: "9:00 a.m. to 2:30 p.m. Toronto time", startDay: "2026-11-02", endDay: null, goesBeforeCampaignsWithAHigherNumber: 10 });
  assert.equal(detail.limits.dailyLimit, 30);
  assert.deepEqual(detail.limits.inboxes.map((inbox: Json) => [inbox.address, inbox.mostPerDayForThisCampaign, inbox.sentTodayForThisCampaign, inbox.inboxLimitToday]), [[AIDAN, 15, 1, 60], [RILEY, 15, 1, 60]]);
  assert.equal(detail.words.firstEmail.subject, "{city}'s website: {error_count} accessibility problems");
  assert.equal(detail.words.followUps.length, 1);
  assert.deepEqual(detail.batches.map((batch: Json) => [batch.id, batch.phase, batch.rows, batch.ready, batch.held, batch.emailed, batch.replies, batch.noThanks, batch.bounced, batch.success]),
    [["b-test-2", "waiting", 3, 2, 1, 0, 0, 0, 0, 0], ["b-test-1", "sending", 8, 1, 0, 7, 2, 1, 1, 1]]);
  assert.deepEqual(detail.batches[0].heldReasons, [{ reason: "Not verified (verified is \"no\")", rows: 1 }]);
  assert.equal(detail.batches[1].approvedAtToronto, "Sun Nov 8, 3:00 p.m.");
  assert.deepEqual(detail.followUps, { coming: [{ day: "2026-11-16", people: 1 }, { day: "2026-11-20", people: 1 }], onHold: 0 });
  assert.equal(detail.bounces.length, 1);

  assert.deepEqual(await s.call("get_campaign", { campaign: "no-such-campaign" }), { error: true, text: "There's no such campaign. Use a key from list_campaigns.", data: undefined });
  assert.equal((await s.call("get_campaign", { campaign: "US Cities; DROP" })).text, '"campaign": Use a campaign key from list_campaigns, like us-cities.');
  assert.equal((await s.call("get_campaign")).text, '"campaign" is needed.');
});

test("list_batches and get_batch: batches by state in any campaign, and one batch's samples exactly as they go, with its held rows", async () => {
  const s = setup();
  const every = (await s.call("list_batches")).data;
  assert.deepEqual(every.batches.map((batch: Json) => [batch.id, batch.campaign, batch.state]), [["b-test-3", "school-districts", "waiting"], ["b-test-2", "us-cities", "waiting"], ["b-test-1", "us-cities", "sending"]]);
  assert.deepEqual((await s.call("list_batches", { state: "waiting" })).data.batches.map((batch: Json) => batch.id), ["b-test-3", "b-test-2"]);
  assert.deepEqual((await s.call("list_batches", { state: "done" })).data, { count: 0, batches: [] });
  const sending = (await s.call("list_batches", { campaign: "us-cities", state: "sending" })).data.batches;
  assert.deepEqual(sending.map((batch: Json) => [batch.id, batch.rows, batch.ready, batch.emailed, batch.followUpsLeft, batch.stoppedForGood, batch.approvedBy, batch.loadedAtToronto]),
    [["b-test-1", 8, 1, 7, 2, 5, "Aidan", "Sat Nov 7, 10:00 a.m."]]);
  assert.equal((await s.call("list_batches", { state: "approved" })).text, '"state" must be one of: waiting, sending, done, stopped, all.');
  assert.equal((await s.call("list_batches", { campaign: "nobody-here" })).text, "There's no such campaign. Use a key from list_campaigns.");

  const batch = (await s.call("get_batch", { batch: "b-test-2" })).data;
  assert.deepEqual([batch.batch.name, batch.batch.campaign, batch.batch.status, batch.batch.phase, batch.batch.approvers.join()], ["cities-B1", "us-cities", "waiting", "waiting", "Aidan"]);
  assert.equal(batch.samples.length, 2);
  assert.deepEqual([batch.samples[0].to, batch.samples[0].from, batch.samples[0].first.subject], ["ines@alderridge.example", `Aidan Sample <${AIDAN}>`, "Alder Ridge's website: 40 accessibility problems"]);
  assert.ok(batch.samples[0].first.text.startsWith("Hi Ines,\n\nWe checked Alder Ridge's website and found 40 problems."));
  assert.ok(batch.samples[0].first.text.endsWith(`Axiom · ${MAILING}\nNot useful? Reply "no thanks" and we won't email you again.`));
  assert.equal(batch.samples[0].followUp.subject, "Re: Alder Ridge's website: 40 accessibility problems");
  assert.equal(batch.samples[1].from, `Riley Sample <${RILEY}>`);
  assert.deepEqual(batch.heldRows, [{ row: 12, email: "greta@quillfeather.example", reason: "Not verified (verified is \"no\")" }]);
  assert.match(batch.note, /this connector can't approve\. Only Aidan can approve this campaign's batches\./);
  assert.equal((await s.call("get_batch", { batch: "b-nothing" })).text, "There's no such batch. Use an id from list_batches.");
  assert.equal((await s.call("get_batch", { batch: "../../settings" })).text, '"batch": Use a batch id from list_batches or get_campaign.');
});

test("list_replies and get_reply: the filters, one campaign, FCC's ended replies, since a day, and one reply with who answers it from which inbox", async () => {
  const s = setup();
  const waiting = (await s.call("list_replies")).data;
  assert.equal(waiting.filter, "to-answer");
  assert.deepEqual(waiting.replies.map((reply: Json) => [reply.id, reply.organisation, reply.answerFromName]), [[`${RILEY}:[Gmail]/All Mail:9001:c2`, "Maplewood Springs", "Riley"], ["contact:c8", "Fennimore Bay", "Aidan"]]);
  assert.deepEqual(waiting.howManyByFilter, { "to-answer": 2, answered: 1, automatic: 0, "no-thanks": 1, all: 4 });
  assert.equal(waiting.fccReplies, 1);
  assert.deepEqual((await s.call("list_replies", { filter: "answered" })).data.replies.map((reply: Json) => [reply.organisation, reply.answeredBy, reply.success, reply.successLabel, reply.answeredAtToronto]),
    [["Elm Hollow", "Aidan", true, "Price requests", "Tue Nov 10, 3:00 p.m."]]);
  assert.deepEqual((await s.call("list_replies", { filter: "no-thanks" })).data.replies.map((reply: Json) => reply.email), ["marcus@stonebridgeflats.example"]);
  assert.equal((await s.call("list_replies", { filter: "all", limit: 2 })).data.replies.length, 2);
  assert.deepEqual((await s.call("list_replies", { filter: "all", since: "2026-11-12" })).data.replies.map((reply: Json) => reply.organisation), ["Maplewood Springs", "Fennimore Bay"]);
  assert.equal((await s.call("list_replies", { campaign: "school-districts", filter: "all" })).data.replies.length, 0);
  const fcc = (await s.call("list_replies", { campaign: "fcc", filter: "all" })).data.replies;
  assert.deepEqual(fcc.map((reply: Json) => [reply.id, reply.organisation, reply.campaign, reply.canMark]), [["fcc:pat@haldentelecom.example", "Halden Telecom", "FCC (ended)", false]]);
  assert.equal((await s.call("list_replies", { since: "last Tuesday" })).text, '"since": Give a day or time like 2026-11-09 or 2026-11-09T14:00:00Z.');
  assert.equal((await s.call("list_replies", { limit: 500 })).text, '"limit" must be at most 100.');

  const one = (await s.call("get_reply", { id: `${RILEY}:[Gmail]/All Mail:9001:c2` })).data;
  assert.equal(one.reply.text, "Yes please, send the full report. What would the fixes cost?");
  assert.deepEqual([one.reply.person, one.reply.organisation, one.reply.from, one.reply.landedIn, one.reply.answerFrom, one.reply.atToronto], ["Sam", "Maplewood Springs", "sam@maplewoodsprings.example", RILEY, RILEY, "Fri Nov 13, 11:30 a.m."]);
  assert.equal(one.howToAnswer, `Riley answers from ${RILEY}, the inbox that sent the email, so the thread holds. Then mark it answered with mark_reply_answered.`);
  assert.equal((await s.call("get_reply", { id: "fcc:pat@haldentelecom.example" })).data.reply.text, 'They wrote back: "We already filed this ourselves."');
  assert.equal((await s.call("get_reply", { id: "contact:nobody" })).text, "There's no such reply. Use an id from list_replies.");
});

test("find_contact, check_do_not_email and inbox_health: where someone stands in every campaign, whether they are blocked and why, and each inbox today", async () => {
  const s = setup();
  const byPlace = (await s.call("find_contact", { query: "Maplewood" })).data;
  assert.equal(byPlace.found, 1);
  assert.deepEqual([byPlace.contacts[0].email, byPlace.contacts[0].campaignKey, byPlace.contacts[0].batch, byPlace.contacts[0].status, byPlace.contacts[0].statusText, byPlace.contacts[0].emailsSent, byPlace.contacts[0].replies, byPlace.contacts[0].blocked],
    ["sam@maplewoodsprings.example", "us-cities", "cities-A1", "replied", "Replied: no more emails", 1, 1, false]);
  assert.equal(byPlace.contacts[0].firstSentAtToronto, "Mon Nov 9, 10:02 a.m.");
  const byAddress = (await s.call("find_contact", { query: "marcus@stonebridgeflats.example" })).data;
  assert.deepEqual([byAddress.contacts[0].organisation, byAddress.contacts[0].blocked, byAddress.contacts[0].sentFrom], ["Stonebridge Flats", true, AIDAN]);
  assert.equal((await s.call("find_contact", { query: ".example", campaign: "school-districts" })).data.found, 2);
  assert.deepEqual((await s.call("find_contact", { query: "nobody at all" })).data.contacts, []);
  assert.deepEqual(await s.call("find_contact", { query: "x" }), { error: true, text: '"query" is too short: at least 2 characters.', data: undefined });

  const bounced = (await s.call("check_do_not_email", { address: "Elena@Northmere.example" })).data;
  assert.deepEqual([bounced.query, bounced.kind, bounced.blocked, bounced.summary], ["elena@northmere.example", "address", true, "elena@northmere.example is blocked. No campaign will email it."]);
  assert.deepEqual([bounced.reasons[0].why, bounced.reasons[0].campaign, bounced.reasons[0].atToronto], ["An email to it bounced", "US cities: accessibility", "Fri Nov 13, 10:00 a.m."]);
  assert.equal((await s.call("check_do_not_email", { address: "dana@porthalden.example" })).data.blocked, false);
  assert.equal((await s.call("check_do_not_email", { address: "stonebridgeflats.example" })).data.summary, "stonebridgeflats.example is not blocked as a whole, but 1 address at it is.");
  assert.deepEqual(await s.call("check_do_not_email", { address: "not an address" }), { error: true, text: "Type a full email address or a domain, like clerk@example.gov or example.gov.", data: undefined });

  const health = (await s.call("inbox_health")).data;
  assert.equal(health.emailsSentToday, 2);
  assert.equal(health.replyCheckLastFinishedAtToronto, "Fri Nov 13, 12:35 p.m.");
  const [aidan, riley] = health.inboxes;
  assert.deepEqual([aidan.address, aidan.owner, aidan.sentToday, aidan.limitToday, aidan.limitRightNow, aidan.bouncesToday, aidan.resting, aidan.lastReplyCheckAt, aidan.replyCheckCouldOpenIt],
    [AIDAN, "Aidan", 1, 60, 60, 1, false, "2026-11-13T17:35:00.000Z", true]);
  assert.deepEqual(aidan.campaigns.map((use: Json) => [use.key, use.state, use.mostPerDay, use.sentToday]), [["us-cities", "live", 15, 1], ["county-it", "paused", 10, 0]]);
  assert.deepEqual(riley.campaigns.map((use: Json) => [use.key, use.sentToday]), [["us-cities", 1], ["school-districts", 0]]);
  assert.equal(typeof riley.nextSend, "string");
});

// ---------- the write tools ----------
test("pause_campaign pauses one campaign with the reason as given, signed by the founder's connector; pausing twice keeps the first reason", async () => {
  const s = setup();
  const paused = (await s.call("pause_campaign", { campaign: "school-districts", reason: "Two bounces from this list already. Riley wants to look first." })).data;
  assert.deepEqual([paused.state, paused.changed, paused.by, paused.atToronto], ["paused", true, "Riley (via Claude connector)", "Fri Nov 13, 1:01 p.m."]);
  assert.match(paused.note, /this connector can't resume/);
  assert.deepEqual(s.all(`SELECT "state","stateReason","stateBy","stateAt" FROM "OutreachCampaign" WHERE "key" = 'school-districts'`),
    [{ state: "paused", stateReason: "Two bounces from this list already. Riley wants to look first.", stateBy: "Riley (via Claude connector)", stateAt: NOW.toISOString() }]);
  assert.deepEqual(s.all(`SELECT "key" FROM "OutreachCampaign" WHERE "state" = 'live'`), [{ key: "us-cities" }], "only that campaign");
  const again = (await s.call("pause_campaign", { campaign: "school-districts", reason: "A second reason" }, "Aidan")).data;
  assert.deepEqual([again.changed, again.reason, again.by], [false, "Two bounces from this list already. Riley wants to look first.", "Riley (via Claude connector)"]);
  assert.equal((await s.call("pause_campaign", { campaign: "school-districts" })).text, '"reason" is needed.');
  assert.equal((await s.call("pause_campaign", { campaign: "school-districts", reason: "x".repeat(301) })).text, '"reason" is too long: the most is 300 characters.');
  assert.equal((await s.call("pause_campaign", { campaign: "nobody-here", reason: "why" })).text, "There's no such campaign. Use a key from list_campaigns.");
});

test("check_list saves nothing and shows ready, held and the samples; load_list saves a batch that waits for its approver", async () => {
  const s = setup();
  const before = s.all(`SELECT COUNT(*) AS n FROM "OutreachBatch"`)[0]!.n;
  const checked = (await s.call("check_list", { campaign: "us-cities", name: "cities-C1", csv: CSV })).data;
  assert.deepEqual([checked.saved, checked.batch, checked.rows, checked.ready, checked.held, checked.emailDomainsChecked, checked.newWords], [false, null, 3, 2, 1, 3, false]);
  assert.deepEqual(checked.heldRows, [{ row: 4, email: "ines@bramblewick.example", reason: 'Not verified (verified is "no")' }]);
  assert.deepEqual(checked.samples.map((sample: Json) => [sample.to, sample.subject]), [["dana@marrowsound.example", "Marrow Sound's website: 41 accessibility problems"], ["omar@yarrowby.example", "Yarrowby's website: 58 accessibility problems"]]);
  assert.ok(checked.samples[0].text.includes(MAILING));
  assert.equal(checked.samples[0].followUp.subject, "Re: Marrow Sound's website: 41 accessibility problems");
  assert.equal(s.all(`SELECT COUNT(*) AS n FROM "OutreachBatch"`)[0]!.n, before, "a check saves nothing");
  assert.equal(s.all(`SELECT COUNT(*) AS n FROM "OutreachContact" WHERE "email" LIKE '%marrowsound%'`)[0]!.n, 0);

  // A domain with no mail server holds its row, as on the screen.
  const noMail = (await s.call("check_list", { campaign: "us-cities", name: "cities-C1", csv: CSV }, "Riley", { checkMail: async () => ({ noMailServer: new Map([["yarrowby.example", "has no mail server"]]), unreadable: [] }) })).data;
  assert.deepEqual([noMail.ready, noMail.held], [1, 2]);
  assert.ok(noMail.heldRows.some((row: Json) => row.reason === "yarrowby.example has no mail server, so the email would bounce"));
  const unreachable = await s.call("check_list", { campaign: "us-cities", name: "cities-C1", csv: CSV }, "Riley", { checkMail: async () => ({ noMailServer: new Map(), unreadable: ["yarrowby.example"] }) });
  assert.deepEqual(unreachable, { error: true, text: "Couldn't look up the mail servers of yarrowby.example. Nothing was loaded; try again in a minute.", data: undefined });

  const loaded = (await s.call("load_list", { campaign: "us-cities", name: "cities-C1", csv: CSV })).data;
  assert.deepEqual([loaded.saved, loaded.rows, loaded.ready, loaded.held], [true, 3, 2, 1]);
  assert.match(loaded.batch, /^b-new-\d+$/);
  assert.match(loaded.note, /waits for Aidan to read its samples and press Approve on the screen.*this connector can't approve/);
  assert.deepEqual(s.all(`SELECT "name","status","approvedBy","loadedBy","loadedAt","wordsVersion" FROM "OutreachBatch" WHERE "id" = ?`, loaded.batch),
    [{ name: "cities-C1", status: "waiting", approvedBy: null, loadedBy: "Riley (via Claude connector)", loadedAt: NOW.toISOString(), wordsVersion: VERSION }]);
  assert.deepEqual(s.all(`SELECT "status", COUNT(*) AS n FROM "OutreachContact" WHERE "batchId" = ? GROUP BY 1 ORDER BY 1`, loaded.batch), [{ status: "held", n: 1 }, { status: "ready", n: 2 }]);
  // The new batch shows up for its approver, and can be read back through the connector.
  assert.ok((await s.call("list_batches", { state: "waiting" })).data.batches.some((batch: Json) => batch.id === loaded.batch));
  assert.equal((await s.call("get_batch", { batch: loaded.batch })).data.samples.length, 2);

  // What the check itself refuses comes back as a plain sentence, and nothing is saved.
  assert.equal((await s.call("load_list", { campaign: "nobody-here", name: "x", csv: CSV })).text, "That campaign doesn't exist.");
  assert.equal((await s.call("check_list", { campaign: "us-cities", name: "x", csv: "first_name,city\nDana,Marrow Sound" })).error, true);
  assert.equal((await s.call("check_list", { campaign: "us-cities", csv: CSV })).text, '"name" is needed.');
  const big = ["email,first_name,city,verified,error_count", ...Array.from({ length: CONNECTOR_MAX_LIST_ROWS + 1 }, (_, i) => `person${i}@place${i}.example,Pat,Place ${i},yes,9`)].join("\n");
  assert.equal(CONNECTOR_MAX_LIST_ROWS, 10);
  assert.equal((await s.call("load_list", { campaign: "us-cities", name: "too-big", csv: big })).text,
    "This list has 11 rows. The connector takes up to 10 rows at a time; split it into smaller batches, or load it on the campaign's Load a list screen. Nothing was saved.");
  assert.equal((await s.call("check_list", { campaign: "us-cities", name: "too-big", csv: big })).error, true);
  assert.equal(s.all(`SELECT COUNT(*) AS n FROM "OutreachBatch" WHERE "name" = 'too-big'`)[0]!.n, 0);
});

test("send_test only ever queues to the calling founder's own inbox: an argument naming another address is refused, and nothing is queued for it", async () => {
  const s = setup();
  const queue = () => JSON.parse(s.all<{ value: string }>(`SELECT "value" FROM "KvStore" WHERE "key" = 'outreach.testRequests'`)[0]?.value ?? "[]") as Array<{ batchId: string; to: string; by: string; count: number; at: string }>;
  for (const hostile of [{ to: "someone@elsewhere.example" }, { email: "someone@elsewhere.example" }, { inbox: AIDAN }, { founder: "Aidan" }]) {
    const refused = await s.call("send_test", { batch: "b-test-2", ...hostile });
    assert.equal(refused.error, true);
    assert.match(refused.text, /^This tool doesn't take "\w+"\. It takes: batch, count\.$/);
  }
  assert.deepEqual(queue(), []);

  const mine = (await s.call("send_test", { batch: "b-test-2" })).data;
  assert.deepEqual([mine.queued, mine.batch, mine.campaign, mine.samples, mine.to], [true, "b-test-2", "us-cities", 3, OWNER_LOGINS.riley.inbox]);
  const his = (await s.call("send_test", { batch: "b-test-3", count: 1 }, "Aidan")).data;
  assert.equal(his.to, OWNER_LOGINS.aidan.inbox);
  assert.deepEqual(queue().map((request) => [request.batchId, request.to, request.by, request.count, request.at]),
    [["b-test-2", OWNER_LOGINS.riley.inbox, "Riley (via Claude connector)", 3, NOW.toISOString()], ["b-test-3", OWNER_LOGINS.aidan.inbox, "Aidan (via Claude connector)", 1, NOW.toISOString()]]);
  // Queuing writes no send row and opens no mail connection: the 15-minute check does that.
  assert.equal(s.all(`SELECT COUNT(*) AS n FROM "OutreachSend" WHERE "kind" = 'test'`)[0]!.n, 0);

  assert.equal((await s.call("send_test", { batch: "b-nothing" })).text, "There's no such batch. Use an id from list_batches.");
  assert.equal((await s.call("send_test", { batch: "b-test-2", count: 9 })).text, '"count" must be at most 3.');
  for (let i = 0; i < 3; i += 1) await s.call("send_test", { batch: "b-test-2" });
  assert.deepEqual(await s.call("send_test", { batch: "b-test-2" }), { error: true, text: "Five tests are already waiting; they go within 15 minutes.", data: undefined });
  assert.equal(queue().length, 5);
  assert.ok(queue().every((request) => request.to === OWNER_LOGINS.riley.inbox || request.to === OWNER_LOGINS.aidan.inbox));
});

test("mark_reply_answered marks a reply answered by the founder, and as a success when asked; it can be taken back", async () => {
  const s = setup();
  const id = `${RILEY}:[Gmail]/All Mail:9001:c2`;
  const marked = (await s.call("mark_reply_answered", { id })).data.reply;
  assert.deepEqual([marked.answeredBy, marked.answeredAt, marked.answeredAtToronto, marked.success], ["Riley", NOW.toISOString(), "Fri Nov 13, 1:01 p.m.", false]);
  assert.deepEqual((await s.call("list_replies")).data.replies.map((reply: Json) => reply.id), ["contact:c8"]);
  const counted = (await s.call("mark_reply_answered", { id, success: true })).data.reply;
  assert.deepEqual([counted.success, counted.successBy, counted.successLabel], [true, "Riley", "Price requests"]);
  assert.deepEqual((await s.call("list_campaigns")).data.campaigns[0].success, { label: "Price requests", count: 2 });
  const undone = (await s.call("mark_reply_answered", { id, answered: false, success: false })).data.reply;
  assert.deepEqual([undone.answeredAt, undone.answeredBy, undone.success], [null, null, false]);
  // A reply only the contact row knows gets a row for its mark.
  const unrecorded = (await s.call("mark_reply_answered", { id: "contact:c8" }, "Aidan")).data.reply;
  assert.deepEqual([unrecorded.id, unrecorded.answeredBy], ["contact:c8", "Aidan"]);
  assert.equal((await s.call("mark_reply_answered", { id: "fcc:pat@haldentelecom.example" })).text, "FCC ended on Nov 12, 2026. Its replies are kept to read and can't be marked.");
  assert.equal((await s.call("mark_reply_answered", { id: `${AIDAN}:[Gmail]/All Mail:9003:c4` })).text, "Only a person's reply can be marked answered. Automatic replies and no-thanks need no answer.");
  assert.equal((await s.call("mark_reply_answered", { id: "contact:nobody" })).text, "There's no such reply.");
  assert.equal((await s.call("mark_reply_answered", { id, answered: "yes" })).text, '"answered" must be true or false.');
});

// ---------- what the connector can't do ----------
test("no write tool can approve a batch or start a paused campaign again: hostile arguments are refused and the batches, live campaigns, do-not-email list, inboxes and limits stay as they were", async () => {
  const s = setup();
  const before = guarded(s);
  const batches = s.all(`SELECT COUNT(*) AS n FROM "OutreachBatch"`)[0]!.n;
  const reply = `${RILEY}:[Gmail]/All Mail:9001:c2`;
  const hostile: Array<[string, Record<string, unknown>]> = [
    ["pause_campaign", { campaign: "county-it", reason: "resume it", state: "live" }],
    ["pause_campaign", { campaign: "county-it", reason: "resume it", action: "resume" }],
    ["pause_campaign", { campaign: "county-it', \"state\" = 'live", reason: "x" }],
    ["pause_campaign", { campaign: "county-it", reason: "x", dailyLimit: 500, inboxesJson: "[]" }],
    ["load_list", { campaign: "us-cities", name: "sneaky", csv: CSV, approve: true }],
    ["load_list", { campaign: "us-cities", name: "sneaky", csv: CSV, status: "approved", approvedBy: "Aidan" }],
    ["load_list", { campaign: "us-cities", name: "sneaky", csv: CSV, save: false, loadedBy: "Aidan" }],
    ["check_list", { campaign: "us-cities", name: "sneaky", csv: CSV, save: true }],
    ["send_test", { batch: "b-test-2", approve: true }],
    ["send_test", { batch: "b-test-2", action: "approve" }],
    ["send_test", { batch: "b-test-2'; UPDATE \"OutreachBatch\" SET \"status\" = 'approved" }],
    ["mark_reply_answered", { id: "b-test-2" }],
    ["mark_reply_answered", { id: "b-test-2", answered: true, success: true }],
    ["mark_reply_answered", { id: reply, approve: true }],
    ["mark_reply_answered", { id: reply, status: "approved", batch: "b-test-2" }],
    ["get_batch", { batch: "b-test-2", action: "approve" }],
    ["check_do_not_email", { address: "elena@northmere.example", remove: true }],
    ["inbox_health", { dailyMax: 200 }],
  ];
  for (const [name, args] of hostile) {
    const refused = await s.call(name, args);
    assert.equal(refused.error, true, `${name} ${JSON.stringify(args)} must be refused`);
  }
  assert.equal(guarded(s), before);
  assert.equal(s.all(`SELECT COUNT(*) AS n FROM "OutreachBatch"`)[0]!.n, batches, "no batch was saved by a refused call");
  assert.deepEqual(s.all(`SELECT "state","stateBy" FROM "OutreachCampaign" WHERE "key" = 'county-it'`), [{ state: "paused", stateBy: OUTREACH_AUTO_PAUSE_BY }]);

  // Nothing with such a name exists either: Claude is told there is no such tool.
  for (const name of ["approve_batch", "resume_campaign", "stop_batch", "resume_fcc", "set_limit", "block_address", "unblock_address"]) {
    const answered = await answer({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { batch: "b-test-2", campaign: "county-it" } } }, s.context("Aidan"));
    assert.equal(answered && "error" in answered && answered.error.code, -32602, name);
  }

  // Then every write tool used properly, by the campaign's own approver: still nothing approved, nothing started again.
  await s.call("pause_campaign", { campaign: "county-it", reason: "Pausing a paused campaign changes nothing" }, "Aidan");
  await s.call("pause_campaign", { campaign: "school-districts", reason: "Pause is always allowed" }, "Aidan");
  const loaded = (await s.call("load_list", { campaign: "us-cities", name: "cities-C1", csv: CSV }, "Aidan")).data;
  await s.call("send_test", { batch: loaded.batch }, "Aidan");
  await s.call("mark_reply_answered", { id: reply, success: true }, "Aidan");
  const after = JSON.parse(guarded(s));
  assert.deepEqual(after.batches, JSON.parse(before).batches, "no batch changed its approval");
  assert.deepEqual(s.all(`SELECT "status","approvedBy","approvedAt","approvedWords" FROM "OutreachBatch" WHERE "id" = ?`, loaded.batch), [{ status: "waiting", approvedBy: null, approvedAt: null, approvedWords: null }]);
  assert.deepEqual(after.live, [{ key: "us-cities" }], "pause only ever takes a campaign out of live");
  assert.deepEqual(after.doNotEmail, JSON.parse(before).doNotEmail);
  assert.deepEqual(after.inboxes, JSON.parse(before).inboxes);
  assert.deepEqual(after.limits, JSON.parse(before).limits);
  assert.deepEqual(after.fcc, JSON.parse(before).fcc);
});

test("the connector's code has no path to approving, resuming, stopping a batch, FCC's switch or the do-not-email list", () => {
  const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  for (const name of ["mcp-tools.ts", "mcp-server.ts", "mcp-http.ts"]) {
    const source = read(name);
    for (const banned of ["approveBatch", "resumeCampaign", "stopBatch", "resumeFcc", "suppress"]) assert.ok(!source.toLowerCase().includes(banned.toLowerCase()), `${name} mentions ${banned}`);
    assert.ok(!/\b(?:UPDATE|INSERT|DELETE|REPLACE)\b/.test(source), `${name} writes no SQL of its own`);
    assert.ok(!/fcc-campaign|outreach-sender|outreach-worker|outreach-replies"/.test(source), `${name} imports nothing that sends or changes FCC`);
  }
  // Pause is the one switch it takes from the campaign controls.
  const controls = [...read("mcp-tools.ts").matchAll(/import \{([^}]+)\} from "@\/lib\/outreach\/outreach-control"/g)].map((match) => match[1]!.trim());
  assert.deepEqual(controls, ["pauseCampaign"]);
  assert.ok(!/outreach-control/.test(read("mcp-server.ts") + read("mcp-http.ts")));
  // The marked spot for the next tool is still there.
  assert.match(read("mcp-tools.ts"), /\n {2}\/\/ week_numbers goes here\n/);
});

test("every tool call, key check, rate limit and audit row included, stays well inside the database's 50 queries a request", async () => {
  const s = setup();
  const key = await makeKey(s.db, "Riley", "header", NOW);
  const full = ["email,first_name,city,verified,error_count", ...Array.from({ length: CONNECTOR_MAX_LIST_ROWS }, (_, i) => `person${i}@place${i}.example,Pat,Place ${i},yes,9`)].join("\n");
  const calls: Array<[string, Record<string, unknown>]> = [
    ["engine_today", {}], ["list_campaigns", {}], ["get_campaign", { campaign: "us-cities" }], ["list_batches", {}], ["get_batch", { batch: "b-test-1" }],
    ["list_replies", { filter: "all" }], ["list_replies", { campaign: "fcc", filter: "all" }], ["get_reply", { id: `${RILEY}:[Gmail]/All Mail:9001:c2` }], ["find_contact", { query: ".example", limit: 50 }],
    ["inbox_health", {}], ["check_do_not_email", { address: "elena@northmere.example" }], ["pause_campaign", { campaign: "school-districts", reason: "Counting queries" }],
    ["check_list", { campaign: "us-cities", name: "full list", csv: full }], ["load_list", { campaign: "us-cities", name: "full list", csv: full, first: `${FIRST}\nP.S. New words.`, followUp: FOLLOW }],
    ["send_test", { batch: "b-test-2" }], ["mark_reply_answered", { id: "contact:c8", success: true }],
  ];
  assert.deepEqual([...new Set(calls.map(([name]) => name))], [...READ_TOOLS, ...WRITE_TOOLS], "every tool is counted");
  const used: Record<string, number> = {};
  for (const [name, args] of calls) {
    const before = s.queries.count;
    const answered = await s.http({ key, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } });
    assert.equal(answered.body.result.isError, undefined, `${name}: ${answered.body.result.content[0].text}`);
    used[name] = Math.max(used[name] ?? 0, s.queries.count - before);
  }
  // Loading a full list is the heaviest call (two queries a row); every read stays under 30.
  for (const [name, count] of Object.entries(used)) assert.ok(count <= 35, `${name} used ${count} queries`);
  for (const name of READ_TOOLS) assert.ok(used[name]! < 30, `${name} used ${used[name]} queries`);
});

// ---------- time limits, failures and the audit log ----------
test("a tool that takes too long returns a plain error instead of hanging, and so does a database that stops answering", async () => {
  const s = setup();
  const started = Date.now();
  const slow = await s.call("check_list", { campaign: "us-cities", name: "cities-C1", csv: CSV }, "Riley", {
    timeoutMs: 40, checkMail: () => new Promise((resolve) => setTimeout(() => resolve({ noMailServer: new Map(), unreadable: [] }), 400)),
  });
  assert.deepEqual(slow, { error: true, text: "That took longer than 0.04 seconds, so the engine stopped waiting. Try again in a minute.", data: undefined });
  assert.ok(Date.now() - started < 350, "it answered at the time limit, not when the slow step finished");
  const slowSave = await s.call("load_list", { campaign: "us-cities", name: "cities-C1", csv: CSV }, "Riley", {
    timeoutMs: 40, checkMail: () => new Promise((resolve) => setTimeout(() => resolve({ noMailServer: new Map(), unreadable: [] }), 400)),
  });
  assert.equal(slowSave.text, "That took longer than 0.04 seconds, so the engine stopped waiting. It may or may not have been saved: look before you try again.");
  assert.deepEqual(s.audits.map((event) => [event.action, event.metadata.ok]), [["connector.check_list", false], ["connector.load_list", false]]);

  const key = await makeKey(s.db, "Riley", "header", NOW);
  s.breakDatabase();
  // The tool's own database reads fail: a JSON-RPC error for that call, nothing thrown.
  const inTool = await answerBody({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "list_campaigns", arguments: {} } }, s.context());
  assert.deepEqual(inTool.body, { jsonrpc: "2.0", id: 7, error: { code: -32603, message: "Something went wrong in the engine. Try again in a minute." } });
  assert.deepEqual(s.audits.at(-1)?.metadata, { via: "Claude connector", founder: "Riley", ok: false, write: false });
  // The whole database is down, key check included: still a JSON-RPC error, as HTTP 503.
  const down = await s.http({ key, body: { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "engine_today", arguments: {} } } });
  assert.equal(down.status, 503);
  assert.deepEqual(down.body, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "The engine couldn't answer just now. Try again in a minute." } });
});

test("every tool call writes one audit row: the tool, the founder, whether it worked and what it was about, never an address, a list or CSV text", async () => {
  const s = setup();
  const key = await makeKey(s.db, "Riley", "header", NOW);
  const tool = (name: string, args: Record<string, unknown>) => s.http({ key, headers: { "cf-connecting-ip": "203.0.113.20" }, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } });
  await s.http({ key, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  await tool("find_contact", { query: "sam@maplewoodsprings.example" });
  await tool("check_do_not_email", { address: "elena@northmere.example" });
  await tool("check_list", { campaign: "us-cities", name: "cities-C1", csv: CSV });
  await tool("load_list", { campaign: "us-cities", name: "cities-C1", csv: CSV });
  await tool("get_batch", { batch: "b-test-2" });
  await tool("mark_reply_answered", { id: `${RILEY}:[Gmail]/All Mail:9001:c2` });
  await tool("mark_reply_answered", { id: "fcc:pat@haldentelecom.example" });
  await tool("pause_campaign", { campaign: "school-districts", reason: "Riley asked: dana@marrowsound.example complained" });
  await tool("get_campaign", { campaign: "nobody-here" });
  await tool("pause_campaign", { campaign: "county-it", reason: "x", state: "live" });
  await tool("approve_batch", { batch: "b-test-2" });

  const rows = s.all<{ action: string; actorUserId: string | null; targetType: string; targetId: string | null; ipAddress: string; metadata: string }>(`SELECT * FROM "AuditEvent" ORDER BY rowid`);
  const fingerprint = async (address: string) => `#${(await sha256Hex(address)).slice(0, 10)}`;
  assert.deepEqual(rows.map((row) => [row.action, row.targetId, JSON.parse(row.metadata)]), [
    ["connector.find_contact", null, { via: "Claude connector", founder: "Riley", ok: true, write: false }],
    ["connector.check_do_not_email", null, { via: "Claude connector", founder: "Riley", ok: true, write: false }],
    ["connector.check_list", "us-cities", { via: "Claude connector", founder: "Riley", ok: true, write: false, target: "campaign" }],
    ["connector.load_list", "us-cities", { via: "Claude connector", founder: "Riley", ok: true, write: true, target: "campaign" }],
    ["connector.get_batch", "b-test-2", { via: "Claude connector", founder: "Riley", ok: true, write: false, target: "batch" }],
    ["connector.mark_reply_answered", `${await fingerprint(RILEY)}:[Gmail]/All Mail:9001:c2`, { via: "Claude connector", founder: "Riley", ok: true, write: true, target: "reply" }],
    ["connector.mark_reply_answered", `fcc:${await fingerprint("pat@haldentelecom.example")}`, { via: "Claude connector", founder: "Riley", ok: false, write: true, target: "reply" }],
    ["connector.pause_campaign", "school-districts", { via: "Claude connector", founder: "Riley", ok: true, write: true, target: "campaign" }],
    ["connector.get_campaign", "nobody-here", { via: "Claude connector", founder: "Riley", ok: false, write: false, target: "campaign" }],
    ["connector.pause_campaign", null, { via: "Claude connector", founder: "Riley", ok: false, write: true }],
    ["connector.unknown_tool", null, { via: "Claude connector", founder: "Riley", ok: false, write: false }],
  ]);
  assert.ok(rows.every((row) => row.targetType === "connector" && row.ipAddress === "203.0.113.20" && row.actorUserId === null));
  const everything = JSON.stringify(rows);
  for (const secret of ["@", ".example", "Marrow Sound", "first_name", "Riley asked", key, key.slice(4)]) assert.ok(!everything.includes(secret), `the audit log holds ${secret}`);

  // A failed audit write never fails the call: neither a writer that throws, nor a log table that is gone.
  const noLog = await s.call("list_campaigns", {}, "Riley", { audit: async () => { throw new Error("the audit log is down"); } });
  assert.equal(noLog.data.campaigns.length, 3);
  s.raw.exec(`DROP TABLE "AuditEvent"`);
  const stillWorks = await tool("list_campaigns", {});
  assert.equal(stillWorks.status, 200);
  assert.equal(stillWorks.body.result.structuredContent.campaigns.length, 3);
});
