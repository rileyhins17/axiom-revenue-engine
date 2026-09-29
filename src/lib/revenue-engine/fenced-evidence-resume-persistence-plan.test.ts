import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import type { BrowserMeasurementRunner } from "@/lib/revenue-engine/browser-measurement-adapter";
import {
  ArtifactWritePlanSchema,
  ArtifactWriteReceiptSchema,
  artifactObjectKey,
  type FixtureArtifactStore,
} from "@/lib/revenue-engine/content-addressed-artifact-store";
import {
  FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
  runFixtureWebsiteEvidenceWorkflow,
  type FixtureWebsiteEvidenceCheckpointObservation,
  type FixtureWebsiteEvidenceWorkflowRequest,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";
import {
  FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION,
  FIXTURE_WEBSITE_EVIDENCE_DELIVERY_VERSION,
  FIXTURE_WEBSITE_EVIDENCE_LEASE_VERSION,
  FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION,
  createFixtureArtifactRecoveryRecord,
  createFixtureWebsiteEvidenceCheckpointChain,
  createFixtureWorkflowReceiptRevision,
  currentFixtureWebsiteEvidenceDefinition,
  fixtureWebsiteEvidenceRequestDigest,
  type FixtureWorkflowAttemptSnapshot,
  type FixtureWorkflowDeliveryRecord,
  type FixtureWorkflowLeaseClaim,
} from "@/lib/revenue-engine/fixture-website-evidence-resume-plan";
import {
  FENCED_EVIDENCE_RESUME_PERSISTENCE_PLAN_VERSION,
  FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION,
  buildFencedEvidenceResumePersistencePlan,
  verifyFencedEvidenceResumePreflight,
} from "@/lib/revenue-engine/fenced-evidence-resume-persistence-plan";
import {
  WEBSITE_CAPTURE_MAX_REDIRECTS,
  WEBSITE_CAPTURE_MAX_RESPONSE_BYTES,
  WEBSITE_CAPTURE_TIMEOUT_MS,
  WEBSITE_CAPTURE_VERSION,
  type WebsiteCaptureResult,
} from "@/lib/revenue-engine/website-capture";

const WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEASE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BUSINESS_ID = "business:fenced-fixture-roofing";
const WEBSITE_URL = "https://fenced-fixture-roofing.ca/";
const REQUESTED_AT = "2026-08-23T01:00:00.000Z";
const CAPTURED_AT = "2026-08-23T01:00:03.000Z";
const PLANNED_AT = "2026-08-23T01:00:10.000Z";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function workflowRequest(): FixtureWebsiteEvidenceWorkflowRequest {
  return {
    workflowVersion: FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
    workflowId: WORKFLOW_ID,
    idempotencyKey: "fenced-fixture-roofing:audit:2026-08-23",
    businessId: BUSINESS_ID,
    businessName: "Fenced Fixture Roofing",
    niche: "roofing",
    expectedServices: ["roof repair"],
    expectedLocations: ["Kitchener"],
    websiteUrl: WEBSITE_URL,
    sourceEvidenceUrl: "https://source-fixture.ca/business/fenced-fixture-roofing",
    requestedAt: REQUESTED_AT,
    mode: "SHADOW",
    orchestratorKind: "FIXTURE",
    maxCostUsd: 0,
    resourceProbes: [],
  };
}

function delivery(overrides: Partial<FixtureWorkflowDeliveryRecord> = {}): FixtureWorkflowDeliveryRecord {
  const request = workflowRequest();
  const requestDigest = fixtureWebsiteEvidenceRequestDigest(request);
  return {
    deliveryVersion: FIXTURE_WEBSITE_EVIDENCE_DELIVERY_VERSION,
    deliveryId: "delivery:fenced-fixture-roofing:2026-08-23",
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: currentFixtureWebsiteEvidenceDefinition().definitionDigest,
    requestDigest,
    payloadDigest: requestDigest,
    receivedAt: REQUESTED_AT,
    mode: "SHADOW",
    deliveryKind: "FIXTURE",
    ...overrides,
  };
}

function attempt(overrides: Partial<FixtureWorkflowAttemptSnapshot> = {}): FixtureWorkflowAttemptSnapshot {
  const request = workflowRequest();
  return {
    attemptVersion: FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION,
    attemptId: ATTEMPT_ID,
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: currentFixtureWebsiteEvidenceDefinition().definitionDigest,
    requestDigest: fixtureWebsiteEvidenceRequestDigest(request),
    deliveryId: delivery().deliveryId,
    attemptNumber: 1,
    fencingToken: 1,
    status: "FAILED",
    startedAt: "2026-08-23T01:00:01.000Z",
    endedAt: "2026-08-23T01:00:06.000Z",
    terminalReceiptId: null,
    ...overrides,
  };
}

function lease(record: FixtureWorkflowAttemptSnapshot, overrides: Partial<FixtureWorkflowLeaseClaim> = {}): FixtureWorkflowLeaseClaim {
  const request = workflowRequest();
  return {
    leaseVersion: FIXTURE_WEBSITE_EVIDENCE_LEASE_VERSION,
    leaseId: LEASE_ID,
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    definitionDigest: currentFixtureWebsiteEvidenceDefinition().definitionDigest,
    requestDigest: fixtureWebsiteEvidenceRequestDigest(request),
    attemptId: record.attemptId,
    attemptNumber: record.attemptNumber,
    deliveryId: record.deliveryId,
    ownerId: "fixture-owner-1",
    fencingToken: record.fencingToken,
    acquiredAt: "2026-08-23T01:00:02.000Z",
    expiresAt: PLANNED_AT,
    mode: "SHADOW",
    leaseKind: "FIXTURE",
    ...overrides,
  };
}

function unavailableCapture(): WebsiteCaptureResult {
  return {
    captureVersion: WEBSITE_CAPTURE_VERSION,
    policy: {
      maxRedirects: WEBSITE_CAPTURE_MAX_REDIRECTS,
      maxResponseBytes: WEBSITE_CAPTURE_MAX_RESPONSE_BYTES,
      timeoutMs: WEBSITE_CAPTURE_TIMEOUT_MS,
    },
    capturedAt: CAPTURED_AT,
    requestedUrl: WEBSITE_URL,
    finalUrl: null,
    statusCode: 503,
    redirectCount: 0,
    redirectChain: [WEBSITE_URL],
    outcome: "FAILED",
    contentType: "text/html",
    bodyBytes: 0,
    html: null,
    failure: { code: "HTTP_STATUS", message: "Synthetic unavailable page." },
  };
}

function artifactRecovery(record: FixtureWorkflowAttemptSnapshot, claim: FixtureWorkflowLeaseClaim) {
  const bytes = new TextEncoder().encode("fixture measurement recovery");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const plan = ArtifactWritePlanSchema.parse({
    contractVersion: "content-addressed-artifact-store-v1",
    planId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    workflowId: WORKFLOW_ID,
    createdAt: "2026-08-23T01:00:04.000Z",
    mode: "SHADOW",
    storeKind: "FIXTURE",
    providerWriteAuthorized: false,
    maxCostUsd: 0,
    retentionClass: "SHADOW_30D",
    items: [{
      kind: "BROWSER_MEASUREMENT",
      mediaType: "application/json",
      bytes,
      byteLength: bytes.byteLength,
      sha256,
      artifactRef: `artifact:sha256:${sha256}`,
      objectKey: artifactObjectKey("SHADOW_30D", "BROWSER_MEASUREMENT", sha256),
      storageClass: "STANDARD",
      writeCondition: "IF_ABSENT",
      httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" },
      customMetadata: {
        contractVersion: "content-addressed-artifact-store-v1",
        kind: "BROWSER_MEASUREMENT",
        sha256,
        retentionClass: "SHADOW_30D",
      },
    }],
    totalBytes: bytes.byteLength,
    rollbackPolicy: "KEEP_CONTENT_ADDRESSED_ORPHANS_FOR_LIFECYCLE",
  });
  const receipt = ArtifactWriteReceiptSchema.parse({
    contractVersion: "content-addressed-artifact-store-v1",
    planId: plan.planId,
    workflowId: WORKFLOW_ID,
    mode: "SHADOW",
    storeKind: "FIXTURE",
    providerWritePerformed: false,
    retentionClass: "SHADOW_30D",
    startedAt: "2026-08-23T01:00:04.000Z",
    completedAt: "2026-08-23T01:00:05.000Z",
    plannedItemCount: 1,
    fixturePutAttempts: 1,
    fixtureHeadReads: 0,
    providerClassAOperations: 0,
    providerClassBOperations: 0,
    costUsd: 0,
    rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS",
    outcome: "FAILED",
    items: [],
    failure: { itemIndex: 0, code: "STORE_ERROR", message: "Synthetic interrupted fixture write." },
  });
  return createFixtureArtifactRecoveryRecord({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: record,
    lease: claim,
    observation: {
      pageKind: "HOME",
      profile: "DESKTOP_1440X900",
      recordedAt: "2026-08-23T01:00:05.000Z",
      plan,
      receipt,
    },
  });
}

function interruptedResumeRequest() {
  const record = attempt();
  const claim = lease(record);
  const checkpoints = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: record,
    lease: claim,
    observations: [{
      step: "CAPTURE_HOME",
      sitePath: "UNREACHABLE",
      completedAt: CAPTURED_AT,
      output: unavailableCapture(),
    }],
    recordedAt: "2026-08-23T01:00:04.000Z",
  });
  return {
    resumePlanVersion: FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION,
    plannedAt: PLANNED_AT,
    mode: "SHADOW",
    plannerKind: "FIXTURE",
    maxCostUsd: 0,
    workflowRequest: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    currentDelivery: delivery(),
    persistedDeliveries: [],
    attempts: [record],
    leases: [claim],
    receiptRevisions: [],
    checkpoints,
    artifactRecoveries: [artifactRecovery(record, claim)],
  } as const;
}

function persistenceRequest(resumeRequest: unknown = interruptedResumeRequest()) {
  return {
    persistencePlanVersion: FENCED_EVIDENCE_RESUME_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION,
    resumeRequest,
  };
}

function freshDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(readFileSync(new URL("../../../migrations/0054_revenue_shadow_kernel.sql", import.meta.url), "utf8"));
  database.exec(readFileSync(new URL("../../../migrations/0056_durable_evidence_receipts.sql", import.meta.url), "utf8"));
  database.exec(readFileSync(new URL("../../../migrations/0057_fenced_evidence_resume_records.sql", import.meta.url), "utf8"));
  database.prepare(`
    INSERT INTO "RevenueBusiness"
      ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status")
    VALUES (?, ?, ?, 'UNKNOWN', 'RESEARCH_ONLY')
  `).run(BUSINESS_ID, "Fenced Fixture Roofing", "fenced-fixture-roofing.ca");
  return database;
}

function count(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
}

function insertPlan(database: Database.Database, plan: ReturnType<typeof buildFencedEvidenceResumePersistencePlan>) {
  for (const preflight of plan.preflights) {
    const existing = database.prepare(preflight.selectSql).all(...preflight.bindings) as Record<string, unknown>[];
    assert.deepEqual(verifyFencedEvidenceResumePreflight(preflight, existing), {
      state: "MISSING",
      matches: true,
      matchCount: 0,
    });
  }
  for (const mutation of plan.mutations) database.prepare(mutation.sql).run(...mutation.bindings);
}

test("builds deterministic collision-complete persistence with no runtime authority", () => {
  const first = buildFencedEvidenceResumePersistencePlan(persistenceRequest());
  const second = buildFencedEvidenceResumePersistencePlan(persistenceRequest());
  assert.deepEqual(first, second);
  assert.equal(first.resumeDecision, "REQUEST_FENCED_TAKEOVER");
  assert.equal(first.targetSchemaVersion, FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION);
  assert.equal(first.mutationAuthorized, false);
  assert.equal(first.resumeAuthorized, false);
  assert.equal(first.executionAuthorized, false);
  assert.equal(first.providerOperationsAuthorized, 0);
  assert.equal(first.costAuthorizedUsd, 0);
  assert.equal(first.summary.attemptClosures, 1);
  assert.equal(first.summary.checkpointPayloads, 1);
  assert.equal(first.summary.checkpointStateReceipts, 1);
  assert.equal(first.summary.artifactRecoveryPlans, 1);
  assert.equal(first.summary.artifactRecoveryReceipts, 1);
  assert.ok(first.preflights.every((item) => item.rejectMultipleMatches));
  assert.ok(first.preflights.every((item) => !/\bLIMIT\s+1\b/i.test(item.selectSql)));
  assert.ok(first.mutations.every((item) => item.operation === "INSERT_IF_ABSENT"));
  assert.ok(first.mutations.every((item) => !/\b(?:UPDATE|DELETE)\b/i.test(item.sql)));
});

test("migration 0057 accepts an interrupted exact history and repeat planning is idempotent", () => {
  const plan = buildFencedEvidenceResumePersistencePlan(persistenceRequest());
  const database = freshDatabase();
  try {
    insertPlan(database, plan);
    assert.equal(count(database, "RevenueWorkflowDefinition"), 1);
    assert.equal(count(database, "RevenueWorkflowRun"), 1);
    assert.equal(count(database, "RevenueWorkflowDelivery"), 1);
    assert.equal(count(database, "RevenueWorkflowAttempt"), 1);
    assert.equal(count(database, "RevenueWorkflowAttemptClosure"), 1);
    assert.equal(count(database, "RevenueWorkflowLease"), 1);
    assert.equal(count(database, "RevenueWorkflowCheckpointPayload"), 1);
    assert.equal(count(database, "RevenueWorkflowCheckpoint"), 1);
    assert.equal(count(database, "RevenueWorkflowCheckpointStateReceipt"), 1);
    assert.equal(count(database, "RevenueArtifactRecoveryPlan"), 1);
    assert.equal(count(database, "RevenueArtifactRecoveryReceipt"), 1);
    assert.deepEqual(
      database.prepare(`SELECT "providerWritePerformed", "costUsd", "rollbackAction" FROM "RevenueArtifactRecoveryReceipt"`).get(),
      { providerWritePerformed: 0, costUsd: 0, rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS" },
    );
    const storedPlan = database.prepare(`SELECT "planJson" FROM "RevenueArtifactRecoveryPlan"`).get() as { planJson: string };
    assert.match(storedPlan.planJson, /"\$type":"Uint8Array","encoding":"base64"/);

    for (const preflight of plan.preflights) {
      const existing = database.prepare(preflight.selectSql).all(...preflight.bindings) as Record<string, unknown>[];
      assert.deepEqual(verifyFencedEvidenceResumePreflight(preflight, existing), {
        state: "EXACT_MATCH",
        matches: true,
        matchCount: 1,
      });
    }
    for (const mutation of plan.mutations) database.prepare(mutation.sql).run(...mutation.bindings);
    assert.equal(count(database, "RevenueWorkflowAttemptClosure"), 1);
    assert.equal(count(database, "RevenueArtifactRecoveryReceipt"), 1);
  } finally {
    database.close();
  }
});

test("preflight rejects stored drift, alternate identity collisions, and multiple matches", () => {
  const plan = buildFencedEvidenceResumePersistencePlan(persistenceRequest());
  const database = freshDatabase();
  try {
    insertPlan(database, plan);
    database.prepare(`UPDATE "RevenueWorkflowAttemptClosure" SET "status" = 'ABANDONED'`).run();
    const closureCheck = plan.preflights.find((item) => item.entity === "WORKFLOW_ATTEMPT_CLOSURE");
    assert.ok(closureCheck);
    const drifted = database.prepare(closureCheck.selectSql).all(...closureCheck.bindings) as Record<string, unknown>[];
    assert.deepEqual(verifyFencedEvidenceResumePreflight(closureCheck, drifted), {
      state: "CONFLICT",
      matches: false,
      matchCount: 1,
    });

    const expected = closureCheck.expected;
    assert.deepEqual(verifyFencedEvidenceResumePreflight(closureCheck, [expected, { ...expected, id: "other" }]), {
      state: "CONFLICT",
      matches: false,
      matchCount: 2,
    });
  } finally {
    database.close();
  }

  const alternateDatabase = freshDatabase();
  try {
    const definitionMutation = plan.mutations.find((item) => item.entity === "WORKFLOW_DEFINITION");
    const runMutation = plan.mutations.find((item) => item.entity === "WORKFLOW_RUN");
    const runCheck = plan.preflights.find((item) => item.entity === "WORKFLOW_RUN");
    assert.ok(definitionMutation && runMutation && runCheck);
    alternateDatabase.prepare(definitionMutation.sql).run(...definitionMutation.bindings);
    alternateDatabase.prepare(runMutation.sql).run(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      ...runMutation.bindings.slice(1),
    );
    const alternate = alternateDatabase.prepare(runCheck.selectSql).all(...runCheck.bindings) as Record<string, unknown>[];
    assert.deepEqual(verifyFencedEvidenceResumePreflight(runCheck, alternate), {
      state: "CONFLICT",
      matches: false,
      matchCount: 1,
    });
  } finally {
    alternateDatabase.close();
  }
});

test("blocked resume history is rejected before any SQL plan is returned", () => {
  const value = interruptedResumeRequest();
  assert.throws(
    () => buildFencedEvidenceResumePersistencePlan(persistenceRequest({
      ...value,
      persistedDeliveries: [{ ...value.currentDelivery, receivedAt: "2026-08-23T01:00:01.000Z" }],
    })),
    /Blocked resume history cannot be planned for persistence: DELIVERY_IDENTITY_CONFLICT/,
  );
});

test("a running attempt is represented by identity plus lease, without a mutable state row", () => {
  const running = attempt({ status: "RUNNING", endedAt: null, terminalReceiptId: null });
  const activeLease = lease(running);
  const resumeRequest = {
    resumePlanVersion: FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION,
    plannedAt: "2026-08-23T01:00:05.000Z",
    mode: "SHADOW",
    plannerKind: "FIXTURE",
    maxCostUsd: 0,
    workflowRequest: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    currentDelivery: delivery(),
    persistedDeliveries: [],
    attempts: [running],
    leases: [activeLease],
    receiptRevisions: [],
    checkpoints: [],
    artifactRecoveries: [],
  } as const;
  const plan = buildFencedEvidenceResumePersistencePlan(persistenceRequest(resumeRequest));
  assert.equal(plan.resumeDecision, "WAIT_ACTIVE_LEASE");
  assert.equal(plan.summary.attempts, 1);
  assert.equal(plan.summary.attemptClosures, 0);
  assert.equal(plan.mutations.some((item) => item.entity === "WORKFLOW_ATTEMPT_CLOSURE"), false);

  const database = freshDatabase();
  try {
    insertPlan(database, plan);
    assert.equal(count(database, "RevenueWorkflowAttempt"), 1);
    assert.equal(count(database, "RevenueWorkflowAttemptClosure"), 0);
  } finally {
    database.close();
  }
});

test("a sealed terminal receipt is inserted before its immutable attempt closure", async () => {
  const observations: FixtureWebsiteEvidenceCheckpointObservation[] = [];
  const receipt = await runFixtureWebsiteEvidenceWorkflow(workflowRequest(), {
    capture: { kind: "FIXTURE", async capture() { return unavailableCapture(); } },
    browserRunner: { kind: "FIXTURE", async run() { throw new Error("Browser must not run for an unreachable fixture."); } } as BrowserMeasurementRunner,
    artifactStore: {
      kind: "FIXTURE",
      async putIfAbsent() { throw new Error("Artifact writes must not run for an unreachable fixture."); },
      async head() { throw new Error("Artifact reads must not run for an unreachable fixture."); },
    } as FixtureArtifactStore,
    checkpointSink: {
      kind: "FIXTURE",
      async commit(observation) { observations.push(observation); },
      async recordArtifactAttempt() { throw new Error("No artifact attempt is expected."); },
    },
  });
  const receiptId = `workflow-receipt:${digest(receipt)}`;
  const sealed = attempt({
    status: "SEALED",
    startedAt: "2026-08-23T00:59:00.000Z",
    terminalReceiptId: receiptId,
  });
  const claim = lease(sealed, { acquiredAt: "2026-08-23T00:59:30.000Z" });
  const revision = createFixtureWorkflowReceiptRevision({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: sealed,
    receipt,
    recordedAt: "2026-08-23T01:00:07.000Z",
  });
  const checkpoints = createFixtureWebsiteEvidenceCheckpointChain({
    request: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    attempt: sealed,
    lease: claim,
    observations,
    recordedAt: "2026-08-23T01:00:04.000Z",
  });
  const resumeRequest = {
    resumePlanVersion: FIXTURE_WEBSITE_EVIDENCE_RESUME_PLAN_VERSION,
    plannedAt: PLANNED_AT,
    mode: "SHADOW",
    plannerKind: "FIXTURE",
    maxCostUsd: 0,
    workflowRequest: workflowRequest(),
    definition: currentFixtureWebsiteEvidenceDefinition(),
    currentDelivery: delivery(),
    persistedDeliveries: [],
    attempts: [sealed],
    leases: [claim],
    receiptRevisions: [revision],
    checkpoints,
    artifactRecoveries: [],
  } as const;
  const plan = buildFencedEvidenceResumePersistencePlan(persistenceRequest(resumeRequest));
  assert.equal(plan.resumeDecision, "RETURN_TERMINAL");
  const receiptIndex = plan.mutations.findIndex((item) => item.entity === "WORKFLOW_RECEIPT_REVISION");
  const closureIndex = plan.mutations.findIndex((item) => item.entity === "WORKFLOW_ATTEMPT_CLOSURE");
  assert.ok(receiptIndex >= 0 && closureIndex > receiptIndex);

  const database = freshDatabase();
  try {
    insertPlan(database, plan);
    assert.equal(count(database, "RevenueWorkflowReceiptRevision"), 1);
    assert.deepEqual(
      database.prepare(`SELECT "status", "terminalReceiptId" FROM "RevenueWorkflowAttemptClosure"`).get(),
      { status: "SEALED", terminalReceiptId: receiptId },
    );
  } finally {
    database.close();
  }
});
