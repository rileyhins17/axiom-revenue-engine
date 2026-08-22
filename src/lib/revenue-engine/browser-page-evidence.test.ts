import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_PAGE_EVIDENCE_VERSION,
  BROWSER_PAGE_MEASUREMENT_VERSION,
  BROWSER_NETWORK_POLICY_VERSION,
  BrowserPageEvidenceSchema,
  mergeHtmlPageWithBrowserEvidence,
  type BrowserPageEvidence,
} from "@/lib/revenue-engine/browser-page-evidence";
import {
  HTML_PAGE_FACTS_VERSION,
  HtmlPageFactsSchema,
} from "@/lib/revenue-engine/html-page-facts";
import { auditWebsiteDeterministically } from "@/lib/revenue-engine/website-audit";

const BUSINESS_ID = "business:fixture-roofing";
const PAGE_URL = "https://fixture-roofing.ca/";
const CAPTURED_AT = "2026-08-22T22:00:00.000Z";
const SHA256 = "a".repeat(64);

function htmlFacts(complete = true) {
  return HtmlPageFactsSchema.parse({
    extractorVersion: HTML_PAGE_FACTS_VERSION,
    captureVersion: "website-capture-v1",
    capturedAt: CAPTURED_AT,
    pageKind: "HOME",
    url: PAGE_URL,
    title: "Fixture Roofing | Kitchener",
    metaDescription: "Roof repair in Kitchener.",
    visibleText: "Fixture Roofing provides roof repair in Kitchener.",
    actions: [
      {
        kind: "PHONE",
        label: "Call now",
        href: "tel:+15195550199",
        notExplicitlyHidden: true,
        aboveFold: "UNKNOWN",
      },
      {
        kind: "QUOTE",
        label: "Request a quote",
        href: "https://fixture-roofing.ca/contact",
        notExplicitlyHidden: true,
        aboveFold: "UNKNOWN",
      },
    ],
    forms: [{
      actionUrl: "https://fixture-roofing.ca/contact",
      method: "POST",
      notExplicitlyHidden: true,
      hasEnabledSubmitControl: true,
    }],
    trustSignals: ["PROJECT_GALLERY"],
    structuredDataTypes: ["RoofingContractor"],
    discoveredInternalLinks: [],
    complete,
    warnings: complete ? [] : ["token_limit_reached"],
    policy: { maxTokens: 50_000, maxTextChars: 100_000, maxJsonLdChars: 100_000 },
    tokenCount: complete ? 100 : 50_001,
  });
}

function capturedEvidence(
  profile: "DESKTOP_1440X900" | "MOBILE_390X844",
  overrides: Record<string, unknown> = {},
): BrowserPageEvidence {
  const mobile = profile === "MOBILE_390X844";
  return BrowserPageEvidenceSchema.parse({
    evidenceVersion: BROWSER_PAGE_EVIDENCE_VERSION,
    measurementVersion: BROWSER_PAGE_MEASUREMENT_VERSION,
    captureId: `capture:${profile}`,
    businessId: BUSINESS_ID,
    pageKind: "HOME",
    requestedUrl: PAGE_URL,
    profile,
    viewport: mobile
      ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
      : { width: 1_440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    capturedAt: CAPTURED_AT,
    provider: "CLOUDFLARE_BROWSER_RENDERING",
    providerRequestId: null,
    browserMsUsed: 250,
    networkPolicy: {
      policyVersion: BROWSER_NETWORK_POLICY_VERSION,
      requestInterceptionEnabled: true,
      allRequestUrlsValidated: true,
      privateNetworkRequestsAllowed: 0,
      credentialsUsed: false,
      formSubmissions: 0,
      downloadsAccepted: 0,
      requestsObserved: 12,
      requestsBlocked: 0,
      documentUrls: [PAGE_URL],
    },
    warnings: [],
    outcome: "CAPTURED",
    finalUrl: PAGE_URL,
    screenshotArtifactRef: `artifact:screenshot:${profile}`,
    screenshotSha256: SHA256,
    measurementArtifactRef: `artifact:measurement:${profile}`,
    document: mobile
      ? { clientWidth: 390, documentScrollWidth: 430, bodyScrollWidth: 430 }
      : { clientWidth: 1_440, documentScrollWidth: 1_440, bodyScrollWidth: 1_440 },
    actions: [
      {
        actionId: `phone:${profile}`,
        kind: "PHONE",
        label: "Call now",
        href: "tel:+15195550199",
        visible: true,
        enabled: true,
        boundingBox: { x: 20, y: 100, width: mobile ? 18 : 120, height: mobile ? 18 : 44 },
      },
      {
        actionId: `quote:${profile}`,
        kind: "QUOTE",
        label: "Request a quote",
        href: "https://fixture-roofing.ca/contact",
        visible: true,
        enabled: true,
        boundingBox: { x: 20, y: 180, width: 160, height: 44 },
      },
      {
        actionId: `booking:${profile}`,
        kind: "BOOK",
        label: "Book an inspection",
        href: "https://fixture-roofing.ca/book",
        visible: true,
        enabled: true,
        boundingBox: { x: 20, y: 950, width: 160, height: 44 },
      },
    ],
    forms: [{
      formId: `contact:${profile}`,
      actionUrl: "https://fixture-roofing.ca/contact",
      method: "POST",
      visible: true,
      hasSubmitControl: true,
      disabled: false,
      boundingBox: { x: 20, y: 1_100, width: 320, height: 400 },
    }],
    navigation: mobile
      ? { status: "UNUSABLE", probePerformed: true, reasonCodes: ["menu_did_not_open"] }
      : { status: "UNKNOWN", probePerformed: false, reasonCodes: [] },
    text: mobile
      ? { readable: false, minimumFontSizePx: 11, measuredTextNodes: 30 }
      : { readable: null, minimumFontSizePx: null, measuredTextNodes: 0 },
    coverage: {
      layoutComplete: true,
      actionsComplete: true,
      formsComplete: true,
      navigationComplete: mobile,
      textComplete: mobile,
    },
    failure: null,
    ...overrides,
  });
}

function auditMerged(browser: BrowserPageEvidence[]) {
  const merged = mergeHtmlPageWithBrowserEvidence({
    businessId: BUSINESS_ID,
    html: htmlFacts(),
    browser,
  });
  return {
    merged,
    audit: auditWebsiteDeterministically({
      businessId: BUSINESS_ID,
      businessName: "Fixture Roofing",
      niche: "roofing",
      expectedServices: ["roof repair"],
      expectedLocations: ["Kitchener"],
      sourceEvidenceUrl: "https://example.com/source/fixture-roofing",
      siteState: "CAPTURED",
      requestedUrl: PAGE_URL,
      finalUrl: PAGE_URL,
      statusCode: 200,
      redirectCount: 0,
      capturedAt: CAPTURED_AT,
      desktopArtifactRef: merged.desktopArtifactRef,
      mobileArtifactRef: merged.mobileArtifactRef,
      domArtifactRef: merged.desktopMeasurementArtifactRef || "artifact:server-html",
      pageSetComplete: false,
      pages: [merged.page],
      resourceProbes: [],
      mobile: merged.mobile,
    }),
  };
}

test("server HTML alone keeps visual facts unknown instead of inventing website failures", () => {
  const { merged, audit } = auditMerged([]);
  assert.equal(merged.page.actions[0]?.visible, null);
  assert.equal(merged.page.actions[0]?.aboveFold, null);
  assert.equal(merged.page.forms[0]?.visible, null);
  assert.equal(merged.mobile.captured, false);
  assert.equal(merged.mobile.navigationUsable, null);
  assert.ok(audit.manualReviewReasons.includes("unverified:primary_conversion_action"));
  assert.ok(audit.manualReviewReasons.includes("unverified:form_availability"));
  assert.ok(audit.claims.every((claim) => !["conversion_action", "form", "mobile", "navigation"].includes(claim.category)));
});

test("fixed desktop and mobile evidence merges measured layout without hiding provenance", () => {
  const desktop = capturedEvidence("DESKTOP_1440X900");
  const mobile = capturedEvidence("MOBILE_390X844");
  const { merged, audit } = auditMerged([desktop, mobile]);

  assert.equal(merged.page.actions[0]?.visible, true);
  assert.equal(merged.page.actions[0]?.aboveFold, true);
  assert.equal(merged.page.actions.find((action) => action.kind === "BOOK")?.aboveFold, false);
  assert.equal(merged.page.forms[0]?.visible, true);
  assert.equal(merged.mobile.horizontalOverflow, true);
  assert.equal(merged.mobile.navigationUsable, false);
  assert.equal(merged.mobile.textReadable, false);
  assert.equal(merged.mobile.minimumTapTargetPx, 18);
  assert.equal(audit.checks.find((check) => check.checkId === "primary_conversion_action")?.outcome, "PASS");
  assert.equal(audit.checks.find((check) => check.checkId === "mobile_overflow")?.outcome, "FAIL");
  assert.equal(audit.checks.find((check) => check.checkId === "mobile_navigation")?.outcome, "FAIL");
});

test("partial browser measurements stay unknown even when a screenshot exists", () => {
  const partial = capturedEvidence("MOBILE_390X844", {
    actions: [],
    forms: [],
    navigation: { status: "UNKNOWN", probePerformed: false, reasonCodes: [] },
    text: { readable: null, minimumFontSizePx: null, measuredTextNodes: 0 },
    coverage: {
      layoutComplete: false,
      actionsComplete: false,
      formsComplete: false,
      navigationComplete: false,
      textComplete: false,
    },
  });
  const { merged, audit } = auditMerged([partial]);
  assert.equal(merged.mobile.captured, true);
  assert.equal(merged.mobile.horizontalOverflow, null);
  assert.equal(merged.mobile.minimumTapTargetPx, null);
  assert.equal(audit.checks.find((check) => check.checkId === "mobile_overflow")?.outcome, "UNKNOWN");
  assert.equal(audit.checks.find((check) => check.checkId === "mobile_tap_targets")?.outcome, "UNKNOWN");
});

test("failed browser capture is retained as a warning and cannot become a negative finding", () => {
  const failed = BrowserPageEvidenceSchema.parse({
    evidenceVersion: BROWSER_PAGE_EVIDENCE_VERSION,
    measurementVersion: BROWSER_PAGE_MEASUREMENT_VERSION,
    captureId: "capture:failed-mobile",
    businessId: BUSINESS_ID,
    pageKind: "HOME",
    requestedUrl: PAGE_URL,
    profile: "MOBILE_390X844",
    viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    capturedAt: CAPTURED_AT,
    provider: "CLOUDFLARE_BROWSER_RENDERING",
    providerRequestId: null,
    browserMsUsed: 120_000,
    networkPolicy: {
      policyVersion: BROWSER_NETWORK_POLICY_VERSION,
      requestInterceptionEnabled: true,
      allRequestUrlsValidated: true,
      privateNetworkRequestsAllowed: 0,
      credentialsUsed: false,
      formSubmissions: 0,
      downloadsAccepted: 0,
      requestsObserved: 1,
      requestsBlocked: 0,
      documentUrls: [PAGE_URL],
    },
    warnings: ["provider_timeout"],
    outcome: "FAILED",
    finalUrl: null,
    screenshotArtifactRef: null,
    screenshotSha256: null,
    measurementArtifactRef: null,
    document: null,
    actions: [],
    forms: [],
    navigation: null,
    text: null,
    coverage: {
      layoutComplete: false,
      actionsComplete: false,
      formsComplete: false,
      navigationComplete: false,
      textComplete: false,
    },
    failure: { code: "TIMEOUT", message: "Synthetic browser timeout." },
  });
  const { merged, audit } = auditMerged([failed]);
  assert.ok(merged.warnings.includes("mobile_390x844:TIMEOUT"));
  assert.equal(merged.mobile.captured, false);
  assert.equal(audit.checks.find((check) => check.checkId === "mobile_navigation")?.outcome, "UNKNOWN");
  assert.ok(audit.claims.every((claim) => !["mobile", "navigation"].includes(claim.category)));
});

test("contract rejects inconsistent viewports and embedded screenshot data", () => {
  const valid = capturedEvidence("DESKTOP_1440X900") as Record<string, unknown>;
  assert.equal(BrowserPageEvidenceSchema.safeParse({
    ...valid,
    viewport: { width: 1_024, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  }).success, false);
  assert.equal(BrowserPageEvidenceSchema.safeParse({
    ...valid,
    screenshotArtifactRef: "data:image/png;base64,not-an-artifact-reference",
  }).success, false);
  assert.equal(BrowserPageEvidenceSchema.safeParse({
    ...valid,
    requestedUrl: "http://127.0.0.1/",
  }).success, false);
  assert.equal(BrowserPageEvidenceSchema.safeParse({
    ...valid,
    networkPolicy: {
      ...(valid.networkPolicy as Record<string, unknown>),
      documentUrls: [PAGE_URL, "http://169.254.169.254/latest/meta-data/"],
    },
  }).success, false);
});

test("merge rejects cross-business, duplicate-profile, and final-URL contamination", () => {
  const desktop = capturedEvidence("DESKTOP_1440X900");
  assert.throws(
    () => mergeHtmlPageWithBrowserEvidence({ businessId: "business:other", html: htmlFacts(), browser: [desktop] }),
    /same business/,
  );
  assert.throws(
    () => mergeHtmlPageWithBrowserEvidence({ businessId: BUSINESS_ID, html: htmlFacts(), browser: [desktop, desktop] }),
    /at most one result/,
  );
  const otherUrl = capturedEvidence("DESKTOP_1440X900", { finalUrl: "https://other-fixture.ca/" });
  assert.throws(
    () => mergeHtmlPageWithBrowserEvidence({ businessId: BUSINESS_ID, html: htmlFacts(), browser: [otherUrl] }),
    /final URL must match/,
  );
});
