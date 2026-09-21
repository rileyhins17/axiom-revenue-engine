import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import type { BrowserMeasurementRunner } from "@/lib/revenue-engine/browser-measurement-adapter";
import { BROWSER_NETWORK_POLICY_VERSION } from "@/lib/revenue-engine/browser-page-evidence";
import {
  ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
  ARTIFACT_MANIFEST_VERSION,
  ArtifactManifestSchema,
  ArtifactPromotionReceiptSchema,
  artifactManifestDigest,
  createArtifactPromotionPlan,
  type ArtifactEvidenceUse,
  type ArtifactManifest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  createArtifactManifestAvailabilityReceipt,
  type ArtifactManifestObjectAvailability,
} from "@/lib/revenue-engine/artifact-manifest-availability";
import {
  ARTIFACT_REFERENCE_SOURCE_SET_ORDER,
  buildArtifactReferenceAtomicPlan,
} from "@/lib/revenue-engine/artifact-reference-atomic-snapshot";
import {
  executeArtifactReferenceD1Snapshot,
  type ArtifactReferenceD1BatchBoundary,
  type ArtifactReferenceD1BatchStatement,
} from "@/lib/revenue-engine/artifact-reference-d1-executor";
import { decodeArtifactReferenceD1SourceSnapshot } from "@/lib/revenue-engine/artifact-reference-d1-source-decoder";
import {
  ARTIFACT_REFERENCE_TRUSTED_PROJECTION_VERSION,
  ArtifactReferenceTrustedProjectionSchema,
  createArtifactReferenceTrustedProjection,
} from "@/lib/revenue-engine/artifact-reference-trusted-projection";
import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import type {
  FixtureArtifactStore,
  FixturePutRequest,
} from "@/lib/revenue-engine/content-addressed-artifact-store";
import {
  DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
  DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
  buildDurableEvidencePersistencePlan,
} from "@/lib/revenue-engine/durable-evidence-persistence-plan";
import {
  FENCED_EVIDENCE_RESUME_PERSISTENCE_PLAN_VERSION,
  FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION,
  buildFencedEvidenceResumePersistencePlan,
} from "@/lib/revenue-engine/fenced-evidence-resume-persistence-plan";
import {
  FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION,
  FIXTURE_WEBSITE_EVIDENCE_DELIVERY_VERSION,
  FIXTURE_WEBSITE_EVIDENCE_LEASE_VERSION,
  FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION,
  createFixtureWorkflowReceiptRevision,
  currentFixtureWebsiteEvidenceDefinition,
  fixtureWebsiteEvidenceRequestDigest,
  type FixtureWorkflowAttemptSnapshot,
  type FixtureWorkflowDeliveryRecord,
  type FixtureWorkflowLeaseClaim,
} from "@/lib/revenue-engine/fixture-website-evidence-resume-plan";
import {
  FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
  runFixtureWebsiteEvidenceWorkflow,
  type FixtureWebsiteEvidenceWorkflowRequest,
  type FixtureWebsiteDocumentCapture,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";
import {
  PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema,
  buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt,
  requireInProcessPrivateKwCurrentWebsiteEvidenceEligibilityReceipt,
} from "@/lib/revenue-engine/private-kw-current-website-evidence-eligibility";
import {
  loadPrivateKwWebsiteEvidenceEligibilityD1,
  persistPrivateKwWebsiteEvidenceEligibilityD1,
  requireCurrentPrivateKwWebsiteEvidenceEligibilityD1Result,
  requireTrustedPrivateKwWebsiteEvidenceEligibilityD1Result,
  type PrivateKwWebsiteEvidenceEligibilityD1Boundary,
  type PrivateKwWebsiteEvidenceEligibilityD1Statement,
} from "@/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1";
import {
  buildPrivateKwCurrentWebsiteEvidenceProgressInput,
  requireInProcessPrivateKwCurrentWebsiteEvidenceProgressInput,
} from "@/lib/revenue-engine/private-kw-current-website-evidence-progress";
import {
  appendPrivateKwCurrentWebsiteEvidenceProgress,
  requireInProcessPrivateKwCurrentWebsiteEvidenceProgressCheckpoint,
} from "@/lib/revenue-engine/private-kw-current-website-evidence-progress-append";
import {
  PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_VERSION,
  PrivateKwCurrentWebsiteEvidenceProofSchema,
  privateKwCurrentWebsiteEvidenceAuthority,
} from "@/lib/revenue-engine/private-kw-current-website-evidence";
import {
  PrivateKwShadowSliceManifestSchema,
  privateKwShadowSliceDigest,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
  PrivateKwShadowSlicePhaseReceiptInputSchema,
  PrivateKwShadowSliceProgressCheckpointSchema,
  appendPrivateKwShadowSliceProgress,
  buildInitialPrivateKwShadowSliceProgress,
  privateKwShadowSliceProgressAuthority,
  privateKwShadowSliceProgressDigest,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import {
  createPrivateKwShadowSourceWorkflowFixture,
} from "@/lib/revenue-engine/test-support/private-kw-shadow-source-workflow-fixture";
import {
  WEBSITE_CAPTURE_MAX_REDIRECTS,
  WEBSITE_CAPTURE_MAX_RESPONSE_BYTES,
  WEBSITE_CAPTURE_TIMEOUT_MS,
  WEBSITE_CAPTURE_VERSION,
  type WebsiteCaptureResult,
} from "@/lib/revenue-engine/website-capture";

const BUSINESS_ID = "business:atomic-decoder-roofing";
const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const LEASE_ID = "33333333-3333-4333-8333-333333333333";
const SNAPSHOT_ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const HOME_URL = "https://atomic-decoder-roofing.ca/";
const REQUESTED_AT = "2026-08-23T12:00:00.000Z";
const CAPTURED_AT = "2026-08-23T12:00:00.000Z";
const SNAPSHOT_AT = "2026-08-23T12:03:00.000Z";
const VALID_THROUGH = "2026-08-23T12:05:00.000Z";

const homeHtml = `<!doctype html><html><head><title>Atomic Decoder Roofing</title>
  <meta name="description" content="Kitchener roof repair and replacement."></head><body>
  <main><h1>Roof repair in Kitchener</h1><a href="tel:+15195550199">Call now</a></main></body></html>`;

function workflowRequest(): FixtureWebsiteEvidenceWorkflowRequest {
  return {
    workflowVersion: FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
    workflowId: WORKFLOW_ID,
    idempotencyKey: "atomic-decoder-roofing:audit:2026-08-24",
    businessId: BUSINESS_ID,
    businessName: "Atomic Decoder Roofing",
    niche: "roofing",
    expectedServices: ["roof repair"],
    expectedLocations: ["Kitchener"],
    websiteUrl: HOME_URL,
    sourceEvidenceUrl: "https://source-fixture.ca/business/atomic-decoder-roofing",
    requestedAt: REQUESTED_AT,
    mode: "SHADOW",
    orchestratorKind: "FIXTURE",
    maxCostUsd: 0,
    resourceProbes: [{ url: HOME_URL, type: "PAGE", internal: true, statusCode: 200 }],
  };
}

function capturedHome(): WebsiteCaptureResult {
  return {
    captureVersion: WEBSITE_CAPTURE_VERSION,
    policy: {
      maxRedirects: WEBSITE_CAPTURE_MAX_REDIRECTS,
      maxResponseBytes: WEBSITE_CAPTURE_MAX_RESPONSE_BYTES,
      timeoutMs: WEBSITE_CAPTURE_TIMEOUT_MS,
    },
    capturedAt: CAPTURED_AT,
    requestedUrl: HOME_URL,
    finalUrl: HOME_URL,
    statusCode: 200,
    redirectCount: 0,
    redirectChain: [HOME_URL],
    outcome: "CAPTURED",
    contentType: "text/html",
    bodyBytes: new TextEncoder().encode(homeHtml).byteLength,
    html: homeHtml,
    failure: null,
  };
}

function dependencies() {
  const capture: FixtureWebsiteDocumentCapture = {
    kind: "FIXTURE",
    async capture(requestedUrl) {
      if (requestedUrl !== HOME_URL) throw new Error(`Unexpected fixture capture ${requestedUrl}.`);
      return capturedHome();
    },
  };
  const browserRunner: BrowserMeasurementRunner = {
    kind: "FIXTURE",
    async run(request) {
      const mobile = request.profile === "MOBILE_390X844";
      return {
        provider: "CLOUDFLARE_BROWSER_RENDERING",
        providerRequestId: `fixture:${request.requestId}`,
        browserMsUsed: 250,
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
          documentUrls: [HOME_URL],
        },
        warnings: [],
        outcome: "CAPTURED",
        finalUrl: HOME_URL,
        redirectChain: [HOME_URL],
        screenshotMediaType: "image/webp",
        screenshotBytes: new TextEncoder().encode(`HOME:${request.profile}`),
        measurements: {
          document: mobile
            ? { clientWidth: 390, documentScrollWidth: 390, bodyScrollWidth: 390 }
            : { clientWidth: 1_440, documentScrollWidth: 1_440, bodyScrollWidth: 1_440 },
          actions: [{
            actionId: `phone:${request.profile}`,
            kind: "PHONE",
            label: "Call now",
            href: "tel:+15195550199",
            visible: true,
            enabled: true,
            boundingBox: { x: 20, y: 100, width: 120, height: 48 },
          }],
          forms: [],
          navigation: mobile
            ? { status: "USABLE", probePerformed: true, reasonCodes: [] }
            : { status: "UNKNOWN", probePerformed: false, reasonCodes: [] },
          text: mobile
            ? { readable: true, minimumFontSizePx: 16, measuredTextNodes: 8 }
            : { readable: null, minimumFontSizePx: null, measuredTextNodes: 0 },
          coverage: {
            layoutComplete: true, actionsComplete: true, formsComplete: true,
            navigationComplete: mobile, textComplete: mobile,
          },
        },
        failure: null,
      };
    },
  };
  const objects = new Map<string, ReturnType<typeof storedObject>>();
  const artifactStore: FixtureArtifactStore = {
    kind: "FIXTURE",
    async putIfAbsent(request) {
      const object = storedObject(request);
      objects.set(request.objectKey, object);
      return { outcome: "CREATED", object };
    },
    async head(objectKey) { return objects.get(objectKey) ?? null; },
  };
  return { capture, browserRunner, artifactStore };
}

function storedObject(request: FixturePutRequest) {
  return {
    objectKey: request.objectKey,
    byteLength: request.byteLength,
    sha256: request.sha256,
    etag: `fixture-${request.sha256.slice(0, 32)}`,
    uploadedAt: CAPTURED_AT,
    storageClass: request.storageClass,
    httpMetadata: request.httpMetadata,
    customMetadata: request.customMetadata,
  };
}

function delivery(): FixtureWorkflowDeliveryRecord {
  const request = workflowRequest();
  const requestDigest = fixtureWebsiteEvidenceRequestDigest(request);
  return {
    deliveryVersion: FIXTURE_WEBSITE_EVIDENCE_DELIVERY_VERSION,
    deliveryId: "delivery:atomic-decoder-roofing:2026-08-24",
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: currentFixtureWebsiteEvidenceDefinition().definitionDigest,
    requestDigest,
    payloadDigest: requestDigest,
    receivedAt: REQUESTED_AT,
    mode: "SHADOW",
    deliveryKind: "FIXTURE",
  };
}

function sealedAttempt(terminalReceiptId: string): FixtureWorkflowAttemptSnapshot {
  return {
    attemptVersion: FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION,
    attemptId: ATTEMPT_ID,
    workflowId: WORKFLOW_ID,
    workflowVersion: FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
    definitionDigest: currentFixtureWebsiteEvidenceDefinition().definitionDigest,
    requestDigest: fixtureWebsiteEvidenceRequestDigest(workflowRequest()),
    deliveryId: delivery().deliveryId,
    attemptNumber: 1,
    fencingToken: 1,
    status: "SEALED",
    startedAt: "2026-08-23T11:59:30.000Z",
    endedAt: "2026-08-23T12:01:00.000Z",
    terminalReceiptId,
  };
}

function lease(attempt: FixtureWorkflowAttemptSnapshot): FixtureWorkflowLeaseClaim {
  return {
    leaseVersion: FIXTURE_WEBSITE_EVIDENCE_LEASE_VERSION,
    leaseId: LEASE_ID,
    workflowId: WORKFLOW_ID,
    workflowVersion: FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
    definitionDigest: currentFixtureWebsiteEvidenceDefinition().definitionDigest,
    requestDigest: fixtureWebsiteEvidenceRequestDigest(workflowRequest()),
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    deliveryId: attempt.deliveryId,
    ownerId: "fixture-owner-atomic-decoder",
    fencingToken: attempt.fencingToken,
    acquiredAt: "2026-08-23T11:59:31.000Z",
    expiresAt: "2026-08-23T12:02:00.000Z",
    mode: "SHADOW",
    leaseKind: "FIXTURE",
  };
}

function freshDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  for (const migration of [
    "0054_revenue_shadow_kernel.sql",
    "0056_durable_evidence_receipts.sql",
    "0057_fenced_evidence_resume_records.sql",
    "0058_artifact_reference_projections.sql",
    "0059_atomic_artifact_reference_snapshots.sql",
    "0060_artifact_reference_source_writer_guards.sql",
    "0068_current_website_evidence_eligibility_receipts.sql",
  ]) database.exec(readFileSync(new URL(`../../../migrations/${migration}`, import.meta.url), "utf8"));
  database.prepare(`INSERT INTO "RevenueBusiness"
    ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status")
    VALUES (?, 'Atomic Decoder Roofing', 'atomic-decoder-roofing.ca', 'UNKNOWN', 'RESEARCH_ONLY')`).run(BUSINESS_ID);
  return database;
}

function insertMutations(database: Database.Database, mutations: Array<{ sql: string; bindings: Array<string | number | null> }>) {
  for (const mutation of mutations) database.prepare(mutation.sql).run(...mutation.bindings);
}

function availabilityObjects(manifest: ArtifactManifest) {
  return manifest.items.map((item): ArtifactManifestObjectAvailability => ({
    kind: item.kind,
    artifactRef: item.artifactRef,
    objectKey: item.objectKey,
    expectedByteLength: item.byteLength,
    expectedSha256: item.sha256,
    expectedEtag: item.etag,
    state: "PRESENT",
    observedByteLength: item.byteLength,
    observedSha256: item.sha256,
    observedEtag: item.etag,
  }));
}

async function buildFixture() {
  const request = workflowRequest();
  const receipt = await runFixtureWebsiteEvidenceWorkflow(request, dependencies());
  assert.ok(
    receipt.status === "COMPLETED" || receipt.status === "PARTIAL",
    `Fixture workflow failed: ${JSON.stringify(receipt.failure)}`,
  );
  assert.ok(receipt.artifactManifests.length > 1);
  const receiptId = `workflow-receipt:${artifactReferenceDigest(receipt)}`;
  const attempt = sealedAttempt(receiptId);
  const claim = lease(attempt);
  const revision = createFixtureWorkflowReceiptRevision({
    request,
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt,
    receipt,
    recordedAt: "2026-08-23T12:01:30.000Z",
  });
  return { request, receipt, attempt, claim, revision };
}

function fixturePromotion(
  source: ArtifactManifest,
  promotionId: string,
  evidenceUses: ArtifactEvidenceUse[],
  completedAt: string,
) {
  const plan = createArtifactPromotionPlan({
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    promotionId,
    workflowId: WORKFLOW_ID,
    requestedAt: completedAt,
    mode: "SHADOW",
    executorKind: "FIXTURE",
    providerCopyAuthorized: false,
    maxCostUsd: 0,
    businessId: BUSINESS_ID,
    sourceManifest: source,
    evidenceUses,
  });
  const items = plan.items.map((item) => ({
    kind: item.kind,
    artifactRef: item.artifactRef,
    objectKey: item.targetObjectKey,
    byteLength: item.byteLength,
    sha256: item.sha256,
    operation: "CREATED" as const,
    etag: `fixture-${promotionId}-${item.sha256.slice(0, 16)}`,
    uploadedAt: completedAt,
  }));
  const resultManifest = ArtifactManifestSchema.parse({
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    manifestId: promotionId,
    workflowId: WORKFLOW_ID,
    retentionClass: plan.targetRetentionClass,
    verifiedAt: completedAt,
    provenance: { receiptType: "ARTIFACT_PROMOTION", receiptId: promotionId },
    items: items.map((item) => ({
      kind: item.kind,
      artifactRef: item.artifactRef,
      objectKey: item.objectKey,
      byteLength: item.byteLength,
      sha256: item.sha256,
      etag: item.etag,
      uploadedAt: item.uploadedAt,
    })),
  });
  const receipt = ArtifactPromotionReceiptSchema.parse({
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    promotionId,
    workflowId: WORKFLOW_ID,
    mode: "SHADOW",
    executorKind: "FIXTURE",
    providerCopyPerformed: false,
    sourceRetentionClass: source.retentionClass,
    targetRetentionClass: plan.targetRetentionClass,
    action: plan.action,
    plannedItemCount: plan.items.length,
    startedAt: completedAt,
    completedAt,
    fixtureHeadReads: plan.items.length,
    fixtureCopyAttempts: plan.items.length,
    providerClassAOperations: 0,
    providerClassBOperations: 0,
    costUsd: 0,
    rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS",
    outcome: "COMPLETED",
    items,
    resultManifest,
    failure: null,
  });
  return { plan, receipt };
}

type SnapshotTiming = {
  requestedAt: string;
  acquiredAt: string;
  snapshotAt: string;
  expiresAt: string;
  availabilityCheckedAt: string;
  availabilityValidThrough: string;
};

function defaultSnapshotTiming(): SnapshotTiming {
  return {
    requestedAt: "2026-08-23T12:02:00.000Z",
    acquiredAt: "2026-08-23T12:02:01.000Z",
    snapshotAt: SNAPSHOT_AT,
    expiresAt: VALID_THROUGH,
    availabilityCheckedAt: "2026-08-23T12:02:30.000Z",
    availabilityValidThrough: VALID_THROUGH,
  };
}

async function persistedDatabaseFixture(
  timing: SnapshotTiming = defaultSnapshotTiming(),
  referenceScenario: "NO_USES" | "AMBIGUOUS_QUALIFICATION" = "NO_USES",
) {
  const fixture = await buildFixture();
  const database = freshDatabase();
  const rootManifest = fixture.receipt.artifactManifests[0];
  assert.ok(rootManifest);
  const evidenceUse: ArtifactEvidenceUse = {
    useId: "88888888-8888-4888-8888-888888888888",
    useType: "QUALIFICATION_SNAPSHOT",
    recordId: "qualification:atomic-decoder-roofing",
    recordVersion: "v1",
    businessId: BUSINESS_ID,
    recordedAt: new Date(Date.parse(timing.snapshotAt) - 30_000).toISOString(),
  };
  const promotions = referenceScenario === "AMBIGUOUS_QUALIFICATION"
    ? [
        fixturePromotion(rootManifest, "99999999-9999-4999-8999-999999999991", [evidenceUse], new Date(Date.parse(timing.snapshotAt) - 20_000).toISOString()),
        fixturePromotion(rootManifest, "99999999-9999-4999-8999-999999999992", [evidenceUse], new Date(Date.parse(timing.snapshotAt) - 10_000).toISOString()),
      ]
    : [];
  const durable = buildDurableEvidencePersistencePlan({
    persistencePlanVersion: DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
    plannedAt: timing.snapshotAt,
    mode: "SHADOW",
    plannerKind: "FIXTURE",
    maxCostUsd: 0,
    workflowAttemptNumber: 1,
    workflowRequest: fixture.request,
    workflowReceipt: fixture.receipt,
    promotions,
    releases: [],
  });
  insertMutations(database, durable.mutations);
  const fenced = buildFencedEvidenceResumePersistencePlan({
    persistencePlanVersion: FENCED_EVIDENCE_RESUME_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION,
    resumeRequest: {
      resumePlanVersion: FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION,
      plannedAt: timing.snapshotAt,
      mode: "SHADOW",
      plannerKind: "FIXTURE",
      maxCostUsd: 0,
      workflowRequest: fixture.request,
      definition: currentFixtureWebsiteEvidenceDefinition(),
      currentDelivery: delivery(),
      persistedDeliveries: [],
      attempts: [fixture.attempt],
      leases: [fixture.claim],
      receiptRevisions: [fixture.revision],
      checkpoints: [],
      artifactRecoveries: [],
    },
  });
  insertMutations(database, fenced.mutations);

  const availableManifests = [
    ...fixture.receipt.artifactManifests,
    ...promotions.map((promotion) => promotion.receipt.resultManifest).filter((manifest): manifest is ArtifactManifest => manifest !== null),
  ];
  for (const [index, manifest] of availableManifests.entries()) {
    const receipt = createArtifactManifestAvailabilityReceipt({
      receiptId: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      manifest,
      checkedAt: timing.availabilityCheckedAt,
      validThrough: timing.availabilityValidThrough,
      expiresAt: manifest.retentionClass === "SHADOW_30D" ? timing.availabilityValidThrough : null,
      checkerKind: "R2_HEAD",
      objects: availabilityObjects(manifest),
    });
    database.prepare(`INSERT INTO "RevenueArtifactManifestAvailabilityReceipt" (
      "id", "availabilityVersion", "manifestId", "state", "checkedAt", "validThrough", "expiresAt", "checkerKind",
      "objectSetDigest", "receiptDigest", "receiptJson", "providerReadPerformed", "providerOperationsAuthorized",
      "releaseAuthorized", "deletionAuthorized", "costUsd"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)`).run(
      receipt.receiptId, receipt.availabilityVersion, receipt.manifestId, receipt.state, receipt.checkedAt,
      receipt.validThrough, receipt.expiresAt, receipt.checkerKind, receipt.objectSetDigest, receipt.receiptDigest,
      artifactReferenceCanonicalJson(receipt), receipt.providerReadPerformed ? 1 : 0,
    );
  }

  const rootManifestId = rootManifest.manifestId;
  const plan = buildArtifactReferenceAtomicPlan({
    attemptId: SNAPSHOT_ATTEMPT_ID,
    workflowRunId: WORKFLOW_ID,
    businessId: BUSINESS_ID,
    lineageRootManifestId: rootManifestId,
    attemptNumber: 1,
    fencingToken: 1,
    ownerId: "fixture-owner-snapshot",
    requestedAt: timing.requestedAt,
    acquiredAt: timing.acquiredAt,
    expiresAt: timing.expiresAt,
    mode: "SHADOW",
    maxCostUsd: 0,
  });
  return { fixture, database, plan, timing };
}

async function persistedObservation() {
  const { fixture, database, plan, timing } = await persistedDatabaseFixture();
  const sourceSets = plan.statements.filter((statement) => statement.kind === "SOURCE_READ").map((statement) => ({
    setName: statement.resultSet!,
    rows: database.prepare(statement.sql).all(...statement.bindings) as Array<Record<string, string | number | null>>,
  }));
  const observation = {
    planDigest: plan.planDigest,
    snapshotCapturedAt: timing.snapshotAt,
    statementCount: plan.statements.filter((statement) => statement.batchGroup === "PREPARE_SNAPSHOT").length,
    batchSucceeded: true as const,
    transactionApi: "D1Database.batch" as const,
    winningFenceRows: [{
      id: plan.attempt.id,
      attemptDigest: plan.attempt.attemptDigest,
      attemptNumber: plan.attempt.attemptNumber,
      fencingToken: plan.attempt.fencingToken,
    }],
    sourceSets,
  };
  database.close();
  return { fixture, plan, observation };
}

test("decodes all 15 source sets into an explicit workflow forest without granting trust", async () => {
  const { fixture, plan, observation } = await persistedObservation();
  assert.deepEqual(observation.sourceSets.map((source) => source.setName), [...ARTIFACT_REFERENCE_SOURCE_SET_ORDER]);
  const decoded = decodeArtifactReferenceD1SourceSnapshot(plan, observation);
  assert.equal(decoded.structurallyValid, true);
  assert.equal(decoded.transactionallyTrusted, false);
  assert.equal(decoded.snapshotComplete, false);
  assert.equal(decoded.providerOperationsAuthorized, 0);
  assert.equal(decoded.selectedLineage.rootManifestId, fixture.receipt.artifactManifests[0].manifestId);
  assert.equal(decoded.selectedLineage.manifestIds.length, 1);
  assert.equal(decoded.selectedLineage.disconnectedRootManifestIds.length, fixture.receipt.artifactManifests.length - 1);
  assert.equal(decoded.sourceCounts.AVAILABILITY, fixture.receipt.artifactManifests.length);
});

test("row order cannot change decoded facts, but denormalized drift fails closed", async () => {
  const { plan, observation } = await persistedObservation();
  const first = decodeArtifactReferenceD1SourceSnapshot(plan, observation);
  const reordered = structuredClone(observation);
  for (const source of reordered.sourceSets) source.rows.reverse();
  const second = decodeArtifactReferenceD1SourceSnapshot(plan, reordered);
  assert.equal(second.decodedFactsDigest, first.decodedFactsDigest);

  const drifted = structuredClone(observation);
  const manifests = drifted.sourceSets.find((source) => source.setName === "MANIFESTS");
  assert.ok(manifests?.rows[0]);
  manifests.rows[0].retentionClass = "LEGAL_HOLD";
  assert.throws(() => decodeArtifactReferenceD1SourceSnapshot(plan, drifted), /retentionClass does not match/);
});

test("missing terminal closure and ambiguous latest availability both fail closed", async () => {
  const { plan, observation } = await persistedObservation();
  const unsealed = structuredClone(observation);
  const closures = unsealed.sourceSets.find((source) => source.setName === "WORKFLOW_ATTEMPT_CLOSURES");
  assert.ok(closures);
  closures.rows = [];
  assert.throws(() => decodeArtifactReferenceD1SourceSnapshot(plan, unsealed), /not sealed to one terminal business result/);

  const ambiguous = structuredClone(observation);
  const availability = ambiguous.sourceSets.find((source) => source.setName === "AVAILABILITY");
  assert.ok(availability?.rows[0]);
  const competing = { ...availability.rows[0] };
  competing.id = "80000000-0000-4000-8000-000000000001";
  competing.checkerKind = "FIXTURE";
  competing.providerReadPerformed = 0;
  const receipt = JSON.parse(String(competing.receiptJson)) as Record<string, unknown>;
  receipt.receiptId = competing.id;
  receipt.checkerKind = "FIXTURE";
  receipt.providerReadPerformed = false;
  const { receiptDigest: _oldDigest, ...receiptCore } = receipt;
  void _oldDigest;
  receipt.receiptDigest = artifactReferenceDigest(receiptCore);
  competing.receiptDigest = receipt.receiptDigest as string;
  competing.receiptJson = artifactReferenceCanonicalJson(receipt);
  availability.rows.push(competing);
  assert.throws(() => decodeArtifactReferenceD1SourceSnapshot(plan, ambiguous), /ambiguous latest availability receipt/);
});

test("requested roots, exact row columns, and embedded manifest items cannot be omitted or substituted", async () => {
  const { plan, observation } = await persistedObservation();
  const missingRootPlan = buildArtifactReferenceAtomicPlan({
    attemptId: "99999999-9999-4999-8999-999999999999",
    workflowRunId: WORKFLOW_ID,
    businessId: BUSINESS_ID,
    lineageRootManifestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    attemptNumber: 1,
    fencingToken: 1,
    ownerId: "fixture-owner-snapshot",
    requestedAt: "2026-08-23T12:02:00.000Z",
    acquiredAt: "2026-08-23T12:02:01.000Z",
    expiresAt: VALID_THROUGH,
    mode: "SHADOW",
    maxCostUsd: 0,
  });
  const wrongRootObservation = structuredClone(observation);
  wrongRootObservation.planDigest = missingRootPlan.planDigest;
  wrongRootObservation.winningFenceRows = [{
    id: missingRootPlan.attempt.id,
    attemptDigest: missingRootPlan.attempt.attemptDigest,
    attemptNumber: missingRootPlan.attempt.attemptNumber,
    fencingToken: missingRootPlan.attempt.fencingToken,
  }];
  assert.throws(
    () => decodeArtifactReferenceD1SourceSnapshot(missingRootPlan, wrongRootObservation),
    /Requested lineage root must be an exact ARTIFACT_WRITE manifest/,
  );

  const unexpectedColumn = structuredClone(observation);
  const workflowRuns = unexpectedColumn.sourceSets.find((source) => source.setName === "WORKFLOW_RUNS");
  assert.ok(workflowRuns?.rows[0]);
  workflowRuns.rows[0].unexpectedAuthority = 1;
  assert.throws(() => decodeArtifactReferenceD1SourceSnapshot(plan, unexpectedColumn), /Unrecognized key/);

  const missingItem = structuredClone(observation);
  const items = missingItem.sourceSets.find((source) => source.setName === "MANIFEST_ITEMS");
  assert.ok(items && items.rows.length > 1);
  items.rows.shift();
  assert.throws(() => decodeArtifactReferenceD1SourceSnapshot(plan, missingItem), /item rows do not exactly match/);
});

function currentSnapshotTiming(): SnapshotTiming {
  const now = Date.now();
  return {
    requestedAt: new Date(now - 3_000).toISOString(),
    acquiredAt: new Date(now - 2_000).toISOString(),
    snapshotAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 240_000).toISOString(),
    availabilityCheckedAt: new Date(now - 10_000).toISOString(),
    availabilityValidThrough: new Date(now + 240_000).toISOString(),
  };
}

function currentWebsiteEvidenceProof(fixture: Awaited<ReturnType<typeof buildFixture>>) {
  const audit = fixture.receipt.audit;
  const pageSelection = fixture.receipt.pageSelection;
  const auditAssembly = fixture.receipt.auditAssembly;
  const home = fixture.receipt.pages.find((page) => page.pageKind === "HOME");
  assert.ok(audit?.finalUrl);
  assert.ok(pageSelection);
  assert.ok(auditAssembly);
  assert.ok(home);
  const preparedAt = new Date(Date.parse(fixture.receipt.completedAt) + 60_000).toISOString();
  const availabilityBoundary = new Date(Date.parse(fixture.receipt.completedAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const artifactEvidence = fixture.receipt.artifactManifests.map((manifest, index) => {
    const availability = createArtifactManifestAvailabilityReceipt({
      receiptId: `71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      manifest,
      checkedAt: fixture.receipt.completedAt,
      validThrough: availabilityBoundary,
      expiresAt: availabilityBoundary,
      checkerKind: "FIXTURE",
      objects: availabilityObjects(manifest),
    });
    return {
      manifestId: manifest.manifestId,
      manifestDigest: artifactManifestDigest(manifest),
      retentionClass: "SHADOW_30D" as const,
      availabilityReceiptId: availability.receiptId,
      availabilityReceiptDigest: availability.receiptDigest,
      checkerKind: "FIXTURE" as const,
      validThrough: availability.validThrough,
      expiresAt: availability.expiresAt!,
    };
  }).sort((left, right) => left.manifestId.localeCompare(right.manifestId, "en-CA"));
  const manifestIdentity = artifactReferenceDigest({
    businessId: fixture.request.businessId,
    workflowId: fixture.request.workflowId,
  });
  const previousDigest = artifactReferenceDigest({
    businessId: fixture.request.businessId,
    checkpoint: "SOURCE_WORKFLOW_PERSISTED",
  });
  const core = {
    proofVersion: PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_VERSION,
    proofKind: "CURRENT_WEBSITE_EVIDENCE" as const,
    manifestId: `kw-shadow-slice:${manifestIdentity}`,
    manifestDigest: artifactReferenceDigest({ manifestIdentity, records: [fixture.request.businessId] }),
    businessId: fixture.request.businessId,
    evaluationCandidateId: `evaluation:${fixture.request.businessId}`,
    sourceRecordId: `source:${fixture.request.businessId}`,
    websiteUrl: fixture.request.websiteUrl,
    sourceEvidenceUrl: fixture.request.sourceEvidenceUrl,
    previousPhaseReceipt: {
      phaseReceiptId: `kw-shadow-phase:${previousDigest}`,
      phaseReceiptDigest: previousDigest,
      completedAt: fixture.request.requestedAt,
    },
    workflow: {
      workflowId: fixture.request.workflowId,
      requestedAt: fixture.request.requestedAt,
      completedAt: fixture.receipt.completedAt,
      requestDigest: artifactReferenceDigest(fixture.request),
      receiptId: `workflow-receipt:${artifactReferenceDigest(fixture.receipt)}`,
      receiptDigest: artifactReferenceDigest(fixture.receipt),
      durablePlanDigest: artifactReferenceDigest({ request: fixture.request, receipt: fixture.receipt }),
      pageSelectionDigest: artifactReferenceDigest(pageSelection),
      auditAssemblyDigest: artifactReferenceDigest(auditAssembly),
      auditDigest: artifactReferenceDigest(audit),
      artifactSetDigest: artifactReferenceDigest(artifactEvidence),
    },
    audit: {
      auditVersion: audit.auditVersion,
      classification: audit.classification,
      rebuildNeedScore: audit.rebuildNeedScore,
      evidenceConfidence: audit.evidenceConfidence,
      finalUrl: audit.finalUrl,
    },
    homeEvidence: {
      pageKind: "HOME" as const,
      finalUrl: home.finalUrl!,
      htmlComplete: true as const,
      capturedProfiles: ["DESKTOP_1440X900", "MOBILE_390X844"] as const,
      artifactManifestIds: [...home.artifactReceiptIds].sort((left, right) => left.localeCompare(right, "en-CA")),
    },
    artifactEvidence,
    evidenceFreshThrough: availabilityBoundary,
    preparedAt,
    requiredEligibilityReceiptKind: "CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY" as const,
    authority: privateKwCurrentWebsiteEvidenceAuthority(),
  };
  const proofDigest = artifactReferenceDigest(core);
  return PrivateKwCurrentWebsiteEvidenceProofSchema.parse({
    ...core,
    proofId: `website-evidence:${proofDigest}`,
    proofDigest,
  });
}

function progressContextForWebsiteEvidence(
  fixture: Awaited<ReturnType<typeof buildFixture>>,
) {
  const baseManifest = createPrivateKwShadowSourceWorkflowFixture({
    suffix: "durable-eligibility-progress",
    now: new Date(REQUESTED_AT),
  }).manifest;
  const baseRecord = baseManifest.records[0];
  if (!baseRecord) throw new Error("Website evidence progress fixture requires one manifest record.");
  const evaluationCandidateId = `evaluation:${BUSINESS_ID}`;
  const sourceRecordId = `source:${BUSINESS_ID}`;
  const records = baseManifest.records.map((record, index) => index === 0 ? {
    ...record,
    businessId: BUSINESS_ID,
    evaluationCandidateId,
    sourceRecordId,
    businessName: "Atomic Decoder Roofing",
    sourceEvidenceUrl: fixture.request.sourceEvidenceUrl,
    websiteUrl: fixture.request.websiteUrl,
  } : record);
  const {
    manifestId: _manifestId,
    manifestDigest: _manifestDigest,
    ...manifestCore
  } = baseManifest;
  void _manifestId;
  void _manifestDigest;
  const reboundManifestCore = { ...manifestCore, records };
  const manifestDigest = privateKwShadowSliceDigest(reboundManifestCore);
  const manifest = PrivateKwShadowSliceManifestSchema.parse({
    ...reboundManifestCore,
    manifestId: `kw-shadow-slice:${manifestDigest}`,
    manifestDigest,
  });

  const sourceCompletedAt = new Date(Date.parse(fixture.request.requestedAt) - 1_000).toISOString();
  const sourceMaterializationDigest = artifactReferenceDigest({
    businessId: BUSINESS_ID,
    manifestDigest,
    phase: "SOURCE_WORKFLOW",
  });
  const workflowReceiptDigest = artifactReferenceDigest(fixture.receipt);
  const sourceInput = PrivateKwShadowSlicePhaseReceiptInputSchema.parse({
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    businessId: BUSINESS_ID,
    evaluationCandidateId,
    phase: "SOURCE_WORKFLOW",
    completedAt: sourceCompletedAt,
    proof: {
      proofKind: "SOURCE_WORKFLOW_MATERIALIZATION",
      primaryReceiptId: `kw-materialization:${sourceMaterializationDigest}`,
      primaryReceiptDigest: sourceMaterializationDigest,
      supportingReceipts: [{
        receiptId: `workflow-receipt:${workflowReceiptDigest}`,
        receiptDigest: workflowReceiptDigest,
      }],
    },
    previousPhaseReceipt: null,
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt: sourceCompletedAt,
    authority: privateKwShadowSliceProgressAuthority(),
  });
  const initialProgress = buildInitialPrivateKwShadowSliceProgress(manifest);
  const sourceProgress = appendPrivateKwShadowSliceProgress(manifest, initialProgress, sourceInput);
  const sourceReceipt = sourceProgress.records.find(
    (record) => record.businessId === BUSINESS_ID,
  )?.phaseReceipts[0];
  if (!sourceReceipt) throw new Error("Website evidence progress fixture lost its source predecessor.");

  const baseEvidence = currentWebsiteEvidenceProof(fixture);
  const {
    proofId: _proofId,
    proofDigest: _proofDigest,
    ...evidenceCore
  } = baseEvidence;
  void _proofId;
  void _proofDigest;
  const reboundEvidenceCore = {
    ...evidenceCore,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    evaluationCandidateId,
    sourceRecordId,
    previousPhaseReceipt: {
      phaseReceiptId: sourceReceipt.phaseReceiptId,
      phaseReceiptDigest: sourceReceipt.phaseReceiptDigest,
      completedAt: sourceReceipt.completedAt,
    },
  };
  const proofDigest = artifactReferenceDigest(reboundEvidenceCore);
  const evidence = PrivateKwCurrentWebsiteEvidenceProofSchema.parse({
    ...reboundEvidenceCore,
    proofId: `website-evidence:${proofDigest}`,
    proofDigest,
  });
  return {
    manifest,
    initialProgress,
    sourceInput,
    sourceProgress,
    sourceReceipt,
    evidence,
  };
}

async function durableEligibilityProgressFixture() {
  const timing = currentSnapshotTiming();
  const { fixture, database } = await persistedDatabaseFixture(timing);
  const context = progressContextForWebsiteEvidence(fixture);
  const executions = await trustedWebsiteArtifactExecutions(database, fixture, timing);
  const receipt = buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: context.evidence,
    trustedExecutionValues: executions,
    evaluatedAt: new Date().toISOString(),
  });
  const boundary = sqliteD1Boundary(database);
  const committed = await persistPrivateKwWebsiteEvidenceEligibilityD1(boundary, receipt);
  const reloaded = await loadPrivateKwWebsiteEvidenceEligibilityD1(boundary, {
    receiptId: receipt.receiptId,
    receiptDigest: receipt.receiptDigest,
  });
  const recordedAt = new Date(Date.parse(reloaded.databaseNow) + 1).toISOString();
  return {
    ...context,
    database,
    boundary,
    receipt,
    committed,
    reloaded,
    recordedAt,
  };
}

async function trustedWebsiteArtifactExecutions(
  database: Database.Database,
  fixture: Awaited<ReturnType<typeof buildFixture>>,
  timing: SnapshotTiming,
) {
  const attemptIds = [
    "45000000-0000-4000-8000-000000000001",
    "45000000-0000-4000-8000-000000000002",
    "45000000-0000-4000-8000-000000000003",
    "45000000-0000-4000-8000-000000000004",
    "45000000-0000-4000-8000-000000000005",
  ];
  const boundary = sqliteD1Boundary(database);
  const executions = [];
  for (const [index, manifest] of fixture.receipt.artifactManifests.entries()) {
    const attemptId = attemptIds[index];
    if (!attemptId) throw new Error("Website artifact fixture exceeds its bounded snapshot identities.");
    const plan = buildArtifactReferenceAtomicPlan({
      attemptId,
      workflowRunId: fixture.request.workflowId,
      businessId: fixture.request.businessId,
      lineageRootManifestId: manifest.manifestId,
      attemptNumber: 1,
      fencingToken: 1,
      ownerId: `fixture-owner-website-eligibility-${index + 1}`,
      requestedAt: timing.requestedAt,
      acquiredAt: timing.acquiredAt,
      expiresAt: timing.expiresAt,
      mode: "SHADOW",
      maxCostUsd: 0,
    });
    executions.push(await executeArtifactReferenceD1Snapshot(boundary, plan));
  }
  return executions;
}

function sqliteD1Boundary(database: Database.Database):
ArtifactReferenceD1BatchBoundary & PrivateKwWebsiteEvidenceEligibilityD1Boundary {
  return {
    async batch(statements) {
      return database.transaction((batch: readonly (
        ArtifactReferenceD1BatchStatement | PrivateKwWebsiteEvidenceEligibilityD1Statement
      )[]) => batch.map((statement) => {
        const prepared = database.prepare(statement.sql);
        if (prepared.reader) {
          return {
            success: true as const,
            results: prepared.all(...statement.bindings) as Array<Record<string, string | number | null>>,
            changes: 0,
          };
        }
        const mutation = prepared.run(...statement.bindings);
        return { success: true as const, results: [], changes: mutation.changes };
      }))(statements);
    },
  };
}

function tableCount(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as { count: number }).count;
}

test("private D1 executor commits, post-verifies, reloads, and exactly replays one trusted receipt", async () => {
  const { database, plan } = await persistedDatabaseFixture(currentSnapshotTiming());
  const boundary = sqliteD1Boundary(database);
  const committed = await executeArtifactReferenceD1Snapshot(boundary, plan);
  assert.equal(committed.executionPath, "FRESH_COMMIT");
  assert.equal(committed.transactionallyTrusted, true);
  assert.equal(committed.snapshotComplete, true);
  assert.equal(committed.committedReceiptReloaded, true);
  assert.equal(committed.receiptCreationPerformed, true);
  assert.equal(committed.sourceRowsMaterialized, true);
  assert.ok(committed.decodedSnapshot);
  assert.equal(committed.decodedSnapshot.transactionallyTrusted, false);
  assert.equal(committed.receipt.sourceSetProofs.length, 15);
  assert.equal(committed.receipt.sourceFactsDigest, committed.decodedSnapshot.selectedLineage.sourceFactsDigest);
  assert.equal(committed.retentionConclusionAuthorized, false);
  assert.equal(committed.projectionPersistenceAuthorized, false);
  assert.equal(committed.releaseAuthorized, false);
  assert.equal(committed.deletionAuthorized, false);
  assert.equal(committed.providerOperationsAuthorized, 0);
  assert.equal(committed.costAuthorizedUsd, 0);
  assert.equal(tableCount(database, "RevenueArtifactReferenceCompletenessReceipt"), 1);
  assert.equal(tableCount(database, "RevenueArtifactReferenceSourceSetProof"), 15);

  const replayed = await executeArtifactReferenceD1Snapshot(boundary, plan);
  assert.equal(replayed.executionPath, "EXACT_SEALED_REPLAY");
  assert.equal(replayed.receiptCreationPerformed, false);
  assert.equal(replayed.sourceRowsMaterialized, false);
  assert.equal(replayed.decodedSnapshot, null);
  assert.deepEqual(replayed.receipt, committed.receipt);
  assert.equal(tableCount(database, "RevenueArtifactReferenceCompletenessReceipt"), 1);
  assert.equal(tableCount(database, "RevenueArtifactReferenceSourceSetProof"), 15);
  database.close();
});

test("current website evidence eligibility binds every exact trusted D1 and R2 manifest receipt with zero authority", async () => {
  const timing = currentSnapshotTiming();
  const { fixture, database } = await persistedDatabaseFixture(timing);
  const evidence = currentWebsiteEvidenceProof(fixture);
  const executions = await trustedWebsiteArtifactExecutions(database, fixture, timing);
  const evaluatedAt = new Date().toISOString();
  const first = buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: executions,
    evaluatedAt,
  });
  const reordered = buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: [...executions].reverse(),
    evaluatedAt,
  });

  assert.deepEqual(reordered, first);
  assert.deepEqual(PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema.parse(first), first);
  assert.equal(first.receiptId, `website-evidence-eligibility:${first.receiptDigest}`);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.artifacts), true);
  assert.equal(requireInProcessPrivateKwCurrentWebsiteEvidenceEligibilityReceipt(first), first);
  assert.equal(first.websiteEvidence.proofId, evidence.proofId);
  assert.equal(first.persistedWorkflow.workflowId, fixture.request.workflowId);
  assert.equal(first.artifacts.length, fixture.receipt.artifactManifests.length);
  assert.equal(new Set(first.artifacts.map((artifact) => artifact.completeness.receiptId)).size, first.artifacts.length);
  assert(first.artifacts.every((artifact) => artifact.availability.checkerKind === "R2_HEAD"));
  assert(first.artifacts.every((artifact) => artifact.availability.providerReadPerformed));
  assert(first.artifacts.every((artifact) => artifact.completeness.executionPath === "FRESH_COMMIT"));
  assert.equal(first.authority.validationOnly, true);
  assert.equal(first.authority.exactTrustedExecutionInstancesRequired, true);
  assert.equal(first.authority.phaseInputCreationAuthorized, false);
  assert.equal(first.authority.progressReceiptCreationAuthorized, false);
  assert.equal(first.authority.phaseAdvancementAuthorized, false);
  assert.equal(first.authority.browserCaptureAuthorized, false);
  assert.equal(first.authority.r2ReadAuthorized, false);
  assert.equal(first.authority.databaseMutationAuthorized, false);
  assert.equal(first.authority.providerOperationsAuthorized, 0);
  assert.equal(first.authority.costAuthorizedUsd, 0);
  database.close();
});

test("website evidence eligibility commits once and reloads durably without laundering copied JSON", async () => {
  const timing = currentSnapshotTiming();
  const { fixture, database } = await persistedDatabaseFixture(timing);
  const evidence = currentWebsiteEvidenceProof(fixture);
  const executions = await trustedWebsiteArtifactExecutions(database, fixture, timing);
  const receipt = buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: executions,
    evaluatedAt: new Date().toISOString(),
  });
  const boundary = sqliteD1Boundary(database);

  const committed = await persistPrivateKwWebsiteEvidenceEligibilityD1(boundary, receipt);
  assert.equal(committed.executionPath, "FRESH_COMMIT");
  assert.equal(committed.freshnessState, "CURRENT");
  assert.equal(committed.databaseMutationPerformed, true);
  assert.equal(committed.committedAndReloaded, true);
  assert.equal(committed.artifactCount, receipt.artifacts.length);
  assert.equal(committed.artifactsDigest, artifactReferenceDigest(receipt.artifacts));
  assert.equal(committed.phaseInputCreationAuthorized, false);
  assert.equal(committed.progressReceiptCreationAuthorized, false);
  assert.equal(committed.phaseAdvancementAuthorized, false);
  assert.equal(committed.providerOperationsAuthorized, 0);
  assert.equal(committed.costAuthorizedUsd, 0);
  assert.equal(requireCurrentPrivateKwWebsiteEvidenceEligibilityD1Result(committed), committed);
  assert.equal(tableCount(database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"), 1);

  const replayed = await persistPrivateKwWebsiteEvidenceEligibilityD1(boundary, receipt);
  assert.equal(replayed.executionPath, "EXACT_REPLAY");
  assert.equal(replayed.databaseMutationPerformed, false);
  assert.deepEqual(replayed.receipt, receipt);
  assert.equal(tableCount(database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"), 1);

  const reloaded = await loadPrivateKwWebsiteEvidenceEligibilityD1(boundary, {
    receiptId: receipt.receiptId,
    receiptDigest: receipt.receiptDigest,
  });
  assert.equal(reloaded.executionPath, "DURABLE_RELOAD");
  assert.equal(reloaded.freshnessState, "CURRENT");
  assert.equal(reloaded.databaseMutationPerformed, false);
  assert.deepEqual(reloaded.receipt, receipt);
  assert.equal(Object.isFrozen(reloaded), true);
  assert.equal(Object.isFrozen(reloaded.receipt.artifacts), true);
  assert.equal(requireTrustedPrivateKwWebsiteEvidenceEligibilityD1Result(reloaded), reloaded);
  assert.throws(
    () => requireTrustedPrivateKwWebsiteEvidenceEligibilityD1Result(structuredClone(reloaded)),
    /exact in-process result/i,
  );

  let copiedBoundaryCalls = 0;
  const copiedBoundary: PrivateKwWebsiteEvidenceEligibilityD1Boundary = {
    async batch(statements) {
      copiedBoundaryCalls += 1;
      return boundary.batch(statements);
    },
  };
  await assert.rejects(
    () => persistPrivateKwWebsiteEvidenceEligibilityD1(copiedBoundary, structuredClone(receipt)),
    /exact in-process result/i,
  );
  assert.equal(copiedBoundaryCalls, 0);

  assert.throws(
    () => database.prepare(`UPDATE "RevenueCurrentWebsiteEvidenceEligibilityReceipt"
      SET "manifestDigest" = ? WHERE "id" = ?`).run("f".repeat(64), receipt.receiptId),
    /REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_APPEND_ONLY/,
  );
  assert.throws(
    () => database.prepare(`DELETE FROM "RevenueCurrentWebsiteEvidenceEligibilityReceipt"
      WHERE "id" = ?`).run(receipt.receiptId),
    /REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_APPEND_ONLY/,
  );
  assert.equal(tableCount(database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"), 1);
  database.close();
});

test("durable website evidence eligibility preserves stale history but refuses current use", async () => {
  const timing = currentSnapshotTiming();
  const { fixture, database } = await persistedDatabaseFixture(timing);
  const evidence = currentWebsiteEvidenceProof(fixture);
  const executions = await trustedWebsiteArtifactExecutions(database, fixture, timing);
  const receipt = buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: executions,
    evaluatedAt: new Date().toISOString(),
  });
  const boundary = sqliteD1Boundary(database);
  await persistPrivateKwWebsiteEvidenceEligibilityD1(boundary, receipt);

  const staleBoundary: PrivateKwWebsiteEvidenceEligibilityD1Boundary = {
    async batch(statements) {
      const results = structuredClone(await boundary.batch(statements)) as Array<{
        success: true;
        results: Array<Record<string, string | number | null>>;
        changes: number;
      }>;
      const timeIndex = statements.findIndex(
        (statement) => statement.statementId === "read:eligibility_database_time",
      );
      const time = results[timeIndex]?.results[0];
      if (time) time.databaseNow = receipt.evidenceFreshThrough;
      return results;
    },
  };
  const historical = await loadPrivateKwWebsiteEvidenceEligibilityD1(staleBoundary, {
    receiptId: receipt.receiptId,
    receiptDigest: receipt.receiptDigest,
  });
  assert.equal(historical.freshnessState, "STALE");
  assert.equal(requireTrustedPrivateKwWebsiteEvidenceEligibilityD1Result(historical), historical);
  assert.throws(
    () => requireCurrentPrivateKwWebsiteEvidenceEligibilityD1Result(historical),
    /not current at the database clock/i,
  );
  assert.equal(historical.phaseAdvancementAuthorized, false);
  assert.equal(historical.runtimeConnected, false);
  database.close();
});

test("durable website evidence eligibility refuses reload when any migration writer guard is missing", async () => {
  const timing = currentSnapshotTiming();
  const { fixture, database } = await persistedDatabaseFixture(timing);
  const evidence = currentWebsiteEvidenceProof(fixture);
  const executions = await trustedWebsiteArtifactExecutions(database, fixture, timing);
  const receipt = buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: executions,
    evaluatedAt: new Date().toISOString(),
  });
  const boundary = sqliteD1Boundary(database);
  const triggerRow = database.prepare(`SELECT "sql" FROM "sqlite_master"
    WHERE "type" = 'trigger'
      AND "name" = 'RevenueCurrentWebsiteEvidenceEligibilityReceipt_immutable_delete'`).get() as {
    sql: string;
  };
  database.exec(
    `DROP TRIGGER "RevenueCurrentWebsiteEvidenceEligibilityReceipt_immutable_delete"`,
  );
  await assert.rejects(
    () => persistPrivateKwWebsiteEvidenceEligibilityD1(boundary, receipt),
    /every exact migration-0068 writer guard/i,
  );
  assert.equal(tableCount(database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"), 0);

  database.exec(triggerRow.sql);
  await persistPrivateKwWebsiteEvidenceEligibilityD1(boundary, receipt);
  database.exec(
    `DROP TRIGGER "RevenueCurrentWebsiteEvidenceEligibilityReceipt_immutable_delete"`,
  );
  await assert.rejects(
    () => loadPrivateKwWebsiteEvidenceEligibilityD1(boundary, {
      receiptId: receipt.receiptId,
      receiptDigest: receipt.receiptDigest,
    }),
    /every exact migration-0068 writer guard/i,
  );
  assert.equal(tableCount(database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"), 1);
  database.close();
});

test("website evidence eligibility rolls back a forged lineage insert before any receipt persists", async () => {
  const timing = currentSnapshotTiming();
  const { fixture, database } = await persistedDatabaseFixture(timing);
  const evidence = currentWebsiteEvidenceProof(fixture);
  const executions = await trustedWebsiteArtifactExecutions(database, fixture, timing);
  const receipt = buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: executions,
    evaluatedAt: new Date().toISOString(),
  });
  const boundary = sqliteD1Boundary(database);
  const forgedBoundary: PrivateKwWebsiteEvidenceEligibilityD1Boundary = {
    async batch(statements) {
      const forgedStatements = statements.map((statement) => {
        if (statement.statementId !== "insert:website_evidence_eligibility_receipt") {
          return statement;
        }
        const bindings = [...statement.bindings];
        bindings[6] = "business:forged-eligibility";
        return { ...statement, bindings };
      });
      return boundary.batch(forgedStatements);
    },
  };

  await assert.rejects(
    () => persistPrivateKwWebsiteEvidenceEligibilityD1(forgedBoundary, receipt),
    /REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_LINEAGE_MISMATCH|FOREIGN KEY constraint failed/,
  );
  assert.equal(tableCount(database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"), 0);

  const committed = await persistPrivateKwWebsiteEvidenceEligibilityD1(boundary, receipt);
  assert.equal(committed.executionPath, "FRESH_COMMIT");
  assert.equal(tableCount(database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"), 1);
  database.close();
});

test("website evidence eligibility detects replay-row collisions without changing stored history", async () => {
  const timing = currentSnapshotTiming();
  const { fixture, database } = await persistedDatabaseFixture(timing);
  const evidence = currentWebsiteEvidenceProof(fixture);
  const executions = await trustedWebsiteArtifactExecutions(database, fixture, timing);
  const receipt = buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: executions,
    evaluatedAt: new Date().toISOString(),
  });
  const boundary = sqliteD1Boundary(database);
  await persistPrivateKwWebsiteEvidenceEligibilityD1(boundary, receipt);

  const driftedReloadBoundary: PrivateKwWebsiteEvidenceEligibilityD1Boundary = {
    async batch(statements) {
      const results = structuredClone(await boundary.batch(statements)) as Array<{
        success: true;
        results: Array<Record<string, string | number | null>>;
        changes: number;
      }>;
      const reloadIndex = statements.findIndex(
        (statement) => statement.statementId === "read:website_evidence_eligibility_receipt",
      );
      const reloadedRow = results[reloadIndex]?.results[0];
      if (reloadedRow) reloadedRow.manifestDigest = "f".repeat(64);
      return results;
    },
  };

  await assert.rejects(
    () => persistPrivateKwWebsiteEvidenceEligibilityD1(driftedReloadBoundary, receipt),
    /does not exactly match its mirrored durable row/i,
  );
  assert.equal(tableCount(database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"), 1);

  const reloaded = await loadPrivateKwWebsiteEvidenceEligibilityD1(boundary, {
    receiptId: receipt.receiptId,
    receiptDigest: receipt.receiptDigest,
  });
  assert.deepEqual(reloaded.receipt, receipt);
  database.close();
});

test("current website evidence progress input requires an exact current durable reload and creates no checkpoint", async () => {
  const fixture = await durableEligibilityProgressFixture();
  try {
    const phaseInput = buildPrivateKwCurrentWebsiteEvidenceProgressInput({
      manifestValue: fixture.manifest,
      previousProgressValue: fixture.sourceProgress,
      websiteEvidenceProofValue: fixture.evidence,
      currentEligibilityResultValue: fixture.reloaded,
      recordedAt: fixture.recordedAt,
    });

    assert.equal(phaseInput.phase, "CURRENT_WEBSITE_EVIDENCE");
    assert.equal(phaseInput.completedAt, fixture.reloaded.receiptRecordedAt);
    assert.equal(phaseInput.proof.primaryReceiptId, fixture.evidence.proofId);
    assert.equal(phaseInput.proof.primaryReceiptDigest, fixture.evidence.proofDigest);
    assert.deepEqual(phaseInput.proof.supportingReceipts, [{
      receiptId: fixture.receipt.receiptId,
      receiptDigest: fixture.receipt.receiptDigest,
    }]);
    assert.equal(
      phaseInput.previousPhaseReceipt?.phaseReceiptId,
      fixture.sourceReceipt.phaseReceiptId,
    );
    assert.equal(phaseInput.authority.progressRecordingOnly, true);
    assert.equal(phaseInput.authority.phaseExecutionAuthorized, false);
    assert.equal(phaseInput.authority.databaseMutationAuthorized, false);
    assert.equal(phaseInput.authority.browserCaptureAuthorized, false);
    assert.equal(phaseInput.authority.providerOperationsAuthorized, 0);
    assert.equal(phaseInput.authority.costAuthorizedUsd, 0);
    assert.equal(Object.isFrozen(phaseInput), true);
    assert.equal(Object.isFrozen(phaseInput.proof), true);
    assert.equal(requireInProcessPrivateKwCurrentWebsiteEvidenceProgressInput(phaseInput), phaseInput);
    assert.throws(
      () => requireInProcessPrivateKwCurrentWebsiteEvidenceProgressInput(structuredClone(phaseInput)),
      /exact in-process result/i,
    );

    const unchanged = fixture.sourceProgress.records.find(
      (record) => record.businessId === phaseInput.businessId,
    );
    assert.equal(unchanged?.phaseReceipts.length, 1);
    assert.equal(unchanged?.currentCheckpoint, "SOURCE_WORKFLOW_PERSISTED");
    assert.equal(tableCount(fixture.database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"), 1);
  } finally {
    fixture.database.close();
  }
});

test("current website evidence progress rejects commit responses, copied trust, stale reloads, and false chronology", async () => {
  const fixture = await durableEligibilityProgressFixture();
  const build = (eligibility: unknown, recordedAt = fixture.recordedAt) => (
    buildPrivateKwCurrentWebsiteEvidenceProgressInput({
      manifestValue: fixture.manifest,
      previousProgressValue: fixture.sourceProgress,
      websiteEvidenceProofValue: fixture.evidence,
      currentEligibilityResultValue: eligibility,
      recordedAt,
    })
  );
  try {
    assert.throws(() => build(fixture.committed), /exact current durable reload/i);
    assert.throws(() => build(structuredClone(fixture.reloaded)), /exact in-process result/i);
    assert.throws(
      () => build(
        fixture.reloaded,
        new Date(Date.parse(fixture.reloaded.databaseNow) - 1).toISOString(),
      ),
      /chronology.*current evidence window/i,
    );
    assert.throws(
      () => build(fixture.reloaded, fixture.receipt.evidenceFreshThrough),
      /chronology.*current evidence window/i,
    );

    const staleBoundary: PrivateKwWebsiteEvidenceEligibilityD1Boundary = {
      async batch(statements) {
        const results = structuredClone(await fixture.boundary.batch(statements)) as Array<{
          success: true;
          results: Array<Record<string, string | number | null>>;
          changes: number;
        }>;
        const timeIndex = statements.findIndex(
          (statement) => statement.statementId === "read:eligibility_database_time",
        );
        const time = results[timeIndex]?.results[0];
        if (time) time.databaseNow = fixture.receipt.evidenceFreshThrough;
        return results;
      },
    };
    const stale = await loadPrivateKwWebsiteEvidenceEligibilityD1(staleBoundary, {
      receiptId: fixture.receipt.receiptId,
      receiptDigest: fixture.receipt.receiptDigest,
    });
    assert.equal(stale.freshnessState, "STALE");
    assert.throws(() => build(stale), /not current at the database clock/i);
  } finally {
    fixture.database.close();
  }
});

test("current website evidence progress rejects predecessor and proof lineage drift", async () => {
  const fixture = await durableEligibilityProgressFixture();
  try {
    const replacementDigest = artifactReferenceDigest({
      original: fixture.sourceInput.proof.primaryReceiptDigest,
      replacement: true,
    });
    const replacementSourceInput = PrivateKwShadowSlicePhaseReceiptInputSchema.parse({
      ...fixture.sourceInput,
      proof: {
        ...fixture.sourceInput.proof,
        primaryReceiptId: `kw-materialization:${replacementDigest}`,
        primaryReceiptDigest: replacementDigest,
      },
    });
    const replacementProgress = appendPrivateKwShadowSliceProgress(
      fixture.manifest,
      fixture.initialProgress,
      replacementSourceInput,
    );
    assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceProgressInput({
      manifestValue: fixture.manifest,
      previousProgressValue: replacementProgress,
      websiteEvidenceProofValue: fixture.evidence,
      currentEligibilityResultValue: fixture.reloaded,
      recordedAt: fixture.recordedAt,
    }), /exact completed source\/workflow predecessor/i);

    const {
      proofId: _proofId,
      proofDigest: _proofDigest,
      ...evidenceCore
    } = fixture.evidence;
    void _proofId;
    void _proofDigest;
    const driftedEvidenceCore = {
      ...evidenceCore,
      sourceRecordId: "source:cross-business-drift",
    };
    const driftedDigest = artifactReferenceDigest(driftedEvidenceCore);
    const driftedEvidence = PrivateKwCurrentWebsiteEvidenceProofSchema.parse({
      ...driftedEvidenceCore,
      proofId: `website-evidence:${driftedDigest}`,
      proofDigest: driftedDigest,
    });
    assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceProgressInput({
      manifestValue: fixture.manifest,
      previousProgressValue: fixture.sourceProgress,
      websiteEvidenceProofValue: driftedEvidence,
      currentEligibilityResultValue: fixture.reloaded,
      recordedAt: fixture.recordedAt,
    }), /exact website-bearing manifest business/i);
  } finally {
    fixture.database.close();
  }
});

test("guarded website evidence append advances exactly once and replays the same in-memory checkpoint", async () => {
  const fixture = await durableEligibilityProgressFixture();
  try {
    const phaseInput = buildPrivateKwCurrentWebsiteEvidenceProgressInput({
      manifestValue: fixture.manifest,
      previousProgressValue: fixture.sourceProgress,
      websiteEvidenceProofValue: fixture.evidence,
      currentEligibilityResultValue: fixture.reloaded,
      recordedAt: fixture.recordedAt,
    });
    const first = appendPrivateKwCurrentWebsiteEvidenceProgress({
      manifestValue: fixture.manifest,
      previousProgressValue: structuredClone(fixture.sourceProgress),
      phaseInputValue: phaseInput,
    });
    const replayed = appendPrivateKwCurrentWebsiteEvidenceProgress({
      manifestValue: fixture.manifest,
      previousProgressValue: fixture.sourceProgress,
      phaseInputValue: phaseInput,
    });

    assert.equal(replayed, first);
    assert.equal(first.parentCheckpoint?.checkpointId, fixture.sourceProgress.checkpointId);
    assert.equal(first.parentCheckpoint?.checkpointDigest, fixture.sourceProgress.checkpointDigest);
    assert.equal(
      first.summary.completedPhaseReceipts,
      fixture.sourceProgress.summary.completedPhaseReceipts + 1,
    );
    const advanced = first.records.find((record) => record.businessId === phaseInput.businessId);
    const previous = fixture.sourceProgress.records.find(
      (record) => record.businessId === phaseInput.businessId,
    );
    assert.ok(advanced);
    assert.ok(previous);
    assert.equal(advanced.phaseReceipts.length, previous.phaseReceipts.length + 1);
    assert.equal(advanced.currentCheckpoint, "CURRENT_WEBSITE_EVIDENCE_PERSISTED");
    assert.equal(advanced.nextRequiredGate, "ASSESSMENT_APPROVAL");
    assert.equal(advanced.phaseReceipts.at(-1)?.proof.primaryReceiptId, fixture.evidence.proofId);
    assert.deepEqual(
      first.records.filter((record) => record.businessId !== phaseInput.businessId),
      fixture.sourceProgress.records.filter((record) => record.businessId !== phaseInput.businessId),
    );
    assert.equal(first.authority.phaseExecutionAuthorized, false);
    assert.equal(first.authority.databaseMutationAuthorized, false);
    assert.equal(first.authority.providerOperationsAuthorized, 0);
    assert.equal(first.authority.costAuthorizedUsd, 0);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(advanced.phaseReceipts), true);
    assert.equal(
      requireInProcessPrivateKwCurrentWebsiteEvidenceProgressCheckpoint(first),
      first,
    );
    assert.throws(
      () => requireInProcessPrivateKwCurrentWebsiteEvidenceProgressCheckpoint(
        structuredClone(first),
      ),
      /exact in-process result/i,
    );
    assert.equal(
      fixture.sourceProgress.records.find(
        (record) => record.businessId === phaseInput.businessId,
      )?.phaseReceipts.length,
      1,
    );
    assert.equal(
      tableCount(fixture.database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"),
      1,
    );
  } finally {
    fixture.database.close();
  }
});

test("guarded website evidence append rejects copied input and any changed parent checkpoint", async () => {
  const fixture = await durableEligibilityProgressFixture();
  try {
    const phaseInput = buildPrivateKwCurrentWebsiteEvidenceProgressInput({
      manifestValue: fixture.manifest,
      previousProgressValue: fixture.sourceProgress,
      websiteEvidenceProofValue: fixture.evidence,
      currentEligibilityResultValue: fixture.reloaded,
      recordedAt: fixture.recordedAt,
    });
    const append = (previousProgressValue: unknown, phaseInputValue: unknown) => (
      appendPrivateKwCurrentWebsiteEvidenceProgress({
        manifestValue: fixture.manifest,
        previousProgressValue,
        phaseInputValue,
      })
    );

    assert.throws(
      () => append(fixture.sourceProgress, structuredClone(phaseInput)),
      /exact in-process result/i,
    );

    const {
      checkpointId: _checkpointId,
      checkpointDigest: _checkpointDigest,
      ...parentCore
    } = fixture.sourceProgress;
    void _checkpointId;
    void _checkpointDigest;
    const changedParentCore = {
      ...parentCore,
      createdAt: new Date(Date.parse(parentCore.createdAt) + 1).toISOString(),
    };
    const changedParentDigest = privateKwShadowSliceProgressDigest(changedParentCore);
    const changedParent = PrivateKwShadowSliceProgressCheckpointSchema.parse({
      ...changedParentCore,
      checkpointId: `kw-shadow-progress:${changedParentDigest}`,
      checkpointDigest: changedParentDigest,
    });
    assert.throws(
      () => append(changedParent, phaseInput),
      /exact unchanged manifest and parent checkpoint/i,
    );

    const completed = append(fixture.sourceProgress, phaseInput);
    assert.throws(
      () => append(completed, phaseInput),
      /exact unchanged manifest and parent checkpoint/i,
    );
    assert.equal(
      tableCount(fixture.database, "RevenueCurrentWebsiteEvidenceEligibilityReceipt"),
      1,
    );
  } finally {
    fixture.database.close();
  }
});

test("website evidence eligibility rejects copied trust, incomplete coverage, drift, stale windows, and output tampering", async () => {
  const timing = currentSnapshotTiming();
  const { fixture, database } = await persistedDatabaseFixture(timing);
  const evidence = currentWebsiteEvidenceProof(fixture);
  const executions = await trustedWebsiteArtifactExecutions(database, fixture, timing);
  const evaluatedAt = new Date().toISOString();
  const receipt = buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: executions,
    evaluatedAt,
  });

  assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: [structuredClone(executions[0]), ...executions.slice(1)],
    evaluatedAt,
  }), /exact in-process result/i);
  assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: executions.slice(1),
    evaluatedAt,
  }), /one exact trusted completeness execution per artifact manifest/i);

  const { proofId: _proofId, proofDigest: _proofDigest, ...evidenceCore } = evidence;
  void _proofId;
  void _proofDigest;
  const driftedCore = { ...evidenceCore, businessId: "business:forged-eligibility" };
  const driftedDigest = artifactReferenceDigest(driftedCore);
  const driftedEvidence = PrivateKwCurrentWebsiteEvidenceProofSchema.parse({
    ...driftedCore,
    proofId: `website-evidence:${driftedDigest}`,
    proofDigest: driftedDigest,
  });
  assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: driftedEvidence,
    trustedExecutionValues: executions,
    evaluatedAt,
  }), /exact persisted terminal workflow|workflow and business/i);
  assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({
    websiteEvidenceProofValue: evidence,
    trustedExecutionValues: executions,
    evaluatedAt: receipt.evidenceFreshThrough,
  }), /outside its current half-open freshness window/i);
  assert.throws(() => PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema.parse({
    ...receipt,
    businessId: "business:tampered",
  }), /identity must bind/i);
  assert.throws(() => PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema.parse({
    ...receipt,
    authority: { ...receipt.authority, phaseAdvancementAuthorized: true },
  }));
  const { receiptId: _receiptId, receiptDigest: _receiptDigest, ...receiptCore } = receipt;
  void _receiptId;
  void _receiptDigest;
  const stretchedFreshnessCore = {
    ...receiptCore,
    evidenceFreshThrough: new Date(Date.parse(receipt.evidenceFreshThrough) + 1_000).toISOString(),
  };
  const stretchedFreshnessDigest = artifactReferenceDigest(stretchedFreshnessCore);
  assert.throws(() => PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema.parse({
    ...stretchedFreshnessCore,
    receiptId: `website-evidence-eligibility:${stretchedFreshnessDigest}`,
    receiptDigest: stretchedFreshnessDigest,
  }), /exact earliest workflow or artifact boundary/i);
  assert.throws(
    () => requireInProcessPrivateKwCurrentWebsiteEvidenceEligibilityReceipt(structuredClone(receipt)),
    /exact in-process result/i,
  );
  database.close();
});

test("fresh materialized execution projects a complete no-current-reference observation with zero authority", async () => {
  const { database, plan } = await persistedDatabaseFixture(currentSnapshotTiming());
  const execution = await executeArtifactReferenceD1Snapshot(sqliteD1Boundary(database), plan);
  const result = createArtifactReferenceTrustedProjection({
    projectionVersion: ARTIFACT_REFERENCE_TRUSTED_PROJECTION_VERSION,
    projectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    projectedAt: new Date().toISOString(),
    mode: "SHADOW",
    projectorKind: "FRESH_D1_EXECUTION_FIXTURE",
    maxCostUsd: 0,
    execution,
  });
  assert.deepEqual(ArtifactReferenceTrustedProjectionSchema.parse(result), result);
  assert.equal(Object.isFrozen(execution), true);
  assert.equal(Object.isFrozen(execution.receipt), true);
  assert.equal(result.referenceState, "NO_CURRENT_REFERENCES");
  assert.equal(result.noCurrentReferencesObserved, true);
  assert.equal(result.activeUseCount, 0);
  assert.equal(result.snapshotComplete, true);
  assert.equal(result.transactionallyTrustedSource, true);
  assert.equal(result.lineageReplayComplete, true);
  assert.equal(result.retentionConclusionAuthorized, false);
  assert.equal(result.projectionPersistenceAuthorized, false);
  assert.equal(result.projectionPersistencePerformed, false);
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.deletionAuthorized, false);
  assert.equal(result.providerDeleteAuthorized, false);
  assert.equal(result.providerDeletePerformed, false);
  assert.equal(result.providerOperationsAuthorized, 0);
  assert.equal(result.costAuthorizedUsd, 0);
  assert.throws(
    () => ArtifactReferenceTrustedProjectionSchema.parse({ ...result, releaseAuthorized: true }),
    /Invalid input|false/i,
  );
  database.close();
});

test("trusted projection refuses stale windows, exact replay, and structurally cloned trust claims", async () => {
  const { database, plan } = await persistedDatabaseFixture(currentSnapshotTiming());
  const boundary = sqliteD1Boundary(database);
  const execution = await executeArtifactReferenceD1Snapshot(boundary, plan);
  const request = {
    projectionVersion: ARTIFACT_REFERENCE_TRUSTED_PROJECTION_VERSION,
    projectionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    projectedAt: execution.receipt.freshUntil,
    mode: "SHADOW" as const,
    projectorKind: "FRESH_D1_EXECUTION_FIXTURE" as const,
    maxCostUsd: 0 as const,
    execution,
  };
  assert.throws(() => createArtifactReferenceTrustedProjection(request), /fresh half-open completeness window/i);

  const replay = await executeArtifactReferenceD1Snapshot(boundary, plan);
  assert.throws(
    () => createArtifactReferenceTrustedProjection({ ...request, projectedAt: new Date().toISOString(), execution: replay }),
    /fresh D1 commit with materialized source rows/i,
  );

  const cloned = structuredClone(execution);
  assert.throws(
    () => createArtifactReferenceTrustedProjection({ ...request, projectedAt: new Date().toISOString(), execution: cloned }),
    /exact in-process result/i,
  );
  const drifted = structuredClone(execution);
  assert.ok(drifted.decodedSnapshot);
  drifted.decodedSnapshot.selectedLineage.facts.workflowRun.businessId = "business:forged";
  assert.throws(
    () => createArtifactReferenceTrustedProjection({ ...request, projectedAt: new Date().toISOString(), execution: drifted }),
    /digest|exact decoded facts/i,
  );
  database.close();
});

test("complete projection keeps equal-rank current assignments indeterminate and powerless", async () => {
  const { database, plan } = await persistedDatabaseFixture(currentSnapshotTiming(), "AMBIGUOUS_QUALIFICATION");
  const execution = await executeArtifactReferenceD1Snapshot(sqliteD1Boundary(database), plan);
  const result = createArtifactReferenceTrustedProjection({
    projectionVersion: ARTIFACT_REFERENCE_TRUSTED_PROJECTION_VERSION,
    projectionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    projectedAt: new Date().toISOString(),
    mode: "SHADOW",
    projectorKind: "FRESH_D1_EXECUTION_FIXTURE",
    maxCostUsd: 0,
    execution,
  });
  assert.equal(result.referenceState, "INDETERMINATE");
  assert.equal(result.manualReviewRequired, true);
  assert.equal(result.ambiguousUseCount, 1);
  assert.equal(result.basisProjection.uses[0]?.assignmentState, "AMBIGUOUS");
  assert.equal(result.basisProjection.uses[0]?.assignments.length, 2);
  assert.equal(result.retentionConclusionAuthorized, false);
  assert.equal(result.projectionPersistenceAuthorized, false);
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.deletionAuthorized, false);
  database.close();
});

test("private D1 executor detects source-result drift before any completeness commit", async () => {
  const { database, plan } = await persistedDatabaseFixture(currentSnapshotTiming());
  const base = sqliteD1Boundary(database);
  let sourceBatch = 0;
  const drifted: ArtifactReferenceD1BatchBoundary = {
    async batch(statements) {
      const results = await base.batch(statements);
      if (statements.some((statement) => statement.statementId === "source-workflow-runs")) {
        sourceBatch += 1;
        if (sourceBatch === 2) {
          const index = statements.findIndex((statement) => statement.statementId === "source-workflow-runs");
          const cloned = structuredClone(results);
          const result = cloned[index] as { success: true; results: Array<Record<string, string | number | null>>; changes: number };
          result.results[0] = { ...result.results[0], requestDigest: "f".repeat(64) };
          return cloned;
        }
      }
      return results;
    },
  };
  await assert.rejects(() => executeArtifactReferenceD1Snapshot(drifted, plan), /does not match|drift|digest/i);
  assert.equal(tableCount(database, "RevenueArtifactReferenceCompletenessReceipt"), 0);
  assert.equal(tableCount(database, "RevenueArtifactReferenceSourceSetProof"), 0);
  database.close();
});

test("private D1 executor rejects a redigested control-statement forgery before touching D1", async () => {
  const { database, plan } = await persistedDatabaseFixture(currentSnapshotTiming());
  const statements = plan.statements.map((statement) => statement.statementId === "verify-winning-attempt-fence"
    ? { ...statement, sql: statement.sql.replace(/AND NOT EXISTS \([\s\S]*?\n  \)\nORDER BY/, "ORDER BY") }
    : statement);
  const { planDigest: _planDigest, ...core } = plan;
  void _planDigest;
  const forgedCore = { ...core, statements };
  const forged = { ...forgedCore, planDigest: artifactReferenceDigest(forgedCore) };
  let batchCalls = 0;
  const boundary: ArtifactReferenceD1BatchBoundary = {
    async batch(batch) {
      batchCalls += 1;
      return sqliteD1Boundary(database).batch(batch);
    },
  };
  await assert.rejects(() => executeArtifactReferenceD1Snapshot(boundary, forged), /exact immutable atomic plan/i);
  assert.equal(batchCalls, 0);
  assert.equal(tableCount(database, "RevenueArtifactReferenceSnapshotAttempt"), 0);
  database.close();
});

test("private D1 executor refuses trust when any required database writer guard is absent", async () => {
  const { database, plan } = await persistedDatabaseFixture(currentSnapshotTiming());
  database.exec(`DROP TRIGGER "RevenueArtifactManifest_reference_source_freeze_insert"`);
  await assert.rejects(
    () => executeArtifactReferenceD1Snapshot(sqliteD1Boundary(database), plan),
    /requires all 51 source-freeze and append-only triggers|writer guard/i,
  );
  assert.equal(tableCount(database, "RevenueArtifactReferenceSnapshotAttempt"), 0);
  assert.equal(tableCount(database, "RevenueArtifactReferenceCompletenessReceipt"), 0);
  database.close();
});

test("private D1 executor collision-preflights every receipt and proof target before commit", async () => {
  const { database, plan } = await persistedDatabaseFixture(currentSnapshotTiming());
  const base = sqliteD1Boundary(database);
  let inspectedTargetSql = false;
  const collisionBoundary: ArtifactReferenceD1BatchBoundary = {
    async batch(statements) {
      const results = await base.batch(statements);
      const receiptIndex = statements.findIndex((statement) => statement.statementId === "preflight-completeness-targets");
      const proofIndex = statements.findIndex((statement) => statement.statementId === "preflight-proof-targets");
      if (receiptIndex >= 0 && proofIndex >= 0) {
        assert.match(statements[receiptIndex]!.sql, /"snapshotAttemptId" = \?/);
        assert.match(statements[receiptIndex]!.sql, /"receiptDigest" = \?/);
        assert.match(statements[receiptIndex]!.sql, /"lineageRootManifestId" = \?/);
        assert.match(statements[proofIndex]!.sql, /"completenessReceiptId" = \?/);
        assert.match(statements[proofIndex]!.sql, /"id" IN \(/);
        inspectedTargetSql = true;
        const collided: unknown[] = structuredClone([...results]);
        collided[proofIndex] = {
          success: true,
          results: [{ id: "divergent-proof-target" }],
          changes: 0,
        };
        return collided;
      }
      return results;
    },
  };
  await assert.rejects(() => executeArtifactReferenceD1Snapshot(collisionBoundary, plan), /target preflight found a divergent/i);
  assert.equal(inspectedTargetSql, true);
  assert.equal(tableCount(database, "RevenueArtifactReferenceCompletenessReceipt"), 0);
  assert.equal(tableCount(database, "RevenueArtifactReferenceSourceSetProof"), 0);
  database.close();
});

test("private D1 executor rolls back the parent when any proof insert fails", async () => {
  const { database, plan } = await persistedDatabaseFixture(currentSnapshotTiming());
  const base = sqliteD1Boundary(database);
  const brokenCommit: ArtifactReferenceD1BatchBoundary = {
    async batch(statements) {
      if (statements.some((statement) => statement.statementId === "insert-source-proof-08")) {
        const corrupted = statements.map((statement) => statement.statementId === "insert-source-proof-08"
          ? { ...statement, sql: `INSERT INTO "RevenueArtifactReferenceSourceSetProofMissing" ("id") VALUES (?)`, bindings: ["forced-rollback"] }
          : statement);
        return base.batch(corrupted);
      }
      return base.batch(statements);
    },
  };
  await assert.rejects(() => executeArtifactReferenceD1Snapshot(brokenCommit, plan), /completeness commit D1 batch failed/i);
  assert.equal(tableCount(database, "RevenueArtifactReferenceCompletenessReceipt"), 0);
  assert.equal(tableCount(database, "RevenueArtifactReferenceSourceSetProof"), 0);
  assert.equal(tableCount(database, "RevenueArtifactReferenceSnapshotAttempt"), 1);
  database.close();
});

test("private D1 executor rejects expired plans and divergent attempt identity collisions", async () => {
  const expiredNow = Date.now();
  const expiredTiming: SnapshotTiming = {
    requestedAt: new Date(expiredNow - 120_000).toISOString(),
    acquiredAt: new Date(expiredNow - 119_000).toISOString(),
    snapshotAt: new Date(expiredNow - 2_000).toISOString(),
    expiresAt: new Date(expiredNow - 1_000).toISOString(),
    availabilityCheckedAt: new Date(expiredNow - 10_000).toISOString(),
    availabilityValidThrough: new Date(expiredNow + 240_000).toISOString(),
  };
  const expired = await persistedDatabaseFixture(expiredTiming);
  await assert.rejects(() => executeArtifactReferenceD1Snapshot(sqliteD1Boundary(expired.database), expired.plan), /half-open fence|active winning fence/i);
  assert.equal(tableCount(expired.database, "RevenueArtifactReferenceSnapshotAttempt"), 0);
  expired.database.close();

  const collision = await persistedDatabaseFixture(currentSnapshotTiming());
  const collisionTiming = currentSnapshotTiming();
  const divergent = buildArtifactReferenceAtomicPlan({
    attemptId: "99999999-9999-4999-8999-999999999999",
    workflowRunId: collision.plan.attempt.workflowRunId,
    businessId: collision.plan.attempt.businessId,
    lineageRootManifestId: collision.plan.attempt.lineageRootManifestId,
    attemptNumber: 1,
    fencingToken: 1,
    ownerId: "divergent-owner",
    requestedAt: collisionTiming.requestedAt,
    acquiredAt: collisionTiming.acquiredAt,
    expiresAt: collisionTiming.expiresAt,
    mode: "SHADOW",
    maxCostUsd: 0,
  });
  const insert = divergent.statements.find((statement) => statement.statementId === "claim-attempt-fence");
  assert.ok(insert);
  const inserted = collision.database.prepare(insert.sql).run(...insert.bindings);
  assert.equal(inserted.changes, 1);
  await assert.rejects(() => executeArtifactReferenceD1Snapshot(sqliteD1Boundary(collision.database), collision.plan), /collision|does not exactly match/i);
  assert.equal(tableCount(collision.database, "RevenueArtifactReferenceCompletenessReceipt"), 0);
  collision.database.close();
});
