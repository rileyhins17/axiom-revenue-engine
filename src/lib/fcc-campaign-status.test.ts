import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { fccScreen } from "@/lib/fcc-campaign-status";
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

test("after its last day the November 6 list shows nothing ready, and someone on both lists counts once, on March", async () => {
  const { raw, db } = database();
  add(raw, FCC_CAMPAIGN_KEY, "on-both@b.example", "ready", "2026-10-26T23:24:30.000Z");
  add(raw, FCC_NOV6_CAMPAIGN_KEY, "on-both@b.example", "ready", "2026-11-01T20:00:00.000Z");
  add(raw, FCC_NOV6_CAMPAIGN_KEY, "hot-only@c.example", "ready", "2026-11-01T20:00:00.001Z");

  const lastDay = await fccScreen(db, new Date("2026-11-05T15:00:00Z"));
  assert.equal(lastDay.batches[0].ready, 2);
  assert.equal(lastDay.ready, 2);

  const closed = await fccScreen(db, new Date("2026-11-06T15:00:00Z"));
  assert.equal(closed.batches[0].ready, 0);
  assert.equal(closed.batches[0].total, 2, "the list's own total stays");
  assert.equal(closed.batches[1].ready, 1);
  assert.equal(closed.ready, 1, "hot-only@c.example has nothing left to send");
});

test("before the list is loaded, the FCC screen shows only the March batches", async () => {
  const { raw, db } = database();
  add(raw, FCC_CAMPAIGN_KEY, "march-only@a.example", "ready", "2026-10-26T23:24:30.000Z");
  const screen = await fccScreen(db, MONDAY);
  assert.equal(screen.batches.length, 1);
  assert.equal(screen.ready, 1);
});
