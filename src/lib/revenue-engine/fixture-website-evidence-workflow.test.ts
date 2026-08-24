import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserMeasurementRequest,
  BrowserMeasurementRunner,
} from "@/lib/revenue-engine/browser-measurement-adapter";
import { BROWSER_NETWORK_POLICY_VERSION } from "@/lib/revenue-engine/browser-page-evidence";
import type {
  FixtureArtifactStore,
  FixturePutRequest,
} from "@/lib/revenue-engine/content-addressed-artifact-store";
import {
  FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
  runFixtureWebsiteEvidenceWorkflow,
  type FixtureWebsiteDocumentCapture,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";
import {
  WEBSITE_CAPTURE_MAX_REDIRECTS,
  WEBSITE_CAPTURE_MAX_RESPONSE_BYTES,
  WEBSITE_CAPTURE_TIMEOUT_MS,
  WEBSITE_CAPTURE_VERSION,
  type WebsiteCaptureResult,
} from "@/lib/revenue-engine/website-capture";

const HOME_URL = "https://fixture-roofing.ca/";
const SERVICE_URL = "https://fixture-roofing.ca/roof-repair";
const ABOUT_URL = "https://fixture-roofing.ca/about";
const CONTACT_URL = "https://fixture-roofing.ca/contact";
const SOURCE_URL = "https://source-fixture.ca/business/fixture-roofing";
const WORKFLOW_ID = "22222222-2222-4222-8222-222222222222";
const RUN_AT = "2026-08-22T23:45:00.000Z";

const homeHtml = `<!doctype html><html><head>
  <title>Fixture Roofing | Roof Repair in Kitchener</title>
  <meta name="description" content="Licensed Kitchener roof repair and replacement with a workmanship warranty.">
  <script type="application/ld+json">{"@type":"RoofingContractor"}</script>
  </head><body>
  <header><nav>
    <a href="/roof-repair">Roof Repair Services</a>
    <a href="/about">About Our Team</a>
    <a href="/contact">Request a Quote</a>
  </nav></header>
  <main><h1>Roof repair and replacement in Kitchener</h1>
    <p>Licensed local roofing team with verified reviews, project gallery, warranty, and a clear process.</p>
    <a href="tel:+15195550199">Call now</a>
    <a href="/contact">Request a quote</a>
  </main></body></html>`;

const serviceHtml = `<!doctype html><html><head>
  <title>Roof Repair Services | Fixture Roofing</title>
  <meta name="description" content="Roof repair and roof replacement services in Kitchener.">
  </head><body><main><h1>Roof Repair Services</h1>
  <p>We provide roof repair and roof replacement in Kitchener.</p>
  <a href="/contact">Request a quote</a></main></body></html>`;

const aboutHtml = `<!doctype html><html><head>
  <title>About Our Local Roofing Team | Fixture Roofing</title>
  <meta name="description" content="Meet our licensed Kitchener roofing team.">
  </head><body><main><h1>About Our Team</h1>
  <p>Meet the team. Our licensed and certified roofers back their work with a warranty.</p>
  </main></body></html>`;

const contactHtml = `<!doctype html><html><head>
  <title>Contact Fixture Roofing</title>
  <meta name="description" content="Request a roofing quote in Kitchener.">
  </head><body><main><h1>Contact Fixture Roofing</h1>
  <form action="/contact" method="post"><label>Name <input name="name"></label>
  <button type="submit">Request a quote</button></form></main></body></html>`;

function capturePolicy() {
  return {
    maxRedirects: WEBSITE_CAPTURE_MAX_REDIRECTS,
    maxResponseBytes: WEBSITE_CAPTURE_MAX_RESPONSE_BYTES,
    timeoutMs: WEBSITE_CAPTURE_TIMEOUT_MS,
  };
}

function captured(url: string, html: string): WebsiteCaptureResult {
  return {
    captureVersion: WEBSITE_CAPTURE_VERSION,
    policy: capturePolicy(),
    capturedAt: RUN_AT,
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
  };
}

function unavailable(url: string): WebsiteCaptureResult {
  return {
    captureVersion: WEBSITE_CAPTURE_VERSION,
    policy: capturePolicy(),
    capturedAt: RUN_AT,
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
  };
}

function captureHarness(overrides: Partial<Record<string, WebsiteCaptureResult>> = {}) {
  const results = new Map<string, WebsiteCaptureResult>([
    [HOME_URL, captured(HOME_URL, homeHtml)],
    [SERVICE_URL, captured(SERVICE_URL, serviceHtml)],
    [ABOUT_URL, captured(ABOUT_URL, aboutHtml)],
    [CONTACT_URL, captured(CONTACT_URL, contactHtml)],
  ]);
  for (const [url, result] of Object.entries(overrides)) {
    if (result) results.set(url, result);
  }
  const requests: string[] = [];
  const capture: FixtureWebsiteDocumentCapture = {
    kind: "FIXTURE",
    async capture(requestedUrl) {
      requests.push(requestedUrl);
      const result = results.get(requestedUrl);
      if (!result) throw new Error(`Missing fixture capture for ${requestedUrl}.`);
      return result;
    },
  };
  return { capture, requests };
}

function networkPolicy(url: string) {
  return {
    policyVersion: BROWSER_NETWORK_POLICY_VERSION,
    requestInterceptionEnabled: true as const,
    allRequestUrlsValidated: true as const,
    privateNetworkRequestsAllowed: 0 as const,
    credentialsUsed: false as const,
    formSubmissions: 0 as const,
    downloadsAccepted: 0 as const,
    requestsObserved: 8,
    requestsBlocked: 0,
    documentUrls: [url],
  };
}

function capturedBrowser(request: BrowserMeasurementRequest) {
  const mobile = request.profile === "MOBILE_390X844";
  const actions = request.pageKind === "HOME" ? [
    {
      actionId: `phone:${request.profile}`,
      kind: "PHONE" as const,
      label: "Call now",
      href: "tel:+15195550199",
      visible: true,
      enabled: true,
      boundingBox: { x: 20, y: 100, width: 120, height: 48 },
    },
    {
      actionId: `quote:${request.profile}`,
      kind: "QUOTE" as const,
      label: "Request a quote",
      href: CONTACT_URL,
      visible: true,
      enabled: true,
      boundingBox: { x: 20, y: 180, width: 180, height: 48 },
    },
  ] : [];
  const forms = request.pageKind === "CONTACT" ? [{
    formId: `contact:${request.profile}`,
    actionUrl: CONTACT_URL,
    method: "POST" as const,
    visible: true,
    hasSubmitControl: true,
    disabled: false,
    boundingBox: { x: 20, y: 300, width: 320, height: 400 },
  }] : [];
  return {
    provider: "CLOUDFLARE_BROWSER_RENDERING" as const,
    providerRequestId: `fixture:${request.requestId}`,
    browserMsUsed: 500,
    networkPolicy: networkPolicy(request.requestedUrl),
    warnings: [],
    outcome: "CAPTURED" as const,
    finalUrl: request.requestedUrl,
    redirectChain: [request.requestedUrl],
    screenshotMediaType: "image/webp" as const,
    screenshotBytes: new TextEncoder().encode(`${request.pageKind}:${request.profile}`),
    measurements: {
      document: mobile
        ? { clientWidth: 390, documentScrollWidth: 390, bodyScrollWidth: 390 }
        : { clientWidth: 1_440, documentScrollWidth: 1_440, bodyScrollWidth: 1_440 },
      actions,
      forms,
      navigation: mobile
        ? { status: "USABLE" as const, probePerformed: true, reasonCodes: [] }
        : { status: "UNKNOWN" as const, probePerformed: false, reasonCodes: [] },
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
    },
    failure: null,
  };
}

function browserHarness(options: { failMobileHome?: boolean } = {}) {
  const requests: BrowserMeasurementRequest[] = [];
  const browserRunner: BrowserMeasurementRunner = {
    kind: "FIXTURE",
    async run(request) {
      requests.push(request);
      if (options.failMobileHome && request.pageKind === "HOME" && request.profile === "MOBILE_390X844") {
        return {
          provider: "CLOUDFLARE_BROWSER_RENDERING",
          providerRequestId: `fixture:${request.requestId}`,
          browserMsUsed: 500,
          networkPolicy: networkPolicy(request.requestedUrl),
          warnings: ["synthetic_mobile_timeout"],
          outcome: "FAILED",
          finalUrl: null,
          redirectChain: [request.requestedUrl],
          screenshotMediaType: null,
          screenshotBytes: null,
          measurements: null,
          failure: { code: "TIMEOUT", message: "Synthetic mobile timeout." },
        };
      }
      return capturedBrowser(request);
    },
  };
  return { browserRunner, requests };
}

function storedObject(request: FixturePutRequest) {
  return {
    objectKey: request.objectKey,
    byteLength: request.byteLength,
    sha256: request.sha256,
    etag: `fixture-${request.sha256.slice(0, 32)}`,
    uploadedAt: RUN_AT,
    storageClass: request.storageClass,
    httpMetadata: request.httpMetadata,
    customMetadata: request.customMetadata,
  };
}

function artifactHarness(options: { failOnAttempt?: number } = {}) {
  const objects = new Map<string, ReturnType<typeof storedObject>>();
  let putAttempts = 0;
  let headReads = 0;
  const artifactStore: FixtureArtifactStore = {
    kind: "FIXTURE",
    async putIfAbsent(request) {
      putAttempts += 1;
      if (putAttempts === options.failOnAttempt) throw new Error("Synthetic fixture artifact failure.");
      if (objects.has(request.objectKey)) return { outcome: "ALREADY_EXISTS", object: null };
      const object = storedObject(request);
      objects.set(request.objectKey, object);
      return { outcome: "CREATED", object };
    },
    async head(objectKey) {
      headReads += 1;
      return objects.get(objectKey) ?? null;
    },
  };
  return {
    artifactStore,
    objects,
    get putAttempts() { return putAttempts; },
    get headReads() { return headReads; },
  };
}

function workflowRequest() {
  return {
    workflowVersion: FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
    workflowId: WORKFLOW_ID,
    idempotencyKey: "fixture-roofing:audit:2026-08-22",
    businessId: "business:fixture-roofing",
    businessName: "Fixture Roofing",
    niche: "roofing",
    expectedServices: ["roof repair", "roof replacement"],
    expectedLocations: ["Kitchener"],
    websiteUrl: HOME_URL,
    sourceEvidenceUrl: SOURCE_URL,
    requestedAt: RUN_AT,
    mode: "SHADOW",
    orchestratorKind: "FIXTURE",
    maxCostUsd: 0,
    resourceProbes: [{ url: HOME_URL, type: "PAGE", internal: true, statusCode: 200 }],
  } as const;
}

test("complete workflow composes all eight zero-cost evidence checkpoints", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
  });

  assert.equal(receipt.status, "COMPLETED");
  assert.equal(receipt.sitePath, "CAPTURED");
  assert.equal(receipt.pageSelection?.status, "READY");
  assert.equal(receipt.auditAssembly?.status, "READY");
  assert.equal(receipt.audit?.classification, "NO_OPPORTUNITY");
  assert.equal(receipt.artifactManifests.length, 5);
  assert.deepEqual(
    receipt.artifactManifests.map((manifest) => manifest.manifestId).sort(),
    receipt.pages.flatMap((page) => page.artifactReceiptIds).sort(),
  );
  assert.deepEqual(receipt.pages.map((page) => page.pageKind), ["HOME", "SERVICE", "ABOUT", "CONTACT"]);
  assert.equal(capture.requests.length, 4);
  assert.equal(browser.requests.length, 5);
  assert.equal(artifacts.putAttempts, 10);
  assert.equal(receipt.budget.providerOperations, 0);
  assert.equal(receipt.budget.totalCostUsd, 0);
  assert.deepEqual(receipt.steps.map((step) => step.step), [
    "CAPTURE_HOME", "EXTRACT_HOME", "SELECT_PAGES", "CAPTURE_SUBPAGES",
    "MEASURE_BROWSER", "STORE_ARTIFACTS", "ASSEMBLE_AUDIT", "RUN_AUDIT",
  ]);
  assert.ok(receipt.steps.every((step) => step.status === "SUCCEEDED"));
});

test("retry reuses content-addressed objects and preserves the business result", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const dependencies = {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
  };
  const first = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), dependencies);
  const readsBeforeRetry = artifacts.headReads;
  const second = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), dependencies);

  assert.deepEqual(second.pageSelection, first.pageSelection);
  assert.deepEqual(second.auditAssembly, first.auditAssembly);
  assert.deepEqual(second.audit, first.audit);
  assert.deepEqual(second.artifactManifests, first.artifactManifests);
  assert.equal(second.status, "COMPLETED");
  assert.equal(artifacts.putAttempts, 20);
  assert.equal(artifacts.headReads - readsBeforeRetry, 10);
  assert.equal(artifacts.objects.size <= 10, true);
  assert.equal(second.budget.providerOperations, 0);
});

test("an unavailable selected page stays partial and cannot become a false missing-form claim", async () => {
  const capture = captureHarness({ [CONTACT_URL]: unavailable(CONTACT_URL) });
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
  });

  assert.equal(receipt.status, "PARTIAL");
  assert.equal(receipt.sitePath, "CAPTURED");
  assert.equal(receipt.auditAssembly?.status, "PARTIAL");
  assert.equal(receipt.pages.find((page) => page.pageKind === "CONTACT")?.captureOutcome, "FAILED");
  assert.equal(receipt.audit?.checks.find((check) => check.checkId === "form_availability")?.outcome, "UNKNOWN");
  assert.equal(receipt.steps.find((step) => step.step === "CAPTURE_SUBPAGES")?.status, "PARTIAL");
});

test("a mobile Browser failure remains unknown evidence instead of a mobile defect", async () => {
  const capture = captureHarness();
  const browser = browserHarness({ failMobileHome: true });
  const artifacts = artifactHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
  });

  assert.equal(receipt.status, "PARTIAL");
  assert.equal(receipt.auditAssembly?.status, "PARTIAL");
  for (const checkId of ["mobile_overflow", "mobile_navigation", "mobile_readability", "mobile_tap_targets"]) {
    assert.equal(receipt.audit?.checks.find((check) => check.checkId === checkId)?.outcome, "UNKNOWN");
  }
  assert.ok(receipt.audit?.manualReviewReasons.some((reason) => reason.includes("mobile")));
  assert.equal(receipt.pages[0].browserProfilesAttempted.length, 2);
  assert.equal(receipt.pages[0].browserProfilesCaptured.length, 1);
});

test("an unreachable homepage takes the bounded unavailable-site path", async () => {
  const capture = captureHarness({ [HOME_URL]: unavailable(HOME_URL) });
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
  });

  assert.equal(receipt.status, "COMPLETED");
  assert.equal(receipt.sitePath, "UNREACHABLE");
  assert.equal(receipt.audit?.classification, "REBUILD");
  assert.equal(receipt.pageSelection, null);
  assert.equal(receipt.auditAssembly, null);
  assert.equal(capture.requests.length, 1);
  assert.equal(browser.requests.length, 0);
  assert.equal(artifacts.putAttempts, 0);
  assert.equal(receipt.steps.find((step) => step.step === "CAPTURE_HOME")?.status, "PARTIAL");
  assert.equal(receipt.steps.find((step) => step.step === "RUN_AUDIT")?.status, "SUCCEEDED");
});

test("artifact persistence failure publishes no audit and a retry reuses the orphan", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness({ failOnAttempt: 2 });
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
  });

  assert.equal(receipt.status, "FAILED");
  assert.equal(receipt.failure?.step, "STORE_ARTIFACTS");
  assert.equal(receipt.audit, null);
  assert.equal(receipt.auditAssembly, null);
  assert.equal(receipt.budget.providerOperations, 0);
  assert.equal(receipt.steps.find((step) => step.step === "STORE_ARTIFACTS")?.status, "FAILED");
  assert.equal(receipt.steps.find((step) => step.step === "RUN_AUDIT")?.status, "SKIPPED");

  const retry = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
  });
  assert.equal(retry.status, "COMPLETED");
  assert.equal(retry.audit?.classification, "NO_OPPORTUNITY");
  assert.ok(artifacts.headReads >= 1);
  assert.equal(retry.budget.providerOperations, 0);
});

test("mismatched capture identity fails closed before any Browser attempt", async () => {
  const capture = captureHarness({
    [HOME_URL]: captured("https://fixture-roofing.ca/wrong", homeHtml),
  });
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
  });

  assert.equal(receipt.status, "FAILED");
  assert.equal(receipt.failure?.step, "CAPTURE_HOME");
  assert.match(receipt.failure?.message || "", /does not match/);
  assert.equal(browser.requests.length, 0);
  assert.equal(artifacts.putAttempts, 0);
});
