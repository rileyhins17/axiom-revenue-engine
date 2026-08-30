import {
  requireCurrentRevenueLeadAssessmentD1DurableReload,
} from "@/lib/revenue-engine/lead-assessment-d1";
import {
  buildPrivateKwAssessmentProgressProof,
} from "@/lib/revenue-engine/private-kw-assessment-progress-proof";
import {
  PrivateKwCurrentWebsiteEvidenceProofSchema,
} from "@/lib/revenue-engine/private-kw-current-website-evidence";
import {
  PrivateKwShadowSliceManifestSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
  PrivateKwShadowSlicePhaseReceiptInputSchema,
  PrivateKwShadowSliceProgressCheckpointSchema,
  privateKwShadowSliceProgressAuthority,
  privateKwShadowSliceProgressDigest,
  type PrivateKwShadowSlicePhaseReceiptInput,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";

export const PRIVATE_KW_ASSESSMENT_PROGRESS_INPUT_VERSION =
  "kw-assessment-progress-input-v1";

const trustedAssessmentProgressInputs = new WeakSet<object>();
const trustedAssessmentProgressContexts = new WeakMap<object, {
  manifestId: string;
  manifestDigest: string;
  parentCheckpointId: string;
  parentCheckpointDigest: string;
}>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function exactScope(value: readonly {
  businessId: string;
  evaluationCandidateId: string;
  sourceRecordId: string;
}[]) {
  return value.map((record) => ({
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    sourceRecordId: record.sourceRecordId,
  }));
}

function exactCheckpointCreatedAt(input: {
  manifestCreatedAt: string;
  records: readonly {
    phaseReceipts: readonly { recordedAt: string }[];
  }[];
}) {
  return input.records
    .flatMap((record) => record.phaseReceipts.map((receipt) => receipt.recordedAt))
    .reduce((latest, candidate) => (
      Date.parse(candidate) > Date.parse(latest) ? candidate : latest
    ), input.manifestCreatedAt);
}

export function requireInProcessPrivateKwAssessmentProgressInput(
  value: unknown,
): PrivateKwShadowSlicePhaseReceiptInput {
  PrivateKwShadowSlicePhaseReceiptInputSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedAssessmentProgressInputs.has(value)) {
    throw new Error(
      "Assessment progress input must be the exact in-process result of the validation-only adapter.",
    );
  }
  return value as PrivateKwShadowSlicePhaseReceiptInput;
}

export function requireInProcessPrivateKwAssessmentProgressInputForParent(
  value: unknown,
  manifestValue: unknown,
  previousProgressValue: unknown,
): PrivateKwShadowSlicePhaseReceiptInput {
  const trusted = requireInProcessPrivateKwAssessmentProgressInput(value);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestValue);
  const previousProgress = PrivateKwShadowSliceProgressCheckpointSchema.parse(
    previousProgressValue,
  );
  const context = trustedAssessmentProgressContexts.get(trusted);
  if (
    !context
    || context.manifestId !== manifest.manifestId
    || context.manifestDigest !== manifest.manifestDigest
    || context.parentCheckpointId !== previousProgress.checkpointId
    || context.parentCheckpointDigest !== previousProgress.checkpointDigest
  ) {
    throw new Error(
      "Assessment progress input requires its exact unchanged manifest and parent checkpoint.",
    );
  }
  return trusted;
}

/**
 * Derives one validation-only ASSESSMENT phase input from an exact current
 * durable assessment reload. It creates the supporting proof internally but
 * does not append progress, create a phase receipt/checkpoint, read D1/R2, or
 * authorize any execution.
 */
export function buildPrivateKwAssessmentProgressInput(input: {
  manifestValue: unknown;
  previousProgressValue: unknown;
  currentWebsiteEvidenceProofValue: unknown;
  currentAssessmentResultValue: unknown;
}): PrivateKwShadowSlicePhaseReceiptInput {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const previousProgress = PrivateKwShadowSliceProgressCheckpointSchema.parse(
    input.previousProgressValue,
  );
  const websiteEvidence = PrivateKwCurrentWebsiteEvidenceProofSchema.parse(
    input.currentWebsiteEvidenceProofValue,
  );
  const durable = requireCurrentRevenueLeadAssessmentD1DurableReload(
    input.currentAssessmentResultValue,
  );
  const assessment = durable.assessment;

  if (
    previousProgress.manifestId !== manifest.manifestId
    || previousProgress.manifestDigest !== manifest.manifestDigest
    || previousProgress.sliceKey !== manifest.sliceKey
    || previousProgress.sourcePlanDigest !== manifest.sourcePlanDigest
    || privateKwShadowSliceProgressDigest(exactScope(previousProgress.records))
      !== privateKwShadowSliceProgressDigest(exactScope(manifest.records))
    || previousProgress.createdAt !== exactCheckpointCreatedAt({
      manifestCreatedAt: manifest.createdAt,
      records: previousProgress.records,
    })
  ) {
    throw new Error(
      "Assessment progress requires the exact manifest-bound ten-business checkpoint.",
    );
  }

  const manifestRecord = manifest.records.find(
    (record) => record.businessId === assessment.business.id,
  );
  const progressRecord = previousProgress.records.find(
    (record) => record.businessId === assessment.business.id,
  );
  if (
    !manifestRecord
    || !progressRecord
    || manifestRecord.evaluationCandidateId !== websiteEvidence.evaluationCandidateId
    || manifestRecord.sourceRecordId !== websiteEvidence.sourceRecordId
    || manifestRecord.businessId !== websiteEvidence.businessId
    || manifestRecord.businessName !== assessment.business.canonicalName
    || manifestRecord.websiteUrl !== websiteEvidence.websiteUrl
    || manifestRecord.sourceEvidenceUrl !== websiteEvidence.sourceEvidenceUrl
    || progressRecord.evaluationCandidateId !== manifestRecord.evaluationCandidateId
    || progressRecord.sourceRecordId !== manifestRecord.sourceRecordId
    || assessment.business.independenceStatus !== "INDEPENDENT"
    || assessment.business.status !== "RESEARCH_ONLY"
  ) {
    throw new Error(
      "Assessment progress must identify one exact independent reviewed manifest business.",
    );
  }

  const predecessor = progressRecord.phaseReceipts.at(-1);
  if (
    progressRecord.phaseReceipts.length !== 2
    || progressRecord.currentCheckpoint !== "CURRENT_WEBSITE_EVIDENCE_PERSISTED"
    || progressRecord.nextRequiredGate !== "ASSESSMENT_APPROVAL"
    || !predecessor
    || predecessor.phase !== "CURRENT_WEBSITE_EVIDENCE"
    || predecessor.completedCheckpoint !== "CURRENT_WEBSITE_EVIDENCE_PERSISTED"
    || predecessor.proof.primaryReceiptId !== websiteEvidence.proofId
    || predecessor.proof.primaryReceiptDigest !== websiteEvidence.proofDigest
    || predecessor.proof.supportingReceipts.length !== 1
  ) {
    throw new Error(
      "Assessment progress requires the business's exact completed current-website-evidence predecessor.",
    );
  }

  const proof = buildPrivateKwAssessmentProgressProof({
    manifestValue: manifest,
    previousPhaseReceiptValue: predecessor,
    currentWebsiteEvidenceProofValue: websiteEvidence,
    assessmentDurableReloadValue: durable,
  });
  if (
    proof.manifestId !== manifest.manifestId
    || proof.manifestDigest !== manifest.manifestDigest
    || proof.businessId !== manifestRecord.businessId
    || proof.evaluationCandidateId !== manifestRecord.evaluationCandidateId
    || proof.sourceRecordId !== manifestRecord.sourceRecordId
    || proof.previousPhaseReceipt.phaseReceiptId !== predecessor.phaseReceiptId
    || proof.previousPhaseReceipt.phaseReceiptDigest !== predecessor.phaseReceiptDigest
    || proof.currentWebsiteEvidence.proofId !== websiteEvidence.proofId
    || proof.currentWebsiteEvidence.proofDigest !== websiteEvidence.proofDigest
    || proof.assessment.assessmentId !== assessment.assessmentId
    || proof.assessment.assessmentDigest !== assessment.assessmentDigest
    || proof.persistence.executionPath !== "DURABLE_RELOAD"
    || proof.persistence.databaseNow !== durable.databaseNow
    || proof.persistence.freshnessState !== "CURRENT"
  ) {
    throw new Error(
      "Assessment progress requires one exact internally rebuilt durable assessment proof.",
    );
  }

  if (
    Date.parse(durable.assessmentReceiptRecordedAt) < Date.parse(assessment.assessedAt)
    || Date.parse(durable.databaseNow) < Date.parse(durable.assessmentReceiptRecordedAt)
    || Date.parse(durable.databaseNow) !== Date.parse(proof.preparedAt)
    || Date.parse(durable.databaseNow) >= Date.parse(assessment.refreshAfter)
    || Date.parse(durable.databaseNow) >= Date.parse(websiteEvidence.evidenceFreshThrough)
    || Date.parse(assessment.assessedAt) < Date.parse(predecessor.recordedAt)
    || Date.parse(durable.databaseNow) < Date.parse(previousProgress.createdAt)
  ) {
    throw new Error(
      "Assessment progress chronology must remain inside the exact current evidence and assessment windows.",
    );
  }

  const phaseInput = PrivateKwShadowSlicePhaseReceiptInputSchema.parse({
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    businessId: manifestRecord.businessId,
    evaluationCandidateId: manifestRecord.evaluationCandidateId,
    phase: "ASSESSMENT",
    completedAt: durable.assessmentReceiptRecordedAt,
    proof: {
      proofKind: "IMMUTABLE_ASSESSMENT",
      primaryReceiptId: assessment.assessmentId,
      primaryReceiptDigest: assessment.assessmentDigest,
      supportingReceipts: [{
        receiptId: proof.proofId,
        receiptDigest: proof.proofDigest,
      }],
    },
    previousPhaseReceipt: {
      phaseReceiptId: predecessor.phaseReceiptId,
      phaseReceiptDigest: predecessor.phaseReceiptDigest,
    },
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt: durable.databaseNow,
    authority: privateKwShadowSliceProgressAuthority(),
  });
  const trusted = deepFreeze(phaseInput);
  trustedAssessmentProgressInputs.add(trusted);
  trustedAssessmentProgressContexts.set(trusted, {
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    parentCheckpointId: previousProgress.checkpointId,
    parentCheckpointDigest: previousProgress.checkpointDigest,
  });
  return trusted;
}
