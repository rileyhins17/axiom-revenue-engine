import assert from "node:assert/strict";
import test from "node:test";
import { legacyClientMailFixture } from "./fixtures/legacy-client-mail";
import { getAutomationOperatorConsole } from "../src/lib/automation-operator-view";
import { listAutomationOverview } from "../src/lib/outreach-automation";
import { getReadOnlyPrisma } from "../src/lib/prisma";
import { setCloudflareBindings } from "../src/lib/cloudflare";
import { summaryBoundary, type SummaryBoundary } from "./fixtures/automation-summary-boundary";
import { z } from "zod";

function seedQueue(f: ReturnType<typeof legacyClientMailFixture>) {
  f.sqlite.exec(`UPDATE Lead SET email='decisionmaker@example.invalid', emailType='owner', emailConfidence=0.99,
    emailFlags='[]', axiomScore=90, enrichmentData='{}';
    UPDATE OutreachSequence SET status='QUEUED'; UPDATE OutreachSequenceStep SET status='SCHEDULED';
    UPDATE OutreachEmail SET sequenceId='owner-sequence' WHERE id='owner-email';
    UPDATE OutreachEmail SET sequenceId='other-sequence' WHERE id='other-email';`);
}

function snapshot(f: ReturnType<typeof legacyClientMailFixture>) {
  const schema = f.sqlite.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all();
  return JSON.stringify({ schema, rows: Object.fromEntries([
    "Lead", "OutreachMailbox", "OutreachSequence", "OutreachSequenceStep", "OutreachEmail", "OutreachAutomationSetting", "GmailConnection",
  ].map(table => [table, f.sqlite.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()])) });
}

test("operator console recent history is private to its admitted sender", async () => {
  const f = legacyClientMailFixture();
  try {
    const result = await getAutomationOperatorConsole(f.actor, new Date(), f.database);
    assert(result.recentSent.some(email => email.id === "owner-email"));
    assert.equal(result.recentSent.some(email => email.id === "other-email"), false);
  } finally { f.close(); }
});

test("actual dashboard/automation pages and overview/status APIs expose only admitted-owner mail", async () => {
  const f = legacyClientMailFixture();
  try {
    seedQueue(f);
    const before = snapshot(f);
    for (const kind of ["dashboard", "automation", "overview", "status"] as const) {
      const value = await summaryBoundary(f,kind)();
      const serialized = value instanceof Response ? await value.text() : JSON.stringify(value);
      if (value instanceof Response) {
        assert.equal(value.status,200,kind); assert.equal(value.headers.get("Cache-Control"),"private, no-store");
      }
      assert.equal(/other legacy subject|other-mailbox|other-sequence|other-step|other@example.invalid|bodyHtml|sequenceConfigSnapshot|private sequence body|private-provider-error/.test(serialized),false,kind);
      assert(serialized.includes(kind === "status" ? "owner@example.invalid" : "owner legacy subject"),kind);
      if (kind === "dashboard") {
        assert(serialized.includes('"sentToday":1'),"Dashboard counts the same current-day SQLite timestamp as the console");
        assert(!serialized.includes("Connect Gmail senders"),"The owner has excluded Google Workspace");
      }
    }
    assert.equal(snapshot(f),before,"Page views leave application data and schema unchanged");
  } finally { f.close(); }
});

test("owner queues and counts survive; current mailbox assignment cannot reveal a foreign sender", async () => {
  const f = legacyClientMailFixture();
  try {
    seedQueue(f);
    const result = await getAutomationOperatorConsole(f.actor,new Date(),f.database);
    assert.equal(result.nextEmails.length,1); assert.equal(result.nextEmails[0].id,"owner-step");
    assert.equal(result.queue.queuedSequences,1); assert.equal(result.queue.scheduledRawSteps,1);
    f.sqlite.exec("UPDATE OutreachSequence SET assignedMailboxId='other-mailbox' WHERE id='owner-sequence'");
    const reassigned = await getAutomationOperatorConsole(f.actor,new Date(),f.database);
    assert.equal(reassigned.nextEmails[0].senderEmail,null);
    const overview = await listAutomationOverview(f.actor);
    assert.equal(overview.sequences[0].mailbox,null);
    assert.equal(overview.sequences[0].nextStep?.id,"owner-step");
    assert(!JSON.stringify(overview).includes("other@example.invalid"));
  } finally { f.close(); }
});

test("ordinary members cannot read summary pages/APIs; stale server auth cannot override current admission", async () => {
  const f = legacyClientMailFixture();
  try {
    for (const kind of ["overview","status"] as const) assert.equal((await summaryBoundary(f,kind,"member")() as Response).status,403);
    await assert.rejects(summaryBoundary(f,"automation","member")(),/ADMIN_DENIED/);
    assert(JSON.stringify(await summaryBoundary(f,"dashboard","member")()).includes("Administrator access required"));
    assert.equal(f.reads(),0);
    await assert.rejects(listAutomationOverview({ userId:"member", sessionId:"owner-session" }),/OWNER_SUMMARY_UNAVAILABLE/);
  } finally { f.close(); }
});

test("all actual summary boundaries recheck current account/session and policy after reading", async () => {
  const mutations = [
    "UPDATE Session SET expiresAt=datetime('now','-1 second') WHERE userId='owner'",
    "UPDATE Session SET impersonatedBy='other' WHERE userId='owner'",
    "UPDATE User SET role='user' WHERE id='owner'",
    "UPDATE User SET emailVerified=0 WHERE id='owner'",
    "UPDATE User SET banned=1 WHERE id='owner'",
    "POLICY",
  ];
  for (const kind of ["dashboard","automation","overview","status"] as SummaryBoundary[]) for (const mutation of mutations) {
    const f = legacyClientMailFixture();
    try {
      seedQueue(f);
      f.hooks.afterRead = sql => {
        if (/FROM "(?:OutreachEmail|GmailConnection)"/.test(sql)) {
          f.hooks.afterRead=undefined;
          if (mutation === "POLICY") setCloudflareBindings({ ...f.policy, AUTH_ADMIN_EMAILS:"other@example.invalid" });
          else f.sqlite.exec(mutation);
        }
      };
      if (kind === "status" || kind === "overview") {
        const response = await summaryBoundary(f,kind)() as Response;
        assert.equal(response.status,503,kind+mutation);
        assert(! (await response.text()).includes("owner legacy subject"));
      } else await assert.rejects(summaryBoundary(f,kind)(),/OWNER_SUMMARY_UNAVAILABLE/);
    } finally { f.close(); }
  }
});

test("viewing summaries never creates missing settings, upserts mailboxes or recovers stale sequences", async () => {
  const f = legacyClientMailFixture();
  try {
    for (const owner of ["owner","other"]) f.sqlite.prepare(`INSERT INTO GmailConnection
      (id,userId,gmailAddress,accessToken,refreshToken,tokenExpiresAt,updatedAt)
      VALUES (?,?,?,'synthetic-not-a-token','synthetic-not-a-token',datetime('now','-1 day'),CURRENT_TIMESTAMP)`)
      .run(`${owner}-connection`,owner,`${owner}@example.invalid`);
    f.sqlite.exec("UPDATE OutreachSequence SET status='QUEUED'; DELETE FROM OutreachSequenceStep");
    const before = snapshot(f);
    await listAutomationOverview(f.actor);
    const response = await summaryBoundary(f,"status")() as Response;
    assert.equal(response.status,200);
    const data = z.object({ connections: z.array(z.unknown()), tokenHealthy: z.boolean(),
      healthChecked: z.boolean(), runtimeAvailable: z.boolean() }).parse(await response.json());
    assert.equal(data.connections.length,1); assert.equal(data.tokenHealthy,false);
    assert.equal(data.healthChecked,false); assert.equal(data.runtimeAvailable,false);
    assert(!JSON.stringify(data).includes("synthetic-not-a-token"));
    assert.equal(snapshot(f),before);
    f.sqlite.exec("DELETE FROM OutreachAutomationSetting");
    const noSettings = snapshot(f);
    await assert.rejects(listAutomationOverview(f.actor),/OWNER_SUMMARY_UNAVAILABLE/);
    await assert.rejects(getAutomationOperatorConsole(f.actor,new Date(),f.database),/OWNER_SUMMARY_UNAVAILABLE/);
    assert.equal(snapshot(f),noSettings);
  } finally { f.close(); }
});

test("read-only model prevents accidental maintenance and never repairs a missing column", async () => {
  const f = legacyClientMailFixture();
  try {
    const reader = getReadOnlyPrisma();
    const before=snapshot(f);
    await assert.rejects(reader.lead.update({where:{id:1},data:{city:"Changed"}}),/READ_ONLY_MODEL/);
    await assert.rejects(reader.outreachMailbox.updateMany({where:{id:"owner-mailbox"},data:{status:"ACTIVE"}}),/READ_ONLY_MODEL/);
    await assert.rejects(reader.lead.create({data:{businessName:"Changed"}}),/READ_ONLY_MODEL/);
    await assert.rejects(reader.lead.delete({where:{id:1}}),/READ_ONLY_MODEL/);
    assert.equal(snapshot(f),before);
    f.sqlite.exec('ALTER TABLE Lead DROP COLUMN phoneConfidence');
    const missing=snapshot(f);
    await reader.lead.count();
    assert.equal(snapshot(f),missing);
  } finally { f.close(); }
});

test("automation overview preserves owned history without foreign sequence or mailbox copies", async () => {
  const f = legacyClientMailFixture();
  try {
    f.sqlite.exec(`UPDATE OutreachEmail SET sequenceId='owner-sequence' WHERE id='owner-email';
      UPDATE OutreachEmail SET sequenceId='other-sequence' WHERE id='other-email'`);
    const result = await listAutomationOverview(f.actor);
    assert.equal(result.mailboxes[0].sentToday,1,"Overview agrees with current-owner console and dashboard counts for SQLite timestamps");
    const serialized = JSON.stringify(result);
    assert(serialized.includes("owner legacy subject"));
    assert.doesNotMatch(serialized, /other legacy subject|other-sequence|other-mailbox|private sequence body|bodyHtml/);
  } finally { f.close(); }
});
