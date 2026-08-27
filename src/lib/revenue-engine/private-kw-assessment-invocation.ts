import { z } from "zod";

import {
  PrivateKwImportPlanSchema,
  type PrivateKwImportPlan,
} from "@/lib/revenue-engine/private-kw-import";
import {
  buildPrivateKwPersistencePlan,
} from "@/lib/revenue-engine/private-kw-persistence-plan";
import {
  REVENUE_LEAD_ASSESSMENT_VERSION,
  RevenueLeadAssessmentRequestSchema,
  RevenueQualificationBasisClaimSchema,
  revenueLeadAssessmentDigest,
} from "@/lib/revenue-engine/lead-assessment";

export const PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION = "kw-private-assessment-invocation-v1";
export const PRIVATE_KW_ASSESSMENT_APPROVAL_CONFIRMATION =
  "I APPROVE THIS KW RECORD FOR LOCAL SHADOW ASSESSMENT ONLY";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const PolicyBlockSchema = z.enum([
  "DUPLICATE",
  "LEGAL_OR_POLICY",
  "OWNER_REJECTED",
  "OUTSIDE_TARGET_MARKET",
]);

export const PrivateKwAssessmentInvocationInputSchema = z.object({
  invocationVersion: z.literal(PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION),
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(80),
  evaluationCandidateId: z.string().trim().min(1).max(80),
  workflowReceiptId: z.string().trim().min(1).max(200),
  assessedAt: TimestampSchema,
  businessFitScore: z.number().int().min(0).max(100),
  timingScore: z.number().int().min(0).max(100),
  basisClaims: z.array(RevenueQualificationBasisClaimSchema).min(2).max(20),
  policyBlocks: z.array(PolicyBlockSchema).max(10),
  approval: z.object({
    decision: z.literal("APPROVED_FOR_LOCAL_SHADOW_ASSESSMENT"),
    reviewedBy: z.enum(["RILEY", "AIDAN"]),
    reviewedAt: TimestampSchema,
    rationale: z.string().trim().min(10).max(500),
    confirmation: z.literal(PRIVATE_KW_ASSESSMENT_APPROVAL_CONFIRMATION),
  }).strict(),
  mode: z.literal("SHADOW"),
  localAssessmentMutationAuthorized: z.literal(true),
  sourceMutationAuthorized: z.literal(false),
  workflowMutationAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((input, context) => {
  if (input.approval.reviewedAt !== input.assessedAt) {
    context.addIssue({
      code: "custom",
      message: "Owner approval must bind the exact assessment timestamp.",
      path: ["approval", "reviewedAt"],
    });
  }
  if (new Set(input.policyBlocks).size !== input.policyBlocks.length) {
    context.addIssue({ code: "custom", message: "Policy blocks must be unique.", path: ["policyBlocks"] });
  }
});

export type PrivateKwAssessmentInvocationInput = z.infer<typeof PrivateKwAssessmentInvocationInputSchema>;

export const PrivateKwAssessmentInvocationSchema = z.object({
  invocationVersion: z.literal(PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION),
  invocationId: z.string().regex(/^kw-assessment-invocation:[a-f0-9]{64}$/),
  invocationDigest: Sha256Schema,
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(80),
  evaluationCandidateId: z.string().trim().min(1).max(80),
  sourceEvidenceUrl: z.string().url().max(2_048),
  request: RevenueLeadAssessmentRequestSchema,
  approval: PrivateKwAssessmentInvocationInputSchema.shape.approval,
  authority: z.object({
    executionKind: z.literal("IGNORED_LOCAL_SQLITE"),
    localAssessmentMutationAuthorized: z.literal(true),
    sourceMutationAuthorized: z.literal(false),
    workflowMutationAuthorized: z.literal(false),
    contactDiscoveryAuthorized: z.literal(false),
    outreachAuthorized: z.literal(false),
    sendAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
}).strict();

export type PrivateKwAssessmentInvocation = z.infer<typeof PrivateKwAssessmentInvocationSchema>;

export function privateKwAssessmentIdempotencyKey(input: {
  sourcePlanDigest: string;
  businessId: string;
  workflowReceiptId: string;
}) {
  return `kw-shadow-assessment:${revenueLeadAssessmentDigest(input)}`;
}

export function buildPrivateKwAssessmentInvocation(
  sourceValue: PrivateKwImportPlan,
  inputValue: PrivateKwAssessmentInvocationInput,
): PrivateKwAssessmentInvocation {
  const source = PrivateKwImportPlanSchema.parse(sourceValue);
  const input = PrivateKwAssessmentInvocationInputSchema.parse(inputValue);
  const persistencePlan = buildPrivateKwPersistencePlan(source);
  if (input.sourceImportId !== source.importId || input.sourcePlanDigest !== persistencePlan.sourcePlanDigest) {
    throw new Error("Assessment approval does not bind the exact private KW source plan.");
  }
  const selected = source.records.find((record) => record.business.id === input.businessId);
  if (!selected || selected.evaluationCandidateId !== input.evaluationCandidateId) {
    throw new Error("Assessment approval does not identify one exact KW evaluation candidate.");
  }
  const allowedBasisUrls = new Set([
    selected.sourceRecord.sourceEvidenceUrl,
    ...(selected.sourceRecord.websiteUrl ? [selected.sourceRecord.websiteUrl] : []),
  ]);
  if (input.basisClaims.some((claim) => !allowedBasisUrls.has(claim.sourceUrl))) {
    throw new Error("Qualification basis must come from the approved source record or its canonical website.");
  }

  const request = RevenueLeadAssessmentRequestSchema.parse({
    assessmentVersion: REVENUE_LEAD_ASSESSMENT_VERSION,
    idempotencyKey: privateKwAssessmentIdempotencyKey({
      sourcePlanDigest: input.sourcePlanDigest,
      businessId: input.businessId,
      workflowReceiptId: input.workflowReceiptId,
    }),
    workflowReceiptId: input.workflowReceiptId,
    assessedAt: input.assessedAt,
    mode: input.mode,
    businessFitScore: input.businessFitScore,
    timingScore: input.timingScore,
    basisClaims: input.basisClaims,
    policyBlocks: input.policyBlocks,
  });
  const authority = {
    executionKind: "IGNORED_LOCAL_SQLITE" as const,
    localAssessmentMutationAuthorized: true as const,
    sourceMutationAuthorized: false as const,
    workflowMutationAuthorized: false as const,
    contactDiscoveryAuthorized: false as const,
    outreachAuthorized: false as const,
    sendAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
  const core = {
    invocationVersion: input.invocationVersion,
    sourceImportId: input.sourceImportId,
    sourcePlanDigest: input.sourcePlanDigest,
    businessId: input.businessId,
    evaluationCandidateId: input.evaluationCandidateId,
    sourceEvidenceUrl: selected.sourceRecord.sourceEvidenceUrl,
    request,
    approval: input.approval,
    authority,
  };
  const invocationDigest = revenueLeadAssessmentDigest(core);
  return PrivateKwAssessmentInvocationSchema.parse({
    ...core,
    invocationId: `kw-assessment-invocation:${invocationDigest}`,
    invocationDigest,
  });
}
