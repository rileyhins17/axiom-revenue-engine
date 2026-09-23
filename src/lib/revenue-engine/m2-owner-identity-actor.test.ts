import assert from "node:assert/strict";
import test from "node:test";

import { getM2OwnerIdentityActor } from "./m2-owner-identity-actor";

test("M2 identity review binds the actor to a named owner account", () => {
  assert.equal(getM2OwnerIdentityActor("Riley@getaxiom.ca"), "RILEY");
  assert.equal(getM2OwnerIdentityActor(" aidan@getaxiom.ca "), "AIDAN");
  assert.equal(getM2OwnerIdentityActor("owner-acceptance@getaxiom.ca"), null);
  assert.equal(getM2OwnerIdentityActor("riley@other.example"), null);
  assert.equal(getM2OwnerIdentityActor(null), null);
});
