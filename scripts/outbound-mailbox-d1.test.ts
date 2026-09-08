import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createExactMailboxResolver } from "../src/lib/revenue-engine/outbound-mailbox";

test("exact mailbox resolver enforces identity and post-decryption state in disposable local D1", async () => {
  let externalRequests = 0;
  const runtime = new Miniflare(convertV4MiniflareOptions({ cf: false,
    workers: [{ name: "outbound-mailbox-fixture", modules: true,
      script: "export default { fetch() { return new Response('synthetic'); } }",
      compatibilityDate: "2026-08-01", d1Databases: ["DB"],
      outboundService: async () => { externalRequests++; throw new Error("External requests disabled in mailbox fixture"); },
    }],
  }));
  try {
    const database = await runtime.getD1Database("DB");
    await database.prepare('CREATE TABLE "User" (id TEXT PRIMARY KEY)').run();
    // Execute actual table definitions, including foreign keys. This fixture
    // does not install unrelated automation tables or legacy enabled defaults.
    for (const [file, table] of [
      ["migrations/0005_outreach_automation.sql", "GmailConnection"],
      ["migrations/0006_outreach_automation_queue.sql", "OutreachMailbox"],
    ]) {
      const schema = readFileSync(file, "utf8");
      const ddl = schema.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`));
      assert(ddl, `Missing real ${table} definition`);
      await database.prepare(ddl[0]).run();
      for (const index of schema.matchAll(new RegExp(`CREATE (?:UNIQUE )?INDEX[^;]+ON "${table}"[^;]+;`, "g"))) {
        await database.prepare(index[0]).run();
      }
    }
    const queueSchema = readFileSync("migrations/0006_outreach_automation_queue.sql", "utf8");
    const dropOldIndex = queueSchema.match(/DROP INDEX IF EXISTS "GmailConnection_userId_key";/);
    assert(dropOldIndex);
    await database.prepare(dropOldIndex[0]).run();
    for (const index of queueSchema.matchAll(/CREATE (?:UNIQUE )?INDEX[^;]+ON "GmailConnection"[^;]+;/g)) {
      await database.prepare(index[0]).run();
    }
    await database.prepare(`INSERT INTO "User" VALUES ('owner'), ('foreign')`).run();
    // Insert a different mailbox for the SAME owner first: choosing the first
    // connection must not accidentally satisfy the expected sender identity.
    await database.prepare(`INSERT INTO "GmailConnection"
      (id,userId,gmailAddress,accessToken,refreshToken,tokenExpiresAt,scopes,updatedAt)
      VALUES ('other-connection','owner','other@example.invalid','wrong-ciphertext','unused-refresh',
        datetime('now','+1 hour'),'https://www.googleapis.com/auth/gmail.send',CURRENT_TIMESTAMP)`).run();
    await database.prepare(`INSERT INTO "OutreachMailbox"
      (id,userId,gmailConnectionId,gmailAddress,status,updatedAt)
      VALUES ('other-mailbox','owner','other-connection','other@example.invalid','ACTIVE',CURRENT_TIMESTAMP)`).run();
    await database.prepare(`INSERT INTO "GmailConnection"
      (id,userId,gmailAddress,accessToken,refreshToken,tokenExpiresAt,scopes,updatedAt)
      VALUES ('connection','owner','sender@example.invalid','synthetic-ciphertext','unused-refresh',
        datetime('now','+1 hour'),'https://www.googleapis.com/auth/gmail.send',CURRENT_TIMESTAMP)`).run();
    await database.prepare(`INSERT INTO "OutreachMailbox"
      (id,userId,gmailConnectionId,gmailAddress,status,updatedAt)
      VALUES ('mailbox','owner','connection','sender@example.invalid','ACTIVE',CURRENT_TIMESTAMP)`).run();
    const identity = { ownerId: "owner", mailboxId: "mailbox", connectionId: "connection", address: "sender@example.invalid" };
    let decryptions = 0;
    const resolve = createExactMailboxResolver({ database, async decryptAccessToken(value) {
      decryptions++; assert.equal(value, "synthetic-ciphertext"); return "synthetic-access-token";
    } });
    assert.deepEqual(await resolve(identity), { ...identity, accessToken: "synthetic-access-token" });
    assert.equal(decryptions, 1);
    for (const change of [{ ownerId: "foreign" }, { mailboxId: "missing" }, { connectionId: "missing" },
      { mailboxId: "other-mailbox" }, { connectionId: "other-connection" },
      { address: "foreign@example.invalid" }]) {
      await assert.rejects(resolve({ ...identity, ...change }), /^Error: OUTBOUND_MAILBOX_UNAVAILABLE$/);
    }
    assert.equal(decryptions, 1);
    await database.prepare(`UPDATE "GmailConnection" SET tokenExpiresAt=datetime('now','+5 minutes')`).run();
    await assert.rejects(resolve(identity), /^Error: OUTBOUND_MAILBOX_UNAVAILABLE$/);
    assert.equal(decryptions, 1);
    await database.prepare(`UPDATE "GmailConnection" SET tokenExpiresAt=datetime('now','+1 hour')`).run();
    const pauseDuringDecrypt = createExactMailboxResolver({ database, async decryptAccessToken() {
      await database.prepare(`UPDATE "OutreachMailbox" SET status='PAUSED'`).run();
      return "synthetic-access-token";
    } });
    await assert.rejects(pauseDuringDecrypt(identity), /^Error: OUTBOUND_MAILBOX_UNAVAILABLE$/);
    await database.prepare(`UPDATE "OutreachMailbox" SET status='ACTIVE'`).run();
    const rotateDuringDecrypt = createExactMailboxResolver({ database, async decryptAccessToken() {
      await database.prepare(`UPDATE "GmailConnection" SET accessToken='rotated-synthetic-ciphertext'`).run();
      return "synthetic-access-token";
    } });
    await assert.rejects(rotateDuringDecrypt(identity), /^Error: OUTBOUND_MAILBOX_CHANGED$/);
    await database.prepare(`DELETE FROM "GmailConnection" WHERE id='connection'`).run();
    assert.deepEqual(await database.prepare(`SELECT gmailConnectionId FROM "OutreachMailbox" WHERE id='mailbox'`).first(), { gmailConnectionId: null });
    await assert.rejects(resolve(identity), /^Error: OUTBOUND_MAILBOX_UNAVAILABLE$/);
    assert.equal(externalRequests, 0);
  } finally { await runtime.dispose(); }
});
