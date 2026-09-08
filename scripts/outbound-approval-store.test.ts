import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { setCloudflareBindings, type D1DatabaseLike, type D1PreparedStatementLike } from "../src/lib/cloudflare";
import { createOutboundApprovalStore } from "../src/lib/revenue-engine/outbound-approval-store";
import { outboundEnvelopeDigest, type OutboundEnvelope } from "../src/lib/revenue-engine/outbound-envelope";
import { createOutboundSendIntentStore, type OutboundSendIntent } from "../src/lib/revenue-engine/outbound-send-intent-store";
import { createOutboundDispatcher } from "../src/lib/revenue-engine/outbound-dispatch";
import { syntheticReplyIdentity } from "./fixtures/reply-identity";

const actor = { actorUserId: "owner", actorSessionId: "session" };
const envelope: OutboundEnvelope = { version: "outbound-envelope-v2", replyTargetId: "target", ownerId: "owner", mailboxId: "mailbox",
  connectionId: "connection", leadId: 1, policyVersion: "synthetic-v1", mode: "MANUAL_REPLY",
  from: "owner@example.invalid", fromName: null, to: "recipient@example.invalid", subject: "Approved reply",
  bodyPlain: "Approved body", bodyHtml: "", threadId: "thread", inReplyTo: "<parent@example.invalid>",
  references: ["<parent@example.invalid>"], rfcMessageId: "<intent@example.invalid>" };
async function fixture() {
  const sqlite = new Database(":memory:");
  const authSchema = readFileSync("migrations/0001_cloudflare_auth_security.sql", "utf8");
  for (const [schema, table] of [[authSchema, "User"], [authSchema, "Session"], [authSchema, "Lead"]]) {
    const ddl = schema.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`));
    assert(ddl); sqlite.exec(ddl[0]);
  }
  sqlite.exec(readFileSync("migrations/0074_outbound_envelope_approval.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0075_provider_neutral_reply_identity.sql", "utf8"));
  sqlite.exec(`INSERT INTO "User" (id,name,email,emailVerified,role,updatedAt)
    VALUES ('owner','Synthetic','owner@example.invalid',1,'admin',CURRENT_TIMESTAMP);
    INSERT INTO "Session" (id,userId,token,expiresAt,updatedAt)
    VALUES ('session','owner','synthetic-session-token',datetime('now','+1 day'),CURRENT_TIMESTAMP);
    INSERT INTO "Lead" (id,businessName,niche,city,lastUpdated) VALUES (1,'Synthetic','HVAC','Waterloo',CURRENT_TIMESTAMP);`);
  for (const row of syntheticReplyIdentity(envelope)) sqlite.prepare(row.sql).run(...row.args);
  setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "owner@example.invalid", AUTH_ADMIN_EMAILS: "owner@example.invalid" });
  const hooks: { afterRead?: (sql: string) => void; beforeFirst?: (sql: string) => void } = {};
  const database: D1DatabaseLike = { prepare(sql) {
    let args: unknown[] = [];
    const statement = sqlite.prepare(sql);
    const prepared: D1PreparedStatementLike = { bind(...values) { args = values; return prepared; },
      async first<T>() { hooks.beforeFirst?.(sql); const row = (statement.get(...args) ?? null) as T | null; hooks.afterRead?.(sql); return row; },
      async all() { assert.fail("Unexpected all"); }, async run() { assert.fail("Unexpected run"); } };
    return prepared;
  } };
  const intent: OutboundSendIntent = { id: "a".repeat(64), ownerId: "owner", mailboxId: "mailbox", operationKey: "operation",
    payloadDigest: await outboundEnvelopeDigest(envelope), mode: envelope.mode, rfcMessageId: envelope.rfcMessageId,
    budgetMonth: new Date().toISOString().slice(0,7), reservedCostCents: 1 };
  const expiresAt = (sqlite.prepare("SELECT unixepoch() n").get() as { n: number }).n + 3600;
  return { sqlite, database, hooks, store: createOutboundApprovalStore(database), input: { actor, intent, envelope, expiresAt },
    close() { sqlite.close(); setCloudflareBindings(null); } };
}

test("an exact digest cannot authorize a recipient outside the recorded conversation", async () => {
  const f = await fixture();
  try {
    const changed = { ...f.input.envelope, to: "unrelated@example.invalid" };
    const intent = { ...f.input.intent, payloadDigest: await outboundEnvelopeDigest(changed) };
    await assert.rejects(f.store.approve({ ...f.input, intent, envelope: changed }), /DENIED_OR_CONFLICT/);
    assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundEnvelopeApproval"').get(), { n: 0 });
  } finally { f.close(); }
});

test("manual admission binds the exact target, mailbox, client, recipient and parent lineage", async () => {
  const changes = [
    { replyTargetId: "missing" }, { replyTargetId: "other-target" }, { mailboxId: "other-mailbox" },
    { connectionId: "other-connection" }, { leadId: 2 }, { from: "alias@example.invalid" },
    { threadId: "unrelated-thread" }, { inReplyTo: "<unrelated@example.invalid>" },
    { references: ["<unrelated@example.invalid>", "<parent@example.invalid>"] },
    { to: "Recipient@example.invalid" }, // Identity bytes are never rewritten after approval.
  ];
  for (const change of changes) {
    const f = await fixture();
    try {
      f.sqlite.exec(`INSERT INTO "Lead" (id,businessName,niche,city,lastUpdated)
        VALUES (2,'Another synthetic business','HVAC','Waterloo',CURRENT_TIMESTAMP)`);
      // Same provider thread string in a different mailbox is NOT this conversation.
      for (const row of syntheticReplyIdentity({ ...envelope, mailboxId: "other-mailbox",
        connectionId: "other-connection", leadId: 2, replyTargetId: "other-target" })) {
        f.sqlite.prepare(row.sql).run(...row.args);
      }
      const changed = { ...envelope, ...change };
      const intent = { ...f.input.intent, mailboxId: changed.mailboxId, payloadDigest: await outboundEnvelopeDigest(changed) };
      await assert.rejects(f.store.approve({ ...f.input, intent, envelope: changed }), /DENIED_OR_CONFLICT/);
      assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundEnvelopeApproval"').get(), { n: 0 });
    } finally { f.close(); }
  }
});

test("legacy v1 is not promoted, and recorded recipients survive a changed general lead email", async () => {
  const f = await fixture();
  try {
    const legacy: Record<string, unknown> = { ...envelope, version: "outbound-envelope-v1" };
    delete legacy.replyTargetId;
    const intent = { ...f.input.intent, payloadDigest: await outboundEnvelopeDigest(legacy) };
    await assert.rejects(f.store.approve({ ...f.input, intent, envelope: legacy }), /DENIED_OR_CONFLICT/);
    f.sqlite.exec(`UPDATE "Lead" SET email='new-general-contact@example.invalid'`);
    assert.deepEqual(await f.store.approve(f.input), envelope);
  } finally { f.close(); }
});

test("missing schema and default-disconnected mailboxes do not create approvals", async () => {
  const f = await fixture();
  try {
    f.sqlite.exec(`INSERT INTO "RevenueMailboxIdentity" (id,ownerId,providerKey,providerAccountId,connectionId,address)
      VALUES ('default','owner','synthetic','default-account','default-connection','owner@example.invalid')`);
    assert.deepEqual(f.sqlite.prepare(`SELECT state FROM "RevenueMailboxIdentity" WHERE id='default'`).get(), { state: "DISCONNECTED" });
    f.sqlite.exec('DROP TABLE "RevenueMailReplyTarget"'); // Disposable schema-unavailable failure, not live maintenance.
    await assert.rejects(f.store.approve(f.input));
    assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundEnvelopeApproval"').get(), { n: 0 });
  } finally { f.close(); }
});

test("identity retirement and pauses are checked in approval writes, reloads and exact replay", async () => {
  const mutations = [
    `UPDATE "RevenueMailboxIdentity" SET state='PAUSED'`,
    `UPDATE "RevenueMailboxIdentity" SET state='DISCONNECTED'`,
    ...["RevenueMailboxIdentity", "RevenueMailConversation", "RevenueMailReplyTarget"].map(table => `UPDATE "${table}" SET retiredAt=unixepoch()`),
  ];
  for (const mutation of mutations) for (const boundary of ["insert", "reload"] as const) {
    const f = await fixture();
    try {
      if (boundary === "insert") {
        f.hooks.beforeFirst = sql => {
          if (!sql.startsWith('INSERT INTO "OutboundEnvelopeApproval"')) return;
          f.hooks.beforeFirst = undefined; f.sqlite.exec(mutation);
        };
        await assert.rejects(f.store.approve(f.input), /DENIED_OR_CONFLICT/);
        assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundEnvelopeApproval"').get(), { n: 0 });
      } else {
        await f.store.approve(f.input);
        f.hooks.afterRead = sql => {
          if (!sql.startsWith("SELECT a.")) return;
          f.hooks.afterRead = undefined; f.sqlite.exec(mutation);
        };
        await assert.rejects(f.store.loadEnvelope(f.input.intent), /CONTENT_CONFLICT/);
        await assert.rejects(f.store.approve(f.input), /DENIED_OR_CONFLICT/);
      }
    } finally { f.close(); }
  }
});

test("retired identities cannot be rewritten, reused or replaced to revive an approval", async () => {
  const f = await fixture();
  try {
    await f.store.approve(f.input);
    for (const sql of [
      `UPDATE "RevenueMailboxIdentity" SET ownerId='other'`,
      `UPDATE "RevenueMailboxIdentity" SET connectionId='replacement'`,
      `UPDATE "RevenueMailboxIdentity" SET address='other@example.invalid'`,
      `UPDATE "RevenueMailboxIdentity" SET providerAccountId='replacement'`,
      `UPDATE "RevenueMailConversation" SET leadId=2`,
      `UPDATE "RevenueMailConversation" SET providerThreadId='other'`,
      `UPDATE "RevenueMailReplyTarget" SET recipientAddress='other@example.invalid'`,
      `UPDATE "RevenueMailReplyTarget" SET inReplyTo='<other@example.invalid>'`,
      `UPDATE "RevenueMailReplyTarget" SET referencesJson='[]'`,
    ]) assert.throws(() => f.sqlite.exec(sql));
    for (const table of ["RevenueMailReplyTarget", "RevenueMailConversation", "RevenueMailboxIdentity"]) {
      assert.throws(() => f.sqlite.exec(`DELETE FROM "${table}"`));
      assert.throws(() => f.sqlite.exec(`INSERT OR REPLACE INTO "${table}" SELECT * FROM "${table}"`));
      f.sqlite.exec(`UPDATE "${table}" SET retiredAt=unixepoch()`);
      assert.throws(() => f.sqlite.exec(`UPDATE "${table}" SET retiredAt=NULL`));
    }
    // A fresh connection and target for the same address/thread cannot revive
    // the old target-bound approval. It needs its own explicit approval.
    for (const row of syntheticReplyIdentity({ ...envelope, mailboxId: "replacement",
      connectionId: "replacement-connection", replyTargetId: "replacement-target" })) {
      f.sqlite.prepare(row.sql).run(...row.args);
    }
    await assert.rejects(f.store.loadEnvelope(f.input.intent), /UNAVAILABLE/);
  } finally { f.close(); }
});

test("correcting a retired conversation requires a new target and new approval", async () => {
  const f = await fixture();
  try {
    await f.store.approve(f.input);
    f.sqlite.exec(`UPDATE "RevenueMailConversation" SET retiredAt=unixepoch();
      INSERT INTO "Lead" (id,businessName,niche,city,lastUpdated)
        VALUES (2,'Corrected synthetic business','HVAC','Waterloo',CURRENT_TIMESTAMP);
      INSERT INTO "RevenueMailConversation" (id,mailboxId,leadId,providerThreadId) VALUES ('corrected','mailbox',2,'thread');
      INSERT INTO "RevenueMailReplyTarget" (id,conversationId,providerMessageId,recipientAddress,inReplyTo,referencesJson)
        SELECT 'corrected-target','corrected',providerMessageId,recipientAddress,inReplyTo,referencesJson FROM "RevenueMailReplyTarget";`);
    await assert.rejects(f.store.loadEnvelope(f.input.intent), /UNAVAILABLE/);
    const changed = { ...envelope, leadId: 2, replyTargetId: "corrected-target", rfcMessageId: "<corrected@example.invalid>" };
    const intent = { ...f.input.intent, id: "b".repeat(64), operationKey: "corrected",
      rfcMessageId: changed.rfcMessageId, payloadDigest: await outboundEnvelopeDigest(changed) };
    assert.deepEqual(await f.store.approve({ ...f.input, intent, envelope: changed }), changed);
    await assert.rejects(f.store.loadEnvelope(f.input.intent), /UNAVAILABLE/);
  } finally { f.close(); }
});

test("current admin approval persists exact content, replays without mutation and revokes once", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.store.loadEnvelope(f.input.intent), /OUTBOUND_APPROVAL_UNAVAILABLE/);
    assert.deepEqual(await f.store.approve(f.input), envelope);
    const original = f.sqlite.prepare('SELECT * FROM "OutboundEnvelopeApproval"').get();
    assert.deepEqual(await f.store.approve(f.input), envelope);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM "OutboundEnvelopeApproval"').get(), original);
    await assert.rejects(f.store.approve({ ...f.input, expiresAt: f.input.expiresAt + 1 }), /DENIED_OR_CONFLICT/);
    await f.store.revoke(f.input.intent.id, actor);
    await f.store.revoke(f.input.intent.id, actor);
    await assert.rejects(f.store.loadEnvelope(f.input.intent), /UNAVAILABLE/);
    await assert.rejects(f.store.approve(f.input), /DENIED_OR_CONFLICT/);
  } finally { f.close(); }
});

test("stale sessions, unverified/banned/nonadmin actors and archived leads cannot approve", async () => {
  for (const mutation of [
    `DELETE FROM "Session"`, `UPDATE "Session" SET expiresAt=datetime('now','-1 hour')`,
    `UPDATE "User" SET role='user'`, `UPDATE "User" SET emailVerified=0`, `UPDATE "User" SET banned=1`,
    `UPDATE "Lead" SET isArchived=1`, `UPDATE "RevenueMailboxIdentity" SET state='DISCONNECTED'`,
    `UPDATE "Session" SET impersonatedBy='other'`, `UPDATE "Session" SET createdAt=datetime('now','+1 hour')`,
  ]) {
    const f = await fixture();
    try {
      f.sqlite.exec(mutation);
      await assert.rejects(f.store.approve(f.input), /DENIED_OR_CONFLICT/);
      assert.deepEqual(f.sqlite.prepare('SELECT count(*) n FROM "OutboundEnvelopeApproval"').get(), { n: 0 });
    } finally { f.close(); }
  }
});

test("stored approvals cannot override current owner policy, revocation or content identity", async () => {
  const f = await fixture();
  try {
    await f.store.approve(f.input);
    await assert.rejects(f.store.loadEnvelope({ ...f.input.intent, operationKey: "changed" }), /CONTENT_CONFLICT/);
    await assert.rejects(f.store.approve({ ...f.input, envelope: { ...envelope, to: "changed@example.invalid" } }), /CONTENT_CONFLICT/);
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "other@example.invalid", AUTH_ADMIN_EMAILS: "other@example.invalid" });
    await assert.rejects(f.store.loadEnvelope(f.input.intent), /UNAVAILABLE/);
    await assert.rejects(f.store.approve(f.input), /DENIED_OR_CONFLICT/);
    await assert.rejects(f.store.revoke(f.input.intent.id, actor), /DENIED_OR_CONFLICT/);
  } finally { f.close(); }
});

test("approval database guards prevent rewriting, renewing, replacing and deleting history", async () => {
  const f = await fixture();
  try {
    await f.store.approve(f.input);
    for (const sql of [
      `UPDATE "OutboundEnvelopeApproval" SET envelopeJson='{}'`,
      `UPDATE "OutboundEnvelopeApproval" SET expiresAt=expiresAt+1`,
      `UPDATE "OutboundEnvelopeApproval" SET approvedAt=approvedAt-1`,
      `DELETE FROM "OutboundEnvelopeApproval"`,
      `INSERT OR REPLACE INTO "OutboundEnvelopeApproval" SELECT * FROM "OutboundEnvelopeApproval"`,
    ]) assert.throws(() => f.sqlite.exec(sql));
    await f.store.revoke(f.input.intent.id, actor);
    assert.throws(() => f.sqlite.exec(`UPDATE "OutboundEnvelopeApproval" SET revokedAt=NULL`));
  } finally { f.close(); }
});

test("revocation or owner policy change after the first approval read cannot return stale approval", async () => {
  for (const change of ["revoke", "demote", "policy"] as const) {
    const f = await fixture();
    try {
      await f.store.approve(f.input);
      f.hooks.afterRead = (sql) => {
        if (!sql.startsWith("SELECT a.")) return;
        f.hooks.afterRead = undefined;
        if (change === "revoke") f.sqlite.exec('UPDATE "OutboundEnvelopeApproval" SET revokedAt=unixepoch()');
        if (change === "demote") f.sqlite.exec(`UPDATE "User" SET role='user'`);
        if (change === "policy") setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "other@example.invalid", AUTH_ADMIN_EMAILS: "other@example.invalid" });
      };
      await assert.rejects(f.store.loadEnvelope(f.input.intent), /OUTBOUND_APPROVAL_CONTENT_CONFLICT/);
    } finally { f.close(); }
  }
});

test("approval expiry is enforced at the database-clock boundary without renewal", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.store.approve({ ...f.input, expiresAt: f.input.expiresAt - 3600 }), /DENIED_OR_CONFLICT/);
    await f.store.approve(f.input);
    f.sqlite.function("unixepoch", () => f.input.expiresAt);
    await assert.rejects(f.store.loadEnvelope(f.input.intent), /UNAVAILABLE/);
    await assert.rejects(f.store.approve(f.input), /DENIED_OR_CONFLICT/);
  } finally { f.close(); }
});

test("persisted approval and exact mailbox compose with dispatcher without request-supplied approval", async () => {
  for (const revoked of [false, true]) {
    const f = await fixture();
    try {
      f.sqlite.exec(readFileSync("migrations/0073_outbound_send_intent.sql", "utf8"));
      f.sqlite.prepare(`INSERT INTO "RuntimeBudgetMonth" (month,ceilingCents,committedCents,accountingDigest,paused)
        VALUES (?,5000,0,?,0)`).run(f.input.intent.budgetMonth, "c".repeat(64));
      await f.store.approve(f.input);
      if (revoked) await f.store.revoke(f.input.intent.id, actor);
      const ledger = createOutboundSendIntentStore(f.database);
      let sends = 0;
      const dispatch = createOutboundDispatcher({
        // Approval lookup and mailbox provenance are real. Atomic composition of
        // all remaining consent/health/global policy with claim is still pending.
        authorizeAndClaim: ledger.claim, recordOutcome: ledger.recordOutcome,
        async sendExactIntent(intent) {
          const approved = await f.store.loadEnvelope(intent);
          sends++; assert.equal(approved.to, envelope.to); assert.equal(approved.subject, envelope.subject);
          return { messageId: "accepted", threadId: "thread" };
        }, // Fake provider only; no Gmail credential resolution in this fixture.
        async projectAccepted() { assert.equal(revoked, false); },
      });
      assert.equal((await dispatch(f.input.intent)).state, revoked ? "DELIVERY_UNCERTAIN" : "SENT");
      assert.equal((await dispatch(f.input.intent)).state, revoked ? "DELIVERY_UNCERTAIN" : "SENT");
      assert.equal(sends, revoked ? 0 : 1);
    } finally { f.close(); }
  }
});
