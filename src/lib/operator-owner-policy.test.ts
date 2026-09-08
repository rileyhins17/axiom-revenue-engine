import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { setCloudflareBindings } from "./cloudflare";
import { parseOperatorOwnerPolicy, readOperatorOwnerPolicy } from "./operator-owner-policy";

afterEach(() => setCloudflareBindings(null));

test("owner configuration uses exact normalized addresses and an admin subset", () => {
  assert.deepEqual(parseOperatorOwnerPolicy(" Riley@Example.invalid ,aidan@example.invalid", "RILEY@example.invalid"), {
    allowedEmails: ["riley@example.invalid", "aidan@example.invalid"], adminEmails: ["riley@example.invalid"],
  });
  for (const value of [undefined, null, [], {}, "", "*", "*@example.invalid", "riley@example.invalid,",
    "riley@example.invalid,riley@example.invalid", "Riley <riley@example.invalid>", "not-email", "' OR 1=1 --"]) {
    assert.throws(() => parseOperatorOwnerPolicy(value, "riley@example.invalid"), { status: "SERVICE_UNAVAILABLE" });
    assert.throws(() => parseOperatorOwnerPolicy("riley@example.invalid", value), { status: "SERVICE_UNAVAILABLE" });
  }
  assert.throws(() => parseOperatorOwnerPolicy("riley@example.invalid", "outsider@example.invalid"),
    { status: "SERVICE_UNAVAILABLE" });
});

test("fresh bindings replace prior policy without an env or auth cache reset", () => {
  setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "riley@example.invalid", AUTH_ADMIN_EMAILS: "riley@example.invalid" });
  assert.deepEqual(readOperatorOwnerPolicy().allowedEmails, ["riley@example.invalid"]);
  setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "aidan@example.invalid", AUTH_ADMIN_EMAILS: "aidan@example.invalid" });
  assert.deepEqual(readOperatorOwnerPolicy().allowedEmails, ["aidan@example.invalid"]);
  // A missing binding cannot fall back to any process/build-time setting.
  setCloudflareBindings({});
  assert.throws(readOperatorOwnerPolicy, { status: "SERVICE_UNAVAILABLE" });
});
