import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import type { BrowserMeasurementRunner } from "@/lib/revenue-engine/browser-measurement-adapter";
import { BROWSER_NETWORK_POLICY_VERSION } from "@/lib/revenue-engine/browser-page-evidence";
import {
  createArtifactManifestAvailabilityReceipt,
  type ArtifactManifestObjectAvailability,
} from "@/lib/revenue-engine/artifact-manifest-availability";
import {
  ARTIFACT_REFERENCE_SOURCE_SET_ORDER,
  buildArtifactReferenceAtomicPlan,
} from "@/lib/revenue-engine/artifact-reference-atomic-snapshot";
import { decodeArtifactReferenceD1SourceSnapshot } from "@/lib/revenue-engine/artifact-reference-d1-source-decoder";
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
const REQUESTED_AT = "2026-08-24T12:00:00.000Z";
const CAPTURED_AT = "2026-08-24T12:00:00.000Z";
const SNAPSHOT_AT = "2026-08-24T12:03:00.000Z";
const VALID_THROUGH = "2026-08-24T12:05:00.000Z";

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
    startedAt: "2026-08-24T11:59:30.000Z",
    endedAt: "2026-08-24T12:01:00.000Z",
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
    acquiredAt: "2026-08-24T11:59:31.000Z",
    expiresAt: "2026-08-24T12:02:00.000Z",
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
  ]) database.exec(readFileSync(new URL(`../../../migrations/${migration}`, import.meta.url), "utf8"));
  database.prepare(`INSERT INTO "RevenueBusiness"
    ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status")
    VALUES (?, 'Atomic Decoder Roofing', 'atomic-decoder-roofing.ca', 'UNKNOWN', 'RESEARCH_ONLY')`).run(BUSINESS_ID);
  return database;
}

function insertMutations(database: Database.Database, mutations: Array<{ sql: string; bindings: Array<string | number | null> }>) {
  for (const mutation of mutations) database.prepare(mutation.sql).run(...mutation.bindings);
}

function availabilityObjects(manifest: Awaited<ReturnType<typeof buildFixture>>["receipt"]["artifactManifests"][number]) {
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
    recordedAt: "2026-08-24T12:01:30.000Z",
  });
  return { request, receipt, attempt, claim, revision };
}

async function persistedObservation() {
  const fixture = await buildFixture();
  const database = freshDatabase();
  const durable = buildDurableEvidencePersistencePlan({
    persistencePlanVersion: DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
    plannedAt: SNAPSHOT_AT,
    mode: "SHADOW",
    plannerKind: "FIXTURE",
    maxCostUsd: 0,
    workflowAttemptNumber: 1,
    workflowRequest: fixture.request,
    workflowReceipt: fixture.receipt,
    promotions: [],
    releases: [],
  });
  insertMutations(database, durable.mutations);
  const fenced = buildFencedEvidenceResumePersistencePlan({
    persistencePlanVersion: FENCED_EVIDENCE_RESUME_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION,
    resumeRequest: {
      resumePlanVersion: FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION,
      plannedAt: SNAPSHOT_AT,
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

  for (const [index, manifest] of fixture.receipt.artifactManifests.entries()) {
    const receipt = createArtifactManifestAvailabilityReceipt({
      receiptId: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      manifest,
      checkedAt: "2026-08-24T12:02:30.000Z",
      validThrough: VALID_THROUGH,
      expiresAt: "2026-09-20T00:00:00.000Z",
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

  const rootManifestId = fixture.receipt.artifactManifests[0].manifestId;
  const plan = buildArtifactReferenceAtomicPlan({
    attemptId: SNAPSHOT_ATTEMPT_ID,
    workflowRunId: WORKFLOW_ID,
    businessId: BUSINESS_ID,
    lineageRootManifestId: rootManifestId,
    attemptNumber: 1,
    fencingToken: 1,
    ownerId: "fixture-owner-snapshot",
    requestedAt: "2026-08-24T12:02:00.000Z",
    acquiredAt: "2026-08-24T12:02:01.000Z",
    expiresAt: VALID_THROUGH,
    mode: "SHADOW",
    maxCostUsd: 0,
  });
  const sourceSets = plan.statements.filter((statement) => statement.kind === "SOURCE_READ").map((statement) => ({
    setName: statement.resultSet!,
    rows: database.prepare(statement.sql).all(...statement.bindings) as Array<Record<string, string | number | null>>,
  }));
  const observation = {
    planDigest: plan.planDigest,
    snapshotCapturedAt: SNAPSHOT_AT,
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
    requestedAt: "2026-08-24T12:02:00.000Z",
    acquiredAt: "2026-08-24T12:02:01.000Z",
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
