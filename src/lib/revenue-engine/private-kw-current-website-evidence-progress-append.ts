import {
  PrivateKwShadowSliceManifestSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  requireInProcessPrivateKwCurrentWebsiteEvidenceProgressInputForParent,
} from "@/lib/revenue-engine/private-kw-current-website-evidence-progress";
import {
  PrivateKwShadowSliceProgressCheckpointSchema,
  appendPrivateKwShadowSliceProgress,
  buildPrivateKwShadowSlicePhaseReceipt,
  privateKwShadowSliceProgressDigest,
  type PrivateKwShadowSliceProgressCheckpoint,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";

const trustedAppendedCheckpoints = new WeakSet<object>();
const appendedCheckpointsByInput = new WeakMap<object, {
  parentCheckpointId: string;
  parentCheckpointDigest: string;
  checkpoint: PrivateKwShadowSliceProgressCheckpoint;
}>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function requireInProcessPrivateKwCurrentWebsiteEvidenceProgressCheckpoint(
  value: unknown,
): PrivateKwShadowSliceProgressCheckpoint {
  PrivateKwShadowSliceProgressCheckpointSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedAppendedCheckpoints.has(value)) {
    throw new Error(
      "Current website evidence progress checkpoint must be the exact in-process result of the guarded append boundary.",
    );
  }
  return value as PrivateKwShadowSliceProgressCheckpoint;
}

/**
 * Appends one already verified CURRENT_WEBSITE_EVIDENCE input to its exact
 * immutable parent in memory. It performs no file, database, runtime, provider,
 * phase execution, or external operation.
 */
export function appendPrivateKwCurrentWebsiteEvidenceProgress(input: {
  manifestValue: unknown;
  previousProgressValue: unknown;
  phaseInputValue: unknown;
}): PrivateKwShadowSliceProgressCheckpoint {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const previousProgress = PrivateKwShadowSliceProgressCheckpointSchema.parse(
    input.previousProgressValue,
  );
  const phaseInput = requireInProcessPrivateKwCurrentWebsiteEvidenceProgressInputForParent(
    input.phaseInputValue,
    manifest,
    previousProgress,
  );
  if (
    phaseInput.phase !== "CURRENT_WEBSITE_EVIDENCE"
    || phaseInput.manifestId !== manifest.manifestId
    || phaseInput.manifestDigest !== manifest.manifestDigest
  ) {
    throw new Error(
      "Guarded website evidence append requires one exact manifest-bound CURRENT_WEBSITE_EVIDENCE input.",
    );
  }

  const cached = appendedCheckpointsByInput.get(phaseInput);
  if (cached) {
    if (
      cached.parentCheckpointId !== previousProgress.checkpointId
      || cached.parentCheckpointDigest !== previousProgress.checkpointDigest
    ) {
      throw new Error(
        "Guarded website evidence append cannot replay against a different parent checkpoint.",
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
    || !previousRecord
    || !nextRecord
    || !appendedReceipt
    || previousRecordIndex < 0
    || nextRecordIndex !== previousRecordIndex
    || nextRecord.phaseReceipts.length !== previousRecord.phaseReceipts.length + 1
    || nextRecord.currentCheckpoint !== "CURRENT_WEBSITE_EVIDENCE_PERSISTED"
    || nextRecord.nextRequiredGate !== "ASSESSMENT_APPROVAL"
    || privateKwShadowSliceProgressDigest(
      nextRecord.phaseReceipts.slice(0, -1),
    ) !== privateKwShadowSliceProgressDigest(previousRecord.phaseReceipts)
    || privateKwShadowSliceProgressDigest(appendedReceipt)
      !== privateKwShadowSliceProgressDigest(expectedReceipt)
    || privateKwShadowSliceProgressDigest(nextOtherRecords)
      !== privateKwShadowSliceProgressDigest(previousOtherRecords)
  ) {
    throw new Error(
      "Guarded website evidence append must add exactly one receipt without changing any other progress.",
    );
  }

  const trusted = deepFreeze(nextProgress);
  trustedAppendedCheckpoints.add(trusted);
  appendedCheckpointsByInput.set(phaseInput, {
    parentCheckpointId: previousProgress.checkpointId,
    parentCheckpointDigest: previousProgress.checkpointDigest,
    checkpoint: trusted,
  });
  return trusted;
}
