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
    assessmentDurableReloadValue: fixture.assessmentDurableReload,
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
  assert.equal(first.persistence.executionPath, "DURABLE_RELOAD");
  assert.equal(first.persistence.freshnessState, "CURRENT");
  assert.equal(first.persistence.databaseNow, fixture.assessmentDurableReload.databaseNow);
  assert.equal(first.persistence.exactSourceRebuilt, true);
  assert.equal(first.persistence.immutableWriterGuardsVerified, true);
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
    assessmentDurableReloadValue: fixture.assessmentDurableReload,
  }), /exact completed current-website-evidence predecessor/);

  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: other.evidenceProof,
    assessmentDurableReloadValue: fixture.assessmentDurableReload,
  }), /one exact reviewed manifest business/);

  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentDurableReloadValue: other.assessmentDurableReload,
  }), /exact current website workflow|one exact reviewed manifest business/);
});

test("rejects copied durable reloads and database-clock expiration", async () => {
  const fixture = await createPrivateKwAssessmentProgressProofFixture({ suffix: "tamper" });
  const copied = structuredClone(fixture.assessmentDurableReload);
  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: fixture.evidenceProof,
    assessmentDurableReloadValue: copied,
  }), /exact in-process result/);

  const stale = await createPrivateKwAssessmentProgressProofFixture({
    suffix: "stale",
    databaseNowOffsetMs: 61 * 24 * 60 * 60 * 1_000,
  });
  assert.throws(() => buildPrivateKwAssessmentProgressProof({
    manifestValue: stale.manifest,
    previousPhaseReceiptValue: stale.currentWebsitePhaseReceipt,
    currentWebsiteEvidenceProofValue: stale.evidenceProof,
    assessmentDurableReloadValue: stale.assessmentDurableReload,
  }), /not current at the database clock/);
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
