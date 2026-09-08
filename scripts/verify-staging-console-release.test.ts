import assert from "node:assert/strict";
import test from "node:test";

import { resolve } from "node:path";

import { resolveStagingReleasePacketPath } from "./verify-staging-console-release";

test("staging release verification accepts only staging-directory JSON packet paths", () => {
  const accepted = resolveStagingReleasePacketPath("docs/releases/staging/candidate.json");
  assert.equal(accepted, resolve("docs/releases/staging/candidate.json"));
  assert.throws(() => resolveStagingReleasePacketPath("docs/releases/candidate.json"), /docs\/releases\/staging/i);
  assert.throws(() => resolveStagingReleasePacketPath("docs/releases/staging/candidate.md"), /JSON/i);
  assert.throws(() => resolveStagingReleasePacketPath("../candidate.json"), /docs\/releases\/staging/i);
});
