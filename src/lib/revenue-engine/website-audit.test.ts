import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicWebsiteAuditInputSchema,
  auditWebsiteDeterministically,
  type DeterministicWebsiteAuditInput,
} from "@/lib/revenue-engine/website-audit";

function modernSite(): DeterministicWebsiteAuditInput {
  return {
    businessId: "business:kw-roofing",
    businessName: "KW Roofing",
    niche: "roofing",
    expectedServices: ["roofing", "roof repair"],
    expectedLocations: ["Kitchener", "Waterloo"],
    sourceEvidenceUrl: "https://source.example/business/kw-roofing",
    siteState: "CAPTURED",
    requestedUrl: "https://kwroofing.example",
    finalUrl: "https://kwroofing.example/",
    statusCode: 200,
    redirectCount: 1,
    capturedAt: "2026-08-22T15:00:00.000Z",
    desktopArtifactRef: "artifact:desktop:kw-roofing",
    mobileArtifactRef: "artifact:mobile:kw-roofing",
    domArtifactRef: "artifact:dom:kw-roofing",
    pageSetComplete: true,
    pages: [
      {
        kind: "HOME",
        url: "https://kwroofing.example/",
        title: "KW Roofing | Kitchener and Waterloo",
        metaDescription: "Roof repair and replacement in Kitchener and Waterloo.",
        visibleText: "Roofing and roof repair for Kitchener and Waterloo homeowners.",
        actions: [
          { kind: "PHONE", label: "Call now", href: "tel:+15195550123", visible: true, aboveFold: true },
          { kind: "QUOTE", label: "Request a quote", href: "/contact", visible: true, aboveFold: true },
        ],
        forms: [],
        trustSignals: ["REVIEW", "PROJECT_GALLERY", "WARRANTY"],
        structuredDataTypes: ["RoofingContractor"],
        contentComplete: true,
        evidenceCoverage: {
          desktopRenderCaptured: true,
          actionVisibilityComplete: true,
          formVisibilityComplete: true,
        },
      },
      {
        kind: "SERVICE",
        url: "https://kwroofing.example/roof-repair",
        title: "Roof Repair",
        metaDescription: "Roof repair service.",
        visibleText: "Roof repair in Waterloo.",
        actions: [],
        forms: [],
        trustSignals: ["PROJECT_GALLERY"],
        structuredDataTypes: [],
        contentComplete: true,
        evidenceCoverage: {
          desktopRenderCaptured: true,
          actionVisibilityComplete: true,
          formVisibilityComplete: true,
        },
      },
      {
        kind: "CONTACT",
        url: "https://kwroofing.example/contact",
        title: "Contact KW Roofing",
        metaDescription: "Request a roofing quote.",
        visibleText: "Contact our Kitchener roofing team.",
        actions: [],
        forms: [{ visible: true, hasSubmitControl: true, disabled: false, actionUrl: "https://kwroofing.example/contact" }],
        trustSignals: [],
        structuredDataTypes: [],
        contentComplete: true,
        evidenceCoverage: {
          desktopRenderCaptured: true,
          actionVisibilityComplete: true,
          formVisibilityComplete: true,
        },
      },
    ],
    resourceProbes: [
      { url: "https://kwroofing.example/", type: "PAGE", internal: true, statusCode: 200 },
      { url: "https://kwroofing.example/site.css", type: "ASSET", internal: true, statusCode: 200 },
    ],
    mobile: {
      captured: true,
      horizontalOverflow: false,
      navigationUsable: true,
      textReadable: true,
      minimumTapTargetPx: 44,
    },
  };
}

test("a modern conversion-ready site becomes no opportunity", () => {
  const result = auditWebsiteDeterministically(modernSite());
  assert.equal(result.classification, "NO_OPPORTUNITY");
  assert.equal(result.rebuildNeedScore, 0);
  assert.equal(result.evidenceConfidence, 100);
  assert.equal(result.claims.length, 0);
});

test("a weak generic site produces several traceable rebuild claims", () => {
  const input = modernSite();
  input.finalUrl = "http://kwroofing.example/";
  input.statusCode = 200;
  input.redirectCount = 5;
  input.pages = [{
    kind: "HOME",
    url: "http://kwroofing.example/",
    title: null,
    metaDescription: null,
    visibleText: "Welcome to our company.",
    actions: [],
    forms: [],
    trustSignals: [],
    structuredDataTypes: [],
    contentComplete: true,
    evidenceCoverage: {
      desktopRenderCaptured: true,
      actionVisibilityComplete: true,
      formVisibilityComplete: true,
    },
  }];
  input.resourceProbes = [
    { url: "http://kwroofing.example/missing.css", type: "ASSET", internal: true, statusCode: 404 },
  ];
  input.mobile = {
    captured: false,
    horizontalOverflow: null,
    navigationUsable: null,
    textReadable: null,
    minimumTapTargetPx: null,
  };

  const result = auditWebsiteDeterministically(input);
  assert.equal(result.classification, "REBUILD");
  assert.equal(result.rebuildNeedScore, 100);
  assert.ok(result.claims.length >= 8);
  assert.ok(result.claims.some((claim) => claim.conversionCritical));
  assert.ok(result.manualReviewReasons.includes("unverified:mobile_navigation"));
  for (const claim of result.claims) {
    assert.match(claim.sourceUrl, /^https?:\/\//);
    assert.equal(claim.capturedAt, input.capturedAt);
    assert.ok(claim.auditVersion);
    assert.ok(claim.confidence >= 80);
  }
});

test("unreachable and missing websites remain distinct opportunities", () => {
  const unreachable = modernSite();
  unreachable.siteState = "UNREACHABLE";
  unreachable.finalUrl = null;
  unreachable.statusCode = 503;
  unreachable.desktopArtifactRef = null;
  unreachable.mobileArtifactRef = null;
  unreachable.domArtifactRef = null;
  unreachable.pages = [];
  unreachable.resourceProbes = [];
  unreachable.mobile = {
    captured: false,
    horizontalOverflow: null,
    navigationUsable: null,
    textReadable: null,
    minimumTapTargetPx: null,
  };
  const brokenResult = auditWebsiteDeterministically(unreachable);
  assert.equal(brokenResult.classification, "REBUILD");
  assert.equal(brokenResult.claims[0]?.method, "http_probe");

  const missing = modernSite();
  missing.siteState = "NO_SITE";
  missing.requestedUrl = null;
  missing.finalUrl = null;
  missing.statusCode = 0;
  missing.redirectCount = 0;
  missing.desktopArtifactRef = null;
  missing.mobileArtifactRef = null;
  missing.domArtifactRef = null;
  missing.pages = [];
  missing.resourceProbes = [];
  missing.mobile = {
    captured: false,
    horizontalOverflow: null,
    navigationUsable: null,
    textReadable: null,
    minimumTapTargetPx: null,
  };
  const missingResult = auditWebsiteDeterministically(missing);
  assert.equal(missingResult.classification, "NO_SITE_NEW_BUILD");
  assert.equal(missingResult.claims[0]?.method, "source_api");
});

test("mobile conversion failures can independently justify a rebuild", () => {
  const input = modernSite();
  input.mobile = {
    captured: true,
    horizontalOverflow: true,
    navigationUsable: false,
    textReadable: false,
    minimumTapTargetPx: 18,
  };

  const result = auditWebsiteDeterministically(input);
  assert.equal(result.classification, "REBUILD");
  assert.equal(result.rebuildNeedScore, 58);
  assert.equal(result.evidenceConfidence, 100);
  assert.equal(result.claims.filter((claim) => claim.conversionCritical).length, 3);
});

test("one meaningful weakness stays a minor improvement", () => {
  const input = modernSite();
  input.pages = input.pages.map((page) => ({ ...page, trustSignals: [] }));
  const result = auditWebsiteDeterministically(input);
  assert.equal(result.classification, "MINOR_IMPROVEMENT");
  assert.equal(result.rebuildNeedScore, 12);
});

test("an incomplete page set cannot turn an unseen contact form into a defect", () => {
  const input = modernSite();
  input.pageSetComplete = false;
  input.pages = input.pages.filter((page) => page.kind !== "CONTACT");
  const result = auditWebsiteDeterministically(input);
  assert.equal(result.checks.find((check) => check.checkId === "form_availability")?.outcome, "UNKNOWN");
  assert.ok(result.manualReviewReasons.includes("unverified:form_availability"));
  assert.ok(result.claims.every((claim) => claim.category !== "form"));
});

test("captured input fails closed without a final URL and page evidence", () => {
  const input = { ...modernSite(), finalUrl: null, pages: [] };
  assert.equal(DeterministicWebsiteAuditInputSchema.safeParse(input).success, false);

  const contaminatedNoSite = { ...modernSite(), siteState: "NO_SITE", requestedUrl: null, finalUrl: null, pages: [] };
  assert.equal(DeterministicWebsiteAuditInputSchema.safeParse(contaminatedNoSite).success, false);

  const contaminatedUnreachable = { ...modernSite(), siteState: "UNREACHABLE", finalUrl: null, statusCode: 503, pages: [] };
  assert.equal(DeterministicWebsiteAuditInputSchema.safeParse(contaminatedUnreachable).success, false);

  const uncapturedMobileWithMeasurements = modernSite();
  uncapturedMobileWithMeasurements.mobile = {
    captured: false,
    horizontalOverflow: true,
    navigationUsable: null,
    textReadable: null,
    minimumTapTargetPx: null,
  };
  assert.equal(DeterministicWebsiteAuditInputSchema.safeParse(uncapturedMobileWithMeasurements).success, false);
});

test("repeated audits cannot reuse evidence claim identities across capture times", () => {
  const missingAt = (capturedAt: string) => {
    const input = modernSite();
    input.siteState = "NO_SITE";
    input.requestedUrl = null;
    input.finalUrl = null;
    input.statusCode = 0;
    input.redirectCount = 0;
    input.capturedAt = capturedAt;
    input.desktopArtifactRef = null;
    input.mobileArtifactRef = null;
    input.domArtifactRef = null;
    input.pages = [];
    input.resourceProbes = [];
    input.mobile = {
      captured: false,
      horizontalOverflow: null,
      navigationUsable: null,
      textReadable: null,
      minimumTapTargetPx: null,
    };
    return input;
  };
  const first = auditWebsiteDeterministically(missingAt("2026-08-20T12:00:00.000Z"));
  const second = auditWebsiteDeterministically(missingAt("2026-08-21T12:00:00.000Z"));

  assert.equal(first.claims.length, 1);
  assert.equal(second.claims.length, 1);
  assert.notEqual(first.claims[0]?.claimId, second.claims[0]?.claimId);
  assert.match(first.claims[0]?.claimId ?? "", /^claim:v4:[a-f0-9]{64}$/);
});
