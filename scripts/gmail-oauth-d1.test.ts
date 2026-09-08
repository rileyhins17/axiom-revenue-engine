import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { setCloudflareBindings } from "../src/lib/cloudflare";
import { issueGmailOAuthTransaction, consumeGmailOAuthTransaction } from "../src/lib/gmail-oauth-transaction";

test("OAuth state is signed, opaque, bound, database-expiring and atomically single-use in local D1", async () => {
  const runtime = new Miniflare(convertV4MiniflareOptions({ cf: false, workers: [{
    name: "oauth-fixture", modules: true, script: "export default { fetch() { return new Response('synthetic'); } }",
    compatibilityDate: "2026-08-01", d1Databases: ["DB"],
    outboundService: async () => { throw new Error("OAuth fixture cannot use a provider"); },
  }] }));
  const secret = "synthetic-oauth-test-secret-not-a-real-key-00000000";
  const binding = { userId: "admin", sessionId: "session", redirectUri: "https://console.example.invalid/api/outreach/gmail/callback" };
  try {
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "admin@example.invalid", AUTH_ADMIN_EMAILS: "admin@example.invalid" });
    const db = await runtime.getD1Database("DB");
    const schema = readFileSync("migrations/0001_cloudflare_auth_security.sql", "utf8");
    for (const table of ["User", "Session"]) {
      const ddl = schema.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`));
      assert(ddl); await db.prepare(ddl[0]).run();
    }
    await db.prepare(`INSERT INTO User (id,name,email,role,emailVerified,updatedAt) VALUES ('admin','Synthetic','admin@example.invalid','admin',1,CURRENT_TIMESTAMP)`).run();
    await db.prepare(`INSERT INTO Session (id,userId,token,expiresAt,updatedAt) VALUES ('session','admin','synthetic',datetime('now','+1 day'),CURRENT_TIMESTAMP)`).run();
    const issue = () => issueGmailOAuthTransaction(db, secret, { ...binding, targetEmail: "mailbox@example.invalid" });
    const consume = (state: string | null, changes = {}) => consumeGmailOAuthTransaction(db, secret, state, { ...binding, ...changes });
    await assert.rejects(issue(), /GmailOAuthTransaction/);
    await db.prepare(readFileSync("migrations/0072_gmail_oauth_transactions.sql", "utf8")).run();
    const state = await issue();
    assert.match(state, /^v1\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
    assert(!state.includes("session") && !state.includes("mailbox"));
    for (const malformed of [null, "session", "sessionId=session&targetEmail=other@example.invalid", state + "x", state.toUpperCase()]) assert.equal(await consume(malformed), null);
    const forged = state.slice(0, -1) + (state.endsWith("0") ? "1" : "0");
    assert.equal(await consume(forged), null);
    assert.equal(await consumeGmailOAuthTransaction(db, secret + "rotated", state, binding), null);
    for (const changes of [{ userId: "other" }, { sessionId: "other" }, { redirectUri: binding.redirectUri + "/" },
      { redirectUri: binding.redirectUri.replace("https:", "http:") }]) assert.equal(await consume(state, changes), null);
    const results = await Promise.all([consume(state), consume(state)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.deepEqual(results.find(Boolean), { targetEmail: "mailbox@example.invalid" });
    assert.equal(await consume(state), null);
    const expired = await issue();
    await db.prepare(`UPDATE GmailOAuthTransaction SET issuedAt=issuedAt-601, expiresAt=expiresAt-601 WHERE id=?`).bind(expired.split(".")[1]).run();
    assert.equal(await consume(expired), null);
    for (const [deny, restore] of [
      ["role='user'", "role='admin'"], ["banned=1", "banned=0"], ["emailVerified=0", "emailVerified=1"],
    ]) {
      const pending = await issue();
      await db.prepare(`UPDATE User SET ${deny} WHERE id='admin'`).run();
      assert.equal(await consume(pending), null);
      await assert.rejects(issue(), /administrator unavailable/);
      await db.prepare(`UPDATE User SET ${restore} WHERE id='admin'`).run();
    }
    const revoked = await issue();
    await db.prepare("DELETE FROM Session WHERE id='session'").run();
    assert.equal(await consume(revoked), null);
  } finally { setCloudflareBindings(null); await runtime.dispose(); }
});
