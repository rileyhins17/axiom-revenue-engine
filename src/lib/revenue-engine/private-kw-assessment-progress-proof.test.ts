import assert from "node:assert/strict";
import test from "node:test";

import {
  PrivateKwAssessmentProgressProofSchema,
  buildPrivateKwAssessmentProgressProof,
} from "@/lib/revenue-engine/private-kw-assessment-progress-proof";
import {
  PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
  PrivateKwShadowSlicePhaseReceiptInputSchema,
  privateKwShadowSliceProgressAuthority,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import { createPrivateKwAssessmentProgressProofFixture } from "@/lib/revenue-engine/test-support/private-kw-assessment-progress-proof-fixture";

function buildProof(fixture: Awaited<ReturnType<typeof createPrivateKwAssessmentProgressProofFixture>>) {
  return buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentExecutionValue: fixture.assessmentExecution,
    preparedAt: fixture.proofPreparedAt,
  });
}

test("builds one deterministic assessment proof bound to current evidence and immutable persistence", async () => {
  const fixture = await createPrivateKwAssessmentProgressProofFixture();
  const first = buildProof(fixture);
  const second = buildProof(fixture);

  assert.deepEqual(first, second);
  assert.equal(first.proofId, `assessment-proof:${first.proofDigest}`);
  assert.equal(first.businessId, fixture.manifestRecord.businessId);
  assert.equal(first.previousPhaseReceipt.phaseReceiptId, fixture.currentWebsitePhaseReceipt.phaseReceiptId);
  assert.equal(first.currentWebsiteEvidence.proofId, fixture.evidenceProof.proofId);
  assert.equal(first.assessment.assessmentId, fixture.assessment.assessmentId);
  assert.equal(first.assessment.assessmentDigest, fixture.assessment.assessmentDigest);
  assert.equal(first.persistence.executionPath, "FRESH_COMMIT");
  assert.equal(first.persistence.committedAndReloaded, true);
  assert.equal(first.requiredProgressSupportingReceiptKind, "ASSESSMENT_PROOF");
  assert.equal(first.authority.syntheticContractProofOnly, true);
  assert.equal(first.authority.progressReceiptCreationAuthorized, false);
  assert.equal(first.authority.phaseAdvancementAuthorized, false);
  assert.equal(first.authority.databaseReadAuthorized, false);
  assert.equal(first.authority.databaseMutationAuthorized, false);
  assert.equal(first.authority.qualificationExecutionAuthorized, false);
  assert.equal(first.authority.contactDiscoveryAuthorized, false);
  assert.equal(first.authority.outreachAuthorized, false);
  assert.equal(first.authority.providerOperationsAuthorized, 0);
  assert.equal(first.authority.costAuthorizedUsd, 0);
});

test("rejects cross-business, predecessor, and website-workflow lineage drift", async () => {
  const fixture = await createPrivateKwAssessmentProgressProofFixture({ suffix: "lineage" });
  const other = await createPrivateKwAssessmentProgressProofFixture({ suffix: "other-lineage" });

  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: other.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentExecutionValue: fixture.assessmentExecution,
    preparedAt: fixture.proofPreparedAt,
  }), /exact completed current-website-evidence predecessor/);

  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: other.evidenceProof,
    assessmentExecutionValue: fixture.assessmentExecution,
    preparedAt: fixture.proofPreparedAt,
  }), /one exact reviewed manifest business/);

  const assessmentDrift = structuredClone(fixture.assessmentExecution);
  assessmentDrift.assessment.workflow.receiptDigest = "f".repeat(64);
  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentExecutionValue: assessmentDrift,
    preparedAt: fixture.proofPreparedAt,
  }), /exact current website workflow/);
});

test("rejects redigested assessment content, invalid persistence claims, and stale proof preparation", async () => {
  const fixture = await createPrivateKwAssessmentProgressProofFixture({ suffix: "tamper" });
  const redigested = structuredClone(fixture.assessmentExecution);
  redigested.assessment.qualification.totalScore += 1;
  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentExecutionValue: redigested,
    preparedAt: fixture.proofPreparedAt,
  }), /Assessment snapshots and digests|Assessment digest/);

  const invalidFreshCommit = structuredClone(fixture.assessmentExecution);
  invalidFreshCommit.insertedRows.assessmentReceipts = 0;
  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentExecutionValue: invalidFreshCommit,
    preparedAt: fixture.proofPreparedAt,
  }), /fresh assessment commit/);

  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentExecutionValue: fixture.assessmentExecution,
    preparedAt: fixture.evidenceProof.evidenceFreshThrough,
  }), /ordered and fresh/);
});

test("accepts an exact replay only when it truthfully reports zero inserted rows", async () => {
  const fixture = await createPrivateKwAssessmentProgressProofFixture({ suffix: "exact-replay" });
  const replay = structuredClone(fixture.assessmentExecution);
  replay.executionPath = "EXACT_REPLAY";
  replay.insertedRows = {
    websiteSnapshots: 0,
    evidenceClaims: 0,
    qualificationSnapshots: 0,
    assessmentReceipts: 0,
  };
  const proof = buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentExecutionValue: replay,
    preparedAt: fixture.proofPreparedAt,
  });
  assert.equal(proof.persistence.executionPath, "EXACT_REPLAY");
  assert.deepEqual(proof.persistence.insertedRows, replay.insertedRows);

  replay.insertedRows.websiteSnapshots = 1;
  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentExecutionValue: replay,
    preparedAt: fixture.proofPreparedAt,
  }), /exact assessment replay/);
});

test("proof is required by assessment progress but cannot create or advance that phase", async () => {
  const fixture = await createPrivateKwAssessmentProgressProofFixture({ suffix: "progress-gate" });
  const proof = buildProof(fixture);

  assert.throws(() => PrivateKwShadowSlicePhaseReceiptInputSchema.parse({
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: fixture.manifest.manifestId,
    manifestDigest: fixture.manifest.manifestDigest,
    businessId: proof.businessId,
    evaluationCandidateId: proof.evaluationCandidateId,
    phase: "ASSESSMENT",
    completedAt: proof.assessment.assessedAt,
    proof: {
      proofKind: "IMMUTABLE_ASSESSMENT",
      primaryReceiptId: proof.assessment.assessmentId,
      primaryReceiptDigest: proof.assessment.assessmentDigest,
      supportingReceipts: [],
    },
    previousPhaseReceipt: {
      phaseReceiptId: fixture.currentWebsitePhaseReceipt.phaseReceiptId,
      phaseReceiptDigest: fixture.currentWebsitePhaseReceipt.phaseReceiptDigest,
    },
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt: proof.preparedAt,
    authority: privateKwShadowSliceProgressAuthority(),
  }), /Supporting receipts/);

  assert.throws(() => PrivateKwAssessmentProgressProofSchema.parse({
    ...proof,
    authority: { ...proof.authority, phaseAdvancementAuthorized: true },
  }));
});
