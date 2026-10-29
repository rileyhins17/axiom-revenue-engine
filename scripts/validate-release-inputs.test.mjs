import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseInputs } from "./validate-release-inputs.mjs";

const sha = "a".repeat(40);
const checksum = "b".repeat(64);

test("accepts an exact commit and structured D1 checksum reference", () => {
  assert.deepEqual(validateReleaseInputs(sha, `d1:axiom-revenue-engine:sha256:${checksum}`), {
    valid: true,
    errors: [],
  });
});

test("rejects branch names, abbreviated commits, and command-shaped input", () => {
  for (const release of ["main", "abc1234", `${sha}\nmalicious`]) {
    assert.equal(validateReleaseInputs(release, `d1:axiom-revenue-engine:sha256:${checksum}`).valid, false);
  }
});

test("rejects missing or malformed backup evidence", () => {
  for (const backup of ["", "backups/latest.sql", `d1:db:sha256:${"G".repeat(64)}`, `d1:db;echo-bad:sha256:${checksum}`]) {
    assert.equal(validateReleaseInputs(sha, backup).valid, false);
  }
});
