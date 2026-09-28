import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { runSiteChecks, SITE_CHECK_VERSION, type SiteCapture } from "./cloud-site-check";
import type { EngineSiteCapture, EngineSiteSignals } from "./engine-site-capture";
import type { ProspectDb } from "./engine-prospects-d1";
import { applyEngineSchema } from "./test-support/engine-schema";

function database() {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  applyEngineSchema(raw);
  const db: ProspectDb = { prepare(sql) { const s = raw.prepare(sql); return { bind: (...v: unknown[]) => ({
    all: async <T,>() => ({ results: s.all(...v) as T[] }), first: async <T,>() => (s.get(...v) as T | undefined) ?? null, run: async () => s.run(...v),
  }) }; } };
  const hold = raw.prepare(`INSERT INTO "DiscoveryHeld" ("placeId","name","city","niche","websiteUrl","phone","address","firstSeenAt") VALUES (?,?,?,?,?,?,?,?)`);
  return { raw, db, hold };
}

const WORKS: EngineSiteSignals = {
  finalUrl: "https://works.example/", siteTitle: "Works Plumbing", statusCode: 200, copyrightYear: 2026, generator: null, hasStreetAddress: true,
  phoneLayoutWidth: 390, phoneViewportMeta: true, phoneScrollWidth: 390, phoneTapToCall: true, desktopTapToCall: true, quoteAction: true, wordCount: 900,
  email: "hello@works.example", emailMethod: "MAILTO_LINK",
};
const captured = (signals: Partial<EngineSiteSignals>): EngineSiteCapture => ({ status: "CAPTURED", signals: { ...WORKS, ...signals }, audit: {} as EngineSiteCapture["audit"] });
const NOW = new Date("2026-09-28T15:00:00Z");

function fakeCapture(byUrl: Record<string, EngineSiteCapture | Error>) {
  const seen: string[] = [];
  let opened = 0, closed = 0;
  const capture: SiteCapture = async (business) => {
    seen.push(business.websiteUrl);
    const outcome = byUrl[business.websiteUrl];
    if (!outcome) throw new Error("no fixture for " + business.websiteUrl);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { seen, counts: () => ({ opened, closed }), openCapture: async () => { opened += 1; return { capture, close: async () => { closed += 1; } }; } };
}

test("weak websites join the call list with their reasons, working ones are kept but not called, lead-gen sites are set aside", async () => {
  const { raw, db, hold } = database();
  hold.run("p1", "Guelph Leak Pros", "GUELPH", "PLUMBING", "https://www.leakpros.example/", "(519) 555-0141", "12 Wyndham St N, Guelph, ON", "2026-09-28T11:00:00Z");
  hold.run("p2", "Works Plumbing", "WATERLOO", "PLUMBING", "https://works.example/", null, null, "2026-09-28T11:00:01Z");
  hold.run("p3", "Guelph Plumbing Pros", "GUELPH", "PLUMBING", "https://guelphplumbingpros.example/", "(519) 555-0143", null, "2026-09-28T11:00:02Z");
  const fake = fakeCapture({
    "https://www.leakpros.example/": captured({ finalUrl: "http://www.leakpros.example/home", phoneLayoutWidth: 980, phoneViewportMeta: false, phoneTapToCall: false, email: "Owner@LeakPros.example", emailMethod: "PAGE_TEXT" }),
    "https://works.example/": captured({ phone: "519-555-0142", streetAddress: "5 King St, Waterloo" }),
    "https://guelphplumbingpros.example/": captured({ finalUrl: "https://guelphplumbingpros.example/", hasStreetAddress: false }),
  });
  const result = await runSiteChecks(db, { openCapture: fake.openCapture, now: NOW });
  assert.deepEqual({ checked: result.checked, strong: result.strong, weak: result.weak, wrong: result.wrong, failed: result.failed }, { checked: 3, strong: 1, weak: 1, wrong: 1, failed: 0 });
  assert.deepEqual(fake.counts(), { opened: 1, closed: 1 });

  const strong = raw.prepare(`SELECT * FROM "EngineProspect" WHERE "prospectId" = 'leakpros.example'`).get() as Record<string, string>;
  assert.equal(strong.label, "STRONG");
  assert.equal(strong.name, "Guelph Leak Pros", "Google's name is kept");
  assert.equal(strong.city, "GUELPH");
  assert.equal(strong.niche, "PLUMBING");
  assert.equal(strong.phone, "(519) 555-0141", "Google's phone is preferred");
  assert.equal(strong.websiteUrl, "http://www.leakpros.example/");
  assert.match(strong.reasons, /No phone layout/);
  assert.match(strong.reasons, /Not secure/);
  assert.deepEqual(raw.prepare(`SELECT "email","method","sourceUrl" FROM "EngineProspectEmail" WHERE "prospectId" = 'leakpros.example'`).get(),
    { email: "owner@leakpros.example", method: "PAGE_TEXT", sourceUrl: "http://www.leakpros.example/home" }, "the published email keeps its source and method");

  const weak = raw.prepare(`SELECT "label","phone","address" FROM "EngineProspect" WHERE "prospectId" = 'works.example'`).get();
  assert.deepEqual(weak, { label: "WEAK", phone: "519-555-0142", address: "5 King St, Waterloo" }, "the site's own phone and address fill Google's gaps");
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM "EngineProspect" WHERE "prospectId" = 'guelphplumbingpros.example'`).pluck().get(), 0, "WRONG is not added");

  const held = raw.prepare(`SELECT "placeId","status","label","attempts","checkVersion","prospectId" FROM "DiscoveryHeld" ORDER BY "placeId"`).all();
  assert.deepEqual(held, [
    { placeId: "p1", status: "CHECKED", label: "STRONG", attempts: 1, checkVersion: SITE_CHECK_VERSION, prospectId: "leakpros.example" },
    { placeId: "p2", status: "CHECKED", label: "WEAK", attempts: 1, checkVersion: SITE_CHECK_VERSION, prospectId: "works.example" },
    { placeId: "p3", status: "CHECKED", label: "WRONG", attempts: 1, checkVersion: SITE_CHECK_VERSION, prospectId: null },
  ]);
  const run = raw.prepare(`SELECT "checked","strong","weak","wrong","failed","stopReason","finishedAt" IS NOT NULL AS done FROM "SiteCheckRun"`).get();
  assert.deepEqual(run, { checked: 3, strong: 1, weak: 1, wrong: 1, failed: 0, stopReason: null, done: 1 });

  // A second run has nothing left to do and never starts a browser.
  const again = await runSiteChecks(db, { openCapture: fake.openCapture, now: NOW });
  assert.equal(again.checked, 0);
  assert.deepEqual(fake.counts(), { opened: 1, closed: 1 });
});

test("a site that will not load is retried on later runs, then marked failed; nothing is added", async () => {
  const { raw, db, hold } = database();
  hold.run("p1", "Down Roofing", "AYR", "ROOFING", "https://down.example/", "(519) 555-0151", null, "2026-09-28T11:00:00Z");
  const fake = fakeCapture({ "https://down.example/": new Error("net::ERR_NAME_NOT_RESOLVED at https://down.example/\n  stack") });
  for (let run = 1; run <= 3; run += 1) {
    const result = await runSiteChecks(db, { openCapture: fake.openCapture, now: NOW });
    assert.equal(result.failed, 1);
    assert.equal(result.gaveUp, run === 3 ? 1 : 0);
  }
  assert.deepEqual(raw.prepare(`SELECT "status","attempts","lastError" FROM "DiscoveryHeld"`).get(), { status: "FAILED", attempts: 3, lastError: "net::ERR_NAME_NOT_RESOLVED at https://down.example/" });
  assert.equal(raw.prepare(`SELECT COUNT(*) FROM "EngineProspect"`).pluck().get(), 0);
  const fourth = await runSiteChecks(db, { openCapture: fake.openCapture, now: NOW });
  assert.equal(fourth.failed, 0, "a failed site is not retried forever");
});

test("runs are capped per run and per day, and a business already on the list is not checked again", async () => {
  const { raw, db, hold } = database();
  raw.prepare(`INSERT INTO "EngineProspect" VALUES ('known.example','pk','Known Roofing','KITCHENER','ROOFING','https://known.example/',NULL,NULL,'WEAK','[]','run1','2026-09-20','2026-09-20')`).run();
  hold.run("pk", "Known Roofing", "KITCHENER", "ROOFING", "https://known.example/", null, null, "2026-09-28T10:00:00Z");
  const urls: Record<string, EngineSiteCapture> = {};
  for (let index = 0; index < 5; index += 1) {
    hold.run(`p${index}`, `Business ${index}`, "BRANTFORD", "ELECTRICAL", `https://b${index}.example/`, null, null, `2026-09-28T11:00:0${index}Z`);
    urls[`https://b${index}.example/`] = captured({ finalUrl: `https://b${index}.example/` });
  }
  const fake = fakeCapture(urls);
  const first = await runSiteChecks(db, { openCapture: fake.openCapture, now: NOW, perRun: 2, perDay: 3 });
  assert.equal(first.checked, 1, "the known business uses a slot but no browser time");
  assert.deepEqual(raw.prepare(`SELECT "status","lastError","prospectId" FROM "DiscoveryHeld" WHERE "placeId" = 'pk'`).get(), { status: "CHECKED", lastError: "Already on the list.", prospectId: "known.example" });
  const second = await runSiteChecks(db, { openCapture: fake.openCapture, now: NOW, perRun: 2, perDay: 3 });
  assert.equal(second.checked, 2);
  const third = await runSiteChecks(db, { openCapture: fake.openCapture, now: NOW, perRun: 2, perDay: 3 });
  assert.equal(third.checked, 0);
  assert.match(third.stopReason!, /done; more tomorrow/);
  assert.equal(fake.seen.length, 3, "only three sites were opened today");
  const tomorrow = await runSiteChecks(db, { openCapture: fake.openCapture, now: new Date("2026-09-29T15:00:00Z"), perRun: 2, perDay: 3 });
  assert.equal(tomorrow.checked, 2);
});

test("0084 is additive: waiting businesses keep their details and gain an empty check record", () => {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  applyEngineSchema(raw, "0083_wider_market.sql");
  raw.prepare(`INSERT INTO "DiscoveryHeld" ("placeId","name","city","niche","websiteUrl","phone","address","firstSeenAt") VALUES ('p1','Held','GUELPH','HVAC','https://held.example/',NULL,NULL,'2026-09-27')`).run();
  raw.exec(readFileSync("migrations/0084_site_check.sql", "utf8"));
  assert.deepEqual(raw.prepare(`SELECT "placeId","name","status","attempts","label","checkedAt" FROM "DiscoveryHeld"`).get(), { placeId: "p1", name: "Held", status: "WAITING", attempts: 0, label: null, checkedAt: null });
  assert.throws(() => raw.prepare(`UPDATE "DiscoveryHeld" SET "label" = 'MAYBE'`).run(), /CHECK constraint failed/);
  raw.prepare(`INSERT INTO "SiteCheckRun" ("runId","startedAt") VALUES ('r1','2026-09-28')`).run();
  assert.throws(() => raw.prepare(`DELETE FROM "SiteCheckRun"`).run(), /SITE_CHECK_RUN_NO_DELETE/);
});
