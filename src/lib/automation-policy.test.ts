import assert from "node:assert/strict";
import { test } from "node:test";

import { isHardDisqualified } from "@/lib/automation-policy";

test("hard disqualification blocks chains and non-customer entities from autonomous outreach", () => {
  for (const businessName of [
    "Courtyard by Marriott Halifax Downtown",
    "Mr. Rooter Plumbing of Dallas",
    "Kent Building Supplies",
    "Superior Propane",
    "Help International Shelterbelt Center",
  ]) {
    assert.equal(isHardDisqualified({ businessName }).disqualified, true, businessName);
  }
});

test("hard disqualification keeps ordinary local operators eligible", () => {
  assert.equal(isHardDisqualified({ businessName: "Evolve Electrical Services" }).disqualified, false);
});
