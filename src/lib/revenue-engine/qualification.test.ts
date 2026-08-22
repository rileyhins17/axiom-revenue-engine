import assert from "node:assert/strict";
import test from "node:test";

import { calculateWeightedPriority, qualifyRevenueLead } from "@/lib/revenue-engine/qualification";

const evidence = [
  {
    claimId: "mobile-overflow",
    observation: "The primary service text overflows the mobile viewport.",
    sourceUrl: "https://example.com/",
    capturedAt: "2026-08-16T12:00:00.000Z",
    method: "browser_render" as const,
    confidence: 95,
    auditVersion: "website-audit-v1",
    artifactRef: "r2://evidence/mobile.png",
    conversionCritical: false,
    category: "mobile" as const,
  },
  {
    claimId: "missing-cta",
    observation: "No quote, booking, or tap-to-call action is visible above the fold.",
    sourceUrl: "https://example.com/",
    capturedAt: "2026-08-16T12:00:00.000Z",
    method: "deterministic_dom" as const,
    confidence: 100,
    auditVersion: "website-audit-v1",
    artifactRef: "r2://evidence/desktop.png",
    conversionCritical: true,
    category: "conversion_action" as const,
  },
  {
    claimId: "broken-form",
    observation: "The quote form displays an error before a submission is attempted.",
    sourceUrl: "https://example.com/contact",
    capturedAt: "2026-08-16T12:00:00.000Z",
    method: "deterministic_dom" as const,
    confidence: 95,
    auditVersion: "website-audit-v1",
    artifactRef: "r2://evidence/form.png",
    conversionCritical: true,
    category: "form" as const,
  },
];

test("priority formula uses the approved 35/30/20/10/5 weights", () => {
  assert.equal(calculateWeightedPriority({
    rebuildNeed: 100,
    businessFit: 100,
    reachability: 100,
    timing: 100,
    evidenceConfidence: 100,
  }), 100);
  assert.equal(calculateWeightedPriority({
    rebuildNeed: 100,
    businessFit: 0,
    reachability: 0,
    timing: 0,
    evidenceConfidence: 0,
  }), 35);
});

test("strong evidence and component gates create a shadow priority lead", () => {
  const result = qualifyRevenueLead({
    scores: { rebuildNeed: 90, businessFit: 80, reachability: 85, timing: 60, evidenceConfidence: 95 },
    evidenceClaims: evidence,
    availableChannels: ["PHONE", "FORM"],
  });

  assert.equal(result.band, "PRIORITY");
  assert.equal(result.recommendedChannel, "PHONE");
  assert.equal(result.autonomousEmailEligible, false);
  assert.equal(result.shadowOnly, true);
});

test("email availability changes the route but not business quality", () => {
  const input = {
    scores: { rebuildNeed: 90, businessFit: 80, reachability: 85, timing: 60, evidenceConfidence: 95 },
    evidenceClaims: evidence,
  };
  const email = qualifyRevenueLead({ ...input, availableChannels: ["EMAIL", "PHONE"] });
  const phone = qualifyRevenueLead({ ...input, availableChannels: ["PHONE"] });

  assert.equal(email.totalScore, phone.totalScore);
  assert.equal(email.recommendedChannel, "EMAIL");
  assert.equal(phone.recommendedChannel, "PHONE");
});

test("unsupported evidence and blocks prevent priority", () => {
  const result = qualifyRevenueLead({
    scores: { rebuildNeed: 95, businessFit: 95, reachability: 95, timing: 95, evidenceConfidence: 95 },
    evidenceClaims: evidence.slice(0, 1),
    availableChannels: ["EMAIL"],
    blocks: ["chain_business"],
  });

  assert.equal(result.band, "DISQUALIFIED");
  assert(result.failedGates.includes("fewer_than_three_supported_observations"));
  assert(result.failedGates.includes("missing_conversion_critical_observation"));
  assert(result.failedGates.includes("chain_business"));
});
