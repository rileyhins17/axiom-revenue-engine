import { z } from "zod";

import type { D1DatabaseLike } from "@/lib/cloudflare";
import { OwnerLeadBusinessIdSchema } from "@/lib/revenue-engine/owner-lead-identity";
import {
  OWNER_LEAD_PROJECTION_VERSION,
  OwnerLeadContactPointSchema,
  OwnerLeadProjectionSchema,
  projectOwnerLead,
  sortOwnerLeadProjections,
  type OwnerLeadProjection,
  type OwnerLeadProjectionInput,
} from "@/lib/revenue-engine/owner-lead-projection";
import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";
import { DeterministicWebsiteAuditResultSchema } from "@/lib/revenue-engine/website-audit";
import { legacyPartitionPredicates, readRevenueEvidencePartition, type RevenueEvidencePartition } from "@/lib/revenue-engine/revenue-evidence-partition";

export const OWNER_LEAD_READ_MODEL_VERSION = "owner-lead-read-model-v1";
export const OWNER_LEAD_DEFAULT_LIMIT = 50;
export const OWNER_LEAD_MAX_LIMIT = 100;

const TimestampSchema = z.string().datetime({ offset: true });
const JsonTextSchema = z.string().min(1).max(2_000_000);
const D1BooleanSchema = z.union([z.literal(0), z.literal(1), z.boolean()]).transform(Boolean);

export const OwnerLeadCandidateRowSchema = z.object({
  businessId: OwnerLeadBusinessIdSchema,
  canonicalName: z.string().trim().min(1).max(256),
  normalizedDomain: z.string().trim().min(1).max(253).nullable(),
  independenceStatus: z.enum(["UNKNOWN", "INDEPENDENT", "CHAIN", "FRANCHISE"]),
  businessStatus: z.enum(["RESEARCH_ONLY", "ACTIVE", "SUPPRESSED", "MERGED"]),
  city: z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]),
  region: z.literal("ON"),
  country: z.literal("CA"),
  sourceRawPayloadJson: JsonTextSchema,
  sourceCapturedAt: TimestampSchema,
  auditJson: JsonTextSchema,
  qualificationSnapshotId: z.string().trim().min(1).max(128),
  qualificationBusinessId: z.string().trim().min(1).max(128),
  qualificationPolicyVersion: z.string().trim().min(1).max(80),
  qualificationShadowOnly: D1BooleanSchema,
  qualificationTotalScore: z.number().int().min(0).max(100),
  qualificationRebuildNeedScore: z.number().int().min(0).max(100),
  qualificationBusinessFitScore: z.number().int().min(0).max(100),
  qualificationReachabilityScore: z.number().int().min(0).max(100),
  qualificationTimingScore: z.number().int().min(0).max(100),
  qualificationEvidenceConfidenceScore: z.number().int().min(0).max(100),
  qualificationBand: z.enum(["PRIORITY", "REVIEW", "RESEARCH", "DISQUALIFIED"]),
  qualificationRecommendedChannel: z.enum(["EMAIL", "PHONE", "FORM", "SOCIAL", "RESEARCH"]),
  qualificationSupportedObservationCount: z.number().int().nonnegative().max(100),
  qualificationConversionCriticalCount: z.number().int().nonnegative().max(100),
  qualificationFailedGatesJson: z.string().min(2).max(20_000),
  qualificationEvidenceClaimIdsJson: z.string().min(2).max(100_000),
  qualificationCreatedAt: TimestampSchema,
}).strict();

export const OwnerLeadContactRowSchema = z.object({
  contactPointId: z.string().trim().min(1).max(128),
  businessId: z.string().trim().min(1).max(128),
  channel: z.enum(["EMAIL", "PHONE", "FORM", "SOCIAL"]),
  value: z.string().trim().min(1).max(2_048),
  label: z.string().trim().min(1).max(120).nullable(),
  personName: z.string().trim().min(1).max(120).nullable(),
  role: z.string().trim().min(1).max(120).nullable(),
  sourceUrl: z.string().url().max(2_048).nullable(),
  sourceCapturedAt: TimestampSchema.nullable(),
  automationPermitted: D1BooleanSchema,
  contactStatus: z.enum(["CANDIDATE", "USABLE", "VERIFIED", "SUPPRESSED", "INVALID", "STALE"]),
  verificationStatus: z.enum(["DELIVERABLE", "UNVERIFIED", "UNKNOWN", "UNDELIVERABLE", "CATCH_ALL"]).nullable(),
  verificationCatchAll: z.union([z.literal(0), z.literal(1), z.boolean()]).transform(Boolean).nullable(),
  verificationVerifiedAt: TimestampSchema.nullable(),
  verificationStaleAfter: TimestampSchema.nullable(),
}).strict();

export const OwnerLeadSourcePayloadSchema = z.object({
  sourceEvidenceUrl: z.string().url().max(2_048),
  websiteUrl: z.string().url().max(2_048).nullable(),
  niche: z.enum(["ROOFING", "HVAC", "LANDSCAPING"]),
}).passthrough();

const StringArraySchema = z.array(z.string().trim().min(1).max(256)).max(100);

const RejectionSchema = z.object({
  businessId: z.string().trim().min(1).max(128),
  code: z.enum(["INVALID_CANDIDATE_ROW", "INVALID_PROJECTION_INPUT"]),
}).strict();

export const OwnerLeadListResponseSchema = z.object({
  readModelVersion: z.literal(OWNER_LEAD_READ_MODEL_VERSION),
  generatedAt: TimestampSchema,
  leads: z.array(OwnerLeadProjectionSchema).max(OWNER_LEAD_MAX_LIMIT),
  rejections: z.array(RejectionSchema).max(OWNER_LEAD_MAX_LIMIT),
  summary: z.object({
    candidateRows: z.number().int().nonnegative().max(OWNER_LEAD_MAX_LIMIT),
    returned: z.number().int().nonnegative().max(OWNER_LEAD_MAX_LIMIT),
    ignoredContactRows: z.number().int().nonnegative(),
    rejectedBusinesses: z.number().int().nonnegative().max(OWNER_LEAD_MAX_LIMIT),
    readyForReview: z.number().int().nonnegative().max(OWNER_LEAD_MAX_LIMIT),
    needsRefresh: z.number().int().nonnegative().max(OWNER_LEAD_MAX_LIMIT),
    blocked: z.number().int().nonnegative().max(OWNER_LEAD_MAX_LIMIT),
  }).strict(),
  authority: z.object({
    readOnly: z.literal(true),
    mutationAuthorized: z.literal(false),
    outreachAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
}).strict();

export type OwnerLeadListResponse = z.infer<typeof OwnerLeadListResponseSchema>;

export function ownerLeadCandidateQuery(partition: RevenueEvidencePartition) {
  const predicates = legacyPartitionPredicates(partition);
  return `
SELECT
  business."id" AS "businessId",
  business."canonicalName" AS "canonicalName",
  business."normalizedDomain" AS "normalizedDomain",
  business."independenceStatus" AS "independenceStatus",
  business."status" AS "businessStatus",
  location."city" AS "city",
  location."region" AS "region",
  location."country" AS "country",
  sourceRecord."rawPayloadJson" AS "sourceRawPayloadJson",
  sourceRecord."capturedAt" AS "sourceCapturedAt",
  website."deterministicChecksJson" AS "auditJson",
  qualification."id" AS "qualificationSnapshotId",
  qualification."businessId" AS "qualificationBusinessId",
  qualification."policyVersion" AS "qualificationPolicyVersion",
  qualification."shadowOnly" AS "qualificationShadowOnly",
  qualification."totalScore" AS "qualificationTotalScore",
  qualification."rebuildNeedScore" AS "qualificationRebuildNeedScore",
  qualification."businessFitScore" AS "qualificationBusinessFitScore",
  qualification."reachabilityScore" AS "qualificationReachabilityScore",
  qualification."timingScore" AS "qualificationTimingScore",
  qualification."evidenceConfidenceScore" AS "qualificationEvidenceConfidenceScore",
  qualification."band" AS "qualificationBand",
  qualification."recommendedChannel" AS "qualificationRecommendedChannel",
  qualification."supportedObservationCount" AS "qualificationSupportedObservationCount",
  qualification."conversionCriticalCount" AS "qualificationConversionCriticalCount",
  qualification."failedGatesJson" AS "qualificationFailedGatesJson",
  qualification."evidenceClaimIdsJson" AS "qualificationEvidenceClaimIdsJson",
  qualification."createdAt" AS "qualificationCreatedAt"
FROM "RevenueBusiness" business
JOIN "RevenueLocation" location ON location."id" = (
  SELECT candidateLocation."id"
  FROM "RevenueLocation" candidateLocation
  WHERE candidateLocation."businessId" = business."id"
  ORDER BY candidateLocation."createdAt" DESC, candidateLocation."id" DESC
  LIMIT 1
)
JOIN "RevenueSourceRecord" sourceRecord ON sourceRecord."id" = (
  SELECT candidateSource."id"
  FROM "RevenueSourceRecord" candidateSource
  WHERE candidateSource."businessId" = business."id"
  ORDER BY candidateSource."capturedAt" DESC, candidateSource."id" DESC
  LIMIT 1
)
JOIN "RevenueWebsiteSnapshot" website ON website."id" = (
  SELECT candidateWebsite."id"
  FROM "RevenueWebsiteSnapshot" candidateWebsite
  WHERE candidateWebsite."businessId" = business."id"${predicates.websiteCandidate}
  ORDER BY candidateWebsite."capturedAt" DESC, candidateWebsite."id" DESC
  LIMIT 1
)${predicates.websiteOuter}
JOIN "RevenueQualificationSnapshot" qualification ON qualification."id" = (
  SELECT candidateQualification."id"
  FROM "RevenueQualificationSnapshot" candidateQualification
  WHERE candidateQualification."businessId" = business."id"${predicates.qualificationCandidate}
  ORDER BY candidateQualification."createdAt" DESC, candidateQualification."id" DESC
  LIMIT 1
)${predicates.qualificationOuter}
WHERE location."country" = 'CA'
  AND location."region" = 'ON'
  AND location."city" IN ('KITCHENER', 'WATERLOO', 'CAMBRIDGE')
  AND qualification."shadowOnly" = 1${predicates.qualificationOuter}
ORDER BY qualification."totalScore" DESC, qualification."createdAt" DESC, business."id" ASC
LIMIT ?`;
}

export const OWNER_LEAD_CANDIDATE_QUERY = ownerLeadCandidateQuery("LEGACY");

export function ownerLeadContactQuery(businessCount: number, partition: RevenueEvidencePartition = "LEGACY") {
  if (!Number.isInteger(businessCount) || businessCount < 1 || businessCount > OWNER_LEAD_MAX_LIMIT) {
    throw new Error("Owner lead contact query requires one to 100 exact business IDs.");
  }
  const placeholders = Array.from({ length: businessCount }, () => "?").join(", ");
  const predicates = legacyPartitionPredicates(partition);
  return `
SELECT
  contact."id" AS "contactPointId",
  contact."businessId" AS "businessId",
  contact."channel" AS "channel",
  contact."value" AS "value",
  contact."label" AS "label",
  contact."personName" AS "personName",
  contact."role" AS "role",
  contact."sourceUrl" AS "sourceUrl",
  contact."sourceCapturedAt" AS "sourceCapturedAt",
  contact."automationPermitted" AS "automationPermitted",
  COALESCE(verification."ownerStatus", contact."status") AS "contactStatus",
  CASE WHEN contact."channel" = 'EMAIL' THEN verification."status" ELSE NULL END AS "verificationStatus",
  verification."catchAll" AS "verificationCatchAll",
  verification."verifiedAt" AS "verificationVerifiedAt",
  verification."staleAfter" AS "verificationStaleAfter"
FROM "RevenueContactPoint" contact
LEFT JOIN "RevenueVerificationResult" verification ON verification."id" = (
  SELECT candidateVerification."id"
  FROM "RevenueVerificationResult" candidateVerification
  WHERE candidateVerification."contactPointId" = contact."id"${predicates.verificationCandidate}
  ORDER BY candidateVerification."verifiedAt" DESC, candidateVerification."id" DESC
  LIMIT 1
)
WHERE contact."businessId" IN (${placeholders})${predicates.contactOuter}
  AND (
    contact."candidateId" IS NULL
    OR contact."id" = (
      SELECT latestContact."id"
      FROM "RevenueContactPoint" latestContact
      WHERE latestContact."businessId" = contact."businessId"
        AND latestContact."candidateId" = contact."candidateId"
        ${predicates.contactCandidate}
      ORDER BY latestContact."sourceCapturedAt" DESC, latestContact."createdAt" DESC, latestContact."id" DESC
      LIMIT 1
    )
  )
ORDER BY contact."businessId" ASC, contact."channel" ASC, contact."id" ASC`;
}

export function parseOwnerLeadJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizePublicUrl(value: string) {
  return normalizePublicWebsiteUrl(value);
}

export function mapOwnerLeadContactRow(value: unknown) {
  const row = OwnerLeadContactRowSchema.parse(value);
  if (!row.sourceUrl || !row.sourceCapturedAt) return null;
  const recipientKind = row.personName
    ? "NAMED_PERSON" as const
    : row.channel === "EMAIL" && row.role
      ? "ROLE" as const
      : "BUSINESS" as const;
  const contactValue = row.channel === "FORM" || row.channel === "SOCIAL"
    ? normalizePublicUrl(row.value)
    : row.value;
  const verificationStatus = row.verificationCatchAll
    ? "CATCH_ALL" as const
    : row.verificationStatus;
  return OwnerLeadContactPointSchema.parse({
    contactPointId: row.contactPointId,
    businessId: row.businessId,
    channel: row.channel,
    value: contactValue,
    label: row.label,
    personName: row.personName,
    role: row.role,
    recipientKind,
    sourceUrl: normalizePublicUrl(row.sourceUrl),
    sourceCapturedAt: row.sourceCapturedAt,
    staleAfter: null,
    status: row.contactStatus,
    emailVerification: row.channel === "EMAIL" ? {
      status: verificationStatus ?? "UNVERIFIED",
      verifiedAt: row.verificationVerifiedAt,
      staleAfter: row.verificationStaleAfter,
    } : null,
    automationPermitted: row.automationPermitted,
  });
}

function validateAuditPublicUrls(value: unknown) {
  const audit = DeterministicWebsiteAuditResultSchema.parse(value);
  if (audit.finalUrl) normalizePublicUrl(audit.finalUrl);
  audit.claims.forEach((claim) => normalizePublicUrl(claim.sourceUrl));
  return audit;
}

export function mapOwnerLeadCandidate(
  row: z.infer<typeof OwnerLeadCandidateRowSchema>,
  projectedAt: string,
  contacts: OwnerLeadProjectionInput["contactPoints"],
): OwnerLeadProjectionInput {
  const payload = OwnerLeadSourcePayloadSchema.parse(parseOwnerLeadJson(row.sourceRawPayloadJson));
  const audit = validateAuditPublicUrls(parseOwnerLeadJson(row.auditJson));
  const failedGates = StringArraySchema.parse(parseOwnerLeadJson(row.qualificationFailedGatesJson));
  const evidenceClaimIds = StringArraySchema.parse(parseOwnerLeadJson(row.qualificationEvidenceClaimIdsJson));
  const sourceEvidenceUrl = normalizePublicUrl(payload.sourceEvidenceUrl);
  const websiteUrl = payload.websiteUrl ? normalizePublicUrl(payload.websiteUrl) : null;

  return {
    projectionVersion: OWNER_LEAD_PROJECTION_VERSION,
    projectedAt,
    business: {
      businessId: row.businessId,
      canonicalName: row.canonicalName,
      niche: payload.niche,
      normalizedDomain: row.normalizedDomain,
      websiteUrl,
      independenceStatus: row.independenceStatus,
      status: row.businessStatus,
      location: { city: row.city, region: row.region, country: row.country },
      sourceEvidenceUrl,
      sourceCapturedAt: row.sourceCapturedAt,
    },
    audit,
    qualification: {
      snapshotId: row.qualificationSnapshotId,
      businessId: row.qualificationBusinessId,
      policyVersion: row.qualificationPolicyVersion,
      shadowOnly: row.qualificationShadowOnly as true,
      totalScore: row.qualificationTotalScore,
      scores: {
        rebuildNeed: row.qualificationRebuildNeedScore,
        businessFit: row.qualificationBusinessFitScore,
        reachability: row.qualificationReachabilityScore,
        timing: row.qualificationTimingScore,
        evidenceConfidence: row.qualificationEvidenceConfidenceScore,
      },
      band: row.qualificationBand,
      recommendedChannel: row.qualificationRecommendedChannel,
      supportedObservationCount: row.qualificationSupportedObservationCount,
      conversionCriticalCount: row.qualificationConversionCriticalCount,
      failedGates,
      evidenceClaimIds,
      createdAt: row.qualificationCreatedAt,
    },
    contactPoints: contacts,
  };
}

function boundedLimit(value: number | undefined) {
  if (value === undefined) return OWNER_LEAD_DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > OWNER_LEAD_MAX_LIMIT) {
    throw new Error("Owner lead list limit must be an integer from one to 100.");
  }
  return value;
}

export async function readOwnerLeadList(
  database: D1DatabaseLike,
  generatedAt: string,
  requestedLimit?: number,
): Promise<OwnerLeadListResponse> {
  TimestampSchema.parse(generatedAt);
  const limit = boundedLimit(requestedLimit);
  const partition = await readRevenueEvidencePartition(database);
  const candidateResult = await database.prepare(ownerLeadCandidateQuery(partition)).bind(limit).all<unknown>();
  const candidateRows = candidateResult.results ?? [];
  const candidateIdentities = candidateRows.map((value) => OwnerLeadCandidateRowSchema.safeParse(value))
    .filter((result) => result.success)
    .map((result) => result.data.businessId);
  const uniqueBusinessIds = Array.from(new Set(candidateIdentities)).sort();

  const contactsByBusiness = new Map<string, OwnerLeadProjectionInput["contactPoints"]>();
  let ignoredContactRows = 0;
  if (uniqueBusinessIds.length > 0) {
    const contactResult = await database
      .prepare(ownerLeadContactQuery(uniqueBusinessIds.length, partition))
      .bind(...uniqueBusinessIds)
      .all<unknown>();
    for (const rawContact of contactResult.results ?? []) {
      try {
        const contact = mapOwnerLeadContactRow(rawContact);
        if (!contact) {
          ignoredContactRows += 1;
          continue;
        }
        const group = contactsByBusiness.get(contact.businessId) ?? [];
        group.push(contact);
        contactsByBusiness.set(contact.businessId, group);
      } catch {
        ignoredContactRows += 1;
      }
    }
  }

  const projections: OwnerLeadProjection[] = [];
  const rejections: z.infer<typeof RejectionSchema>[] = [];
  for (const rawCandidate of candidateRows) {
    const candidate = OwnerLeadCandidateRowSchema.safeParse(rawCandidate);
    if (!candidate.success) {
      const possibleBusinessId = typeof rawCandidate === "object" && rawCandidate !== null && "businessId" in rawCandidate
        ? String(rawCandidate.businessId).slice(0, 128)
        : "unknown";
      rejections.push(RejectionSchema.parse({ businessId: possibleBusinessId || "unknown", code: "INVALID_CANDIDATE_ROW" }));
      continue;
    }
    try {
      const projectionInput = mapOwnerLeadCandidate(
        candidate.data,
        generatedAt,
        contactsByBusiness.get(candidate.data.businessId) ?? [],
      );
      projections.push(projectOwnerLead(projectionInput));
    } catch {
      rejections.push(RejectionSchema.parse({ businessId: candidate.data.businessId, code: "INVALID_PROJECTION_INPUT" }));
    }
  }

  const leads = sortOwnerLeadProjections(projections);
  return OwnerLeadListResponseSchema.parse({
    readModelVersion: OWNER_LEAD_READ_MODEL_VERSION,
    generatedAt,
    leads,
    rejections,
    summary: {
      candidateRows: candidateRows.length,
      returned: leads.length,
      ignoredContactRows,
      rejectedBusinesses: rejections.length,
      readyForReview: leads.filter((lead) => lead.attention === "READY_FOR_REVIEW" || lead.attention === "REVIEW").length,
      needsRefresh: leads.filter((lead) => lead.attention === "NEEDS_REFRESH").length,
      blocked: leads.filter((lead) => lead.attention === "BLOCKED").length,
    },
    authority: {
      readOnly: true,
      mutationAuthorized: false,
      outreachAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  });
}
