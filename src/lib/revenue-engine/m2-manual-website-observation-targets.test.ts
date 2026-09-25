import assert from "node:assert/strict";
import test from "node:test";

import { getApprovedM2ManualWebsiteObservationTargets } from "./m2-manual-website-observation-targets";

const packet = {
  status: "READY" as const,
  packetSha256: "a".repeat(64),
  selected: Array.from({ length: 10 }, (_, index) => ({
    reviewId: `M2-${String(index + 1).padStart(2, "0")}`,
    name: `Synthetic Company ${index + 1}`,
    officialWebsite: `https://company-${index + 1}.example.invalid/`,
    primarySource: `https://source-${index + 1}.example.invalid/`,
    city: "KITCHENER" as const,
    niche: "HVAC" as const,
    independenceClaim: "Synthetic owner-reviewed independent business fixture.",
    accessBlocked: false,
  })),
  supportedAlternates: [],
};

function decisions(overrides: Record<number, Record<string, unknown>> = {}) {
  return {
    decisionVersion: "kw-m2-owner-decisions-v1",
    researchReviewSha256: packet.packetSha256,
    reviewedBy: "RILEY",
    reviewedAt: "2026-09-23T12:00:00.000Z",
    decisions: packet.selected.map((candidate, index) => overrides[index]
      ? { reviewId: candidate.reviewId, ...overrides[index] }
      : {
        reviewId: candidate.reviewId,
        action: "KEEP",
        rationale: "Synthetic identity confirmed for a path contract test.",
        identityConfirmed: true,
        marketAndNicheConfirmed: true,
        independenceConfirmed: true,
      }),
  };
}

test("only current KEEP and replacement decisions produce manual observation targets", () => {
  const targets = getApprovedM2ManualWebsiteObservationTargets(packet, decisions({
    1: { action: "REPLACE", rationale: "Use a supported alternate synthetic fixture instead.", replacement: {
      name: "Synthetic Replacement Company", city: "KITCHENER", niche: "HVAC",
      sourceEvidenceUrl: "https://replacement-source.example.invalid/",
      websiteUrl: "https://replacement.example.invalid/", identityConfirmed: true,
      marketAndNicheConfirmed: true, independenceConfirmed: true,
      rationale: "Use a supported alternate synthetic fixture instead.",
    } },
    2: { action: "KEEP_AS_BLOCKED", rationale: "Synthetic fixture has no reviewed access route.", identityConfirmed: true, marketAndNicheConfirmed: true, independenceConfirmed: true },
    3: { action: "HOLD", rationale: "The synthetic identity remains on hold for review." },
    4: { action: "REJECT", rationale: "Reject the synthetic identity from the set." },
  }));

  assert.deepEqual(targets.map((target) => target.reviewId), ["M2-01", "M2-02", "M2-06", "M2-07", "M2-08", "M2-09", "M2-10"]);
  assert.equal(targets[1]?.businessName, "Synthetic Replacement Company");
  assert.equal(targets[1]?.approvedWebsiteUrl, "https://replacement.example.invalid/");
});

test("stale or invalid identity decisions never unlock manual observations", () => {
  assert.deepEqual(getApprovedM2ManualWebsiteObservationTargets(packet, {
    ...decisions(), researchReviewSha256: "b".repeat(64),
  }), []);
  assert.deepEqual(getApprovedM2ManualWebsiteObservationTargets({ status: "UNAVAILABLE", reason: "fixture" }, decisions()), []);
});
