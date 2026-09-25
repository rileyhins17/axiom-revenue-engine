import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import {
  ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
  ARTIFACT_MANIFEST_VERSION,
  ArtifactManifestSchema,
  createArtifactPromotionPlan,
  createArtifactReleaseRecord,
  executeFixtureArtifactPromotion,
  type ArtifactEvidenceUse,
  type ArtifactManifest,
  type FixtureArtifactLifecycleStore,
  type FixtureCopyRequest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  ARTIFACT_STORE_CONTRACT_VERSION,
  artifactObjectKey,
} from "@/lib/revenue-engine/content-addressed-artifact-store";
import {
  DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
  DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
  buildDurableEvidencePersistencePlan,
  verifyDurableEvidencePreflight,
} from "@/lib/revenue-engine/durable-evidence-persistence-plan";
import {
  FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_STEPS,
  FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
  FixtureWebsiteEvidenceWorkflowReceiptSchema,
  FixtureWebsiteEvidenceWorkflowRequestSchema,
} from "@/lib/revenue-engine/fixture-website-evidence-workflow";
import {
  WEBSITE_PAGE_SELECTION_VERSION,
  WebsitePageSelectionPlanSchema,
  defaultWebsitePageSelectionPolicy,
} from "@/lib/revenue-engine/website-page-selection";

const BUSINESS_ID = "business:durable-fixture-roofing";
const WORKFLOW_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_MANIFEST_ID = "11111111-1111-4111-8111-111111111111";
const PROMOTION_ID = "33333333-3333-4333-8333-333333333333";
const USE_ID = "44444444-4444-4444-8444-444444444444";
const RELEASE_ID = "55555555-5555-4555-8555-555555555555";
const REQUESTED_AT = "2026-08-22T20:00:00.000Z";
const PROMOTED_AT = "2026-08-22T21:00:00.000Z";
const DECIDED_AT = "2026-08-22T22:00:00.000Z";
const PLANNED_AT = "2026-08-22T23:00:00.000Z";
const HOME_URL = "https://durable-fixture-roofing.ca/";

function digest(character: string) {
  return character.repeat(64);
}

function sourceManifest(): ArtifactManifest {
  const screenshotSha = digest("a");
  const measurementSha = digest("b");
  return ArtifactManifestSchema.parse({
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    manifestId: SOURCE_MANIFEST_ID,
    workflowId: WORKFLOW_ID,
    retentionClass: "SHADOW_30D",
    verifiedAt: REQUESTED_AT,
    provenance: { receiptType: "ARTIFACT_WRITE", receiptId: SOURCE_MANIFEST_ID },
    items: [
      {
        kind: "BROWSER_SCREENSHOT",
        artifactRef: `artifact:sha256:${screenshotSha}`,
        objectKey: artifactObjectKey("SHADOW_30D", "BROWSER_SCREENSHOT", screenshotSha),
        byteLength: 4,
        sha256: screenshotSha,
        etag: "fixture-source-screenshot",
        uploadedAt: REQUESTED_AT,
      },
      {
        kind: "BROWSER_MEASUREMENT",
        artifactRef: `artifact:sha256:${measurementSha}`,
        objectKey: artifactObjectKey("SHADOW_30D", "BROWSER_MEASUREMENT", measurementSha),
        byteLength: 100,
        sha256: measurementSha,
        etag: "fixture-source-measurement",
        uploadedAt: REQUESTED_AT,
      },
    ],
  });
}

function pageSelection() {
  return WebsitePageSelectionPlanSchema.parse({
    selectionVersion: WEBSITE_PAGE_SELECTION_VERSION,
    selectionId: "66666666-6666-4666-8666-666666666666",
    businessId: BUSINESS_ID,
    plannedAt: REQUESTED_AT,
    sourceCapturedAt: REQUESTED_AT,
    mode: "SHADOW",
    plannerKind: "DETERMINISTIC_FIXTURE",
    status: "PARTIAL",
    discoveryComplete: true,
    policy: defaultWebsitePageSelectionPolicy(),
    selectedPages: [{
      pageKind: "HOME",
      url: HOME_URL,
      label: "Homepage",
      score: 100,
      reasonCodes: ["homepage_capture"],
    }],
    missingRequiredPageKinds: ["SERVICE", "ABOUT", "CONTACT"],
    candidateEvaluations: [],
    warnings: ["required_page_not_found:SERVICE", "required_page_not_found:ABOUT", "required_page_not_found:CONTACT"],
    budget: { maxCostUsd: 0, totalCostUsd: 0, providerOperations: 0, candidatesObserved: 0, pagesSelected: 1 },
  });
}

function workflowRequest() {
  return FixtureWebsiteEvidenceWorkflowRequestSchema.parse({
    workflowVersion: FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
    workflowId: WORKFLOW_ID,
    idempotencyKey: "durable-fixture:audit:2026-08-22",
    businessId: BUSINESS_ID,
    businessName: "Durable Fixture Roofing",
    niche: "roofing",
    expectedServices: ["roof repair"],
    expectedLocations: ["Kitchener"],
    websiteUrl: HOME_URL,
    sourceEvidenceUrl: "https://source-fixture.ca/durable-roofing",
    requestedAt: REQUESTED_AT,
    mode: "SHADOW",
    orchestratorKind: "FIXTURE",
    maxCostUsd: 0,
    resourceProbes: [],
  });
}

function workflowReceipt() {
  const steps = FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_STEPS.map((step, index) => {
    if (index < 3) {
      return {
        step,
        status: "SUCCEEDED" as const,
        attempts: 1,
        startedAt: REQUESTED_AT,
        completedAt: REQUESTED_AT,
        outputDigest: digest(String(index + 1)),
        itemCount: 1,
        warningCodes: [],
        failure: null,
      };
    }
    if (index === 3) {
      return {
        step,
        status: "FAILED" as const,
        attempts: 1,
        startedAt: REQUESTED_AT,
        completedAt: REQUESTED_AT,
        outputDigest: null,
        itemCount: 0,
        warningCodes: [],
        failure: { code: "fixture_workflow_failed", message: "Synthetic subpage failure." },
      };
    }
    return {
      step,
      status: "SKIPPED" as const,
      attempts: 0,
      startedAt: null,
      completedAt: null,
      outputDigest: null,
      itemCount: 0,
      warningCodes: [],
      failure: null,
    };
  });
  return FixtureWebsiteEvidenceWorkflowReceiptSchema.parse({
    workflowVersion: FIXTURE_WEBSITE_EVIDENCE_WORKFLOW_VERSION,
    workflowId: WORKFLOW_ID,
    idempotencyKey: workflowRequest().idempotencyKey,
    businessId: BUSINESS_ID,
    requestedAt: REQUESTED_AT,
    completedAt: REQUESTED_AT,
    mode: "SHADOW",
    orchestratorKind: "FIXTURE",
    status: "FAILED",
    sitePath: null,
    steps,
    pages: [{
      pageKind: "HOME",
      requestedUrl: HOME_URL,
      captureOutcome: "CAPTURED",
      finalUrl: HOME_URL,
      htmlComplete: true,
      browserProfilesAttempted: ["DESKTOP_1440X900"],
      browserProfilesCaptured: ["DESKTOP_1440X900"],
      artifactReceiptIds: [SOURCE_MANIFEST_ID],
    }],
    artifactManifests: [sourceManifest()],
    pageSelection: pageSelection(),
    auditAssembly: null,
    audit: null,
    budget: {
      maxCostUsd: 0,
      totalCostUsd: 0,
      providerOperations: 0,
      documentCaptureAttempts: 2,
      browserCaptureAttempts: 1,
      artifactWriteAttempts: 2,
      artifactHeadReads: 0,
      artifactBytes: 104,
    },
    failure: { step: "CAPTURE_SUBPAGES", code: "fixture_workflow_failed", message: "Synthetic subpage failure." },
  });
}

function lifecycleObject(
  item: ArtifactManifest["items"][number],
  retentionClass: ArtifactManifest["retentionClass"],
  objectKey = artifactObjectKey(retentionClass, item.kind, item.sha256),
) {
  return {
    objectKey,
    byteLength: item.byteLength,
    sha256: item.sha256,
    etag: retentionClass === "SHADOW_30D" ? item.etag : `fixture-promoted-${item.kind.toLocaleLowerCase("en-CA")}`,
    uploadedAt: retentionClass === "SHADOW_30D" ? item.uploadedAt : PROMOTED_AT,
    storageClass: "STANDARD" as const,
    httpMetadata: {
      contentType: item.kind === "BROWSER_SCREENSHOT" ? "image/webp" as const : "application/json" as const,
      cacheControl: "private, no-store" as const,
    },
    customMetadata: {
      contractVersion: ARTIFACT_STORE_CONTRACT_VERSION,
      kind: item.kind,
      sha256: item.sha256,
      retentionClass,
    },
  };
}

function lifecycleStore(manifest: ArtifactManifest): FixtureArtifactLifecycleStore {
  const objects = new Map(manifest.items.map((item) => [item.objectKey, lifecycleObject(item, manifest.retentionClass)]));
  return {
    kind: "FIXTURE",
    async head(objectKey) {
      return objects.get(objectKey) ?? null;
    },
    async copyIfAbsent(request: FixtureCopyRequest) {
      const source = manifest.items.find((item) => item.objectKey === request.sourceObjectKey);
      assert.ok(source);
      const object = lifecycleObject(source, request.targetRetentionClass, request.targetObjectKey);
      objects.set(request.targetObjectKey, object);
      return { outcome: "CREATED", object };
    },
  };
}

async function lifecycleBundle() {
  const manifest = sourceManifest();
  const use: ArtifactEvidenceUse = {
    useId: USE_ID,
    useType: "OUTREACH_APPROVAL",
    recordId: "approval:fixture",
    recordVersion: "outreach-approval-v1",
    businessId: BUSINESS_ID,
    recordedAt: REQUESTED_AT,
  };
  const promotionPlan = createArtifactPromotionPlan({
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    promotionId: PROMOTION_ID,
    workflowId: WORKFLOW_ID,
    requestedAt: PROMOTED_AT,
    mode: "SHADOW",
    executorKind: "FIXTURE",
    providerCopyAuthorized: false,
    maxCostUsd: 0,
    businessId: BUSINESS_ID,
    sourceManifest: manifest,
    evidenceUses: [use],
  });
  const promotionReceipt = await executeFixtureArtifactPromotion(promotionPlan, {
    store: lifecycleStore(manifest),
    now: () => new Date(PROMOTED_AT),
  });
  assert.equal(promotionReceipt.outcome, "COMPLETED");
  if (promotionReceipt.outcome !== "COMPLETED") throw new Error("Fixture promotion did not complete.");
  const promotedManifest = promotionReceipt.resultManifest;
  const releaseRecord = createArtifactReleaseRecord({
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    releaseId: RELEASE_ID,
    businessId: BUSINESS_ID,
    decidedAt: DECIDED_AT,
    mode: "SHADOW",
    recorderKind: "FIXTURE",
    providerDeleteAuthorized: false,
    maxCostUsd: 0,
    manifest: promotedManifest,
    activeEvidenceUses: [use],
    reviewedUseIds: [use.useId],
    actor: { actorUserId: "owner:riley", role: "OWNER" },
    decision: "KEEP_PROTECTED",
    reasonCode: "ACTIVE_REFERENCE_REMAINS",
    rationale: "The approved outreach record still relies on this evidence.",
    confirmation: null,
  });
  return { manifest, use, promotionPlan, promotionReceipt, promotedManifest, releaseRecord };
}

async function persistenceRequest(overrides: Record<string, unknown> = {}) {
  const lifecycle = await lifecycleBundle();
  return {
    persistencePlanVersion: DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
    plannedAt: PLANNED_AT,
    mode: "SHADOW",
    plannerKind: "FIXTURE",
    maxCostUsd: 0,
    workflowAttemptNumber: 1,
    workflowRequest: workflowRequest(),
    workflowReceipt: workflowReceipt(),
    promotions: [{ plan: lifecycle.promotionPlan, receipt: lifecycle.promotionReceipt }],
    releases: [{
      record: lifecycle.releaseRecord,
      manifest: lifecycle.promotedManifest,
      activeEvidenceUses: [lifecycle.use],
    }],
    ...overrides,
  };
}

function freshDatabase() {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(readFileSync(new URL("../../../migrations/0054_revenue_shadow_kernel.sql", import.meta.url), "utf8"));
  database.exec(readFileSync(new URL("../../../migrations/0056_durable_evidence_receipts.sql", import.meta.url), "utf8"));
  database.prepare(`
    INSERT INTO "RevenueBusiness"
      ("id", "canonicalName", "normalizedDomain", "independenceStatus", "status")
    VALUES (?, ?, ?, 'UNKNOWN', 'RESEARCH_ONLY')
  `).run(BUSINESS_ID, "Durable Fixture Roofing", "durable-fixture-roofing.ca");
  return database;
}

function count(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number }).count;
}

test("builds deterministic exact-preflight persistence with no runtime authority", async () => {
  const request = await persistenceRequest();
  const first = buildDurableEvidencePersistencePlan(request);
  const second = buildDurableEvidencePersistencePlan(request);
  assert.deepEqual(first, second);
  assert.equal(first.targetSchemaVersion, "0056_durable_evidence_receipts");
  assert.equal(first.mutationAuthorized, false);
  assert.equal(first.resumeAuthorized, false);
  assert.equal(first.requiresExactPreflightMatch, true);
  assert.equal(first.summary.workflowSteps, 8);
  assert.equal(first.summary.pageSelections, 1);
  assert.equal(first.summary.selectedPages, 1);
  assert.equal(first.summary.artifactManifests, 2);
  assert.equal(first.summary.artifactManifestItems, 4);
  assert.equal(first.summary.evidenceUses, 1);
  assert.equal(first.summary.promotionReceipts, 1);
  assert.equal(first.summary.manifestUses, 1);
  assert.equal(first.summary.releaseRecords, 1);
  assert.equal(first.summary.providerOperations, 0);
  assert.equal(first.summary.costUsd, 0);
  assert.ok(first.mutations.every((item) => item.operation === "INSERT_IF_ABSENT"));
  assert.ok(first.mutations.every((item) => !/\b(?:UPDATE|DELETE)\b/i.test(item.sql)));
});

test("migration 0056 accepts the plan, and an exact repeat is idempotent", async () => {
  const plan = buildDurableEvidencePersistencePlan(await persistenceRequest());
  const database = freshDatabase();
  try {
    for (const preflight of plan.preflights) {
      const existing = database.prepare(preflight.selectSql).get(...preflight.bindings) as Record<string, unknown> | undefined;
      assert.deepEqual(verifyDurableEvidencePreflight(preflight, existing || null), { state: "MISSING", matches: true });
    }
    for (const mutation of plan.mutations) database.prepare(mutation.sql).run(...mutation.bindings);

    assert.equal(count(database, "RevenueWorkflowRun"), 1);
    assert.equal(count(database, "RevenueWorkflowReceipt"), 1);
    assert.equal(count(database, "RevenueWorkflowStepReceipt"), 8);
    assert.equal(count(database, "RevenueWebsitePageSelection"), 1);
    assert.equal(count(database, "RevenueArtifactManifest"), 2);
    assert.equal(count(database, "RevenueArtifactManifestItem"), 4);
    assert.equal(count(database, "RevenueArtifactPromotionReceipt"), 1);
    assert.equal(count(database, "RevenueArtifactReleaseRecord"), 1);
    assert.deepEqual(
      database.prepare(`SELECT "providerDeleteAuthorized", "providerDeletePerformed", "costUsd" FROM "RevenueArtifactReleaseRecord"`).get(),
      { providerDeleteAuthorized: 0, providerDeletePerformed: 0, costUsd: 0 },
    );
    assert.deepEqual(
      database.prepare(`SELECT "completedAt", "recordedAt" FROM "RevenueWorkflowReceipt"`).get(),
      { completedAt: REQUESTED_AT, recordedAt: PLANNED_AT },
    );

    for (const preflight of plan.preflights) {
      const existing = database.prepare(preflight.selectSql).get(...preflight.bindings) as Record<string, unknown>;
      assert.deepEqual(verifyDurableEvidencePreflight(preflight, existing), { state: "EXACT_MATCH", matches: true });
    }
    for (const mutation of plan.mutations) database.prepare(mutation.sql).run(...mutation.bindings);
    assert.equal(count(database, "RevenueWorkflowReceipt"), 1);
    assert.equal(count(database, "RevenueArtifactManifest"), 2);
  } finally {
    database.close();
  }
});

test("stored drift and alternate idempotency collisions are visible before insert", async () => {
  const plan = buildDurableEvidencePersistencePlan(await persistenceRequest());
  const database = freshDatabase();
  try {
    for (const mutation of plan.mutations) database.prepare(mutation.sql).run(...mutation.bindings);
    database.prepare(`UPDATE "RevenueArtifactManifest" SET "retentionClass" = 'LEGAL_HOLD' WHERE "id" = ?`).run(SOURCE_MANIFEST_ID);
    const manifestCheck = plan.preflights.find((item) => item.entity === "ARTIFACT_MANIFEST" && item.recordId === SOURCE_MANIFEST_ID);
    assert.ok(manifestCheck);
    const drifted = database.prepare(manifestCheck.selectSql).get(...manifestCheck.bindings) as Record<string, unknown>;
    assert.deepEqual(verifyDurableEvidencePreflight(manifestCheck, drifted), { state: "CONFLICT", matches: false });

    const receiptCheck = plan.preflights.find((item) => item.entity === "WORKFLOW_RECEIPT");
    assert.ok(receiptCheck);
    const attemptTwo = buildDurableEvidencePersistencePlan(await persistenceRequest({ workflowAttemptNumber: 2 }));
    const attemptTwoCheck = attemptTwo.preflights.find((item) => item.entity === "WORKFLOW_RECEIPT");
    assert.ok(attemptTwoCheck);
    const duplicateDigest = database.prepare(attemptTwoCheck.selectSql).get(...attemptTwoCheck.bindings) as Record<string, unknown>;
    assert.deepEqual(verifyDurableEvidencePreflight(attemptTwoCheck, duplicateDigest), { state: "CONFLICT", matches: false });
  } finally {
    database.close();
  }
});

test("cross-request and release-manifest contamination fail before SQL planning", async () => {
  const base = await persistenceRequest();
  assert.throws(
    () => buildDurableEvidencePersistencePlan({
      ...base,
      workflowRequest: { ...base.workflowRequest, idempotencyKey: "different-idempotency-key" },
    }),
    /identities must match exactly/,
  );
  assert.throws(
    () => buildDurableEvidencePersistencePlan({
      ...base,
      releases: [{
        ...base.releases[0],
        manifest: sourceManifest(),
      }],
    }),
    /release bundle does not match/,
  );

  const unproducedSource = ArtifactManifestSchema.parse({
    ...sourceManifest(),
    manifestId: "66666666-6666-4666-8666-666666666666",
    provenance: { receiptType: "ARTIFACT_WRITE", receiptId: "66666666-6666-4666-8666-666666666666" },
  });
  assert.throws(
    () => buildDurableEvidencePersistencePlan({
      ...base,
      promotions: [{
        ...base.promotions[0],
        plan: { ...base.promotions[0].plan, sourceManifest: unproducedSource },
      }],
    }),
    /must reference a manifest already produced/,
  );

  const unproducedReleaseManifest = ArtifactManifestSchema.parse({
    ...base.releases[0].manifest,
    manifestId: "77777777-7777-4777-8777-777777777777",
    provenance: { receiptType: "ARTIFACT_PROMOTION", receiptId: "77777777-7777-4777-8777-777777777777" },
  });
  const unproducedReleaseRecord = createArtifactReleaseRecord({
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    releaseId: "99999999-9999-4999-8999-999999999999",
    businessId: BUSINESS_ID,
    decidedAt: DECIDED_AT,
    mode: "SHADOW",
    recorderKind: "FIXTURE",
    providerDeleteAuthorized: false,
    maxCostUsd: 0,
    manifest: unproducedReleaseManifest,
    activeEvidenceUses: base.releases[0].activeEvidenceUses,
    reviewedUseIds: [USE_ID],
    actor: { actorUserId: "owner:riley", role: "OWNER" },
    decision: "KEEP_PROTECTED",
    reasonCode: "ACTIVE_REFERENCE_REMAINS",
    rationale: "This record must not introduce a manifest outside the persisted provenance chain.",
    confirmation: null,
  });
  assert.throws(
    () => buildDurableEvidencePersistencePlan({
      ...base,
      releases: [{
        record: unproducedReleaseRecord,
        manifest: unproducedReleaseManifest,
        activeEvidenceUses: base.releases[0].activeEvidenceUses,
      }],
    }),
    /must reference a manifest already produced/,
  );
});
