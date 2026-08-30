import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrivateKwAssessmentProgressInput,
  requireInProcessPrivateKwAssessmentProgressInput,
  requireInProcessPrivateKwAssessmentProgressInputForParent,
} from "@/lib/revenue-engine/private-kw-assessment-progress";
import {
  buildPrivateKwAssessmentProgressProof,
} from "@/lib/revenue-engine/private-kw-assessment-progress-proof";
import type { PrivateKwShadowSliceManifest } from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PrivateKwShadowSlicePhaseReceiptInputSchema,
  PrivateKwShadowSliceProgressCheckpointSchema,
  appendPrivateKwShadowSliceProgress,
  buildInitialPrivateKwShadowSliceProgress,
  privateKwShadowSliceProgressAuthority,
  privateKwShadowSliceProgressDigest,
  type PrivateKwShadowSlicePhaseReceipt,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import { createPrivateKwAssessmentProgressProofFixture } from "@/lib/revenue-engine/test-support/private-kw-assessment-progress-proof-fixture";

function inputFromReceipt(receipt: PrivateKwShadowSlicePhaseReceipt) {
  const {
    phaseReceiptId: _phaseReceiptId,
    phaseReceiptDigest: _phaseReceiptDigest,
    phaseOrder: _phaseOrder,
    completedCheckpoint: _completedCheckpoint,
    nextRequiredGate: _nextRequiredGate,
    ...input
  } = receipt;
  void _phaseReceiptId;
  void _phaseReceiptDigest;
  void _phaseOrder;
  void _completedCheckpoint;
  void _nextRequiredGate;
  return PrivateKwShadowSlicePhaseReceiptInputSchema.parse(input);
}

async function createAssessmentProgressFixture(options: {
  suffix?: string;
  databaseNowOffsetMs?: number;
} = {}) {
  const fixture = await createPrivateKwAssessmentProgressProofFixture(options);
  const initialProgress = buildInitialPrivateKwShadowSliceProgress(fixture.manifest);
  const sourceProgress = appendPrivateKwShadowSliceProgress(
    fixture.manifest,
    initialProgress,
    inputFromReceipt(fixture.previousPhaseReceipt),
  );
  const websiteProgress = appendPrivateKwShadowSliceProgress(
    fixture.manifest,
    sourceProgress,
    inputFromReceipt(fixture.currentWebsitePhaseReceipt),
  );
  return { ...fixture, initialProgress, sourceProgress, websiteProgress };
}

function buildInput(fixture: Awaited<ReturnType<typeof createAssessmentProgressFixture>>) {
  return buildPrivateKwAssessmentProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.websiteProgress,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    currentAssessmentResultValue: fixture.assessmentDurableReload,
  });
}

function otherBusinessSourceInput(input: {
  manifest: PrivateKwShadowSliceManifest;
  excludedBusinessId: string;
  recordedAt: string;
}) {
  const record = input.manifest.records.find(
    (candidate) => candidate.businessId !== input.excludedBusinessId,
  );
  assert.ok(record);
  const primaryDigest = privateKwShadowSliceProgressDigest({
    businessId: record.businessId,
    kind: "other-business-materialization",
  });
  const supportingDigest = privateKwShadowSliceProgressDigest({
    businessId: record.businessId,
    kind: "other-business-workflow",
  });
  return PrivateKwShadowSlicePhaseReceiptInputSchema.parse({
    receiptVersion: "kw-shadow-slice-phase-receipt-v1",
    manifestId: input.manifest.manifestId,
    manifestDigest: input.manifest.manifestDigest,
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    phase: "SOURCE_WORKFLOW",
    completedAt: input.recordedAt,
    proof: {
      proofKind: "SOURCE_WORKFLOW_MATERIALIZATION",
      primaryReceiptId: `kw-materialization:${primaryDigest}`,
      primaryReceiptDigest: primaryDigest,
      supportingReceipts: [{
        receiptId: `workflow-receipt:${supportingDigest}`,
        receiptDigest: supportingDigest,
      }],
    },
    previousPhaseReceipt: null,
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt: input.recordedAt,
    authority: privateKwShadowSliceProgressAuthority(),
  });
}

test("derives one frozen parent-bound assessment input from exact current durable provenance", async () => {
  const fixture = await createAssessmentProgressFixture();
  const parentBefore = structuredClone(fixture.websiteProgress);
  const phaseInput = buildInput(fixture);
  const proof = buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentDurableReloadValue: fixture.assessmentDurableReload,
  });

  assert.equal(phaseInput.phase, "ASSESSMENT");
  assert.equal(phaseInput.businessId, fixture.manifestRecord.businessId);
  assert.equal(phaseInput.completedAt, fixture.assessmentDurableReload.assessmentReceiptRecordedAt);
  assert.equal(phaseInput.recordedAt, fixture.assessmentDurableReload.databaseNow);
  assert.equal(phaseInput.proof.proofKind, "IMMUTABLE_ASSESSMENT");
  assert.equal(phaseInput.proof.primaryReceiptId, fixture.assessment.assessmentId);
  assert.equal(phaseInput.proof.primaryReceiptDigest, fixture.assessment.assessmentDigest);
  assert.deepEqual(phaseInput.proof.supportingReceipts, [{
    receiptId: proof.proofId,
    receiptDigest: proof.proofDigest,
  }]);
  assert.equal(
    phaseInput.previousPhaseReceipt?.phaseReceiptId,
    fixture.currentWebsitePhaseReceipt.phaseReceiptId,
  );
  assert.equal(phaseInput.authority.progressRecordingOnly, true);
  assert.equal(phaseInput.authority.phaseExecutionAuthorized, false);
  assert.equal(phaseInput.authority.databaseMutationAuthorized, false);
  assert.equal(phaseInput.authority.qualificationAuthorized, false);
  assert.equal(phaseInput.authority.contactDiscoveryExecutionAuthorized, false);
  assert.equal(phaseInput.authority.outreachAuthorized, false);
  assert.equal(phaseInput.authority.providerOperationsAuthorized, 0);
  assert.equal(phaseInput.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(phaseInput), true);
  assert.equal(Object.isFrozen(phaseInput.proof), true);
  assert.equal(requireInProcessPrivateKwAssessmentProgressInput(phaseInput), phaseInput);
  assert.equal(
    requireInProcessPrivateKwAssessmentProgressInputForParent(
      phaseInput,
      structuredClone(fixture.manifest),
      structuredClone(fixture.websiteProgress),
    ),
    phaseInput,
  );
  assert.throws(
    () => requireInProcessPrivateKwAssessmentProgressInput(structuredClone(phaseInput)),
    /exact in-process result/i,
  );
  assert.deepEqual(fixture.websiteProgress, parentBefore);
  assert.equal(
    fixture.websiteProgress.records.find((record) => record.businessId === phaseInput.businessId)
      ?.phaseReceipts.length,
    2,
  );
});

test("rejects copied or stale assessment trust before producing a phase input", async () => {
  const fixture = await createAssessmentProgressFixture({ suffix: "trust" });
  assert.throws(() => buildPrivateKwAssessmentProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.websiteProgress,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    currentAssessmentResultValue: structuredClone(fixture.assessmentDurableReload),
  }), /exact in-process result/i);

  const stale = await createAssessmentProgressFixture({
    suffix: "stale",
    databaseNowOffsetMs: 61 * 24 * 60 * 60 * 1_000,
  });
  assert.throws(() => buildInput(stale), /not current at the database clock/i);
});

test("rejects another business, missing predecessor progress, and website-proof drift", async () => {
  const fixture = await createAssessmentProgressFixture({ suffix: "lineage" });
  const other = await createAssessmentProgressFixture({ suffix: "other-lineage" });

  assert.throws(() => buildPrivateKwAssessmentProgressInput({
    manifestValue: other.manifest,
    previousProgressValue: fixture.websiteProgress,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    currentAssessmentResultValue: fixture.assessmentDurableReload,
  }), /exact manifest-bound ten-business checkpoint/i);

  assert.throws(() => buildPrivateKwAssessmentProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.sourceProgress,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    currentAssessmentResultValue: fixture.assessmentDurableReload,
  }), /exact completed current-website-evidence predecessor/i);

  assert.throws(() => buildPrivateKwAssessmentProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.websiteProgress,
    currentWebsiteEvidenceProofValue: other.evidenceProof,
    currentAssessmentResultValue: fixture.assessmentDurableReload,
  }), /exact independent reviewed manifest business/i);
});

test("binds the trusted input to one exact content-addressed parent without appending it", async () => {
  const fixture = await createAssessmentProgressFixture({ suffix: "parent" });
  const phaseInput = buildInput(fixture);
  const {
    checkpointId: _checkpointId,
    checkpointDigest: _checkpointDigest,
    ...parentCore
  } = fixture.websiteProgress;
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

  assert.throws(
    () => requireInProcessPrivateKwAssessmentProgressInputForParent(
      phaseInput,
      fixture.manifest,
      changedParent,
    ),
    /exact unchanged manifest and parent checkpoint/i,
  );
  assert.throws(() => buildPrivateKwAssessmentProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: changedParent,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    currentAssessmentResultValue: fixture.assessmentDurableReload,
  }), /exact manifest-bound ten-business checkpoint/i);

  const record = fixture.websiteProgress.records.find(
    (candidate) => candidate.businessId === phaseInput.businessId,
  );
  assert.equal(record?.currentCheckpoint, "CURRENT_WEBSITE_EVIDENCE_PERSISTED");
  assert.equal(record?.nextRequiredGate, "ASSESSMENT_APPROVAL");
  assert.equal(record?.phaseReceipts.length, 2);
});

test("accepts a canonical parent advanced by another business and rejects a parent newer than the durable reload", async () => {
  const fixture = await createAssessmentProgressFixture({ suffix: "cohort-parent" });
  const originalInput = buildInput(fixture);
  const anotherBusinessRecordedAt = new Date(
    Date.parse(fixture.websiteProgress.createdAt) + 30_000,
  ).toISOString();
  const advancedParent = appendPrivateKwShadowSliceProgress(
    fixture.manifest,
    fixture.websiteProgress,
    otherBusinessSourceInput({
      manifest: fixture.manifest,
      excludedBusinessId: fixture.assessment.business.id,
      recordedAt: anotherBusinessRecordedAt,
    }),
  );
  const advancedInput = buildPrivateKwAssessmentProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: advancedParent,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    currentAssessmentResultValue: fixture.assessmentDurableReload,
  });

  assert.equal(advancedInput.businessId, fixture.assessment.business.id);
  assert.equal(
    requireInProcessPrivateKwAssessmentProgressInputForParent(
      advancedInput,
      fixture.manifest,
      structuredClone(advancedParent),
    ),
    advancedInput,
  );
  assert.throws(() => requireInProcessPrivateKwAssessmentProgressInputForParent(
    originalInput,
    fixture.manifest,
    advancedParent,
  ), /exact unchanged manifest and parent checkpoint/i);

  const futureParent = appendPrivateKwShadowSliceProgress(
    fixture.manifest,
    fixture.websiteProgress,
    otherBusinessSourceInput({
      manifest: fixture.manifest,
      excludedBusinessId: fixture.assessment.business.id,
      recordedAt: new Date(
        Date.parse(fixture.assessmentDurableReload.databaseNow) + 1,
      ).toISOString(),
    }),
  );
  assert.throws(() => buildPrivateKwAssessmentProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: futureParent,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    currentAssessmentResultValue: fixture.assessmentDurableReload,
  }), /chronology must remain inside/i);
});
