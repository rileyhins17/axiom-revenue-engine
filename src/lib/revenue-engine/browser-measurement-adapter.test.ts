import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_MEASUREMENT_ADAPTER_VERSION,
  BrowserMeasurementRequestSchema,
  createBrowserMeasurementDraft,
  defaultBrowserMeasurementPolicy,
  finalizeBrowserMeasurementDraft,
  type BrowserMeasurementRequest,
  type BrowserMeasurementRunner,
} from "@/lib/revenue-engine/browser-measurement-adapter";
import { BROWSER_NETWORK_POLICY_VERSION } from "@/lib/revenue-engine/browser-page-evidence";

const PAGE_URL = "https://fixture-roofing.ca/";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const WORKFLOW_ID = "22222222-2222-4222-8222-222222222222";
const CAPTURED_AT = "2026-08-22T23:00:00.000Z";

function request(): BrowserMeasurementRequest {
  return BrowserMeasurementRequestSchema.parse({
    adapterVersion: BROWSER_MEASUREMENT_ADAPTER_VERSION,
    requestId: REQUEST_ID,
    workflowId: WORKFLOW_ID,
    businessId: "business:fixture-roofing",
    pageKind: "HOME",
    requestedUrl: PAGE_URL,
    profile: "DESKTOP_1440X900",
    viewport: { width: 1_440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    requestedAt: CAPTURED_AT,
    mode: "SHADOW",
    runnerKind: "FIXTURE",
    maxCostUsd: 0,
    artifactWriteAuthorized: false,
    policy: defaultBrowserMeasurementPolicy(),
  });
}

function networkPolicy() {
  return {
    policyVersion: BROWSER_NETWORK_POLICY_VERSION,
    requestInterceptionEnabled: true as const,
    allRequestUrlsValidated: true as const,
    privateNetworkRequestsAllowed: 0 as const,
    credentialsUsed: false as const,
    formSubmissions: 0 as const,
    downloadsAccepted: 0 as const,
    requestsObserved: 12,
    requestsBlocked: 1,
    documentUrls: [PAGE_URL],
  };
}

function capturedRaw(overrides: Record<string, unknown> = {}) {
  return {
    provider: "CLOUDFLARE_BROWSER_RENDERING",
    providerRequestId: "fixture-request-1",
    browserMsUsed: 750,
    networkPolicy: networkPolicy(),
    warnings: [],
    outcome: "CAPTURED",
    finalUrl: PAGE_URL,
    redirectChain: [PAGE_URL],
    screenshotMediaType: "image/webp",
    screenshotBytes: new Uint8Array([1, 2, 3, 4]),
    measurements: {
      document: { clientWidth: 1_440, documentScrollWidth: 1_440, bodyScrollWidth: 1_440 },
      actions: [{
        actionId: "quote:desktop",
        kind: "QUOTE",
        label: "Request a quote",
        href: "https://fixture-roofing.ca/contact",
        visible: true,
        enabled: true,
        boundingBox: { x: 20, y: 100, width: 160, height: 44 },
      }],
      forms: [],
      navigation: { status: "UNKNOWN", probePerformed: false, reasonCodes: [] },
      text: { readable: null, minimumFontSizePx: null, measuredTextNodes: 0 },
      coverage: {
        layoutComplete: true,
        actionsComplete: true,
        formsComplete: true,
        navigationComplete: false,
        textComplete: false,
      },
    },
    failure: null,
    ...overrides,
  };
}

function runner(value: unknown, onRun?: () => void): BrowserMeasurementRunner {
  return {
    kind: "FIXTURE",
    async run() {
      onRun?.();
      return value;
    },
  };
}

test("fake runner produces bounded unpersisted artifacts before any write is authorized", async () => {
  let calls = 0;
  const draft = await createBrowserMeasurementDraft(request(), {
    runner: runner(capturedRaw(), () => { calls += 1; }),
    now: () => new Date(CAPTURED_AT),
  });
  assert.equal(calls, 1);
  assert.equal(draft.outcome, "CAPTURED");
  if (draft.outcome !== "CAPTURED") return;
  assert.equal(draft.artifactWriteAuthorized, false);
  assert.equal(draft.costUsd, 0);
  assert.equal(draft.screenshot.byteLength, 4);
  assert.match(draft.screenshot.sha256, /^[a-f0-9]{64}$/);
  assert.match(draft.measurement.sha256, /^[a-f0-9]{64}$/);
  assert.ok(draft.measurement.byteLength > 0);
  await assert.rejects(
    Promise.resolve().then(() => finalizeBrowserMeasurementDraft(draft, null)),
    /require both persisted artifact references/,
  );

  const evidence = finalizeBrowserMeasurementDraft(draft, {
    screenshotArtifactRef: `artifact:sha256:${draft.screenshot.sha256}`,
    measurementArtifactRef: `artifact:sha256:${draft.measurement.sha256}`,
  });
  assert.equal(evidence.outcome, "CAPTURED");
  assert.equal(evidence.screenshotSha256, draft.screenshot.sha256);
  assert.equal(evidence.networkPolicy.privateNetworkRequestsAllowed, 0);
  assert.equal(evidence.coverage.actionsComplete, true);

  assert.throws(
    () => finalizeBrowserMeasurementDraft(draft, {
      screenshotArtifactRef: "artifact:sha256:wrong",
      measurementArtifactRef: `artifact:sha256:${draft.measurement.sha256}`,
    }),
    /must match the draft content hashes/,
  );

  draft.screenshot.bytes[0] = 255;
  assert.throws(
    () => finalizeBrowserMeasurementDraft(draft, {
      screenshotArtifactRef: `artifact:sha256:${draft.screenshot.sha256}`,
      measurementArtifactRef: `artifact:sha256:${draft.measurement.sha256}`,
    }),
    /artifact integrity check failed/,
  );
});

test("failure result remains evidence-safe and cannot receive success artifacts", async () => {
  const draft = await createBrowserMeasurementDraft(request(), {
    runner: runner({
      provider: "CLOUDFLARE_BROWSER_RENDERING",
      providerRequestId: "fixture-failure",
      browserMsUsed: 500,
      networkPolicy: networkPolicy(),
      warnings: ["synthetic_timeout"],
      outcome: "FAILED",
      finalUrl: null,
      redirectChain: [PAGE_URL],
      screenshotMediaType: null,
      screenshotBytes: null,
      measurements: null,
      failure: { code: "TIMEOUT", message: "Synthetic timeout." },
    }),
    now: () => new Date(CAPTURED_AT),
  });
  assert.equal(draft.outcome, "FAILED");
  const evidence = finalizeBrowserMeasurementDraft(draft, null);
  assert.equal(evidence.outcome, "FAILED");
  assert.equal(evidence.screenshotArtifactRef, null);
  assert.throws(
    () => finalizeBrowserMeasurementDraft(draft, {
      screenshotArtifactRef: "artifact:unexpected",
      measurementArtifactRef: "artifact:unexpected",
    }),
    /cannot receive successful artifact/,
  );
});

test("request validation fails before the runner for non-public or inconsistent viewport input", async () => {
  let calls = 0;
  const fakeRunner = runner(capturedRaw(), () => { calls += 1; });
  await assert.rejects(
    createBrowserMeasurementDraft({ ...request(), requestedUrl: "http://127.0.0.1/" }, { runner: fakeRunner }),
    /IP-address website targets|public URL/i,
  );
  await assert.rejects(
    createBrowserMeasurementDraft({
      ...request(),
      viewport: { width: 1_024, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    }, { runner: fakeRunner }),
    /fixed comparison viewport/,
  );
  assert.equal(calls, 0);
});

test("private redirects and unverifiable navigation receipts fail closed", async () => {
  await assert.rejects(
    createBrowserMeasurementDraft(request(), {
      runner: runner(capturedRaw({
        finalUrl: "http://127.0.0.1/",
        redirectChain: [PAGE_URL, "http://127.0.0.1/"],
        networkPolicy: { ...networkPolicy(), documentUrls: [PAGE_URL, "http://127.0.0.1/"] },
      })),
    }),
    /IP-address website targets|public URL/i,
  );
  await assert.rejects(
    createBrowserMeasurementDraft(request(), {
      runner: runner(capturedRaw({
        redirectChain: [PAGE_URL],
        networkPolicy: { ...networkPolicy(), documentUrls: [PAGE_URL, "https://fixture-roofing.ca/other"] },
      })),
    }),
    /does not match its validated redirect receipt/,
  );
  await assert.rejects(
    createBrowserMeasurementDraft(request(), {
      runner: runner(capturedRaw({
        networkPolicy: { ...networkPolicy(), allRequestUrlsValidated: false },
      })),
    }),
  );
});

test("browser time and screenshot payload limits reject provider drift", async () => {
  await assert.rejects(
    createBrowserMeasurementDraft(request(), {
      runner: runner(capturedRaw({ browserMsUsed: 20_001 })),
    }),
    /browser-time limit/,
  );
  await assert.rejects(
    createBrowserMeasurementDraft(request(), {
      runner: runner(capturedRaw({ screenshotBytes: new Uint8Array() })),
    }),
    /empty or exceeds/,
  );
});
