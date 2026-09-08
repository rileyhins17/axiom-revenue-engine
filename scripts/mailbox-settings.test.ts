import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Database from "better-sqlite3";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { type D1DatabaseLike, setCloudflareBindings } from "../src/lib/cloudflare";
import { createLocalDatabaseAdapter } from "../src/lib/local-sqlite";
import { InvalidMailboxSettings, updateMailboxSettings } from "../src/lib/mailbox-settings";

async function proveSettings(db: D1DatabaseLike) {
  const authSchema = readFileSync("migrations/0001_cloudflare_auth_security.sql", "utf8");
  const mailboxSchema = readFileSync("migrations/0006_outreach_automation_queue.sql", "utf8");
  const table = (source: string, name: string) => {
    const ddl = source.match(new RegExp(`CREATE TABLE "${name}" \\([\\s\\S]*?\\n\\);`));
    assert(ddl); return ddl[0];
  };
  for (const name of ["User", "Session", "AuditEvent"]) await db.prepare(table(authSchema, name)).run();
  await db.prepare('CREATE TABLE "GmailConnection" ("id" TEXT PRIMARY KEY)').run();
  await db.prepare(table(mailboxSchema, "OutreachMailbox")).run();
  await db.prepare(`INSERT INTO User (id,name,email,role,emailVerified,updatedAt) VALUES ('admin','Synthetic','admin@example.invalid','admin',1,CURRENT_TIMESTAMP)`).run();
  await db.prepare(`INSERT INTO Session (id,userId,token,expiresAt,updatedAt) VALUES ('session','admin','synthetic',datetime('now','+1 day'),CURRENT_TIMESTAMP)`).run();
  await db.prepare(`INSERT INTO OutreachMailbox (id,userId,gmailAddress,label,status,updatedAt) VALUES ('mailbox','admin','mailbox@example.invalid','Before','PAUSED',CURRENT_TIMESTAMP)`).run();
  const update = (input: unknown, actor = { userId: "admin", sessionId: "session" }, id = "mailbox") => updateMailboxSettings(db, actor, id, input);
  const mailbox = () => db.prepare("SELECT * FROM OutreachMailbox WHERE id='mailbox'").first();
  const auditCount = async () => (await db.prepare("SELECT COUNT(*) AS count FROM AuditEvent").first<{count:number}>())!.count;
  const original = await mailbox();
  for (const bad of [null, [], "label", {}, { label: undefined }, { label: " " }, { label: "x".repeat(81) },
    { timezone: "" }, { timezone: "Invalid/Zone" }, { timezone: " America/Toronto " },
    { label: "Allowed", status: "ACTIVE" }, JSON.parse('{"label":"Allowed","__proto__":{"status":"ACTIVE"}}'),
    ...["id", "userId", "gmailConnectionId", "gmailAddress", "status", "dailyLimit", "hourlyLimit",
      "minDelaySeconds", "maxDelaySeconds", "warmupLevel", "lastSentAt", "lastReplyCheckAt", "createdAt", "updatedAt", "other"]
      .map((key) => ({ [key]: key.includes("Limit") ? 999 : "changed" }))]) {
    await assert.rejects(update(bad), InvalidMailboxSettings);
    assert.deepEqual(await mailbox(), original);
    assert.equal(await auditCount(), 0);
  }
  const changed = await update({ label: " Owner label ", timezone: "America/Vancouver" });
  assert.equal(changed?.label, "Owner label");
  assert.equal(changed?.timezone, "America/Vancouver");
  assert.equal(changed?.status, "PAUSED");
  assert.equal(changed?.userId, "admin");
  assert.equal(await auditCount(), 1);
  const event = await db.prepare("SELECT actorUserId,action,targetType,targetId,metadata FROM AuditEvent").first();
  assert.deepEqual(event, { actorUserId: "admin", action: "mailbox.settings.updated", targetType: "OutreachMailbox", targetId: "mailbox", metadata: JSON.stringify({changedFields:["label","timezone"]}) });
  await update({label:"Owner label",timezone:"America/Vancouver"});
  assert.equal(await auditCount(), 1, "identical retry must not add an audit event");
  assert.equal((await update({label:null}))?.label, null);
  const beforeDenials = await mailbox();
  const count = await auditCount();
  for (const [deny, restore] of [["role='user'", "role='admin'"], ["banned=1", "banned=0"], ["emailVerified=0", "emailVerified=1"]]) {
    await db.prepare(`UPDATE User SET ${deny}`).run();
    assert.equal(await update({label:"Denied"}), null);
    await db.prepare(`UPDATE User SET ${restore}`).run();
  }
  assert.equal(await update({label:"Denied"},{userId:"admin",sessionId:"wrong"}), null);
  assert.equal(await update({label:"Denied"},{userId:"wrong",sessionId:"session"}), null);
  assert.equal(await update({label:"Denied"},undefined,"missing"), null);
  setCloudflareBindings({ AUTH_ALLOWED_EMAILS:"admin@example.invalid,other@example.invalid", AUTH_ADMIN_EMAILS:"other@example.invalid" });
  assert.equal(await update({label:"Policy revoked"}), null);
  setCloudflareBindings({ AUTH_ALLOWED_EMAILS:"admin@example.invalid", AUTH_ADMIN_EMAILS:"admin@example.invalid" });
  await assert.rejects(updateMailboxSettings({prepare:db.prepare.bind(db)}, {userId:"admin",sessionId:"session"}, "mailbox", {label:"No atomic adapter"}), /Atomic mailbox settings/);
  await db.prepare("UPDATE Session SET expiresAt=datetime('now','-1 day')").run();
  assert.equal(await update({label:"Denied"}), null);
  await db.prepare("UPDATE Session SET expiresAt=datetime('now','+1 day')").run();
  assert.deepEqual(await mailbox(), beforeDenials);
  assert.equal(await auditCount(), count);
  await db.prepare(`CREATE TRIGGER fail_audit BEFORE INSERT ON AuditEvent BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`).run();
  await assert.rejects(update({label:"Must roll back"}), /synthetic audit failure/);
  assert.deepEqual(await mailbox(), beforeDenials);
  assert.equal(await auditCount(), count);
  await db.prepare("DROP TRIGGER fail_audit").run();
  await db.prepare("DROP TABLE AuditEvent").run();
  await assert.rejects(update({label:"Missing audit"}));
  assert.deepEqual(await mailbox(), beforeDenials);
}

for (const backend of ["SQLite", "D1"] as const) test(`mailbox settings reject mass assignment and require current admin plus atomic audit in ${backend}`, async () => {
  setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "admin@example.invalid", AUTH_ADMIN_EMAILS: "admin@example.invalid" });
  const sqlite = backend === "SQLite" ? new Database(":memory:") : null;
  const runtime = backend === "D1" ? new Miniflare(convertV4MiniflareOptions({cf:false,workers:[{
    name:"mailbox-settings-fixture",modules:true,script:"export default { fetch() { return new Response('synthetic'); } }",
    compatibilityDate:"2026-08-01",d1Databases:["DB"],outboundService:async()=>{throw new Error("No outside access");},
  }]})) : null;
  try { await proveSettings(sqlite ? createLocalDatabaseAdapter(sqlite) : await runtime!.getD1Database("DB")); }
  finally { setCloudflareBindings(null); sqlite?.close(); await runtime?.dispose(); }
});
