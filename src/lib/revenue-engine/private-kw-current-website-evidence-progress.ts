import { z } from "zod";

import { artifactReferenceDigest } from "@/lib/revenue-engine/artifact-reference-projection";
import {
  PrivateKwCurrentWebsiteEvidenceProofSchema,
} from "@/lib/revenue-engine/private-kw-current-website-evidence";
import {
  requireCurrentPrivateKwWebsiteEvidenceEligibilityD1Result,
} from "@/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1";
import {
  PrivateKwShadowSliceManifestSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
  PrivateKwShadowSlicePhaseReceiptInputSchema,
  PrivateKwShadowSliceProgressCheckpointSchema,
  privateKwShadowSliceProgressAuthority,
  type PrivateKwShadowSlicePhaseReceiptInput,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";

export const PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_PROGRESS_INPUT_VERSION =
  "kw-current-website-evidence-progress-input-v1";

const TimestampSchema = z.string().datetime({ offset: true });
const trustedProgressInputs = new WeakSet<object>();
const trustedProgressInputContexts = new WeakMap<object, {
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

export function requireInProcessPrivateKwCurrentWebsiteEvidenceProgressInput(
  value: unknown,
): PrivateKwShadowSlicePhaseReceiptInput {
  PrivateKwShadowSlicePhaseReceiptInputSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedProgressInputs.has(value)) {
    throw new Error(
      "Current website evidence progress input must be the exact in-process result of the validation-only adapter.",
    );
  }
  return value as PrivateKwShadowSlicePhaseReceiptInput;
}

export function requireInProcessPrivateKwCurrentWebsiteEvidenceProgressInputForParent(
  value: unknown,
  manifestValue: unknown,
  previousProgressValue: unknown,
): PrivateKwShadowSlicePhaseReceiptInput {
  const trusted = requireInProcessPrivateKwCurrentWebsiteEvidenceProgressInput(value);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestValue);
  const previousProgress = PrivateKwShadowSliceProgressCheckpointSchema.parse(
    previousProgressValue,
  );
  const context = trustedProgressInputContexts.get(trusted);
  if (
    !context
    || context.manifestId !== manifest.manifestId
    || context.manifestDigest !== manifest.manifestDigest
    || context.parentCheckpointId !== previousProgress.checkpointId
    || context.parentCheckpointDigest !== previousProgress.checkpointDigest
  ) {
    throw new Error(
      "Current website evidence progress input requires its exact unchanged manifest and parent checkpoint.",
    );
  }
  return trusted;
}

export function buildPrivateKwCurrentWebsiteEvidenceProgressInput(input: {
  manifestValue: unknown;
  previousProgressValue: unknown;
  websiteEvidenceProofValue: unknown;
  currentEligibilityResultValue: unknown;
  recordedAt: string;
}): PrivateKwShadowSlicePhaseReceiptInput {
  return buildPrivateKwCurrentWebsiteEvidenceProgressInputInternal({
    manifestValue: input.manifestValue,
    previousProgressValue: input.previousProgressValue,
    websiteEvidenceProofValue: input.websiteEvidenceProofValue,
    currentEligibilityResultValue: input.currentEligibilityResultValue,
    recordedAt: input.recordedAt,
  });
}

/**
 * Reconstructs a previously persisted website phase for a restart. The
 * persisted checkpoint may supply the historical phase shape, but its
 * recording timestamp must equal the independently reconstructed canonical
 * timestamp supplied by the caller. The caller must append this trusted input
 * and compare the complete rebuilt checkpoint before accepting it.
 */
export function buildPrivateKwCurrentWebsiteEvidenceProgressInputForPersistedCheckpoint(input: {
  manifestValue: unknown;
  previousProgressValue: unknown;
  websiteEvidenceProofValue: unknown;
  currentEligibilityResultValue: unknown;
  persistedCheckpointValue: unknown;
  canonicalRecordedAt: string;
}): PrivateKwShadowSlicePhaseReceiptInput {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const previousProgress = PrivateKwShadowSliceProgressCheckpointSchema.parse(input.previousProgressValue);
  const websiteEvidence = PrivateKwCurrentWebsiteEvidenceProofSchema.parse(input.websiteEvidenceProofValue);
  const persisted = PrivateKwShadowSliceProgressCheckpointSchema.parse(input.persistedCheckpointValue);
  if (
    persisted.parentCheckpoint?.checkpointId !== previousProgress.checkpointId
    || persisted.parentCheckpoint.checkpointDigest !== previousProgress.checkpointDigest
  ) throw new Error("Persisted website checkpoint must bind the exact source progress parent.");
  const canonicalRecordedAt = TimestampSchema.parse(input.canonicalRecordedAt);
  const record = persisted.records.find((candidate) => candidate.businessId === websiteEvidence.businessId);
  const phase = record?.phaseReceipts.at(-1);
  if (
    !record
    || record.phaseReceipts.length !== 2
    || !phase
    || phase.phase !== "CURRENT_WEBSITE_EVIDENCE"
    || phase.proof.primaryReceiptId !== websiteEvidence.proofId
    || phase.proof.primaryReceiptDigest !== websiteEvidence.proofDigest
  ) throw new Error("Persisted website checkpoint must retain the exact current evidence phase lineage.");
  if (phase.recordedAt !== canonicalRecordedAt) {
    throw new Error("Persisted website checkpoint recordedAt must match the independently reconstructed durable timestamp.");
  }
  return buildPrivateKwCurrentWebsiteEvidenceProgressInputInternal({
    manifestValue: manifest,
    previousProgressValue: previousProgress,
    websiteEvidenceProofValue: websiteEvidence,
    currentEligibilityResultValue: input.currentEligibilityResultValue,
    recordedAt: phase.recordedAt,
    historicalRecordedAt: phase.recordedAt,
  });
}

/**
 * Derives one validation-only CURRENT_WEBSITE_EVIDENCE phase input from an
 * exact current durable reload. It does not call the progress appender, create
 * a phase receipt/checkpoint, read D1/R2, or authorize any execution.
 */
function buildPrivateKwCurrentWebsiteEvidenceProgressInputInternal(input: {
  manifestValue: unknown;
  previousProgressValue: unknown;
  websiteEvidenceProofValue: unknown;
  currentEligibilityResultValue: unknown;
  recordedAt: string;
  historicalRecordedAt?: string;
}): PrivateKwShadowSlicePhaseReceiptInput {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const previousProgress = PrivateKwShadowSliceProgressCheckpointSchema.parse(
    input.previousProgressValue,
  );
  const websiteEvidence = PrivateKwCurrentWebsiteEvidenceProofSchema.parse(
    input.websiteEvidenceProofValue,
  );
  const eligibility = requireCurrentPrivateKwWebsiteEvidenceEligibilityD1Result(
    input.currentEligibilityResultValue,
  );
  const historicalRecordedAt = input.historicalRecordedAt === undefined
    ? undefined
    : TimestampSchema.parse(input.historicalRecordedAt);
  const recordedAt = TimestampSchema.parse(historicalRecordedAt ?? input.recordedAt);

  if (eligibility.executionPath !== "DURABLE_RELOAD") {
    throw new Error(
      "Current website evidence progress requires an exact current durable reload, not a commit or replay response.",
    );
  }
  if (
    previousProgress.manifestId !== manifest.manifestId
    || previousProgress.manifestDigest !== manifest.manifestDigest
    || previousProgress.sliceKey !== manifest.sliceKey
    || previousProgress.sourcePlanDigest !== manifest.sourcePlanDigest
    || artifactReferenceDigest(exactScope(previousProgress.records))
      !== artifactReferenceDigest(exactScope(manifest.records))
  ) {
    throw new Error(
      "Current website evidence progress requires the exact manifest-bound ten-business checkpoint.",
    );
  }

  const manifestRecord = manifest.records.find(
    (record) => record.businessId === websiteEvidence.businessId,
  );
  const progressRecord = previousProgress.records.find(
    (record) => record.businessId === websiteEvidence.businessId,
  );
  if (
    !manifestRecord
    || !progressRecord
    || manifestRecord.evaluationCandidateId !== websiteEvidence.evaluationCandidateId
    || manifestRecord.sourceRecordId !== websiteEvidence.sourceRecordId
    || manifestRecord.websiteUrl !== websiteEvidence.websiteUrl
    || manifestRecord.sourceEvidenceUrl !== websiteEvidence.sourceEvidenceUrl
    || progressRecord.evaluationCandidateId !== manifestRecord.evaluationCandidateId
    || progressRecord.sourceRecordId !== manifestRecord.sourceRecordId
  ) {
    throw new Error(
      "Current website evidence progress must identify one exact website-bearing manifest business.",
    );
  }

  const predecessor = progressRecord.phaseReceipts.at(-1);
  if (
    progressRecord.phaseReceipts.length !== 1
    || progressRecord.currentCheckpoint !== "SOURCE_WORKFLOW_PERSISTED"
    || progressRecord.nextRequiredGate !== "CURRENT_WEBSITE_EVIDENCE_APPROVAL"
    || !predecessor
    || predecessor.phase !== "SOURCE_WORKFLOW"
    || predecessor.completedCheckpoint !== "SOURCE_WORKFLOW_PERSISTED"
    || predecessor.phaseReceiptId !== websiteEvidence.previousPhaseReceipt.phaseReceiptId
    || predecessor.phaseReceiptDigest !== websiteEvidence.previousPhaseReceipt.phaseReceiptDigest
    || predecessor.completedAt !== websiteEvidence.previousPhaseReceipt.completedAt
  ) {
    throw new Error(
      "Current website evidence progress requires the business's exact completed source/workflow predecessor.",
    );
  }

  const receipt = eligibility.receipt;
  if (
    receipt.manifestId !== manifest.manifestId
    || receipt.manifestDigest !== manifest.manifestDigest
    || receipt.businessId !== manifestRecord.businessId
    || receipt.evaluationCandidateId !== manifestRecord.evaluationCandidateId
    || receipt.sourceRecordId !== manifestRecord.sourceRecordId
    || receipt.websiteEvidence.proofId !== websiteEvidence.proofId
    || receipt.websiteEvidence.proofDigest !== websiteEvidence.proofDigest
    || receipt.websiteEvidence.preparedAt !== websiteEvidence.preparedAt
    || receipt.persistedWorkflow.workflowId !== websiteEvidence.workflow.workflowId
    || receipt.persistedWorkflow.requestDigest !== websiteEvidence.workflow.requestDigest
    || receipt.websiteEvidence.workflowReceiptId !== websiteEvidence.workflow.receiptId
    || receipt.persistedWorkflow.workflowReceiptDigest !== websiteEvidence.workflow.receiptDigest
    || receipt.websiteEvidence.auditDigest !== websiteEvidence.workflow.auditDigest
    || receipt.websiteEvidence.artifactSetDigest !== websiteEvidence.workflow.artifactSetDigest
  ) {
    throw new Error(
      "Current website evidence progress requires the exact proof-bound durable eligibility receipt.",
    );
  }

  if (
    Date.parse(eligibility.receiptRecordedAt) < Date.parse(receipt.evaluatedAt)
    || Date.parse(eligibility.databaseNow) < Date.parse(eligibility.receiptRecordedAt)
    || (historicalRecordedAt === undefined && Date.parse(recordedAt) < Date.parse(eligibility.databaseNow))
    || Date.parse(recordedAt) >= Date.parse(receipt.evidenceFreshThrough)
    || Date.parse(receipt.evaluatedAt) < Date.parse(websiteEvidence.preparedAt)
    || Date.parse(websiteEvidence.workflow.requestedAt) < Date.parse(predecessor.completedAt)
  ) {
    throw new Error(
      "Current website evidence progress chronology must remain inside the exact current evidence window.",
    );
  }

  const phaseInput = PrivateKwShadowSlicePhaseReceiptInputSchema.parse({
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    businessId: manifestRecord.businessId,
    evaluationCandidateId: manifestRecord.evaluationCandidateId,
    phase: "CURRENT_WEBSITE_EVIDENCE",
    completedAt: eligibility.receiptRecordedAt,
    proof: {
      proofKind: "CURRENT_WEBSITE_EVIDENCE",
      primaryReceiptId: websiteEvidence.proofId,
      primaryReceiptDigest: websiteEvidence.proofDigest,
      supportingReceipts: [{
        receiptId: receipt.receiptId,
        receiptDigest: receipt.receiptDigest,
      }],
    },
    previousPhaseReceipt: {
      phaseReceiptId: predecessor.phaseReceiptId,
      phaseReceiptDigest: predecessor.phaseReceiptDigest,
    },
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt,
    authority: privateKwShadowSliceProgressAuthority(),
  });
  const trusted = deepFreeze(phaseInput);
  trustedProgressInputs.add(trusted);
  trustedProgressInputContexts.set(trusted, {
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    parentCheckpointId: previousProgress.checkpointId,
    parentCheckpointDigest: previousProgress.checkpointDigest,
  });
  return trusted;
}
