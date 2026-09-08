import { createHash } from "node:crypto";

import { z } from "zod";

import {
  PRIVATE_KW_SHADOW_SLICE_SIZE,
  PrivateKwShadowSliceManifestSchema,
  type PrivateKwShadowSliceManifest,
} from "@/lib/revenue-engine/private-kw-shadow-slice";

export const PRIVATE_KW_SHADOW_PROGRESS_VERSION = "kw-shadow-slice-progress-v1" as const;
export const PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION = "kw-shadow-slice-phase-receipt-v1" as const;

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IdentitySchema = z.string().trim().min(1).max(200);

export const PRIVATE_KW_SHADOW_PROGRESS_PHASES = [
  {
    phase: "SOURCE_WORKFLOW",
    proofKind: "SOURCE_WORKFLOW_MATERIALIZATION",
    primaryReceiptPattern: /^kw-materialization:[a-f0-9]{64}$/,
    supportingReceiptPatterns: [/^workflow-receipt:[a-f0-9]{64}$/],
    completedCheckpoint: "SOURCE_WORKFLOW_PERSISTED",
    nextRequiredGate: "CURRENT_WEBSITE_EVIDENCE_APPROVAL",
  },
  {
    phase: "CURRENT_WEBSITE_EVIDENCE",
    proofKind: "CURRENT_WEBSITE_EVIDENCE",
    primaryReceiptPattern: /^website-evidence:[a-f0-9]{64}$/,
    supportingReceiptPatterns: [/^website-evidence-eligibility:[a-f0-9]{64}$/],
    completedCheckpoint: "CURRENT_WEBSITE_EVIDENCE_PERSISTED",
    nextRequiredGate: "ASSESSMENT_APPROVAL",
  },
  {
    phase: "ASSESSMENT",
    proofKind: "IMMUTABLE_ASSESSMENT",
    primaryReceiptPattern: /^assessment:[a-f0-9]{64}$/,
    supportingReceiptPatterns: [/^assessment-proof:[a-f0-9]{64}$/],
    completedCheckpoint: "ASSESSMENT_PERSISTED",
    nextRequiredGate: "CONTACT_REVIEW_APPROVAL",
  },
  {
    phase: "CONTACT_REVIEW",
    proofKind: "OWNER_REVIEWED_CONTACT_INVOCATION",
    primaryReceiptPattern: /^kw-contact-invocation:[a-f0-9]{64}$/,
    supportingReceiptPatterns: [/^contact-review-proof:[a-f0-9]{64}$/],
    completedCheckpoint: "CONTACT_REVIEW_PERSISTED",
    nextRequiredGate: "OWNER_DOSSIER_ACCEPTANCE",
  },
  {
    phase: "OWNER_DOSSIER",
    proofKind: "READ_ONLY_OWNER_DOSSIER_ACCEPTANCE",
    primaryReceiptPattern: /^owner-dossier-acceptance:[a-f0-9]{64}$/,
    supportingReceiptPatterns: [],
    completedCheckpoint: "OWNER_DOSSIER_ACCEPTED",
    nextRequiredGate: null,
  },
] as const;

const ProgressPhaseSchema = z.enum(PRIVATE_KW_SHADOW_PROGRESS_PHASES.map((item) => item.phase));
const ProgressProofKindSchema = z.enum(PRIVATE_KW_SHADOW_PROGRESS_PHASES.map((item) => item.proofKind));
const ProgressCheckpointSchema = z.enum([
  "SOURCE_REVIEWED",
  ...PRIVATE_KW_SHADOW_PROGRESS_PHASES.map((item) => item.completedCheckpoint),
]);
const ProgressGateSchema = z.enum([
  "SOURCE_WORKFLOW_MATERIALIZATION_APPROVAL",
  ...PRIVATE_KW_SHADOW_PROGRESS_PHASES
    .map((item) => item.nextRequiredGate)
    .filter((value): value is Exclude<typeof value, null> => value !== null),
]);

const ProgressAuthoritySchema = z.object({
  progressRecordingOnly: z.literal(true),
  phaseExecutionAuthorized: z.literal(false),
  liveSourceAuthorized: z.literal(false),
  browserCaptureAuthorized: z.literal(false),
  artifactStorageAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  contactDiscoveryExecutionAuthorized: z.literal(false),
  contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  mailboxSyncAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const PhaseReceiptReferenceSchema = z.object({
  phaseReceiptId: z.string().regex(/^kw-shadow-phase:[a-f0-9]{64}$/),
  phaseReceiptDigest: Sha256Schema,
}).strict();

const ProofSchema = z.object({
  proofKind: ProgressProofKindSchema,
  primaryReceiptId: IdentitySchema,
  primaryReceiptDigest: Sha256Schema,
  supportingReceipts: z.array(z.object({
    receiptId: IdentitySchema,
    receiptDigest: Sha256Schema,
  }).strict()).max(4),
}).strict().superRefine((proof, context) => {
  const receiptIds = [proof.primaryReceiptId, ...proof.supportingReceipts.map((receipt) => receipt.receiptId)];
  if (new Set(receiptIds).size !== receiptIds.length) {
    context.addIssue({ code: "custom", message: "Phase proof receipt identities must be unique.", path: ["supportingReceipts"] });
  }
});

export const PrivateKwShadowSlicePhaseReceiptInputSchema = z.object({
  receiptVersion: z.literal(PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION),
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  businessId: IdentitySchema,
  evaluationCandidateId: IdentitySchema,
  phase: ProgressPhaseSchema,
  completedAt: TimestampSchema,
  proof: ProofSchema,
  previousPhaseReceipt: PhaseReceiptReferenceSchema.nullable(),
  recordedBy: z.literal("CODEX_INTEGRATION_OWNER"),
  recordedAt: TimestampSchema,
  authority: ProgressAuthoritySchema,
}).strict().superRefine((input, context) => {
  const definition = PRIVATE_KW_SHADOW_PROGRESS_PHASES.find((item) => item.phase === input.phase)!;
  if (input.proof.proofKind !== definition.proofKind) {
    context.addIssue({ code: "custom", message: "Phase proof kind must match the fixed integration phase.", path: ["proof", "proofKind"] });
  }
  if (!definition.primaryReceiptPattern.test(input.proof.primaryReceiptId)) {
    context.addIssue({ code: "custom", message: "Primary receipt identity must match the phase's authoritative receipt type.", path: ["proof", "primaryReceiptId"] });
  }
  const primaryIdentityDigest = input.proof.primaryReceiptId.split(":").at(-1);
  if (input.phase !== "ASSESSMENT" && primaryIdentityDigest !== input.proof.primaryReceiptDigest) {
    context.addIssue({ code: "custom", message: "Content-addressed primary receipt identity must match its exact digest.", path: ["proof", "primaryReceiptDigest"] });
  }
  if (
    input.proof.supportingReceipts.length !== definition.supportingReceiptPatterns.length
    || input.proof.supportingReceipts.some((receipt, index) => !definition.supportingReceiptPatterns[index]?.test(receipt.receiptId))
  ) {
    context.addIssue({ code: "custom", message: "Supporting receipts must exactly match the fixed phase proof contract.", path: ["proof", "supportingReceipts"] });
  }
  input.proof.supportingReceipts.forEach((receipt, index) => {
    if (receipt.receiptId.split(":").at(-1) !== receipt.receiptDigest) {
      context.addIssue({ code: "custom", message: "Content-addressed supporting receipt identity must match its exact digest.", path: ["proof", "supportingReceipts", index, "receiptDigest"] });
    }
  });
  const phaseIndex = PRIVATE_KW_SHADOW_PROGRESS_PHASES.findIndex((item) => item.phase === input.phase);
  if ((phaseIndex === 0) !== (input.previousPhaseReceipt === null)) {
    context.addIssue({ code: "custom", message: "Only the first phase can omit a predecessor receipt.", path: ["previousPhaseReceipt"] });
  }
  if (Date.parse(input.completedAt) > Date.parse(input.recordedAt)) {
    context.addIssue({ code: "custom", message: "Progress cannot be recorded before the upstream phase completed.", path: ["recordedAt"] });
  }
});

export type PrivateKwShadowSlicePhaseReceiptInput = z.infer<
  typeof PrivateKwShadowSlicePhaseReceiptInputSchema
>;

const PrivateKwShadowSlicePhaseReceiptCoreSchema = PrivateKwShadowSlicePhaseReceiptInputSchema.extend({
  phaseOrder: z.number().int().min(1).max(PRIVATE_KW_SHADOW_PROGRESS_PHASES.length),
  completedCheckpoint: ProgressCheckpointSchema,
  nextRequiredGate: ProgressGateSchema.nullable(),
}).strict();

export const PrivateKwShadowSlicePhaseReceiptSchema = PrivateKwShadowSlicePhaseReceiptCoreSchema.extend({
  phaseReceiptId: z.string().regex(/^kw-shadow-phase:[a-f0-9]{64}$/),
  phaseReceiptDigest: Sha256Schema,
}).strict().superRefine((receipt, context) => {
  const { phaseReceiptId: _id, phaseReceiptDigest: _digest, ...core } = receipt;
  void _id;
  void _digest;
  const expectedDigest = privateKwShadowSliceProgressDigest(core);
  if (receipt.phaseReceiptDigest !== expectedDigest || receipt.phaseReceiptId !== `kw-shadow-phase:${expectedDigest}`) {
    context.addIssue({ code: "custom", message: "Phase receipt identity must bind its exact proof and lineage.", path: ["phaseReceiptDigest"] });
  }
  const definition = PRIVATE_KW_SHADOW_PROGRESS_PHASES[receipt.phaseOrder - 1];
  if (
    !definition
    || receipt.phase !== definition.phase
    || receipt.completedCheckpoint !== definition.completedCheckpoint
    || receipt.nextRequiredGate !== definition.nextRequiredGate
  ) {
    context.addIssue({ code: "custom", message: "Phase receipt progression must match the fixed integration contract.", path: ["phaseOrder"] });
  }
});

export type PrivateKwShadowSlicePhaseReceipt = z.infer<typeof PrivateKwShadowSlicePhaseReceiptSchema>;

const ProgressRecordSchema = z.object({
  businessId: IdentitySchema,
  evaluationCandidateId: IdentitySchema,
  sourceRecordId: IdentitySchema,
  phaseReceipts: z.array(PrivateKwShadowSlicePhaseReceiptSchema).max(PRIVATE_KW_SHADOW_PROGRESS_PHASES.length),
  currentCheckpoint: ProgressCheckpointSchema,
  nextRequiredGate: ProgressGateSchema.nullable(),
}).strict();

const CheckpointCountsSchema = z.object({
  SOURCE_REVIEWED: z.number().int().min(0).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
  SOURCE_WORKFLOW_PERSISTED: z.number().int().min(0).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
  CURRENT_WEBSITE_EVIDENCE_PERSISTED: z.number().int().min(0).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
  ASSESSMENT_PERSISTED: z.number().int().min(0).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
  CONTACT_REVIEW_PERSISTED: z.number().int().min(0).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
  OWNER_DOSSIER_ACCEPTED: z.number().int().min(0).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
}).strict();

const PrivateKwShadowSliceProgressCoreSchema = z.object({
  progressVersion: z.literal(PRIVATE_KW_SHADOW_PROGRESS_VERSION),
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  sliceKey: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  parentCheckpoint: z.object({
    checkpointId: z.string().regex(/^kw-shadow-progress:[a-f0-9]{64}$/),
    checkpointDigest: Sha256Schema,
  }).strict().nullable(),
  createdAt: TimestampSchema,
  records: z.array(ProgressRecordSchema).length(PRIVATE_KW_SHADOW_SLICE_SIZE),
  summary: z.object({
    selectedBusinesses: z.literal(PRIVATE_KW_SHADOW_SLICE_SIZE),
    completedPhaseReceipts: z.number().int().min(0).max(PRIVATE_KW_SHADOW_SLICE_SIZE * PRIVATE_KW_SHADOW_PROGRESS_PHASES.length),
    fullyCompletedBusinesses: z.number().int().min(0).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
    countsByCheckpoint: CheckpointCountsSchema,
    nextIncompleteBusinessId: IdentitySchema.nullable(),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
  authority: ProgressAuthoritySchema,
}).strict();

export const PrivateKwShadowSliceProgressCheckpointSchema = PrivateKwShadowSliceProgressCoreSchema.extend({
  checkpointId: z.string().regex(/^kw-shadow-progress:[a-f0-9]{64}$/),
  checkpointDigest: Sha256Schema,
}).strict().superRefine((checkpoint, context) => {
  const { checkpointId: _id, checkpointDigest: _digest, ...core } = checkpoint;
  void _id;
  void _digest;
  const expectedDigest = privateKwShadowSliceProgressDigest(core);
  if (checkpoint.checkpointDigest !== expectedDigest || checkpoint.checkpointId !== `kw-shadow-progress:${expectedDigest}`) {
    context.addIssue({ code: "custom", message: "Progress checkpoint identity must bind every exact business receipt.", path: ["checkpointDigest"] });
  }
  const businessIds = checkpoint.records.map((record) => record.businessId);
  if (new Set(businessIds).size !== businessIds.length) {
    context.addIssue({ code: "custom", message: "Progress checkpoint business identities must be unique.", path: ["records"] });
  }
  const phaseReceiptIds: string[] = [];
  const primaryReceiptIds: string[] = [];
  checkpoint.records.forEach((record, recordIndex) => {
    record.phaseReceipts.forEach((receipt, receiptIndex) => {
      phaseReceiptIds.push(receipt.phaseReceiptId);
      primaryReceiptIds.push(receipt.proof.primaryReceiptId);
      const definition = PRIVATE_KW_SHADOW_PROGRESS_PHASES[receiptIndex];
      const previous = record.phaseReceipts[receiptIndex - 1];
      if (
        !definition
        || receipt.phase !== definition.phase
        || receipt.phaseOrder !== receiptIndex + 1
        || receipt.manifestId !== checkpoint.manifestId
        || receipt.manifestDigest !== checkpoint.manifestDigest
        || receipt.businessId !== record.businessId
        || receipt.evaluationCandidateId !== record.evaluationCandidateId
        || (receiptIndex === 0
          ? receipt.previousPhaseReceipt !== null
          : receipt.previousPhaseReceipt?.phaseReceiptId !== previous?.phaseReceiptId
            || receipt.previousPhaseReceipt?.phaseReceiptDigest !== previous?.phaseReceiptDigest)
      ) {
        context.addIssue({ code: "custom", message: "Every business must contain one exact ordered predecessor-bound phase prefix.", path: ["records", recordIndex, "phaseReceipts", receiptIndex] });
      }
    });
    const expectedState = progressStateForCount(record.phaseReceipts.length);
    if (record.currentCheckpoint !== expectedState.currentCheckpoint || record.nextRequiredGate !== expectedState.nextRequiredGate) {
      context.addIssue({ code: "custom", message: "Business progress state must derive from its exact receipt prefix.", path: ["records", recordIndex] });
    }
  });
  if (new Set(phaseReceiptIds).size !== phaseReceiptIds.length || new Set(primaryReceiptIds).size !== primaryReceiptIds.length) {
    context.addIssue({ code: "custom", message: "Phase and primary upstream receipt identities cannot be reused across businesses.", path: ["records"] });
  }
  const expectedSummary = progressSummary(checkpoint.records);
  if (privateKwShadowSliceProgressDigest(checkpoint.summary) !== privateKwShadowSliceProgressDigest(expectedSummary)) {
    context.addIssue({ code: "custom", message: "Progress summary must derive from the exact ten business states.", path: ["summary"] });
  }
});

export type PrivateKwShadowSliceProgressCheckpoint = z.infer<
  typeof PrivateKwShadowSliceProgressCheckpointSchema
>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function privateKwShadowSliceProgressDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

export function privateKwShadowSliceProgressAuthority() {
  return {
    progressRecordingOnly: true as const,
    phaseExecutionAuthorized: false as const,
    liveSourceAuthorized: false as const,
    browserCaptureAuthorized: false as const,
    artifactStorageAuthorized: false as const,
    databaseMutationAuthorized: false as const,
    contactDiscoveryExecutionAuthorized: false as const,
    contactVerificationExecutionAuthorized: false as const,
    consentDecisionAuthorized: false as const,
    qualificationAuthorized: false as const,
    mailboxSyncAuthorized: false as const,
    outreachAuthorized: false as const,
    sendAuthorized: false as const,
    deploymentAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
}

function progressStateForCount(count: number) {
  if (count === 0) {
    return {
      currentCheckpoint: "SOURCE_REVIEWED" as const,
      nextRequiredGate: "SOURCE_WORKFLOW_MATERIALIZATION_APPROVAL" as const,
    };
  }
  const definition = PRIVATE_KW_SHADOW_PROGRESS_PHASES[count - 1];
  if (!definition) throw new Error("A business cannot contain more than five integration receipts.");
  return {
    currentCheckpoint: definition.completedCheckpoint,
    nextRequiredGate: definition.nextRequiredGate,
  };
}

function progressSummary(records: readonly z.infer<typeof ProgressRecordSchema>[]) {
  const checkpoints = ProgressCheckpointSchema.options;
  const countsByCheckpoint = Object.fromEntries(
    checkpoints.map((checkpoint) => [checkpoint, records.filter((record) => record.currentCheckpoint === checkpoint).length]),
  ) as z.infer<typeof CheckpointCountsSchema>;
  return {
    selectedBusinesses: PRIVATE_KW_SHADOW_SLICE_SIZE as 10,
    completedPhaseReceipts: records.reduce((total, record) => total + record.phaseReceipts.length, 0),
    fullyCompletedBusinesses: records.filter((record) => record.phaseReceipts.length === PRIVATE_KW_SHADOW_PROGRESS_PHASES.length).length,
    countsByCheckpoint,
    nextIncompleteBusinessId: records.find((record) => record.phaseReceipts.length < PRIVATE_KW_SHADOW_PROGRESS_PHASES.length)?.businessId ?? null,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
}

function buildCheckpoint(core: z.infer<typeof PrivateKwShadowSliceProgressCoreSchema>) {
  const parsed = PrivateKwShadowSliceProgressCoreSchema.parse(core);
  const checkpointDigest = privateKwShadowSliceProgressDigest(parsed);
  return PrivateKwShadowSliceProgressCheckpointSchema.parse({
    ...parsed,
    checkpointId: `kw-shadow-progress:${checkpointDigest}`,
    checkpointDigest,
  });
}

function assertCheckpointMatchesManifest(
  manifest: PrivateKwShadowSliceManifest,
  checkpoint: PrivateKwShadowSliceProgressCheckpoint,
) {
  if (
    checkpoint.manifestId !== manifest.manifestId
    || checkpoint.manifestDigest !== manifest.manifestDigest
    || checkpoint.sliceKey !== manifest.sliceKey
    || checkpoint.sourcePlanDigest !== manifest.sourcePlanDigest
  ) {
    throw new Error("Progress checkpoint does not bind the exact shadow-slice manifest.");
  }
  const expectedRecords = manifest.records.map((record) => ({
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    sourceRecordId: record.sourceRecordId,
  }));
  const actualRecords = checkpoint.records.map((record) => ({
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    sourceRecordId: record.sourceRecordId,
  }));
  if (privateKwShadowSliceProgressDigest(actualRecords) !== privateKwShadowSliceProgressDigest(expectedRecords)) {
    throw new Error("Progress checkpoint business scope has drifted from the reviewed manifest.");
  }
}

export function buildInitialPrivateKwShadowSliceProgress(
  manifestValue: PrivateKwShadowSliceManifest,
): PrivateKwShadowSliceProgressCheckpoint {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestValue);
  const records = manifest.records.map((record) => ({
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    sourceRecordId: record.sourceRecordId,
    phaseReceipts: [],
    currentCheckpoint: "SOURCE_REVIEWED" as const,
    nextRequiredGate: "SOURCE_WORKFLOW_MATERIALIZATION_APPROVAL" as const,
  }));
  return buildCheckpoint({
    progressVersion: PRIVATE_KW_SHADOW_PROGRESS_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    sliceKey: manifest.sliceKey,
    sourcePlanDigest: manifest.sourcePlanDigest,
    parentCheckpoint: null,
    createdAt: manifest.createdAt,
    records,
    summary: progressSummary(records),
    authority: privateKwShadowSliceProgressAuthority(),
  });
}

export function buildPrivateKwShadowSlicePhaseReceipt(
  manifestValue: PrivateKwShadowSliceManifest,
  inputValue: PrivateKwShadowSlicePhaseReceiptInput,
): PrivateKwShadowSlicePhaseReceipt {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestValue);
  const input = PrivateKwShadowSlicePhaseReceiptInputSchema.parse(inputValue);
  if (input.manifestId !== manifest.manifestId || input.manifestDigest !== manifest.manifestDigest) {
    throw new Error("Phase receipt does not bind the exact shadow-slice manifest.");
  }
  const record = manifest.records.find((candidate) => candidate.businessId === input.businessId);
  if (!record || record.evaluationCandidateId !== input.evaluationCandidateId) {
    throw new Error("Phase receipt does not identify one exact manifest business.");
  }
  if (Date.parse(input.completedAt) < Date.parse(manifest.createdAt)) {
    throw new Error("A phase cannot complete before the reviewed shadow-slice manifest exists.");
  }
  const phaseOrder = PRIVATE_KW_SHADOW_PROGRESS_PHASES.findIndex((item) => item.phase === input.phase) + 1;
  const definition = PRIVATE_KW_SHADOW_PROGRESS_PHASES[phaseOrder - 1]!;
  const core = PrivateKwShadowSlicePhaseReceiptCoreSchema.parse({
    ...input,
    phaseOrder,
    completedCheckpoint: definition.completedCheckpoint,
    nextRequiredGate: definition.nextRequiredGate,
  });
  const phaseReceiptDigest = privateKwShadowSliceProgressDigest(core);
  return PrivateKwShadowSlicePhaseReceiptSchema.parse({
    ...core,
    phaseReceiptId: `kw-shadow-phase:${phaseReceiptDigest}`,
    phaseReceiptDigest,
  });
}

export function appendPrivateKwShadowSliceProgress(
  manifestValue: PrivateKwShadowSliceManifest,
  previousValue: PrivateKwShadowSliceProgressCheckpoint,
  inputValue: PrivateKwShadowSlicePhaseReceiptInput,
): PrivateKwShadowSliceProgressCheckpoint {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestValue);
  const previous = PrivateKwShadowSliceProgressCheckpointSchema.parse(previousValue);
  assertCheckpointMatchesManifest(manifest, previous);
  const phaseReceipt = buildPrivateKwShadowSlicePhaseReceipt(manifest, inputValue);
  if (Date.parse(phaseReceipt.recordedAt) < Date.parse(previous.createdAt)) {
    throw new Error("A progress checkpoint cannot move backwards in time.");
  }
  const targetIndex = previous.records.findIndex((record) => record.businessId === phaseReceipt.businessId);
  if (targetIndex < 0) throw new Error("Phase receipt business is outside the reviewed manifest.");
  const target = previous.records[targetIndex];
  const expectedPhase = PRIVATE_KW_SHADOW_PROGRESS_PHASES[target.phaseReceipts.length];
  if (!expectedPhase || phaseReceipt.phase !== expectedPhase.phase) {
    throw new Error("Business phases must complete once in their fixed order.");
  }
  const predecessor = target.phaseReceipts.at(-1) ?? null;
  if (
    (predecessor === null) !== (phaseReceipt.previousPhaseReceipt === null)
    || (predecessor !== null && (
      phaseReceipt.previousPhaseReceipt?.phaseReceiptId !== predecessor.phaseReceiptId
      || phaseReceipt.previousPhaseReceipt?.phaseReceiptDigest !== predecessor.phaseReceiptDigest
    ))
  ) {
    throw new Error("Phase receipt predecessor does not match the business's exact current checkpoint.");
  }
  if (predecessor && (
    Date.parse(phaseReceipt.completedAt) < Date.parse(predecessor.completedAt)
    || Date.parse(phaseReceipt.recordedAt) < Date.parse(predecessor.recordedAt)
  )) {
    throw new Error("A business phase cannot predate its exact predecessor receipt.");
  }
  if (previous.records.some((record) => record.phaseReceipts.some((receipt) => (
    receipt.phaseReceiptId === phaseReceipt.phaseReceiptId
    || receipt.proof.primaryReceiptId === phaseReceipt.proof.primaryReceiptId
  )))) {
    throw new Error("An upstream or normalized phase receipt cannot be recorded twice.");
  }

  const records = previous.records.map((record, index) => {
    if (index !== targetIndex) return record;
    const phaseReceipts = [...record.phaseReceipts, phaseReceipt];
    return { ...record, phaseReceipts, ...progressStateForCount(phaseReceipts.length) };
  });
  return buildCheckpoint({
    progressVersion: PRIVATE_KW_SHADOW_PROGRESS_VERSION,
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    sliceKey: manifest.sliceKey,
    sourcePlanDigest: manifest.sourcePlanDigest,
    parentCheckpoint: {
      checkpointId: previous.checkpointId,
      checkpointDigest: previous.checkpointDigest,
    },
    createdAt: phaseReceipt.recordedAt,
    records,
    summary: progressSummary(records),
    authority: privateKwShadowSliceProgressAuthority(),
  });
}
