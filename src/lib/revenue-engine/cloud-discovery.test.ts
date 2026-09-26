import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { DISCOVERY_CELLS, runDiscovery } from "./cloud-discovery";
import type { ProspectDb } from "./engine-prospects-d1";

function database(withLegacyRow = true) {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  for (const file of ["0075_engine_prospects_and_call_log.sql", "0076_engine_email_outreach.sql", "0077_ai_call_briefs.sql"]) raw.exec(readFileSync(`migrations/${file}`, "utf8"));
  if (withLegacyRow) {
    raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("a.example", "pA", "Acme Roofing", "KITCHENER", "ROOFING", "https://a.example/", "519-555-0101", null, "STRONG", "[]", "run1", "2026-09-20", "2026-09-20");
    raw.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","actor","actorUserId") VALUES ('x','k','a.example','CALL','NO_ANSWER','','AIDAN','u')`).run();
  }
  raw.exec(readFileSync("migrations/0081_cloud_discovery.sql", "utf8"));
  const db: ProspectDb = { prepare(sql) { const s = raw.prepare(sql); return { bind: (...v: unknown[]) => ({
    all: async <T,>() => ({ results: s.all(...v) as T[] }), first: async <T,>() => (s.get(...v) as T | undefined) ?? null, run: async () => s.run(...v),
  }) }; } };
  return { raw, db };
}

function google(pages: Record<string, unknown>[]) {
  const calls: { body: { textQuery: string; pageToken?: string } }[] = [];
  const fetcher = async (_url: string, init: { body: string }) => {
    calls.push({ body: JSON.parse(init.body) });
    const page = pages[calls.length - 1] ?? { places: [] };
    return { status: 200, json: async () => page };
  };
  return { calls, fetcher };
}

test("the discovery tables install without touching existing businesses or calls", () => {
  const { raw } = database();
  assert.equal((raw.prepare(`SELECT COUNT(*) n FROM "EngineProspect"`).get() as { n: number }).n, 1);
  assert.equal((raw.prepare(`SELECT COUNT(*) n FROM "EngineProspectActivity"`).get() as { n: number }).n, 1);
  assert.deepEqual(raw.pragma("foreign_key_check"), []);
  assert.deepEqual(raw.prepare(`SELECT "month","requests" FROM "PlacesUsage"`).get(), { month: "2026-09", requests: 133 });
  assert.throws(() => raw.prepare(`DELETE FROM "DiscoveryRun"`).run() && raw.prepare(`INSERT INTO "DiscoveryRun" ("runId","trigger","startedAt") VALUES ('r','SCHEDULE','t')`).run() && raw.prepare(`DELETE FROM "DiscoveryRun"`).run(), /NO_DELETE/);
});

test("no-website businesses with a phone join the call list; website ones wait for a check; duplicates are skipped", async () => {
  const { raw, db } = database();
  const { fetcher } = google([{ places: [
    { id: "n1", displayName: { text: "No Site Plumbing" }, nationalPhoneNumber: "(519) 555-0111", formattedAddress: "1 King St, Guelph, ON, Canada", businessStatus: "OPERATIONAL" },
    { id: "n2", displayName: { text: "No Phone Co" }, businessStatus: "OPERATIONAL" },
    { id: "w1", displayName: { text: "Has Site HVAC" }, websiteUri: "https://www.hassite.example/about", nationalPhoneNumber: "(519) 555-0122", businessStatus: "OPERATIONAL" },
    { id: "pA", displayName: { text: "Acme Roofing" }, websiteUri: "https://a.example/", businessStatus: "OPERATIONAL" },
    { id: "c1", displayName: { text: "Closed Roofing" }, businessStatus: "CLOSED_PERMANENTLY", nationalPhoneNumber: "1" },
  ] }]);
  const result = await runDiscovery(db, { apiKey: "k", trigger: "OWNER", actor: "AIDAN", maxRequests: 1, fetcher, now: new Date("2026-09-26T18:00:00Z") });
  assert.deepEqual({ requests: result.requests, added: result.added, held: result.held }, { requests: 1, added: 1, held: 1 });
  assert.deepEqual(raw.prepare(`SELECT "prospectId","label","phone","address" FROM "EngineProspect" WHERE "prospectId"='place:n1'`).get(),
    { prospectId: "place:n1", label: "NO_WEBSITE", phone: "(519) 555-0111", address: "1 King St, Guelph, ON" });
  assert.equal((raw.prepare(`SELECT "websiteUrl" FROM "DiscoveryHeld" WHERE "placeId"='w1'`).get() as { websiteUrl: string }).websiteUrl, "https://www.hassite.example/");
  const run = raw.prepare(`SELECT "trigger","actor","added","stopReason" FROM "DiscoveryRun"`).get();
  assert.deepEqual(run, { trigger: "OWNER", actor: "AIDAN", added: 1, stopReason: null });
});

test("the search rotates through towns/trades, follows pages, and stops at the monthly free cap", async () => {
  const { raw, db } = database(false);
  const { calls, fetcher } = google([{ places: [], nextPageToken: "p2" }, { places: [] }, { places: [] }]);
  await runDiscovery(db, { apiKey: "k", trigger: "SCHEDULE", maxRequests: 3, fetcher, now: new Date("2026-09-26T11:00:00Z") });
  assert.equal(calls[1]!.body.pageToken, "p2", "the second request follows the first page");
  assert.notEqual(calls[2]!.body.textQuery, calls[0]!.body.textQuery, "then it moves to the next town or trade");
  assert.equal(DISCOVERY_CELLS.length, 3 * 3 * 7);
  raw.prepare(`UPDATE "PlacesUsage" SET "requests" = 599 WHERE "month" = '2026-09'`).run();
  const capped = await runDiscovery(db, { apiKey: "k", trigger: "SCHEDULE", maxRequests: 30, fetcher, now: new Date("2026-09-26T11:00:00Z") });
  assert.equal(capped.requests, 1);
  assert.match(capped.stopReason!, /free Google search allowance/);
  const noKey = await runDiscovery(db, { apiKey: undefined, trigger: "SCHEDULE", maxRequests: 30, fetcher });
  assert.equal(noKey.requests, 0);
  assert.match(noKey.stopReason!, /key isn't set up/);
});
