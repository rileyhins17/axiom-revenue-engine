import {
  buildPrivateKwOwnerDossierAcceptanceProof,
} from "@/lib/revenue-engine/private-kw-owner-dossier-progress-proof";
import {
  requireInProcessPrivateKwContactReviewProgressCheckpoint,
} from "@/lib/revenue-engine/private-kw-contact-review-progress-append";
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

export const PRIVATE_KW_OWNER_DOSSIER_PROGRESS_INPUT_VERSION =
  "kw-owner-dossier-progress-input-v1";

const trustedOwnerDossierProgressInputs = new WeakSet<object>();
const trustedOwnerDossierProgressContexts = new WeakMap<object, {
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

export function requireInProcessPrivateKwOwnerDossierProgressInput(
  value: unknown,
): PrivateKwShadowSlicePhaseReceiptInput {
  PrivateKwShadowSlicePhaseReceiptInputSchema.parse(value);
  if (
    !value
    || typeof value !== "object"
    || !trustedOwnerDossierProgressInputs.has(value)
  ) {
    throw new Error("An exact in-process owner-dossier progress input is required.");
  }
  return value as PrivateKwShadowSlicePhaseReceiptInput;
}

export function requireInProcessPrivateKwOwnerDossierProgressInputForParent(
  value: unknown,
  manifestValue: unknown,
  previousProgressValue: unknown,
): PrivateKwShadowSlicePhaseReceiptInput {
  const trusted = requireInProcessPrivateKwOwnerDossierProgressInput(value);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestValue);
  const previousProgress = PrivateKwShadowSliceProgressCheckpointSchema.parse(
    previousProgressValue,
  );
  const context = trustedOwnerDossierProgressContexts.get(trusted);
  if (
    !context
    || context.manifestId !== manifest.manifestId
    || context.manifestDigest !== manifest.manifestDigest
    || context.parentCheckpointId !== previousProgress.checkpointId
    || context.parentCheckpointDigest !== previousProgress.checkpointDigest
  ) {
    throw new Error(
      "Owner-dossier progress input requires its exact unchanged manifest and contact-review parent checkpoint.",
    );
  }
  return trusted;
}

/**
 * Derives one validation-only OWNER_DOSSIER input. It creates no receipt or
 * checkpoint and cannot append, persist, contact, call a provider, or deploy.
 */
export function buildPrivateKwOwnerDossierProgressInput(input: {
  manifestValue: unknown;
  contactReviewProgressCheckpointValue: unknown;
  ownerDossierValue: unknown;
  acceptanceValue: unknown;
}): PrivateKwShadowSlicePhaseReceiptInput {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const previousProgress = requireInProcessPrivateKwContactReviewProgressCheckpoint(
    input.contactReviewProgressCheckpointValue,
  );
  const proof = buildPrivateKwOwnerDossierAcceptanceProof({
    manifestValue: manifest,
    contactReviewProgressCheckpointValue: previousProgress,
    ownerDossierValue: input.ownerDossierValue,
    acceptanceValue: input.acceptanceValue,
  });
  const progressRecord = previousProgress.records.find(
    (record) => record.businessId === proof.businessId,
  );
  const predecessor = progressRecord?.phaseReceipts.at(-1);
  if (
    !progressRecord
    || progressRecord.phaseReceipts.length !== 4
    || progressRecord.currentCheckpoint !== "CONTACT_REVIEW_PERSISTED"
    || progressRecord.nextRequiredGate !== "OWNER_DOSSIER_ACCEPTANCE"
    || !predecessor
    || predecessor.phaseReceiptId !== proof.previousPhaseReceipt.phaseReceiptId
    || predecessor.phaseReceiptDigest !== proof.previousPhaseReceipt.phaseReceiptDigest
  ) {
    throw new Error(
      "Owner-dossier progress requires the exact proof-bound contact-review predecessor.",
    );
  }

  const phaseInput = PrivateKwShadowSlicePhaseReceiptInputSchema.parse({
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    businessId: proof.businessId,
    evaluationCandidateId: proof.evaluationCandidateId,
    phase: "OWNER_DOSSIER",
    completedAt: proof.acceptance.acceptedAt,
    proof: {
      proofKind: "READ_ONLY_OWNER_DOSSIER_ACCEPTANCE",
      primaryReceiptId: proof.proofId,
      primaryReceiptDigest: proof.proofDigest,
      supportingReceipts: [],
    },
    previousPhaseReceipt: {
      phaseReceiptId: predecessor.phaseReceiptId,
      phaseReceiptDigest: predecessor.phaseReceiptDigest,
    },
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt: proof.acceptance.acceptedAt,
    authority: privateKwShadowSliceProgressAuthority(),
  });
  const trusted = deepFreeze(phaseInput);
  trustedOwnerDossierProgressInputs.add(trusted);
  trustedOwnerDossierProgressContexts.set(trusted, {
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    parentCheckpointId: previousProgress.checkpointId,
    parentCheckpointDigest: previousProgress.checkpointDigest,
  });
  return trusted;
}
