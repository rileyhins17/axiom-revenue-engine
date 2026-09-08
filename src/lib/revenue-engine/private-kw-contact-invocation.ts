import { z } from "zod";

import {
  REVENUE_CONTACT_DISCOVERY_VERSION,
  RevenueContactDiscoveryRequestSchema,
  RevenueContactDiscoveryResultSchema,
  RevenueContactObservationSchema,
  buildFixtureContactDiscoveryResult,
  contactDiscoveryCanonicalJson,
  contactDiscoveryDigest,
  normalizeRevenueContactValue,
} from "@/lib/revenue-engine/contact-discovery";
import { buildRevenueContactPersistencePlan } from "@/lib/revenue-engine/contact-persistence-plan";
import {
  REVENUE_CONTACT_VERIFICATION_VERSION,
  RevenueContactVerificationObservationSchema,
  RevenueContactVerificationRequestSchema,
  RevenueContactVerificationResultSchema,
  buildFixtureContactVerificationResult,
} from "@/lib/revenue-engine/contact-verification";
import {
  RevenueLeadAssessmentSchema,
  revenueLeadAssessmentCanonicalJson,
  revenueLeadAssessmentDigest,
  type RevenueLeadAssessment,
} from "@/lib/revenue-engine/lead-assessment";
import {
  PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION,
  PrivateKwContactPersistenceApprovalSchema,
  buildPrivateKwContactPersistencePlan,
} from "@/lib/revenue-engine/private-kw-contact-persistence";
import {
  PrivateKwImportPlanSchema,
  type PrivateKwImportPlan,
} from "@/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "@/lib/revenue-engine/private-kw-persistence-plan";

export const PRIVATE_KW_CONTACT_REVIEW_VERSION = "kw-private-contact-review-v1";
export const PRIVATE_KW_CONTACT_INVOCATION_VERSION = "kw-private-contact-invocation-v1";
export const PRIVATE_KW_CONTACT_INVOCATION_APPROVAL_VERSION = "kw-private-contact-invocation-approval-v1";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ChannelSchema = z.enum(["EMAIL", "PHONE", "FORM", "SOCIAL"]);

export const PrivateKwAssessmentReferenceSchema = z.object({
  assessmentReceiptId: z.string().regex(/^assessment:[a-f0-9]{64}$/),
  assessmentDigest: Sha256Schema,
  workflowReceiptId: z.string().trim().min(1).max(200),
  websiteSnapshotId: z.string().regex(/^website:[a-f0-9]{64}$/),
  qualificationSnapshotId: z.string().regex(/^qualification:[a-f0-9]{64}$/),
}).strict();
export type PrivateKwAssessmentReference = z.infer<typeof PrivateKwAssessmentReferenceSchema>;

const VerificationDraftSchema = z.object({
  candidate: z.object({
    channel: ChannelSchema,
    value: z.string().trim().min(1).max(2_048),
    socialPlatform: z.enum(["FACEBOOK", "INSTAGRAM", "LINKEDIN", "X"]).nullable(),
  }).strict(),
  requestedAt: TimestampSchema,
  completedAt: TimestampSchema,
  observation: RevenueContactVerificationObservationSchema,
}).strict();

export const PrivateKwContactReviewDraftSchema = z.object({
  reviewVersion: z.literal(PRIVATE_KW_CONTACT_REVIEW_VERSION),
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(80),
  evaluationCandidateId: z.string().trim().min(1).max(80),
  assessment: PrivateKwAssessmentReferenceSchema,
  discovery: z.object({
    requestedAt: TimestampSchema,
    completedAt: TimestampSchema,
    observations: z.array(RevenueContactObservationSchema).max(500),
  }).strict(),
  verifications: z.array(VerificationDraftSchema).max(25),
  mode: z.literal("SHADOW"),
  reviewOnly: z.literal(true),
  databaseMutationAuthorized: z.literal(false),
  contactDiscoveryExecutionAuthorized: z.literal(false),
  contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((draft, context) => {
  const identities = draft.verifications.map((item) => {
    try {
      return `${item.candidate.channel}|${normalizeRevenueContactValue(
        item.candidate.channel,
        item.candidate.value,
        item.candidate.socialPlatform,
      )}`;
    } catch {
      return `${item.candidate.channel}|${item.candidate.value}`;
    }
  });
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", message: "A review may contain only one verification per discovered candidate.", path: ["verifications"] });
  }
});
export type PrivateKwContactReviewDraft = z.infer<typeof PrivateKwContactReviewDraftSchema>;

const ReviewAuthoritySchema = z.object({
  reviewOnly: z.literal(true),
  databaseMutationAuthorized: z.literal(false),
  contactDiscoveryExecutionAuthorized: z.literal(false),
  contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export const PrivateKwContactReviewSchema = z.object({
  reviewVersion: z.literal(PRIVATE_KW_CONTACT_REVIEW_VERSION),
  reviewId: z.string().regex(/^kw-contact-review:[a-f0-9]{64}$/),
  reviewDigest: Sha256Schema,
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  business: z.object({
    id: z.string().trim().min(1).max(80),
    canonicalName: z.string().trim().min(1).max(256),
    city: z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]),
    niche: z.enum(["ROOFING", "HVAC", "LANDSCAPING"]),
  }).strict(),
  assessment: PrivateKwAssessmentReferenceSchema.extend({
    assessedAt: TimestampSchema,
    classification: z.enum(["REBUILD", "NO_SITE_NEW_BUILD", "MINOR_IMPROVEMENT", "NO_OPPORTUNITY"]),
    scores: z.object({
      rebuildNeed: z.number().int().min(0).max(100),
      businessFit: z.number().int().min(0).max(100),
      timing: z.number().int().min(0).max(100),
      evidenceConfidence: z.number().int().min(0).max(100),
    }).strict(),
  }).strict(),
  draft: PrivateKwContactReviewDraftSchema,
  discovery: RevenueContactDiscoveryResultSchema,
  verifications: z.array(RevenueContactVerificationResultSchema).max(25),
  summary: z.object({
    candidates: z.number().int().min(0).max(25),
    verificationResults: z.number().int().min(0).max(25),
    usableRoutes: z.number().int().min(0).max(25),
    emailReviewRoutes: z.number().int().min(0).max(25),
    manualRoutes: z.number().int().min(0).max(25),
    researchRoutes: z.number().int().min(0).max(25),
    consentBasis: z.literal("UNASSESSED"),
  }).strict(),
  authority: ReviewAuthoritySchema,
}).strict().superRefine((review, context) => {
  const { reviewId: _reviewId, reviewDigest: _reviewDigest, ...core } = review;
  void _reviewId;
  void _reviewDigest;
  const expected = contactDiscoveryDigest(core);
  if (review.reviewDigest !== expected || review.reviewId !== `kw-contact-review:${expected}`) {
    context.addIssue({ code: "custom", message: "Contact review identity must bind the exact reviewed evidence.", path: ["reviewDigest"] });
  }
});
export type PrivateKwContactReview = z.infer<typeof PrivateKwContactReviewSchema>;

export const PrivateKwContactInvocationApprovalSchema = z.object({
  approvalVersion: z.literal(PRIVATE_KW_CONTACT_INVOCATION_APPROVAL_VERSION),
  reviewId: z.string().regex(/^kw-contact-review:[a-f0-9]{64}$/),
  reviewDigest: Sha256Schema,
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(80),
  assessment: PrivateKwAssessmentReferenceSchema,
  persistenceApproval: PrivateKwContactPersistenceApprovalSchema,
  localInvocationReceiptAuthorized: z.literal(true),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();
export type PrivateKwContactInvocationApproval = z.infer<typeof PrivateKwContactInvocationApprovalSchema>;

export const PrivateKwContactInvocationSchema = z.object({
  invocationVersion: z.literal(PRIVATE_KW_CONTACT_INVOCATION_VERSION),
  invocationId: z.string().regex(/^kw-contact-invocation:[a-f0-9]{64}$/),
  invocationDigest: Sha256Schema,
  reviewId: z.string().regex(/^kw-contact-review:[a-f0-9]{64}$/),
  reviewDigest: Sha256Schema,
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(80),
  assessment: PrivateKwAssessmentReferenceSchema,
  review: PrivateKwContactReviewSchema,
  contactMaterializationId: z.string().regex(/^kw-contact-persistence:[a-f0-9]{64}$/),
  approval: PrivateKwContactInvocationApprovalSchema,
  authority: z.object({
    executionKind: z.literal("IGNORED_LOCAL_SQLITE"),
    localContactMutationAuthorized: z.literal(true),
    localVerificationMutationAuthorized: z.literal(true),
    localInvocationReceiptAuthorized: z.literal(true),
    sourceMutationAuthorized: z.literal(false),
    workflowMutationAuthorized: z.literal(false),
    assessmentMutationAuthorized: z.literal(false),
    schemaMutationAuthorized: z.literal(false),
    captureAuthorized: z.literal(false),
    contactDiscoveryExecutionAuthorized: z.literal(false),
    contactVerificationExecutionAuthorized: z.literal(false),
    consentDecisionAuthorized: z.literal(false),
    qualificationAuthorized: z.literal(false),
    outreachAuthorized: z.literal(false),
    sendAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
}).strict().superRefine((invocation, context) => {
  const { invocationId: _id, invocationDigest: _digest, ...core } = invocation;
  void _id;
  void _digest;
  const expected = contactDiscoveryDigest(core);
  if (invocation.invocationDigest !== expected || invocation.invocationId !== `kw-contact-invocation:${expected}`) {
    context.addIssue({ code: "custom", message: "Contact invocation identity must bind its exact review, approval, and lineage.", path: ["invocationDigest"] });
  }
});
export type PrivateKwContactInvocation = z.infer<typeof PrivateKwContactInvocationSchema>;

export const PrivateKwContactInvocationReceiptRowSchema = z.object({
  id: z.string().regex(/^kw-contact-invocation:[a-f0-9]{64}$/),
  invocationVersion: z.literal(PRIVATE_KW_CONTACT_INVOCATION_VERSION),
  invocationDigest: Sha256Schema,
  reviewId: z.string().regex(/^kw-contact-review:[a-f0-9]{64}$/),
  reviewDigest: Sha256Schema,
  sourcePlanDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(80),
  assessmentReceiptId: z.string().regex(/^assessment:[a-f0-9]{64}$/),
  assessmentDigest: Sha256Schema,
  materializationReceiptId: z.string().regex(/^kw-contact-persistence:[a-f0-9]{64}$/),
  discoveryReceiptId: z.string().regex(/^contact-discovery-result:[a-f0-9]{64}$/),
  invocationJson: z.string().min(2).max(8_388_608),
  reviewedBy: z.enum(["RILEY", "AIDAN"]),
  recordedAt: TimestampSchema,
  executionKind: z.literal("IGNORED_LOCAL_SQLITE"),
  localOnly: z.literal(1),
  localContactMutationAuthorized: z.literal(1),
  localVerificationMutationAuthorized: z.literal(1),
  localInvocationReceiptAuthorized: z.literal(1),
  sourceMutationAuthorized: z.literal(0),
  workflowMutationAuthorized: z.literal(0),
  assessmentMutationAuthorized: z.literal(0),
  schemaMutationAuthorized: z.literal(0),
  captureAuthorized: z.literal(0),
  contactDiscoveryExecutionAuthorized: z.literal(0),
  contactVerificationExecutionAuthorized: z.literal(0),
  consentDecisionAuthorized: z.literal(0),
  qualificationAuthorized: z.literal(0),
  outreachAuthorized: z.literal(0),
  sendAuthorized: z.literal(0),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();
export type PrivateKwContactInvocationReceiptRow = z.infer<
  typeof PrivateKwContactInvocationReceiptRowSchema
>;

export function buildPrivateKwContactInvocationReceiptRow(
  value: PrivateKwContactInvocation,
): PrivateKwContactInvocationReceiptRow {
  const invocation = PrivateKwContactInvocationSchema.parse(value);
  return PrivateKwContactInvocationReceiptRowSchema.parse({
    id: invocation.invocationId,
    invocationVersion: invocation.invocationVersion,
    invocationDigest: invocation.invocationDigest,
    reviewId: invocation.reviewId,
    reviewDigest: invocation.reviewDigest,
    sourcePlanDigest: invocation.sourcePlanDigest,
    businessId: invocation.businessId,
    assessmentReceiptId: invocation.assessment.assessmentReceiptId,
    assessmentDigest: invocation.assessment.assessmentDigest,
    materializationReceiptId: invocation.contactMaterializationId,
    discoveryReceiptId: invocation.review.discovery.discoveryResultId,
    invocationJson: revenueLeadAssessmentCanonicalJson(invocation),
    reviewedBy: invocation.approval.persistenceApproval.approval.reviewedBy,
    recordedAt: invocation.approval.persistenceApproval.approval.reviewedAt,
    executionKind: invocation.authority.executionKind,
    localOnly: 1,
    localContactMutationAuthorized: 1,
    localVerificationMutationAuthorized: 1,
    localInvocationReceiptAuthorized: 1,
    sourceMutationAuthorized: 0,
    workflowMutationAuthorized: 0,
    assessmentMutationAuthorized: 0,
    schemaMutationAuthorized: 0,
    captureAuthorized: 0,
    contactDiscoveryExecutionAuthorized: 0,
    contactVerificationExecutionAuthorized: 0,
    consentDecisionAuthorized: 0,
    qualificationAuthorized: 0,
    outreachAuthorized: 0,
    sendAuthorized: 0,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

function assertAssessmentIntegrity(assessment: RevenueLeadAssessment) {
  const { assessmentDigest, ...core } = assessment;
  if (
    assessmentDigest !== revenueLeadAssessmentDigest(core)
    || assessment.assessmentId !== `assessment:${revenueLeadAssessmentDigest(assessment.assessmentKey)}`
  ) {
    throw new Error("Contact review requires one content-derived exact assessment.");
  }
}

function assessmentReference(assessment: RevenueLeadAssessment): PrivateKwAssessmentReference {
  return {
    assessmentReceiptId: assessment.assessmentId,
    assessmentDigest: assessment.assessmentDigest,
    workflowReceiptId: assessment.workflow.workflowReceiptId,
    websiteSnapshotId: assessment.websiteSnapshotId,
    qualificationSnapshotId: assessment.qualificationSnapshotId,
  };
}

function allowedContactEvidenceUrl(value: string, sourceEvidenceUrl: string, websiteUrl: string) {
  if (value === sourceEvidenceUrl) return true;
  return new URL(value).origin === new URL(websiteUrl).origin;
}

function normalizeDraft(draft: PrivateKwContactReviewDraft): PrivateKwContactReviewDraft {
  return {
    ...draft,
    discovery: {
      ...draft.discovery,
      observations: [...draft.discovery.observations].sort((left, right) =>
        `${left.channel}|${left.value}|${left.evidence.sourceUrl}|${left.evidence.method}`
          .localeCompare(`${right.channel}|${right.value}|${right.evidence.sourceUrl}|${right.evidence.method}`, "en-CA")),
    },
    verifications: [...draft.verifications].sort((left, right) =>
      `${left.candidate.channel}|${left.candidate.value}`
        .localeCompare(`${right.candidate.channel}|${right.candidate.value}`, "en-CA")),
  };
}

export function buildPrivateKwContactReview(
  sourceValue: PrivateKwImportPlan,
  assessmentValue: RevenueLeadAssessment,
  draftValue: PrivateKwContactReviewDraft,
): PrivateKwContactReview {
  const source = PrivateKwImportPlanSchema.parse(sourceValue);
  const assessment = RevenueLeadAssessmentSchema.parse(assessmentValue);
  assertAssessmentIntegrity(assessment);
  const draft = normalizeDraft(PrivateKwContactReviewDraftSchema.parse(draftValue));
  const sourcePlan = buildPrivateKwPersistencePlan(source);
  if (
    draft.sourceImportId !== source.importId
    || draft.sourcePlanDigest !== sourcePlan.sourcePlanDigest
  ) {
    throw new Error("Contact review does not bind the exact private KW source plan.");
  }
  const selected = source.records.find((record) => record.business.id === draft.businessId);
  if (!selected || selected.evaluationCandidateId !== draft.evaluationCandidateId) {
    throw new Error("Contact review does not identify one exact KW evaluation candidate.");
  }
  if (
    assessment.business.id !== selected.business.id
    || assessment.business.canonicalName !== selected.business.canonicalName
    || assessment.business.independenceStatus !== selected.business.independenceStatus
    || assessment.business.status !== selected.business.status
    || selected.sourceRecord.websiteUrl !== assessment.websiteUrl
    || contactDiscoveryCanonicalJson(draft.assessment) !== contactDiscoveryCanonicalJson(assessmentReference(assessment))
  ) {
    throw new Error("Contact review assessment, source record, and business lineage do not match exactly.");
  }
  if (draft.discovery.observations.some((item) => !allowedContactEvidenceUrl(
    item.evidence.sourceUrl,
    selected.sourceRecord.sourceEvidenceUrl,
    assessment.websiteUrl,
  ))) {
    throw new Error("Contact observations must come from the approved source record or assessed website origin.");
  }

  const requestCore = {
    discoveryVersion: REVENUE_CONTACT_DISCOVERY_VERSION,
    idempotencyKey: `kw-contact-discovery:${contactDiscoveryDigest({
      sourcePlanDigest: draft.sourcePlanDigest,
      assessmentReceiptId: draft.assessment.assessmentReceiptId,
      requestedAt: draft.discovery.requestedAt,
    })}`,
    businessId: draft.businessId,
    websiteUrl: selected.sourceRecord.websiteUrl,
    sourceEvidenceUrl: selected.sourceRecord.sourceEvidenceUrl,
    requestedAt: draft.discovery.requestedAt,
    mode: "SHADOW" as const,
    adapterKind: "FIXTURE" as const,
    limits: { maxCandidates: 25, maxProviderOperations: 0 as const, maxCostUsd: 0 as const },
    authority: {
      runtimeConnected: false as const,
      contactPersistenceAuthorized: false as const,
      verificationAuthorized: false as const,
      outreachAuthorized: false as const,
      sendAuthorized: false as const,
      providerOperationsAuthorized: 0 as const,
      costAuthorizedUsd: 0 as const,
    },
  };
  const request = RevenueContactDiscoveryRequestSchema.parse({
    ...requestCore,
    requestId: `contact-discovery-request:${contactDiscoveryDigest(requestCore)}`,
  });
  const discovery = buildFixtureContactDiscoveryResult({
    request,
    observations: draft.discovery.observations,
    completedAt: draft.discovery.completedAt,
  });
  const verifications = draft.verifications.map((verificationDraft) => {
    const normalized = normalizeRevenueContactValue(
      verificationDraft.candidate.channel,
      verificationDraft.candidate.value,
      verificationDraft.candidate.socialPlatform,
    );
    const candidate = discovery.candidates.find((item) =>
      item.channel === verificationDraft.candidate.channel && item.value === normalized);
    if (!candidate) throw new Error("Verification draft must identify one exact re-derived discovery candidate.");
    const verificationCore = {
      verificationVersion: REVENUE_CONTACT_VERIFICATION_VERSION,
      idempotencyKey: `kw-contact-verification:${contactDiscoveryDigest({
        discoveryResultId: discovery.discoveryResultId,
        candidateId: candidate.candidateId,
        requestedAt: verificationDraft.requestedAt,
      })}`,
      businessId: draft.businessId,
      candidate,
      requestedAt: verificationDraft.requestedAt,
      mode: "SHADOW" as const,
      verifierKind: "FIXTURE" as const,
      limits: { maxProviderOperations: 0 as const, maxCostUsd: 0 as const },
      authority: {
        runtimeConnected: false as const,
        verificationPersistenceAuthorized: false as const,
        qualificationPersistenceAuthorized: false as const,
        outreachAuthorized: false as const,
        sendAuthorized: false as const,
        providerOperationsAuthorized: 0 as const,
        costAuthorizedUsd: 0 as const,
      },
    };
    const verificationRequest = RevenueContactVerificationRequestSchema.parse({
      ...verificationCore,
      requestId: `contact-verification-request:${contactDiscoveryDigest(verificationCore)}`,
    });
    return buildFixtureContactVerificationResult({
      request: verificationRequest,
      observation: verificationDraft.observation,
      completedAt: verificationDraft.completedAt,
    });
  }).sort((left, right) => left.verificationResultId.localeCompare(right.verificationResultId, "en-CA"));
  const summary = {
    candidates: discovery.candidates.length,
    verificationResults: verifications.length,
    usableRoutes: verifications.filter((item) => item.usableRoute).length,
    emailReviewRoutes: verifications.filter((item) => item.recommendedAction === "REVIEW_EMAIL").length,
    manualRoutes: verifications.filter((item) => item.recommendedAction.startsWith("MANUAL_")).length,
    researchRoutes: discovery.candidates.length - verifications.filter((item) => item.usableRoute).length,
    consentBasis: "UNASSESSED" as const,
  };
  const authority = {
    reviewOnly: true as const,
    databaseMutationAuthorized: false as const,
    contactDiscoveryExecutionAuthorized: false as const,
    contactVerificationExecutionAuthorized: false as const,
    consentDecisionAuthorized: false as const,
    qualificationAuthorized: false as const,
    outreachAuthorized: false as const,
    sendAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
  const core = {
    reviewVersion: PRIVATE_KW_CONTACT_REVIEW_VERSION,
    sourceImportId: draft.sourceImportId,
    sourcePlanDigest: draft.sourcePlanDigest,
    business: {
      id: selected.business.id,
      canonicalName: selected.business.canonicalName,
      city: selected.location.city,
      niche: selected.niche,
    },
    assessment: {
      ...assessmentReference(assessment),
      assessedAt: assessment.assessedAt,
      classification: assessment.audit.classification,
      scores: {
        rebuildNeed: assessment.qualification.scores.rebuildNeed,
        businessFit: assessment.qualification.scores.businessFit,
        timing: assessment.qualification.scores.timing,
        evidenceConfidence: assessment.qualification.scores.evidenceConfidence,
      },
    },
    draft,
    discovery,
    verifications,
    summary,
    authority,
  };
  const reviewDigest = contactDiscoveryDigest(core);
  return PrivateKwContactReviewSchema.parse({
    ...core,
    reviewId: `kw-contact-review:${reviewDigest}`,
    reviewDigest,
  });
}

export function buildPrivateKwContactInvocation(
  sourceValue: PrivateKwImportPlan,
  assessmentValue: RevenueLeadAssessment,
  reviewValue: PrivateKwContactReview,
  approvalValue: PrivateKwContactInvocationApproval,
): PrivateKwContactInvocation {
  const review = PrivateKwContactReviewSchema.parse(reviewValue);
  const approval = PrivateKwContactInvocationApprovalSchema.parse(approvalValue);
  const rebuilt = buildPrivateKwContactReview(sourceValue, assessmentValue, review.draft);
  if (contactDiscoveryCanonicalJson(rebuilt) !== contactDiscoveryCanonicalJson(review)) {
    throw new Error("Saved contact review does not match the trusted re-derived review.");
  }
  if (
    approval.reviewId !== review.reviewId
    || approval.reviewDigest !== review.reviewDigest
    || approval.sourcePlanDigest !== review.sourcePlanDigest
    || approval.businessId !== review.business.id
    || contactDiscoveryCanonicalJson(approval.assessment) !== contactDiscoveryCanonicalJson(review.draft.assessment)
  ) {
    throw new Error("Contact invocation approval does not bind the exact review and assessment lineage.");
  }
  if (approval.persistenceApproval.approval.confirmation !== PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION) {
    throw new Error("Contact invocation requires the dedicated contact-persistence confirmation.");
  }
  const persistencePlan = buildRevenueContactPersistencePlan({
    discovery: review.discovery,
    verifications: review.verifications,
  });
  if (
    approval.persistenceApproval.businessId !== review.business.id
    || approval.persistenceApproval.discoveryResultId !== review.discovery.discoveryResultId
    || approval.persistenceApproval.discoveryResultDigest !== review.discovery.discoveryResultDigest
    || approval.persistenceApproval.persistencePlanDigest !== persistencePlan.planDigest
  ) {
    throw new Error("Contact invocation approval does not bind the exact discovery persistence plan.");
  }
  const expectedVerification = review.verifications.map((item) => ({
    verificationResultId: item.verificationResultId,
    verificationResultDigest: item.verificationResultDigest,
  }));
  if (contactDiscoveryCanonicalJson(approval.persistenceApproval.verificationResults) !== contactDiscoveryCanonicalJson(expectedVerification)) {
    throw new Error("Contact invocation approval does not bind every exact verification result.");
  }
  const contactPlan = buildPrivateKwContactPersistencePlan({
    discovery: review.discovery,
    verifications: review.verifications,
    approval: approval.persistenceApproval,
  });
  const authority = {
    executionKind: "IGNORED_LOCAL_SQLITE" as const,
    localContactMutationAuthorized: true as const,
    localVerificationMutationAuthorized: true as const,
    localInvocationReceiptAuthorized: true as const,
    sourceMutationAuthorized: false as const,
    workflowMutationAuthorized: false as const,
    assessmentMutationAuthorized: false as const,
    schemaMutationAuthorized: false as const,
    captureAuthorized: false as const,
    contactDiscoveryExecutionAuthorized: false as const,
    contactVerificationExecutionAuthorized: false as const,
    consentDecisionAuthorized: false as const,
    qualificationAuthorized: false as const,
    outreachAuthorized: false as const,
    sendAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
  };
  const core = {
    invocationVersion: PRIVATE_KW_CONTACT_INVOCATION_VERSION,
    reviewId: review.reviewId,
    reviewDigest: review.reviewDigest,
    sourceImportId: review.sourceImportId,
    sourcePlanDigest: review.sourcePlanDigest,
    businessId: review.business.id,
    assessment: review.draft.assessment,
    review,
    contactMaterializationId: contactPlan.materializationId,
    approval,
    authority,
  };
  const invocationDigest = contactDiscoveryDigest(core);
  return PrivateKwContactInvocationSchema.parse({
    ...core,
    invocationId: `kw-contact-invocation:${invocationDigest}`,
    invocationDigest,
  });
}

export function privateKwContactInvocationCanonicalJson(value: unknown) {
  return revenueLeadAssessmentCanonicalJson(value);
}
