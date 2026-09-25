import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { listProspects, nextInQueue, prospectCounts, type ProspectDb } from "./engine-prospects-d1";

/**
 * Aidan's queue rules (Slack, 2026-09-25): "To call" means never attempted; any call
 * moves a business out of the fresh queue; retries come back on a due date; connected
 * or unclear calls need a decision instead of reappearing as fresh; terminal outcomes
 * stay terminal; history is never rewritten.
 */
function database() {
  const raw = new Database(":memory:");
  raw.exec(readFileSync("migrations/0075_engine_prospects_and_call_log.sql", "utf8"));
  raw.exec(readFileSync("migrations/0079_connected_caller.sql", "utf8"));
  const insert = raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [id, name] of [["fresh", "Fresh Roofing"], ["vm", "Voicemail HVAC"], ["cb", "Callback Lawns"], ["connected", "Connected Roofing"], ["no", "Not Interested HVAC"], ["na", "No Answer Roofing"]]) {
    insert.run(id, `p-${id}`, name, "KITCHENER", "ROOFING", null, "519-555-0100", "1 King St", "NO_WEBSITE", "[]", "run1", "2026-09-20", "2026-09-20");
  }
  let n = 0;
  const log = (prospectId: string, outcome: string, createdAt: string, followUpAt: string | null = null, channel = "CALL") => raw.prepare(
    `INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","followUpAt","actor","actorUserId","createdAt") VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(`a${++n}`, `k${n}`, prospectId, channel, outcome, "", followUpAt, "AIDAN", "u", createdAt);
  // Aidan's calling batch on Thursday 2026-09-24 (afternoon, Toronto).
  log("vm", "VOICEMAIL", "2026-09-24T18:00:00.000Z");
  log("na", "NO_ANSWER", "2026-09-24T18:05:00.000Z");
  log("cb", "CALL_BACK", "2026-09-24T18:10:00.000Z", "2026-09-29");
  log("connected", "NOTE", "2026-09-24T18:15:00.000Z");
  log("no", "NOT_INTERESTED", "2026-09-24T18:20:00.000Z");
  const db: ProspectDb = { prepare(sql) { const s = raw.prepare(sql); return { bind: (...v: unknown[]) => ({
    all: async <T,>() => ({ results: s.all(...v) as T[] }), first: async <T,>() => (s.get(...v) as T | undefined) ?? null, run: async () => s.run(...v),
  }) }; } };
  return { raw, db };
}
const names = (rows: { name: string }[]) => rows.map((row) => row.name).sort();

test("once a business is called it leaves the fresh To-call list immediately", async () => {
  const { db } = database();
  assert.deepEqual(names(await listProspects(db, "call", "2026-09-24")), ["Fresh Roofing"]);
  assert.deepEqual(names(await listProspects(db, "call", "2026-10-30")), ["Fresh Roofing"], "old calls never drift back into To call");
});

test("no answer and voicemail come back as retries two days later; callbacks on their date", async () => {
  const { db } = database();
  assert.deepEqual(names(await listProspects(db, "followups", "2026-09-25")), []);
  assert.deepEqual(names(await listProspects(db, "followups", "2026-09-26")), ["No Answer Roofing", "Voicemail HVAC"]);
  assert.deepEqual(names(await listProspects(db, "followups", "2026-09-29")), ["Callback Lawns", "No Answer Roofing", "Voicemail HVAC"]);
  const due = await listProspects(db, "followups", "2026-09-26");
  assert.equal(due.every((row) => row.stage === "retry" && row.dueAt === "2026-09-26"), true);
});

test("a connected call with no next step needs a decision instead of looking fresh; terminal stays closed", async () => {
  const { db } = database();
  assert.deepEqual(names(await listProspects(db, "review", "2026-09-26")), ["Connected Roofing"]);
  const all = await listProspects(db, "all", "2026-09-26");
  assert.equal(all.find((row) => row.name === "Not Interested HVAC")?.stage, "closed");
  assert.equal(all.find((row) => row.name === "Fresh Roofing")?.stage, "fresh");
});

test("the queue serves due retries first, then fresh leads, and never rewrites history", async () => {
  const { raw, db } = database();
  const before = raw.prepare(`SELECT COUNT(*) n FROM "EngineProspectActivity"`).get();
  const thursday = await nextInQueue(db, "2026-09-24", "2026-09-24T04:00:00.000Z", [], 10);
  assert.deepEqual(names(thursday.rows), ["Fresh Roofing"], "the day of the batch only fresh leads remain");
  const saturday = await nextInQueue(db, "2026-09-26", "2026-09-26T04:00:00.000Z", [], 10);
  assert.deepEqual(saturday.rows.map((row) => row.name).slice(0, 2).sort(), ["No Answer Roofing", "Voicemail HVAC"]);
  assert.equal(saturday.rows.at(-1)?.name, "Fresh Roofing");
  const counts = await prospectCounts(db, "2026-09-26");
  assert.deepEqual({ call: counts.call, followups: counts.followups, scheduled: counts.scheduled, review: counts.review }, { call: 1, followups: 2, scheduled: 1, review: 1 });
  assert.deepEqual(raw.prepare(`SELECT COUNT(*) n FROM "EngineProspectActivity"`).get(), before);
});
