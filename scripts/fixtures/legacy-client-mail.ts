import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import Database from "better-sqlite3";
import { createLocalDatabaseAdapter } from "../../src/lib/local-sqlite";
import { setCloudflareBindings, type D1DatabaseLike } from "../../src/lib/cloudflare";
import { getPrisma } from "../../src/lib/prisma";

/** Full source schema in memory, never an existing database or live migration.
 * Legacy mail is seeded data only; no provider or credential operation exists. */
export function legacyClientMailFixture() {
  const sqlite = new Database(":memory:");
  assert(sqlite.memory);
  sqlite.pragma("foreign_keys = ON");
  for (const name of readdirSync("migrations").filter(name => /^\d{4}_.+\.sql$/.test(name) && !name.startsWith("0070_")).sort()) {
    sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  sqlite.exec(`UPDATE "OutreachAutomationSetting" SET enabled=0, globalPaused=1, emergencyPaused=1`);
  for (const owner of ["owner", "other", "member"]) {
    sqlite.prepare(`INSERT INTO "User" (id,name,email,emailVerified,role,updatedAt) VALUES (?,?,?,1,?,CURRENT_TIMESTAMP)`)
      .run(owner, owner, `${owner}@example.invalid`, owner === "member" ? "user" : "admin");
    sqlite.prepare(`INSERT INTO "Session" (id,userId,token,expiresAt,updatedAt) VALUES (?,?,?,datetime('now','+1 hour'),CURRENT_TIMESTAMP)`)
      .run(`${owner}-session`, owner, `${owner}-synthetic-session`);
  }
  for (const lead of [1, 2]) sqlite.prepare(`INSERT INTO "Lead" (id,businessName,niche,city,lastUpdated)
    VALUES (?,'Synthetic local client','HVAC','Waterloo',CURRENT_TIMESTAMP)`).run(lead);
  sqlite.exec(`INSERT INTO "CrmActivity" (id,leadId,actorUserId,type,title,body)
    VALUES ('note',1,'owner','NOTE','Preserved CRM note','Useful business context');`);
  for (const owner of ["owner", "other"]) {
    sqlite.prepare(`INSERT INTO "OutreachMailbox" (id,userId,gmailAddress,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP)`)
      .run(`${owner}-mailbox`, owner, `${owner}@example.invalid`);
    sqlite.prepare(`INSERT INTO "OutreachEmail" (id,leadId,senderUserId,senderEmail,recipientEmail,subject,bodyHtml,bodyPlain,status,errorMessage,mailboxId)
      VALUES (?,1,?,?,'recipient@example.invalid',?,?,?,'sent','private-provider-error',?)`)
      .run(`${owner}-email`, owner, `${owner}@example.invalid`, `${owner} legacy subject`,
        '<img src="https://tracking.invalid/private-pixel"><script>window.legacyExecuted=true</script>',
        `${owner} legacy text <img src="https://tracking.invalid/plain-text">`, `${owner}-mailbox`);
    sqlite.prepare(`INSERT INTO "OutreachSequence" (id,leadId,queuedByUserId,assignedMailboxId,status,currentStep,sequenceConfigSnapshot,updatedAt)
      VALUES (?,1,?,?,'COMPLETED','INITIAL','{}',CURRENT_TIMESTAMP)`)
      .run(`${owner}-sequence`, owner, `${owner}-mailbox`);
    sqlite.prepare(`INSERT INTO "OutreachSequenceStep" (id,sequenceId,stepNumber,stepType,status,scheduledFor,subject,bodyPlain,updatedAt)
      VALUES (?,?,1,'INITIAL','SENT',CURRENT_TIMESTAMP,?,?,CURRENT_TIMESTAMP)`)
      .run(`${owner}-step`, `${owner}-sequence`, `${owner} private sequence subject`, `${owner} private sequence body`);
  }
  const base = createLocalDatabaseAdapter(sqlite);
  const hooks: { afterRead?: (sql: string) => void } = {};
  let preparedCount = 0;
  const database: D1DatabaseLike = { prepare(sql) {
    preparedCount++;
    const wrap = (statement: ReturnType<D1DatabaseLike["prepare"]>): ReturnType<D1DatabaseLike["prepare"]> => ({
      bind: (...values) => wrap(statement.bind(...values)),
      async first<T>() { const result = await statement.first<T>(); hooks.afterRead?.(sql); return result; },
      async all<T>() { const result = await statement.all<T>(); hooks.afterRead?.(sql); return result; },
      run: () => statement.run(),
    });
    return wrap(base.prepare(sql));
  } };
  const policy = { DB: database, AUTH_ALLOWED_EMAILS: "owner@example.invalid,other@example.invalid,member@example.invalid",
    AUTH_ADMIN_EMAILS: "owner@example.invalid,other@example.invalid" };
  setCloudflareBindings(policy);
  return { sqlite, database, hooks, policy, prisma: getPrisma(), actor: { userId: "owner", sessionId: "owner-session" },
    reads: () => preparedCount,
    changes: () => (sqlite.prepare('SELECT total_changes() n').get() as { n: number }).n,
    close() { sqlite.close(); setCloudflareBindings(null); } };
}
