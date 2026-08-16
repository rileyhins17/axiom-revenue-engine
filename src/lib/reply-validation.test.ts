import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedReplyTarget } from "./reply-validation";

test("reply target must belong to the lead or the recorded Gmail thread", () => {
  assert.equal(isAllowedReplyTarget("owner@example.ca", "Owner@Example.ca", []), true);
  assert.equal(isAllowedReplyTarget("old-owner@example.ca", "new-owner@example.ca", ["old-owner@example.ca"]), true);
  assert.equal(isAllowedReplyTarget("attacker@example.net", "owner@example.ca", ["owner@example.ca"]), false);
  assert.equal(isAllowedReplyTarget("not-an-email", "owner@example.ca", []), false);
});
