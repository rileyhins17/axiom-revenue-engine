import assert from "node:assert/strict";
import test from "node:test";

import {
  cssTimeToMilliseconds,
  isAllowedOwnerAcceptanceUrl,
} from "./verify-owner-ui-acceptance";

test("owner UI browser networking is restricted to the exact loopback origin", () => {
  const baseUrl = "http://127.0.0.1:8787";
  assert.equal(isAllowedOwnerAcceptanceUrl(`${baseUrl}/leads`, baseUrl), true);
  assert.equal(isAllowedOwnerAcceptanceUrl("data:text/plain,fixture", baseUrl), true);
  assert.equal(isAllowedOwnerAcceptanceUrl("http://127.0.0.1:8788/leads", baseUrl), false);
  assert.equal(isAllowedOwnerAcceptanceUrl("https://directory.axiomfixtures.ca/business/one", baseUrl), false);
  assert.equal(isAllowedOwnerAcceptanceUrl("https://api.openai.com/v1/responses", baseUrl), false);
});

test("reduced-motion duration parsing handles seconds and milliseconds", () => {
  assert.equal(cssTimeToMilliseconds("0.01ms"), 0.01);
  assert.equal(cssTimeToMilliseconds("0.2s"), 200);
  assert.equal(Number.isNaN(cssTimeToMilliseconds("initial")), true);
});
