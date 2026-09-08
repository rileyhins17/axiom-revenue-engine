import { createHash } from "node:crypto";

import { z } from "zod";

import {
  KwEvaluationCitySchema,
  KwEvaluationNicheSchema,
} from "@/lib/revenue-engine/lead-quality-evaluation";
import {
  PrivateKwImportPlanSchema,
  type PrivateKwImportPlan,
} from "@/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "@/lib/revenue-engine/private-kw-persistence-plan";

export const PRIVATE_KW_SHADOW_SLICE_VERSION = "kw-shadow-slice-v1";
export const PRIVATE_KW_SHADOW_SLICE_SIZE = 10;
export const PRIVATE_KW_SHADOW_SOURCE_MAX_AGE_DAYS = 90;

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const OwnerSourceReviewSchema = z.object({
  decision: z.literal("APPROVED_FOR_BOUNDED_SHADOW_SLICE"),
  reviewedBy: z.enum(["RILEY", "AIDAN"]),
  reviewedAt: TimestampSchema,
  rationale: z.string().trim().min(10).max(500),
  identityConfirmed: z.literal(true),
  marketAndNicheConfirmed: z.literal(true),
  independenceConfirmed: z.literal(true),
}).strict();

const ShadowSliceSelectionSchema = z.object({
  businessId: z.string().trim().min(1).max(128),
  evaluationCandidateId: z.string().trim().min(1).max(128),
  sourceReview: OwnerSourceReviewSchema,
}).strict();

const ShadowSliceAuthoritySchema = z.object({
  planOnly: z.literal(true),
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

export const PrivateKwShadowSliceInputSchema = z.object({
  sliceVersion: z.literal(PRIVATE_KW_SHADOW_SLICE_VERSION),
  sliceKey: z.string().trim().min(8).max(128).regex(/^[a-z0-9][a-z0-9._-]+$/),
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  createdAt: TimestampSchema,
  selections: z.array(ShadowSliceSelectionSchema).length(PRIVATE_KW_SHADOW_SLICE_SIZE),
  mode: z.literal("SHADOW"),
  authority: ShadowSliceAuthoritySchema,
}).strict().superRefine((input, context) => {
  const businessIds = new Set(input.selections.map((selection) => selection.businessId));
  const candidateIds = new Set(input.selections.map((selection) => selection.evaluationCandidateId));
  if (businessIds.size !== input.selections.length || candidateIds.size !== input.selections.length) {
    context.addIssue({
      code: "custom",
      message: "The shadow slice requires ten unique businesses and evaluation candidates.",
      path: ["selections"],
    });
  }
});

export type PrivateKwShadowSliceInput = z.infer<typeof PrivateKwShadowSliceInputSchema>;

const ShadowSlicePhaseSchema = z.object({
  order: z.number().int().min(1).max(5),
  phase: z.enum([
    "SOURCE_WORKFLOW",
    "CURRENT_WEBSITE_EVIDENCE",
    "ASSESSMENT",
    "CONTACT_REVIEW",
    "OWNER_DOSSIER",
  ]),
  boundary: z.enum([
    "EXISTING_IGNORED_LOCAL_GATE",
    "SEPARATE_CAPTURE_PRIVACY_BUDGET_GATE",
    "EXISTING_READ_ONLY_OWNER_GATE",
  ]),
  completionProof: z.enum([
    "SEALED_MATERIALIZATION_AND_WORKFLOW_RECEIPTS",
    "CURRENT_DESKTOP_MOBILE_EVIDENCE_WITH_PROVENANCE",
    "IMMUTABLE_ASSESSMENT_RECEIPT",
    "OWNER_REVIEW_AND_CONTACT_INVOCATION_RECEIPT",
    "READ_ONLY_DESKTOP_AND_MOBILE_ACCEPTANCE",
  ]),
  requiresSeparateApproval: z.literal(true),
  authorizedByThisManifest: z.literal(false),
}).strict();

const ShadowSliceRecordSchema = z.object({
  businessId: z.string().trim().min(1).max(128),
  evaluationCandidateId: z.string().trim().min(1).max(128),
  sourceRecordId: z.string().trim().min(1).max(128),
  businessName: z.string().trim().min(1).max(256),
  city: KwEvaluationCitySchema,
  niche: KwEvaluationNicheSchema,
  sourceEvidenceUrl: z.string().url().max(2_048),
  websiteUrl: z.string().url().max(2_048).nullable(),
  sourceCapturedAt: TimestampSchema,
  independenceStatus: z.literal("INDEPENDENT"),
  sourceReview: OwnerSourceReviewSchema,
  currentCheckpoint: z.literal("SOURCE_REVIEWED"),
  nextRequiredGate: z.literal("SOURCE_WORKFLOW_MATERIALIZATION_APPROVAL"),
}).strict();

export const PrivateKwShadowSliceManifestSchema = z.object({
  sliceVersion: z.literal(PRIVATE_KW_SHADOW_SLICE_VERSION),
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  sliceKey: z.string().trim().min(8).max(128),
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  market: z.literal("KITCHENER_WATERLOO_CAMBRIDGE"),
  createdAt: TimestampSchema,
  records: z.array(ShadowSliceRecordSchema).length(PRIVATE_KW_SHADOW_SLICE_SIZE),
  phases: z.array(ShadowSlicePhaseSchema).length(5),
  summary: z.object({
    selectedBusinesses: z.literal(PRIVATE_KW_SHADOW_SLICE_SIZE),
    countsByCity: z.object({
      KITCHENER: z.number().int().min(2).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
      WATERLOO: z.number().int().min(2).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
      CAMBRIDGE: z.number().int().min(2).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
    }).strict(),
    countsByNiche: z.object({
      ROOFING: z.number().int().min(2).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
      HVAC: z.number().int().min(2).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
      LANDSCAPING: z.number().int().min(2).max(PRIVATE_KW_SHADOW_SLICE_SIZE),
    }).strict(),
    manuallyReviewed: z.literal(PRIVATE_KW_SHADOW_SLICE_SIZE),
    independentBusinesses: z.literal(PRIVATE_KW_SHADOW_SLICE_SIZE),
    currentCheckpoint: z.literal("SOURCE_REVIEWED"),
    nextRequiredGate: z.literal("SOURCE_WORKFLOW_MATERIALIZATION_APPROVAL"),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
  authority: ShadowSliceAuthoritySchema,
}).strict().superRefine((manifest, context) => {
  const { manifestId: _manifestId, manifestDigest: _manifestDigest, ...core } = manifest;
  void _manifestId;
  void _manifestDigest;
  const expectedDigest = privateKwShadowSliceDigest(core);
  if (
    manifest.manifestDigest !== expectedDigest
    || manifest.manifestId !== `kw-shadow-slice:${expectedDigest}`
  ) {
    context.addIssue({
      code: "custom",
      message: "The shadow-slice identity must bind the exact reviewed manifest.",
      path: ["manifestDigest"],
    });
  }
  const businessIds = new Set(manifest.records.map((record) => record.businessId));
  const candidateIds = new Set(manifest.records.map((record) => record.evaluationCandidateId));
  const sourceRecordIds = new Set(manifest.records.map((record) => record.sourceRecordId));
  if (
    businessIds.size !== manifest.records.length
    || candidateIds.size !== manifest.records.length
    || sourceRecordIds.size !== manifest.records.length
  ) {
    context.addIssue({
      code: "custom",
      message: "Manifest business, candidate, and source-record identities must be unique.",
      path: ["records"],
    });
  }
  if (manifest.phases.some((phase, index) => phase.order !== index + 1)) {
    context.addIssue({
      code: "custom",
      message: "Shadow-slice phases must remain in their required order.",
      path: ["phases"],
    });
  }
  if (privateKwShadowSliceDigest(manifest.phases) !== privateKwShadowSliceDigest(SHADOW_SLICE_PHASES)) {
    context.addIssue({
      code: "custom",
      message: "Shadow-slice phases must match the fixed integration contract.",
      path: ["phases"],
    });
  }
  const countsByCity = countBy(manifest.records.map((record) => record.city), KwEvaluationCitySchema.options);
  const countsByNiche = countBy(manifest.records.map((record) => record.niche), KwEvaluationNicheSchema.options);
  if (
    privateKwShadowSliceDigest(manifest.summary.countsByCity) !== privateKwShadowSliceDigest(countsByCity)
    || privateKwShadowSliceDigest(manifest.summary.countsByNiche) !== privateKwShadowSliceDigest(countsByNiche)
  ) {
    context.addIssue({
      code: "custom",
      message: "Shadow-slice summary counts must match the exact records.",
      path: ["summary"],
    });
  }
  const createdAt = Date.parse(manifest.createdAt);
  const maxSourceAgeMs = PRIVATE_KW_SHADOW_SOURCE_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000;
  manifest.records.forEach((record, index) => {
    const capturedAt = Date.parse(record.sourceCapturedAt);
    const reviewedAt = Date.parse(record.sourceReview.reviewedAt);
    if (
      capturedAt > reviewedAt
      || reviewedAt > createdAt
      || createdAt - capturedAt > maxSourceAgeMs
    ) {
      context.addIssue({
        code: "custom",
        message: "Every manifest record requires current source evidence reviewed before manifest creation.",
        path: ["records", index],
      });
    }
  });
});

export type PrivateKwShadowSliceManifest = z.infer<typeof PrivateKwShadowSliceManifestSchema>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

export function privateKwShadowSliceDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

const SHADOW_SLICE_PHASES = [
  {
    order: 1,
    phase: "SOURCE_WORKFLOW",
    boundary: "EXISTING_IGNORED_LOCAL_GATE",
    completionProof: "SEALED_MATERIALIZATION_AND_WORKFLOW_RECEIPTS",
    requiresSeparateApproval: true,
    authorizedByThisManifest: false,
  },
  {
    order: 2,
    phase: "CURRENT_WEBSITE_EVIDENCE",
    boundary: "SEPARATE_CAPTURE_PRIVACY_BUDGET_GATE",
    completionProof: "CURRENT_DESKTOP_MOBILE_EVIDENCE_WITH_PROVENANCE",
    requiresSeparateApproval: true,
    authorizedByThisManifest: false,
  },
  {
    order: 3,
    phase: "ASSESSMENT",
    boundary: "EXISTING_IGNORED_LOCAL_GATE",
    completionProof: "IMMUTABLE_ASSESSMENT_RECEIPT",
    requiresSeparateApproval: true,
    authorizedByThisManifest: false,
  },
  {
    order: 4,
    phase: "CONTACT_REVIEW",
    boundary: "EXISTING_IGNORED_LOCAL_GATE",
    completionProof: "OWNER_REVIEW_AND_CONTACT_INVOCATION_RECEIPT",
    requiresSeparateApproval: true,
    authorizedByThisManifest: false,
  },
  {
    order: 5,
    phase: "OWNER_DOSSIER",
    boundary: "EXISTING_READ_ONLY_OWNER_GATE",
    completionProof: "READ_ONLY_DESKTOP_AND_MOBILE_ACCEPTANCE",
    requiresSeparateApproval: true,
    authorizedByThisManifest: false,
  },
] as const;

function countBy<T extends string>(values: readonly T[], options: readonly T[]) {
  return Object.fromEntries(options.map((option) => [option, values.filter((value) => value === option).length]));
}

export function buildPrivateKwShadowSliceManifest(
  sourceValue: PrivateKwImportPlan,
  inputValue: PrivateKwShadowSliceInput,
): PrivateKwShadowSliceManifest {
  const source = PrivateKwImportPlanSchema.parse(sourceValue);
  const input = PrivateKwShadowSliceInputSchema.parse(inputValue);
  const sourcePersistence = buildPrivateKwPersistencePlan(source);
  if (
    input.sourceImportId !== source.importId
    || input.sourcePlanDigest !== sourcePersistence.sourcePlanDigest
  ) {
    throw new Error("Shadow slice does not bind the exact private KW source plan.");
  }

  const createdAt = Date.parse(input.createdAt);
  const maxSourceAgeMs = PRIVATE_KW_SHADOW_SOURCE_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000;
  const records = [...input.selections]
    .sort((left, right) => left.businessId.localeCompare(right.businessId, "en-CA"))
    .map((selection) => {
      const record = source.records.find((candidate) => candidate.business.id === selection.businessId);
      if (!record || record.evaluationCandidateId !== selection.evaluationCandidateId) {
        throw new Error("Every shadow-slice selection must identify one exact source candidate.");
      }
      if (record.business.independenceStatus !== "INDEPENDENT") {
        throw new Error("The bounded KW shadow slice accepts only manually confirmed independent businesses.");
      }
      const capturedAt = Date.parse(record.sourceRecord.capturedAt);
      const reviewedAt = Date.parse(selection.sourceReview.reviewedAt);
      if (capturedAt > reviewedAt || reviewedAt > createdAt) {
        throw new Error("Source review must follow source capture and cannot occur after manifest creation.");
      }
      if (createdAt - capturedAt > maxSourceAgeMs) {
        throw new Error(`Shadow-slice source evidence must be no more than ${PRIVATE_KW_SHADOW_SOURCE_MAX_AGE_DAYS} days old.`);
      }
      return {
        businessId: record.business.id,
        evaluationCandidateId: record.evaluationCandidateId,
        sourceRecordId: record.sourceRecord.id,
        businessName: record.business.canonicalName,
        city: record.location.city,
        niche: record.niche,
        sourceEvidenceUrl: record.sourceRecord.sourceEvidenceUrl,
        websiteUrl: record.sourceRecord.websiteUrl,
        sourceCapturedAt: record.sourceRecord.capturedAt,
        independenceStatus: "INDEPENDENT" as const,
        sourceReview: selection.sourceReview,
        currentCheckpoint: "SOURCE_REVIEWED" as const,
        nextRequiredGate: "SOURCE_WORKFLOW_MATERIALIZATION_APPROVAL" as const,
      };
    });

  const countsByCity = countBy(records.map((record) => record.city), KwEvaluationCitySchema.options);
  const countsByNiche = countBy(records.map((record) => record.niche), KwEvaluationNicheSchema.options);
  if (
    Object.values(countsByCity).some((count) => count < 2)
    || Object.values(countsByNiche).some((count) => count < 2)
  ) {
    throw new Error("The ten-business slice requires at least two businesses from every pilot city and niche.");
  }

  const core = {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION,
    sliceKey: input.sliceKey,
    sourceImportId: input.sourceImportId,
    sourcePlanDigest: input.sourcePlanDigest,
    market: "KITCHENER_WATERLOO_CAMBRIDGE" as const,
    createdAt: input.createdAt,
    records,
    phases: SHADOW_SLICE_PHASES,
    summary: {
      selectedBusinesses: PRIVATE_KW_SHADOW_SLICE_SIZE as 10,
      countsByCity,
      countsByNiche,
      manuallyReviewed: PRIVATE_KW_SHADOW_SLICE_SIZE as 10,
      independentBusinesses: PRIVATE_KW_SHADOW_SLICE_SIZE as 10,
      currentCheckpoint: "SOURCE_REVIEWED" as const,
      nextRequiredGate: "SOURCE_WORKFLOW_MATERIALIZATION_APPROVAL" as const,
      providerOperationsAuthorized: 0 as const,
      costAuthorizedUsd: 0 as const,
    },
    authority: input.authority,
  };
  const manifestDigest = privateKwShadowSliceDigest(core);
  return PrivateKwShadowSliceManifestSchema.parse({
    ...core,
    manifestId: `kw-shadow-slice:${manifestDigest}`,
    manifestDigest,
  });
}
