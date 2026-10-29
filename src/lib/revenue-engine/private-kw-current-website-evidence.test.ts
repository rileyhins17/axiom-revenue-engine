import assert from "node:assert/strict";
import test from "node:test";

import {
  createArtifactManifestAvailabilityReceipt,
} from "@/lib/revenue-engine/artifact-manifest-availability";
import {
  PrivateKwCurrentWebsiteEvidenceProofSchema,
  buildPrivateKwCurrentWebsiteEvidenceProof,
} from "@/lib/revenue-engine/private-kw-current-website-evidence";
import {
  PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
  PrivateKwShadowSlicePhaseReceiptInputSchema,
  privateKwShadowSliceProgressAuthority,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import { createPrivateKwCurrentWebsiteEvidenceFixture } from "@/lib/revenue-engine/test-support/private-kw-current-website-evidence-fixture";

function buildProof(fixture: Awaited<ReturnType<typeof createPrivateKwCurrentWebsiteEvidenceFixture>>) {
  return buildPrivateKwCurrentWebsiteEvidenceProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.previousPhaseReceipt,
    durableEvidenceRequestValue: fixture.durableEvidenceRequest,
    availabilityReceiptValues: fixture.availabilityReceipts,
    preparedAt: fixture.preparedAt,
  });
}

test("builds one deterministic content-addressed desktop and mobile evidence proof with zero authority", async () => {
  const fixture = await createPrivateKwCurrentWebsiteEvidenceFixture();
  const first = buildProof(fixture);
  const second = buildProof(fixture);

  assert.deepEqual(first, second);
  assert.equal(first.proofId, `website-evidence:${first.proofDigest}`);
  assert.equal(first.businessId, fixture.manifestRecord.businessId);
  assert.equal(first.previousPhaseReceipt.phaseReceiptId, fixture.previousPhaseReceipt.phaseReceiptId);
  assert.deepEqual(first.homeEvidence.capturedProfiles, ["DESKTOP_1440X900", "MOBILE_390X844"]);
  assert.equal(first.homeEvidence.artifactManifestIds.length, 2);
  assert.equal(first.artifactEvidence.length, fixture.workflowReceipt.artifactManifests.length);
  assert(first.artifactEvidence.every((artifact) => artifact.checkerKind === "FIXTURE"));
  assert.equal(first.requiredEligibilityReceiptKind, "CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY");
  assert.equal(first.authority.syntheticContractProofOnly, true);
  assert.equal(first.authority.progressReceiptCreationAuthorized, false);
  assert.equal(first.authority.phaseAdvancementAuthorized, false);
  assert.equal(first.authority.browserCaptureAuthorized, false);
  assert.equal(first.authority.r2ReadAuthorized, false);
  assert.equal(first.authority.providerOperationsAuthorized, 0);
  assert.equal(first.authority.costAuthorizedUsd, 0);
});

test("rejects identity drift, incomplete artifact coverage, and non-fixture availability", async () => {
  const fixture = await createPrivateKwCurrentWebsiteEvidenceFixture({ suffix: "drift" });
  const wrongManifestFixture = await createPrivateKwCurrentWebsiteEvidenceFixture({ suffix: "other-manifest" });

  assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceProof({
    manifestValue: wrongManifestFixture.manifest,
    previousPhaseReceiptValue: fixture.previousPhaseReceipt,
    durableEvidenceRequestValue: fixture.durableEvidenceRequest,
    availabilityReceiptValues: fixture.availabilityReceipts,
    preparedAt: fixture.preparedAt,
  }), /exact completed source\/workflow predecessor/);

  assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.previousPhaseReceipt,
    durableEvidenceRequestValue: fixture.durableEvidenceRequest,
    availabilityReceiptValues: fixture.availabilityReceipts.slice(1),
    preparedAt: fixture.preparedAt,
  }), /exact complete artifact manifest set/);

  const firstManifest = fixture.workflowReceipt.artifactManifests[0];
  const r2ShapedReceipt = createArtifactManifestAvailabilityReceipt({
    receiptId: "99999999-9999-4999-8999-999999999999",
    manifest: firstManifest,
    checkedAt: firstManifest.verifiedAt,
    validThrough: fixture.availabilityReceipts[0].validThrough,
    expiresAt: fixture.availabilityReceipts[0].expiresAt,
    checkerKind: "R2_HEAD",
    objects: fixture.availabilityReceipts[0].objects,
  });
  assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.previousPhaseReceipt,
    durableEvidenceRequestValue: fixture.durableEvidenceRequest,
    availabilityReceiptValues: [r2ShapedReceipt, ...fixture.availabilityReceipts.slice(1)],
    preparedAt: fixture.preparedAt,
  }), /verified fixture availability receipt/);
});

test("rejects stale evidence and captured workflows without exact mobile homepage proof", async () => {
  const fixture = await createPrivateKwCurrentWebsiteEvidenceFixture({ suffix: "freshness" });
  const staleAt = new Date(Date.parse(fixture.preparedAt) + 31 * 24 * 60 * 60 * 1_000).toISOString();
  assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.previousPhaseReceipt,
    durableEvidenceRequestValue: fixture.durableEvidenceRequest,
    availabilityReceiptValues: fixture.availabilityReceipts,
    preparedAt: staleAt,
  }), /stale at the snapshot boundary|stale at proof preparation/);

  const withoutMobile = structuredClone(fixture.durableEvidenceRequest);
  const home = withoutMobile.workflowReceipt.pages.find((page) => page.pageKind === "HOME");
  if (!home) throw new Error("Synthetic workflow fixture is missing its homepage.");
  home.browserProfilesCaptured = ["DESKTOP_1440X900"];
  assert.throws(() => buildPrivateKwCurrentWebsiteEvidenceProof({
    manifestValue: fixture.manifest,
    previousPhaseReceiptValue: fixture.previousPhaseReceipt,
    durableEvidenceRequestValue: withoutMobile,
    availabilityReceiptValues: fixture.availabilityReceipts,
    preparedAt: fixture.preparedAt,
  }), /complete desktop and mobile homepage proof/);
});

test("proof cannot become real progress without a separate content-addressed eligibility receipt", async () => {
  const fixture = await createPrivateKwCurrentWebsiteEvidenceFixture({ suffix: "eligibility" });
  const proof = buildProof(fixture);

  assert.throws(() => PrivateKwShadowSlicePhaseReceiptInputSchema.parse({
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: fixture.manifest.manifestId,
    manifestDigest: fixture.manifest.manifestDigest,
    businessId: proof.businessId,
    evaluationCandidateId: proof.evaluationCandidateId,
    phase: "CURRENT_WEBSITE_EVIDENCE",
    completedAt: proof.workflow.completedAt,
    proof: {
      proofKind: "CURRENT_WEBSITE_EVIDENCE",
      primaryReceiptId: proof.proofId,
      primaryReceiptDigest: proof.proofDigest,
      supportingReceipts: [],
    },
    previousPhaseReceipt: {
      phaseReceiptId: fixture.previousPhaseReceipt.phaseReceiptId,
      phaseReceiptDigest: fixture.previousPhaseReceipt.phaseReceiptDigest,
    },
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt: fixture.preparedAt,
    authority: privateKwShadowSliceProgressAuthority(),
  }), /Supporting receipts/);

  assert.throws(() => PrivateKwCurrentWebsiteEvidenceProofSchema.parse({
    ...proof,
    authority: { ...proof.authority, phaseAdvancementAuthorized: true },
  }));
});
