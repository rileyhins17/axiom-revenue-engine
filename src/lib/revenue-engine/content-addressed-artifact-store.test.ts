import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_MEASUREMENT_ADAPTER_VERSION,
  BrowserMeasurementRequestSchema,
  createBrowserMeasurementDraft,
  defaultBrowserMeasurementPolicy,
  finalizeBrowserMeasurementDraft,
  type BrowserMeasurementDraft,
  type BrowserMeasurementRunner,
} from "@/lib/revenue-engine/browser-measurement-adapter";
import { BROWSER_NETWORK_POLICY_VERSION } from "@/lib/revenue-engine/browser-page-evidence";
import {
  ARTIFACT_RETENTION_POLICIES,
  artifactObjectKey,
  browserArtifactRefsFromReceipt,
  createBrowserArtifactWritePlan,
  executeFixtureArtifactWritePlan,
  plannedArtifactLifecycleRules,
  type FixtureArtifactStore,
  type FixturePutRequest,
} from "@/lib/revenue-engine/content-addressed-artifact-store";

const PAGE_URL = "https://fixture-roofing.ca/";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const WORKFLOW_ID = "22222222-2222-4222-8222-222222222222";
const CAPTURED_AT = "2026-08-22T23:30:00.000Z";

function runner(): BrowserMeasurementRunner {
  return {
    kind: "FIXTURE",
    async run() {
      return {
        provider: "CLOUDFLARE_BROWSER_RENDERING",
        providerRequestId: "fixture-artifact-capture",
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
          documentUrls: [PAGE_URL],
        },
        warnings: [],
        outcome: "CAPTURED",
        finalUrl: PAGE_URL,
        redirectChain: [PAGE_URL],
        screenshotMediaType: "image/webp",
        screenshotBytes: new Uint8Array([9, 8, 7, 6]),
        measurements: {
          document: { clientWidth: 1_440, documentScrollWidth: 1_440, bodyScrollWidth: 1_440 },
          actions: [],
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
      };
    },
  };
}

async function capturedDraft(): Promise<BrowserMeasurementDraft> {
  return createBrowserMeasurementDraft(BrowserMeasurementRequestSchema.parse({
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
  }), { runner: runner(), now: () => new Date(CAPTURED_AT) });
}

function storedObject(request: FixturePutRequest, overrides: Record<string, unknown> = {}) {
  return {
    objectKey: request.objectKey,
    byteLength: request.byteLength,
    sha256: request.sha256,
    etag: `fixture-${request.sha256.slice(0, 32)}`,
    uploadedAt: CAPTURED_AT,
    storageClass: request.storageClass,
    httpMetadata: request.httpMetadata,
    customMetadata: request.customMetadata,
    ...overrides,
  };
}

function fixtureStore(options: { failOnAttempt?: number } = {}) {
  const objects = new Map<string, unknown>();
  let putAttempts = 0;
  let headReads = 0;
  const store: FixtureArtifactStore = {
    kind: "FIXTURE",
    async putIfAbsent(request) {
      putAttempts += 1;
      if (putAttempts === options.failOnAttempt) throw new Error("Synthetic fixture write failure.");
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
    store,
    objects,
    get putAttempts() { return putAttempts; },
    get headReads() { return headReads; },
  };
}

test("retention classes use lifecycle-safe prefixes without inventing a CASL expiry", () => {
  assert.deepEqual(ARTIFACT_RETENTION_POLICIES.SHADOW_30D, {
    keyPrefix: "shadow/30d/v1/",
    lifecycleExpirationDays: 30,
    automaticDeletion: true,
    requiresOwnerRelease: false,
  });
  assert.equal(ARTIFACT_RETENTION_POLICIES.QUALIFICATION_180D.lifecycleExpirationDays, 180);
  assert.equal(ARTIFACT_RETENTION_POLICIES.OUTREACH_ACTIVE.lifecycleExpirationDays, null);
  assert.equal(ARTIFACT_RETENTION_POLICIES.OUTREACH_ACTIVE.requiresOwnerRelease, true);
  assert.equal(ARTIFACT_RETENTION_POLICIES.LEGAL_HOLD.automaticDeletion, false);
  assert.deepEqual(plannedArtifactLifecycleRules(), [
    {
      id: "expire-shadow-evidence-after-30-days",
      enabled: true,
      prefix: "shadow/30d/v1/",
      expireAfterDays: 30,
    },
    {
      id: "expire-uncontacted-qualification-evidence-after-180-days",
      enabled: true,
      prefix: "qualification/180d/v1/",
      expireAfterDays: 180,
    },
  ]);
});

test("Browser drafts become deterministic zero-cost shadow artifact plans", async () => {
  const draft = await capturedDraft();
  const first = createBrowserArtifactWritePlan(draft);
  const second = createBrowserArtifactWritePlan(draft);
  assert.deepEqual(first, second);
  assert.equal(first.providerWriteAuthorized, false);
  assert.equal(first.maxCostUsd, 0);
  assert.equal(first.retentionClass, "SHADOW_30D");
  assert.equal(first.items.length, 2);
  assert.ok(first.items.every((item) => item.objectKey.startsWith("shadow/30d/v1/")));
  assert.ok(first.items.every((item) => item.objectKey.includes(`/${item.sha256.slice(0, 2)}/`)));
  assert.ok(first.items.every((item) => item.artifactRef === `artifact:sha256:${item.sha256}`));
  assert.ok(first.items.every((item) => item.httpMetadata.cacheControl === "private, no-store"));
  assert.equal(first.totalBytes, first.items.reduce((sum, item) => sum + item.byteLength, 0));
});

test("fixture persistence can finalize evidence without any provider operation", async () => {
  const draft = await capturedDraft();
  const plan = createBrowserArtifactWritePlan(draft);
  const harness = fixtureStore();
  const receipt = await executeFixtureArtifactWritePlan(plan, {
    store: harness.store,
    now: () => new Date(CAPTURED_AT),
  });
  assert.equal(receipt.outcome, "COMPLETED");
  assert.equal(receipt.providerWritePerformed, false);
  assert.equal(receipt.providerClassAOperations, 0);
  assert.equal(receipt.providerClassBOperations, 0);
  assert.equal(receipt.costUsd, 0);
  assert.deepEqual(receipt.items.map((item) => item.operation), ["CREATED", "CREATED"]);
  assert.equal(harness.objects.size, 2);

  const evidence = finalizeBrowserMeasurementDraft(draft, browserArtifactRefsFromReceipt(plan, receipt));
  assert.equal(evidence.outcome, "CAPTURED");
  assert.equal(evidence.screenshotArtifactRef, `artifact:sha256:${plan.items[0].sha256}`);
  assert.equal(evidence.measurementArtifactRef, `artifact:sha256:${plan.items[1].sha256}`);

  const wrongDigest = "f".repeat(64);
  const contaminated = {
    ...receipt,
    items: receipt.items.map((item, index) => index === 0 ? {
      ...item,
      artifactRef: `artifact:sha256:${wrongDigest}`,
      objectKey: artifactObjectKey("SHADOW_30D", item.kind, wrongDigest),
      sha256: wrongDigest,
    } : item),
  };
  assert.throws(
    () => browserArtifactRefsFromReceipt(plan, contaminated),
    /does not match its content-addressed plan/,
  );
});

test("retry reuses strongly identified objects instead of overwriting them", async () => {
  const plan = createBrowserArtifactWritePlan(await capturedDraft());
  const harness = fixtureStore();
  const first = await executeFixtureArtifactWritePlan(plan, { store: harness.store, now: () => new Date(CAPTURED_AT) });
  const second = await executeFixtureArtifactWritePlan(plan, { store: harness.store, now: () => new Date(CAPTURED_AT) });
  assert.equal(first.outcome, "COMPLETED");
  assert.equal(second.outcome, "COMPLETED");
  assert.deepEqual(second.items.map((item) => item.operation), ["REUSED", "REUSED"]);
  assert.equal(second.fixtureHeadReads, 2);
  assert.equal(harness.objects.size, 2);
});

test("mutated draft bytes fail before the fixture store can be called", async () => {
  const draft = await capturedDraft();
  if (draft.outcome !== "CAPTURED") return;
  draft.screenshot.bytes[0] = 255;
  assert.throws(() => createBrowserArtifactWritePlan(draft), /integrity failed before storage planning/);
});

test("an existing object with conflicting content fails closed", async () => {
  const plan = createBrowserArtifactWritePlan(await capturedDraft());
  const harness = fixtureStore();
  harness.objects.set(plan.items[0].objectKey, {
    objectKey: plan.items[0].objectKey,
    byteLength: plan.items[0].byteLength,
    sha256: "f".repeat(64),
    etag: "fixture-conflict",
    uploadedAt: CAPTURED_AT,
    storageClass: "STANDARD",
    httpMetadata: plan.items[0].httpMetadata,
    customMetadata: plan.items[0].customMetadata,
  });
  const receipt = await executeFixtureArtifactWritePlan(plan, {
    store: harness.store,
    now: () => new Date(CAPTURED_AT),
  });
  assert.equal(receipt.outcome, "FAILED");
  if (receipt.outcome !== "FAILED") return;
  assert.equal(receipt.failure.itemIndex, 0);
  assert.equal(receipt.failure.code, "EXISTING_OBJECT_MISMATCH");
  assert.equal(receipt.items.length, 0);
  assert.throws(() => browserArtifactRefsFromReceipt(plan, receipt), /cannot produce Browser evidence references/);
});

test("partial failure keeps immutable orphans for retry and never performs rollback deletion", async () => {
  const plan = createBrowserArtifactWritePlan(await capturedDraft());
  const harness = fixtureStore({ failOnAttempt: 2 });
  const receipt = await executeFixtureArtifactWritePlan(plan, {
    store: harness.store,
    now: () => new Date(CAPTURED_AT),
  });
  assert.equal(receipt.outcome, "FAILED");
  if (receipt.outcome !== "FAILED") return;
  assert.equal(receipt.failure.itemIndex, 1);
  assert.equal(receipt.failure.code, "STORE_ERROR");
  assert.equal(receipt.items.length, 1);
  assert.equal(harness.objects.size, 1);
  assert.equal(receipt.rollbackAction, "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS");
});

test("content-addressed keys reject malformed digests and remain bounded", () => {
  assert.throws(
    () => artifactObjectKey("SHADOW_30D", "BROWSER_SCREENSHOT", "not-a-digest"),
  );
  const digest = "a".repeat(64);
  const key = artifactObjectKey("LEGAL_HOLD", "BROWSER_MEASUREMENT", digest);
  assert.equal(key, `legal-hold/v1/browser-measurement/aa/${digest}.json`);
  assert.ok(new TextEncoder().encode(key).byteLength < 1_024);
});
