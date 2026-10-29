import assert from "node:assert/strict";
import test from "node:test";

import {
  ownerLeadDetailPath,
  parseOwnerLeadBusinessIdRouteParam,
} from "@/lib/revenue-engine/owner-lead-identity";

test("owner lead paths preserve allowed identity delimiters without percent-encoding the segment", () => {
  assert.equal(ownerLeadDetailPath("business:roofing_1"), "/leads/business:roofing_1");
});

test("owner lead route parameters decode exactly once and reject unsafe segments", () => {
  assert.equal(parseOwnerLeadBusinessIdRouteParam("business:roofing"), "business:roofing");
  assert.equal(parseOwnerLeadBusinessIdRouteParam("business%3Aroofing"), "business:roofing");
  assert.equal(parseOwnerLeadBusinessIdRouteParam("business%253Aroofing"), null);
  assert.equal(parseOwnerLeadBusinessIdRouteParam("business%2Froofing"), null);
  assert.equal(parseOwnerLeadBusinessIdRouteParam("%not-encoding"), null);
});
