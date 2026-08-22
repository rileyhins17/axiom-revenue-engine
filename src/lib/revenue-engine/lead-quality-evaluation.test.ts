import assert from "node:assert/strict";
import test from "node:test";

import {
  KW_LEAD_EVALUATION_VERSION,
  KwLeadEvaluationSetSchema,
  summarizeKwLeadEvaluation,
  type KwLeadEvaluationEntry,
  type KwLeadEvaluationSet,
} from "@/lib/revenue-engine/lead-quality-evaluation";
import { auditWebsiteDeterministically, type DeterministicWebsiteAuditInput } from "@/lib/revenue-engine/website-audit";

function auditFixture(id: number) {
  const input: DeterministicWebsiteAuditInput = {
    businessId: `business:${id}`,
    businessName: `Business ${id}`,
    niche: "roofing",
    expectedServices: ["roofing"],
    expectedLocations: ["Kitchener"],
    sourceEvidenceUrl: `https://source.example/business/${id}`,
    siteState: "NO_SITE",
    requestedUrl: null,
    finalUrl: null,
    statusCode: 0,
    redirectCount: 0,
    capturedAt: "2026-08-22T15:00:00.000Z",
    desktopArtifactRef: null,
    mobileArtifactRef: null,
    domArtifactRef: null,
    pageSetComplete: false,
    pages: [],
    resourceProbes: [],
    mobile: {
      captured: false,
      horizontalOverflow: null,
      navigationUsable: null,
      textReadable: null,
      minimumTapTargetPx: null,
    },
  };
  return auditWebsiteDeterministically(input);
}

function entry(id: number, ownerAgrees: boolean): KwLeadEvaluationEntry {
  const cities = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
  const niches = ["ROOFING", "HVAC", "LANDSCAPING"] as const;
  return {
    entryVersion: KW_LEAD_EVALUATION_VERSION,
    leadId: `lead:${id}`,
    businessId: `business:${id}`,
    businessIdentityKey: `identity:business:${id}`,
    businessName: `Business ${id}`,
    city: cities[id % cities.length],
    niche: niches[id % niches.length],
    sourceEvidenceUrl: `https://source.example/business/${id}`,
    websiteUrl: null,
    audit: auditFixture(id),
    engineAssessment: {
      label: "STRONG",
      scores: {
        businessFit: 80,
        rebuildNeed: 90,
        reachability: 65,
        timing: 50,
        evidenceConfidence: 100,
      },
      policyVersion: "revenue-shadow-v3",
      assessedAt: "2026-08-22T15:01:00.000Z",
    },
    ownerReview: {
      label: ownerAgrees ? "STRONG" : "WEAK",
      reasons: [ownerAgrees ? "GOOD_COMMERCIAL_FIT" : "TOO_SMALL_OR_LOW_VALUE"],
      notes: "",
      reviewedAt: "2026-08-22T15:02:00.000Z",
    },
    addedAt: "2026-08-22T15:01:00.000Z",
  };
}

function evaluationSet(entries: KwLeadEvaluationEntry[]): KwLeadEvaluationSet {
  return {
    setVersion: KW_LEAD_EVALUATION_VERSION,
    setId: "kw-evaluation-2026-08-22",
    market: "KITCHENER_WATERLOO_CAMBRIDGE",
    targetSize: 50,
    createdAt: "2026-08-22T15:00:00.000Z",
    entries,
  };
}

test("the KW quality gate passes only with 50 balanced reviews and at least 85 percent agreement", () => {
  const entries = Array.from({ length: 50 }, (_, index) => entry(index, index < 43));
  const result = summarizeKwLeadEvaluation(evaluationSet(entries));
  assert.equal(result.reviewed, 50);
  assert.equal(result.agreementPercent, 86);
  assert.equal(result.ready, true);
});

test("partial evaluation sets report the exact remaining owner work", () => {
  const entries = Array.from({ length: 12 }, (_, index) => entry(index, true));
  const result = summarizeKwLeadEvaluation(evaluationSet(entries));
  assert.equal(result.ready, false);
  assert.ok(result.gateReasons.includes("needs_38_more_leads"));
  assert.ok(result.gateReasons.includes("needs_38_more_owner_reviews"));
});

test("duplicate business identities fail closed", () => {
  const first = entry(1, true);
  const duplicate = { ...entry(2, true), businessIdentityKey: first.businessIdentityKey };
  assert.equal(KwLeadEvaluationSetSchema.safeParse(evaluationSet([first, duplicate])).success, false);
});

test("an evaluation cannot attach another business's audit", () => {
  const invalid = entry(1, true);
  invalid.audit.businessId = "business:someone-else";
  assert.equal(KwLeadEvaluationSetSchema.safeParse(evaluationSet([invalid])).success, false);
});

test("reviewed labels require a timestamp and at least one owner reason", () => {
  const invalid = entry(1, true);
  invalid.ownerReview.reviewedAt = null;
  invalid.ownerReview.reasons = [];
  assert.equal(KwLeadEvaluationSetSchema.safeParse(evaluationSet([invalid])).success, false);
});
