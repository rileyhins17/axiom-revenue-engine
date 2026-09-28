import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { applyEngineSchema } from "./test-support/engine-schema";

const REBUILT = ["EngineProspect", "EngineProspectActivity", "EngineProspectEmail", "EngineEmailSend", "AiCallBrief", "CallerContactEdit"];
const HASH = "a".repeat(64);

/** A database at 0082 with a row in every table 0083 rebuilds, including gaps in rowids. */
function seeded() {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  applyEngineSchema(raw, "0082_caller_contact_edits.sql");
  const prospect = raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  prospect.run("acme.example", "pA", "Acme Roofing", "KITCHENER", "ROOFING", "https://acme.example/", "519-555-0101", "1 King St, Kitchener, ON", "STRONG", "[\"No phone layout.\"]", "run1", "2026-09-20", "2026-09-20");
  prospect.run("place:nrg", "pN", "NRG HVAC", "WATERLOO", "HVAC", null, "519-555-0102", null, "NO_WEBSITE", "[]", "run1", "2026-09-20", "2026-09-20");
  prospect.run("place:gone", "pG", "Gone Landscaping", "CAMBRIDGE", "LANDSCAPING", null, "519-555-0103", null, "NO_WEBSITE", "[]", "run1", "2026-09-20", "2026-09-20");
  const activity = raw.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","actor","actorUserId","createdAt","callerEventId","callerAttemptId","occurredAt","callerOutcome","callerAttempted","callerConnected") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  activity.run("a1", "k1", "acme.example", "CALL", "NO_ANSWER", "", "AIDAN", "u", "2026-09-25T14:00:00.000Z", null, null, null, null, null, null);
  activity.run("a2", "k2", "acme.example", "NOTE", "NOTE", "Owner is Dave", "RILEY", "u", "2026-09-25T15:00:00.000Z", null, null, null, null, null, null);
  activity.run("a3", "k3", "place:nrg", "CALL", "DO_NOT_CONTACT", "Asked to be removed", "AIDAN", "u", "2026-09-25T16:00:00.000Z", "e3", "t3", "2026-09-25T16:00:00.000Z", "do_not_contact", 1, 1);
  raw.prepare(`INSERT INTO CallerContactControl (workspaceId,contactKey,sourceEntityId,stopped,stopReason) VALUES ('axiom','ec-nrg','place:nrg',1,'Asked to be removed')`).run();
  raw.prepare(`INSERT INTO "EngineProspectEmail" VALUES ('acme.example','owner@acme.example','https://acme.example/','MAILTO_LINK','2026-09-20','run1')`).run();
  raw.prepare(`INSERT INTO "EngineEmailSend" ("sendId","prospectId","email","sendDay","templateVersion","unsubscribeToken","status") VALUES ('s1','acme.example','owner@acme.example','2026-09-24','first-touch-v1',?,'SENT')`).run("b".repeat(40));
  raw.prepare(`INSERT INTO "AiCallBrief" ("prospectId","inputHash","model","promptVersion","brief") VALUES ('acme.example',?,'gemini','v1','Talk about the phone layout.')`).run(HASH);
  raw.prepare(`INSERT INTO "CallerContactEdit" VALUES ('00000000-0000-4000-8000-000000000001','axiom','acme.example','AIDAN','u','519-555-0101','(519) 555-0199',NULL,?,'2026-09-26','2026-09-26')`).run(HASH);
  raw.prepare(`UPDATE "DiscoveryCursor" SET "cellIndex" = 16, "pageToken" = 'next-page' WHERE "id" = 1`).run();
  return raw;
}

const rows = (raw: Database.Database, table: string) => raw.prepare(`SELECT rowid AS __rowid, * FROM "${table}" ORDER BY rowid`).all();
// Wrangler normalizes migration line endings to LF before sending them to D1 (live stores LF).
const schema = (raw: Database.Database) => (raw.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all() as { type: string; name: string; sql: string | null }[])
  .map((o) => ({ ...o, sql: o.sql?.replaceAll("\r\n", "\n") ?? null }));
const migrate = (raw: Database.Database) => {
  raw.exec("BEGIN");
  raw.exec(readFileSync("migrations/0083_wider_market.sql", "utf8"));
  raw.exec("COMMIT");
};

test("0083 keeps every business, call, email, brief and contact edit exactly, rowids included", () => {
  const raw = seeded();
  // A deleted-then-reinserted history row leaves a rowid gap that must survive.
  const before = Object.fromEntries(REBUILT.map((table) => [table, rows(raw, table)]));
  const viewBefore = raw.prepare(`SELECT * FROM EngineProspectActivityCurrent ORDER BY activityRowId`).all();
  migrate(raw);
  for (const table of REBUILT) assert.deepEqual(rows(raw, table), before[table], `${table} rows changed`);
  assert.deepEqual(raw.prepare(`SELECT * FROM EngineProspectActivityCurrent ORDER BY activityRowId`).all(), viewBefore);
  assert.deepEqual(raw.pragma("foreign_key_check"), []);
  assert.equal((raw.pragma("integrity_check") as { integrity_check: string }[])[0]!.integrity_check, "ok");
  assert.equal(schema(raw).filter((o) => o.name.startsWith("_m0083_")).length, 0, "temporary copies removed");
  assert.deepEqual(raw.prepare(`SELECT "cellIndex", "pageToken" FROM "DiscoveryCursor"`).get(), { cellIndex: 0, pageToken: null });
});

/** The two call-history guards are rewritten (same checks, D1-safe form); everything else is identical. */
const REWRITTEN_GUARDS = ["trigger:EngineProspectActivity_caller_guard", "trigger:EngineProspectActivity_conversion_guard"];

test("0083 recreates every index, trigger and the history view; only the widened lists and the two guards' wording change", () => {
  const raw = seeded();
  const before = schema(raw);
  migrate(raw);
  const after = new Map(schema(raw).map((o) => [`${o.type}:${o.name}`, o.sql]));
  for (const object of before) {
    const key = `${object.type}:${object.name}`;
    assert.ok(after.has(key), `${key} is missing`);
    if (key === "table:EngineProspect" || REWRITTEN_GUARDS.includes(key)) continue;
    assert.equal(after.get(key), object.sql, `${key} definition changed`);
  }
  assert.equal(after.size, before.length, "no extra objects");
  assert.match(after.get("table:EngineProspect")!, /'GUELPH', 'BRANTFORD', 'STRATFORD', 'WOODSTOCK', 'ELMIRA', 'NEW_HAMBURG', 'AYR', 'BRESLAU'/);
  assert.match(after.get("table:EngineProspect")!, /'PLUMBING', 'ELECTRICAL'/);
  for (const key of REWRITTEN_GUARDS) assert.doesNotMatch(after.get(key)!, /\bCASE\b/, `${key} must not use CASE (D1's remote runner rejects it in a trigger)`);
});

test("the rewritten call-history guards give exactly the old guards' result for every kind of entry", () => {
  // Same database state before (0079 guards) and after (0083 guards): a normal business, one
  // Caller holds, one linked to Orbit, one being converted and one marked do-not-contact.
  const prepare = (raw: Database.Database) => {
    for (const id of ["held", "linked", "converting", "free"]) raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,'KITCHENER','ROOFING',NULL,'1',NULL,'NO_WEBSITE','[]','r','2026-09-28','2026-09-28')`).run(`place:${id}`, `p-${id}`, id);
    raw.prepare(`INSERT INTO CallerContactControl (workspaceId,contactKey,sourceEntityId,phase) VALUES ('axiom','ec-held','place:held','armed')`).run();
    raw.prepare(`INSERT INTO CallerSourceLink (workspaceId,linkId,grantId,sourceEntityId,engineContactKey,orbitWorkspaceId,orbitContactId,identityJson,state,revision,confirmedBy,createdAt) VALUES ('axiom','l1','g','place:linked','ec-linked','ow','oc1','{}','active',1,'u','2026-09-28')`).run();
    raw.prepare(`INSERT INTO CallerConversionJob (workspaceId,conversionId,sourceEntityId,contactKey,grantId,actorId,requestHash,payloadHash,payloadJson,sourceSnapshot,status,createdAt) VALUES ('axiom','c1','place:converting','ec-converting','g','u','h','h','{}','{}','pending','2026-09-28')`).run();
  };
  const outcomes = (raw: Database.Database) => {
    const results: string[] = [];
    let n = 0;
    for (const prospect of ["place:held", "place:linked", "place:converting", "place:nrg", "place:free"]) {
      for (const channel of ["CALL", "VISIT", "EMAIL", "NOTE"]) {
        for (const event of [null, "caller-event"]) {
          n += 1;
          try {
            raw.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","actor","actorUserId","callerEventId") VALUES (?,?,?,?,?,'','AIDAN','u',?)`)
              .run(`t${n}`, `t${n}`, prospect, channel, channel === "NOTE" ? "NOTE" : "NO_ANSWER", event ? `${event}-${n}` : null);
            results.push(`${prospect} ${channel} ${event ?? "manual"}: saved`);
          } catch (error) { results.push(`${prospect} ${channel} ${event ?? "manual"}: ${(error as Error).message}`); }
        }
      }
    }
    return results;
  };
  const old = seeded(); prepare(old);
  const rebuilt = seeded(); migrate(rebuilt); prepare(rebuilt);
  const expected = outcomes(old);
  assert.deepEqual(outcomes(rebuilt), expected);
  // And the old guards really do refuse these cases, so the comparison is meaningful.
  for (const code of ["CALLER_CLAIM_REQUIRED", "CALLER_LINK_REQUIRED", "CALLER_STOPPED"]) assert.ok(expected.some((line) => line.endsWith(code)), `${code} never fired`);
  assert.ok(expected.some((line) => line.endsWith("saved")));
});

test("no migration from 0083 on puts a CASE expression inside a trigger (D1's remote runner rejects it)", () => {
  for (const name of readdirSync("migrations").filter((file) => file >= "0083")) {
    const sql = readFileSync(`migrations/${name}`, "utf8").replace(/--.*$/gm, "");
    for (const trigger of sql.match(/CREATE TRIGGER[\s\S]*?\bEND\s*;/gi) ?? []) {
      const body = trigger.slice(trigger.search(/\bBEGIN\b/i));
      assert.doesNotMatch(body.slice(5, -4), /\bCASE\b/i, `${name}: ${trigger.slice(0, 80)}`);
    }
  }
});

test("after 0083 the new towns and trades are accepted and every old rule still holds", () => {
  const raw = seeded();
  migrate(raw);
  const insert = raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,?,?,NULL,?,NULL,'NO_WEBSITE','[]','run2','2026-09-28','2026-09-28')`);
  for (const [city, niche] of [["GUELPH", "PLUMBING"], ["NEW_HAMBURG", "ELECTRICAL"], ["BRESLAU", "ROOFING"], ["AYR", "LANDSCAPING"], ["WOODSTOCK", "HVAC"]] as const) {
    insert.run(`place:${city}-${niche}`, `p-${city}`, `${city} ${niche}`, city, niche, "519-555-0110");
  }
  assert.throws(() => insert.run("place:toronto", "pT", "Toronto Roofing", "TORONTO", "ROOFING", "1"), /CHECK constraint failed/);
  assert.throws(() => insert.run("place:dentist", "pD", "Guelph Dental", "GUELPH", "DENTIST", "1"), /CHECK constraint failed/);
  assert.throws(() => raw.prepare(`DELETE FROM "EngineProspect" WHERE "prospectId" = 'place:gone'`).run(), /ENGINE_PROSPECT_NO_DELETE/);
  assert.throws(() => raw.prepare(`UPDATE "EngineProspectActivity" SET "note" = 'x'`).run(), /APPEND_ONLY/);
  assert.throws(() => raw.prepare(`DELETE FROM "EngineProspectActivity"`).run(), /APPEND_ONLY/);
  assert.throws(() => raw.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","actor","actorUserId") VALUES ('a4','k4','place:nrg','CALL','NO_ANSWER','','AIDAN','u')`).run(), /CALLER_STOPPED/, "do-not-contact still blocks new calls");
  assert.throws(() => raw.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","actor","actorUserId") VALUES ('a5','k5','missing','CALL','NO_ANSWER','','AIDAN','u')`).run(), /FOREIGN KEY/);
  assert.throws(() => raw.prepare(`UPDATE "EngineEmailSend" SET "status" = 'FAILED'`).run(), /FORWARD_ONLY/);
  assert.throws(() => raw.prepare(`DELETE FROM "EngineEmailSend"`).run(), /NO_DELETE/);
  assert.throws(() => raw.prepare(`UPDATE "CallerContactEdit" SET "note" = 'x'`).run(), /IMMUTABLE/);
  assert.throws(() => raw.prepare(`DELETE FROM "CallerContactEdit"`).run(), /NO_DELETE/);
  // New history rows still sort after the existing ones.
  raw.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","actor","actorUserId") VALUES ('a6','k6','place:GUELPH-PLUMBING','CALL','VOICEMAIL','','AIDAN','u')`).run();
  const order = raw.prepare(`SELECT activityId FROM EngineProspectActivityCurrent ORDER BY activityRowId`).all().map((row) => (row as { activityId: string }).activityId);
  assert.deepEqual(order, ["a1", "a2", "a3", "a6"]);
});

test("0083 also works when a table it rebuilds is empty", () => {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  applyEngineSchema(raw);
  assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM "EngineProspect"`).get() as { n: number }).n, 0);
  assert.deepEqual(raw.pragma("foreign_key_check"), []);
});
