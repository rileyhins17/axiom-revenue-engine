import { createHash } from "node:crypto";

import {
  createArtifactManifestAvailabilityReceipt,
} from "@/lib/revenue-engine/artifact-manifest-availability";
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
  DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
  DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
  type DurableEvidencePersistenceRequest,
} from "@/lib/revenue-engine/durable-evidence-persistence-plan";
import {
  FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
  runFixtureWebsiteEvidenceWorkflow,
  type FixtureWebsiteEvidenceWorkflowRequest,
  type FixtureWebsiteDocumentCapture,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";
import {
  buildPrivateKwShadowSlicePhaseReceipt,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import { buildPrivateKwSourceWorkflowProgressReceiptInput } from "@/lib/revenue-engine/private-kw-source-workflow-progress";
import {
  WEBSITE_CAPTURE_MAX_REDIRECTS,
  WEBSITE_CAPTURE_MAX_RESPONSE_BYTES,
  WEBSITE_CAPTURE_TIMEOUT_MS,
  WEBSITE_CAPTURE_VERSION,
  type WebsiteCaptureResult,
} from "@/lib/revenue-engine/website-capture";
import { createPrivateKwShadowSourceWorkflowFixture } from "@/lib/revenue-engine/test-support/private-kw-shadow-source-workflow-fixture";

const HOME_URL = "https://current-evidence.axiomfixtures.ca/";
const SERVICE_URL = "https://current-evidence.axiomfixtures.ca/roof-repair";
const ABOUT_URL = "https://current-evidence.axiomfixtures.ca/about";
const CONTACT_URL = "https://current-evidence.axiomfixtures.ca/contact";

function stableUuid(seed: string) {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ["8", "9", "a", "b"][Number.parseInt(hash[16] ?? "0", 16) % 4];
  const value = hash.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function captured(url: string, html: string, capturedAt: string): WebsiteCaptureResult {
  const rawBytes = new TextEncoder().encode(html);
  return {
    captureVersion: WEBSITE_CAPTURE_VERSION,
    policy: {
      maxRedirects: WEBSITE_CAPTURE_MAX_REDIRECTS,
      maxResponseBytes: WEBSITE_CAPTURE_MAX_RESPONSE_BYTES,
      timeoutMs: WEBSITE_CAPTURE_TIMEOUT_MS,
    },
    capturedAt,
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

function htmlDocuments(businessName: string) {
  return new Map<string, string>([
    [HOME_URL, `<!doctype html><html><head><title>${businessName} | Roofing in Kitchener</title>
      <meta name="description" content="Local Kitchener roof repair and replacement."></head><body>
      <nav><a href="/roof-repair">Roof Repair Services</a><a href="/about">About Our Team</a>
      <a href="/contact">Request a Quote</a></nav><main><h1>Roofing in Kitchener</h1>
      <p>Local roofing team with reviews, project photos, warranty, and a clear process.</p>
      <a href="tel:+15195550199">Call now</a><a href="/contact">Request a quote</a></main></body></html>`],
    [SERVICE_URL, `<!doctype html><html><head><title>Roof Repair | ${businessName}</title>
      <meta name="description" content="Roof repair services in Kitchener."></head><body><main>
      <h1>Roof Repair Services</h1><p>Roof repair and roof replacement in Kitchener.</p>
      <a href="/contact">Request a quote</a></main></body></html>`],
    [ABOUT_URL, `<!doctype html><html><head><title>About | ${businessName}</title>
      <meta name="description" content="Meet our Kitchener roofing team."></head><body><main>
      <h1>About Our Team</h1><p>Our trained roofers back their work with a warranty.</p></main></body></html>`],
    [CONTACT_URL, `<!doctype html><html><head><title>Contact | ${businessName}</title>
      <meta name="description" content="Request a roofing quote in Kitchener."></head><body><main>
      <h1>Contact ${businessName}</h1><form action="/contact" method="post"><label>Name <input name="name"></label>
      <button type="submit">Request a quote</button></form></main></body></html>`],
  ]);
}

function captureHarness(businessName: string, capturedAt: string): FixtureWebsiteDocumentCapture {
  const documents = htmlDocuments(businessName);
  return {
    kind: "FIXTURE",
    async capture(requestedUrl) {
      const html = documents.get(requestedUrl);
      if (!html) throw new Error(`Synthetic capture is missing ${requestedUrl}.`);
      return captured(requestedUrl, html, capturedAt);
    },
  };
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
    requestsObserved: 4,
    requestsBlocked: 0,
    documentUrls: [url],
  };
}

function browserHarness(): BrowserMeasurementRunner {
  return {
    kind: "FIXTURE",
    async run(request: BrowserMeasurementRequest) {
      const mobile = request.profile === "MOBILE_390X844";
      return {
        provider: "CLOUDFLARE_BROWSER_RENDERING",
        providerRequestId: `fixture:${request.requestId}`,
        browserMsUsed: 250,
        networkPolicy: networkPolicy(request.requestedUrl),
        warnings: [],
        outcome: "CAPTURED",
        finalUrl: request.requestedUrl,
        redirectChain: [request.requestedUrl],
        screenshotMediaType: "image/webp",
        screenshotBytes: new TextEncoder().encode(`${request.pageKind}:${request.profile}`),
        measurements: {
          document: mobile
            ? { clientWidth: 390, documentScrollWidth: 390, bodyScrollWidth: 390 }
            : { clientWidth: 1_440, documentScrollWidth: 1_440, bodyScrollWidth: 1_440 },
          actions: request.pageKind === "HOME" ? [{
            actionId: `quote:${request.profile}`,
            kind: "QUOTE",
            label: "Request a quote",
            href: CONTACT_URL,
            visible: true,
            enabled: true,
            boundingBox: { x: 20, y: 120, width: 180, height: 48 },
          }] : [],
          forms: request.pageKind === "CONTACT" ? [{
            formId: `contact:${request.profile}`,
            actionUrl: CONTACT_URL,
            method: "POST",
            visible: true,
            hasSubmitControl: true,
            disabled: false,
            boundingBox: { x: 20, y: 300, width: 320, height: 400 },
          }] : [],
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
        },
        failure: null,
      };
    },
  };
}

function storedObject(request: FixturePutRequest, uploadedAt: string) {
  return {
    objectKey: request.objectKey,
    byteLength: request.byteLength,
    sha256: request.sha256,
    etag: `fixture-${request.sha256.slice(0, 32)}`,
    uploadedAt,
    storageClass: request.storageClass,
    httpMetadata: request.httpMetadata,
    customMetadata: request.customMetadata,
  };
}

function artifactHarness(uploadedAt: string): FixtureArtifactStore {
  const objects = new Map<string, ReturnType<typeof storedObject>>();
  return {
    kind: "FIXTURE",
    async putIfAbsent(request) {
      if (objects.has(request.objectKey)) return { outcome: "ALREADY_EXISTS", object: null };
      const object = storedObject(request, uploadedAt);
      objects.set(request.objectKey, object);
      return { outcome: "CREATED", object };
    },
    async head(objectKey) {
      return objects.get(objectKey) ?? null;
    },
  };
}

export async function createPrivateKwCurrentWebsiteEvidenceFixture(options: {
  suffix?: string;
  now?: Date;
} = {}) {
  const suffix = options.suffix ?? "current-evidence";
  const sourceNow = options.now ?? new Date("2026-08-28T16:00:00.000Z");
  const sourceFixture = createPrivateKwShadowSourceWorkflowFixture({
    suffix,
    now: sourceNow,
    selectedWebsiteUrl: HOME_URL,
  });
  const sourceProgressInput = buildPrivateKwSourceWorkflowProgressReceiptInput({
    manifestValue: sourceFixture.manifest,
    sourceValue: sourceFixture.source,
    materializationValue: sourceFixture.materialization,
    storedRecords: sourceFixture.exactStoredRecords,
    recordedAt: sourceFixture.recordedAt,
  });
  const previousPhaseReceipt = buildPrivateKwShadowSlicePhaseReceipt(
    sourceFixture.manifest,
    sourceProgressInput,
  );
  const manifestRecord = sourceFixture.manifest.records.find(
    (record) => record.businessId === previousPhaseReceipt.businessId,
  );
  if (!manifestRecord) throw new Error("Synthetic source fixture lost its selected manifest record.");

  const requestedAt = new Date(sourceNow.getTime() + 60_000).toISOString();
  const plannedAt = new Date(sourceNow.getTime() + 2 * 60_000).toISOString();
  const preparedAt = new Date(sourceNow.getTime() + 3 * 60_000).toISOString();
  const expiresAt = new Date(Date.parse(requestedAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const workflowRequest: FixtureWebsiteEvidenceWorkflowRequest = {
    workflowVersion: FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
    workflowId: stableUuid(`workflow:${suffix}`),
    idempotencyKey: `current-website-evidence:${suffix}`,
    businessId: manifestRecord.businessId,
    businessName: manifestRecord.businessName,
    niche: manifestRecord.niche.toLocaleLowerCase("en-CA"),
    expectedServices: [manifestRecord.niche.toLocaleLowerCase("en-CA")],
    expectedLocations: [manifestRecord.city],
    websiteUrl: HOME_URL,
    sourceEvidenceUrl: manifestRecord.sourceEvidenceUrl,
    requestedAt,
    mode: "SHADOW",
    orchestratorKind: "FIXTURE",
    maxCostUsd: 0,
    resourceProbes: [{ url: HOME_URL, type: "PAGE", internal: true, statusCode: 200 }],
  };
  const workflowReceipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest, {
    capture: captureHarness(manifestRecord.businessName, requestedAt),
    browserRunner: browserHarness(),
    artifactStore: artifactHarness(requestedAt),
  });
  const durableEvidenceRequest: DurableEvidencePersistenceRequest = {
    persistencePlanVersion: DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
    plannedAt,
    mode: "SHADOW",
    plannerKind: "FIXTURE",
    maxCostUsd: 0,
    workflowAttemptNumber: 1,
    workflowRequest,
    workflowReceipt,
    promotions: [],
    releases: [],
  };
  const availabilityReceipts = workflowReceipt.artifactManifests.map((manifest) => (
    createArtifactManifestAvailabilityReceipt({
      receiptId: stableUuid(`availability:${manifest.manifestId}`),
      manifest,
      checkedAt: requestedAt,
      validThrough: expiresAt,
      expiresAt,
      checkerKind: "FIXTURE",
      objects: manifest.items.map((item) => ({
        kind: item.kind,
        artifactRef: item.artifactRef,
        objectKey: item.objectKey,
        expectedByteLength: item.byteLength,
        expectedSha256: item.sha256,
        expectedEtag: item.etag,
        state: "PRESENT" as const,
        observedByteLength: item.byteLength,
        observedSha256: item.sha256,
        observedEtag: item.etag,
      })),
    })
  ));

  return {
    ...sourceFixture,
    previousPhaseReceipt,
    manifestRecord,
    workflowRequest,
    workflowReceipt,
    durableEvidenceRequest,
    availabilityReceipts,
    preparedAt,
  };
}
