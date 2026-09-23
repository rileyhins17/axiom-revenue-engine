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

test("provable call, quote, phone-layout and staleness problems are STRONG", () => {
  const cases: Partial<EngineSiteSignals>[] = [
    { phoneLayoutWidth: 980, phoneScrollWidth: 980 },
    { phoneScrollWidth: 800 },
    { generator: "WordPress 4.8.32" },
    { copyrightYear: 2012 },
    { phoneTapToCall: false, quoteAction: false },
    { phoneTapToCall: false, wordCount: 120 },
    { quoteAction: false, wordCount: 180 },
  ];
  for (const overrides of cases) assert.equal(classifyEngineLead("https://synthetic-roofing.example/", signals(overrides), 2026).label, "STRONG", JSON.stringify(overrides));
  assert.equal(classifyEngineLead("https://synthetic-roofing.example/", signals({ copyrightYear: 2021 }), 2026).label, "WEAK");
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
  const decision = classifyEngineLead("https://synthetic-roofing.example/", signals({ phoneLayoutWidth: 980, phoneScrollWidth: 980, phoneTapToCall: false, quoteAction: false, copyrightYear: 2010 }), 2026);
  assert.deepEqual(decision.codes, ["NO_PHONE_LAYOUT", "STALE_FOOTER", "NO_CALL_OR_QUOTE"]);
  const notes = callNotes(decision.codes);
  assert.equal(notes.length, 2);
  assert.ok(notes.every((note) => !/\$|guarantee|increase|more customers/i.test(note)));
  assert.deepEqual(callNotes(["WORKS"]), []);
});
