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
      expiresAt: manifest.retentionClass === "SHADOW_30D" ? "2026-09-20T00:00:00.000Z" : null,
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

function sqliteD1Boundary(database: Database.Database): ArtifactReferenceD1BatchBoundary {
  return {
    async batch(statements) {
      return database.transaction((batch: readonly ArtifactReferenceD1BatchStatement[]) => batch.map((statement) => {
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
