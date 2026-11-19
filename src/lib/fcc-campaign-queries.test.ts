import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION, FCC_NOV6_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { runFccDailySend } from "@/lib/fcc-campaign-sender";
import { fccScreen, fccStats } from "@/lib/fcc-campaign-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

/** Every SELECT the code prepares, so its query plan can be checked. */
function recordingDatabase() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
  raw.exec(readFileSync(new URL("../../migrations/0037_kv_store.sql", import.meta.url), "utf8"));
  const queries = new Set<string>();
  const db: ProspectDb = {
    prepare(sql) {
      if (/^\s*SELECT/i.test(sql)) queries.add(sql);
      const statement = raw.prepare(sql);
      return { bind: (...values: unknown[]) => ({
        all: async <T,>() => ({ results: statement.all(...values) as T[] }),
        first: async <T,>() => (statement.get(...values) as T | undefined) ?? null,
        run: async () => statement.run(...values),
      }) };
    },
  };
  return { raw, db, queries };
}

/**
 * The send table grows by about 120 rows a weekday. A check that reads all of it once per contact (SQLite's "SCAN" of
 * the table inside a per-contact subquery, or as an inner loop of a join) costs contacts × sends rows on every tick.
 */
function perContactScans(raw: Database.Database, sql: string) {
  const plan = raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array((sql.match(/\?/g) ?? []).length).fill(null)) as Array<{ id: number; parent: number; detail: string }>;
  const byId = new Map(plan.map((row) => [row.id, row]));
  const perContact = (row: { parent: number }): boolean => {
    const parent = byId.get(row.parent);
    return Boolean(parent && (/^CORRELATED|^EXISTS|^LIST SUBQUERY/.test(parent.detail) || perContact(parent)));
  };
  const top = plan.filter((row) => row.parent === 0 && /^(SCAN|SEARCH)/.test(row.detail));
  return plan.filter((row) => /^SCAN (FccCampaignSend|s|hs|s1|s2|s3)\b/.test(row.detail) && (perContact(row) || top.indexOf(row) > 0)).map((row) => row.detail);
}

test("no FCC sending or screen query reads the whole send table once per contact", async () => {
  const { raw, db, queries } = recordingDatabase();
  const add = raw.prepare(`INSERT INTO "FccCampaignContact" ("id","campaignKey","email","firstName","company","filingsJson","emailKind","sendable","status","step1SentAt","step1MessageId","step2DueAt","createdAt","updatedAt")
    VALUES (?,?,?,'Jo','Co','[]','named',1,?,?,?,?,'2026-10-26T00:00:00Z','2026-10-26T00:00:00Z')`);
  const send = raw.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status") VALUES (?,?,?,?,?,?,'SENT')`);
  add.run("ready", FCC_CAMPAIGN_KEY, "ready@a.example", "ready", null, null, null);
  add.run("day3", FCC_CAMPAIGN_KEY, "day3@b.example", "step1_sent", "2026-11-04T15:00:00Z", "<fcc-v5-day3-1@x>", "2026-11-07");
  send.run("d3-1", "day3", 1, "day3@b.example", "2026-11-04", "<fcc-v5-day3-1@x>");
  add.run("day7", FCC_CAMPAIGN_KEY, "day7@c.example", "step2_sent", "2026-10-28T15:00:00Z", "<fcc-v5-day7-1@x>", "2026-10-31");
  send.run("d7-1", "day7", 1, "day7@c.example", "2026-10-28", "<fcc-v5-day7-1@x>");
  send.run("d7-2", "day7", 2, "day7@c.example", "2026-11-02", "<fcc-v5-day7-2@x>");
  add.run("hot", FCC_NOV6_CAMPAIGN_KEY, "hot@d.example", "ready", null, null, null);
  raw.prepare(`UPDATE "FccCampaignContact" SET "filingsJson" = ? WHERE "id" = 'hot'`)
    .run(JSON.stringify([{ company: "Hot Co", rmdNumber: "RMD1", state: "", lastFilingDate: "", filingUrl: "", companyShort: "Hot", listingLine: "Hot's listing still shows no 2026 recertification." }]));
  raw.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 1, "approvedCopy" = ?, "goBy" = 'Aidan', "goAt" = '2026-11-01T00:00:00Z' WHERE "id" = 1`).run(FCC_COPY_VERSION);
  const transport = async () => ({ async send() {}, async close() {} });
  const mailbox = async () => ({
    async hasMessagesFrom() { return false; }, async hasBounceFor() { return false; }, async bounceCount() { return 0; },
    async bouncedAmong() { return []; }, async googleWarning() { return null; }, async close() {},
  });
  let n = 0;
  for (const day of ["2026-11-05T15:00:00Z", "2026-11-09T15:00:00Z"]) {
    await runFccDailySend(db, { fromAddress: "aidan@mail.example", mailingAddress: "257 Example St, Kitchener, ON N2C 0A0, Canada", transport, mailbox, newId: () => `send-${++n}` }, new Date(day));
  }
  await fccScreen(db, new Date("2026-11-09T20:00:00Z"));
  await fccStats(db, [{ key: "", name: "Aidan" }], new Date("2026-11-09T20:00:00Z"));

  const sendQueries = [...queries].filter((sql) => /"FccCampaignSend"/.test(sql));
  assert.ok(sendQueries.length >= 8, `checked ${sendQueries.length} queries`);
  for (const sql of sendQueries) assert.deepEqual(perContactScans(raw, sql), [], sql.replace(/\s+/g, " ").slice(0, 200));
  // And the check really catches the slow form.
  assert.deepEqual(perContactScans(raw, `SELECT c."id" FROM "FccCampaignContact" c WHERE c."campaignKey" = ? AND c."status" = 'ready'
    AND NOT EXISTS (SELECT 1 FROM "FccCampaignSend" s WHERE s."contactId" = c."id" AND s."step" = 1 AND s."status" IN ('CLAIMED','SENT'))`), ["SCAN s"]);
});
