import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { fccStats } from "@/lib/fcc-campaign-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

function database() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
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
  assert.equal(stats.newPerDay, 37);
  assert.equal(stats.weekdaysLeft, 1, "1 ready company");
});
