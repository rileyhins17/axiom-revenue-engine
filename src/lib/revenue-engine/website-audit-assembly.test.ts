import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT_STORE_CONTRACT_VERSION,
  artifactObjectKey,
} from "@/lib/revenue-engine/content-addressed-artifact-store";
import {
  BROWSER_NETWORK_POLICY_VERSION,
  BROWSER_PAGE_EVIDENCE_VERSION,
  BROWSER_PAGE_MEASUREMENT_VERSION,
} from "@/lib/revenue-engine/browser-page-evidence";
import { HTML_PAGE_FACTS_VERSION } from "@/lib/revenue-engine/html-page-facts";
import {
  WEBSITE_AUDIT_ASSEMBLY_VERSION,
  assembleWebsiteAuditInput,
  defaultWebsiteAuditAssemblyPolicy,
  type WebsiteAuditAssemblyRequest,
} from "@/lib/revenue-engine/website-audit-assembly";
import { auditWebsiteDeterministically } from "@/lib/revenue-engine/website-audit";
import { WEBSITE_CAPTURE_VERSION } from "@/lib/revenue-engine/website-capture";

const BUSINESS_ID = "business:fixture-roofing";
const WORKFLOW_ID = "22222222-2222-4222-8222-222222222222";
const ASSEMBLY_ID = "33333333-3333-4333-8333-333333333333";
const CAPTURED_AT = "2026-08-22T20:00:00.000Z";
const ASSEMBLED_AT = "2026-08-22T21:00:00.000Z";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function captureId(index: number, profile: "desktop" | "mobile") {
  const suffix = String(index * 2 + (profile === "mobile" ? 2 : 1)).padStart(12, "0");
  return `00000000-0000-4000-8000-${suffix}`;
}

function browserEvidence(
  pageKind: "HOME" | "SERVICE" | "ABOUT" | "CONTACT",
  url: string,
  index: number,
  profile: "desktop" | "mobile",
) {
  const mobile = profile === "mobile";
  const id = captureId(index, profile);
  const screenshotSha = digest(`screenshot:${id}`);
  const measurementSha = digest(`measurement:${id}`);
  const actions = pageKind === "HOME" ? [
    {
      actionId: `phone:${profile}`,
      kind: "PHONE",
      label: "Call now",
      href: "tel:+15195550199",
      visible: true,
      enabled: true,
      boundingBox: { x: 20, y: 100, width: 120, height: 44 },
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
  ] : [];
  const forms = pageKind === "CONTACT" ? [{
    formId: `contact:${profile}`,
    actionUrl: "https://fixture-roofing.ca/contact",
    method: "POST",
    visible: true,
    hasSubmitControl: true,
    disabled: false,
    boundingBox: { x: 20, y: 300, width: 320, height: 400 },
  }] : [];
  return {
    evidenceVersion: BROWSER_PAGE_EVIDENCE_VERSION,
    measurementVersion: BROWSER_PAGE_MEASUREMENT_VERSION,
    captureId: id,
    businessId: BUSINESS_ID,
    pageKind,
    requestedUrl: url,
    profile: mobile ? "MOBILE_390X844" : "DESKTOP_1440X900",
    viewport: mobile
      ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
      : { width: 1_440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    capturedAt: CAPTURED_AT,
    provider: "CLOUDFLARE_BROWSER_RENDERING",
    providerRequestId: `fixture:${id}`,
    browserMsUsed: 500,
    networkPolicy: {
      policyVersion: BROWSER_NETWORK_POLICY_VERSION,
      requestInterceptionEnabled: true,
      allRequestUrlsValidated: true,
      privateNetworkRequestsAllowed: 0,
      credentialsUsed: false,
      formSubmissions: 0,
      downloadsAccepted: 0,
      requestsObserved: 8,
      requestsBlocked: 0,
      documentUrls: [url],
    },
    warnings: [],
    outcome: "CAPTURED",
    finalUrl: url,
    screenshotArtifactRef: `artifact:sha256:${screenshotSha}`,
    screenshotSha256: screenshotSha,
    measurementArtifactRef: `artifact:sha256:${measurementSha}`,
    document: mobile
      ? { clientWidth: 390, documentScrollWidth: 390, bodyScrollWidth: 390 }
      : { clientWidth: 1_440, documentScrollWidth: 1_440, bodyScrollWidth: 1_440 },
    actions,
    forms,
    navigation: mobile
      ? { status: "USABLE", probePerformed: true, reasonCodes: [] }
      : { status: "UNKNOWN", probePerformed: false, reasonCodes: [] },
    text: mobile
      ? { readable: true, minimumFontSizePx: 16, measuredTextNodes: 20 }
      : { readable: null, minimumFontSizePx: null, measuredTextNodes: 0 },
    coverage: {
      layoutComplete: true,
      actionsComplete: true,
      formsComplete: true,
      navigationComplete: mobile,
      textComplete: mobile,
    },
    failure: null,
  } as const;
}

function artifactReceipt(evidence: ReturnType<typeof browserEvidence>) {
  const items = [
    {
      kind: "BROWSER_SCREENSHOT" as const,
      artifactRef: evidence.screenshotArtifactRef,
      objectKey: artifactObjectKey("SHADOW_30D", "BROWSER_SCREENSHOT", evidence.screenshotSha256),
      byteLength: 4,
      sha256: evidence.screenshotSha256,
      operation: "CREATED" as const,
      etag: `fixture-${evidence.screenshotSha256.slice(0, 16)}`,
      uploadedAt: CAPTURED_AT,
    },
    {
      kind: "BROWSER_MEASUREMENT" as const,
      artifactRef: evidence.measurementArtifactRef,
      objectKey: artifactObjectKey("SHADOW_30D", "BROWSER_MEASUREMENT", evidence.measurementArtifactRef.slice(-64)),
      byteLength: 100,
      sha256: evidence.measurementArtifactRef.slice(-64),
      operation: "CREATED" as const,
      etag: `fixture-${evidence.measurementArtifactRef.slice(-16)}`,
      uploadedAt: CAPTURED_AT,
    },
  ];
  return {
    contractVersion: ARTIFACT_STORE_CONTRACT_VERSION,
    planId: evidence.captureId,
    workflowId: WORKFLOW_ID,
    mode: "SHADOW",
    storeKind: "FIXTURE",
    providerWritePerformed: false,
    retentionClass: "SHADOW_30D",
    startedAt: CAPTURED_AT,
    completedAt: CAPTURED_AT,
    plannedItemCount: 2,
    fixturePutAttempts: 2,
    fixtureHeadReads: 0,
    providerClassAOperations: 0,
    providerClassBOperations: 0,
    costUsd: 0,
    rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS",
    outcome: "COMPLETED",
    items,
    failure: null,
  } as const;
}

function pageInput(
  pageKind: "HOME" | "SERVICE" | "ABOUT" | "CONTACT",
  path: string,
  index: number,
  includeMobile = false,
) {
  const url = new URL(path, "https://fixture-roofing.ca/").href;
  const html = `<html><head><title>${pageKind}</title></head><body>${pageKind}</body></html>`;
  const browser = [browserEvidence(pageKind, url, index, "desktop")];
  if (includeMobile) browser.push(browserEvidence(pageKind, url, index, "mobile"));
  const actions = pageKind === "HOME" ? [
    { kind: "PHONE", label: "Call now", href: "tel:+15195550199", notExplicitlyHidden: true, aboveFold: "UNKNOWN" },
    { kind: "QUOTE", label: "Request a quote", href: "https://fixture-roofing.ca/contact", notExplicitlyHidden: true, aboveFold: "UNKNOWN" },
  ] : [];
  const forms = pageKind === "CONTACT" ? [{
    actionUrl: "https://fixture-roofing.ca/contact",
    method: "POST",
    notExplicitlyHidden: true,
    hasEnabledSubmitControl: true,
  }] : [];
  const visibleText = pageKind === "HOME"
    ? "Fixture Roofing provides roof repair in Kitchener."
    : pageKind === "SERVICE" ? "Roof repair and replacement services."
      : pageKind === "ABOUT" ? "Our experienced local roofing team."
        : "Contact Fixture Roofing for a quote.";
  return {
    pageKind,
    capture: {
      captureVersion: WEBSITE_CAPTURE_VERSION,
      policy: { maxRedirects: 5, maxResponseBytes: 1_048_576, timeoutMs: 10_000 },
      capturedAt: CAPTURED_AT,
      requestedUrl: url,
      finalUrl: url,
      statusCode: 200,
      redirectCount: 0,
      redirectChain: [url],
      outcome: "CAPTURED",
      contentType: "text/html",
      bodyBytes: new TextEncoder().encode(html).byteLength,
      html,
      failure: null,
    },
    html: {
      extractorVersion: HTML_PAGE_FACTS_VERSION,
      captureVersion: WEBSITE_CAPTURE_VERSION,
      capturedAt: CAPTURED_AT,
      pageKind,
      url,
      title: `${pageKind} | Fixture Roofing`,
      metaDescription: `${pageKind} information for Fixture Roofing.`,
      visibleText,
      actions,
      forms,
      trustSignals: pageKind === "HOME" ? ["REVIEW", "PROJECT_GALLERY"] : pageKind === "ABOUT" ? ["TEAM"] : [],
      structuredDataTypes: pageKind === "HOME" ? ["RoofingContractor"] : [],
      discoveredInternalLinks: [],
      complete: true,
      warnings: [],
      policy: { maxTokens: 50_000, maxTextChars: 100_000, maxJsonLdChars: 100_000 },
      tokenCount: 100,
    },
    browser,
    artifactReceipts: browser.map(artifactReceipt),
  } as unknown as WebsiteAuditAssemblyRequest["pages"][number];
}

function unavailablePage(pageKind: "HOME" | "SERVICE" | "ABOUT" | "CONTACT", path: string) {
  const url = new URL(path, "https://fixture-roofing.ca/").href;
  return {
    pageKind,
    capture: {
      captureVersion: WEBSITE_CAPTURE_VERSION,
      policy: { maxRedirects: 5, maxResponseBytes: 1_048_576, timeoutMs: 10_000 },
      capturedAt: CAPTURED_AT,
      requestedUrl: url,
      finalUrl: null,
      statusCode: 503,
      redirectCount: 0,
      redirectChain: [url],
      outcome: "FAILED",
      contentType: "text/html",
      bodyBytes: 0,
      html: null,
      failure: { code: "HTTP_STATUS", message: "Synthetic unavailable page." },
    },
    html: null,
    browser: [],
    artifactReceipts: [],
  } as unknown as WebsiteAuditAssemblyRequest["pages"][number];
}

function request(pages = [
  pageInput("CONTACT", "/contact", 4),
  pageInput("HOME", "/", 1, true),
  pageInput("SERVICE", "/roof-repair", 2),
  pageInput("ABOUT", "/about", 3),
]): WebsiteAuditAssemblyRequest {
  return {
    assemblyVersion: WEBSITE_AUDIT_ASSEMBLY_VERSION,
    assemblyId: ASSEMBLY_ID,
    workflowId: WORKFLOW_ID,
    assembledAt: ASSEMBLED_AT,
    mode: "SHADOW",
    assemblerKind: "FIXTURE",
    maxCostUsd: 0,
    businessId: BUSINESS_ID,
    businessName: "Fixture Roofing",
    niche: "roofing",
    expectedServices: ["roof repair"],
    expectedLocations: ["Kitchener"],
    sourceEvidenceUrl: "https://source-fixture.ca/business/fixture-roofing",
    policy: defaultWebsiteAuditAssemblyPolicy(),
    pages,
    resourceProbes: [{ url: "https://fixture-roofing.ca/", type: "PAGE", internal: true, statusCode: 200 }],
  } as WebsiteAuditAssemblyRequest;
}

test("complete multi-page evidence assembles deterministically inside a zero-cost business budget", () => {
  const first = assembleWebsiteAuditInput(request());
  const second = assembleWebsiteAuditInput(request([...request().pages].reverse()));
  assert.deepEqual(first, second);
  assert.equal(first.status, "READY");
  assert.equal(first.pageSetComplete, true);
  assert.deepEqual(first.missingRequiredPageKinds, []);
  assert.deepEqual(first.incompleteRequiredPageKinds, []);
  assert.deepEqual(first.auditInput.pages.map((page) => page.kind), ["HOME", "SERVICE", "ABOUT", "CONTACT"]);
  assert.equal(first.budget.browserCaptures, 5);
  assert.equal(first.budget.totalCostUsd, 0);
  assert.equal(first.budget.providerOperations, 0);
  assert.equal(first.auditInput.desktopArtifactRef?.startsWith("artifact:sha256:"), true);
  assert.equal(first.auditInput.mobileArtifactRef?.startsWith("artifact:sha256:"), true);
  const audit = auditWebsiteDeterministically(first.auditInput);
  assert.equal(audit.classification, "NO_OPPORTUNITY");
  assert.equal(audit.evidenceConfidence, 100);
});

test("missing or unavailable required pages keep absence checks unknown", () => {
  const withoutContact = request(request().pages.filter((page) => page.pageKind !== "CONTACT"));
  const missing = assembleWebsiteAuditInput(withoutContact);
  assert.equal(missing.status, "PARTIAL");
  assert.deepEqual(missing.missingRequiredPageKinds, ["CONTACT"]);
  const missingAudit = auditWebsiteDeterministically(missing.auditInput);
  assert.equal(missingAudit.checks.find((check) => check.checkId === "form_availability")?.outcome, "UNKNOWN");

  const failed = assembleWebsiteAuditInput(request([
    ...request().pages.filter((page) => page.pageKind !== "CONTACT"),
    unavailablePage("CONTACT", "/contact"),
  ]));
  assert.equal(failed.status, "PARTIAL");
  assert.ok(failed.warnings.some((warning) => warning.startsWith("page_unavailable:CONTACT:")));
  assert.equal(failed.pages.find((page) => page.pageKind === "CONTACT")?.outcome, "FAILED");

  const incompletePages = [...request().pages];
  const aboutIndex = incompletePages.findIndex((page) => page.pageKind === "ABOUT");
  incompletePages[aboutIndex] = {
    ...incompletePages[aboutIndex],
    html: { ...incompletePages[aboutIndex].html!, complete: false, warnings: ["synthetic_incomplete"] },
  };
  const incomplete = assembleWebsiteAuditInput(request(incompletePages));
  assert.deepEqual(incomplete.missingRequiredPageKinds, []);
  assert.deepEqual(incomplete.incompleteRequiredPageKinds, ["ABOUT"]);
});

test("cross-site page contamination is rejected before merge", () => {
  const contaminated = request([
    ...request().pages.filter((page) => page.pageKind !== "SERVICE"),
    pageInput("SERVICE", "https://other-fixture.ca/roof-repair", 2),
  ]);
  assert.throws(() => assembleWebsiteAuditInput(contaminated), /homepage authority/);
});

test("stale or over-budget Browser evidence fails closed", () => {
  assert.throws(
    () => assembleWebsiteAuditInput({ ...request(), assembledAt: "2026-08-24T21:00:00.000Z" }),
    /older than the approved freshness window/,
  );
  const pages = [...request().pages];
  pages[0] = {
    ...pages[0],
    browser: pages[0].browser.map((evidence, index) => index === 0 ? { ...evidence, browserMsUsed: 20_001 } : evidence),
  };
  assert.throws(() => assembleWebsiteAuditInput(request(pages)), /per-capture time limit/);
});

test("Browser references must reconcile to the completed artifact receipt", () => {
  const pages = [...request().pages];
  const first = pages[0];
  pages[0] = {
    ...first,
    browser: first.browser.map((evidence, index) => index === 0 ? {
      ...evidence,
      screenshotArtifactRef: `artifact:sha256:${"f".repeat(64)}`,
    } : evidence) as WebsiteAuditAssemblyRequest["pages"][number]["browser"],
  };
  assert.throws(() => assembleWebsiteAuditInput(request(pages)), /must match its completed artifact receipt/);
});
