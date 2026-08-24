import assert from "node:assert/strict";
import test from "node:test";

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
  ARTIFACT_EVIDENCE_USE_END_VERSION,
  ARTIFACT_REFERENCE_PROJECTION_VERSION,
  artifactReferenceDigest,
  createArtifactEvidenceUseEndRecord,
  createArtifactReferenceProjection,
  createFixtureArtifactReferenceSnapshotReceipt,
  verifyArtifactReferenceProjectionCurrent,
  type ArtifactEvidenceUseEndRecord,
  type ArtifactReferenceSourceFacts,
} from "@/lib/revenue-engine/artifact-reference-projection";
import { artifactObjectKey } from "@/lib/revenue-engine/content-addressed-artifact-store";

const BUSINESS_ID = "business:reference-fixture";
const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const ROOT_ID = "22222222-2222-4222-8222-222222222222";
const QUALIFICATION_ID = "33333333-3333-4333-8333-333333333333";
const OUTREACH_ID = "44444444-4444-4444-8444-444444444444";
const LEGAL_ID = "55555555-5555-4555-8555-555555555555";
const QUALIFICATION_USE_ID = "66666666-6666-4666-8666-666666666666";
const OUTREACH_USE_ID = "77777777-7777-4777-8777-777777777777";
const LEGAL_USE_ID = "88888888-8888-4888-8888-888888888888";
const PROJECTED_AT = "2026-08-24T12:00:00.000Z";
const SNAPSHOT_AT = "2026-08-24T11:59:00.000Z";
const FRESH_UNTIL = "2026-08-24T12:05:00.000Z";
const SHA256 = "a".repeat(64);

function evidenceUse(useId: string, useType: ArtifactEvidenceUse["useType"], recordedAt = "2026-08-24T10:00:00.000Z"): ArtifactEvidenceUse {
  return { useId, useType, recordId: `${useType.toLowerCase()}:fixture`, recordVersion: "v1", businessId: BUSINESS_ID, recordedAt };
}

const qualificationUse = evidenceUse(QUALIFICATION_USE_ID, "QUALIFICATION_SNAPSHOT");
const outreachUse = evidenceUse(OUTREACH_USE_ID, "OUTREACH_TOUCH", "2026-08-24T10:30:00.000Z");
const legalUse = evidenceUse(LEGAL_USE_ID, "LEGAL_HOLD", "2026-08-24T11:00:00.000Z");

function rootManifest(retentionClass: ArtifactManifest["retentionClass"] = "SHADOW_30D", id = ROOT_ID): ArtifactManifest {
  return ArtifactManifestSchema.parse({
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    manifestId: id,
    workflowId: WORKFLOW_ID,
    retentionClass,
    verifiedAt: "2026-08-24T09:00:00.000Z",
    provenance: { receiptType: "ARTIFACT_WRITE", receiptId: id },
    items: [{
      kind: "BROWSER_MEASUREMENT",
      artifactRef: `artifact:sha256:${SHA256}`,
      objectKey: artifactObjectKey(retentionClass, "BROWSER_MEASUREMENT", SHA256),
      byteLength: 128,
      sha256: SHA256,
      etag: `etag-${retentionClass.toLowerCase()}`,
      uploadedAt: "2026-08-24T08:59:00.000Z",
    }],
  });
}

function promote(source: ArtifactManifest, promotionId: string, evidenceUses: ArtifactEvidenceUse[], completedAt: string) {
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
    etag: `etag-${promotionId}`,
    uploadedAt: completedAt,
  }));
  const resultManifest = plan.action === "NO_COPY_REQUIRED"
    ? source
    : ArtifactManifestSchema.parse({
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
  return { plan, receipt, manifest: resultManifest };
}

function availability(manifest: ArtifactManifest, overrides: Partial<ArtifactReferenceSourceFacts["availability"][number]> = {}) {
  const expiring = ["SHADOW_30D", "QUALIFICATION_180D"].includes(manifest.retentionClass);
  return {
    manifestId: manifest.manifestId,
    availabilityVersion: "artifact-manifest-availability-v1" as const,
    state: "VERIFIED_PRESENT" as const,
    checkedAt: SNAPSHOT_AT,
    validThrough: FRESH_UNTIL,
    expiresAt: expiring ? "2027-02-20T09:00:00.000Z" : null,
    receiptDigest: artifactReferenceDigest({ manifestId: manifest.manifestId, state: "VERIFIED_PRESENT" }),
    checkerKind: "FIXTURE" as const,
    ...overrides,
  };
}

function link(manifest: ArtifactManifest, evidenceUse: ArtifactEvidenceUse, promotionId: string, linkedAt: string) {
  return {
    linkId: `${manifest.manifestId}:${evidenceUse.useId}`,
    manifestId: manifest.manifestId,
    evidenceUse,
    viaPromotionId: promotionId,
    linkedAt,
  };
}

function ending(evidenceUse: ArtifactEvidenceUse, endId: string, reasonCode: "RECORD_RETENTION_COMPLETE" | "LEGAL_HOLD_CLEARED" = "RECORD_RETENTION_COMPLETE"): ArtifactEvidenceUseEndRecord {
  const legal = evidenceUse.useType === "LEGAL_HOLD";
  return createArtifactEvidenceUseEndRecord({
    endVersion: ARTIFACT_EVIDENCE_USE_END_VERSION,
    endId,
    endedUse: evidenceUse,
    endedAt: "2026-08-24T11:30:00.000Z",
    recordedAt: "2026-08-24T11:31:00.000Z",
    reasonCode,
    basis: {
      basisType: legal ? "LEGAL_CLEARANCE" : "OWNER_RETENTION_REVIEW",
      basisRecordId: legal ? "legal-clearance:fixture" : "retention-review:fixture",
      basisRecordVersion: "v1",
      basisDigest: "b".repeat(64),
    },
    replacementUse: null,
    actor: { actorUserId: "owner:fixture", role: legal ? "COMPLIANCE" : "OWNER" },
    mode: "SHADOW",
    recorderKind: "FIXTURE",
    maxCostUsd: 0,
  });
}

function lineageFacts() {
  const root = rootManifest();
  const qualification = promote(root, QUALIFICATION_ID, [qualificationUse], "2026-08-24T10:10:00.000Z");
  const outreach = promote(qualification.manifest, OUTREACH_ID, [qualificationUse, outreachUse], "2026-08-24T10:40:00.000Z");
  const legal = promote(outreach.manifest, LEGAL_ID, [qualificationUse, outreachUse, legalUse], "2026-08-24T11:10:00.000Z");
  const facts: ArtifactReferenceSourceFacts = {
    workflowRun: { workflowRunId: WORKFLOW_ID, businessId: BUSINESS_ID, workflowKind: "WEBSITE_EVIDENCE", workflowVersion: "fixture-v1", requestDigest: "f".repeat(64) },
    manifests: [root, qualification.manifest, outreach.manifest, legal.manifest],
    promotions: [qualification, outreach, legal].map(({ plan, receipt }) => ({ plan, receipt })),
    manifestEvidenceUses: [
      link(qualification.manifest, qualificationUse, QUALIFICATION_ID, qualification.receipt.completedAt),
      link(outreach.manifest, qualificationUse, OUTREACH_ID, outreach.receipt.completedAt),
      link(outreach.manifest, outreachUse, OUTREACH_ID, outreach.receipt.completedAt),
      link(legal.manifest, qualificationUse, LEGAL_ID, legal.receipt.completedAt),
      link(legal.manifest, outreachUse, LEGAL_ID, legal.receipt.completedAt),
      link(legal.manifest, legalUse, LEGAL_ID, legal.receipt.completedAt),
    ],
    evidenceUseEnds: [],
    availability: [root, qualification.manifest, outreach.manifest, legal.manifest].map((manifest) => availability(manifest)),
  };
  return { facts, root, qualification, outreach, legal };
}

function projection(sourceFacts: ArtifactReferenceSourceFacts, projectionId = "99999999-9999-4999-8999-999999999999") {
  const snapshot = createFixtureArtifactReferenceSnapshotReceipt({ snapshotCapturedAt: SNAPSHOT_AT, freshUntil: FRESH_UNTIL, sourceFacts });
  return createArtifactReferenceProjection({
    projectionVersion: ARTIFACT_REFERENCE_PROJECTION_VERSION,
    projectionId,
    businessId: BUSINESS_ID,
    lineageRootManifestId: ROOT_ID,
    projectedAt: PROJECTED_AT,
    mode: "SHADOW",
    projectorKind: "FIXTURE",
    maxCostUsd: 0,
    sourceFacts,
    snapshot,
  });
}

test("lineage projection chooses the weakest valid copy for each active use", () => {
  const { facts } = lineageFacts();
  facts.evidenceUseEnds = [ending(legalUse, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "LEGAL_HOLD_CLEARED")];
  const result = projection(facts);
  assert.equal(result.state, "ACTIVE_REFERENCES");
  assert.equal(result.requiredRetentionClass, "OUTREACH_ACTIVE");
  const qualification = result.uses.find((item) => item.evidenceUseId === QUALIFICATION_USE_ID)!;
  const outreach = result.uses.find((item) => item.evidenceUseId === OUTREACH_USE_ID)!;
  const legal = result.uses.find((item) => item.evidenceUseId === LEGAL_USE_ID)!;
  assert.deepEqual(qualification.assignments.map((item) => item.manifestId), [QUALIFICATION_ID]);
  assert.deepEqual(outreach.assignments.map((item) => item.manifestId), [OUTREACH_ID]);
  assert.equal(legal.state, "ENDED");
  assert.ok(result.unassignedManifestIds.includes(LEGAL_ID));
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.deletionAuthorized, false);
});

test("all ended uses produce a review suggestion but never deletion authority", () => {
  const { facts } = lineageFacts();
  facts.evidenceUseEnds = [
    ending(qualificationUse, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    ending(outreachUse, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    ending(legalUse, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "LEGAL_HOLD_CLEARED"),
  ];
  const result = projection(facts);
  assert.equal(result.state, "NO_CURRENT_REFERENCES");
  assert.equal(result.activeUseCount, 0);
  assert.equal(result.requiredRetentionClass, null);
  assert.equal(result.retentionReviewSuggested, true);
  assert.equal(result.requiresFreshReferenceCheck, true);
  assert.equal(result.providerDeleteAuthorized, false);
});

test("expired weaker evidence falls back to a valid stronger copy", () => {
  const { facts } = lineageFacts();
  facts.evidenceUseEnds = [
    ending(outreachUse, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    ending(legalUse, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "LEGAL_HOLD_CLEARED"),
  ];
  facts.availability = facts.availability.map((record) => record.manifestId === QUALIFICATION_ID
    ? { ...record, expiresAt: PROJECTED_AT }
    : record);
  const result = projection(facts);
  const qualification = result.uses.find((item) => item.evidenceUseId === QUALIFICATION_USE_ID)!;
  assert.deepEqual(qualification.assignments.map((item) => item.manifestId), [OUTREACH_ID]);
});

test("equal-rank candidates remain ambiguous and block a current-reference conclusion", () => {
  const root = rootManifest();
  const first = promote(root, QUALIFICATION_ID, [qualificationUse], "2026-08-24T10:10:00.000Z");
  const second = promote(root, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", [qualificationUse], "2026-08-24T10:20:00.000Z");
  const facts: ArtifactReferenceSourceFacts = {
    workflowRun: { workflowRunId: WORKFLOW_ID, businessId: BUSINESS_ID, workflowKind: "WEBSITE_EVIDENCE", workflowVersion: "fixture-v1", requestDigest: "f".repeat(64) },
    manifests: [root, first.manifest, second.manifest],
    promotions: [first, second].map(({ plan, receipt }) => ({ plan, receipt })),
    manifestEvidenceUses: [
      link(first.manifest, qualificationUse, first.plan.promotionId, first.receipt.completedAt),
      link(second.manifest, qualificationUse, second.plan.promotionId, second.receipt.completedAt),
    ],
    evidenceUseEnds: [],
    availability: [root, first.manifest, second.manifest].map((manifest) => availability(manifest)),
  };
  const result = projection(facts);
  assert.equal(result.state, "INDETERMINATE");
  assert.equal(result.ambiguousUseCount, 1);
  assert.equal(result.uses[0]?.assignmentState, "AMBIGUOUS");
  assert.equal(result.uses[0]?.assignments.length, 2);
  assert.equal(result.retentionReviewSuggested, false);
});

test("a no-copy promotion is a use-link event rather than a lineage cycle", () => {
  const root = rootManifest("QUALIFICATION_180D");
  const noCopy = promote(root, QUALIFICATION_ID, [qualificationUse], "2026-08-24T10:10:00.000Z");
  assert.equal(noCopy.plan.action, "NO_COPY_REQUIRED");
  const facts: ArtifactReferenceSourceFacts = {
    workflowRun: { workflowRunId: WORKFLOW_ID, businessId: BUSINESS_ID, workflowKind: "WEBSITE_EVIDENCE", workflowVersion: "fixture-v1", requestDigest: "f".repeat(64) },
    manifests: [root],
    promotions: [{ plan: noCopy.plan, receipt: noCopy.receipt }],
    manifestEvidenceUses: [link(root, qualificationUse, QUALIFICATION_ID, noCopy.receipt.completedAt)],
    evidenceUseEnds: [],
    availability: [availability(root)],
  };
  const result = projection(facts);
  assert.equal(result.state, "ACTIVE_REFERENCES");
  assert.deepEqual(result.uses[0]?.assignments.map((item) => item.manifestId), [ROOT_ID]);
});

test("invalid endings and broken promotion-use lineage fail closed", () => {
  assert.throws(() => ending(legalUse, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), /legal hold requires/i);
  assert.throws(() => createArtifactEvidenceUseEndRecord({
    endVersion: ARTIFACT_EVIDENCE_USE_END_VERSION,
    endId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    endedUse: qualificationUse,
    endedAt: "2026-08-24T09:00:00.000Z",
    recordedAt: "2026-08-24T09:01:00.000Z",
    reasonCode: "RECORD_RETENTION_COMPLETE",
    basis: { basisType: "OWNER_RETENTION_REVIEW", basisRecordId: "review", basisRecordVersion: "v1", basisDigest: "b".repeat(64) },
    replacementUse: null,
    actor: { actorUserId: "owner", role: "OWNER" },
    mode: "SHADOW",
    recorderKind: "FIXTURE",
    maxCostUsd: 0,
  }), /cannot end before/i);

  const { facts } = lineageFacts();
  facts.manifestEvidenceUses[0] = { ...facts.manifestEvidenceUses[0]!, viaPromotionId: OUTREACH_ID };
  assert.throws(() => projection(facts), /does not match its promotion result/i);
});

test("replacement endings bind the exact same-business replacement version", () => {
  const replacement = evidenceUse("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "QUALIFICATION_SNAPSHOT", "2026-08-24T10:30:00.000Z");
  const request = {
    endVersion: ARTIFACT_EVIDENCE_USE_END_VERSION,
    endId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    endedUse: qualificationUse,
    endedAt: "2026-08-24T11:00:00.000Z",
    recordedAt: "2026-08-24T11:01:00.000Z",
    reasonCode: "REPLACED_BY_EVIDENCE_USE",
    basis: {
      basisType: "EVIDENCE_USE_REPLACEMENT",
      basisRecordId: replacement.useId,
      basisRecordVersion: replacement.recordVersion,
      basisDigest: artifactReferenceDigest(replacement),
    },
    replacementUse: replacement,
    actor: { actorUserId: "owner", role: "OWNER" },
    mode: "SHADOW",
    recorderKind: "FIXTURE",
    maxCostUsd: 0,
  } as const;
  assert.equal(createArtifactEvidenceUseEndRecord(request).replacementEvidenceUseId, replacement.useId);
  assert.throws(() => createArtifactEvidenceUseEndRecord({
    ...request,
    basis: { ...request.basis, basisDigest: "0".repeat(64) },
  }), /exact replacement evidence-use version/i);
});

test("freshness verification detects time expiry and later source facts without granting authority", () => {
  const { facts } = lineageFacts();
  const result = projection(facts);
  assert.deepEqual(verifyArtifactReferenceProjectionCurrent(result, { checkedAt: PROJECTED_AT, sourceFacts: facts }), {
    state: "CURRENT",
    sourceFactsMatch: true,
    withinFreshnessWindow: true,
    releaseAuthorized: false,
    deletionAuthorized: false,
    providerDeleteAuthorized: false,
  });
  const changed = { ...facts, evidenceUseEnds: [ending(qualificationUse, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")] };
  assert.equal(verifyArtifactReferenceProjectionCurrent(result, { checkedAt: PROJECTED_AT, sourceFacts: changed }).state, "STALE");
  assert.equal(verifyArtifactReferenceProjectionCurrent(result, { checkedAt: "2026-08-24T12:06:00.000Z", sourceFacts: facts }).state, "STALE");
});

test("source ordering does not change the projection result", () => {
  const { facts } = lineageFacts();
  const first = projection(facts);
  const reversed: ArtifactReferenceSourceFacts = {
    workflowRun: facts.workflowRun,
    manifests: [...facts.manifests].reverse(),
    promotions: [...facts.promotions].reverse(),
    manifestEvidenceUses: [...facts.manifestEvidenceUses].reverse(),
    evidenceUseEnds: [...facts.evidenceUseEnds].reverse(),
    availability: [...facts.availability].reverse(),
  };
  assert.deepEqual(projection(reversed), first);
});
