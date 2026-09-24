import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { authenticateCaller, callerLeads, createCallerToken, recordCallerResult, revokeCallerToken } from "./caller-integration";
import { listProspects, type ProspectDb } from "./engine-prospects-d1";

function database() {
  const raw = new Database(":memory:");
  for (const file of ["0075_engine_prospects_and_call_log.sql", "0078_caller_tokens.sql"]) raw.exec(readFileSync(`migrations/${file}`, "utf8"));
  const insert = raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("a.example", "p1", "Acme Roofing", "KITCHENER", "ROOFING", "https://a.example/", "(519) 555-0101", "12 King St", "STRONG", '["No phone layout"]', "run1", "2026-09-24", "2026-09-24");
  insert.run("place:p2", "p2", "Green Lawns", "WATERLOO", "LANDSCAPING", null, "(519) 555-0102", null, "NO_WEBSITE", "[]", "run1", "2026-09-24", "2026-09-24");
  insert.run("place:p3", "p3", "No Phone Co", "WATERLOO", "HVAC", null, null, null, "NO_WEBSITE", "[]", "run1", "2026-09-24", "2026-09-24");
  const db: ProspectDb = { prepare(sql) { const s = raw.prepare(sql); return { bind: (...v: unknown[]) => ({
    all: async <T,>() => ({ results: s.all(...v) as T[] }), first: async <T,>() => (s.get(...v) as T | undefined) ?? null, run: async () => s.run(...v),
  }) }; } };
  return { raw, db };
}
const AIDAN = { actor: "AIDAN" as const, actorUserId: "user-aidan" };

test("only a live token authenticates, and only its hash is stored", async () => {
  const { raw, db } = database();
  const token = await createCallerToken(db, AIDAN, "Brave laptop");
  assert.match(token, /^axc_[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(raw.prepare(`SELECT * FROM "CallerToken"`).all()).includes(token), false);
  assert.deepEqual(await authenticateCaller(db, `Bearer ${token}`), AIDAN);
  assert.equal(await authenticateCaller(db, "Bearer axc_" + "0".repeat(64)), null);
  assert.equal(await authenticateCaller(db, null), null);
  const id = (raw.prepare(`SELECT substr("tokenHash",1,8) id FROM "CallerToken"`).get() as { id: string }).id;
  await revokeCallerToken(db, "AIDAN", id);
  assert.equal(await authenticateCaller(db, `Bearer ${token}`), null);
});

test("leads come out in the extension's format with the engine id and findings", async () => {
  const { db } = database();
  const leads = await callerLeads(db, "2026-09-24", "2026-09-24T04:00:00.000Z", 25);
  assert.deepEqual(leads.map((lead) => lead.businessName), ["Acme Roofing", "Green Lawns"], "phoneless businesses are skipped");
  assert.equal(leads[0]!.engineProspectId, "a.example");
  assert.match(leads[0]!.callGoal, /Problem observed: No phone layout/);
  assert.equal(leads[0]!.isFixture, false);
});

test("extension results land in the call log, idempotently, with follow-ups and do-not-contact", async () => {
  const { db } = database();
  const key = "00000000-0000-4000-8000-000000000001";
  const body = { idempotencyKey: key, engineProspectId: "a.example", disposition: "callback", summary: "Owner Dave, call Friday", callbackDate: "2026-09-26", doNotContact: false };
  assert.equal((await recordCallerResult(db, body, AIDAN)).status, "SAVED");
  assert.equal((await recordCallerResult(db, body, AIDAN)).status, "ALREADY_SAVED");
  const [row] = await listProspects(db, "followups", "2026-09-26", 10);
  assert.equal(row?.lastOutcome, "CALL_BACK");
  assert.equal(row?.followUpAt, "2026-09-26");
  assert.equal(row?.lastActor, "AIDAN");
  await recordCallerResult(db, { ...body, idempotencyKey: "00000000-0000-4000-8000-000000000002", engineProspectId: "place:p2", disposition: "not_interested", doNotContact: true }, AIDAN);
  assert.equal((await listProspects(db, "call", "2026-09-26", 10)).some((r) => r.prospectId === "place:p2"), false);
  await assert.rejects(() => recordCallerResult(db, { ...body, disposition: "maybe" }, AIDAN));
});
