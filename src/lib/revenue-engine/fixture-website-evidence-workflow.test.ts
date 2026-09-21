import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  type FixtureWebsiteEvidenceArtifactObservation,
  type FixtureWebsiteEvidenceCheckpointObservation,
  type FixtureWebsiteEvidenceCheckpointSink,
  type FixtureWebsiteEvidenceWorkflowRequest,
  type FixtureWebsiteDocumentCapture,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";
import {
  FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION,
  FIXTURE_WEBSITE_EVIDENCE_DELIVERY_VERSION,
  FIXTURE_WEBSITE_EVIDENCE_LEASE_VERSION,
  FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION,
  buildFixtureWebsiteEvidenceResumePlan,
  createFixtureArtifactRecoveryRecord,
  createFixtureWebsiteEvidenceCheckpointChain,
  createFixtureWebsiteEvidenceCheckpointCommit,
  createFixtureWorkflowReceiptRevision,
  currentFixtureWebsiteEvidenceDefinition,
  fixtureWebsiteEvidenceRequestDigest,
  type FixtureWorkflowAttemptSnapshot,
  type FixtureWorkflowDeliveryRecord,
  type FixtureWorkflowLeaseClaim,
} from "@/lib/revenue-engine/fixture-website-evidence-resume-plan";
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

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function exactDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

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
  const rawBytes = new TextEncoder().encode(html);
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
    bodyBytes: rawBytes.byteLength,
    rawBytes,
    contentDigest: createHash("sha256").update(rawBytes).digest("hex"),
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

function workflowRequest(): FixtureWebsiteEvidenceWorkflowRequest {
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
  };
}

function checkpointHarness() {
  const checkpoints: FixtureWebsiteEvidenceCheckpointObservation[] = [];
  const artifacts: FixtureWebsiteEvidenceArtifactObservation[] = [];
  const checkpointSink: FixtureWebsiteEvidenceCheckpointSink = {
    kind: "FIXTURE",
    async commit(observation) {
      checkpoints.push(observation);
    },
    async recordArtifactAttempt(observation) {
      artifacts.push(observation);
    },
  };
  return { checkpointSink, checkpoints, artifacts };
}

function delivery(receivedAt = RUN_AT): FixtureWorkflowDeliveryRecord {
  const request = workflowRequest();
  const definition = currentFixtureWebsiteEvidenceDefinition();
  const requestDigest = fixtureWebsiteEvidenceRequestDigest(request);
  return {
    deliveryVersion: FIXTURE_WEBSITE_EVIDENCE_DELIVERY_VERSION,
    deliveryId: "delivery:fixture-roofing:2026-08-22",
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    payloadDigest: requestDigest,
    receivedAt,
    mode: "SHADOW",
    deliveryKind: "FIXTURE",
  };
}

function attempt(options: {
  attemptNumber?: number;
  fencingToken?: number;
  attemptId?: string;
  status?: "RUNNING" | "FAILED" | "SEALED" | "ABANDONED";
  startedAt?: string;
  endedAt?: string | null;
  terminalReceiptId?: string | null;
  deliveryId?: string;
} = {}): FixtureWorkflowAttemptSnapshot {
  const request = workflowRequest();
  const definition = currentFixtureWebsiteEvidenceDefinition();
  const status = options.status ?? "RUNNING";
  return {
    attemptVersion: FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION,
    attemptId: options.attemptId ?? "33333333-3333-4333-8333-333333333333",
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: definition.definitionDigest,
    requestDigest: fixtureWebsiteEvidenceRequestDigest(request),
    deliveryId: options.deliveryId ?? delivery().deliveryId,
    attemptNumber: options.attemptNumber ?? 1,
    fencingToken: options.fencingToken ?? 1,
    status,
    startedAt: options.startedAt ?? "2026-08-22T23:43:00.000Z",
    endedAt: status === "RUNNING" ? null : options.endedAt ?? "2026-08-22T23:45:01.000Z",
    terminalReceiptId: status === "SEALED" ? options.terminalReceiptId ?? null : null,
  };
}

function lease(record: FixtureWorkflowAttemptSnapshot, options: {
  leaseId?: string;
  acquiredAt?: string;
  expiresAt?: string;
} = {}): FixtureWorkflowLeaseClaim {
  const request = workflowRequest();
  const definition = currentFixtureWebsiteEvidenceDefinition();
  return {
    leaseVersion: FIXTURE_WEBSITE_EVIDENCE_LEASE_VERSION,
    leaseId: options.leaseId ?? "44444444-4444-4444-8444-444444444444",
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: definition.definitionDigest,
    requestDigest: fixtureWebsiteEvidenceRequestDigest(request),
    attemptId: record.attemptId,
    attemptNumber: record.attemptNumber,
    deliveryId: record.deliveryId,
    ownerId: `fixture-owner-${record.attemptNumber}`,
    fencingToken: record.fencingToken,
    acquiredAt: options.acquiredAt ?? "2026-08-22T23:44:00.000Z",
    expiresAt: options.expiresAt ?? "2026-08-22T23:50:00.000Z",
    mode: "SHADOW",
    leaseKind: "FIXTURE",
  };
}

function resumeRequest(options: {
  plannedAt?: string;
  currentDelivery?: FixtureWorkflowDeliveryRecord;
  persistedDeliveries?: FixtureWorkflowDeliveryRecord[];
  attempts?: FixtureWorkflowAttemptSnapshot[];
  leases?: FixtureWorkflowLeaseClaim[];
  receiptRevisions?: ReturnType<typeof createFixtureWorkflowReceiptRevision>[];
  checkpoints?: ReturnType<typeof createFixtureWebsiteEvidenceCheckpointChain>;
  artifactRecoveries?: ReturnType<typeof createFixtureArtifactRecoveryRecord>[];
} = {}) {
  return {
    resumePlanVersion: FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION,
    plannedAt: options.plannedAt ?? "2026-08-22T23:46:00.000Z",
    mode: "SHADOW",
    plannerKind: "FIXTURE",
    maxCostUsd: 0,
    workflowRequest: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    currentDelivery: options.currentDelivery ?? delivery(),
    persistedDeliveries: options.persistedDeliveries ?? [],
    attempts: options.attempts ?? [],
    leases: options.leases ?? [],
    receiptRevisions: options.receiptRevisions ?? [],
    checkpoints: options.checkpoints ?? [],
    artifactRecoveries: options.artifactRecoveries ?? [],
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

test("non-fixture checkpoint persistence is rejected before capture", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const unsafeSink = {
    kind: "D1",
    async commit() {},
    async recordArtifactAttempt() {},
  } as unknown as FixtureWebsiteEvidenceCheckpointSink;

  await assert.rejects(
    runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
      capture: capture.capture,
      browserRunner: browser.browserRunner,
      artifactStore: artifacts.artifactStore,
      checkpointSink: unsafeSink,
    }),
    /fixture dependencies only/,
  );
  assert.equal(capture.requests.length, 0);
  assert.equal(browser.requests.length, 0);
  assert.equal(artifacts.putAttempts, 0);
});

test("checkpoint sink retains all eight replayable observations and every artifact attempt", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });

  assert.equal(receipt.status, "COMPLETED");
  assert.deepEqual(sink.checkpoints.map((checkpoint) => checkpoint.step), [
    "CAPTURE_HOME", "EXTRACT_HOME", "SELECT_PAGES", "CAPTURE_SUBPAGES",
    "MEASURE_BROWSER", "STORE_ARTIFACTS", "ASSEMBLE_AUDIT", "RUN_AUDIT",
  ]);
  assert.equal(sink.artifacts.length, 5);
  assert.ok(sink.artifacts.every((observation) => observation.receipt.outcome === "COMPLETED"));
  assert.deepEqual(
    sink.artifacts.map((observation) => observation.plan.planId),
    sink.artifacts.map((observation) => observation.receipt.planId),
  );
});

test("checkpoint sink retains the exact failed artifact plan before the workflow fails", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness({ failOnAttempt: 2 });
  const sink = checkpointHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });

  assert.equal(receipt.status, "FAILED");
  assert.deepEqual(sink.checkpoints.map((checkpoint) => checkpoint.step), [
    "CAPTURE_HOME", "EXTRACT_HOME", "SELECT_PAGES", "CAPTURE_SUBPAGES",
  ]);
  assert.equal(sink.artifacts.length, 1);
  assert.equal(sink.artifacts[0].receipt.outcome, "FAILED");
  assert.equal(sink.artifacts[0].receipt.planId, sink.artifacts[0].plan.planId);
  assert.deepEqual(sink.artifacts[0].receipt.items, sink.artifacts[0].plan.items.slice(0, 1).map((item) => ({
    kind: item.kind,
    artifactRef: item.artifactRef,
    objectKey: item.objectKey,
    byteLength: item.byteLength,
    sha256: item.sha256,
    operation: "CREATED",
    etag: `fixture-${item.sha256.slice(0, 32)}`,
    uploadedAt: RUN_AT,
  })));
});

test("unreachable path checkpoints only the homepage evidence and terminal audit", async () => {
  const capture = captureHarness({ [HOME_URL]: unavailable(HOME_URL) });
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });

  assert.equal(receipt.status, "COMPLETED");
  assert.deepEqual(sink.checkpoints.map((checkpoint) => `${checkpoint.sitePath}:${checkpoint.step}`), [
    "UNREACHABLE:CAPTURE_HOME", "UNREACHABLE:RUN_AUDIT",
  ]);
  assert.equal(sink.artifacts.length, 0);
});

test("fresh resume planning proposes a deterministic first fence with zero authority", () => {
  const first = buildFixtureWebsiteEvidenceResumePlan(resumeRequest());
  const second = buildFixtureWebsiteEvidenceResumePlan(resumeRequest());

  assert.equal(first.decision, "REQUEST_FENCED_LEASE");
  assert.equal(first.continuation?.mode, "RESTART_FROM_ZERO");
  assert.equal(first.continuation?.nextStep, "CAPTURE_HOME");
  assert.equal(first.proposedAttempt?.attemptNumber, 1);
  assert.equal(first.proposedAttempt?.requiredFencingToken, 1);
  assert.equal(first.planDigest, second.planDigest);
  assert.equal(first.mutationAuthorized, false);
  assert.equal(first.executionAuthorized, false);
  assert.equal(first.providerOperationsAuthorized, 0);
  assert.equal(first.costAuthorizedUsd, 0);
});

test("an exact duplicate delivery is visible but does not invent another delivery identity", () => {
  const current = delivery();
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    currentDelivery: current,
    persistedDeliveries: [current, current],
  }));

  assert.equal(plan.decision, "REQUEST_FENCED_LEASE");
  assert.equal(plan.summary.deliveries, 1);
  assert.equal(plan.summary.duplicateDelivery, true);
  assert.ok(plan.warnings.some((warning) => warning.includes("duplicate")));
});

test("conflicting content under one delivery ID blocks before execution planning", () => {
  const current = delivery();
  const conflicting = { ...current, receivedAt: "2026-08-22T23:45:01.000Z" };
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    currentDelivery: current,
    persistedDeliveries: [conflicting],
  }));

  assert.equal(plan.decision, "BLOCKED");
  assert.equal(plan.reasonCode, "DELIVERY_IDENTITY_CONFLICT");
  assert.equal(plan.executionAuthorized, false);
});

test("an active fenced lease wins over duplicate delivery and prevents replay", () => {
  const running = attempt();
  const activeLease = lease(running);
  const current = delivery();
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    currentDelivery: current,
    persistedDeliveries: [current],
    attempts: [running],
    leases: [activeLease],
  }));

  assert.equal(plan.decision, "WAIT_ACTIVE_LEASE");
  assert.equal(plan.activeLease?.leaseId, activeLease.leaseId);
  assert.equal(plan.proposedAttempt, null);
  assert.equal(plan.executionAuthorized, false);
});

test("lease expiry is exclusive and proposes a higher fenced takeover", () => {
  const running = attempt();
  const expired = lease(running);
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    plannedAt: expired.expiresAt,
    attempts: [running],
    leases: [expired],
  }));

  assert.equal(plan.decision, "REQUEST_FENCED_TAKEOVER");
  assert.equal(plan.proposedAttempt?.attemptNumber, 2);
  assert.equal(plan.proposedAttempt?.requiredFencingToken, 2);
  assert.equal(plan.continuation?.mode, "RESTART_FROM_ZERO");
});

test("a sealed terminal audit wins over an otherwise unexpired lease", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });
  const provisionalAttempt = attempt();
  const firstRevision = createFixtureWorkflowReceiptRevision({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: provisionalAttempt,
    receipt,
    recordedAt: RUN_AT,
  });
  const sealedAttempt = attempt({ status: "SEALED", terminalReceiptId: firstRevision.receiptId });
  const fencedLease = lease(sealedAttempt);
  const checkpoints = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: sealedAttempt,
    lease: fencedLease,
    observations: sink.checkpoints,
    recordedAt: RUN_AT,
  });
  const recoveries = sink.artifacts.map((observation) => createFixtureArtifactRecoveryRecord({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: sealedAttempt,
    lease: fencedLease,
    observation,
  }));
  const revision = createFixtureWorkflowReceiptRevision({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: sealedAttempt,
    receipt,
    recordedAt: RUN_AT,
  });
  const laterRunningAttempt = attempt({
    attemptId: "77777777-7777-4777-8777-777777777777",
    attemptNumber: 2,
    fencingToken: 2,
    startedAt: "2026-08-22T23:45:10.000Z",
  });
  const laterActiveLease = lease(laterRunningAttempt, {
    leaseId: "88888888-8888-4888-8888-888888888888",
    acquiredAt: "2026-08-22T23:45:20.000Z",
    expiresAt: "2026-08-22T23:50:00.000Z",
  });
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    attempts: [sealedAttempt, laterRunningAttempt],
    leases: [fencedLease, laterActiveLease],
    checkpoints,
    artifactRecoveries: recoveries,
    receiptRevisions: [revision],
  }));

  assert.equal(plan.decision, "RETURN_TERMINAL");
  assert.equal(plan.terminalReceiptId, revision.receiptId);
  assert.equal(plan.terminalReceiptDigest, revision.receiptDigest);
  assert.equal(plan.proposedAttempt, null);
  assert.equal(plan.executionAuthorized, false);
});

test("a failed artifact write resumes from captured subpages with its exact retained plan", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness({ failOnAttempt: 2 });
  const sink = checkpointHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });
  assert.equal(receipt.status, "FAILED");
  const failedAttempt = attempt({ status: "FAILED" });
  const fencedLease = lease(failedAttempt);
  const checkpoints = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: failedAttempt,
    lease: fencedLease,
    observations: sink.checkpoints,
    recordedAt: RUN_AT,
  });
  const recoveries = sink.artifacts.map((observation) => createFixtureArtifactRecoveryRecord({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: failedAttempt,
    lease: fencedLease,
    observation,
  }));
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    plannedAt: fencedLease.expiresAt,
    attempts: [failedAttempt],
    leases: [fencedLease],
    checkpoints,
    artifactRecoveries: recoveries,
  }));

  assert.equal(plan.decision, "REQUEST_FENCED_TAKEOVER");
  assert.equal(plan.continuation?.mode, "RECONCILE_ARTIFACTS");
  assert.equal(plan.continuation?.completedStep, "CAPTURE_SUBPAGES");
  assert.equal(plan.continuation?.nextStep, "MEASURE_BROWSER");
  assert.equal(plan.continuation?.artifactReconciliation.mode, "EXACT_RECORDED_PLANS");
  assert.deepEqual(plan.continuation?.artifactReconciliation.planIds, [sink.artifacts[0].plan.planId]);
  assert.equal(plan.continuation?.artifactReconciliation.objectKeys.length, 2);
  assert.equal(plan.continuation?.artifactReconciliation.rollbackDeletionAuthorized, false);
});

test("deployment interruption after Browser measurement falls back before the side-effect boundary", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });
  const interruptedAttempt = attempt({ status: "FAILED" });
  const fencedLease = lease(interruptedAttempt);
  const checkpoints = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: interruptedAttempt,
    lease: fencedLease,
    observations: sink.checkpoints.slice(0, 5),
    recordedAt: RUN_AT,
  });
  const recoveries = sink.artifacts.map((observation) => createFixtureArtifactRecoveryRecord({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: interruptedAttempt,
    lease: fencedLease,
    observation,
  }));
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    plannedAt: fencedLease.expiresAt,
    attempts: [interruptedAttempt],
    leases: [fencedLease],
    checkpoints,
    artifactRecoveries: recoveries,
  }));

  assert.equal(plan.decision, "REQUEST_FENCED_TAKEOVER");
  assert.equal(plan.continuation?.completedStep, "CAPTURE_SUBPAGES");
  assert.equal(plan.continuation?.nextStep, "MEASURE_BROWSER");
  assert.equal(plan.continuation?.artifactReconciliation.mode, "EXACT_RECORDED_PLANS");
  assert.equal(plan.continuation?.artifactReconciliation.planIds.length, 5);
});

test("a prepared Browser checkpoint without exact write receipts requires full deterministic reconciliation", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });
  const interruptedAttempt = attempt({ status: "FAILED" });
  const fencedLease = lease(interruptedAttempt);
  const committed = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: interruptedAttempt,
    lease: fencedLease,
    observations: sink.checkpoints.slice(0, 4),
    recordedAt: RUN_AT,
  });
  const prepared = createFixtureWebsiteEvidenceCheckpointCommit({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: interruptedAttempt,
    lease: fencedLease,
    observation: sink.checkpoints[4],
    dependencies: [committed[3]],
    commitState: "PREPARED",
    recordedAt: RUN_AT,
  });
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    plannedAt: fencedLease.expiresAt,
    attempts: [interruptedAttempt],
    leases: [fencedLease],
    checkpoints: [...committed, prepared],
  }));

  assert.equal(plan.decision, "REQUEST_FENCED_TAKEOVER");
  assert.equal(plan.continuation?.mode, "RECONCILE_ARTIFACTS");
  assert.equal(plan.continuation?.completedStep, "CAPTURE_SUBPAGES");
  assert.equal(plan.continuation?.artifactReconciliation.mode, "ALL_DETERMINISTIC_PLANS");
  assert.equal(plan.continuation?.artifactReconciliation.rollbackDeletionAuthorized, false);
});

test("checkpoint metadata drift blocks before an unknown payload is parsed", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });
  const interruptedAttempt = attempt({ status: "FAILED" });
  const fencedLease = lease(interruptedAttempt);
  const [checkpoint] = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: interruptedAttempt,
    lease: fencedLease,
    observations: sink.checkpoints.slice(0, 1),
    recordedAt: RUN_AT,
  });
  const drifted = {
    record: { ...checkpoint.record, workflowVersion: "fixture-website-evidence-workflow-v0" },
    payload: { incompatible: true },
  };
  const plan = buildFixtureWebsiteEvidenceResumePlan({
    ...resumeRequest({
      plannedAt: fencedLease.expiresAt,
      attempts: [interruptedAttempt],
      leases: [fencedLease],
    }),
    checkpoints: [drifted],
  });

  assert.equal(plan.decision, "BLOCKED");
  assert.equal(plan.reasonCode, "CHECKPOINT_VERSION_OR_IDENTITY_DRIFT");
});

test("a stale worker checkpoint is rejected after a higher fence was acquired", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });
  const firstAttempt = attempt({ status: "ABANDONED" });
  const firstLease = lease(firstAttempt);
  const checkpoints = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: firstAttempt,
    lease: firstLease,
    observations: sink.checkpoints.slice(0, 1),
    recordedAt: RUN_AT,
  });
  const secondAttempt = attempt({
    attemptId: "55555555-5555-4555-8555-555555555555",
    attemptNumber: 2,
    fencingToken: 2,
    status: "FAILED",
    startedAt: "2026-08-22T23:44:20.000Z",
    endedAt: "2026-08-22T23:44:50.000Z",
  });
  const secondLease = lease(secondAttempt, {
    leaseId: "66666666-6666-4666-8666-666666666666",
    acquiredAt: "2026-08-22T23:44:30.000Z",
    expiresAt: "2026-08-22T23:49:00.000Z",
  });
  const value = resumeRequest({
    plannedAt: "2026-08-22T23:50:00.000Z",
    attempts: [firstAttempt, secondAttempt],
    leases: [firstLease, secondLease],
    checkpoints,
  });
  const plan = buildFixtureWebsiteEvidenceResumePlan(value);
  const reordered = buildFixtureWebsiteEvidenceResumePlan({
    ...value,
    attempts: [...value.attempts].reverse(),
    leases: [...value.leases].reverse(),
  });

  assert.equal(plan.decision, "BLOCKED");
  assert.equal(plan.reasonCode, "STALE_WORKER_CHECKPOINT");
  assert.equal(plan.planDigest, reordered.planDigest);
  assert.equal(plan.executionAuthorized, false);
});

test("current planner blocks a validly digested previous component definition", () => {
  const definition = currentFixtureWebsiteEvidenceDefinition();
  const { definitionDigest: _definitionDigest, ...currentCore } = definition;
  assert.match(_definitionDigest, /^[a-f0-9]{64}$/);
  const driftedCore = {
    ...currentCore,
    componentVersions: { ...currentCore.componentVersions, audit: "deterministic-website-audit-v0" },
  };
  const driftedDefinition = { ...driftedCore, definitionDigest: exactDigest(driftedCore) };
  const plan = buildFixtureWebsiteEvidenceResumePlan({
    ...resumeRequest(),
    definition: driftedDefinition,
    currentDelivery: {
      ...delivery(),
      definitionDigest: driftedDefinition.definitionDigest,
    },
  });

  assert.equal(plan.decision, "BLOCKED");
  assert.equal(plan.reasonCode, "WORKFLOW_DEFINITION_DRIFT");
  assert.equal(plan.executionAuthorized, false);
});

test("a checkpoint missing its direct committed dependency fails closed", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });
  const failedAttempt = attempt({ status: "FAILED" });
  const fencedLease = lease(failedAttempt);
  const checkpoints = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: failedAttempt,
    lease: fencedLease,
    observations: sink.checkpoints.slice(0, 2),
    recordedAt: RUN_AT,
  });
  const broken = [checkpoints[0], {
    ...checkpoints[1],
    record: { ...checkpoints[1].record, dependencies: [] },
  }];
  const plan = buildFixtureWebsiteEvidenceResumePlan({
    ...resumeRequest({
      plannedAt: fencedLease.expiresAt,
      attempts: [failedAttempt],
      leases: [fencedLease],
    }),
    checkpoints: broken,
  });

  assert.equal(plan.decision, "BLOCKED");
  assert.equal(plan.reasonCode, "CHECKPOINT_DEPENDENCY_GRAPH_INVALID");
});

test("full checkpoint payload divergence is detected even when summary output digests agree", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });
  const firstAttempt = attempt({
    status: "FAILED",
    endedAt: "2026-08-22T23:45:10.000Z",
  });
  const firstLease = lease(firstAttempt, { expiresAt: "2026-08-22T23:45:20.000Z" });
  const secondAttempt = attempt({
    attemptId: "99999999-9999-4999-8999-999999999999",
    attemptNumber: 2,
    fencingToken: 2,
    status: "FAILED",
    startedAt: "2026-08-22T23:45:20.000Z",
    endedAt: "2026-08-22T23:46:10.000Z",
  });
  const secondLease = lease(secondAttempt, {
    leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    acquiredAt: "2026-08-22T23:45:30.000Z",
    expiresAt: "2026-08-22T23:49:00.000Z",
  });
  const first = createFixtureWebsiteEvidenceCheckpointCommit({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: firstAttempt,
    lease: firstLease,
    observation: sink.checkpoints[0],
    dependencies: [],
    recordedAt: RUN_AT,
  });
  const captureObservation = sink.checkpoints[0];
  if (captureObservation.step !== "CAPTURE_HOME" || captureObservation.output.outcome !== "CAPTURED") {
    throw new Error("Expected a captured homepage observation.");
  }
  const changedHtml = captureObservation.output.html.replace("Fixture Roofing", "Fixture RoOfing");
  assert.equal(changedHtml.length, captureObservation.output.html.length);
  const second = createFixtureWebsiteEvidenceCheckpointCommit({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: secondAttempt,
    lease: secondLease,
    observation: {
      ...captureObservation,
      completedAt: "2026-08-22T23:46:00.000Z",
      output: { ...captureObservation.output, html: changedHtml },
    },
    dependencies: [],
    recordedAt: "2026-08-22T23:46:00.000Z",
  });
  assert.equal(first.record.outputDigest, second.record.outputDigest);
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    plannedAt: "2026-08-22T23:50:00.000Z",
    attempts: [firstAttempt, secondAttempt],
    leases: [firstLease, secondLease],
    checkpoints: [first, second],
  }));

  assert.equal(plan.decision, "BLOCKED");
  assert.equal(plan.reasonCode, "COMMITTED_CHECKPOINT_DIVERGENCE");
});

test("artifact object-integrity conflicts block instead of becoming retry plans", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness({ failOnAttempt: 2 });
  const sink = checkpointHarness();
  await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });
  const failedAttempt = attempt({ status: "FAILED" });
  const fencedLease = lease(failedAttempt);
  const checkpoints = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: failedAttempt,
    lease: fencedLease,
    observations: sink.checkpoints,
    recordedAt: RUN_AT,
  });
  const observation = sink.artifacts[0];
  assert.equal(observation.receipt.outcome, "FAILED");
  const recovery = createFixtureArtifactRecoveryRecord({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: failedAttempt,
    lease: fencedLease,
    observation: {
      ...observation,
      receipt: {
        ...observation.receipt,
        failure: { ...observation.receipt.failure, code: "EXISTING_OBJECT_MISMATCH" },
      },
    },
  });
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    plannedAt: fencedLease.expiresAt,
    attempts: [failedAttempt],
    leases: [fencedLease],
    checkpoints,
    artifactRecoveries: [recovery],
  }));

  assert.equal(plan.decision, "BLOCKED");
  assert.equal(plan.reasonCode, "ARTIFACT_INTEGRITY_CONFLICT");
  assert.equal(plan.continuation, null);
  assert.equal(plan.executionAuthorized, false);
});

test("created and reused receipts for the same immutable plan remain safely reconcilable", async () => {
  const capture = captureHarness();
  const browser = browserHarness();
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  const dependencies = {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  };
  await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), dependencies);
  await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), dependencies);
  assert.equal(sink.artifacts.length, 10);
  assert.ok(sink.artifacts.slice(0, 5).every((observation) => observation.receipt.outcome === "COMPLETED"));
  assert.ok(sink.artifacts.slice(5).every((observation) => (
    observation.receipt.outcome === "COMPLETED"
    && observation.receipt.items.every((item) => item.operation === "REUSED")
  )));

  const interruptedAttempt = attempt({ status: "FAILED" });
  const fencedLease = lease(interruptedAttempt);
  const checkpoints = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: interruptedAttempt,
    lease: fencedLease,
    observations: sink.checkpoints.slice(0, 4),
    recordedAt: RUN_AT,
  });
  const recoveries = sink.artifacts.map((observation) => createFixtureArtifactRecoveryRecord({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: interruptedAttempt,
    lease: fencedLease,
    observation,
  }));
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    plannedAt: fencedLease.expiresAt,
    attempts: [interruptedAttempt],
    leases: [fencedLease],
    checkpoints,
    artifactRecoveries: recoveries,
  }));

  assert.equal(plan.decision, "REQUEST_FENCED_TAKEOVER");
  assert.equal(plan.continuation?.artifactReconciliation.mode, "EXACT_RECORDED_PLANS");
  assert.equal(plan.continuation?.artifactReconciliation.planIds.length, 5);
});

test("partial evidence audits are terminal business results once sealed", async () => {
  const capture = captureHarness();
  const browser = browserHarness({ failMobileHome: true });
  const artifacts = artifactHarness();
  const sink = checkpointHarness();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: capture.capture,
    browserRunner: browser.browserRunner,
    artifactStore: artifacts.artifactStore,
    checkpointSink: sink.checkpointSink,
  });
  assert.equal(receipt.status, "PARTIAL");
  const provisionalAttempt = attempt();
  const provisionalRevision = createFixtureWorkflowReceiptRevision({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: provisionalAttempt,
    receipt,
    recordedAt: RUN_AT,
  });
  const sealedAttempt = attempt({ status: "SEALED", terminalReceiptId: provisionalRevision.receiptId });
  const fencedLease = lease(sealedAttempt);
  const revision = createFixtureWorkflowReceiptRevision({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: sealedAttempt,
    receipt,
    recordedAt: RUN_AT,
  });
  const plan = buildFixtureWebsiteEvidenceResumePlan(resumeRequest({
    attempts: [sealedAttempt],
    leases: [fencedLease],
    receiptRevisions: [revision],
  }));

  assert.equal(plan.decision, "RETURN_TERMINAL");
  assert.equal(plan.terminalReceiptId, revision.receiptId);
  assert.equal(plan.executionAuthorized, false);
});
