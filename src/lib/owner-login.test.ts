import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { maskInbox, OWNER_LOGINS, ownerForAccount } from "./owner-login";
import { OWNER_CHOICES } from "./owner-login-public";

test("codes only go to the two owner inboxes, and the public page never ships them", () => {
  assert.equal(ownerForAccount(" Riley@GetAxiom.ca ")?.inbox, "rileyhinsperger@gmail.com");
  assert.equal(ownerForAccount("aidan@getaxiom.ca")?.inbox, "aidanmageebusiness@gmail.com");
  assert.equal(ownerForAccount("attacker@example.com"), null);
  for (const key of ["riley", "aidan"] as const) {
    assert.equal(OWNER_CHOICES[key].account, OWNER_LOGINS[key].account);
    assert.equal(OWNER_CHOICES[key].maskedInbox, maskInbox(OWNER_LOGINS[key].inbox));
  }
  const page = readFileSync("src/app/sign-in/page.tsx", "utf8");
  assert.doesNotMatch(page, /@gmail\.com|owner-login"/);
  const wrangler = readFileSync("wrangler.production.jsonc", "utf8");
  assert.match(wrangler, /"allowed_destination_addresses"\s*:\s*\[\s*"rileyhinsperger@gmail\.com",\s*"aidanmageebusiness@gmail\.com"\s*\]/);
});
