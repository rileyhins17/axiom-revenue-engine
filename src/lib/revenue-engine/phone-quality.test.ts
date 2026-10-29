import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { displayPhone, isTollFree, phoneDigits, samePhone, telHref } from "../prospect-format";
import { runDiscovery } from "./cloud-discovery";
import { runSiteChecks } from "./cloud-site-check";
import type { EngineSiteCapture, EngineSiteSignals } from "./engine-site-capture";
import { listProspects, nextInQueue, type ProspectDb } from "./engine-prospects-d1";
import { PLACES_FIELD_MASK } from "./places-discovery";
import { applyEngineSchema } from "./test-support/engine-schema";

function database() {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  applyEngineSchema(raw);
  const db: ProspectDb = { prepare(sql) { const s = raw.prepare(sql); return { bind: (...v: unknown[]) => ({
    all: async <T,>() => ({ results: s.all(...v) as T[] }), first: async <T,>() => (s.get(...v) as T | undefined) ?? null, run: async () => s.run(...v),
  }) }; } };
  return { raw, db };
}
const COLS = `("prospectId","placeId","name","city","niche","websiteUrl","phone","address","label","reasons","runId","firstSeenAt","lastSeenAt","googleRatingCount","googleRating")`;

test("phone helpers: one format for display, a dialable link, toll-free and same-line checks", () => {
  assert.equal(displayPhone("+15195550122"), "(519) 555-0122", "E.164 from Caller or Google is formatted");
  assert.equal(displayPhone("519-555-0122"), "(519) 555-0122");
  assert.equal(displayPhone("1 (519) 555 0122"), "(519) 555-0122");
  assert.equal(displayPhone("555-0122 ext 4"), "555-0122 ext 4", "anything else is shown as stored");
  assert.equal(phoneDigits("(519) 555-0122"), "5195550122");
  assert.equal(telHref("(519) 555-0122"), "tel:+15195550122");
  assert.equal(telHref("+44 1223 852140"), "tel:+441223852140");
  assert.equal(isTollFree("(833) 519-4822"), true);
  assert.equal(isTollFree("1-800-555-0100"), true);
  assert.equal(isTollFree("(519) 824-7382"), false);
  assert.equal(samePhone("(519) 555-0122", "+1 519 555 0122"), true);
  assert.equal(samePhone("(519) 555-0122", "(519) 555-0123"), false);
  assert.equal(samePhone(null, "(519) 555-0122"), false);
});

test("0085 is additive: businesses and held sites keep every value and gain empty phone-quality fields", () => {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  applyEngineSchema(raw, "0084_site_check.sql");
  raw.prepare(`INSERT INTO "EngineProspect" ("prospectId","placeId","name","city","niche","websiteUrl","phone","address","label","reasons","runId","firstSeenAt","lastSeenAt") VALUES ('a.example','p','Acme','GUELPH','PLUMBING',NULL,'(519) 555-0100',NULL,'NO_WEBSITE','[]','r','2026-09-28','2026-09-28')`).run();
  raw.exec(readFileSync("migrations/0085_phone_quality.sql", "utf8"));
  assert.deepEqual(raw.prepare(`SELECT "name","phone","altPhone","googleRatingCount","googleRating" FROM "EngineProspect"`).get(), { name: "Acme", phone: "(519) 555-0100", altPhone: null, googleRatingCount: null, googleRating: null });
  assert.throws(() => raw.prepare(`UPDATE "EngineProspect" SET "googleRating" = 7`).run(), /CHECK constraint failed/);
  assert.throws(() => raw.prepare(`UPDATE "EngineProspect" SET "googleRatingCount" = -1`).run(), /CHECK constraint failed/);
  assert.deepEqual(raw.pragma("foreign_key_check"), []);
});

test("discovery asks Google for reviews in the same request and stores them", async () => {
  assert.match(PLACES_FIELD_MASK, /places\.rating/);
  assert.match(PLACES_FIELD_MASK, /places\.userRatingCount/);
  const { raw, db } = database();
  const fetcher = async () => ({ status: 200, json: async () => ({ places: [
    { id: "r1", displayName: { text: "Reviewed Roofing" }, nationalPhoneNumber: "(519) 555-0101", formattedAddress: "1 King St, Guelph, ON N1H 1A1, Canada", businessStatus: "OPERATIONAL", rating: 4.67, userRatingCount: 23 },
    { id: "g1", displayName: { text: "Ghost Roofing" }, nationalPhoneNumber: "(519) 555-0102", formattedAddress: "2 King St, Guelph, ON N1H 1A1, Canada", businessStatus: "OPERATIONAL" },
    { id: "h1", displayName: { text: "Held Roofing" }, websiteUri: "https://held.example/", formattedAddress: "3 King St, Guelph, ON N1H 1A1, Canada", businessStatus: "OPERATIONAL", rating: 3.9, userRatingCount: 4 },
  ] }) });
  await runDiscovery(db, { apiKey: "k", trigger: "OWNER", actor: "RILEY", maxRequests: 1, fetcher, now: new Date("2026-09-28T18:00:00Z") });
  assert.deepEqual(raw.prepare(`SELECT "prospectId","googleRatingCount","googleRating" FROM "EngineProspect" ORDER BY "prospectId"`).all(), [
    { prospectId: "place:g1", googleRatingCount: null, googleRating: null },
    { prospectId: "place:r1", googleRatingCount: 23, googleRating: 4.7 },
  ]);
  assert.deepEqual(raw.prepare(`SELECT "googleRatingCount","googleRating" FROM "DiscoveryHeld" WHERE "placeId"='h1'`).get(), { googleRatingCount: 4, googleRating: 3.9 });
});

const SIGNALS: EngineSiteSignals = {
  finalUrl: "https://site.example/", statusCode: 200, copyrightYear: 2026, generator: null, hasStreetAddress: true, phoneLayoutWidth: 390, phoneViewportMeta: true,
  phoneScrollWidth: 390, phoneTapToCall: true, desktopTapToCall: true, quoteAction: true, wordCount: 900,
};
const captured = (signals: Partial<EngineSiteSignals>): EngineSiteCapture => ({ status: "CAPTURED", signals: { ...SIGNALS, ...signals }, audit: {} as EngineSiteCapture["audit"] });

test("the website check uses the business's own number when Google's differs, and keeps Google's as the other number", async () => {
  const { raw, db } = database();
  const hold = raw.prepare(`INSERT INTO "DiscoveryHeld" ("placeId","name","city","niche","websiteUrl","phone","address","firstSeenAt","googleRatingCount","googleRating") VALUES (?,?,?,?,?,?,?,?,?,?)`);
  hold.run("d1", "Differs Plumbing", "GUELPH", "PLUMBING", "https://differs.example/", "(519) 555-0100", "1 King St, Guelph, ON N1H 1A1", "2026-09-28T11:00:00Z", 12, 4.5);
  hold.run("s1", "Same Plumbing", "GUELPH", "PLUMBING", "https://same.example/", "(519) 555-0200", "2 King St, Guelph, ON N1H 1A1", "2026-09-28T11:00:01Z", null, null);
  hold.run("n1", "Site Only Plumbing", "GUELPH", "PLUMBING", "https://siteonly.example/", null, "3 King St, Guelph, ON N1H 1A1", "2026-09-28T11:00:02Z", 0, null);
  const byUrl: Record<string, EngineSiteCapture> = {
    "https://differs.example/": captured({ finalUrl: "https://differs.example/", phone: "519-555-0199" }),
    "https://same.example/": captured({ finalUrl: "https://same.example/", phone: "519-555-0200" }),
    "https://siteonly.example/": captured({ finalUrl: "https://siteonly.example/", phone: "519-555-0300" }),
  };
  await runSiteChecks(db, { now: new Date("2026-09-28T15:00:00Z"), openCapture: async () => ({ capture: async (business) => byUrl[business.websiteUrl]!, close: async () => undefined }) });
  assert.deepEqual(raw.prepare(`SELECT "prospectId","phone","altPhone","googleRatingCount","googleRating" FROM "EngineProspect" ORDER BY "prospectId"`).all(), [
    { prospectId: "differs.example", phone: "519-555-0199", altPhone: "(519) 555-0100", googleRatingCount: 12, googleRating: 4.5 },
    { prospectId: "same.example", phone: "(519) 555-0200", altPhone: null, googleRatingCount: null, googleRating: null },
    { prospectId: "siteonly.example", phone: "519-555-0300", altPhone: null, googleRatingCount: 0, googleRating: null },
  ]);
});

test("the queue calls established businesses first and toll-free numbers last; due retries still lead", async () => {
  const { raw, db } = database();
  const insert = raw.prepare(`INSERT INTO "EngineProspect" ${COLS} VALUES (?,?,?,'GUELPH','ROOFING',NULL,?,NULL,?,'[]','r','2026-09-28','2026-09-28',?,?)`);
  insert.run("place:ghost", "p1", "Ghost Roofing", "(519) 555-0101", "NO_WEBSITE", 0, null);
  insert.run("place:unrated", "p2", "Unrated Roofing", "(519) 555-0102", "NO_WEBSITE", null, null);
  insert.run("place:busy", "p3", "Busy Roofing", "(519) 555-0103", "NO_WEBSITE", 40, 4.8);
  insert.run("place:some", "p4", "Some Roofing", "(519) 555-0104", "NO_WEBSITE", 3, 4.1);
  insert.run("place:tollfree", "p5", "Call Centre Roofing", "(833) 555-0105", "NO_WEBSITE", 90, 4.9);
  insert.run("weak.example", "p6", "Weak Site Roofing", "(519) 555-0106", "STRONG", 1, 5);
  insert.run("place:retry", "p7", "Retry Roofing", "(519) 555-0107", "NO_WEBSITE", 0, null);
  raw.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","actor","actorUserId","createdAt") VALUES ('a','a','place:retry','CALL','NO_ANSWER','','AIDAN','u','2026-09-25T15:00:00.000Z')`).run();
  const queue = await nextInQueue(db, "2026-09-28", "2026-09-28T04:00:00.000Z", [], 10);
  assert.deepEqual(queue.rows.map((row) => row.prospectId), ["place:retry", "weak.example", "place:busy", "place:some", "place:unrated", "place:ghost", "place:tollfree"]);
  const busy = queue.rows.find((row) => row.prospectId === "place:busy")!;
  assert.deepEqual({ count: busy.googleRatingCount, stars: busy.googleRating, alt: busy.altPhone }, { count: 40, stars: 4.8, alt: null });
  const list = await listProspects(db, "call", "2026-09-28", 20);
  assert.deepEqual(list.map((row) => row.prospectId), ["weak.example", "place:busy", "place:some", "place:unrated", "place:ghost", "place:tollfree"], "the To call list uses the same order");
});
