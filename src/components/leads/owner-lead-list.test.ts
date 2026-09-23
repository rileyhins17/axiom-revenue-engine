import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OwnerLeadList, OwnerLeadsUnavailable } from "@/components/leads/owner-lead-list";
import {
  OWNER_LEAD_PROJECTION_VERSION,
  type OwnerLeadProjection,
} from "@/lib/revenue-engine/owner-lead-projection";
import {
  OWNER_LEAD_READ_MODEL_VERSION,
  type OwnerLeadListResponse,
} from "@/lib/revenue-engine/owner-lead-read-model";

const GENERATED_AT = "2026-08-25T18:00:00.000Z";

function fixtureLead(overrides: Partial<Pick<OwnerLeadProjection, "attention" | "ownerActionable" | "route" | "dataQuality" | "qualification">> = {}): OwnerLeadProjection {
  const evidence = [{
    claimId: "claim:mobile-navigation",
    observation: "The mobile navigation is not usable and the page overflows horizontally.",
    category: "MOBILE_USABILITY",
    confidence: 96,
    conversionCritical: true,
    sourceUrl: "https://roofing.example/evidence/mobile",
    capturedAt: "2026-08-24T15:00:00.000Z",
    artifactRef: "artifact:sha256:mobile",
  }, {
    claimId: "claim:no-cta",
    observation: "The home page has no visible quote or phone action above the fold.",
    category: "PRIMARY_ACTION",
    confidence: 94,
    conversionCritical: true,
    sourceUrl: "https://roofing.example/evidence/home",
    capturedAt: "2026-08-24T15:00:00.000Z",
    artifactRef: "artifact:sha256:desktop",
  }, {
    claimId: "claim:no-trust",
    observation: "No testimonials, project proof, or warranty details were found on the home page.",
    category: "TRUST",
    confidence: 90,
    conversionCritical: false,
    sourceUrl: "https://roofing.example/evidence/home",
    capturedAt: "2026-08-24T15:00:00.000Z",
    artifactRef: "artifact:sha256:dom",
  }];

  return {
    projectionVersion: OWNER_LEAD_PROJECTION_VERSION,
    projectedAt: GENERATED_AT,
    projectionKey: "business:roofing:qualification:1:2026-08-25T18:00:00.000Z",
    business: {
      businessId: "business:roofing",
      canonicalName: "Tri-City Roofing",
      niche: "ROOFING",
      normalizedDomain: "roofing.example",
      websiteUrl: "https://roofing.example/",
      independenceStatus: "INDEPENDENT",
      status: "RESEARCH_ONLY",
      location: { city: "KITCHENER", region: "ON", country: "CA" },
      sourceEvidenceUrl: "https://source.example/tri-city-roofing",
      sourceCapturedAt: "2026-08-23T15:00:00.000Z",
    },
    audit: {
      classification: "REBUILD",
      auditVersion: "deterministic-website-audit-v1",
      capturedAt: "2026-08-24T15:00:00.000Z",
      finalUrl: "https://roofing.example/",
    },
    qualification: {
      snapshotId: "qualification:roofing:1",
      policyVersion: "revenue-lead-qualification-v1",
      band: "PRIORITY",
      totalScore: 82,
      scores: {
        rebuildNeed: 91,
        businessFit: 84,
        reachability: 78,
        timing: 62,
        evidenceConfidence: 93,
      },
      failedGates: [],
    },
    attention: "READY_FOR_REVIEW",
    ownerActionable: true,
    route: {
      channel: "PHONE",
      readiness: "MANUAL_ACTION",
      contactPointId: "contact:roofing:phone",
      label: "Business phone",
      reason: "A current business phone is the strongest supported route.",
    },
    whyThisLead: evidence,
    evidence,
    dataQuality: { state: "CURRENT", issues: [] },
    authority: {
      readOnly: true,
      shadowOnly: true,
      qualificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      mutationAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
    ...overrides,
  };
}

function fixtureResponse(leads: OwnerLeadProjection[], options: { rejectedBusinesses?: number; ignoredContactRows?: number } = {}): OwnerLeadListResponse {
  const rejectedBusinesses = options.rejectedBusinesses ?? 0;
  const ignoredContactRows = options.ignoredContactRows ?? 0;
  return {
    readModelVersion: OWNER_LEAD_READ_MODEL_VERSION,
    generatedAt: GENERATED_AT,
    leads,
    rejections: Array.from({ length: rejectedBusinesses }, (_, index) => ({
      businessId: `business:rejected:${index}`,
      code: "INVALID_PROJECTION_INPUT" as const,
    })),
    summary: {
      candidateRows: leads.length + rejectedBusinesses,
      returned: leads.length,
      ignoredContactRows,
      rejectedBusinesses,
      readyForReview: leads.filter((lead) => lead.attention === "READY_FOR_REVIEW").length,
      needsRefresh: leads.filter((lead) => lead.attention === "NEEDS_REFRESH").length,
      blocked: leads.filter((lead) => lead.attention === "BLOCKED").length,
    },
    authority: {
      readOnly: true,
      mutationAuthorized: false,
      outreachAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
}

test("owner lead list presents plain business details and keeps ranking details secondary", () => {
  const html = renderToStaticMarkup(createElement(OwnerLeadList, { data: fixtureResponse([fixtureLead()]), canReviewBusinessResearch: true }));
  const primary = html.slice(0, html.indexOf("<details")).replace(/<[^>]*>/g, " ");

  assert.match(html, /<h1[^>]*>Businesses to review<\/h1>/);
  assert.match(primary, /Roofing/);
  assert.match(primary, /Independent operator/);
  assert.match(html, /Kitchener, ON/);
  assert.match(html, /Website finding/);
  assert.match(html, /Ready for owner review/);
  assert.match(html, /Review evidence/);
  assert.doesNotMatch(primary, /legacy|calibration|shadow|read-only/i);
  assert.match(html, /Ranked review queue/);
  assert.match(html, /Tri-City Roofing/);
  assert.match(html, /Business fit/);
  assert.match(html, /Rebuild need/);
  assert.match(html, /Reachability/);
  assert.match(html, /Timing/);
  assert.match(html, /Evidence confidence/);
  assert.match(html, /The mobile navigation is not usable/);
  assert.match(html, /href="https:\/\/roofing\.example\/evidence\/mobile"/);
  assert.match(html, /Best reachable route/);
  assert.match(html, /Business phone/);
  assert.match(html, /Manual only/);
  assert.match(html, /Open evidence dossier/);
  assert.match(html, /href="\/leads\/business:roofing"/);
  assert.match(html, /Open Quality Lab/);
  assert.match(html, /href="\/leads\/evaluation"/);
  assert.match(html, /Read-only · no outreach permission/);
  assert.match(html, /href="\/leads\/m2\/identity"/);
  assert.match(html, /Review 10 businesses/);
  assert.match(html, /How business records are assessed/);
  assert.doesNotMatch(html, />Send</);
  assert.doesNotMatch(html, />Approve</);
});

test("owner lead list separates legacy preview rules from leads that still need qualification", () => {
  const needsQualification = fixtureLead({
    attention: "REVIEW",
    ownerActionable: false,
    qualification: {
      ...fixtureLead().qualification,
      failedGates: ["rebuild_need_below_65"],
    },
    route: {
      ...fixtureLead().route,
      readiness: "RESEARCH_REQUIRED",
    },
  });
  const html = renderToStaticMarkup(createElement(OwnerLeadList, {
    data: fixtureResponse([fixtureLead(), needsQualification]),
  }));

  assert.match(html, /Ready for owner review/);
  assert.match(html, /Needs a closer look/);
  assert.match(html, /Some review checks are still open/);
  assert.match(html, /Rebuild Need Below 65/);
  assert.match(html, /Meets preview rules<\/dt><dd[^>]*>1<\/dd>/);
  assert.match(html, /Preview checks open<\/dt><dd[^>]*>1<\/dd>/);
});

test("owner lead list keeps refresh and block states explicit and surfaces rejected data", () => {
  const refreshLead = fixtureLead({
    attention: "NEEDS_REFRESH",
    ownerActionable: false,
    route: {
      channel: "RESEARCH",
      readiness: "RESEARCH_REQUIRED",
      contactPointId: null,
      label: "Research contact route",
      reason: "No current, usable contact route is supported yet.",
    },
    dataQuality: { state: "NEEDS_REFRESH", issues: ["website_audit_stale"] },
  });
  const html = renderToStaticMarkup(createElement(OwnerLeadList, {
    data: fixtureResponse([refreshLead], { rejectedBusinesses: 1, ignoredContactRows: 1 }),
  }));

  assert.match(html, /Needs refresh/);
  assert.match(html, /Research contact route/);
  assert.match(html, /Website Audit Stale/);
  assert.match(html, /1 business was left out because its evidence could not be safely verified/);
  assert.match(html, /1 contact detail was ignored because it could not be safely verified/);
  assert.match(html, /Check safety and status before relying on this preview/);
});

test("empty owner lead list explains when businesses will appear", () => {
  const html = renderToStaticMarkup(createElement(OwnerLeadList, { data: fixtureResponse([]) }));

  assert.match(html, /No businesses to review yet/);
  assert.match(html, /current website research has been completed and checked/);
  assert.match(html, /No outreach was started/);
  assert.doesNotMatch(html, /Records.*active records/);
});

test("unavailable owner lead list stays honest about the live stop state", () => {
  const html = renderToStaticMarkup(createElement(OwnerLeadsUnavailable));

  assert.match(html, /Could not verify/);
  assert.match(html, /no scores or business counts are shown/);
  assert.match(html, /Check system status/);
  assert.match(html, /href="\/settings"/);
  assert.match(html, /read failure does not stop live automation/i);
});

test("non-admin lead preview does not offer the admin-only Business Review route", () => {
  const html = renderToStaticMarkup(createElement(OwnerLeadList, { data: fixtureResponse([fixtureLead()]) }));
  assert.match(html, /Business research is owner-managed/);
  assert.doesNotMatch(html, /href="\/leads\/m2"/);
});
