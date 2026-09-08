import assert from "node:assert/strict";
import test from "node:test";
import { legacyClientMailFixture } from "./fixtures/legacy-client-mail";
import { legacyBoundary } from "./fixtures/legacy-mail-boundary";
import { createLegacyMailHistory } from "../src/lib/revenue-engine/legacy-mail-history";
import { setCloudflareBindings } from "../src/lib/cloudflare";
test("actual client page does not serialize another owner's legacy email or raw HTML", async () => {
  const f = legacyClientMailFixture();
  try {
    const props = await legacyBoundary(f, "page")();
    const serialized = JSON.stringify(props);
    assert.equal(serialized.includes("other legacy subject"), false, "Foreign-owner mail must not cross the server-page boundary");
    assert.equal(serialized.includes("bodyHtml"), false, "Raw email HTML must not be serialized");
    assert(serialized.includes("owner legacy subject"));
    assert(serialized.includes("Preserved CRM note"));
  } finally { f.close(); }
});

test("actual client metadata GET does not return another owner's legacy mail", async () => {
  const f = legacyClientMailFixture();
  try {
    const response = await legacyBoundary(f, "client")() as Response;
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(await response.json());
    assert.equal(serialized.includes("other legacy subject"), false);
    assert(serialized.includes("owner legacy subject"));
  } finally { f.close(); }
});

test("actual legacy list and detail use sender ownership, not ID knowledge or mailbox assignment", async () => {
  const f = legacyClientMailFixture();
  try {
    f.sqlite.exec('UPDATE "OutreachMailbox" SET userId=\'other\' WHERE id=\'owner-mailbox\'');
    const before = f.changes();
    for (const kind of ["client", "list", "detail"] as const) {
      const response = await legacyBoundary(f,kind)(kind==="detail" ? "owner-email" : "1") as Response;
      assert.equal(response.status,200);
      assert.equal(response.headers.get("Cache-Control"),"private, no-store");
      const body = await response.text();
      assert(body.includes("owner legacy subject"));
      assert.doesNotMatch(body,/other legacy subject|bodyHtml|gmailThreadId|gmailMessageId|private-provider-error|private sequence body/);
    }
    assert.equal((await legacyBoundary(f,"detail")("other-email") as Response).status,404);
    assert.equal((await legacyBoundary(f,"detail")("missing") as Response).status,404);
    assert.equal(f.changes(),before);
  } finally { f.close(); }
});

test("page includes only the latest sequence owned by its creator and no unused step bodies", async () => {
  const f = legacyClientMailFixture();
  try {
    f.sqlite.exec('UPDATE "OutreachSequence" SET assignedMailboxId=\'owner-mailbox\' WHERE id=\'other-sequence\'');
    const props = await legacyBoundary(f,"page")();
    const body = JSON.stringify(props);
    assert(body.includes("owner-sequence")); assert(body.includes("owner-step"));
    assert.doesNotMatch(body,/other-sequence|other-step|private sequence|private-provider-error/);
    assert(body.includes("Useful business context"));
  } finally { f.close(); }
});

test("ordinary members and malformed client paths stop before opening storage", async () => {
  const f = legacyClientMailFixture();
  try {
    for (const kind of ["client","list","detail"] as const) {
      assert.equal((await legacyBoundary(f,kind,"member")() as Response).status,403);
    }
    await assert.rejects(legacyBoundary(f,"page","member")(),/ADMIN_DENIED/);
    for (const invalid of ["1e0","1.5","01","-1","9007199254740992","1\n"]) {
      assert.equal((await legacyBoundary(f,"client")(invalid) as Response).status,400);
      await assert.rejects(legacyBoundary(f,"page")(invalid),/NOT_FOUND/);
    }
    assert.equal(f.reads(),0);
  } finally { f.close(); }
});

test("legacy reader denies current account/session revocation and rechecks after mail reads", async () => {
  for (const mutation of [
    "UPDATE Session SET expiresAt=datetime('now','-1 second') WHERE userId='owner'",
    "UPDATE Session SET impersonatedBy='other' WHERE userId='owner'",
    "UPDATE User SET role='user' WHERE id='owner'",
    "UPDATE User SET emailVerified=0 WHERE id='owner'",
    "UPDATE User SET banned=1 WHERE id='owner'",
  ]) {
    const f = legacyClientMailFixture();
    try {
      f.hooks.afterRead = sql => { if (sql.includes('FROM "OutreachEmail"')) { f.hooks.afterRead=undefined; f.sqlite.exec(mutation); } };
      await assert.rejects(createLegacyMailHistory(f.database)(f.actor,{ leadId:1, bodies:true }),/LEGACY_HISTORY_UNAVAILABLE/);
      assert.equal(await createLegacyMailHistory(f.database)(f.actor,{ leadId:1 }),null);
    } finally { f.close(); }
  }
  const f = legacyClientMailFixture();
  try {
    f.hooks.afterRead = sql => { if (sql.includes('FROM "OutreachEmail"')) setCloudflareBindings({ ...f.policy, AUTH_ADMIN_EMAILS:"other@example.invalid" }); };
    await assert.rejects(createLegacyMailHistory(f.database)(f.actor,{leadId:1}),/LEGACY_HISTORY_UNAVAILABLE/);
  } finally { f.close(); }
});

test("missing, archived and unavailable history are not returned as a successful empty client", async () => {
  const f = legacyClientMailFixture();
  try {
    f.sqlite.exec('UPDATE Lead SET isArchived=1 WHERE id=1');
    await assert.rejects(legacyBoundary(f,"page")(),/NOT_FOUND/);
    assert.equal((await legacyBoundary(f,"client")() as Response).status,404);
    // Explicit legacy message lookup remains historical, like new saved receipts.
    assert.equal((await legacyBoundary(f,"detail")("owner-email") as Response).status,200);
    f.sqlite.exec('DROP TABLE OutreachEmail');
    assert.equal((await legacyBoundary(f,"list")() as Response).status,503);
  } finally { f.close(); }
});

test("HTML-only and oversized legacy bodies have explicit unavailable states without truncation", async () => {
  const f = legacyClientMailFixture();
  try {
    for (const [body,reason] of [["","NO_PLAIN_TEXT"],["x".repeat(32769),"TOO_LARGE"],["é".repeat(20000),"TOO_LARGE"]]) {
      f.sqlite.prepare('UPDATE OutreachEmail SET bodyPlain=? WHERE id=\'owner-email\'').run(body);
      const before=f.changes();
      const response = await legacyBoundary(f,"detail")("owner-email") as Response;
      const data = await response.json() as {email:{bodyPlain:string|null;bodyUnavailable:string}};
      assert.equal(data.email.bodyUnavailable,reason);
      if (reason==="TOO_LARGE") assert.equal(data.email.bodyPlain,null);
      assert.equal(f.changes(),before);
    }
  } finally { f.close(); }
});
