import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { DISCOVERY_CELLS, discoveryCells, runDiscovery, townFromAddress } from "./cloud-discovery";
import { buildTextSearchRequest, inOntario, MARKET_RECTANGLE, QUERIES } from "./places-discovery";
import { applyEngineSchema } from "./test-support/engine-schema";
import type { ProspectDb } from "./engine-prospects-d1";

function database(withLegacyRow = true) {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  applyEngineSchema(raw, "0077_ai_call_briefs.sql");
  if (withLegacyRow) {
    raw.prepare(`INSERT INTO "EngineProspect" VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("a.example", "pA", "Acme Roofing", "KITCHENER", "ROOFING", "https://a.example/", "519-555-0101", null, "STRONG", "[]", "run1", "2026-09-20", "2026-09-20");
    raw.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","actor","actorUserId") VALUES ('x','k','a.example','CALL','NO_ANSWER','','AIDAN','u')`).run();
  }
  raw.exec(readFileSync("migrations/0078_caller_tokens.sql", "utf8"));
  raw.exec(readFileSync("migrations/0079_connected_caller.sql", "utf8"));
  raw.exec(readFileSync("migrations/0080_health_alerts.sql", "utf8"));
  raw.exec(readFileSync("migrations/0081_cloud_discovery.sql", "utf8"));
  raw.exec(readFileSync("migrations/0082_caller_contact_edits.sql", "utf8"));
  raw.exec(readFileSync("migrations/0083_wider_market.sql", "utf8"));
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
  assert.deepEqual(raw.prepare(`SELECT "prospectId","label","phone","address","city" FROM "EngineProspect" WHERE "prospectId"='place:n1'`).get(),
    { prospectId: "place:n1", label: "NO_WEBSITE", phone: "(519) 555-0111", address: "1 King St, Guelph, ON", city: "GUELPH" }, "the town comes from Google's address");
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
  assert.equal(DISCOVERY_CELLS.length, 11 * Object.values(QUERIES).reduce((sum, list) => sum + list.length, 0));
  raw.prepare(`UPDATE "PlacesUsage" SET "requests" = 599 WHERE "month" = '2026-09'`).run();
  const capped = await runDiscovery(db, { apiKey: "k", trigger: "SCHEDULE", maxRequests: 30, fetcher, now: new Date("2026-09-26T11:00:00Z") });
  assert.equal(capped.requests, 1);
  assert.match(capped.stopReason!, /free Google search allowance/);
  const noKey = await runDiscovery(db, { apiKey: undefined, trigger: "SCHEDULE", maxRequests: 30, fetcher });
  assert.equal(noKey.requests, 0);
  assert.match(noKey.stopReason!, /key isn't set up/);
});

test("the rotation covers all 11 towns and 5 trades, new ground first, spread across towns each pass", () => {
  const key = (cell: { city: string; niche: string; query: string }) => `${cell.city}|${cell.niche}|${cell.query}`;
  assert.equal(new Set(DISCOVERY_CELLS.map(key)).size, DISCOVERY_CELLS.length, "no duplicate searches");
  assert.equal(new Set(DISCOVERY_CELLS.map((cell) => cell.city)).size, 11);
  assert.equal(new Set(DISCOVERY_CELLS.map((cell) => cell.niche)).size, 5);
  const original = (cell: { city: string; niche: string }) => ["KITCHENER", "WATERLOO", "CAMBRIDGE"].includes(cell.city) && ["ROOFING", "HVAC", "LANDSCAPING"].includes(cell.niche);
  const firstOriginal = DISCOVERY_CELLS.findIndex(original);
  assert.equal(firstOriginal, DISCOVERY_CELLS.length - 3 * 3 * 7, "the 63 searches already done come last");
  assert.ok(DISCOVERY_CELLS.slice(firstOriginal).every(original));
  // The first day's 30 searches reach several towns and trades, not seven phrasings of one.
  const firstDay = DISCOVERY_CELLS.slice(0, 30);
  assert.ok(new Set(firstDay.map((cell) => cell.city)).size >= 5 && new Set(firstDay.map((cell) => cell.niche)).size === 5);
  assert.ok(firstDay.every((cell) => cell.query === QUERIES[cell.niche][0]), "every town and trade gets its main phrasing before any second phrasing");
  assert.deepEqual(discoveryCells(["GUELPH"], ["PLUMBING"]).map((cell) => cell.query), [...QUERIES.PLUMBING]);
});

test("a business's town comes from its Google address when it names one of our towns", () => {
  assert.equal(townFromAddress("45 Victoria St S, Kitchener, ON N2G 2B2", "BRESLAU"), "KITCHENER");
  assert.equal(townFromAddress("100 Peel St, New Hamburg, ON N3A 1E5", "KITCHENER"), "NEW_HAMBURG");
  assert.equal(townFromAddress("RR 1, Ayr, ON N0B 1E0", "CAMBRIDGE"), "AYR");
  assert.equal(townFromAddress("12 Main St, Fergus, ON", "GUELPH"), "GUELPH", "a town outside the market keeps the searched town");
  assert.equal(townFromAddress("Waterloo Region, ON", "ELMIRA"), "ELMIRA", "a region name is not a town");
  assert.equal(townFromAddress(null, "STRATFORD"), "STRATFORD");
});

test("searches are limited to the market area, and results abroad are dropped", async () => {
  const request = JSON.parse(buildTextSearchRequest("CAMBRIDGE", "ROOFING", "k").body);
  assert.deepEqual(request.locationRestriction, { rectangle: MARKET_RECTANGLE });
  for (const [name, lat, lng] of [["Woodstock", 43.13, -80.757], ["Stratford", 43.37, -80.982], ["Brantford", 43.139, -80.264], ["Guelph", 43.546, -80.248], ["Elmira", 43.599, -80.557], ["Cambridge", 43.36, -80.312]] as const) {
    assert.ok(lat > MARKET_RECTANGLE.low.latitude && lat < MARKET_RECTANGLE.high.latitude && lng > MARKET_RECTANGLE.low.longitude && lng < MARKET_RECTANGLE.high.longitude, `${name} is inside the market area`);
  }
  for (const [name, lng] of [["Toronto", -79.38], ["Mississauga", -79.64], ["Hamilton", -79.87], ["London", -81.25]] as const) {
    assert.ok(lng > MARKET_RECTANGLE.high.longitude || lng < MARKET_RECTANGLE.low.longitude, `${name} is outside the market area`);
  }

  const { raw, db } = database(false);
  const { fetcher } = google([{ places: [
    { id: "uk", displayName: { text: "Browns Roofing" }, nationalPhoneNumber: "01223 852140", formattedAddress: "7 Cobble Yard, Napier St, Cambridge CB1 1HP, UK", businessStatus: "OPERATIONAL" },
    { id: "us", displayName: { text: "Tiger Roofing" }, websiteUri: "https://tiger.example/", formattedAddress: "100 Lake St, Cambridge, MD 21613, USA", businessStatus: "OPERATIONAL" },
    { id: "on", displayName: { text: "Galt Roofing" }, nationalPhoneNumber: "(519) 555-0171", formattedAddress: "5 Main St, Cambridge, ON N1R 1V4, Canada", businessStatus: "OPERATIONAL" },
    { id: "wix", displayName: { text: "Preston Eaves" }, websiteUri: "https://prestoneaves.wixsite.com/home?lang=en", formattedAddress: "9 King St E, Cambridge, ON N3H 3M3, Canada", businessStatus: "OPERATIONAL" },
  ] }]);
  const result = await runDiscovery(db, { apiKey: "k", trigger: "OWNER", actor: "RILEY", maxRequests: 1, fetcher, now: new Date("2026-09-28T18:00:00Z") });
  assert.deepEqual({ found: result.found, added: result.added, held: result.held }, { found: 2, added: 1, held: 1 });
  assert.deepEqual(raw.prepare(`SELECT "prospectId" FROM "EngineProspect"`).pluck().all(), ["place:on"]);
  assert.equal(raw.prepare(`SELECT "websiteUrl" FROM "DiscoveryHeld" WHERE "placeId" = 'wix'`).pluck().get(), "https://prestoneaves.wixsite.com/home", "a free Wix site keeps its page path");
  assert.equal(inOntario("5 Main St, Cambridge, ON N1R 1V4, Canada"), true);
  assert.equal(inOntario("5 Main St, Cambridge, ON N1R 1V4"), true);
  assert.equal(inOntario("100 Lake St, Cambridge, MD 21613, USA"), false);
});
