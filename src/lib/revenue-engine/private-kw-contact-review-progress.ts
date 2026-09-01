import {
  requireInProcessPrivateKwAssessmentProgressCheckpoint,
} from "@/lib/revenue-engine/private-kw-assessment-progress-append";
import {
  requireCurrentPrivateKwContactInvocationDurableReload,
} from "@/lib/revenue-engine/private-kw-contact-invocation-durable";
import {
  buildPrivateKwContactReviewProgressProof,
} from "@/lib/revenue-engine/private-kw-contact-review-progress-proof";
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

export const PRIVATE_KW_CONTACT_REVIEW_PROGRESS_INPUT_VERSION =
  "kw-contact-review-progress-input-v1";

const trustedContactReviewProgressInputs = new WeakSet<object>();
const trustedContactReviewProgressContexts = new WeakMap<object, {
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

export function requireInProcessPrivateKwContactReviewProgressInput(
  value: unknown,
): PrivateKwShadowSlicePhaseReceiptInput {
  PrivateKwShadowSlicePhaseReceiptInputSchema.parse(value);
  if (
    !value
    || typeof value !== "object"
    || !trustedContactReviewProgressInputs.has(value)
  ) {
    throw new Error(
      "Contact-review progress input must be the exact in-process result of the validation-only adapter.",
    );
  }
  return value as PrivateKwShadowSlicePhaseReceiptInput;
}

export function requireInProcessPrivateKwContactReviewProgressInputForParent(
  value: unknown,
  manifestValue: unknown,
  previousProgressValue: unknown,
): PrivateKwShadowSlicePhaseReceiptInput {
  const trusted = requireInProcessPrivateKwContactReviewProgressInput(value);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestValue);
  const previousProgress = PrivateKwShadowSliceProgressCheckpointSchema.parse(
    previousProgressValue,
  );
  const context = trustedContactReviewProgressContexts.get(trusted);
  if (
    !context
    || context.manifestId !== manifest.manifestId
    || context.manifestDigest !== manifest.manifestDigest
    || context.parentCheckpointId !== previousProgress.checkpointId
    || context.parentCheckpointDigest !== previousProgress.checkpointDigest
  ) {
    throw new Error(
      "Contact-review progress input requires its exact unchanged manifest and assessment parent checkpoint.",
    );
  }
  return trusted;
}

/**
 * Derives one validation-only CONTACT_REVIEW phase input from the exact guarded
 * assessment checkpoint and exact current durable contact invocation reload.
 * It rebuilds proof internally but does not append progress, create a phase
 * receipt/checkpoint, read a database, call a provider, or authorize execution.
 */
export function buildPrivateKwContactReviewProgressInput(input: {
  manifestValue: unknown;
  previousProgressValue: unknown;
  currentContactInvocationResultValue: unknown;
}): PrivateKwShadowSlicePhaseReceiptInput {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const previousProgress = requireInProcessPrivateKwAssessmentProgressCheckpoint(
    input.previousProgressValue,
  );
  const durable = requireCurrentPrivateKwContactInvocationDurableReload(
    input.currentContactInvocationResultValue,
  );
  const invocation = durable.invocation;

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
      "Contact-review progress requires the exact manifest-bound ten-business assessment checkpoint.",
    );
  }

  const manifestRecord = manifest.records.find(
    (record) => record.businessId === invocation.businessId,
  );
  const progressRecord = previousProgress.records.find(
    (record) => record.businessId === invocation.businessId,
  );
  if (
    !manifestRecord
    || !progressRecord
    || manifest.sourceImportId !== invocation.sourceImportId
    || manifest.sourcePlanDigest !== invocation.sourcePlanDigest
    || manifestRecord.evaluationCandidateId !== invocation.review.draft.evaluationCandidateId
    || manifestRecord.businessName !== invocation.review.business.canonicalName
    || manifestRecord.city !== invocation.review.business.city
    || manifestRecord.niche !== invocation.review.business.niche
    || progressRecord.evaluationCandidateId !== manifestRecord.evaluationCandidateId
    || progressRecord.sourceRecordId !== manifestRecord.sourceRecordId
  ) {
    throw new Error(
      "Contact-review progress must identify one exact reviewed manifest business and invocation.",
    );
  }

  const predecessor = progressRecord.phaseReceipts.at(-1);
  if (
    progressRecord.phaseReceipts.length !== 3
    || progressRecord.currentCheckpoint !== "ASSESSMENT_PERSISTED"
    || progressRecord.nextRequiredGate !== "CONTACT_REVIEW_APPROVAL"
    || !predecessor
    || predecessor.phase !== "ASSESSMENT"
    || predecessor.completedCheckpoint !== "ASSESSMENT_PERSISTED"
    || predecessor.proof.proofKind !== "IMMUTABLE_ASSESSMENT"
    || predecessor.proof.primaryReceiptId !== durable.assessment.assessmentId
    || predecessor.proof.primaryReceiptDigest !== durable.assessment.assessmentDigest
    || predecessor.proof.supportingReceipts.length !== 1
  ) {
    throw new Error(
      "Contact-review progress requires the business's exact completed assessment predecessor.",
    );
  }

  const proof = buildPrivateKwContactReviewProgressProof({
    manifestValue: manifest,
    assessmentProgressCheckpointValue: previousProgress,
    currentContactInvocationResultValue: durable,
  });
  if (
    proof.manifestId !== manifest.manifestId
    || proof.manifestDigest !== manifest.manifestDigest
    || proof.sourceImportId !== manifest.sourceImportId
    || proof.sourcePlanDigest !== manifest.sourcePlanDigest
    || proof.businessId !== manifestRecord.businessId
    || proof.evaluationCandidateId !== manifestRecord.evaluationCandidateId
    || proof.sourceRecordId !== manifestRecord.sourceRecordId
    || proof.previousPhaseReceipt.phaseReceiptId !== predecessor.phaseReceiptId
    || proof.previousPhaseReceipt.phaseReceiptDigest !== predecessor.phaseReceiptDigest
    || proof.contactInvocation.invocationId !== invocation.invocationId
    || proof.contactInvocation.invocationDigest !== invocation.invocationDigest
    || proof.contactInvocation.reviewId !== invocation.reviewId
    || proof.contactInvocation.reviewDigest !== invocation.reviewDigest
    || proof.contactInvocation.contactMaterializationId
      !== durable.contactMaterialization.materializationId
    || proof.contactInvocation.contactMaterializationDigest
      !== durable.contactMaterialization.materializationDigest
    || proof.contactInvocation.discoveryReceiptId
      !== durable.contactMaterialization.discoveryReceiptId
    || proof.contactInvocation.discoveryResultDigest
      !== durable.contactMaterialization.discoveryResultDigest
    || proof.persistence.executionPath !== "DURABLE_RELOAD"
    || proof.persistence.databaseNow !== durable.databaseNow
    || proof.persistence.freshnessState !== "CURRENT"
  ) {
    throw new Error(
      "Contact-review progress requires one exact internally rebuilt durable contact proof.",
    );
  }

  if (
    Date.parse(durable.invocationReceiptRecordedAt) < Date.parse(predecessor.recordedAt)
    || Date.parse(durable.databaseNow) < Date.parse(durable.invocationReceiptRecordedAt)
    || Date.parse(durable.databaseNow) !== Date.parse(proof.preparedAt)
    || Date.parse(durable.databaseNow) >= Date.parse(durable.evidenceFreshThrough)
    || Date.parse(durable.databaseNow) < Date.parse(previousProgress.createdAt)
  ) {
    throw new Error(
      "Contact-review progress chronology must remain inside the exact current assessment and contact-evidence window.",
    );
  }

  const phaseInput = PrivateKwShadowSlicePhaseReceiptInputSchema.parse({
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    businessId: manifestRecord.businessId,
    evaluationCandidateId: manifestRecord.evaluationCandidateId,
    phase: "CONTACT_REVIEW",
    completedAt: durable.invocationReceiptRecordedAt,
    proof: {
      proofKind: "OWNER_REVIEWED_CONTACT_INVOCATION",
      primaryReceiptId: invocation.invocationId,
      primaryReceiptDigest: invocation.invocationDigest,
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
  trustedContactReviewProgressInputs.add(trusted);
  trustedContactReviewProgressContexts.set(trusted, {
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    parentCheckpointId: previousProgress.checkpointId,
    parentCheckpointDigest: previousProgress.checkpointDigest,
  });
  return trusted;
}
