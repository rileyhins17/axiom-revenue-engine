import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
  ARTIFACT_MANIFEST_VERSION,
  ARTIFACT_RELEASE_CONFIRMATION,
  ArtifactManifestSchema,
  ArtifactPromotionPlanSchema,
  ArtifactPromotionReceiptSchema,
  ArtifactReleaseRecordSchema,
  artifactManifestFromPromotionReceipt,
  artifactManifestFromWriteReceipt,
  createArtifactPromotionPlan,
  createArtifactReleaseRecord,
  executeFixtureArtifactPromotion,
  type ArtifactEvidenceUse,
  type ArtifactManifest,
  type FixtureArtifactLifecycleStore,
  type FixtureCopyRequest,
  type LifecycleObject,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  ARTIFACT_STORE_CONTRACT_VERSION,
  artifactObjectKey,
  type ArtifactRetentionClass,
  type ArtifactWriteReceipt,
} from "@/lib/revenue-engine/content-addressed-artifact-store";

const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const MANIFEST_ID = "22222222-2222-4222-8222-222222222222";
const BUSINESS_ID = "business:fixture-roofing";
const VERIFIED_AT = "2026-08-22T20:00:00.000Z";
const REQUESTED_AT = "2026-08-22T21:00:00.000Z";
const DIGESTS = ["a".repeat(64), "b".repeat(64)] as const;

function manifest(retentionClass: ArtifactRetentionClass = "SHADOW_30D"): ArtifactManifest {
  return ArtifactManifestSchema.parse({
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    manifestId: MANIFEST_ID,
    workflowId: WORKFLOW_ID,
    retentionClass,
    verifiedAt: VERIFIED_AT,
    provenance: { receiptType: "ARTIFACT_WRITE", receiptId: MANIFEST_ID },
    items: [
      {
        kind: "BROWSER_SCREENSHOT",
        artifactRef: `artifact:sha256:${DIGESTS[0]}`,
        objectKey: artifactObjectKey(retentionClass, "BROWSER_SCREENSHOT", DIGESTS[0]),
        byteLength: 4,
        sha256: DIGESTS[0],
        etag: `fixture-${DIGESTS[0].slice(0, 16)}`,
        uploadedAt: VERIFIED_AT,
      },
      {
        kind: "BROWSER_MEASUREMENT",
        artifactRef: `artifact:sha256:${DIGESTS[1]}`,
        objectKey: artifactObjectKey(retentionClass, "BROWSER_MEASUREMENT", DIGESTS[1]),
        byteLength: 100,
        sha256: DIGESTS[1],
        etag: `fixture-${DIGESTS[1].slice(0, 16)}`,
        uploadedAt: VERIFIED_AT,
      },
    ],
  });
}

function use(
  useType: ArtifactEvidenceUse["useType"],
  useId = "33333333-3333-4333-8333-333333333333",
): ArtifactEvidenceUse {
  return {
    useId,
    useType,
    recordId: `${useType.toLocaleLowerCase("en-CA")}:fixture`,
    recordVersion: "fixture-v1",
    businessId: BUSINESS_ID,
    recordedAt: "2026-08-22T20:30:00.000Z",
  };
}

function lifecycleObject(
  item: ArtifactManifest["items"][number],
  retentionClass: ArtifactRetentionClass,
  overrides: Partial<LifecycleObject> = {},
): LifecycleObject {
  return {
    objectKey: artifactObjectKey(retentionClass, item.kind, item.sha256),
    byteLength: item.byteLength,
    sha256: item.sha256,
    etag: item.etag,
    uploadedAt: item.uploadedAt,
    storageClass: "STANDARD",
    httpMetadata: {
      contentType: item.kind === "BROWSER_SCREENSHOT" ? "image/webp" : "application/json",
      cacheControl: "private, no-store",
    },
    customMetadata: {
      contractVersion: ARTIFACT_STORE_CONTRACT_VERSION,
      kind: item.kind,
      sha256: item.sha256,
      retentionClass,
    },
    ...overrides,
  };
}

function fixtureStore(sourceManifest: ArtifactManifest) {
  const objects = new Map<string, LifecycleObject>();
  for (const item of sourceManifest.items) objects.set(item.objectKey, lifecycleObject(item, sourceManifest.retentionClass));
  let headReads = 0;
  let copyAttempts = 0;
  const store: FixtureArtifactLifecycleStore = {
    kind: "FIXTURE",
    async head(objectKey) {
      headReads += 1;
      return objects.get(objectKey) ?? null;
    },
    async copyIfAbsent(request: FixtureCopyRequest) {
      copyAttempts += 1;
      if (objects.has(request.targetObjectKey)) return { outcome: "ALREADY_EXISTS", object: null };
      const source = objects.get(request.sourceObjectKey);
      if (!source) throw new Error("Synthetic source disappeared during copy.");
      const object = lifecycleObject({
        kind: request.kind,
        artifactRef: `artifact:sha256:${request.sha256}`,
        objectKey: request.targetObjectKey,
        byteLength: request.byteLength,
        sha256: request.sha256,
        etag: source.etag,
        uploadedAt: source.uploadedAt,
      }, request.targetRetentionClass, {
        objectKey: request.targetObjectKey,
        etag: `promoted-${request.sha256.slice(0, 16)}`,
        uploadedAt: REQUESTED_AT,
      });
      objects.set(request.targetObjectKey, object);
      return { outcome: "CREATED", object };
    },
  };
  return {
    store,
    objects,
    get headReads() { return headReads; },
    get copyAttempts() { return copyAttempts; },
  };
}

function promotionRequest(
  sourceManifest: ArtifactManifest,
  evidenceUses: ArtifactEvidenceUse[],
  promotionId = "44444444-4444-4444-8444-444444444444",
) {
  return {
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    promotionId,
    workflowId: WORKFLOW_ID,
    requestedAt: REQUESTED_AT,
    mode: "SHADOW",
    executorKind: "FIXTURE",
    providerCopyAuthorized: false,
    maxCostUsd: 0,
    businessId: BUSINESS_ID,
    sourceManifest,
    evidenceUses,
  };
}

test("a completed write receipt becomes a strongly bound shadow manifest", () => {
  const source = manifest();
  assert.throws(
    () => ArtifactManifestSchema.parse({ ...source, verifiedAt: "2026-08-22T19:59:59.000Z" }),
    /cannot be uploaded after manifest verification/,
  );
  const receipt = {
    contractVersion: ARTIFACT_STORE_CONTRACT_VERSION,
    planId: MANIFEST_ID,
    workflowId: WORKFLOW_ID,
    mode: "SHADOW",
    storeKind: "FIXTURE",
    providerWritePerformed: false,
    retentionClass: "SHADOW_30D",
    startedAt: VERIFIED_AT,
    completedAt: VERIFIED_AT,
    plannedItemCount: source.items.length,
    fixturePutAttempts: source.items.length,
    fixtureHeadReads: 0,
    providerClassAOperations: 0,
    providerClassBOperations: 0,
    costUsd: 0,
    rollbackAction: "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS",
    outcome: "COMPLETED",
    items: source.items.map((item) => ({ ...item, operation: "CREATED" })),
    failure: null,
  } as ArtifactWriteReceipt;
  assert.deepEqual(artifactManifestFromWriteReceipt(receipt), source);
  assert.throws(
    () => artifactManifestFromWriteReceipt({
      ...receipt,
      outcome: "FAILED",
      items: [],
      fixturePutAttempts: 1,
      failure: { itemIndex: 0, code: "STORE_ERROR", message: "Synthetic failure." },
    } as ArtifactWriteReceipt),
    /Only a completed artifact write receipt/,
  );
});

test("qualification promotion preserves content identity under a longer-lived prefix", async () => {
  const source = manifest();
  const plan = createArtifactPromotionPlan(promotionRequest(source, [use("QUALIFICATION_SNAPSHOT")]));
  assert.equal(plan.action, "COPY_REQUIRED");
  assert.equal(plan.targetRetentionClass, "QUALIFICATION_180D");
  assert.ok(plan.items.every((item) => item.artifactRef === `artifact:sha256:${item.sha256}`));
  assert.ok(plan.items.every((item) => item.targetObjectKey.startsWith("qualification/180d/v1/")));
  assert.throws(
    () => ArtifactPromotionPlanSchema.parse({
      ...plan,
      requiredRetentionClass: "LEGAL_HOLD",
      targetRetentionClass: "LEGAL_HOLD",
    }),
    /required retention must be derived|minimum class/,
  );

  const harness = fixtureStore(source);
  const receipt = await executeFixtureArtifactPromotion(plan, { store: harness.store, now: () => new Date(REQUESTED_AT) });
  assert.equal(receipt.outcome, "COMPLETED");
  assert.equal(receipt.providerCopyPerformed, false);
  assert.equal(receipt.costUsd, 0);
  assert.deepEqual(receipt.items.map((item) => item.operation), ["CREATED", "CREATED"]);
  assert.equal(receipt.resultManifest.retentionClass, "QUALIFICATION_180D");
  assert.deepEqual(receipt.resultManifest.items.map((item) => item.artifactRef), source.items.map((item) => item.artifactRef));
  assert.deepEqual(artifactManifestFromPromotionReceipt(plan, receipt), receipt.resultManifest);
  assert.throws(
    () => artifactManifestFromPromotionReceipt(plan, { ...receipt, promotionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }),
    /does not match its exact plan|reconcile every planned item/,
  );
  assert.throws(
    () => ArtifactPromotionReceiptSchema.parse({
      ...receipt,
      items: receipt.items.map((item, index) => index === 0
        ? { ...item, objectKey: artifactObjectKey("LEGAL_HOLD", item.kind, item.sha256) }
        : item),
    }),
    /key must match its target retention/,
  );
});

test("promotion retries reuse matching target objects without overwriting", async () => {
  const source = manifest();
  const plan = createArtifactPromotionPlan(promotionRequest(source, [use("QUALIFICATION_SNAPSHOT")]));
  const harness = fixtureStore(source);
  const first = await executeFixtureArtifactPromotion(plan, { store: harness.store, now: () => new Date(REQUESTED_AT) });
  const second = await executeFixtureArtifactPromotion(plan, { store: harness.store, now: () => new Date(REQUESTED_AT) });
  assert.equal(first.outcome, "COMPLETED");
  assert.equal(second.outcome, "COMPLETED");
  if (second.outcome !== "COMPLETED") return;
  assert.deepEqual(second.items.map((item) => item.operation), ["REUSED", "REUSED"]);
  assert.equal(harness.copyAttempts, 4);
  assert.equal(harness.objects.size, 4);
});

test("qualified evidence can later promote to outreach and then legal hold", async () => {
  const source = manifest();
  const harness = fixtureStore(source);
  const qualification = await executeFixtureArtifactPromotion(
    createArtifactPromotionPlan(promotionRequest(source, [use("QUALIFICATION_SNAPSHOT")])),
    { store: harness.store, now: () => new Date(REQUESTED_AT) },
  );
  assert.equal(qualification.outcome, "COMPLETED");
  if (qualification.outcome !== "COMPLETED") return;
  const qualificationManifest = artifactManifestFromPromotionReceipt(
    createArtifactPromotionPlan(promotionRequest(source, [use("QUALIFICATION_SNAPSHOT")])),
    qualification,
  );
  const outreachPlan = createArtifactPromotionPlan(promotionRequest(
    qualificationManifest,
    [use("OUTREACH_APPROVAL", "55555555-5555-4555-8555-555555555555")],
    "66666666-6666-4666-8666-666666666666",
  ));
  assert.equal(outreachPlan.targetRetentionClass, "OUTREACH_ACTIVE");
  const outreach = await executeFixtureArtifactPromotion(outreachPlan, {
    store: harness.store,
    now: () => new Date(REQUESTED_AT),
  });
  assert.equal(outreach.outcome, "COMPLETED");
  if (outreach.outcome !== "COMPLETED") return;
  const outreachManifest = artifactManifestFromPromotionReceipt(outreachPlan, outreach);
  const legalPlan = createArtifactPromotionPlan(promotionRequest(
    outreachManifest,
    [use("LEGAL_HOLD", "77777777-7777-4777-8777-777777777777")],
    "88888888-8888-4888-8888-888888888888",
  ));
  assert.equal(legalPlan.targetRetentionClass, "LEGAL_HOLD");
  const legal = await executeFixtureArtifactPromotion(legalPlan, { store: harness.store, now: () => new Date(REQUESTED_AT) });
  assert.equal(legal.outcome, "COMPLETED");
  if (legal.outcome !== "COMPLETED") return;
  assert.equal(legal.resultManifest.retentionClass, "LEGAL_HOLD");
});

test("already protected evidence produces an idempotent no-copy receipt", async () => {
  const protectedManifest = manifest("OUTREACH_ACTIVE");
  const plan = createArtifactPromotionPlan(promotionRequest(protectedManifest, [use("QUALIFICATION_SNAPSHOT")]));
  assert.equal(plan.action, "NO_COPY_REQUIRED");
  assert.equal(plan.targetRetentionClass, "OUTREACH_ACTIVE");
  const harness = fixtureStore(protectedManifest);
  const receipt = await executeFixtureArtifactPromotion(plan, { store: harness.store, now: () => new Date(REQUESTED_AT) });
  assert.equal(receipt.outcome, "COMPLETED");
  assert.equal(receipt.fixtureCopyAttempts, 0);
  assert.equal(receipt.fixtureHeadReads, 0);
  assert.deepEqual(receipt.resultManifest, protectedManifest);
});

test("missing or conflicting source and target objects fail without deletion", async () => {
  const source = manifest();
  const plan = createArtifactPromotionPlan(promotionRequest(source, [use("QUALIFICATION_SNAPSHOT")]));
  assert.equal(plan.action, "COPY_REQUIRED");
  const missing = fixtureStore(source);
  missing.objects.delete(source.items[0].objectKey);
  const missingReceipt = await executeFixtureArtifactPromotion(plan, { store: missing.store, now: () => new Date(REQUESTED_AT) });
  assert.equal(missingReceipt.outcome, "FAILED");
  if (missingReceipt.outcome === "FAILED") assert.equal(missingReceipt.failure.code, "SOURCE_MISSING");
  assert.equal(missingReceipt.rollbackAction, "NONE_KEEP_CONTENT_ADDRESSED_ORPHANS");

  const conflict = fixtureStore(source);
  const firstTarget = plan.items[0].targetObjectKey;
  conflict.objects.set(firstTarget, lifecycleObject(source.items[0], "QUALIFICATION_180D", { sha256: "f".repeat(64) }));
  const conflictReceipt = await executeFixtureArtifactPromotion(plan, { store: conflict.store, now: () => new Date(REQUESTED_AT) });
  assert.equal(conflictReceipt.outcome, "FAILED");
  if (conflictReceipt.outcome === "FAILED") assert.equal(conflictReceipt.failure.code, "TARGET_MISMATCH");
});

test("release approval is content-bound and never deletes or grants provider authority", () => {
  const protectedManifest = manifest("OUTREACH_ACTIVE");
  const uses = [
    use("OUTREACH_TOUCH", "99999999-9999-4999-8999-999999999999"),
    use("CONSENT_EVIDENCE", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  ];
  const request = {
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    releaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    businessId: BUSINESS_ID,
    decidedAt: REQUESTED_AT,
    mode: "SHADOW",
    recorderKind: "FIXTURE",
    providerDeleteAuthorized: false,
    maxCostUsd: 0,
    manifest: protectedManifest,
    activeEvidenceUses: uses,
    reviewedUseIds: uses.map((item) => item.useId),
    actor: { actorUserId: "owner:riley", role: "OWNER" },
    decision: "RELEASE_APPROVED",
    reasonCode: "OUTREACH_RETENTION_REVIEW_COMPLETE",
    rationale: "The synthetic outreach and consent references were reviewed and are no longer active.",
    confirmation: ARTIFACT_RELEASE_CONFIRMATION,
  } as const;
  const first = createArtifactReleaseRecord(request);
  const second = createArtifactReleaseRecord({
    ...request,
    activeEvidenceUses: [...uses].reverse(),
    reviewedUseIds: [...request.reviewedUseIds].reverse(),
  });
  assert.deepEqual(first, second);
  assert.equal(first.releaseApproved, true);
  assert.equal(first.providerDeleteAuthorized, false);
  assert.equal(first.providerDeletePerformed, false);
  assert.equal(first.requiresFreshReferenceCheckBeforeDeletion, true);
  assert.equal(first.requiresSeparateDeletionReleaseGate, true);
  assert.throws(
    () => ArtifactReleaseRecordSchema.parse({ ...first, decisionDigest: "f".repeat(64) }),
    /digest must bind the exact decision content/,
  );
});

test("release decisions reject partial review, wrong basis, and expiring classes", () => {
  const protectedManifest = manifest("LEGAL_HOLD");
  const uses = [use("LEGAL_HOLD")];
  const base = {
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    releaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    businessId: BUSINESS_ID,
    decidedAt: REQUESTED_AT,
    mode: "SHADOW",
    recorderKind: "FIXTURE",
    providerDeleteAuthorized: false,
    maxCostUsd: 0,
    manifest: protectedManifest,
    activeEvidenceUses: uses,
    reviewedUseIds: uses.map((item) => item.useId),
    actor: { actorUserId: "owner:riley", role: "OWNER" },
    decision: "RELEASE_APPROVED",
    reasonCode: "LEGAL_HOLD_CLEARED",
    rationale: "The synthetic legal hold was explicitly reviewed and cleared by the owner.",
    confirmation: ARTIFACT_RELEASE_CONFIRMATION,
  } as const;
  assert.equal(createArtifactReleaseRecord(base).retentionClass, "LEGAL_HOLD");
  assert.throws(() => createArtifactReleaseRecord({ ...base, reviewedUseIds: [] }), /at least 1|reviewed/);
  assert.throws(
    () => createArtifactReleaseRecord({ ...base, reviewedUseIds: [uses[0].useId, uses[0].useId] }),
    /reviewed exactly once/,
  );
  assert.throws(
    () => createArtifactReleaseRecord({ ...base, reasonCode: "OUTREACH_RETENTION_REVIEW_COMPLETE" }),
    /reason must match/,
  );
  assert.throws(
    () => createArtifactReleaseRecord({ ...base, manifest: manifest("SHADOW_30D") }),
    /Only protected retention classes/,
  );
});

test("keep-protected records remain explicit without release confirmation", () => {
  const protectedManifest = manifest("OUTREACH_ACTIVE");
  const evidenceUse = use("OUTREACH_APPROVAL");
  const record = createArtifactReleaseRecord({
    contractVersion: ARTIFACT_LIFECYCLE_CONTRACT_VERSION,
    releaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    businessId: BUSINESS_ID,
    decidedAt: REQUESTED_AT,
    mode: "SHADOW",
    recorderKind: "FIXTURE",
    providerDeleteAuthorized: false,
    maxCostUsd: 0,
    manifest: protectedManifest,
    activeEvidenceUses: [evidenceUse],
    reviewedUseIds: [evidenceUse.useId],
    actor: { actorUserId: "owner:riley", role: "OWNER" },
    decision: "KEEP_PROTECTED",
    reasonCode: "ACTIVE_REFERENCE_REMAINS",
    rationale: "The synthetic outreach reference is still active and the evidence must remain protected.",
    confirmation: null,
  });
  assert.equal(record.releaseApproved, false);
  assert.equal(record.providerDeleteAuthorized, false);
});
