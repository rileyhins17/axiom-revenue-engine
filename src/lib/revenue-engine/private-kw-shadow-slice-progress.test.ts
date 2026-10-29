import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
  type PrivateKwImportInput,
} from "@/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "@/lib/revenue-engine/private-kw-persistence-plan";
import {
  PRIVATE_KW_SHADOW_SLICE_VERSION,
  buildPrivateKwShadowSliceManifest,
  type PrivateKwShadowSliceInput,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
  PrivateKwShadowSliceProgressCheckpointSchema,
  appendPrivateKwShadowSliceProgress,
  buildInitialPrivateKwShadowSliceProgress,
  privateKwShadowSliceProgressDigest,
  type PrivateKwShadowSlicePhaseReceipt,
  type PrivateKwShadowSlicePhaseReceiptInput,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";

function sourceInput(): PrivateKwImportInput {
  const cities = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
  const niches = ["ROOFING", "HVAC", "LANDSCAPING"] as const;
  return {
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: "shadow-progress-source-20260801",
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic receipt-bound progress cohort",
    filters: { purpose: "shadow-progress" },
    capturedAt: "2026-08-01T15:00:00.000Z",
    costUsd: 0,
    records: Array.from({ length: 10 }, (_, index) => ({
      sourceOwnedId: `progress-${index}`,
      sourceEvidenceUrl: `https://directory.getaxiom.ca/progress-${index}`,
      businessName: `Synthetic Progress Business ${index}`,
      city: cities[index % cities.length],
      region: "ON" as const,
      country: "CA" as const,
      niche: niches[index % niches.length],
      websiteUrl: `https://progress-${index}.getaxiom.ca`,
      phone: `519555${String(3000 + index)}`,
      addressLine: `${index + 1} Progress Street`,
      postalCode: "N2G 1A1",
      independenceStatus: "INDEPENDENT" as const,
      capturedAt: "2026-08-01T14:00:00.000Z",
      sourcePayload: { synthetic: true, index },
    })),
  };
}

function manifestFixture() {
  const source = preparePrivateKwImport(sourceInput());
  const input: PrivateKwShadowSliceInput = {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION,
    sliceKey: "kw-progress-fixture",
    sourceImportId: source.importId,
    sourcePlanDigest: buildPrivateKwPersistencePlan(source).sourcePlanDigest,
    createdAt: "2026-08-03T15:00:00.000Z",
    selections: source.records.map((record) => ({
      businessId: record.business.id,
      evaluationCandidateId: record.evaluationCandidateId,
      sourceReview: {
        decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE",
        reviewedBy: "RILEY",
        reviewedAt: "2026-08-02T15:00:00.000Z",
        rationale: "Synthetic identity, market, niche, and independence were reviewed.",
        identityConfirmed: true,
        marketAndNicheConfirmed: true,
        independenceConfirmed: true,
      },
    })),
    mode: "SHADOW",
    authority: {
      planOnly: true,
      liveSourceAuthorized: false,
      browserCaptureAuthorized: false,
      artifactStorageAuthorized: false,
      databaseMutationAuthorized: false,
      contactDiscoveryExecutionAuthorized: false,
      contactVerificationExecutionAuthorized: false,
      consentDecisionAuthorized: false,
      qualificationAuthorized: false,
      mailboxSyncAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      deploymentAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
  return buildPrivateKwShadowSliceManifest(source, input);
}

const zeroAuthority = {
  progressRecordingOnly: true as const,
  phaseExecutionAuthorized: false as const,
  liveSourceAuthorized: false as const,
  browserCaptureAuthorized: false as const,
  artifactStorageAuthorized: false as const,
  databaseMutationAuthorized: false as const,
  contactDiscoveryExecutionAuthorized: false as const,
  contactVerificationExecutionAuthorized: false as const,
  consentDecisionAuthorized: false as const,
  qualificationAuthorized: false as const,
  mailboxSyncAuthorized: false as const,
  outreachAuthorized: false as const,
  sendAuthorized: false as const,
  deploymentAuthorized: false as const,
  providerOperationsAuthorized: 0 as const,
  costAuthorizedUsd: 0 as const,
};

function receiptInput(
  manifest: ReturnType<typeof manifestFixture>,
  businessIndex: number,
  phase: PrivateKwShadowSlicePhaseReceiptInput["phase"] = "SOURCE_WORKFLOW",
  previous: PrivateKwShadowSlicePhaseReceipt | null = null,
  seed = businessIndex + 1,
): PrivateKwShadowSlicePhaseReceiptInput {
  const record = manifest.records[businessIndex];
  const phaseIndex = ["SOURCE_WORKFLOW", "CURRENT_WEBSITE_EVIDENCE", "ASSESSMENT", "CONTACT_REVIEW", "OWNER_DOSSIER"].indexOf(phase);
  const primaryPrefixes = ["kw-materialization", "website-evidence", "assessment", "kw-contact-invocation", "owner-dossier-acceptance"];
  const proofKinds = [
    "SOURCE_WORKFLOW_MATERIALIZATION",
    "CURRENT_WEBSITE_EVIDENCE",
    "IMMUTABLE_ASSESSMENT",
    "OWNER_REVIEWED_CONTACT_INVOCATION",
    "READ_ONLY_OWNER_DOSSIER_ACCEPTANCE",
  ] as const;
  const hex = ((seed + phaseIndex) % 15 + 1).toString(16);
  return {
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    phase,
    completedAt: `2026-08-0${4 + phaseIndex}T15:00:00.000Z`,
    proof: {
      proofKind: proofKinds[phaseIndex],
      primaryReceiptId: `${primaryPrefixes[phaseIndex]}:${hex.repeat(64)}`,
      primaryReceiptDigest: phase === "ASSESSMENT"
        ? ((seed + phaseIndex + 1) % 15 + 1).toString(16).repeat(64)
        : hex.repeat(64),
      supportingReceipts: phase === "SOURCE_WORKFLOW" ? [{
        receiptId: `workflow-receipt:${((seed + 8) % 15 + 1).toString(16).repeat(64)}`,
        receiptDigest: ((seed + 8) % 15 + 1).toString(16).repeat(64),
      }] : phase === "CURRENT_WEBSITE_EVIDENCE" ? [{
        receiptId: `website-evidence-eligibility:${((seed + 9) % 15 + 1).toString(16).repeat(64)}`,
        receiptDigest: ((seed + 9) % 15 + 1).toString(16).repeat(64),
      }] : phase === "ASSESSMENT" ? [{
        receiptId: `assessment-proof:${((seed + 10) % 15 + 1).toString(16).repeat(64)}`,
        receiptDigest: ((seed + 10) % 15 + 1).toString(16).repeat(64),
      }] : [],
    },
    previousPhaseReceipt: previous ? {
      phaseReceiptId: previous.phaseReceiptId,
      phaseReceiptDigest: previous.phaseReceiptDigest,
    } : null,
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt: `2026-08-0${4 + phaseIndex}T15:05:00.000Z`,
    authority: zeroAuthority,
  };
}

test("initial progress is deterministic, scoped to all ten businesses, and authorizes nothing", () => {
  const manifest = manifestFixture();
  const first = buildInitialPrivateKwShadowSliceProgress(manifest);
  const second = buildInitialPrivateKwShadowSliceProgress(manifest);

  assert.deepEqual(first, second);
  assert.equal(first.records.length, 10);
  assert(first.records.every((record) => record.phaseReceipts.length === 0));
  assert(first.records.every((record) => record.currentCheckpoint === "SOURCE_REVIEWED"));
  assert.equal(first.summary.completedPhaseReceipts, 0);
  assert.equal(first.summary.fullyCompletedBusinesses, 0);
  assert.equal(first.summary.countsByCheckpoint.SOURCE_REVIEWED, 10);
  assert.equal(first.summary.nextIncompleteBusinessId, first.records[0].businessId);
  assert.equal(first.authority.phaseExecutionAuthorized, false);
  assert.equal(first.authority.providerOperationsAuthorized, 0);
  assert.equal(first.authority.costAuthorizedUsd, 0);
});

test("one append advances only the exact business and binds its predecessor chain", () => {
  const manifest = manifestFixture();
  const initial = buildInitialPrivateKwShadowSliceProgress(manifest);
  const source = appendPrivateKwShadowSliceProgress(manifest, initial, receiptInput(manifest, 0));
  const sourceReceipt = source.records[0].phaseReceipts[0];
  const website = appendPrivateKwShadowSliceProgress(
    manifest,
    source,
    receiptInput(manifest, 0, "CURRENT_WEBSITE_EVIDENCE", sourceReceipt),
  );

  assert.equal(source.parentCheckpoint?.checkpointId, initial.checkpointId);
  assert.equal(website.parentCheckpoint?.checkpointId, source.checkpointId);
  assert.equal(website.records[0].phaseReceipts.length, 2);
  assert.equal(website.records[0].currentCheckpoint, "CURRENT_WEBSITE_EVIDENCE_PERSISTED");
  assert.equal(website.records[0].nextRequiredGate, "ASSESSMENT_APPROVAL");
  assert.equal(website.records[0].phaseReceipts[1].previousPhaseReceipt?.phaseReceiptId, sourceReceipt.phaseReceiptId);
  assert(website.records.slice(1).every((record) => record.currentCheckpoint === "SOURCE_REVIEWED"));
  assert.equal(website.summary.completedPhaseReceipts, 2);
  assert.equal(website.summary.countsByCheckpoint.CURRENT_WEBSITE_EVIDENCE_PERSISTED, 1);
  assert.equal(website.summary.countsByCheckpoint.SOURCE_REVIEWED, 9);
});

test("progress rejects skipped phases, wrong predecessors, cross-business proofs, and reused upstream receipts", () => {
  const manifest = manifestFixture();
  const initial = buildInitialPrivateKwShadowSliceProgress(manifest);
  const source = appendPrivateKwShadowSliceProgress(manifest, initial, receiptInput(manifest, 0));
  const sourceReceipt = source.records[0].phaseReceipts[0];

  assert.throws(
    () => appendPrivateKwShadowSliceProgress(manifest, initial, receiptInput(manifest, 0, "ASSESSMENT")),
    /Only the first phase can omit a predecessor|fixed order/,
  );
  assert.throws(
    () => appendPrivateKwShadowSliceProgress(manifest, source, receiptInput(manifest, 0, "CURRENT_WEBSITE_EVIDENCE", null)),
    /Only the first phase can omit a predecessor|predecessor/,
  );
  assert.throws(
    () => appendPrivateKwShadowSliceProgress(manifest, source, {
      ...receiptInput(manifest, 0, "CURRENT_WEBSITE_EVIDENCE", sourceReceipt),
      evaluationCandidateId: manifest.records[1].evaluationCandidateId,
    }),
    /one exact manifest business/,
  );

  const reused = receiptInput(manifest, 1);
  reused.proof = {
    ...reused.proof,
    primaryReceiptId: sourceReceipt.proof.primaryReceiptId,
    primaryReceiptDigest: sourceReceipt.proof.primaryReceiptDigest,
  };
  assert.throws(
    () => appendPrivateKwShadowSliceProgress(manifest, source, reused),
    /cannot be recorded twice/,
  );
});

test("phase proof type, receipt shape, manifest lineage, and time fail closed", () => {
  const manifest = manifestFixture();
  const initial = buildInitialPrivateKwShadowSliceProgress(manifest);

  assert.throws(() => appendPrivateKwShadowSliceProgress(manifest, initial, {
    ...receiptInput(manifest, 0),
    proof: { ...receiptInput(manifest, 0).proof, proofKind: "IMMUTABLE_ASSESSMENT" },
  }), /proof kind/);
  assert.throws(() => appendPrivateKwShadowSliceProgress(manifest, initial, {
    ...receiptInput(manifest, 0),
    proof: { ...receiptInput(manifest, 0).proof, supportingReceipts: [] },
  }), /Supporting receipts/);
  assert.throws(() => appendPrivateKwShadowSliceProgress(manifest, initial, {
    ...receiptInput(manifest, 0),
    proof: { ...receiptInput(manifest, 0).proof, primaryReceiptDigest: "f".repeat(64) },
  }), /identity must match its exact digest/);
  assert.throws(() => appendPrivateKwShadowSliceProgress(manifest, initial, {
    ...receiptInput(manifest, 0),
    manifestDigest: "0".repeat(64),
  }), /exact shadow-slice manifest/);
  assert.throws(() => appendPrivateKwShadowSliceProgress(manifest, initial, {
    ...receiptInput(manifest, 0),
    completedAt: "2026-08-03T14:00:00.000Z",
    recordedAt: "2026-08-03T14:05:00.000Z",
  }), /cannot complete before/);

  const source = appendPrivateKwShadowSliceProgress(manifest, initial, receiptInput(manifest, 0));
  const sourceReceipt = source.records[0].phaseReceipts[0];
  assert.throws(() => appendPrivateKwShadowSliceProgress(manifest, source, {
    ...receiptInput(manifest, 0, "CURRENT_WEBSITE_EVIDENCE", sourceReceipt),
    proof: {
      ...receiptInput(manifest, 0, "CURRENT_WEBSITE_EVIDENCE", sourceReceipt).proof,
      supportingReceipts: [],
    },
  }), /Supporting receipts/);

  const website = appendPrivateKwShadowSliceProgress(
    manifest,
    source,
    receiptInput(manifest, 0, "CURRENT_WEBSITE_EVIDENCE", sourceReceipt),
  );
  const websiteReceipt = website.records[0].phaseReceipts[1];
  assert.throws(() => appendPrivateKwShadowSliceProgress(manifest, website, {
    ...receiptInput(manifest, 0, "ASSESSMENT", websiteReceipt),
    proof: {
      ...receiptInput(manifest, 0, "ASSESSMENT", websiteReceipt).proof,
      supportingReceipts: [],
    },
  }), /Supporting receipts/);
  assert.throws(() => appendPrivateKwShadowSliceProgress(manifest, source, {
    ...receiptInput(manifest, 0, "CURRENT_WEBSITE_EVIDENCE", sourceReceipt),
    completedAt: "2026-08-04T14:00:00.000Z",
    recordedAt: "2026-08-05T15:05:00.000Z",
  }), /cannot predate/);
});

test("checkpoint and receipt tampering cannot become resumable progress", () => {
  const manifest = manifestFixture();
  const initial = buildInitialPrivateKwShadowSliceProgress(manifest);
  const source = appendPrivateKwShadowSliceProgress(manifest, initial, receiptInput(manifest, 0));

  assert.throws(() => PrivateKwShadowSliceProgressCheckpointSchema.parse({
    ...source,
    records: source.records.map((record, index) => index === 0
      ? { ...record, currentCheckpoint: "OWNER_DOSSIER_ACCEPTED" }
      : record),
  }), /identity must bind|state must derive/);

  const { checkpointId: _id, checkpointDigest: _digest, ...core } = source;
  void _id;
  void _digest;
  const forgedCore = {
    ...core,
    summary: { ...core.summary, fullyCompletedBusinesses: 10 },
  };
  const forgedDigest = privateKwShadowSliceProgressDigest(forgedCore);
  assert.throws(() => PrivateKwShadowSliceProgressCheckpointSchema.parse({
    ...forgedCore,
    checkpointId: `kw-shadow-progress:${forgedDigest}`,
    checkpointDigest: forgedDigest,
  }), /summary must derive/);
});
