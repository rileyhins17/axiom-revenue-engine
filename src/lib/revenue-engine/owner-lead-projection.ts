import { z } from "zod";

import { isSupportedEvidenceClaim } from "@/lib/revenue-engine/evidence";
import {
  KwEvaluationCitySchema,
  KwEvaluationNicheSchema,
} from "@/lib/revenue-engine/lead-quality-evaluation";
import {
  calculateWeightedPriority,
  qualifyRevenueLead,
  type ReachableChannel,
} from "@/lib/revenue-engine/qualification";
import { DeterministicWebsiteAuditResultSchema } from "@/lib/revenue-engine/website-audit";

export const OWNER_LEAD_PROJECTION_VERSION = "owner-lead-projection-v1";
export const OWNER_LEAD_MAX_SOURCE_AGE_MS = 90 * 24 * 60 * 60 * 1_000;
export const OWNER_LEAD_MAX_AUDIT_AGE_MS = 60 * 24 * 60 * 60 * 1_000;

const TimestampSchema = z.string().datetime({ offset: true });
const BusinessIdSchema = z.string().trim().min(1).max(128);
const UrlSchema = z.string().url().max(2_048);

const OwnerLeadBusinessSchema = z.object({
  businessId: BusinessIdSchema,
  canonicalName: z.string().trim().min(1).max(256),
  niche: KwEvaluationNicheSchema,
  normalizedDomain: z.string().trim().min(1).max(253).nullable(),
  websiteUrl: UrlSchema.nullable(),
  independenceStatus: z.enum(["UNKNOWN", "INDEPENDENT", "CHAIN", "FRANCHISE"]),
  status: z.enum(["RESEARCH_ONLY", "ACTIVE", "SUPPRESSED", "MERGED"]),
  location: z.object({
    city: KwEvaluationCitySchema,
    region: z.literal("ON"),
    country: z.literal("CA"),
  }).strict(),
  sourceEvidenceUrl: UrlSchema,
  sourceCapturedAt: TimestampSchema,
}).strict();

const OwnerLeadEmailVerificationSchema = z.object({
  status: z.enum(["DELIVERABLE", "UNVERIFIED", "UNKNOWN", "UNDELIVERABLE", "CATCH_ALL"]),
  verifiedAt: TimestampSchema.nullable(),
  staleAfter: TimestampSchema.nullable(),
}).strict();

export const OwnerLeadContactPointSchema = z.object({
  contactPointId: z.string().trim().min(1).max(128),
  businessId: BusinessIdSchema,
  channel: z.enum(["EMAIL", "PHONE", "FORM", "SOCIAL"]),
  value: z.string().trim().min(1).max(2_048),
  label: z.string().trim().min(1).max(120).nullable(),
  personName: z.string().trim().min(1).max(120).nullable(),
  role: z.string().trim().min(1).max(120).nullable(),
  recipientKind: z.enum(["NAMED_PERSON", "ROLE", "BUSINESS", "UNKNOWN"]),
  sourceUrl: UrlSchema,
  sourceCapturedAt: TimestampSchema,
  staleAfter: TimestampSchema.nullable(),
  status: z.enum(["CANDIDATE", "USABLE", "VERIFIED", "SUPPRESSED", "INVALID", "STALE"]),
  emailVerification: OwnerLeadEmailVerificationSchema.nullable(),
  automationPermitted: z.boolean(),
}).strict().superRefine((contact, context) => {
  if (contact.channel === "EMAIL" && !contact.emailVerification) {
    context.addIssue({ code: "custom", message: "Email contact points require an explicit verification state.", path: ["emailVerification"] });
  }
  if (contact.channel === "EMAIL" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.value)) {
    context.addIssue({ code: "custom", message: "Email contact values must be a single valid address.", path: ["value"] });
  }
  if (contact.channel !== "EMAIL" && contact.emailVerification) {
    context.addIssue({ code: "custom", message: "Only email contact points may carry email verification.", path: ["emailVerification"] });
  }
  if ((contact.channel === "FORM" || contact.channel === "SOCIAL") && !URL.canParse(contact.value)) {
    context.addIssue({ code: "custom", message: "Form and social contact values must be public URLs.", path: ["value"] });
  }
});

const OwnerLeadQualificationSnapshotSchema = z.object({
  snapshotId: z.string().trim().min(1).max(128),
  businessId: BusinessIdSchema,
  policyVersion: z.string().trim().min(1).max(80),
  shadowOnly: z.literal(true),
  totalScore: z.number().int().min(0).max(100),
  scores: z.object({
    rebuildNeed: z.number().int().min(0).max(100),
    businessFit: z.number().int().min(0).max(100),
    reachability: z.number().int().min(0).max(100),
    timing: z.number().int().min(0).max(100),
    evidenceConfidence: z.number().int().min(0).max(100),
  }).strict(),
  band: z.enum(["PRIORITY", "REVIEW", "RESEARCH", "DISQUALIFIED"]),
  recommendedChannel: z.enum(["EMAIL", "PHONE", "FORM", "SOCIAL", "RESEARCH"]),
  supportedObservationCount: z.number().int().nonnegative().max(100),
  conversionCriticalCount: z.number().int().nonnegative().max(100),
  failedGates: z.array(z.string().trim().min(1).max(120)).max(50),
  evidenceClaimIds: z.array(z.string().trim().min(1).max(256)).max(100),
  createdAt: TimestampSchema,
}).strict().superRefine((snapshot, context) => {
  if (snapshot.totalScore !== calculateWeightedPriority(snapshot.scores)) {
    context.addIssue({ code: "custom", message: "Qualification total must match the approved weighted score.", path: ["totalScore"] });
  }
  if (new Set(snapshot.failedGates).size !== snapshot.failedGates.length) {
    context.addIssue({ code: "custom", message: "Qualification failed gates must be unique.", path: ["failedGates"] });
  }
  if (new Set(snapshot.evidenceClaimIds).size !== snapshot.evidenceClaimIds.length) {
    context.addIssue({ code: "custom", message: "Qualification evidence claim IDs must be unique.", path: ["evidenceClaimIds"] });
  }
});

export const OwnerLeadProjectionInputSchema = z.object({
  projectionVersion: z.literal(OWNER_LEAD_PROJECTION_VERSION),
  projectedAt: TimestampSchema,
  business: OwnerLeadBusinessSchema,
  audit: DeterministicWebsiteAuditResultSchema,
  qualification: OwnerLeadQualificationSnapshotSchema,
  contactPoints: z.array(OwnerLeadContactPointSchema).max(100),
}).strict().superRefine((input, context) => {
  if (
    input.audit.businessId !== input.business.businessId
    || input.qualification.businessId !== input.business.businessId
  ) {
    context.addIssue({ code: "custom", message: "Business, audit, and qualification identities must match.", path: ["business", "businessId"] });
  }
  input.contactPoints.forEach((contact, index) => {
    if (contact.businessId !== input.business.businessId) {
      context.addIssue({ code: "custom", message: "A contact point cannot belong to another business.", path: ["contactPoints", index, "businessId"] });
    }
  });
});

export type OwnerLeadProjectionInput = z.infer<typeof OwnerLeadProjectionInputSchema>;

const OwnerLeadRouteSchema = z.object({
  channel: z.enum(["EMAIL", "PHONE", "FORM", "SOCIAL", "RESEARCH"]),
  readiness: z.enum(["OWNER_REVIEW", "MANUAL_ACTION", "RESEARCH_REQUIRED"]),
  contactPointId: z.string().max(128).nullable(),
  label: z.string().min(1).max(80),
  reason: z.string().min(1).max(240),
}).strict();

const OwnerLeadEvidenceSchema = z.object({
  claimId: z.string().min(1).max(256),
  observation: z.string().min(1).max(500),
  category: z.string().min(1).max(80),
  confidence: z.number().min(0).max(100),
  conversionCritical: z.boolean(),
  sourceUrl: UrlSchema,
  capturedAt: TimestampSchema,
  artifactRef: z.string().min(1).nullable(),
}).strict();

export const OwnerLeadProjectionSchema = z.object({
  projectionVersion: z.literal(OWNER_LEAD_PROJECTION_VERSION),
  projectedAt: TimestampSchema,
  projectionKey: z.string().min(1).max(300),
  business: OwnerLeadBusinessSchema,
  audit: z.object({
    classification: z.enum(["REBUILD", "NO_SITE_NEW_BUILD", "MINOR_IMPROVEMENT", "NO_OPPORTUNITY"]),
    auditVersion: z.string().min(1).max(120),
    capturedAt: TimestampSchema,
    finalUrl: UrlSchema.nullable(),
  }).strict(),
  qualification: z.object({
    snapshotId: z.string().min(1).max(128),
    policyVersion: z.string().min(1).max(80),
    band: z.enum(["PRIORITY", "REVIEW", "RESEARCH", "DISQUALIFIED"]),
    totalScore: z.number().int().min(0).max(100),
    scores: OwnerLeadQualificationSnapshotSchema.shape.scores,
    failedGates: z.array(z.string().min(1).max(120)).max(50),
  }).strict(),
  attention: z.enum(["READY_FOR_REVIEW", "REVIEW", "RESEARCH", "NEEDS_REFRESH", "BLOCKED"]),
  ownerActionable: z.boolean(),
  route: OwnerLeadRouteSchema,
  whyThisLead: z.array(OwnerLeadEvidenceSchema).max(3),
  evidence: z.array(OwnerLeadEvidenceSchema).max(10),
  dataQuality: z.object({
    state: z.enum(["CURRENT", "NEEDS_REFRESH", "INDETERMINATE"]),
    issues: z.array(z.string().min(1).max(120)).max(30),
  }).strict(),
  authority: z.object({
    readOnly: z.literal(true),
    shadowOnly: z.literal(true),
    qualificationAuthorized: z.literal(false),
    outreachAuthorized: z.literal(false),
    sendAuthorized: z.literal(false),
    mutationAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
}).strict();

export type OwnerLeadProjection = z.infer<typeof OwnerLeadProjectionSchema>;

const STANDARD_GATE_CODES = new Set([
  "total_below_70",
  "rebuild_need_below_65",
  "business_fit_below_60",
  "evidence_confidence_below_80",
  "fewer_than_three_supported_observations",
  "missing_conversion_critical_observation",
  "no_usable_channel",
]);

function timestampIsCurrent(value: string, projectedAtMs: number, maxAgeMs: number) {
  const valueMs = Date.parse(value);
  return valueMs <= projectedAtMs && projectedAtMs - valueMs <= maxAgeMs;
}

function contactIsCurrent(contact: z.infer<typeof OwnerLeadContactPointSchema>, projectedAtMs: number) {
  if (!timestampIsCurrent(contact.sourceCapturedAt, projectedAtMs, OWNER_LEAD_MAX_SOURCE_AGE_MS)) return false;
  if (contact.staleAfter && Date.parse(contact.staleAfter) <= projectedAtMs) return false;
  return contact.status === "USABLE" || contact.status === "VERIFIED";
}

function emailIsUsable(contact: z.infer<typeof OwnerLeadContactPointSchema>, projectedAtMs: number) {
  const verification = contact.emailVerification;
  return contact.channel === "EMAIL"
    && contact.status === "VERIFIED"
    && (contact.recipientKind === "NAMED_PERSON" || contact.recipientKind === "ROLE")
    && verification?.status === "DELIVERABLE"
    && verification.verifiedAt !== null
    && verification.staleAfter !== null
    && Date.parse(verification.verifiedAt) <= projectedAtMs
    && Date.parse(verification.staleAfter) > projectedAtMs
    && contactIsCurrent(contact, projectedAtMs);
}

function channelTier(contact: z.infer<typeof OwnerLeadContactPointSchema>, projectedAtMs: number) {
  if (emailIsUsable(contact, projectedAtMs)) return contact.recipientKind === "NAMED_PERSON" ? 0 : 1;
  if (!contactIsCurrent(contact, projectedAtMs)) return 99;
  if (contact.channel === "PHONE") return 2;
  if (contact.channel === "FORM") return 3;
  if (contact.channel === "SOCIAL") return 4;
  return 99;
}

function selectRoute(contactPoints: OwnerLeadProjectionInput["contactPoints"], projectedAtMs: number) {
  const contact = [...contactPoints]
    .sort((left, right) => channelTier(left, projectedAtMs) - channelTier(right, projectedAtMs)
      || left.contactPointId.localeCompare(right.contactPointId, "en-CA"))
    .find((candidate) => channelTier(candidate, projectedAtMs) < 99);

  if (!contact) {
    return OwnerLeadRouteSchema.parse({
      channel: "RESEARCH",
      readiness: "RESEARCH_REQUIRED",
      contactPointId: null,
      label: "Research contact route",
      reason: "No current, usable contact route is supported yet.",
    });
  }
  if (contact.channel === "EMAIL") {
    const named = contact.recipientKind === "NAMED_PERSON";
    return OwnerLeadRouteSchema.parse({
      channel: "EMAIL",
      readiness: "OWNER_REVIEW",
      contactPointId: contact.contactPointId,
      label: named ? "Verified named email" : "Verified role email",
      reason: named
        ? "A current named business email is verified; every message still requires the applicable owner and policy gates."
        : "A current role-based business email is verified; manual owner approval is required before any use.",
    });
  }
  const routeCopy = {
    PHONE: ["Manual phone task", "A current business phone is available. Calling remains a manual task."],
    FORM: ["Manual form task", "A current public contact form is available. Submission remains a manual task."],
    SOCIAL: ["Manual social task", "A current public social profile is available. Messaging remains a manual task."],
  } as const;
  const [label, reason] = routeCopy[contact.channel];
  return OwnerLeadRouteSchema.parse({
    channel: contact.channel,
    readiness: "MANUAL_ACTION",
    contactPointId: contact.contactPointId,
    label,
    reason,
  });
}

function evidenceSeverity(input: OwnerLeadProjectionInput, claimId: string) {
  const severity = input.audit.checks.find((check) => check.claimId === claimId)?.severity;
  return severity === "CRITICAL" ? 0 : severity === "IMPORTANT" ? 1 : 2;
}

function evidenceView(input: OwnerLeadProjectionInput) {
  return input.audit.claims
    .filter(isSupportedEvidenceClaim)
    .sort((left, right) => evidenceSeverity(input, left.claimId) - evidenceSeverity(input, right.claimId)
      || Number(right.conversionCritical) - Number(left.conversionCritical)
      || right.confidence - left.confidence
      || left.claimId.localeCompare(right.claimId, "en-CA"))
    .slice(0, 10)
    .map((claim) => OwnerLeadEvidenceSchema.parse({
      claimId: claim.claimId,
      observation: claim.observation,
      category: claim.category,
      confidence: claim.confidence,
      conversionCritical: claim.conversionCritical,
      sourceUrl: claim.sourceUrl,
      capturedAt: claim.capturedAt,
      artifactRef: claim.artifactRef,
    }));
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function snapshotMatchesCurrent(
  input: OwnerLeadProjectionInput,
  current: ReturnType<typeof qualifyRevenueLead>,
) {
  const snapshot = input.qualification;
  return snapshot.policyVersion === current.policyVersion
    && snapshot.band === current.band
    && snapshot.totalScore === current.totalScore
    && snapshot.recommendedChannel === current.recommendedChannel
    && snapshot.supportedObservationCount === current.supportedObservationCount
    && snapshot.conversionCriticalCount === current.conversionCriticalCount
    && arraysEqual([...snapshot.failedGates].sort(), [...current.failedGates].sort())
    && arraysEqual([...snapshot.evidenceClaimIds].sort(), [...current.evidenceClaimIds].sort());
}

export function projectOwnerLead(value: unknown): OwnerLeadProjection {
  const input = OwnerLeadProjectionInputSchema.parse(value);
  const projectedAtMs = Date.parse(input.projectedAt);
  const route = selectRoute(input.contactPoints, projectedAtMs);
  const derivedBlocks = [
    ...input.qualification.failedGates.filter((gate) => !STANDARD_GATE_CODES.has(gate)),
    ...(input.business.independenceStatus === "CHAIN" || input.business.independenceStatus === "FRANCHISE"
      ? ["chain_or_franchise"]
      : []),
    ...(input.business.status === "SUPPRESSED" ? ["business_suppressed"] : []),
    ...(input.business.status === "MERGED" ? ["business_merged"] : []),
  ];
  const currentQualification = qualifyRevenueLead({
    scores: input.qualification.scores,
    evidenceClaims: input.audit.claims,
    availableChannels: [route.channel] satisfies ReachableChannel[],
    blocks: Array.from(new Set(derivedBlocks)).sort(),
  });
  const evidence = evidenceView(input);
  const issues: string[] = [];

  if (!timestampIsCurrent(input.business.sourceCapturedAt, projectedAtMs, OWNER_LEAD_MAX_SOURCE_AGE_MS)) {
    issues.push(Date.parse(input.business.sourceCapturedAt) > projectedAtMs ? "source_timestamp_in_future" : "source_record_stale");
  }
  if (!timestampIsCurrent(input.audit.capturedAt, projectedAtMs, OWNER_LEAD_MAX_AUDIT_AGE_MS)) {
    issues.push(Date.parse(input.audit.capturedAt) > projectedAtMs ? "audit_timestamp_in_future" : "website_audit_stale");
  }
  if (Date.parse(input.qualification.createdAt) > projectedAtMs) issues.push("qualification_timestamp_in_future");
  if (Date.parse(input.qualification.createdAt) < Date.parse(input.audit.capturedAt)) issues.push("qualification_predates_audit");
  if (input.qualification.scores.rebuildNeed !== input.audit.rebuildNeedScore) issues.push("rebuild_need_score_drift");
  if (input.qualification.scores.evidenceConfidence !== input.audit.evidenceConfidence) issues.push("evidence_confidence_score_drift");
  if (input.audit.claims.some((claim) => claim.capturedAt !== input.audit.capturedAt || claim.auditVersion !== input.audit.auditVersion)) {
    issues.push("audit_claim_provenance_drift");
  }
  if (!snapshotMatchesCurrent(input, currentQualification)) issues.push("qualification_snapshot_drift");
  if (input.business.independenceStatus === "UNKNOWN") issues.push("independence_unverified");

  const uniqueIssues = Array.from(new Set(issues)).sort();
  const explicitlyBlocked = currentQualification.band === "DISQUALIFIED";
  const needsRefresh = uniqueIssues.some((issue) => issue !== "independence_unverified");
  const attention = explicitlyBlocked
    ? "BLOCKED" as const
    : needsRefresh
      ? "NEEDS_REFRESH" as const
      : currentQualification.band === "PRIORITY"
        ? "READY_FOR_REVIEW" as const
        : currentQualification.band === "REVIEW"
          ? "REVIEW" as const
          : "RESEARCH" as const;
  const dataState = needsRefresh
    ? "NEEDS_REFRESH" as const
    : uniqueIssues.length > 0
      ? "INDETERMINATE" as const
      : "CURRENT" as const;

  return OwnerLeadProjectionSchema.parse({
    projectionVersion: input.projectionVersion,
    projectedAt: input.projectedAt,
    projectionKey: `${OWNER_LEAD_PROJECTION_VERSION}:${input.business.businessId}:${input.qualification.snapshotId}`,
    business: input.business,
    audit: {
      classification: input.audit.classification,
      auditVersion: input.audit.auditVersion,
      capturedAt: input.audit.capturedAt,
      finalUrl: input.audit.finalUrl,
    },
    qualification: {
      snapshotId: input.qualification.snapshotId,
      policyVersion: currentQualification.policyVersion,
      band: currentQualification.band,
      totalScore: currentQualification.totalScore,
      scores: currentQualification.scores,
      failedGates: currentQualification.failedGates,
    },
    attention,
    ownerActionable: attention === "READY_FOR_REVIEW" || attention === "REVIEW",
    route,
    whyThisLead: evidence.slice(0, 3),
    evidence,
    dataQuality: { state: dataState, issues: uniqueIssues },
    authority: {
      readOnly: true,
      shadowOnly: true,
      qualificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      mutationAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  });
}

const ATTENTION_ORDER: Record<OwnerLeadProjection["attention"], number> = {
  READY_FOR_REVIEW: 0,
  REVIEW: 1,
  RESEARCH: 2,
  NEEDS_REFRESH: 3,
  BLOCKED: 4,
};

export function rankOwnerLeads(values: unknown[]): OwnerLeadProjection[] {
  return sortOwnerLeadProjections(values.map(projectOwnerLead));
}

export function sortOwnerLeadProjections(values: OwnerLeadProjection[]): OwnerLeadProjection[] {
  return [...values]
    .sort((left, right) => ATTENTION_ORDER[left.attention] - ATTENTION_ORDER[right.attention]
      || right.qualification.totalScore - left.qualification.totalScore
      || right.qualification.scores.rebuildNeed - left.qualification.scores.rebuildNeed
      || right.qualification.scores.businessFit - left.qualification.scores.businessFit
      || left.business.canonicalName.localeCompare(right.business.canonicalName, "en-CA")
      || left.business.businessId.localeCompare(right.business.businessId, "en-CA"));
}
