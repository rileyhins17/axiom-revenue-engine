import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { setCloudflareBindings, type D1DatabaseLike, type D1PreparedStatementLike } from "../../src/lib/cloudflare";
import { createOutboundApprovalStore } from "../../src/lib/revenue-engine/outbound-approval-store";
import { createManualReplyRuntime } from "../../src/lib/revenue-engine/manual-reply-runtime";
import { outboundEnvelopeDigest, type OutboundEnvelope } from "../../src/lib/revenue-engine/outbound-envelope";
import type { OutboundSendIntent } from "../../src/lib/revenue-engine/outbound-send-intent-store";
import { syntheticReplyIdentity } from "./reply-identity";

/** Disposable schema + real approval/runtime; synthetic identity/policy/transport.
 * No legacy mailbox, credentials, provider request or live resource is available. */
export function savedHistoryFixture() {
  const sqlite = new Database(":memory:");
  assert.equal(sqlite.memory, true);
  function tables(path: string, names: string[]) {
    const sql = readFileSync(path, "utf8");
    for (const name of names) {
      const ddl = sql.match(new RegExp('CREATE TABLE "' + name + '" \\([\\s\\S]*?\\n\\);'));
      assert(ddl); sqlite.exec(ddl[0]);
    }
  }
  tables("migrations/0001_cloudflare_auth_security.sql", ["User", "Session", "Lead"]);
  tables("migrations/0006_outreach_automation_queue.sql", ["OutreachAutomationSetting", "OutreachSequence", "OutreachSuppression"]);
  sqlite.exec('ALTER TABLE "OutreachAutomationSetting" ADD COLUMN emergencyPaused INTEGER NOT NULL DEFAULT 0');
  for (const name of ["0073_outbound_send_intent", "0074_outbound_envelope_approval", "0075_provider_neutral_reply_identity"]) {
    sqlite.exec(readFileSync(`migrations/${name}.sql`, "utf8"));
  }
  for (const owner of ["owner", "other"]) {
    sqlite.prepare(`INSERT INTO "User" (id,name,email,emailVerified,role,updatedAt) VALUES (?,?,?,1,'admin',CURRENT_TIMESTAMP)`)
      .run(owner, owner, `${owner}@example.invalid`);
    sqlite.prepare(`INSERT INTO "Session" (id,userId,token,expiresAt,updatedAt) VALUES (?,?,?,datetime('now','+1 hour'),CURRENT_TIMESTAMP)`)
      .run(`${owner}-session`, owner, `${owner}-synthetic-not-a-cookie`);
  }
  for (const leadId of [1, 2]) sqlite.prepare(`INSERT INTO "Lead" (id,businessName,niche,city,lastUpdated)
    VALUES (?,'Synthetic','HVAC','Waterloo',CURRENT_TIMESTAMP)`).run(leadId);
  sqlite.exec(`INSERT INTO "OutreachAutomationSetting" (id,enabled,globalPaused,emergencyPaused,updatedAt)
    VALUES ('global',0,0,0,CURRENT_TIMESTAMP)`);
  const month = (sqlite.prepare("SELECT strftime('%Y-%m','now') m").get() as { m: string }).m;
  sqlite.prepare(`INSERT INTO "RuntimeBudgetMonth" (month,ceilingCents,committedCents,accountingDigest,paused)
    VALUES (?,5000,0,?,0)`).run(month, "e".repeat(64));
  const policy = { AUTH_ALLOWED_EMAILS: "owner@example.invalid,other@example.invalid", AUTH_ADMIN_EMAILS: "owner@example.invalid,other@example.invalid" };
  setCloudflareBindings(policy);
  const hooks: { afterRead?: (sql: string) => void } = {};
  let sends = 0;
  const database: D1DatabaseLike = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let args: unknown[] = [];
    const prepared: D1PreparedStatementLike = {
      bind(...values) { args = values; return prepared; },
      async first<T>() { const row = (statement.get(...args) ?? null) as T | null; hooks.afterRead?.(sql); return row; },
      async all<T>() { const results = statement.all(...args) as T[]; hooks.afterRead?.(sql); return { results }; },
      async run() { return { meta: { changes: statement.run(...args).changes } }; },
    };
    return prepared;
  } };
  async function record(n: number, state: "SENT" | "UNKNOWN" | "REJECTED" = "SENT", owner = "owner", leadId = 1) {
    const envelope: OutboundEnvelope = { version: "outbound-envelope-v2", replyTargetId: `target-${n}`, ownerId: owner,
      mailboxId: `mailbox-${n}`, connectionId: `connection-${n}`, leadId, policyVersion: "synthetic-v1", mode: "MANUAL_REPLY",
      from: `${owner}@example.invalid`, fromName: null, to: "recipient@example.invalid", subject: `Saved reply ${n}`,
      bodyPlain: `Exact body ${n}. <img src="https://tracking.invalid/pixel">`, bodyHtml: '<img src="https://tracking.invalid/pixel">',
      threadId: `thread-${n}`, inReplyTo: `<parent-${n}@example.invalid>`, references: [], rfcMessageId: `<reply-${n}@example.invalid>` };
    for (const row of syntheticReplyIdentity(envelope)) sqlite.prepare(row.sql).run(...row.args);
    const intent: OutboundSendIntent = { id: n.toString(16).padStart(64, "0"), ownerId: owner, mailboxId: envelope.mailboxId,
      operationKey: `operation-${n}`, payloadDigest: await outboundEnvelopeDigest(envelope), mode: "MANUAL_REPLY",
      rfcMessageId: envelope.rfcMessageId, budgetMonth: month, reservedCostCents: 1 };
    const actor = { userId: owner, sessionId: `${owner}-session` };
    await createOutboundApprovalStore(database).approve({ intent, envelope,
      actor: { actorUserId: owner, actorSessionId: actor.sessionId },
      expiresAt: (sqlite.prepare('SELECT unixepoch() n').get() as { n: number }).n + 3600 });
    const runtime = createManualReplyRuntime({ database, async assertAdditionalPolicy() { /* Synthetic only. */ },
      async transport() {
        sends++;
        if (state === "UNKNOWN") throw new Error("Synthetic provider uncertainty");
        return state === "REJECTED" ? { rejected: true } : { messageId: `message-${n}`, threadId: envelope.threadId! };
      } });
    await runtime.dispatch({ actor, leadId, intent, envelope });
    return { intent, envelope };
  }
  return { sqlite, database, hooks, policy, record, sends: () => sends,
    actor: { userId: "owner", sessionId: "owner-session" },
    changes: () => (sqlite.prepare('SELECT total_changes() n').get() as { n: number }).n,
    close() { sqlite.close(); setCloudflareBindings(null); } };
}
