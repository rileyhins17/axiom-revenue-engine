import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import type { D1DatabaseLike, D1PreparedStatementLike } from "../src/lib/cloudflare";
import { createExactMailboxResolver } from "../src/lib/revenue-engine/outbound-mailbox";
import { createExactEnvelopeTransport, outboundEnvelopeDigest, type OutboundEnvelope } from "../src/lib/revenue-engine/outbound-envelope";
import { createOutboundDispatcher } from "../src/lib/revenue-engine/outbound-dispatch";
import { createOutboundSendIntentStore, type OutboundSendIntent } from "../src/lib/revenue-engine/outbound-send-intent-store";

const identity = { ownerId: "owner", mailboxId: "mailbox", connectionId: "connection", address: "sender@example.invalid" };
function fixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY); CREATE TABLE "Lead" (id INTEGER PRIMARY KEY);');
  sqlite.exec(readFileSync("migrations/0005_outreach_automation.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0006_outreach_automation_queue.sql", "utf8"));
  sqlite.exec(`UPDATE "OutreachAutomationSetting" SET enabled=0, globalPaused=1;
    INSERT INTO "User" VALUES ('owner'), ('other');
    INSERT INTO "GmailConnection" (id,userId,gmailAddress,accessToken,refreshToken,tokenExpiresAt,scopes,updatedAt)
      VALUES ('connection','owner','sender@example.invalid','synthetic-ciphertext','never-decrypt-refresh',
        datetime('now','+1 hour'),'https://www.googleapis.com/auth/gmail.send',CURRENT_TIMESTAMP);
    INSERT INTO "OutreachMailbox" (id,userId,gmailConnectionId,gmailAddress,status,updatedAt)
      VALUES ('mailbox','owner','connection','sender@example.invalid','ACTIVE',CURRENT_TIMESTAMP);`);
  let reads = 0;
  const database: D1DatabaseLike = { prepare(sql) {
    assert.doesNotMatch(sql, /refreshToken/);
    const statement = sqlite.prepare(sql);
    let values: unknown[] = [];
    const prepared: D1PreparedStatementLike = {
      bind(...args) { values = args; return prepared; },
      async first<T>() { reads++; return (statement.get(...values) ?? null) as T | null; },
      async all() { assert.fail("No broad mailbox lookup"); },
      async run() { assert.fail("No mailbox mutation"); },
    };
    return prepared;
  } };
  return { sqlite, database, reads: () => reads };
}

test("exact resolver uses the real mailbox schema and only decrypts the selected access token", async () => {
  for (const status of ["ACTIVE", "WARMING"]) {
    const { sqlite, database, reads } = fixture();
    sqlite.prepare('UPDATE "OutreachMailbox" SET status=?').run(status);
    let decryptions = 0;
    const resolve = createExactMailboxResolver({ database, async decryptAccessToken(ciphertext) {
      assert.equal(ciphertext, "synthetic-ciphertext"); decryptions++; return "synthetic-access-token";
    } });
    try {
      assert.deepEqual(await resolve(identity), { ...identity, accessToken: "synthetic-access-token" });
      assert.equal(decryptions, 1);
      assert.equal(reads(), 2);
    } finally { sqlite.close(); }
  }
});

test("missing, foreign, paused, disconnected and unpermitted mailboxes never decrypt", async () => {
  const mutations = [
    `DELETE FROM "OutreachMailbox"`,
    `UPDATE "OutreachMailbox" SET userId='other'`,
    `UPDATE "GmailConnection" SET userId='other'`,
    `UPDATE "OutreachMailbox" SET gmailConnectionId=NULL`,
    `UPDATE "OutreachMailbox" SET gmailAddress='other@example.invalid'`,
    `UPDATE "GmailConnection" SET gmailAddress='other@example.invalid'`,
    ...["PAUSED", "DISCONNECTED", "ERROR", "active", "UNKNOWN"].map((status) => `UPDATE "OutreachMailbox" SET status='${status}'`),
    `UPDATE "GmailConnection" SET scopes=NULL`,
    `UPDATE "GmailConnection" SET scopes='https://www.googleapis.com/auth/gmail.readonly'`,
    `UPDATE "GmailConnection" SET scopes='https://www.googleapis.com/auth/gmail.send.fake'`,
    `UPDATE "GmailConnection" SET tokenExpiresAt='invalid'`,
    `UPDATE "GmailConnection" SET tokenExpiresAt='2027-02-30T12:00:00Z'`,
    `UPDATE "GmailConnection" SET tokenExpiresAt='2027-01-01T12:00:00'`,
    `UPDATE "GmailConnection" SET tokenExpiresAt=datetime('now','+5 minutes')`,
    `UPDATE "GmailConnection" SET tokenExpiresAt=datetime('now','-1 minute')`,
  ];
  for (const mutation of mutations) {
    const { sqlite, database } = fixture();
    const resolve = createExactMailboxResolver({ database, async decryptAccessToken() { assert.fail("Invalid mailbox must not decrypt"); } });
    try {
      sqlite.exec(mutation);
      await assert.rejects(resolve(identity), /^Error: OUTBOUND_MAILBOX_UNAVAILABLE$/);
    } finally { sqlite.close(); }
  }
});

test("metadata or token changes while decryption is pending invalidate the result", async () => {
  for (const mutation of [
    `UPDATE "OutreachMailbox" SET status='PAUSED'`,
    `UPDATE "OutreachMailbox" SET gmailConnectionId=NULL`,
    `UPDATE "GmailConnection" SET accessToken='new-synthetic-ciphertext'`,
    `UPDATE "GmailConnection" SET tokenExpiresAt=datetime('now','+2 hours')`,
    `UPDATE "GmailConnection" SET scopes='https://www.googleapis.com/auth/gmail.send extra-scope'`,
  ]) {
    const { sqlite, database } = fixture();
    const resolve = createExactMailboxResolver({ database, async decryptAccessToken() {
      sqlite.exec(mutation); return "synthetic-access-token";
    } });
    try { await assert.rejects(resolve(identity), /OUTBOUND_MAILBOX_(UNAVAILABLE|CHANGED)/); }
    finally { sqlite.close(); }
  }
});

test("invalid identity, decryption failure and malformed credentials return bounded errors", async () => {
  const { sqlite, database, reads } = fixture();
  try {
    for (const output of ["", "bad\r\ntoken", "throws"]) {
      const resolve = createExactMailboxResolver({ database, async decryptAccessToken() {
        if (output === "throws") throw new Error("synthetic-private-error-content");
        return output;
      } });
      await assert.rejects(resolve(identity), /^Error: OUTBOUND_MAILBOX_CREDENTIAL_UNAVAILABLE$/);
    }
    const before = reads();
    const resolve = createExactMailboxResolver({ database, async decryptAccessToken() { assert.fail("Invalid input"); } });
    await assert.rejects(resolve({ ...identity, ownerId: "owner\n" }), /OUTBOUND_MAILBOX_IDENTITY_INVALID/);
    assert.equal(reads(), before);
  } finally { sqlite.close(); }
});

test("database failure and missing schema never create fallback mailbox credentials", async () => {
  const { sqlite, database } = fixture();
  sqlite.exec('DROP TABLE "OutreachMailbox"');
  try {
    const resolve = createExactMailboxResolver({ database, async decryptAccessToken() { assert.fail("No fallback credentials"); } });
    await assert.rejects(resolve(identity), /^Error: OUTBOUND_MAILBOX_UNAVAILABLE$/);
  } finally { sqlite.close(); }
});

test("database-backed mailbox resolution composes with exact envelope and durable dispatch", async () => {
  for (const paused of [false, true]) {
    const { sqlite, database } = fixture();
    sqlite.exec(readFileSync("migrations/0073_outbound_send_intent.sql", "utf8"));
    const month = new Date().toISOString().slice(0, 7);
    sqlite.prepare(`INSERT INTO "RuntimeBudgetMonth" (month,ceilingCents,committedCents,accountingDigest,paused)
      VALUES (?,5000,0,?,0)`).run(month, "d".repeat(64));
    if (paused) sqlite.exec(`UPDATE "OutreachMailbox" SET status='PAUSED'`);
    const envelope: OutboundEnvelope = {
      version: "outbound-envelope-v1", ownerId: identity.ownerId, mailboxId: identity.mailboxId,
      connectionId: identity.connectionId, leadId: 1, policyVersion: "synthetic-policy",
      mode: "MANUAL_REPLY", from: identity.address, fromName: null, to: "recipient@example.invalid",
      subject: "Approved reply", bodyPlain: "Approved content", bodyHtml: "", threadId: "thread",
      inReplyTo: "<parent@example.invalid>", references: ["<parent@example.invalid>"],
      rfcMessageId: "<intent@example.invalid>",
    };
    const intent: OutboundSendIntent = { id: "a".repeat(64), ownerId: identity.ownerId,
      mailboxId: identity.mailboxId, operationKey: "operation", payloadDigest: await outboundEnvelopeDigest(envelope),
      mode: envelope.mode, rfcMessageId: envelope.rfcMessageId, budgetMonth: month, reservedCostCents: 1 };
    let sends = 0;
    const store = createOutboundSendIntentStore(database);
    const dispatch = createOutboundDispatcher({
      // Remaining owner/consent/content-approval gates are synthetic, not proved here.
      authorizeAndClaim: store.claim, recordOutcome: store.recordOutcome,
      sendExactIntent: createExactEnvelopeTransport({
        async loadEnvelope() { return envelope; },
        resolveMailbox: createExactMailboxResolver({ database, async decryptAccessToken() {
          assert.equal(paused, false); return "synthetic-access-token";
        } }),
        async send(options) {
          sends++; assert.equal(options.from, identity.address); assert.equal(options.to, envelope.to);
          return { messageId: "accepted", threadId: "thread" };
        },
      }),
      async projectAccepted() { assert.equal(paused, false); },
    });
    try {
      assert.equal((await dispatch(intent)).state, paused ? "DELIVERY_UNCERTAIN" : "SENT");
      assert.equal((await dispatch(intent)).state, paused ? "DELIVERY_UNCERTAIN" : "SENT");
      assert.equal(sends, paused ? 0 : 1);
    } finally { sqlite.close(); }
  }
});
