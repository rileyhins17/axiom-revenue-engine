import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTextSearchRequest, discoverBusinesses, PLACES_FIELD_MASK, PLACES_MAX_REQUESTS_PER_MONTH,
  PLACES_MAX_REQUESTS_PER_RUN, websiteOrigin, type PlacesTransport, type PlacesUsageLedger,
} from "./places-discovery";

const NOW = () => new Date("2026-09-23T12:00:00Z");

function fakeTransport(pages: unknown[]) {
  const sent: string[] = [];
  const transport: PlacesTransport = async (request) => {
    sent.push(request.body);
    return { status: 200, json: pages[Math.min(sent.length - 1, pages.length - 1)] };
  };
  return { transport, sent };
}

async function run(overrides: Partial<Parameters<typeof discoverBusinesses>[0]> = {}) {
  const saved: PlacesUsageLedger[] = [];
  const { transport, sent } = fakeTransport([{ places: [
    { id: "p1", displayName: { text: "Synthetic Roofing" }, websiteUri: "https://www.synthetic-roofing.example/about?x=1", formattedAddress: "1 Main St, Kitchener, ON", businessStatus: "OPERATIONAL" },
    { id: "p2", displayName: { text: "Closed Roofing" }, websiteUri: "https://closed.example/", businessStatus: "CLOSED_PERMANENTLY" },
    { id: "p3", displayName: { text: "Social Only" }, websiteUri: "https://www.facebook.com/socialonly" },
    { id: "p4", displayName: { text: "Duplicate" }, websiteUri: "https://synthetic-roofing.example/" },
  ] }]);
  const result = await discoverBusinesses({
    apiKey: "synthetic-key", enabled: true, cells: [{ city: "KITCHENER", niche: "ROOFING" }], transport,
    ledger: { month: "2026-09", requests: 0 }, saveLedger: async (ledger) => { saved.push(ledger); }, now: NOW, ...overrides,
  });
  return { result, saved, sent };
}

test("discovery is off without the explicit switch and a key", async () => {
  await assert.rejects(run({ enabled: false }), /off/);
  await assert.rejects(run({ apiKey: undefined }), /off/);
});

test("requests use the bounded field mask and a city-and-trade query", () => {
  const request = buildTextSearchRequest("CAMBRIDGE", "HVAC", "k");
  assert.equal(request.headers["X-Goog-FieldMask"], PLACES_FIELD_MASK);
  assert.match(JSON.parse(request.body).textQuery, /heating and air conditioning contractor in Cambridge, Ontario/);
});

test("results keep operating businesses, normalise to the website origin and de-duplicate", async () => {
  const { result, saved } = await run();
  assert.deepEqual(result.businesses.map((business) => [business.placeId, business.websiteUrl]), [["p1", "https://www.synthetic-roofing.example/"], ["p3", null]]);
  assert.equal(result.businesses[0]!.addressMentionsCity, true);
  assert.equal(result.requestsThisRun, 1);
  assert.deepEqual(saved.at(-1), { month: "2026-09", requests: 1 });
});

test("the monthly cap stops before any request is sent and a new month resets", async () => {
  const capped = await run({ ledger: { month: "2026-09", requests: PLACES_MAX_REQUESTS_PER_MONTH } });
  assert.equal(capped.sent.length, 0);
  assert.deepEqual(capped.result.stops, ["MONTH_CAP"]);
  const reset = await run({ ledger: { month: "2026-08", requests: PLACES_MAX_REQUESTS_PER_MONTH } });
  assert.equal(reset.sent.length, 1);
});

test("the per-run cap bounds paging across many cells", async () => {
  const cells = Array.from({ length: 20 }, () => ({ city: "WATERLOO" as const, niche: "LANDSCAPING" as const }));
  const { transport, sent } = fakeTransport([{ places: [], nextPageToken: "next" }]);
  const result = await discoverBusinesses({ apiKey: "k", enabled: true, cells, transport, ledger: { month: "2026-09", requests: 0 }, saveLedger: async () => undefined, now: NOW });
  assert.equal(sent.length, PLACES_MAX_REQUESTS_PER_RUN);
  assert.ok(result.stops.includes("RUN_CAP"));
});

test("social and directory links are not treated as the business website", () => {
  assert.equal(websiteOrigin("https://www.instagram.com/x"), null);
  assert.equal(websiteOrigin("ftp://example.com"), null);
  assert.equal(websiteOrigin("http://Example.COM/path"), "https://example.com/");
});
