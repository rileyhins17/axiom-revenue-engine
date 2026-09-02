import {
  requireInProcessPrivateKwOwnerDossierProgressInputForParent,
} from "@/lib/revenue-engine/private-kw-owner-dossier-progress";
import {
  PrivateKwShadowSliceManifestSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PRIVATE_KW_SHADOW_PROGRESS_PHASES,
  PrivateKwShadowSliceProgressCheckpointSchema,
  appendPrivateKwShadowSliceProgress,
  buildPrivateKwShadowSlicePhaseReceipt,
  privateKwShadowSliceProgressDigest,
  type PrivateKwShadowSliceProgressCheckpoint,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";

const trustedOwnerDossierCheckpoints = new WeakSet<object>();
const UNCHANGED_OWNER_DOSSIER_APPEND_CHECKPOINTS = [
  "SOURCE_REVIEWED",
  "SOURCE_WORKFLOW_PERSISTED",
  "CURRENT_WEBSITE_EVIDENCE_PERSISTED",
  "ASSESSMENT_PERSISTED",
] as const;
const ownerDossierCheckpointsByInput = new WeakMap<object, {
  parentCheckpointId: string;
  parentCheckpointDigest: string;
  checkpoint: PrivateKwShadowSliceProgressCheckpoint;
}>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function requireInProcessPrivateKwOwnerDossierProgressCheckpoint(
  value: unknown,
): PrivateKwShadowSliceProgressCheckpoint {
  PrivateKwShadowSliceProgressCheckpointSchema.parse(value);
  if (
    !value
    || typeof value !== "object"
    || !trustedOwnerDossierCheckpoints.has(value)
  ) {
    throw new Error(
      "Owner-dossier progress checkpoint must be the exact in-process result of the guarded append boundary.",
    );
  }
  return value as PrivateKwShadowSliceProgressCheckpoint;
}

/**
 * Appends one already verified OWNER_DOSSIER input to its exact immutable
 * parent in memory. It performs no file, database, runtime, provider, phase
 * execution, owner authentication, persistence, contact, or external operation.
 */
export function appendPrivateKwOwnerDossierProgress(input: {
  manifestValue: unknown;
  previousProgressValue: unknown;
  phaseInputValue: unknown;
}): PrivateKwShadowSliceProgressCheckpoint {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const previousProgress = PrivateKwShadowSliceProgressCheckpointSchema.parse(
    input.previousProgressValue,
  );
  const phaseInput = requireInProcessPrivateKwOwnerDossierProgressInputForParent(
    input.phaseInputValue,
    manifest,
    previousProgress,
  );
  if (
    phaseInput.phase !== "OWNER_DOSSIER"
    || phaseInput.manifestId !== manifest.manifestId
    || phaseInput.manifestDigest !== manifest.manifestDigest
  ) {
    throw new Error(
      "Guarded owner-dossier append requires one exact manifest-bound OWNER_DOSSIER input.",
    );
  }

  const cached = ownerDossierCheckpointsByInput.get(phaseInput);
  if (cached) {
    if (
      cached.parentCheckpointId !== previousProgress.checkpointId
      || cached.parentCheckpointDigest !== previousProgress.checkpointDigest
    ) {
      throw new Error(
        "Guarded owner-dossier append cannot replay against a different parent checkpoint.",
      );
    }
    return cached.checkpoint;
  }

  const expectedReceipt = buildPrivateKwShadowSlicePhaseReceipt(manifest, phaseInput);
  const nextProgress = appendPrivateKwShadowSliceProgress(
    manifest,
    previousProgress,
    phaseInput,
  );
  const previousRecord = previousProgress.records.find(
    (record) => record.businessId === phaseInput.businessId,
  );
  const nextRecord = nextProgress.records.find(
    (record) => record.businessId === phaseInput.businessId,
  );
  const manifestRecord = manifest.records.find(
    (record) => record.businessId === phaseInput.businessId,
  );
  const previousRecordIndex = previousProgress.records.findIndex(
    (record) => record.businessId === phaseInput.businessId,
  );
  const nextRecordIndex = nextProgress.records.findIndex(
    (record) => record.businessId === phaseInput.businessId,
  );
  const appendedReceipt = nextRecord?.phaseReceipts.at(-1);
  const previousOtherRecords = previousProgress.records.filter(
    (record) => record.businessId !== phaseInput.businessId,
  );
  const nextOtherRecords = nextProgress.records.filter(
    (record) => record.businessId !== phaseInput.businessId,
  );
  const expectedNextIncompleteBusinessId = previousProgress.records.find(
    (record) => (
      record.businessId !== phaseInput.businessId
      && record.phaseReceipts.length < PRIVATE_KW_SHADOW_PROGRESS_PHASES.length
    ),
  )?.businessId ?? null;
  if (
    nextProgress.progressVersion !== previousProgress.progressVersion
    || nextProgress.manifestId !== previousProgress.manifestId
    || nextProgress.manifestDigest !== previousProgress.manifestDigest
    || nextProgress.sliceKey !== previousProgress.sliceKey
    || nextProgress.sourcePlanDigest !== previousProgress.sourcePlanDigest
    || privateKwShadowSliceProgressDigest(nextProgress.authority)
      !== privateKwShadowSliceProgressDigest(previousProgress.authority)
    || nextProgress.parentCheckpoint?.checkpointId !== previousProgress.checkpointId
    || nextProgress.parentCheckpoint.checkpointDigest !== previousProgress.checkpointDigest
    || nextProgress.createdAt !== phaseInput.recordedAt
    || nextProgress.summary.completedPhaseReceipts
      !== previousProgress.summary.completedPhaseReceipts + 1
    || nextProgress.summary.fullyCompletedBusinesses
      !== previousProgress.summary.fullyCompletedBusinesses + 1
    || nextProgress.summary.nextIncompleteBusinessId !== expectedNextIncompleteBusinessId
    || nextProgress.summary.countsByCheckpoint.CONTACT_REVIEW_PERSISTED
      !== previousProgress.summary.countsByCheckpoint.CONTACT_REVIEW_PERSISTED - 1
    || nextProgress.summary.countsByCheckpoint.OWNER_DOSSIER_ACCEPTED
      !== previousProgress.summary.countsByCheckpoint.OWNER_DOSSIER_ACCEPTED + 1
    || UNCHANGED_OWNER_DOSSIER_APPEND_CHECKPOINTS.some((checkpoint) => (
      nextProgress.summary.countsByCheckpoint[checkpoint]
        !== previousProgress.summary.countsByCheckpoint[checkpoint]
    ))
    || !previousRecord
    || !manifestRecord
    || previousRecord.businessId !== manifestRecord.businessId
    || previousRecord.evaluationCandidateId !== manifestRecord.evaluationCandidateId
    || previousRecord.sourceRecordId !== manifestRecord.sourceRecordId
    || previousRecord.phaseReceipts.length !== 4
    || previousRecord.currentCheckpoint !== "CONTACT_REVIEW_PERSISTED"
    || previousRecord.nextRequiredGate !== "OWNER_DOSSIER_ACCEPTANCE"
    || !nextRecord
    || !appendedReceipt
    || previousRecordIndex < 0
    || nextRecordIndex !== previousRecordIndex
    || nextRecord.phaseReceipts.length !== PRIVATE_KW_SHADOW_PROGRESS_PHASES.length
    || nextRecord.phaseReceipts.length !== previousRecord.phaseReceipts.length + 1
    || nextRecord.businessId !== previousRecord.businessId
    || nextRecord.evaluationCandidateId !== previousRecord.evaluationCandidateId
    || nextRecord.sourceRecordId !== previousRecord.sourceRecordId
    || nextRecord.currentCheckpoint !== "OWNER_DOSSIER_ACCEPTED"
    || nextRecord.nextRequiredGate !== null
    || privateKwShadowSliceProgressDigest(nextRecord.phaseReceipts.slice(0, -1))
      !== privateKwShadowSliceProgressDigest(previousRecord.phaseReceipts)
    || privateKwShadowSliceProgressDigest(appendedReceipt)
      !== privateKwShadowSliceProgressDigest(expectedReceipt)
    || privateKwShadowSliceProgressDigest(nextOtherRecords)
      !== privateKwShadowSliceProgressDigest(previousOtherRecords)
  ) {
    throw new Error(
      "Guarded owner-dossier append must complete exactly one business without changing any other progress.",
    );
  }

  const trusted = deepFreeze(nextProgress);
  trustedOwnerDossierCheckpoints.add(trusted);
  ownerDossierCheckpointsByInput.set(phaseInput, {
    parentCheckpointId: previousProgress.checkpointId,
    parentCheckpointDigest: previousProgress.checkpointDigest,
    checkpoint: trusted,
  });
  return trusted;
}
