import assert from "node:assert/strict";
import test from "node:test";

import { classifyEngineLead, evaluationSplit, wordpressMajor } from "./engine-lead-rules";
import { copyrightYear, hasStreetAddress, type EngineSiteSignals } from "./engine-site-capture";

function signals(overrides: Partial<EngineSiteSignals> = {}): EngineSiteSignals {
  return {
    finalUrl: "https://synthetic-roofing.example/", statusCode: 200, copyrightYear: 2026, generator: null,
    hasStreetAddress: true, phoneLayoutWidth: 390, phoneScrollWidth: 390, phoneTapToCall: true, desktopTapToCall: true,
    quoteAction: true, wordCount: 800, ...overrides,
  };
}

test("a working site is WEAK", () => {
  assert.equal(classifyEngineLead("https://synthetic-roofing.example/", signals(), 2026).label, "WEAK");
});

test("a site is only called weak with a visible serious problem plus supporting evidence", () => {
  const url = "https://synthetic-roofing.example/";
  const strong: [string, Partial<EngineSiteSignals>][] = [
    [url, { phoneViewportMeta: false, phoneLayoutWidth: 980, phoneScrollWidth: 980, copyrightYear: 2019 }],
    [url, { phoneViewportMeta: false, phoneLayoutWidth: 980, generator: "WordPress 4.8.32" }],
    [url, { phoneScrollWidth: 800, phoneTapToCall: false, wordCount: 120 }],
    [url, { generator: "WordPress 4.9", phoneTapToCall: false, wordCount: 100 }],
    ["http://synthetic-roofing.example/", { finalUrl: "http://synthetic-roofing.example/", phoneViewportMeta: false, phoneLayoutWidth: 980 }],
  ];
  for (const [site, overrides] of strong) assert.equal(classifyEngineLead(site, signals(overrides), 2026).label, "STRONG", JSON.stringify(overrides));
  // Screenshot-reviewed false positives from the v6 run: modern or responsive sites.
  const fine: Partial<EngineSiteSignals>[] = [
    { phoneViewportMeta: true, phoneLayoutWidth: 980, phoneScrollWidth: 980, phoneTapToCall: false, desktopTapToCall: false, quoteAction: false },
    { copyrightYear: 2015, phoneTapToCall: false, desktopTapToCall: false, quoteAction: false },
    { phoneViewportMeta: false, phoneLayoutWidth: 390, quoteAction: false, wordCount: 180 },
    { copyrightYear: 2019, quoteAction: false, wordCount: 180 },
    { phoneViewportMeta: false, phoneLayoutWidth: 980 },
  ];
  for (const overrides of fine) assert.equal(classifyEngineLead(url, signals(overrides), 2026).label, "WEAK", JSON.stringify(overrides));
});

test("a lapsed domain redirecting to a parked ad page is always a weak website", () => {
  const decision = classifyEngineLead("https://allpro.example/", signals({ finalUrl: "http://ww547.allpro.example/?tkn=19vnMT3S" }), 2026);
  assert.equal(decision.label, "STRONG");
  assert.deepEqual(decision.codes, ["PARKED_DOMAIN"]);
});

test("a homepage announcing it is under construction is a weak website", async () => {
  const { saysUnderConstruction } = await import("./engine-site-capture");
  assert.equal(saysUnderConstruction("PLEASE EXCUSE OUR WEBSITE - CURRENTLY UNDER A RECONSTRUCTION"), true);
  assert.equal(saysUnderConstruction("Please excuse our website, it is under reconstruction"), true);
  assert.equal(saysUnderConstruction("We specialise in new construction and renovations"), false);
  assert.equal(classifyEngineLead("https://synthetic-roofing.example/", signals({ underConstruction: true }), 2026).label, "STRONG");
});

test("a declared phone layout is never reported as missing", () => {
  const decision = classifyEngineLead("https://synthetic-roofing.example/", signals({ phoneViewportMeta: true, phoneLayoutWidth: 1200, phoneScrollWidth: 1200 }), 2026);
  assert.equal(decision.codes.includes("NO_PHONE_LAYOUT"), false);
  assert.equal(decision.codes.includes("SIDEWAYS_SCROLL"), false);
});

test("generic city-and-trade domains without an address and location pages are WRONG", () => {
  assert.equal(classifyEngineLead("https://waterlooroofers.example/", signals({ finalUrl: "https://waterlooroofers.example/", hasStreetAddress: false }), 2026).label, "WRONG");
  assert.equal(classifyEngineLead("https://waterlooroofers.example/", signals({ finalUrl: "https://waterlooroofers.example/" }), 2026).label, "WEAK");
  assert.equal(classifyEngineLead("https://brand.example/locations/waterloo/", signals({ finalUrl: "https://brand.example/locations/waterloo/" }), 2026).label, "WRONG");
});

test("signal helpers read years, addresses and WordPress versions", () => {
  assert.equal(copyrightYear("© 2004-2006 Example Roofing"), 2006);
  assert.equal(copyrightYear("No footer year"), null);
  assert.equal(hasStreetAddress("Visit 291 Mill St. Unit 1"), true);
  assert.equal(hasStreetAddress("Serving Waterloo, ON"), false);
  assert.equal(wordpressMajor("WordPress 6.7"), 6);
  assert.equal(wordpressMajor("Wix.com Website Builder"), null);
});

test("the evaluation split is fixed per review ID", () => {
  assert.equal(evaluationSplit("M3-01"), evaluationSplit("M3-01"));
  assert.ok(["TUNE", "HOLDOUT"].includes(evaluationSplit("M2-05")));
});

test("display names prefer the declared name, then the title part matching the address", async () => {
  const { businessDisplayName } = await import("./engine-site-capture");
  assert.equal(businessDisplayName("https://regionalair.ca/", "Furnace Repair Service | Regional Air Heating & Cooling"), "Regional Air Heating & Cooling");
  assert.equal(businessDisplayName("https://www.nlmgalt.com/", "Home | Unrelated words"), "nlmgalt.com");
  assert.equal(businessDisplayName("https://koebelsroofing.ca/", "www.koebelsroofing.ca", "Koebel's Roofing"), "Koebel's Roofing");
  assert.equal(businessDisplayName("https://www.duritelandscaping.com/", "DuRite Landscaping"), "DuRite Landscaping");
});

test("reason codes map to at most two factual call notes", async () => {
  const { callNotes } = await import("./engine-lead-rules");
  const decision = classifyEngineLead("https://synthetic-roofing.example/", signals({ phoneLayoutWidth: 980, phoneScrollWidth: 980, phoneTapToCall: false, desktopTapToCall: false, quoteAction: false, copyrightYear: 2010 }), 2026);
  assert.deepEqual(decision.codes, ["NO_PHONE_LAYOUT", "STALE_FOOTER", "NO_CALL_OR_QUOTE"]);
  const notes = callNotes(decision.codes);
  assert.equal(notes.length, 2);
  assert.ok(notes.every((note) => !/\$|guarantee|increase|more customers/i.test(note)));
  assert.deepEqual(callNotes(["WORKS"]), []);
});

test("phone and street address come from the business's own page", async () => {
  const { sitePhone, streetAddress } = await import("./engine-site-capture");
  assert.equal(sitePhone([null, "/contact", "tel:+1 (519) 555-0101"]), "519-555-0101");
  assert.equal(sitePhone(["tel:911"]), null);
  assert.equal(streetAddress("Visit us at 291 Mill St, Unit 1, Kitchener today"), "291 Mill St, Unit 1, Kitchener");
  assert.equal(streetAddress("Serving the region"), null);
});
