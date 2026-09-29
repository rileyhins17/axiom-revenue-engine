import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { latestProspectDecisions, listProspectDecisions, ProspectDecisionCommandSchema, saveProspectDecision } from "./engine-prospect-decisions";

const command = (overrides: Record<string, unknown> = {}) => ({
  commandId: "0b0f6a11-1b7f-4a42-9d0a-6d1e8f590d9b", websiteUrl: "https://www.synthetic-roofing.example/", decision: "WORTH_A_CALL", reason: null, ...overrides,
});

test("not-a-fit needs a reason and worth-a-call has none", () => {
  assert.equal(ProspectDecisionCommandSchema.safeParse(command({ decision: "NOT_A_FIT" })).success, false);
  assert.equal(ProspectDecisionCommandSchema.safeParse(command({ reason: "OTHER" })).success, false);
  assert.equal(ProspectDecisionCommandSchema.safeParse(command({ decision: "NOT_A_FIT", reason: "WEBSITE_ALREADY_FINE" })).success, true);
});

test("decisions are append-only, idempotent per key, and the newest per website wins", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "engine-decisions-"));
  try {
    const first = await saveProspectDecision(command(), "RILEY", { root, now: () => new Date("2026-09-23T20:00:00Z") });
    assert.equal(first.status, "SAVED");
    assert.equal(first.decision.contactAuthorized, false);
    assert.equal((await saveProspectDecision(command(), "RILEY", { root })).status, "ALREADY_SAVED");
    await assert.rejects(saveProspectDecision(command({ decision: "NOT_A_FIT", reason: "OTHER" }), "RILEY", { root }), /different decision/);
    await saveProspectDecision(command({ commandId: "9d0a6d1e-8f59-4a42-9d0a-0b0f6a111b7f", decision: "NOT_A_FIT", reason: "WEBSITE_ALREADY_FINE", websiteUrl: "https://synthetic-roofing.example/" }), "AIDAN", { root, now: () => new Date("2026-09-24T20:00:00Z") });
    const latest = latestProspectDecisions(await listProspectDecisions(root));
    assert.equal(latest.size, 1);
    assert.equal(latest.get("synthetic-roofing.example")?.decidedBy, "AIDAN");
  } finally { await rm(root, { recursive: true, force: true }); }
});
