import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_CONFIRMATION,
  buildPrivateKwOwnerDossierAcceptanceProof,
  requireInProcessPrivateKwOwnerDossierAcceptanceProof,
} from "@/lib/revenue-engine/private-kw-owner-dossier-progress-proof";
import {
  buildPrivateKwOwnerDossierProgressInput,
  requireInProcessPrivateKwOwnerDossierProgressInput,
  requireInProcessPrivateKwOwnerDossierProgressInputForParent,
} from "@/lib/revenue-engine/private-kw-owner-dossier-progress";
import {
  appendPrivateKwOwnerDossierProgress,
  requireInProcessPrivateKwOwnerDossierProgressCheckpoint,
} from "@/lib/revenue-engine/private-kw-owner-dossier-progress-append";
import {
  PrivateKwShadowSliceProgressCheckpointSchema,
  appendPrivateKwShadowSliceProgress,
  buildPrivateKwShadowSlicePhaseReceipt,
  privateKwShadowSliceProgressAuthority,
  privateKwShadowSliceProgressDigest,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import {
  createPrivateKwOwnerDossierProgressFixture,
} from "@/lib/revenue-engine/test-support/private-kw-owner-dossier-progress-fixture";

type Fixture = Awaited<ReturnType<typeof createPrivateKwOwnerDossierProgressFixture>>;

function buildProof(fixture: Fixture, acceptanceValue: unknown = fixture.acceptance) {
  return buildPrivateKwOwnerDossierAcceptanceProof({
    manifestValue: fixture.manifest,
    contactReviewProgressCheckpointValue: fixture.contactCheckpoint,
    ownerDossierValue: fixture.ownerDossier,
    acceptanceValue,
  });
}

function buildInput(fixture: Fixture, acceptanceValue: unknown = fixture.acceptance) {
  return buildPrivateKwOwnerDossierProgressInput({
    manifestValue: fixture.manifest,
    contactReviewProgressCheckpointValue: fixture.contactCheckpoint,
    ownerDossierValue: fixture.ownerDossier,
    acceptanceValue,
  });
}

function anotherBusinessSourceInput(input: {
  manifest: Fixture["manifest"];
  excludedBusinessId: string;
  recordedAt: string;
}) {
  const record = input.manifest.records.find(
    (candidate) => candidate.businessId !== input.excludedBusinessId,
  );
  assert(record);
  const primaryDigest = privateKwShadowSliceProgressDigest({
    businessId: record.businessId,
    kind: "owner-dossier-parent-materialization",
  });
  const supportingDigest = privateKwShadowSliceProgressDigest({
    businessId: record.businessId,
    kind: "owner-dossier-parent-workflow",
  });
  return {
    receiptVersion: "kw-shadow-slice-phase-receipt-v1" as const,
    manifestId: input.manifest.manifestId,
    manifestDigest: input.manifest.manifestDigest,
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    phase: "SOURCE_WORKFLOW" as const,
    completedAt: input.recordedAt,
    proof: {
      proofKind: "SOURCE_WORKFLOW_MATERIALIZATION" as const,
      primaryReceiptId: `kw-materialization:${primaryDigest}`,
      primaryReceiptDigest: primaryDigest,
      supportingReceipts: [{
        receiptId: `workflow-receipt:${supportingDigest}`,
        receiptDigest: supportingDigest,
      }],
    },
    previousPhaseReceipt: null,
    recordedBy: "CODEX_INTEGRATION_OWNER" as const,
    recordedAt: input.recordedAt,
    authority: privateKwShadowSliceProgressAuthority(),
  };
}

test("binds one explicit acceptance to the exact frozen dossier and contact checkpoint without appending", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture();
  const parentBefore = structuredClone(fixture.contactCheckpoint);
  const proof = buildProof(fixture);
  const input = buildInput(fixture);
  const target = fixture.contactCheckpoint.records.find(
    (record) => record.businessId === fixture.ownerDossier.lead.business.businessId,
  );
  const contactReceipt = target?.phaseReceipts.at(-1);

  assert(contactReceipt);
  assert.equal(proof.proofId, `owner-dossier-acceptance:${proof.proofDigest}`);
  assert.equal(proof.ownerDossier.dossierDigest, fixture.acceptance.dossierDigest);
  assert.equal(proof.ownerDossier.readModelVersion, fixture.ownerDossier.readModelVersion);
  assert.equal(proof.ownerDossier.generatedAt, fixture.ownerDossier.generatedAt);
  assert.equal(proof.ownerDossier.businessId, fixture.ownerDossier.lead.business.businessId);
  assert.equal(proof.parentCheckpoint.checkpointId, fixture.contactCheckpoint.checkpointId);
  assert.equal(proof.parentCheckpoint.checkpointDigest, fixture.contactCheckpoint.checkpointDigest);
  assert.equal(proof.parentCheckpoint.createdAt, fixture.contactCheckpoint.createdAt);
  assert.equal(proof.ownerDossier.websiteSnapshotId, fixture.ownerDossier.website.snapshotId);
  assert.equal(
    proof.ownerDossier.qualificationSnapshotId,
    fixture.ownerDossier.lead.qualification.snapshotId,
  );
  assert.equal(proof.previousPhaseReceipt.phaseReceiptId, contactReceipt.phaseReceiptId);
  assert.equal(proof.previousPhaseReceipt.phaseReceiptDigest, contactReceipt.phaseReceiptDigest);
  assert.equal(proof.previousPhaseReceipt.contactInvocationId, fixture.invocation.invocationId);
  assert.equal(proof.acceptance.acceptedBy, "RILEY");
  assert.equal(proof.authority.contractValidationOnly, true);
  assert.equal(proof.authority.ownerSessionAuthenticationProven, false);
  assert.equal(proof.authority.durableDecisionRecorded, false);
  assert.equal(proof.authority.phaseAdvancementAuthorized, false);
  assert.equal(proof.authority.databaseReadAuthorized, false);
  assert.equal(proof.authority.databaseMutationAuthorized, false);
  assert.equal(proof.authority.outreachAuthorized, false);
  assert.equal(proof.authority.sendAuthorized, false);
  assert.equal(proof.authority.providerOperationsAuthorized, 0);
  assert.equal(proof.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(proof), true);
  assert.equal(Object.isFrozen(proof.ownerDossier), true);
  assert.equal(requireInProcessPrivateKwOwnerDossierAcceptanceProof(proof), proof);

  assert.equal(input.phase, "OWNER_DOSSIER");
  assert.equal(input.businessId, fixture.ownerDossier.lead.business.businessId);
  assert.equal(input.completedAt, fixture.acceptance.acceptedAt);
  assert.equal(input.recordedAt, fixture.acceptance.acceptedAt);
  assert.equal(input.proof.proofKind, "READ_ONLY_OWNER_DOSSIER_ACCEPTANCE");
  assert.equal(input.proof.primaryReceiptId, proof.proofId);
  assert.equal(input.proof.primaryReceiptDigest, proof.proofDigest);
  assert.deepEqual(input.proof.supportingReceipts, []);
  assert.equal(input.previousPhaseReceipt?.phaseReceiptId, contactReceipt.phaseReceiptId);
  assert.equal(input.previousPhaseReceipt?.phaseReceiptDigest, contactReceipt.phaseReceiptDigest);
  assert.equal(input.authority.progressRecordingOnly, true);
  assert.equal(input.authority.phaseExecutionAuthorized, false);
  assert.equal(input.authority.databaseMutationAuthorized, false);
  assert.equal(input.authority.mailboxSyncAuthorized, false);
  assert.equal(input.authority.outreachAuthorized, false);
  assert.equal(input.authority.sendAuthorized, false);
  assert.equal(input.authority.providerOperationsAuthorized, 0);
  assert.equal(input.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(input), true);
  assert.equal(Object.isFrozen(input.proof), true);
  assert.equal(requireInProcessPrivateKwOwnerDossierProgressInput(input), input);
  assert.equal(requireInProcessPrivateKwOwnerDossierProgressInputForParent(
    input,
    structuredClone(fixture.manifest),
    structuredClone(fixture.contactCheckpoint),
  ), input);

  assert.deepEqual(fixture.contactCheckpoint, parentBefore);
  assert.equal(target?.phaseReceipts.length, 4);
  assert.equal(target?.currentCheckpoint, "CONTACT_REVIEW_PERSISTED");
  assert.equal(target?.nextRequiredGate, "OWNER_DOSSIER_ACCEPTANCE");
  assert.equal(
    fixture.contactCheckpoint.records.some(
      (record) => record.currentCheckpoint === "OWNER_DOSSIER_ACCEPTED",
    ),
    false,
  );
});

test("rejects copied dossier, proof, and input objects even when their schemas still match", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({ suffix: "owner-copy" });

  assert.throws(() => buildPrivateKwOwnerDossierAcceptanceProof({
    manifestValue: fixture.manifest,
    contactReviewProgressCheckpointValue: fixture.contactCheckpoint,
    ownerDossierValue: structuredClone(fixture.ownerDossier),
    acceptanceValue: fixture.acceptance,
  }), /exact in-process owner lead detail response/i);

  const proof = buildProof(fixture);
  assert.throws(
    () => requireInProcessPrivateKwOwnerDossierAcceptanceProof(structuredClone(proof)),
    /exact in-process owner-dossier acceptance proof/i,
  );

  const input = buildInput(fixture);
  assert.throws(
    () => requireInProcessPrivateKwOwnerDossierProgressInput(structuredClone(input)),
    /exact in-process owner-dossier progress input/i,
  );
});

test("rejects another manifest, a copied contact checkpoint, and a changed input parent", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({ suffix: "owner-parent" });
  const other = await createPrivateKwOwnerDossierProgressFixture({ suffix: "owner-other" });

  assert.throws(() => buildPrivateKwOwnerDossierAcceptanceProof({
    manifestValue: other.manifest,
    contactReviewProgressCheckpointValue: fixture.contactCheckpoint,
    ownerDossierValue: fixture.ownerDossier,
    acceptanceValue: fixture.acceptance,
  }), /exact manifest-bound contact-review checkpoint/i);
  assert.throws(() => buildPrivateKwOwnerDossierAcceptanceProof({
    manifestValue: fixture.manifest,
    contactReviewProgressCheckpointValue: structuredClone(fixture.contactCheckpoint),
    ownerDossierValue: fixture.ownerDossier,
    acceptanceValue: fixture.acceptance,
  }), /exact in-process result/i);

  const input = buildInput(fixture);
  const {
    checkpointId: _checkpointId,
    checkpointDigest: _checkpointDigest,
    ...parentCore
  } = structuredClone(fixture.contactCheckpoint);
  void _checkpointId;
  void _checkpointDigest;
  const changedCore = {
    ...parentCore,
    createdAt: new Date(Date.parse(parentCore.createdAt) + 1).toISOString(),
  };
  const changedDigest = privateKwShadowSliceProgressDigest(changedCore);
  const changedParent = PrivateKwShadowSliceProgressCheckpointSchema.parse({
    ...changedCore,
    checkpointId: `kw-shadow-progress:${changedDigest}`,
    checkpointDigest: changedDigest,
  });
  assert.throws(() => requireInProcessPrivateKwOwnerDossierProgressInputForParent(
    input,
    fixture.manifest,
    changedParent,
  ), /exact unchanged manifest and contact-review parent checkpoint/i);
});

test("rejects stale dossier quality and stale contact-review snapshot lineage", async () => {
  const staleData = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "owner-stale-data",
    dossierGeneratedAtOffsetMs: 61 * 24 * 60 * 60_000,
  });
  assert.throws(() => buildProof(staleData), /current owner dossier data quality/i);

  const staleReview = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "owner-stale-review",
    staleContactReview: true,
  });
  assert.throws(() => buildProof(staleReview), /current contact review and exact snapshot lineage/i);
});

test("rejects acceptance digest, confirmation, and five-minute chronology drift", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({ suffix: "owner-acceptance" });
  const beforeDossier = new Date(Date.parse(fixture.ownerDossier.generatedAt) - 1).toISOString();
  const afterWindow = new Date(Date.parse(fixture.ownerDossier.generatedAt) + 5 * 60_000 + 1).toISOString();

  assert.throws(() => buildProof(fixture, {
    ...fixture.acceptance,
    dossierDigest: "0".repeat(64),
  }), /exact owner dossier digest/i);
  assert.throws(() => buildProof(fixture, {
    ...fixture.acceptance,
    confirmation: `${PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_CONFIRMATION} changed`,
  }), /confirmation/i);
  assert.throws(() => buildProof(fixture, {
    ...fixture.acceptance,
    acceptedAt: beforeDossier,
  }), /cannot predate the dossier/i);
  assert.throws(() => buildProof(fixture, {
    ...fixture.acceptance,
    acceptedAt: afterWindow,
  }), /within five minutes/i);
});

test("guarded owner-dossier append completes exactly one business and preserves the cohort", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "owner-append",
  });
  const parentBefore = structuredClone(fixture.contactCheckpoint);
  const phaseInput = buildInput(fixture);
  const expectedReceipt = buildPrivateKwShadowSlicePhaseReceipt(
    fixture.manifest,
    phaseInput,
  );
  const expectedNextIncompleteBusinessId = fixture.contactCheckpoint.records.find(
    (record) => record.businessId !== phaseInput.businessId && record.phaseReceipts.length < 5,
  )?.businessId ?? null;
  const targetIndex = fixture.contactCheckpoint.records.findIndex(
    (record) => record.businessId === phaseInput.businessId,
  );
  const nextProgress = appendPrivateKwOwnerDossierProgress({
    manifestValue: structuredClone(fixture.manifest),
    previousProgressValue: structuredClone(fixture.contactCheckpoint),
    phaseInputValue: phaseInput,
  });
  const targetBefore = fixture.contactCheckpoint.records.find(
    (record) => record.businessId === phaseInput.businessId,
  );
  const targetAfter = nextProgress.records.find(
    (record) => record.businessId === phaseInput.businessId,
  );
  const otherBefore = fixture.contactCheckpoint.records.filter(
    (record) => record.businessId !== phaseInput.businessId,
  );
  const otherAfter = nextProgress.records.filter(
    (record) => record.businessId !== phaseInput.businessId,
  );

  assert(targetIndex > 0);
  assert.equal(
    fixture.contactCheckpoint.summary.nextIncompleteBusinessId,
    fixture.contactCheckpoint.records[0].businessId,
  );
  assert.equal(nextProgress.parentCheckpoint?.checkpointId, fixture.contactCheckpoint.checkpointId);
  assert.equal(
    nextProgress.parentCheckpoint?.checkpointDigest,
    fixture.contactCheckpoint.checkpointDigest,
  );
  assert.equal(nextProgress.createdAt, phaseInput.recordedAt);
  assert.equal(
    nextProgress.summary.completedPhaseReceipts,
    fixture.contactCheckpoint.summary.completedPhaseReceipts + 1,
  );
  assert.equal(
    nextProgress.summary.fullyCompletedBusinesses,
    fixture.contactCheckpoint.summary.fullyCompletedBusinesses + 1,
  );
  assert.equal(nextProgress.summary.nextIncompleteBusinessId, expectedNextIncompleteBusinessId);
  assert.equal(
    nextProgress.summary.nextIncompleteBusinessId,
    fixture.contactCheckpoint.summary.nextIncompleteBusinessId,
  );
  assert.equal(
    nextProgress.summary.countsByCheckpoint.CONTACT_REVIEW_PERSISTED,
    fixture.contactCheckpoint.summary.countsByCheckpoint.CONTACT_REVIEW_PERSISTED - 1,
  );
  assert.equal(
    nextProgress.summary.countsByCheckpoint.OWNER_DOSSIER_ACCEPTED,
    fixture.contactCheckpoint.summary.countsByCheckpoint.OWNER_DOSSIER_ACCEPTED + 1,
  );
  assert.equal(
    targetAfter?.phaseReceipts.length,
    (targetBefore?.phaseReceipts.length ?? 0) + 1,
  );
  assert.equal(targetAfter?.currentCheckpoint, "OWNER_DOSSIER_ACCEPTED");
  assert.equal(targetAfter?.nextRequiredGate, null);
  assert.equal(targetAfter?.businessId, targetBefore?.businessId);
  assert.equal(targetAfter?.evaluationCandidateId, targetBefore?.evaluationCandidateId);
  assert.equal(targetAfter?.sourceRecordId, targetBefore?.sourceRecordId);
  assert.deepEqual(targetAfter?.phaseReceipts.at(-1), expectedReceipt);
  assert.deepEqual(otherAfter, otherBefore);
  assert.deepEqual(fixture.contactCheckpoint, parentBefore);
  assert.equal(nextProgress.authority.progressRecordingOnly, true);
  assert.equal(nextProgress.authority.phaseExecutionAuthorized, false);
  assert.equal(nextProgress.authority.databaseMutationAuthorized, false);
  assert.equal(nextProgress.authority.contactDiscoveryExecutionAuthorized, false);
  assert.equal(nextProgress.authority.contactVerificationExecutionAuthorized, false);
  assert.equal(nextProgress.authority.consentDecisionAuthorized, false);
  assert.equal(nextProgress.authority.qualificationAuthorized, false);
  assert.equal(nextProgress.authority.mailboxSyncAuthorized, false);
  assert.equal(nextProgress.authority.outreachAuthorized, false);
  assert.equal(nextProgress.authority.sendAuthorized, false);
  assert.equal(nextProgress.authority.deploymentAuthorized, false);
  assert.equal(nextProgress.authority.providerOperationsAuthorized, 0);
  assert.equal(nextProgress.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(nextProgress), true);
  assert.equal(Object.isFrozen(targetAfter), true);
  assert.equal(
    requireInProcessPrivateKwOwnerDossierProgressCheckpoint(nextProgress),
    nextProgress,
  );
  assert.throws(
    () => requireInProcessPrivateKwOwnerDossierProgressCheckpoint(structuredClone(nextProgress)),
    /exact in-process result/i,
  );

  const exactRetry = appendPrivateKwOwnerDossierProgress({
    manifestValue: structuredClone(fixture.manifest),
    previousProgressValue: structuredClone(fixture.contactCheckpoint),
    phaseInputValue: phaseInput,
  });
  assert.equal(exactRetry, nextProgress);
});

test("guarded owner-dossier append rejects copied input, manifest drift, and every changed parent", async () => {
  const fixture = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "owner-append-guards",
  });
  const other = await createPrivateKwOwnerDossierProgressFixture({
    suffix: "owner-append-other-manifest",
  });
  const phaseInput = buildInput(fixture);

  assert.throws(() => appendPrivateKwOwnerDossierProgress({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.contactCheckpoint,
    phaseInputValue: structuredClone(phaseInput),
  }), /exact in-process owner-dossier progress input/i);

  assert.throws(() => appendPrivateKwOwnerDossierProgress({
    manifestValue: other.manifest,
    previousProgressValue: fixture.contactCheckpoint,
    phaseInputValue: phaseInput,
  }), /exact unchanged manifest and contact-review parent checkpoint/i);

  const changedParent = appendPrivateKwShadowSliceProgress(
    fixture.manifest,
    fixture.contactCheckpoint,
    anotherBusinessSourceInput({
      manifest: fixture.manifest,
      excludedBusinessId: phaseInput.businessId,
      recordedAt: fixture.acceptance.acceptedAt,
    }),
  );
  assert.throws(() => appendPrivateKwOwnerDossierProgress({
    manifestValue: fixture.manifest,
    previousProgressValue: changedParent,
    phaseInputValue: phaseInput,
  }), /exact unchanged manifest and contact-review parent checkpoint/i);

  const {
    checkpointId: _checkpointId,
    checkpointDigest: _checkpointDigest,
    ...parentCore
  } = structuredClone(fixture.contactCheckpoint);
  void _checkpointId;
  void _checkpointDigest;
  const changedCore = {
    ...parentCore,
    createdAt: new Date(Date.parse(parentCore.createdAt) + 1).toISOString(),
  };
  const changedDigest = privateKwShadowSliceProgressDigest(changedCore);
  const redigestedParent = PrivateKwShadowSliceProgressCheckpointSchema.parse({
    ...changedCore,
    checkpointId: `kw-shadow-progress:${changedDigest}`,
    checkpointDigest: changedDigest,
  });
  assert.throws(() => appendPrivateKwOwnerDossierProgress({
    manifestValue: fixture.manifest,
    previousProgressValue: redigestedParent,
    phaseInputValue: phaseInput,
  }), /exact unchanged manifest and contact-review parent checkpoint/i);

  const completedChild = appendPrivateKwOwnerDossierProgress({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.contactCheckpoint,
    phaseInputValue: phaseInput,
  });
  assert.throws(() => appendPrivateKwOwnerDossierProgress({
    manifestValue: fixture.manifest,
    previousProgressValue: completedChild,
    phaseInputValue: phaseInput,
  }), /exact unchanged manifest and contact-review parent checkpoint/i);
});
