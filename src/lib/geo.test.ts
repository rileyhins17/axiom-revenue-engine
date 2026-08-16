import assert from "node:assert/strict";
import test from "node:test";

import {
  browserLocaleForCountry,
  buildMapsSearchQuery,
  countryLabel,
} from "@/lib/geo";

test("buildMapsSearchQuery preserves Canadian province and country", () => {
  assert.equal(
    buildMapsSearchQuery({ niche: "roofing", city: "Vancouver", region: "BC", country: "CA" }),
    "roofing in Vancouver, BC, Canada",
  );
});

test("buildMapsSearchQuery no longer searches US targets in Ontario", () => {
  assert.equal(
    buildMapsSearchQuery({ niche: "plumbing", city: "Seattle", region: "WA", country: "US" }),
    "plumbing in Seattle, WA, United States",
  );
});

test("country and browser locale helpers have safe defaults", () => {
  assert.equal(countryLabel(undefined), "Canada");
  assert.equal(browserLocaleForCountry("US"), "en-US");
  assert.equal(browserLocaleForCountry("CA"), "en-CA");
});
