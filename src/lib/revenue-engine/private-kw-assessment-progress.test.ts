import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrivateKwAssessmentProgressInput,
  requireInProcessPrivateKwAssessmentProgressInput,
  requireInProcessPrivateKwAssessmentProgressInputForParent,
} from "@/lib/revenue-engine/private-kw-assessment-progress";
import {
  appendPrivateKwAssessmentProgress,
  requireInProcessPrivateKwAssessmentProgressCheckpoint,
} from "@/lib/revenue-engine/private-kw-assessment-progress-append";
import {
  buildPrivateKwAssessmentProgressProof,
} from "@/lib/revenue-engine/private-kw-assessment-progress-proof";
import {
  PrivateKwShadowSlicePhaseReceiptInputSchema,
  PrivateKwShadowSliceProgressCheckpointSchema,
  appendPrivateKwShadowSliceProgress,
  buildInitialPrivateKwShadowSliceProgress,
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
  }), /exact completed current-website-evidence predecessor/i);

  const record = fixture.websiteProgress.records.find(
    (candidate) => candidate.businessId === phaseInput.businessId,
  );
  assert.equal(record?.currentCheckpoint, "CURRENT_WEBSITE_EVIDENCE_PERSISTED");
  assert.equal(record?.nextRequiredGate, "ASSESSMENT_APPROVAL");
  assert.equal(record?.phaseReceipts.length, 2);
});

test("guarded assessment append advances exactly once and replays the same in-memory checkpoint", async () => {
  const fixture = await createAssessmentProgressFixture({ suffix: "append" });
  const phaseInput = buildInput(fixture);
  const parentBefore = structuredClone(fixture.websiteProgress);

  const first = appendPrivateKwAssessmentProgress({
    manifestValue: fixture.manifest,
    previousProgressValue: structuredClone(fixture.websiteProgress),
    phaseInputValue: phaseInput,
  });
  const replayed = appendPrivateKwAssessmentProgress({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.websiteProgress,
    phaseInputValue: phaseInput,
  });

  assert.equal(replayed, first);
  assert.equal(first.parentCheckpoint?.checkpointId, fixture.websiteProgress.checkpointId);
  assert.equal(first.parentCheckpoint?.checkpointDigest, fixture.websiteProgress.checkpointDigest);
  assert.equal(
    first.summary.completedPhaseReceipts,
    fixture.websiteProgress.summary.completedPhaseReceipts + 1,
  );
  const advanced = first.records.find((record) => record.businessId === phaseInput.businessId);
  const previous = fixture.websiteProgress.records.find(
    (record) => record.businessId === phaseInput.businessId,
  );
  assert.ok(advanced);
  assert.ok(previous);
  assert.equal(advanced.phaseReceipts.length, previous.phaseReceipts.length + 1);
  assert.equal(advanced.currentCheckpoint, "ASSESSMENT_PERSISTED");
  assert.equal(advanced.nextRequiredGate, "CONTACT_REVIEW_APPROVAL");
  assert.equal(advanced.phaseReceipts.at(-1)?.proof.primaryReceiptId, fixture.assessment.assessmentId);
  assert.deepEqual(
    first.records.filter((record) => record.businessId !== phaseInput.businessId),
    fixture.websiteProgress.records.filter((record) => record.businessId !== phaseInput.businessId),
  );
  assert.equal(first.authority.phaseExecutionAuthorized, false);
  assert.equal(first.authority.databaseMutationAuthorized, false);
  assert.equal(first.authority.providerOperationsAuthorized, 0);
  assert.equal(first.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(advanced.phaseReceipts), true);
  assert.equal(
    requireInProcessPrivateKwAssessmentProgressCheckpoint(first),
    first,
  );
  assert.throws(
    () => requireInProcessPrivateKwAssessmentProgressCheckpoint(structuredClone(first)),
    /exact in-process result/i,
  );
  assert.deepEqual(fixture.websiteProgress, parentBefore);
  assert.equal(previous.phaseReceipts.length, 2);
});

test("guarded assessment append rejects copied input, alternate manifest, and changed parent", async () => {
  const fixture = await createAssessmentProgressFixture({ suffix: "append-guards" });
  const other = await createAssessmentProgressFixture({ suffix: "append-other" });
  const phaseInput = buildInput(fixture);

  assert.throws(
    () => appendPrivateKwAssessmentProgress({
      manifestValue: fixture.manifest,
      previousProgressValue: fixture.websiteProgress,
      phaseInputValue: structuredClone(phaseInput),
    }),
    /exact in-process result/i,
  );
  assert.throws(
    () => appendPrivateKwAssessmentProgress({
      manifestValue: other.manifest,
      previousProgressValue: fixture.websiteProgress,
      phaseInputValue: phaseInput,
    }),
    /exact unchanged manifest and parent checkpoint/i,
  );

  const {
    checkpointId: _checkpointId,
    checkpointDigest: _checkpointDigest,
    ...parentCore
  } = fixture.websiteProgress;
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
    () => appendPrivateKwAssessmentProgress({
      manifestValue: fixture.manifest,
      previousProgressValue: changedParent,
      phaseInputValue: phaseInput,
    }),
    /exact unchanged manifest and parent checkpoint/i,
  );

  const completed = appendPrivateKwAssessmentProgress({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.websiteProgress,
    phaseInputValue: phaseInput,
  });
  assert.throws(
    () => appendPrivateKwAssessmentProgress({
      manifestValue: fixture.manifest,
      previousProgressValue: completed,
      phaseInputValue: phaseInput,
    }),
    /exact unchanged manifest and parent checkpoint/i,
  );
});
