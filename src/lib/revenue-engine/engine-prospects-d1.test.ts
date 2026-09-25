import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { listProspectActivity, listProspects, ProspectActivityError, recordProspectActivity, type ProspectDb } from "./engine-prospects-d1";

function database(): ProspectDb & { raw: Database.Database } {
  const raw = new Database(":memory:");
  raw.exec(readFileSync("migrations/0075_engine_prospects_and_call_log.sql", "utf8"));
  raw.exec(readFileSync("migrations/0079_connected_caller.sql", "utf8"));
  const insert = raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("a.example", "p1", "Strong Roofing", "KITCHENER", "ROOFING", "https://a.example/", "519-555-0101", "1 Main St", "STRONG", '["No tap-to-call"]', "run1", "2026-09-24", "2026-09-24");
  insert.run("place:p2", "p2", "No Site Lawns", "WATERLOO", "LANDSCAPING", null, null, null, "NO_WEBSITE", '["No website listed"]', "run1", "2026-09-24", "2026-09-24");
  insert.run("c.example", "p3", "Fine HVAC", "CAMBRIDGE", "HVAC", "https://c.example/", null, null, "WEAK", '[]', "run1", "2026-09-24", "2026-09-24");
  const db: ProspectDb = {
    prepare(sql) {
      const statement = raw.prepare(sql);
      return {
        bind: (...values: unknown[]) => ({
          all: async <T,>() => ({ results: (statement.reader ? statement.all(...values) : []) as T[] }),
          first: async <T,>() => (statement.get(...values) as T | undefined) ?? null,
          run: async () => statement.run(...values),
        }),
      };
    },
  };
  return Object.assign(db, { raw });
}

const key = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

test("the call list shows strong and no-website leads, strongest first, and hides weak ones", async () => {
  const db = database();
  const call = await listProspects(db, "call", "2026-09-24");
  assert.deepEqual(call.map((row) => row.name), ["Strong Roofing", "No Site Lawns"]);
  assert.deepEqual(call[0]!.reasons, ["No tap-to-call"]);
  assert.deepEqual((await listProspects(db, "visit", "2026-09-24")).map((row) => row.name), ["Strong Roofing"]);
});

test("logging is idempotent, schedules follow-ups and closes finished leads", async () => {
  const db = database();
  const first = await recordProspectActivity(db, { idempotencyKey: key(1), prospectId: "a.example", channel: "CALL", outcome: "CALL_BACK", note: "Owner away until Friday", followUpAt: "2026-09-26" }, "AIDAN", "user-aidan");
  assert.equal(first.status, "SAVED");
  assert.equal((await recordProspectActivity(db, { idempotencyKey: key(1), prospectId: "a.example", channel: "CALL", outcome: "CALL_BACK", note: "Owner away until Friday", followUpAt: "2026-09-26" }, "AIDAN", "user-aidan")).status, "ALREADY_SAVED");
  assert.equal((await listProspects(db, "call", "2026-09-24")).some((row) => row.name === "Strong Roofing"), false, "hidden until the follow-up date");
  const due = await listProspects(db, "followups", "2026-09-26");
  assert.equal(due[0]?.lastActor, "AIDAN");
  assert.equal(due[0]?.attempts, 1);
  await recordProspectActivity(db, { idempotencyKey: key(2), prospectId: "a.example", channel: "CALL", outcome: "MEETING_BOOKED", note: "Tuesday 10am", followUpAt: null }, "AIDAN", "user-aidan");
  assert.equal((await listProspects(db, "call", "2026-09-30")).some((row) => row.name === "Strong Roofing"), false);
  assert.equal((await listProspectActivity(db, "a.example")).length, 2);
});

test("do-not-contact is permanent and history is append-only", async () => {
  const db = database();
  await recordProspectActivity(db, { idempotencyKey: key(3), prospectId: "place:p2", channel: "CALL", outcome: "DO_NOT_CONTACT", note: "Asked not to be called", followUpAt: null }, "RILEY", "user-riley");
  await assert.rejects(recordProspectActivity(db, { idempotencyKey: key(4), prospectId: "place:p2", channel: "VISIT", outcome: "INTERESTED", note: "", followUpAt: null }, "AIDAN", "user-aidan"), (error) => error instanceof ProspectActivityError && error.code === "STOPPED");
  assert.equal((await listProspects(db, "call", "2026-09-24")).some((row) => row.prospectId === "place:p2"), false);
  assert.throws(() => db.raw.exec(`UPDATE "EngineProspectActivity" SET "note"='x'`), /APPEND_ONLY/);
  assert.throws(() => db.raw.exec(`DELETE FROM "EngineProspectActivity"`), /APPEND_ONLY/);
  await assert.rejects(recordProspectActivity(db, { idempotencyKey: key(5), prospectId: "missing", channel: "CALL", outcome: "NO_ANSWER", note: "", followUpAt: null }, "AIDAN", "u"), (error) => error instanceof ProspectActivityError && error.code === "NOT_FOUND");
});

test("activity stats count calls, visits and conversations per owner", async () => {
  const { prospectActivityStats } = await import("./engine-prospects-d1");
  const db = database();
  await recordProspectActivity(db, { idempotencyKey: key(6), prospectId: "a.example", channel: "CALL", outcome: "NO_ANSWER", note: "", followUpAt: null }, "AIDAN", "u");
  await recordProspectActivity(db, { idempotencyKey: key(7), prospectId: "a.example", channel: "CALL", outcome: "INTERESTED", note: "", followUpAt: null }, "AIDAN", "u");
  await recordProspectActivity(db, { idempotencyKey: key(8), prospectId: "place:p2", channel: "VISIT", outcome: "MEETING_BOOKED", note: "", followUpAt: null }, "RILEY", "u");
  const stats = await prospectActivityStats(db, "2000-01-01");
  assert.deepEqual(stats.byActor.AIDAN, { calls: 2, visits: 0, conversations: 1 });
  assert.deepEqual(stats.byActor.RILEY, { calls: 0, visits: 1, conversations: 1 });
  assert.equal(stats.interested, 1);
  assert.equal(stats.meetings, 1);
  assert.equal(stats.total, 3);
});
