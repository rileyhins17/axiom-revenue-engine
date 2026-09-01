import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrivateKwContactReviewProgressInput,
  requireInProcessPrivateKwContactReviewProgressInput,
  requireInProcessPrivateKwContactReviewProgressInputForParent,
} from "@/lib/revenue-engine/private-kw-contact-review-progress";
import {
  buildPrivateKwContactReviewProgressProof,
} from "@/lib/revenue-engine/private-kw-contact-review-progress-proof";
import {
  PrivateKwShadowSliceProgressCheckpointSchema,
  appendPrivateKwShadowSliceProgress,
  privateKwShadowSliceProgressAuthority,
  privateKwShadowSliceProgressDigest,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import {
  createPrivateKwContactReviewProgressProofFixture,
} from "@/lib/revenue-engine/test-support/private-kw-contact-review-progress-proof-fixture";

function buildInput(
  fixture: Awaited<ReturnType<typeof createPrivateKwContactReviewProgressProofFixture>>,
) {
  return buildPrivateKwContactReviewProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: fixture.contactDurableReload,
  });
}

function anotherBusinessSourceInput(input: {
  manifest: Awaited<ReturnType<typeof createPrivateKwContactReviewProgressProofFixture>>["manifest"];
  excludedBusinessId: string;
  recordedAt: string;
}) {
  const record = input.manifest.records.find(
    (candidate) => candidate.businessId !== input.excludedBusinessId,
  );
  assert.ok(record);
  const primaryDigest = privateKwShadowSliceProgressDigest({
    businessId: record.businessId,
    kind: "contact-input-parent-materialization",
  });
  const supportingDigest = privateKwShadowSliceProgressDigest({
    businessId: record.businessId,
    kind: "contact-input-parent-workflow",
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

test("derives one frozen parent-bound contact-review input from exact durable provenance", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture();
  const parentBefore = structuredClone(fixture.assessmentCheckpoint);
  const phaseInput = buildInput(fixture);
  const proof = buildPrivateKwContactReviewProgressProof({
    manifestValue: fixture.manifest,
    assessmentProgressCheckpointValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: fixture.contactDurableReload,
  });

  assert.equal(phaseInput.phase, "CONTACT_REVIEW");
  assert.equal(phaseInput.businessId, fixture.invocation.businessId);
  assert.equal(phaseInput.completedAt, fixture.contactDurableReload.invocationReceiptRecordedAt);
  assert.equal(phaseInput.recordedAt, fixture.contactDurableReload.databaseNow);
  assert.equal(phaseInput.proof.proofKind, "OWNER_REVIEWED_CONTACT_INVOCATION");
  assert.equal(phaseInput.proof.primaryReceiptId, fixture.invocation.invocationId);
  assert.equal(phaseInput.proof.primaryReceiptDigest, fixture.invocation.invocationDigest);
  assert.deepEqual(phaseInput.proof.supportingReceipts, [{
    receiptId: proof.proofId,
    receiptDigest: proof.proofDigest,
  }]);
  assert.equal(
    phaseInput.previousPhaseReceipt?.phaseReceiptId,
    fixture.assessmentCheckpoint.records
      .find((record) => record.businessId === phaseInput.businessId)
      ?.phaseReceipts.at(-1)?.phaseReceiptId,
  );
  assert.equal(phaseInput.authority.progressRecordingOnly, true);
  assert.equal(phaseInput.authority.phaseExecutionAuthorized, false);
  assert.equal(phaseInput.authority.databaseMutationAuthorized, false);
  assert.equal(phaseInput.authority.contactDiscoveryExecutionAuthorized, false);
  assert.equal(phaseInput.authority.contactVerificationExecutionAuthorized, false);
  assert.equal(phaseInput.authority.consentDecisionAuthorized, false);
  assert.equal(phaseInput.authority.qualificationAuthorized, false);
  assert.equal(phaseInput.authority.mailboxSyncAuthorized, false);
  assert.equal(phaseInput.authority.outreachAuthorized, false);
  assert.equal(phaseInput.authority.sendAuthorized, false);
  assert.equal(phaseInput.authority.providerOperationsAuthorized, 0);
  assert.equal(phaseInput.authority.costAuthorizedUsd, 0);
  assert.equal(Object.isFrozen(phaseInput), true);
  assert.equal(Object.isFrozen(phaseInput.proof), true);
  assert.equal(requireInProcessPrivateKwContactReviewProgressInput(phaseInput), phaseInput);
  assert.equal(requireInProcessPrivateKwContactReviewProgressInputForParent(
    phaseInput,
    structuredClone(fixture.manifest),
    structuredClone(fixture.assessmentCheckpoint),
  ), phaseInput);
  assert.throws(
    () => requireInProcessPrivateKwContactReviewProgressInput(structuredClone(phaseInput)),
    /exact in-process result/i,
  );
  assert.deepEqual(fixture.assessmentCheckpoint, parentBefore);
  assert.equal(
    fixture.assessmentCheckpoint.records
      .find((record) => record.businessId === phaseInput.businessId)
      ?.phaseReceipts.length,
    3,
  );
});

test("rejects copied or stale durable contact trust before producing an input", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "contact-input-trust",
  });
  assert.throws(() => buildPrivateKwContactReviewProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: structuredClone(fixture.contactDurableReload),
  }), /exact in-process result/i);

  const stale = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "contact-input-stale",
    contactDatabaseNowOffsetMs: 30 * 24 * 60 * 60_000,
  });
  assert.throws(() => buildInput(stale), /not current at the database clock/i);
});

test("rejects copied assessment parents and cross-manifest contact lineage", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "contact-input-lineage",
  });
  const other = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "contact-input-other",
  });

  assert.throws(() => buildPrivateKwContactReviewProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: structuredClone(fixture.assessmentCheckpoint),
    currentContactInvocationResultValue: fixture.contactDurableReload,
  }), /exact in-process result/i);
  assert.throws(() => buildPrivateKwContactReviewProgressInput({
    manifestValue: other.manifest,
    previousProgressValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: fixture.contactDurableReload,
  }), /exact manifest-bound ten-business assessment checkpoint/i);
  assert.throws(() => buildPrivateKwContactReviewProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: fixture.assessmentCheckpoint,
    currentContactInvocationResultValue: other.contactDurableReload,
  }), /exact reviewed manifest business|exact manifest-bound assessment checkpoint/i);
});

test("binds trusted contact input to one unchanged assessment parent without appending", async () => {
  const fixture = await createPrivateKwContactReviewProgressProofFixture({
    suffix: "contact-input-parent",
  });
  const phaseInput = buildInput(fixture);
  const changedParent = appendPrivateKwShadowSliceProgress(
    fixture.manifest,
    fixture.assessmentCheckpoint,
    anotherBusinessSourceInput({
      manifest: fixture.manifest,
      excludedBusinessId: phaseInput.businessId,
      recordedAt: fixture.contactDurableReload.databaseNow,
    }),
  );

  assert.throws(() => requireInProcessPrivateKwContactReviewProgressInputForParent(
    phaseInput,
    fixture.manifest,
    changedParent,
  ), /exact unchanged manifest and assessment parent checkpoint/i);
  assert.throws(() => buildPrivateKwContactReviewProgressInput({
    manifestValue: fixture.manifest,
    previousProgressValue: changedParent,
    currentContactInvocationResultValue: fixture.contactDurableReload,
  }), /exact in-process result/i);

  const {
    checkpointId: _checkpointId,
    checkpointDigest: _checkpointDigest,
    ...parentCore
  } = fixture.assessmentCheckpoint;
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
  assert.throws(() => requireInProcessPrivateKwContactReviewProgressInputForParent(
    phaseInput,
    fixture.manifest,
    redigestedParent,
  ), /exact unchanged manifest and assessment parent checkpoint/i);

  const record = fixture.assessmentCheckpoint.records.find(
    (candidate) => candidate.businessId === phaseInput.businessId,
  );
  assert.equal(record?.currentCheckpoint, "ASSESSMENT_PERSISTED");
  assert.equal(record?.nextRequiredGate, "CONTACT_REVIEW_APPROVAL");
  assert.equal(record?.phaseReceipts.length, 3);
});
