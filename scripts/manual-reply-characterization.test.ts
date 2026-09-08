import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import Database from "better-sqlite3";
import ts from "typescript";
import { z } from "zod";
import { setCloudflareBindings, type D1DatabaseLike, type D1PreparedStatementLike } from "../src/lib/cloudflare";
import { createOutboundApprovalStore } from "../src/lib/revenue-engine/outbound-approval-store";
import { handleApprovedManualReply, type ManualReplyRuntime } from "../src/lib/revenue-engine/manual-reply";
import { createManualReplyRuntime, getManualReplyRuntime } from "../src/lib/revenue-engine/manual-reply-runtime";
import { createManualReplyHistory } from "../src/lib/revenue-engine/manual-reply-history";
import { outboundEnvelopeDigest, type OutboundEnvelope } from "../src/lib/revenue-engine/outbound-envelope";
import { createOutboundSendIntentStore, type OutboundSendIntent } from "../src/lib/revenue-engine/outbound-send-intent-store";
import { syntheticReplyIdentity } from "./fixtures/reply-identity";

// Executes the actual route with real handler/approval reader/ledger/dispatcher.
// HTTP authentication and provider identity INGESTION are synthetic. Approval
// creation, reads, account/stop/suppression and identity admission use real code.
// Consent/capacity and provider remain fixtures, not a working mailbox. History
// is derived from the real durable intent and approval, with no synthetic Map.
const routeSource = ts.transpileModule(readFileSync("src/app/api/clients/[id]/emails/reply/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
async function readDto(response: Response) {
  return z.object({ success: z.boolean(), state: z.string().optional(), error: z.string().optional(),
    intentId: z.string().optional() }).passthrough().parse(await response.json());
}
function route(runtime: () => ManualReplyRuntime | null = getManualReplyRuntime, denied = 0, owner = "owner") {
  const exports: { POST?: (request: Request, context: unknown) => Promise<Response> } = {};
  runInNewContext(routeSource, { exports, require(name: string) {
    if (name === "@/lib/session") return { requireAdminApiSession: async () => denied
      ? { response: new Response(null, { status: denied }) }
      : { session: { user: { id: owner }, session: { id: "session" } } } };
    if (name === "@/lib/revenue-engine/manual-reply") return { handleApprovedManualReply };
    if (name === "@/lib/revenue-engine/manual-reply-runtime") return { getManualReplyRuntime: runtime };
    assert.fail("Unexpected route authority: " + name); // Gmail/credentials/bindings fail here.
  } }, { timeout: 1000 });
  return (body: unknown = { intentId: "a".repeat(64) }, leadId = "1", mime = "application/json") =>
    exports.POST!(new Request("https://fixture.example.invalid/api/clients/" + leadId + "/emails/reply", {
      method: "POST", headers: { "content-type": mime }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: leadId }) });
}
async function fixture(recipient = "recipient@example.invalid") {
  const sqlite = new Database(":memory:");
  assert.equal(sqlite.memory, true);
  const auth = readFileSync("migrations/0001_cloudflare_auth_security.sql", "utf8");
  for (const table of ["User", "Session", "Lead"]) {
    const ddl = auth.match(new RegExp('CREATE TABLE "' + table + '" \\([\\s\\S]*?\\n\\);'));
    assert(ddl); sqlite.exec(ddl[0]);
  }
  sqlite.exec(readFileSync("migrations/0073_outbound_send_intent.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0074_outbound_envelope_approval.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0075_provider_neutral_reply_identity.sql", "utf8"));
  const outreach = readFileSync("migrations/0006_outreach_automation_queue.sql", "utf8");
  for (const table of ["OutreachAutomationSetting", "OutreachSequence", "OutreachSuppression"]) {
    const ddl = outreach.match(new RegExp('CREATE TABLE "' + table + '" \\([\\s\\S]*?\\n\\);'));
    assert(ddl); sqlite.exec(ddl[0]);
  }
  sqlite.exec('ALTER TABLE "OutreachAutomationSetting" ADD COLUMN emergencyPaused INTEGER NOT NULL DEFAULT 0');
  sqlite.exec(`INSERT INTO "User" (id,name,email,emailVerified,role,updatedAt)
    VALUES ('owner','Synthetic','owner@example.invalid',1,'admin',CURRENT_TIMESTAMP);
    INSERT INTO "Lead" (id,businessName,niche,city,lastUpdated)
    VALUES (1,'Synthetic','HVAC','Waterloo',CURRENT_TIMESTAMP);`);
  sqlite.exec(`INSERT INTO "Session" (id,userId,token,expiresAt,updatedAt)
    VALUES ('session','owner','synthetic-not-a-cookie',datetime('now','+1 hour'),CURRENT_TIMESTAMP);
    INSERT INTO "OutreachAutomationSetting" (id,enabled,globalPaused,emergencyPaused,updatedAt)
    VALUES ('global',0,0,0,CURRENT_TIMESTAMP);`);
  const month = (sqlite.prepare("SELECT strftime('%Y-%m','now') m").get() as { m: string }).m;
  sqlite.prepare(`INSERT INTO "RuntimeBudgetMonth" (month,ceilingCents,committedCents,accountingDigest,paused)
    VALUES (?,5000,0,?,0)`).run(month, "e".repeat(64));
  const envelope: OutboundEnvelope = { version: "outbound-envelope-v2", replyTargetId: "target", ownerId: "owner", mailboxId: "nongoogle-fixture",
    connectionId: "fixture-connection", leadId: 1, policyVersion: "synthetic-v1", mode: "MANUAL_REPLY",
    from: "owner@example.invalid", fromName: null, to: recipient, subject: "Requested details",
    bodyPlain: "Exact approved body.\r\nNo changes.", bodyHtml: "", threadId: "fixture-thread",
    inReplyTo: "<parent@example.invalid>", references: ["<parent@example.invalid>"], rfcMessageId: "<reply@example.invalid>" };
  const intent: OutboundSendIntent = { id: "a".repeat(64), ownerId: "owner", mailboxId: envelope.mailboxId,
    operationKey: "fixture-operation", payloadDigest: await outboundEnvelopeDigest(envelope), mode: "MANUAL_REPLY",
    rfcMessageId: envelope.rfcMessageId, budgetMonth: month, reservedCostCents: 1 };
  for (const row of syntheticReplyIdentity(envelope)) sqlite.prepare(row.sql).run(...row.args);
  setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "owner@example.invalid", AUTH_ADMIN_EMAILS: "owner@example.invalid" });
  const behavior = { sends: 0, timeout: false, historyFails: false, reject: false, denyPolicy: false, loseClaimAck: false };
  const hooks: { afterClaim?: () => void; afterHistoryRead?: () => void } = {};
  const database: D1DatabaseLike = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let args: unknown[] = [];
    const prepared: D1PreparedStatementLike = {
      bind(...values) { args = values; return prepared; },
      async first<T>() {
        if (sql.includes('AS "rowJson"') && behavior.historyFails
          && (sqlite.prepare(`SELECT count(*) n FROM "OutboundSendIntent" WHERE state='SENT'`).get() as { n: number }).n) {
          throw new Error("Synthetic history read failure");
        }
        const row = (statement.get(...args) ?? null) as T | null;
        if (sql.startsWith('INSERT INTO "OutboundSendIntent"') && row !== null) {
          hooks.afterClaim?.();
          if (behavior.loseClaimAck) throw new Error("Synthetic lost claim acknowledgement");
        }
        if (sql.includes('AS "rowJson"')) hooks.afterHistoryRead?.();
        return row;
      },
      async all<T>() { return { results: statement.all(...args) as T[] }; },
      async run() { return { meta: { changes: statement.run(...args).changes } }; },
    };
    return prepared;
  } };
  await createOutboundApprovalStore(database).approve({ intent, envelope,
    actor: { actorUserId: "owner", actorSessionId: "session" },
    expiresAt: (sqlite.prepare('SELECT unixepoch() n').get() as { n: number }).n + 3600 });
  const history = createManualReplyHistory(database);
  const runtime = createManualReplyRuntime({ database,
    async assertAdditionalPolicy(context) {
      assert.equal(context.actor.userId, "owner");
      assert.equal(context.actor.sessionId, "session");
      assert.equal(context.leadId, 1);
      assert.deepEqual(context.envelope, envelope);
      if (behavior.denyPolicy) throw new Error("Synthetic policy stop");
    },
    async transport(value) {
      assert.deepEqual(value, envelope);
      behavior.sends++;
      if (behavior.timeout) throw new Error("Private provider detail must not appear");
      return behavior.reject ? { rejected: true as const } : { messageId: "fixture-message", threadId: "fixture-thread" };
    },
  });
  return { sqlite, database, hooks, intent, envelope, behavior, runtime, history, invoke: route(() => runtime),
    sentRows: () => (sqlite.prepare(`SELECT count(*) n FROM "OutboundSendIntent" WHERE state='SENT'`).get() as { n: number }).n,
    close() { sqlite.close(); setCloudflareBindings(null); } };
}

test("real reply route preserves authentication denial and has no default transport or Gmail fallback", async () => {
  for (const status of [401, 403, 503]) {
    const invoke = route(() => { assert.fail("Denied request must not resolve runtime"); }, status);
    assert.equal((await invoke()).status, status);
  }
  for (const body of [{ intentId: "a".repeat(64) }, { to: "prospect@example.invalid", bodyPlain: "Legacy payload" }]) {
    const response = await route()(body);
    assert.equal(response.status, 503);
    assert.match((await readDto(response)).error ?? "", /non-Google/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("actual reply route submits once across concurrent requests and reconstructed handlers", async () => {
  const f = await fixture();
  try {
    const responses = await Promise.all([f.invoke(), f.invoke(), f.invoke()]);
    assert(responses.every(r => r.status === 200 || r.status === 202));
    const replay = await route(() => f.runtime)();
    assert.equal(replay.status, 200);
    assert.equal((await readDto(replay)).state, "SENT");
    assert.equal(f.behavior.sends, 1);
    assert.equal(f.sentRows(), 1);
    assert.deepEqual(f.sqlite.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').get(), { n: 1 });
    assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 1 });
  } finally { f.close(); }
});

test("revoking approval after route lookup prevents the claim, debit and provider call", async () => {
  const f = await fixture();
  try {
    const runtime: ManualReplyRuntime = { ...f.runtime, async loadApprovedReply(id) {
      const approved = await f.runtime.loadApprovedReply(id);
      f.sqlite.prepare('UPDATE "OutboundEnvelopeApproval" SET revokedAt=unixepoch() WHERE intentId=?').run(id);
      return approved;
    } };
    const response = await route(() => runtime)();
    assert.equal(response.status, 503);
    assert.equal(f.behavior.sends, 0);
    assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 0 });
    assert.deepEqual(f.sqlite.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').get(), { n: 0 });
  } finally { f.close(); }
});

test("mailbox and conversation retirement after lookup or claim cannot redirect or send the reply", async () => {
  const mutations = [
    `UPDATE "RevenueMailboxIdentity" SET state='PAUSED'`,
    `UPDATE "RevenueMailboxIdentity" SET state='DISCONNECTED'`,
    ...["RevenueMailboxIdentity", "RevenueMailConversation", "RevenueMailReplyTarget"].map(table => `UPDATE "${table}" SET retiredAt=unixepoch()`),
  ];
  for (const mutation of mutations) for (const boundary of ["lookup", "claim"] as const) {
    const f = await fixture();
    try {
      const runtime: ManualReplyRuntime = { ...f.runtime,
        async loadApprovedReply(id) {
          const approved = await f.runtime.loadApprovedReply(id);
          if (boundary === "lookup") f.sqlite.exec(mutation);
          return approved;
        },
      };
      if (boundary === "claim") f.hooks.afterClaim = () => f.sqlite.exec(mutation);
      const response = await route(() => runtime)();
      assert.equal(response.status, boundary === "lookup" ? 503 : 202);
      assert.equal(f.behavior.sends, 0);
      assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: boundary === "lookup" ? 0 : 1 });
      assert.deepEqual(f.sqlite.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').get(), { n: boundary === "lookup" ? 0 : 1 });
      if (boundary === "claim") assert.deepEqual(f.sqlite.prepare('SELECT state FROM "OutboundSendIntent"').get(), { state: "UNKNOWN" });
      await route(() => runtime)(); assert.equal(f.behavior.sends, 0);
    } finally { f.close(); }
  }
});

test("current account, stop and suppression changes after lookup deny without effects", async () => {
  const mutations = [
    `DELETE FROM "Session"`,
    `UPDATE "Session" SET expiresAt=datetime('now','-1 second')`,
    `UPDATE "Session" SET expiresAt='invalid'`,
    `UPDATE "Session" SET impersonatedBy='other'`,
    `UPDATE "User" SET banned=1`,
    `UPDATE "User" SET role='user'`,
    `UPDATE "User" SET emailVerified=0`,
    `UPDATE "Lead" SET isArchived=1`,
    `UPDATE "OutreachAutomationSetting" SET globalPaused=1`,
    `UPDATE "OutreachAutomationSetting" SET emergencyPaused=1`,
    `UPDATE "OutreachAutomationSetting" SET globalPaused='invalid'`,
    `DELETE FROM "OutreachAutomationSetting"`,
    `INSERT INTO "OutreachSuppression" (id,email,reason,source) VALUES ('stop','RECIPIENT@EXAMPLE.INVALID','unsubscribe','fixture')`,
    `INSERT INTO "OutreachSuppression" (id,domain,reason,source,expiresAt) VALUES ('stop','example.invalid','complaint','fixture','invalid')`,
    `INSERT INTO "OutreachSuppression" (id,leadId,reason,source,expiresAt) VALUES ('stop',1,'opt-out','fixture',datetime('now','+1 day'))`,
    `INSERT INTO "OutreachSuppression" (id,email,reason,source,expiresAt) VALUES ('stop','recipient@example.invalid','bounce','BOUNCE',datetime('now','-1 day'))`,
    `INSERT INTO "OutreachSuppression" (id,email,reason,source,expiresAt) VALUES ('stop','recipient@example.invalid','opt-out','UNSUBSCRIBE',datetime('now','-1 day'))`,
  ];
  for (const mutation of mutations) {
    const f = await fixture();
    try {
      const runtime: ManualReplyRuntime = { ...f.runtime, async loadApprovedReply(id) {
        const approved = await f.runtime.loadApprovedReply(id);
        f.sqlite.exec(mutation);
        return approved;
      } };
      assert.equal((await route(() => runtime)()).status, 503, mutation);
      assert.equal(f.behavior.sends, 0, mutation);
      assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 0 });
      assert.deepEqual(f.sqlite.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').get(), { n: 0 });
    } finally { f.close(); }
  }
});

test("expired and unrelated suppressions do not prevent an otherwise admitted manual reply", async () => {
  const f = await fixture();
  try {
    f.sqlite.exec(`INSERT INTO "OutreachSuppression" (id,email,domain,reason,source,expiresAt) VALUES
      ('expired','recipient@example.invalid',NULL,'temporary cooldown','fixture',datetime('now','-1 second')),
      ('unrelated','different@elsewhere.invalid','elsewhere.invalid','opt-out','fixture',NULL),
      ('sequence-stop','recipient@example.invalid','example.invalid','Reply detected','  reply  ',NULL);`);
    // Automated outreach is OFF in this fixture; manual reply is a distinct mode.
    assert.equal((await readDto(await f.invoke())).state, 'SENT');
    assert.equal(f.behavior.sends, 1);
  } finally { f.close(); }
});

test("legacy wrapped, encoded and www suppression representations cannot bypass a claim", async () => {
  for (const [email, domain] of [
    [' <recipient@example.invalid> ', null], ['mailto:recipient@example.invalid?subject=ignored', null],
    ['recipient%40example.invalid', null], ['\tRECIPIENT@EXAMPLE.INVALID\r\n', null],
    [null, 'www.example.invalid'], [null, 'https://www.example.invalid/path'],
  ]) {
    const f = await fixture();
    try {
      f.sqlite.prepare(`INSERT INTO "OutreachSuppression" (id,email,domain,reason,source)
        VALUES ('stop',?,?,'opt-out',' unsubscribe ')`).run(email, domain);
      assert.equal((await f.invoke()).status, 503);
      assert.equal(f.behavior.sends, 0);
      assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 0 });
    } finally { f.close(); }
  }
});

test("oversized suppression history stops instead of silently dropping rows", async () => {
  const f = await fixture();
  try {
    const insert = f.sqlite.prepare(`INSERT INTO "OutreachSuppression" (id,email,reason,source)
      VALUES (?, 'unrelated@elsewhere.invalid','fixture','REPLY')`);
    for (let i = 0; i < 1001; i++) insert.run(String(i));
    assert.equal((await f.invoke()).status, 503);
    assert.equal(f.behavior.sends, 0);
    assert.deepEqual(f.sqlite.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').get(), { n: 0 });
  } finally { f.close(); }
});

test("www recipient domains use the same suppression domain interpretation as legacy readers", async () => {
  const f = await fixture('recipient@www.example.invalid');
  try {
    f.sqlite.exec(`INSERT INTO "OutreachSuppression" (id,domain,reason,source)
      VALUES ('stop','example.invalid','opt-out','UNSUBSCRIBE')`);
    assert.equal((await f.invoke()).status, 503);
    assert.equal(f.behavior.sends, 0);
  } finally { f.close(); }
});

test("the final pre-transport check catches stops after a claim without granting another attempt", async () => {
  for (const mutation of [
    `UPDATE "OutboundEnvelopeApproval" SET revokedAt=unixepoch()`,
    `UPDATE "OutreachAutomationSetting" SET emergencyPaused=1`,
    `UPDATE "RuntimeBudgetMonth" SET paused=1`,
    `DELETE FROM "Session"`,
    `INSERT INTO "OutreachSuppression" (id,email,reason,source) VALUES ('stop','recipient@example.invalid','unsubscribe','fixture')`,
  ]) {
    const f = await fixture();
    try {
      f.hooks.afterClaim = () => f.sqlite.exec(mutation);
      const response = await f.invoke();
      assert.equal((await readDto(response)).state, 'DELIVERY_UNCERTAIN', mutation);
      assert.equal(f.behavior.sends, 0);
      assert.deepEqual(f.sqlite.prepare('SELECT state FROM "OutboundSendIntent"').get(), { state: 'UNKNOWN' });
      assert.deepEqual(f.sqlite.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').get(), { n: 1 });
      await route(() => f.runtime)();
      assert.equal(f.behavior.sends, 0);
      assert.equal(f.sentRows(), 0);
    } finally { f.close(); }
  }
});

test("a changed configured admission ceiling after approval lookup denies the claim", async () => {
  const f = await fixture();
  try {
    const runtime: ManualReplyRuntime = { ...f.runtime, async loadApprovedReply(id) {
      const approved = await f.runtime.loadApprovedReply(id);
      setCloudflareBindings({ AUTH_ALLOWED_EMAILS: 'different@example.invalid', AUTH_ADMIN_EMAILS: 'different@example.invalid' });
      return approved;
    } };
    assert.equal((await route(() => runtime)()).status, 503);
    assert.equal(f.behavior.sends, 0);
    assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 0 });
  } finally { f.close(); }
});

test("provider uncertainty is explicit, sanitized and never sends again on replay", async () => {
  const f = await fixture();
  try {
    f.behavior.timeout = true;
    for (let i = 0; i < 3; i++) {
      const response = await f.invoke();
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { success: false, state: "DELIVERY_UNCERTAIN", intentId: f.intent.id });
    }
    assert.equal(f.behavior.sends, 1);
    assert.equal(f.sentRows(), 0);
  } finally { f.close(); }
});

test("post-send history failure repairs history without repeating the send", async () => {
  const f = await fixture();
  try {
    f.behavior.historyFails = true;
    assert.equal((await readDto(await f.invoke())).state, "SENT_HISTORY_PENDING");
    assert.equal((await readDto(await f.invoke())).state, "STATUS_UNAVAILABLE");
    f.behavior.historyFails = false;
    assert.equal((await readDto(await f.invoke())).state, "SENT");
    assert.equal(f.behavior.sends, 1);
    assert.equal(f.sentRows(), 1);
    const saved = await f.history.readAccepted(f.intent.id, { userId: "owner", sessionId: "session" }, 1);
    assert.equal(saved.bodyPlain, f.envelope.bodyPlain);
    assert.equal(saved.messageId, "fixture-message");
  } finally { f.close(); }
});

test("an accepted reply remains recoverable after mailbox retirement without another send", async () => {
  const f = await fixture();
  try {
    f.behavior.historyFails = true;
    assert.equal((await readDto(await f.invoke())).state, "SENT_HISTORY_PENDING");
    f.sqlite.exec('UPDATE "RevenueMailboxIdentity" SET retiredAt=unixepoch()');
    f.sqlite.exec('UPDATE "OutboundEnvelopeApproval" SET revokedAt=unixepoch()');
    f.behavior.historyFails = false;
    assert.equal((await readDto(await f.invoke())).state, "SENT");
    assert.equal(f.behavior.sends, 1);
    assert.deepEqual(f.sqlite.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').get(), { n: 1 });
  } finally { f.close(); }
});

test("saved outcomes ignore send admission changes but never claim, debit or contact a provider", async () => {
  for (const state of ["SENT", "UNKNOWN", "DISPATCHING", "REJECTED"] as const) {
    const f = await fixture();
    try {
      f.behavior.timeout = state === "UNKNOWN";
      f.behavior.loseClaimAck = state === "DISPATCHING";
      f.behavior.reject = state === "REJECTED";
      await f.invoke();
      f.behavior.loseClaimAck = false;
      f.sqlite.exec(`UPDATE "RevenueMailboxIdentity" SET retiredAt=unixepoch();
        UPDATE "RevenueMailConversation" SET retiredAt=unixepoch();
        UPDATE "RevenueMailReplyTarget" SET retiredAt=unixepoch();
        UPDATE "OutboundEnvelopeApproval" SET revokedAt=unixepoch();
        UPDATE "OutreachAutomationSetting" SET emergencyPaused=1;
        UPDATE "RuntimeBudgetMonth" SET paused=1;
        UPDATE "Lead" SET isArchived=1;`);
      f.behavior.denyPolicy = true;
      const before = f.sqlite.prepare('SELECT total_changes() n').get();
      const sends = f.behavior.sends;
      const expected = state === "SENT" ? "SENT" : state === "REJECTED" ? "REJECTED" : "DELIVERY_UNCERTAIN";
      for (let retry = 0; retry < 2; retry++) {
        const result = await readDto(await route(() => f.runtime)());
        assert.equal(result.state, expected);
        assert(!JSON.stringify(result).includes("attemptToken"));
      }
      assert.deepEqual(f.sqlite.prepare('SELECT total_changes() n').get(), before);
      assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 1 });
      assert.deepEqual(f.sqlite.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').get(), { n: 1 });
      assert.equal(f.behavior.sends, sends);
    } finally { f.close(); }
  }
});

test("historical reads preserve current owner, session and client privacy, including a read-to-hash race", async () => {
  const changes = [
    `DELETE FROM "Session"`, `UPDATE "Session" SET expiresAt=datetime('now','-1 hour')`,
    `UPDATE "Session" SET impersonatedBy='other'`, `UPDATE "User" SET banned=1`,
    `UPDATE "User" SET role='user'`, `UPDATE "User" SET emailVerified=0`,
  ];
  for (const mutation of changes) {
    const f = await fixture();
    try {
      await f.invoke();
      assert.equal(await f.history.readReceipt(f.intent.id, { userId: "other", sessionId: "session" }, 1), null);
      assert.equal(await f.history.readReceipt(f.intent.id, { userId: "owner", sessionId: "other" }, 1), null);
      assert.equal(await f.history.readReceipt(f.intent.id, { userId: "owner", sessionId: "session" }, 2), null);
      f.hooks.afterHistoryRead = () => { f.hooks.afterHistoryRead = undefined; f.sqlite.exec(mutation); };
      await assert.rejects(f.history.readAccepted(f.intent.id, { userId: "owner", sessionId: "session" }, 1), /HISTORY_UNAVAILABLE/);
      assert.equal(f.behavior.sends, 1);
      assert.equal(await f.history.readReceipt(f.intent.id, { userId: "owner", sessionId: "session" }, 1), null);
    } finally { f.close(); }
  }
});

test("history remains visible after approval expiry and is reconstructed from durable exact content", async () => {
  const f = await fixture();
  try {
    await f.invoke();
    const actor = { userId: "owner", sessionId: "session" };
    const original = await f.history.readAccepted(f.intent.id, actor, 1);
    const expiry = (f.sqlite.prepare('SELECT expiresAt n FROM "OutboundEnvelopeApproval"').get() as { n: number }).n;
    f.sqlite.function("unixepoch", () => expiry + 1);
    const reconstructed = createManualReplyHistory(f.database);
    assert.deepEqual(await reconstructed.readAccepted(f.intent.id, actor, 1), original);
    assert.equal((await readDto(await f.invoke())).state, "SENT");
    assert.equal(original.status, "ACCEPTED");
    assert.equal(original.bodyPlain, f.envelope.bodyPlain);
    assert.equal(f.behavior.sends, 1);
  } finally { f.close(); }
});

test("manual runtime rejects raw-claim injection and keeps mandatory final checks inside its factory", async () => {
  const f = await fixture();
  try {
    const ledger = createOutboundSendIntentStore(f.database);
    const options = { database: f.database,
      async transport() { assert.fail("Denied configuration cannot send"); },
      async assertAdditionalPolicy() { /* Synthetic remaining policy only. */ },
    };
    assert.throws(() => createManualReplyRuntime({ ...options,
      // @ts-expect-error A raw persistence claim is not a manual runtime option.
      authorizeAndClaim: ledger.claim,
    }), /RUNTIME_INVALID/);
    assert.equal(f.behavior.sends, 0);
    assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 0 });
    f.hooks.afterClaim = () => f.sqlite.exec('UPDATE "OutreachAutomationSetting" SET emergencyPaused=1');
    assert.equal((await readDto(await f.invoke())).state, "DELIVERY_UNCERTAIN");
    assert.equal(f.behavior.sends, 0);
  } finally { f.close(); }
});

test("foreign owner/lead, revoked approval and browser envelope overrides cannot claim or send", async () => {
  const f = await fixture();
  try {
    assert.equal((await route(() => f.runtime, 0, "other")()).status, 409);
    assert.equal((await f.invoke(undefined, "2")).status, 409);
    for (const body of [null, [], {}, { intentId: f.intent.id, to: "other@example.invalid" },
      { intentId: f.intent.id, ownerId: "owner" }, { intentId: f.intent.id, reservedCostCents: 0 },
      { intentId: f.intent.id, bodyPlain: f.envelope.bodyPlain }, { intentId: "b".repeat(65) },
      { intentId: f.intent.id, padding: "x".repeat(1024) }]) assert.equal((await f.invoke(body)).status, 400);
    assert.equal((await f.invoke(undefined, "1e0")).status, 400);
    assert.equal((await f.invoke(undefined, "1\n")).status, 400);
    assert.equal((await f.invoke(undefined, "1", "text/plain")).status, 400);
    assert.equal((await f.invoke({ intentId: "b".repeat(64) })).status, 409);
    f.sqlite.exec('UPDATE "OutboundEnvelopeApproval" SET revokedAt=unixepoch()');
    assert.equal((await f.invoke()).status, 409);
    assert.equal(f.behavior.sends, 0);
    assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundSendIntent"').get(), { n: 0 });
  } finally { f.close(); }
});

test("policy/storage failures never expose details or grant a new attempt", async () => {
  const f = await fixture();
  try {
    f.behavior.denyPolicy = true;
    assert.equal((await readDto(await f.invoke())).state, "STATUS_UNAVAILABLE");
    assert.equal(f.behavior.sends, 0);
    f.behavior.denyPolicy = false;
    f.behavior.loseClaimAck = true;
    const failed = await f.invoke();
    assert.equal(failed.status, 503);
    const dto = await readDto(failed);
    assert.equal(dto.intentId, f.intent.id);
    assert.equal(dto.success, false);
    assert.equal(JSON.stringify(dto).includes("acknowledgement"), false);
    f.behavior.loseClaimAck = false;
    assert.equal((await readDto(await f.invoke())).state, "DELIVERY_UNCERTAIN");
    assert.equal(f.behavior.sends, 0);
  } finally { f.close(); }
});

test("mismatched stored intent/envelope is rejected before dispatch composition", async () => {
  const f = await fixture();
  try {
    for (const changed of [
      { intent: { ...f.intent, id: "b".repeat(64) }, envelope: f.envelope },
      { intent: { ...f.intent, mailboxId: "other" }, envelope: f.envelope },
      { intent: { ...f.intent, mode: "AUTOMATED" }, envelope: f.envelope },
      { intent: f.intent, envelope: { ...f.envelope, bodyPlain: "Altered" } },
      { intent: f.intent, envelope: { ...f.envelope, rfcMessageId: "<other@example.invalid>" } },
    ]) {
      const response = await route(() => ({
        async recover() { return null; },
        async loadApprovedReply() { return changed; },
        async dispatch() { assert.fail("Invalid approval must not reach a claim"); },
      }))();
      assert.equal(response.status, 409);
    }
    assert.equal(f.behavior.sends, 0);
  } finally { f.close(); }
});

test("streamed request byte limits and invalid UTF-8 fail before approval lookup", async () => {
  const actor = { userId: "owner", sessionId: "session" };
  const runtime: ManualReplyRuntime = {
    async recover() { assert.fail("Invalid request cannot read history"); },
    async loadApprovedReply() { assert.fail("Invalid request cannot read approval"); },
    async dispatch() { assert.fail("Invalid request cannot dispatch"); },
  };
  for (const bytes of [new Uint8Array(1025).fill(32), new Uint8Array([0xc3, 0x28])]) {
    const request = new Request("https://fixture.example.invalid/reply", {
      method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body: bytes,
    });
    const response = await handleApprovedManualReply(request, "1", actor, runtime);
    assert.equal(response.status, 400);
  }
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const request = new Request("https://fixture.example.invalid/reply", {
    method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half",
  } as RequestInit);
  assert.equal((await handleApprovedManualReply(request, "1", actor, runtime)).status, 400);
  assert.equal(cancelled, true);
});

test("definitive rejection and budget stop do not produce send success", async () => {
  const f = await fixture();
  try {
    f.sqlite.exec('UPDATE "RuntimeBudgetMonth" SET paused=1');
    assert.equal((await f.invoke()).status, 503);
    assert.equal(f.behavior.sends, 0);
    f.sqlite.exec('UPDATE "RuntimeBudgetMonth" SET paused=0');
    f.behavior.reject = true;
    for (let i = 0; i < 2; i++) {
      const response = await f.invoke();
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { success: false, state: "REJECTED", intentId: f.intent.id });
    }
    assert.equal(f.behavior.sends, 1);
  } finally { f.close(); }
});
