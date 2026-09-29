import assert from "node:assert/strict";
import test from "node:test";

import { isCoverageRunDue, isCoverageSaturated, isWebsiteAuditDue } from "@/lib/revenue-engine/coverage-policy";

test("discovery and website audits honor independent cooldowns", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  assert.equal(isCoverageRunDue(new Date("2026-06-01T12:00:00.000Z"), now), false);
  assert.equal(isCoverageRunDue(new Date("2026-05-01T12:00:00.000Z"), now), true);
  assert.equal(isWebsiteAuditDue(new Date("2026-07-01T12:00:00.000Z"), now), false);
  assert.equal(isWebsiteAuditDue(new Date("2026-07-01T12:00:00.000Z"), now, true), true);
});

test("coverage saturates only after repeated duplicate-heavy low-yield runs", () => {
  assert.equal(isCoverageSaturated([{ discovered: 100, duplicates: 90, qualified: 2 }]), false);
  assert.equal(isCoverageSaturated([
    { discovered: 100, duplicates: 85, qualified: 2 },
    { discovered: 100, duplicates: 90, qualified: 3 },
    { discovered: 100, duplicates: 95, qualified: 1 },
  ]), true);
  assert.equal(isCoverageSaturated([
    { discovered: 100, duplicates: 85, qualified: 10 },
    { discovered: 100, duplicates: 85, qualified: 10 },
    { discovered: 100, duplicates: 85, qualified: 10 },
  ]), false);
});
