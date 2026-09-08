import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { setCloudflareBindings, type D1DatabaseLike } from "../src/lib/cloudflare";
import { createOutboundApprovalStore } from "../src/lib/revenue-engine/outbound-approval-store";
import { handleApprovedManualReply } from "../src/lib/revenue-engine/manual-reply";
import { createManualReplyRuntime } from "../src/lib/revenue-engine/manual-reply-runtime";
import { outboundEnvelopeDigest, type OutboundEnvelope } from "../src/lib/revenue-engine/outbound-envelope";
import type { OutboundSendIntent } from "../src/lib/revenue-engine/outbound-send-intent-store";
import { syntheticReplyIdentity } from "./fixtures/reply-identity";
import { createSavedEmailHistoryReader } from "../src/lib/revenue-engine/saved-email-history";

test("manual reply claims recheck policy at the D1 write and retain one-winner budget/transport behavior", async () => {
  let externalRequests = 0, sends = 0;
  const runtime = new Miniflare(convertV4MiniflareOptions({ cf: false, workers: [{
    name: "manual-reply-claim-fixture", modules: true,
    script: "export default { fetch() { return new Response('synthetic'); } }",
    compatibilityDate: "2026-08-01", d1Databases: ["DB"],
    outboundService: async () => { externalRequests++; throw new Error("Fixture forbids external requests"); },
  }] }));
  try {
    const db = await runtime.getD1Database("DB");
    // Compile actual schema in disposable SQLite, then use its parsed individual
    // DDL statements in D1. No hand-splitting trigger bodies or live DB export.
    const schema = new Database(":memory:");
    try {
      assert.equal(schema.memory, true);
      for (const [file, tables] of [
        ["migrations/0001_cloudflare_auth_security.sql", ["User", "Session", "Lead"]],
        ["migrations/0006_outreach_automation_queue.sql", ["OutreachAutomationSetting", "OutreachSequence", "OutreachSuppression"]],
      ] as const) {
        const source = readFileSync(file, "utf8");
        for (const table of tables) {
          const ddl = source.match(new RegExp('CREATE TABLE "' + table + '" \\([\\s\\S]*?\\n\\);'));
          assert(ddl); schema.exec(ddl[0]);
        }
      }
      const emergency = readFileSync("migrations/0018_emergency_kill_switch.sql", "utf8")
        .match(/ALTER TABLE "OutreachAutomationSetting"\s+ADD COLUMN "emergencyPaused"[^;]+;/);
      assert(emergency); schema.exec(emergency[0]);
      for (const file of ["migrations/0073_outbound_send_intent.sql", "migrations/0074_outbound_envelope_approval.sql",
        "migrations/0075_provider_neutral_reply_identity.sql"]) {
        schema.exec(readFileSync(file, "utf8"));
      }
      const statements = schema.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
        .all() as { sql: string }[];
      await db.batch(statements.map(row => db.prepare(row.sql)));
    } finally { schema.close(); }
    await db.batch([
      db.prepare(`INSERT INTO "User" (id,name,email,emailVerified,role,updatedAt)
        VALUES ('owner','Synthetic','owner@example.invalid',1,'admin',CURRENT_TIMESTAMP)`),
      db.prepare(`INSERT INTO "Session" (id,userId,token,expiresAt,updatedAt)
        VALUES ('session','owner','synthetic-not-a-cookie',datetime('now','+1 hour'),CURRENT_TIMESTAMP)`),
      db.prepare(`INSERT INTO "Lead" (id,businessName,niche,city,lastUpdated)
        VALUES (1,'Synthetic','HVAC','Waterloo',CURRENT_TIMESTAMP)`),
      db.prepare(`INSERT INTO "OutreachAutomationSetting" (id,enabled,globalPaused,emergencyPaused,updatedAt)
        VALUES ('global',0,0,0,CURRENT_TIMESTAMP)`),
      db.prepare(`INSERT INTO "RuntimeBudgetMonth" (month,ceilingCents,committedCents,accountingDigest,paused)
        VALUES (strftime('%Y-%m','now'),5000,0,?,0)`).bind("e".repeat(64)),
    ]);
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "owner@example.invalid", AUTH_ADMIN_EMAILS: "owner@example.invalid" });
    const month = await db.prepare("SELECT strftime('%Y-%m','now') m").first<{ m: string }>();
    assert(month);
    const seed = async (key: string) => {
      const envelope: OutboundEnvelope = { version: "outbound-envelope-v2", replyTargetId: "target", ownerId: "owner", mailboxId: "nongoogle-fixture",
        connectionId: "fixture-connection", leadId: 1, policyVersion: "synthetic-v1", mode: "MANUAL_REPLY",
        from: "owner@example.invalid", fromName: null, to: "recipient@example.invalid", subject: "Requested details",
        bodyPlain: "Synthetic approved reply", bodyHtml: "", threadId: "fixture-thread", inReplyTo: "<parent@example.invalid>",
        references: ["<parent@example.invalid>"], rfcMessageId: `<${key}@example.invalid>` };
      const intent: OutboundSendIntent = { id: key.repeat(64), ownerId: "owner", mailboxId: envelope.mailboxId,
        operationKey: key, payloadDigest: await outboundEnvelopeDigest(envelope), mode: "MANUAL_REPLY",
        rfcMessageId: envelope.rfcMessageId, budgetMonth: month.m, reservedCostCents: 1 };
      if (key === "a") await db.batch(syntheticReplyIdentity(envelope).map(row => db.prepare(row.sql).bind(...row.args)));
      const clock = await db.prepare('SELECT unixepoch() n').first<{ n: number }>(); assert(clock);
      await createOutboundApprovalStore(database).approve({ intent, envelope, expiresAt: clock.n + 3600,
        actor: { actorUserId: "owner", actorSessionId: "session" } });
      return { intent, envelope };
    };
    let beforeClaim: (() => Promise<void>) | undefined;
    // Interleave a committed stop AFTER preparation but BEFORE the actual D1
    // insert. The guard must be in the write, not a prior SELECT or cached bool.
    const database: Pick<D1DatabaseLike, "prepare"> = { prepare(sql) {
      const wrap = (statement: ReturnType<typeof db.prepare>): ReturnType<D1DatabaseLike["prepare"]> => ({
        bind: (...values) => wrap(statement.bind(...values)),
        async first<T>() {
          if (sql.startsWith('INSERT INTO "OutboundSendIntent"') && beforeClaim) {
            const change = beforeClaim; beforeClaim = undefined; await change();
          }
          return statement.first<T>();
        },
        all: () => statement.all(), run: () => statement.run(),
      });
      return wrap(db.prepare(sql));
    } };
    const handlerRuntime = createManualReplyRuntime({ database,
      async assertAdditionalPolicy() { /* Remaining provider/consent/capacity facts are synthetic. */ },
      async transport(value) { sends++;
        return { messageId: "fake-" + value.rfcMessageId, threadId: "fixture-thread" };
      },
    });
    const invoke = (id: string) => handleApprovedManualReply(new Request("https://fixture.example.invalid/reply", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intentId: id }),
    }), "1", { userId: "owner", sessionId: "session" }, handlerRuntime);
    const stopped = await seed("a");
    beforeClaim = async () => { await db.prepare('UPDATE "OutreachAutomationSetting" SET emergencyPaused=1').run(); };
    assert.equal((await invoke(stopped.intent.id)).status, 503);
    assert.deepEqual(await db.prepare('SELECT count(*) n FROM "OutboundSendIntent"').first(), { n: 0 });
    assert.deepEqual(await db.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').first(), { n: 0 });
    assert.equal(sends, 0);
    await db.prepare('UPDATE "OutreachAutomationSetting" SET emergencyPaused=0').run();
    const replies = await Promise.all([invoke(stopped.intent.id), invoke(stopped.intent.id), invoke(stopped.intent.id)]);
    assert(replies.every(r => r.status === 200 || r.status === 202));
    assert.equal((await invoke(stopped.intent.id)).status, 200);
    assert.equal(sends, 1);
    const revoked = await seed("b");
    beforeClaim = async () => { await db.prepare('UPDATE "OutboundEnvelopeApproval" SET revokedAt=unixepoch() WHERE intentId=?').bind(revoked.intent.id).run(); };
    assert.equal((await invoke(revoked.intent.id)).status, 503);
    assert.deepEqual(await db.prepare('SELECT count(*) n FROM "OutboundSendIntent"').first(), { n: 1 });
    assert.deepEqual(await db.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').first(), { n: 1 });
    assert.equal(sends, 1);
    const optedOut = await seed("c");
    // This insertion happens AFTER the JS normalization read. Its absent raw
    // mapping must stop the atomic write, not be omitted as an unseen opt-out.
    beforeClaim = async () => { await db.prepare(`INSERT INTO "OutreachSuppression" (id,email,reason,source)
      VALUES ('new-opt-out','mailto:recipient@example.invalid','opt-out','UNSUBSCRIBE')`).run(); };
    assert.equal((await invoke(optedOut.intent.id)).status, 503);
    assert.equal((await invoke(optedOut.intent.id)).status, 503);
    assert.equal(sends, 1);
    assert.deepEqual(await db.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').first(), { n: 1 });
    await db.prepare(`UPDATE "OutreachSuppression" SET email='unrelated@elsewhere.invalid' WHERE id='new-opt-out'`).run();
    // A mutation of an existing row between normalization and write also denies.
    beforeClaim = async () => { await db.prepare(`UPDATE "OutreachSuppression" SET email='<recipient@example.invalid>' WHERE id='new-opt-out'`).run(); };
    assert.equal((await invoke(optedOut.intent.id)).status, 503);
    assert.equal(sends, 1);
    await db.prepare(`UPDATE "OutreachSuppression" SET email='unrelated@elsewhere.invalid' WHERE id='new-opt-out'`).run();
    for (const state of ["PAUSED", "DISCONNECTED"]) {
      beforeClaim = async () => { await db.prepare('UPDATE "RevenueMailboxIdentity" SET state=?').bind(state).run(); };
      assert.equal((await invoke(optedOut.intent.id)).status, 503);
      assert.deepEqual(await db.prepare('SELECT count(*) n FROM "OutboundSendIntent"').first(), { n: 1 });
      assert.deepEqual(await db.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').first(), { n: 1 });
      assert.equal(sends, 1);
      await db.prepare(`UPDATE "RevenueMailboxIdentity" SET state='READY'`).run();
    }
    beforeClaim = async () => { await db.prepare('UPDATE "RevenueMailReplyTarget" SET retiredAt=unixepoch()').run(); };
    assert.equal((await invoke(optedOut.intent.id)).status, 503);
    assert.deepEqual(await db.prepare('SELECT count(*) n FROM "OutboundSendIntent"').first(), { n: 1 });
    assert.deepEqual(await db.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').first(), { n: 1 });
    assert.equal(sends, 1);
    // Historical status has current owner scope but is not a new send admission.
    await db.prepare('UPDATE "RevenueMailboxIdentity" SET retiredAt=unixepoch()').run();
    await db.prepare('UPDATE "OutboundEnvelopeApproval" SET revokedAt=unixepoch() WHERE intentId=?').bind(stopped.intent.id).run();
    const recovered = await invoke(stopped.intent.id);
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json() as { state: string }).state, "SENT");
    const savedPage = await createSavedEmailHistoryReader(db)({ userId: "owner", sessionId: "session" }, 1, null);
    assert.equal(savedPage?.source, "SAVED_OUTBOUND_ONLY");
    assert.equal(savedPage?.records.length, 1);
    assert.equal(savedPage?.records[0].intentId, stopped.intent.id);
    assert.equal(savedPage?.records[0].state, "SENT");
    assert.equal(savedPage?.nextCursor, null);
    assert.deepEqual(await db.prepare('SELECT count(*) n FROM "OutboundSendIntent"').first(), { n: 1 });
    assert.deepEqual(await db.prepare('SELECT committedCents n FROM "RuntimeBudgetMonth"').first(), { n: 1 });
    assert.equal(sends, 1);
    assert.equal(externalRequests, 0);
  } finally { setCloudflareBindings(null); await runtime.dispose(); }
});
