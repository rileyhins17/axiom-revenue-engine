import { createHash } from "node:crypto";

import { z } from "zod";

import {
  KW_LEAD_EVALUATION_TARGET_SIZE,
  KW_LEAD_EVALUATION_VERSION,
  KwLeadEvaluationEntrySchema,
  KwLeadEvaluationSetSchema,
  LeadQualityLabelSchema,
  OwnerLeadReasonSchema,
  summarizeKwLeadEvaluation,
} from "@/lib/revenue-engine/lead-quality-evaluation";
import {
  RevenueLeadAssessmentSchema,
  revenueLeadAssessmentCanonicalJson,
  revenueLeadAssessmentDigest,
  type RevenueLeadAssessment,
} from "@/lib/revenue-engine/lead-assessment";
import {
  PrivateKwImportPlanSchema,
  type PrivateKwImportPlan,
} from "@/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "@/lib/revenue-engine/private-kw-persistence-plan";

export const PRIVATE_KW_OWNER_LABELING_VERSION = "kw-private-owner-labeling-v1";
export const PRIVATE_KW_OWNER_LABELING_POLICY_VERSION = "kw-owner-quality-policy-v1";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const PacketIdSchema = z.string().regex(/^kw-owner-labeling:[a-f0-9]{64}$/);

const LabelingAuthoritySchema = z.object({
  reviewOnly: z.literal(true),
  databaseMutationAuthorized: z.literal(false),
  sourceMutationAuthorized: z.literal(false),
  assessmentMutationAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const SummarySchema = z.object({
  targetSize: z.literal(KW_LEAD_EVALUATION_TARGET_SIZE),
  loaded: z.number().int().min(0).max(KW_LEAD_EVALUATION_TARGET_SIZE),
  reviewed: z.number().int().min(0).max(KW_LEAD_EVALUATION_TARGET_SIZE),
  agreements: z.number().int().min(0).max(KW_LEAD_EVALUATION_TARGET_SIZE),
  agreementPercent: z.number().int().min(0).max(100),
  countsByCity: z.object({
    KITCHENER: z.number().int().nonnegative(),
    WATERLOO: z.number().int().nonnegative(),
    CAMBRIDGE: z.number().int().nonnegative(),
  }).strict(),
  countsByNiche: z.object({
    ROOFING: z.number().int().nonnegative(),
    HVAC: z.number().int().nonnegative(),
    LANDSCAPING: z.number().int().nonnegative(),
  }).strict(),
  ready: z.boolean(),
  gateReasons: z.array(z.string().trim().min(1).max(120)).max(10),
}).strict();

export const PrivateKwOwnerLabelingPacketSchema = z.object({
  packetVersion: z.literal(PRIVATE_KW_OWNER_LABELING_VERSION),
  packetId: PacketIdSchema,
  packetDigest: Sha256Schema,
  parentPacketId: PacketIdSchema.nullable(),
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  market: z.literal("KITCHENER_WATERLOO_CAMBRIDGE"),
  targetSize: z.literal(KW_LEAD_EVALUATION_TARGET_SIZE),
  policyVersion: z.literal(PRIVATE_KW_OWNER_LABELING_POLICY_VERSION),
  preparedAt: TimestampSchema,
  entries: KwLeadEvaluationSetSchema.shape.entries,
  summary: SummarySchema,
  authority: LabelingAuthoritySchema,
}).strict().superRefine((packet, context) => {
  const evaluation = KwLeadEvaluationSetSchema.parse({
    setVersion: KW_LEAD_EVALUATION_VERSION,
    setId: packet.packetId,
    market: packet.market,
    targetSize: packet.targetSize,
    createdAt: packet.preparedAt,
    entries: packet.entries,
  });
  if (revenueLeadAssessmentCanonicalJson(summarizeKwLeadEvaluation(evaluation)) !== revenueLeadAssessmentCanonicalJson(packet.summary)) {
    context.addIssue({ code: "custom", message: "Owner-labeling summary must match the exact entries.", path: ["summary"] });
  }
  const { packetId: _packetId, packetDigest: _packetDigest, ...core } = packet;
  void _packetId;
  void _packetDigest;
  const expected = digest(core);
  if (packet.packetDigest !== expected || packet.packetId !== `kw-owner-labeling:${expected}`) {
    context.addIssue({ code: "custom", message: "Owner-labeling identity must bind the exact immutable checkpoint.", path: ["packetDigest"] });
  }
});

export type PrivateKwOwnerLabelingPacket = z.infer<typeof PrivateKwOwnerLabelingPacketSchema>;

const OwnerDecisionSchema = z.object({
  leadId: z.string().trim().min(1).max(128),
  label: LeadQualityLabelSchema,
  reasons: z.array(OwnerLeadReasonSchema).min(1).max(5),
  notes: z.string().trim().max(500),
}).strict();

export const PrivateKwOwnerLabelSubmissionSchema = z.object({
  submissionVersion: z.literal(PRIVATE_KW_OWNER_LABELING_VERSION),
  packetId: PacketIdSchema,
  packetDigest: Sha256Schema,
  reviewedBy: z.enum(["RILEY", "AIDAN"]),
  reviewedAt: TimestampSchema,
  decisions: z.array(OwnerDecisionSchema).min(1).max(KW_LEAD_EVALUATION_TARGET_SIZE),
  firstPassDecisions: z.array(OwnerDecisionSchema).min(1).max(KW_LEAD_EVALUATION_TARGET_SIZE).optional(),
  reviewOnly: z.literal(true),
  databaseMutationAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((submission, context) => {
  const leadIds = submission.decisions.map((decision) => decision.leadId);
  if (new Set(leadIds).size !== leadIds.length) {
    context.addIssue({ code: "custom", message: "One submission may label each lead only once.", path: ["decisions"] });
  }
  if (submission.firstPassDecisions) {
    const firstPassIds = submission.firstPassDecisions.map((decision) => decision.leadId);
    if (new Set(firstPassIds).size !== firstPassIds.length) {
      context.addIssue({ code: "custom", message: "One submission may include each first-pass lead only once.", path: ["firstPassDecisions"] });
    }
    if (firstPassIds.some((leadId) => !leadIds.includes(leadId))) {
      context.addIssue({ code: "custom", message: "First-pass judgments must identify leads with a final judgment.", path: ["firstPassDecisions"] });
    }
  }
});

export type PrivateKwOwnerLabelSubmission = z.infer<typeof PrivateKwOwnerLabelSubmissionSchema>;

const AUTHORITY = {
  reviewOnly: true as const,
  databaseMutationAuthorized: false as const,
  sourceMutationAuthorized: false as const,
  assessmentMutationAuthorized: false as const,
  qualificationAuthorized: false as const,
  consentDecisionAuthorized: false as const,
  outreachAuthorized: false as const,
  sendAuthorized: false as const,
  providerOperationsAuthorized: 0 as const,
  costAuthorizedUsd: 0 as const,
};

function digest(value: unknown) {
  return createHash("sha256").update(revenueLeadAssessmentCanonicalJson(value)).digest("hex");
}

function assertAssessmentIntegrity(assessment: RevenueLeadAssessment) {
  const { assessmentDigest, ...core } = assessment;
  if (
    assessmentDigest !== revenueLeadAssessmentDigest(core)
    || assessment.assessmentId !== `assessment:${revenueLeadAssessmentDigest(assessment.assessmentKey)}`
    || assessment.auditDigest !== revenueLeadAssessmentDigest(assessment.audit)
    || assessment.qualificationDigest !== revenueLeadAssessmentDigest(assessment.qualification)
  ) {
    throw new Error("Owner labeling requires one content-derived exact assessment per business.");
  }
}

function engineLabel(assessment: RevenueLeadAssessment) {
  if (
    assessment.business.independenceStatus === "CHAIN"
    || assessment.business.independenceStatus === "FRANCHISE"
    || assessment.business.status === "SUPPRESSED"
    || assessment.business.status === "MERGED"
    || assessment.policyBlocks.length > 0
  ) return "WRONG" as const;
  const scores = assessment.qualification.scores;
  if (
    (assessment.audit.classification === "REBUILD" || assessment.audit.classification === "NO_SITE_NEW_BUILD")
    && assessment.qualification.totalScore >= 70
    && scores.rebuildNeed >= 65
    && scores.businessFit >= 60
    && scores.evidenceConfidence >= 80
    && assessment.qualification.supportedObservationCount >= 3
    && assessment.qualification.conversionCriticalCount >= 1
  ) return "STRONG" as const;
  return "WEAK" as const;
}

function evaluationSet(entries: PrivateKwOwnerLabelingPacket["entries"], preparedAt: string) {
  return KwLeadEvaluationSetSchema.parse({
    setVersion: KW_LEAD_EVALUATION_VERSION,
    setId: "kw-owner-labeling-evaluation",
    market: "KITCHENER_WATERLOO_CAMBRIDGE",
    targetSize: KW_LEAD_EVALUATION_TARGET_SIZE,
    createdAt: preparedAt,
    entries,
  });
}

function buildPacket(input: Omit<PrivateKwOwnerLabelingPacket, "packetId" | "packetDigest" | "summary">) {
  const set = evaluationSet(input.entries, input.preparedAt);
  const core = {
    ...input,
    summary: summarizeKwLeadEvaluation(set),
  };
  const packetDigest = digest(core);
  return PrivateKwOwnerLabelingPacketSchema.parse({
    ...core,
    packetId: `kw-owner-labeling:${packetDigest}`,
    packetDigest,
  });
}

function sourceRecordForAssessment(source: PrivateKwImportPlan, assessment: RevenueLeadAssessment) {
  const record = source.records.find((candidate) => candidate.business.id === assessment.business.id);
  if (!record) throw new Error("An assessed business is outside the exact private KW source plan.");
  if (
    record.business.canonicalName !== assessment.business.canonicalName
    || record.business.independenceStatus !== assessment.business.independenceStatus
    || assessment.audit.businessId !== record.business.id
  ) {
    throw new Error("Owner-labeling source identity and assessment evidence do not match.");
  }
  return record;
}

export function buildPrivateKwOwnerLabelingPacket(
  sourceValue: PrivateKwImportPlan,
  assessmentValues: RevenueLeadAssessment[],
  preparedAt: string,
) {
  const source = PrivateKwImportPlanSchema.parse(sourceValue);
  TimestampSchema.parse(preparedAt);
  const assessments = assessmentValues.map((value) => RevenueLeadAssessmentSchema.parse(value));
  if (assessments.length > KW_LEAD_EVALUATION_TARGET_SIZE) {
    throw new Error("Owner labeling cannot exceed the 50-lead evaluation target.");
  }
  const businessIds = assessments.map((assessment) => assessment.business.id);
  if (new Set(businessIds).size !== businessIds.length) {
    throw new Error("Owner labeling requires at most one current assessment per business.");
  }
  const entries: PrivateKwOwnerLabelingPacket["entries"] = assessments.map((assessment) => {
    assertAssessmentIntegrity(assessment);
    const record = sourceRecordForAssessment(source, assessment);
    return KwLeadEvaluationEntrySchema.parse({
      entryVersion: KW_LEAD_EVALUATION_VERSION,
      leadId: record.evaluationCandidateId,
      businessId: record.business.id,
      businessIdentityKey: `identity:${digest(record.sourceRecord.identitySignals)}`,
      businessName: record.business.canonicalName,
      city: record.location.city,
      niche: record.niche,
      sourceEvidenceUrl: record.sourceRecord.sourceEvidenceUrl,
      websiteUrl: assessment.websiteUrl,
      audit: assessment.audit,
      engineAssessment: {
        label: engineLabel(assessment),
        scores: assessment.qualification.scores,
        policyVersion: PRIVATE_KW_OWNER_LABELING_POLICY_VERSION,
        assessedAt: assessment.assessedAt,
      },
      ownerReview: {
        label: "UNREVIEWED" as const,
        reasons: [],
        notes: "",
        reviewedAt: null,
      },
      addedAt: assessment.assessedAt,
    });
  }).sort((left, right) => left.city.localeCompare(right.city, "en-CA")
    || left.niche.localeCompare(right.niche, "en-CA")
    || left.businessName.localeCompare(right.businessName, "en-CA")
    || left.businessId.localeCompare(right.businessId, "en-CA"));

  return buildPacket({
    packetVersion: PRIVATE_KW_OWNER_LABELING_VERSION,
    parentPacketId: null,
    sourceImportId: source.importId,
    sourcePlanDigest: buildPrivateKwPersistencePlan(source).sourcePlanDigest,
    market: "KITCHENER_WATERLOO_CAMBRIDGE",
    targetSize: KW_LEAD_EVALUATION_TARGET_SIZE,
    policyVersion: PRIVATE_KW_OWNER_LABELING_POLICY_VERSION,
    preparedAt,
    entries,
    authority: AUTHORITY,
  });
}

export function applyPrivateKwOwnerLabels(
  packetValue: PrivateKwOwnerLabelingPacket,
  submissionValue: PrivateKwOwnerLabelSubmission,
) {
  const packet = PrivateKwOwnerLabelingPacketSchema.parse(packetValue);
  const submission = PrivateKwOwnerLabelSubmissionSchema.parse(submissionValue);
  if (submission.packetId !== packet.packetId || submission.packetDigest !== packet.packetDigest) {
    throw new Error("Owner decisions do not bind the exact labeling checkpoint.");
  }
  if (Date.parse(submission.reviewedAt) < Date.parse(packet.preparedAt)) {
    throw new Error("Owner review cannot predate the labeling checkpoint.");
  }
  const entriesByLead = new Map(packet.entries.map((entry) => [entry.leadId, entry]));
  submission.decisions.forEach((decision) => {
    const entry = entriesByLead.get(decision.leadId);
    if (!entry) throw new Error("Owner decision identifies a lead outside the labeling checkpoint.");
    if (entry.ownerReview.label !== "UNREVIEWED") {
      throw new Error("An immutable owner-labeling checkpoint cannot relabel an already reviewed lead.");
    }
  });
  const decisions = new Map(submission.decisions.map((decision) => [decision.leadId, decision]));
  const entries = packet.entries.map((entry) => {
    const decision = decisions.get(entry.leadId);
    return decision ? {
      ...entry,
      ownerReview: {
        label: decision.label,
        reasons: decision.reasons,
        notes: decision.notes,
        reviewedAt: submission.reviewedAt,
      },
    } : entry;
  });
  return buildPacket({
    packetVersion: PRIVATE_KW_OWNER_LABELING_VERSION,
    parentPacketId: packet.packetId,
    sourceImportId: packet.sourceImportId,
    sourcePlanDigest: packet.sourcePlanDigest,
    market: packet.market,
    targetSize: packet.targetSize,
    policyVersion: packet.policyVersion,
    preparedAt: submission.reviewedAt,
    entries,
    authority: AUTHORITY,
  });
}

export function privateKwOwnerLabelingCanonicalJson(value: unknown) {
  return revenueLeadAssessmentCanonicalJson(value);
}
