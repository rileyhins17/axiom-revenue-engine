import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { fccScreen, fccStats } from "@/lib/fcc-campaign-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

const MONDAY = new Date("2026-11-02T14:00:00Z");

function database() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
  raw.exec(readFileSync(new URL("../../migrations/0037_kv_store.sql", import.meta.url), "utf8"));
  const db: ProspectDb = {
    prepare(sql) {
      const statement = raw.prepare(sql);
      return { bind: (...values: unknown[]) => ({
        all: async <T,>() => ({ results: statement.all(...values) as T[] }),
        first: async <T,>() => (statement.get(...values) as T | undefined) ?? null,
        run: async () => statement.run(...values),
      }) };
    },
  };
  return { raw, db };
}

test("the FCC stats count real replies, guess the no's, and split by email version, inbox and day", async () => {
  const { raw, db } = database();
  const add = (id: string, status: string, messageId: string | null, reason: string | null, inbox: string | null, followedUp = false) =>
    raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","step1SentAt","step1MessageId","step2SentAt","stoppedReason","senderAddress","createdAt","updatedAt")
      VALUES (?,?,?,?,?,'[]','named',1,?,?,?,?,?,?,'2026-10-26T00:00:00Z','2026-10-30T00:00:00Z')`)
      .run(id, FCC_CAMPAIGN_KEY, `${id}@x.example`, "Jo", `Co ${id}`, status, messageId ? "2026-10-28T15:00:00Z" : null, messageId, followedUp ? "2026-11-02T15:00:00Z" : null, reason, inbox);
  add("a", "replied", "<fcc-a-1@gmail.com>", "Replied stop (Aidan, Oct 28)", null);
  add("b", "replied", "<fcc-v4-b-1@gmail.com>", "They wrote back Oct 30, so no more emails: \"Yes, send the list.\"", null, true);
  add("c", "replied", "<fcc-v4-c-1@gmail.com>", "They sent an automatic reply Oct 29, so no more emails: \"Out until Monday.\"", null);
  add("d", "bounced", "<fcc-v4-d-1@gmail.com>", "The email bounced", null);
  add("e", "step2_sent", "<fcc-v4-e-1@gmail.com>", null, "riley@mail.example", true);
  add("f", "suppressed", "<fcc-v4-f-1@gmail.com>", "Do not contact", null);
  add("g", "ready", null, null, null);
  const send = (id: string, contact: string, step: number, day: string, inbox: string | null) =>
    raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status","senderAddress") VALUES (?,?,?,?,?,?,'SENT',?)`)
      .run(id, contact, step, `${contact}@x.example`, day, `<${id}>`, inbox);
  send("s1", "a", 1, "2026-10-28", null);
  send("s2", "b", 1, "2026-10-29", null);
  send("s3", "e", 1, "2026-10-29", "riley@mail.example");
  send("s4", "b", 2, "2026-11-02", null);
  send("s5", "e", 2, "2026-11-02", "riley@mail.example");

  const stats = await fccStats(db, [{ key: "", name: "Aidan" }, { key: "riley@mail.example", name: "Riley" }], new Date("2026-11-02T20:00:00Z"));
  assert.equal(stats.emailed, 6);
  assert.deepEqual(stats.replies, { real: 2, automatic: 1, saidNo: 1, afterFollowUp: 1 });
  assert.equal(stats.replyRate, 2 / 6);
  assert.equal(stats.bounced, 1);
  assert.equal(stats.stopped, 1);
  assert.deepEqual(stats.byVersion.map((row) => [row.label, row.emailed, row.replies]), [["Calmer email (Oct 28)", 1, 1], ["Question email (Oct 29–Nov 1)", 5, 1]]);
  assert.deepEqual(stats.byInbox.map((row) => [row.label, row.emailed, row.replies]), [["Aidan", 5, 2], ["Riley", 1, 0]]);
  assert.deepEqual(stats.days[0], { day: "2026-11-02", first: 0, followUps: 2, byInbox: [{ name: "Aidan", sent: 1 }, { name: "Riley", sent: 1 }] });
  assert.deepEqual(stats.today, [{ name: "Aidan", sentToday: 1, dailyMax: 60 }, { name: "Riley", sentToday: 1, dailyMax: 15 }]);
  assert.equal(stats.newPerDay, 25, "a third of 75: each new company also takes a day-3 and a day-7 email");
  assert.equal(stats.weekdaysLeft, 1, "1 ready company");
});

let row = 0;
function add(raw: Database.Database, key: string, email: string, status: string, createdAt: string, extra: { sendable?: boolean; dueAt?: string } = {}) {
  row += 1;
  raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","contactName","title","phone","company","filingsJson","emailKind","sendable","holdReason","status","step1SentAt","step1MessageId","step2DueAt","createdAt","updatedAt")
    VALUES (?,?,?,'Jane','Jane Doe','Owner','',?,'[]','named',?,NULL,?,?,?,?,?,?)`).run(
    `c${row}`, key, email, `${email} Co`, extra.sendable === false ? 0 : 1, status,
    extra.dueAt ? "2026-10-20T14:00:00Z" : null, extra.dueAt ? "<x>" : null, extra.dueAt ?? null, createdAt, createdAt,
  );
}

test("the FCC screen shows the November 6 list as one batch and leaves its people out of the March numbers", async () => {
  const { raw, db } = database();
  const march = "2026-10-26T23:24:30.000Z";
  add(raw, FCC_CAMPAIGN_KEY, "march-only@a.example", "ready", march);
  add(raw, FCC_CAMPAIGN_KEY, "on-both@b.example", "ready", march);
  add(raw, FCC_CAMPAIGN_KEY, "due-only@c.example", "step1_sent", march, { dueAt: "2026-11-01" });
  add(raw, FCC_CAMPAIGN_KEY, "due-both@d.example", "step1_sent", march, { dueAt: "2026-11-01" });
  add(raw, FCC_CAMPAIGN_KEY, "said-no@e.example", "replied", march);
  add(raw, FCC_NOV6_CAMPAIGN_KEY, "on-both@b.example", "ready", "2026-11-01T20:00:00.000Z");
  add(raw, FCC_NOV6_CAMPAIGN_KEY, "due-both@d.example", "step1_sent", "2026-11-01T20:00:00.001Z");
  add(raw, FCC_NOV6_CAMPAIGN_KEY, "held@f.example", "held", "2026-11-01T20:00:00.002Z", { sendable: false });
  add(raw, FCC_NOV6_CAMPAIGN_KEY, "gone@g.example", "bounced", "2026-11-01T20:00:00.003Z");
  add(raw, FCC_NOV6_CAMPAIGN_KEY, "said-no@e.example", "replied", "2026-11-01T20:00:00.004Z");

  const screen = await fccScreen(db, MONDAY);
  assert.equal(screen.batches.length, 2, "one row for the whole list, not one per contact");
  assert.deepEqual(screen.batches[0], { name: "November 6 list", loadedAt: "2026-11-01T20:00:00.000Z", total: 5, ready: 1, held: 1, emailed: 0, stopped: 2 });
  assert.equal(screen.batches[1].ready, 1, "someone on both lists counts once, on the November 6 list");
  assert.equal(screen.ready, 2);
  assert.equal(screen.followUpsDue, 1, "the sender gives people on the hot list no March follow-up");
  assert.deepEqual(screen.bounces.map((person) => person.email), ["gone@g.example"]);
  assert.deepEqual(screen.replies.map((person) => person.email), ["said-no@e.example"], "one row per address");
});

test("before the list is loaded, the FCC screen shows only the March batches", async () => {
  const { raw, db } = database();
  add(raw, FCC_CAMPAIGN_KEY, "march-only@a.example", "ready", "2026-10-26T23:24:30.000Z");
  const screen = await fccScreen(db, MONDAY);
  assert.equal(screen.batches.length, 1);
  assert.equal(screen.ready, 1);
});

test("the FCC stats count the November 6 email, credit each reply to the latest email before it, and show the subject test by subject", async () => {
  const { raw, db } = database();
  const add = (id: string, key: string, email: string, status: string, messageId: string, sentAt: string, updatedAt: string, reason: string | null = null) =>
    raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","step1SentAt","step1MessageId","stoppedReason","createdAt","updatedAt")
      VALUES (?,?,?,'Jo','Co','[]','named',1,?,?,?,?,'2026-10-26T00:00:00Z',?)`).run(id, key, email, status, sentAt, messageId, reason, updatedAt);
  // Got the March email, then the November 6 one, and answered after the second: the reply is the November 6 email's.
  add("m-both", FCC_CAMPAIGN_KEY, "both@a.example", "replied", "<fcc-v4-m-both-1@gmail.com>", "2026-10-29T15:00:00Z", "2026-11-05T14:00:00Z", "They wrote back Nov 4, so no more emails: \"Send it.\"");
  add("h-both", FCC_NOV6_CAMPAIGN_KEY, "both@a.example", "replied", "<fcc-nov6-h-both-1@gmail.com>", "2026-11-03T15:00:00Z", "2026-11-05T14:00:00Z", "They wrote back Nov 4, so no more emails: \"Send it.\"");
  // Answered the March email, found by the hot-list check before their November 6 email: the March email keeps the reply.
  add("m-early", FCC_CAMPAIGN_KEY, "early@b.example", "replied", "<fcc-v4-m-early-1@gmail.com>", "2026-10-29T15:00:00Z", "2026-11-03T14:00:00Z", "They wrote back to the March email");
  add("h-early", FCC_NOV6_CAMPAIGN_KEY, "early@b.example", "replied", "", "", "2026-11-03T14:00:00Z", "They wrote back to the March email");
  raw.prepare(`UPDATE "FccCampaignContact" SET "step1SentAt" = NULL, "step1MessageId" = NULL WHERE "id" = 'h-early'`).run();
  add("h-only", FCC_NOV6_CAMPAIGN_KEY, "hot@c.example", "step1_sent", "<fcc-nov6-h-only-1@gmail.com>", "2026-11-03T15:00:00Z", "2026-11-03T15:00:00Z");
  add("a1", FCC_CAMPAIGN_KEY, "a1@e.example", "replied", "<fcc-v7a-a1-1@gmail.com>", "2026-11-05T15:00:00Z", "2026-11-06T14:00:00Z", "They wrote back Nov 5, so no more emails: \"How much?\"");
  add("a2", FCC_CAMPAIGN_KEY, "a2@f.example", "step1_sent", "<fcc-v7a-a2-1@gmail.com>", "2026-11-05T15:00:00Z", "2026-11-05T15:00:00Z");
  add("b1", FCC_CAMPAIGN_KEY, "b1@g.example", "step1_sent", "<fcc-v7b-b1-1@gmail.com>", "2026-11-05T15:00:00Z", "2026-11-05T15:00:00Z");

  const stats = await fccStats(db, [{ key: "", name: "Aidan" }], new Date("2026-11-06T20:00:00Z"));
  assert.equal(stats.emailed, 6, "people emailed: someone on both lists counts once");
  assert.equal(stats.replies.real, 3, "three people answered, each counted once");
  assert.equal(stats.replyRate, 3 / 6);
  assert.deepEqual(stats.byVersion.map((row) => [row.label, row.emailed, row.replies]), [
    ["Question email (Oct 29–Nov 1)", 2, 1],
    ["November 6 email", 2, 1],
    ["Subject test: “Question about …'s RMD listing”", 2, 1],
    ["Subject test: “…'s FCC listing”", 1, 0],
  ]);
});

test("the FCC screen counts day-7 emails as follow-ups and shows when the next ones fall due", async () => {
  const { raw, db } = database();
  const followedUp = (email: string, firstDay: string, secondDay: string, day7?: string) => {
    add(raw, FCC_CAMPAIGN_KEY, email, "step2_sent", "2026-10-26T23:24:30.000Z", { dueAt: firstDay });
    const id = `c${row}`;
    const send = raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status") VALUES (?,?,?,?,?,?,'SENT')`);
    send.run(`${id}-1`, id, 1, email, firstDay, `<${id}-1>`);
    send.run(`${id}-2`, id, 2, email, secondDay, `<${id}-2>`);
    if (day7) send.run(`${id}-3`, id, 3, email, day7, `<${id}-3>`);
  };
  followedUp("due@a.example", "2026-10-28", "2026-11-02");
  followedUp("late@b.example", "2026-10-28", "2026-11-06");
  followedUp("done@c.example", "2026-10-26", "2026-10-29", "2026-11-06");
  followedUp("today@d.example", "2026-10-26", "2026-10-29", "2026-11-09");
  followedUp("hot@e.example", "2026-10-28", "2026-11-02");
  add(raw, FCC_NOV6_CAMPAIGN_KEY, "hot@e.example", "step1_sent", "2026-11-01T20:00:00.000Z");
  add(raw, FCC_CAMPAIGN_KEY, "day3@f.example", "step1_sent", "2026-10-26T23:24:30.000Z", { dueAt: "2026-11-12" });

  const screen = await fccScreen(db, new Date("2026-11-09T20:00:00Z"));
  assert.equal(screen.day7Due, 1, "due@ is due; late@ waits 4 days after its day-3 email; the hot list gets none");
  assert.equal(screen.followUpsDue, 1);
  assert.equal(screen.followUpsLater, 2, "late@'s day-7 (Nov 10) and day3@'s day-3 follow-up (Nov 12)");
  assert.equal(screen.nextFollowUpDay, "2026-11-10");
  assert.deepEqual(screen.sentToday, { first: 0, followUps: 1 }, "the day-7 email sent today counts as a follow-up");
  assert.deepEqual(screen.sentAllTime, { first: 5, followUps: 7 });
});

test("the FCC screen counts the Nov 6 follow-ups as follow-ups due: 5 days after the first email, from Mon Nov 9 until Fri Nov 13", async () => {
  const { raw, db } = database();
  const emailed = (email: string, firstDay: string, status = "step1_sent") => {
    add(raw, FCC_NOV6_CAMPAIGN_KEY, email, status, "2026-11-01T20:00:00.000Z");
    const id = `c${row}`;
    raw.prepare(`UPDATE "FccCampaignContact" SET "step1SentAt" = ?, "step1MessageId" = ? WHERE "id" = ?`).run(`${firstDay}T15:00:00Z`, `<fcc-nov6-${id}-1@x.example>`, id);
    raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status") VALUES (?,?,1,?,?,?,'SENT')`)
      .run(`${id}-1`, id, email, firstDay, `<fcc-nov6-${id}-1@x.example>`);
  };
  emailed("mon@a.example", "2026-11-02"); // due Sat Nov 7, so Monday Nov 9
  emailed("tue@b.example", "2026-11-05"); // due Tue Nov 10
  emailed("said-no@c.example", "2026-11-03", "replied");

  const friday = await fccScreen(db, new Date("2026-11-06T20:00:00Z"));
  assert.deepEqual([friday.followUpsDue, friday.followUpsLater, friday.nextFollowUpDay], [0, 2, "2026-11-09"]);
  const monday = await fccScreen(db, new Date("2026-11-09T20:00:00Z"));
  assert.deepEqual([monday.followUpsDue, monday.followUpsLater, monday.nextFollowUpDay], [1, 1, "2026-11-10"]);
  const afterFinishLine = await fccScreen(db, new Date("2026-11-16T20:00:00Z"));
  assert.deepEqual([afterFinishLine.followUpsDue, afterFinishLine.followUpsLater], [0, 0], "the follow-up closes with the Nov 13 call, so it stops showing as waiting");
});
