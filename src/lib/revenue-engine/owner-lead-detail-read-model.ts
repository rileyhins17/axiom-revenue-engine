import { z } from "zod";

import type { D1DatabaseLike } from "@/lib/cloudflare";
import { EvidenceClaimSchema } from "@/lib/revenue-engine/evidence";
import {
  OWNER_LEAD_MAX_AUDIT_AGE_MS,
  OWNER_LEAD_MAX_SOURCE_AGE_MS,
  OwnerLeadContactPointSchema,
  OwnerLeadProjectionSchema,
  projectOwnerLead,
} from "@/lib/revenue-engine/owner-lead-projection";
import {
  OwnerLeadCandidateRowSchema,
  mapOwnerLeadCandidate,
  mapOwnerLeadContactRow,
  ownerLeadContactQuery,
  parseOwnerLeadJson,
} from "@/lib/revenue-engine/owner-lead-read-model";
import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";
import { DeterministicWebsiteAuditResultSchema } from "@/lib/revenue-engine/website-audit";

export const OWNER_LEAD_DETAIL_READ_MODEL_VERSION = "owner-lead-detail-read-model-v1";
export const OWNER_LEAD_HISTORY_LIMIT = 100;

const TimestampSchema = z.string().datetime({ offset: true });
export const OwnerLeadBusinessIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/, "Business identity contains unsupported route characters.");

const DetailCandidateRowSchema = OwnerLeadCandidateRowSchema.extend({
  addressLine: z.string().trim().min(1).max(300).nullable(),
  postalCode: z.string().trim().min(1).max(20).nullable(),
  geoCell: z.string().trim().min(1).max(120).nullable(),
  sourceRunId: z.string().trim().min(1).max(128),
  sourceAdapter: z.string().trim().min(1).max(80),
  websiteSnapshotId: z.string().trim().min(1).max(128),
  websiteFinalUrl: z.string().url().max(2_048).nullable(),
  websiteClassification: z.enum(["REBUILD", "NO_SITE_NEW_BUILD", "MINOR_IMPROVEMENT", "NO_OPPORTUNITY"]),
  websiteAuditVersion: z.string().trim().min(1).max(120),
  websiteDesktopArtifactRef: z.string().trim().min(1).nullable(),
  websiteMobileArtifactRef: z.string().trim().min(1).nullable(),
  websiteDomArtifactRef: z.string().trim().min(1).nullable(),
  websiteCapturedAt: TimestampSchema,
  websiteRefreshAfter: TimestampSchema,
}).strict();

const DetailEvidenceSchema = EvidenceClaimSchema.extend({
  claimId: z.string().min(1).max(256),
  sourceUrl: z.string().url().max(2_048),
  auditVersion: z.string().min(1).max(120),
  artifactRef: z.string().min(1).max(2_048).nullable(),
}).strict();

const DetailFindingSchema = z.object({
  checkId: z.string().trim().min(1).max(80),
  outcome: z.enum(["PASS", "FAIL", "UNKNOWN"]),
  severity: z.enum(["CRITICAL", "IMPORTANT", "MINOR"]),
  category: EvidenceClaimSchema.shape.category,
  scoreImpact: z.number().int().min(0).max(100),
  claimId: z.string().trim().min(1).nullable(),
  claim: DetailEvidenceSchema.nullable(),
}).strict();

const DetailContactSchema = OwnerLeadContactPointSchema.extend({
  recommended: z.boolean(),
  readiness: z.enum(["CURRENT_USABLE", "UNVERIFIED", "STALE", "BLOCKED"]),
}).strict();

const HistoryEventTypeSchema = z.enum([
  "SOURCE_CAPTURED",
  "WEBSITE_AUDITED",
  "QUALIFICATION_SCORED",
  "CONTACT_DISCOVERED",
  "CONTACT_VERIFIED",
]);

const HistoryRowSchema = z.object({
  eventType: HistoryEventTypeSchema,
  eventId: z.string().trim().min(1).max(128),
  occurredAt: TimestampSchema,
  primaryValue: z.string().trim().min(1).max(256),
  secondaryValue: z.string().trim().min(1).max(256).nullable(),
  sourceUrl: z.string().url().max(2_048).nullable(),
}).strict();

const HistoryEventSchema = HistoryRowSchema.extend({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(360),
}).omit({ primaryValue: true, secondaryValue: true }).strict();

const UnavailableHistorySchema = z.object({
  area: z.enum(["OUTREACH", "REPLIES", "OPPORTUNITIES", "CLIENTS"]),
  state: z.literal("NOT_AVAILABLE_IN_V2"),
  reason: z.string().trim().min(1).max(240),
}).strict();

export const OwnerLeadDetailResponseSchema = z.object({
  readModelVersion: z.literal(OWNER_LEAD_DETAIL_READ_MODEL_VERSION),
  generatedAt: TimestampSchema,
  lead: OwnerLeadProjectionSchema,
  identity: z.object({
    addressLine: z.string().max(300).nullable(),
    postalCode: z.string().max(20).nullable(),
    geoCell: z.string().max(120).nullable(),
    sourceRunId: z.string().min(1).max(128),
    sourceAdapter: z.string().min(1).max(80),
  }).strict(),
  website: z.object({
    snapshotId: z.string().min(1).max(128),
    siteState: z.enum(["NO_SITE", "UNREACHABLE", "CAPTURED"]),
    classification: z.enum(["REBUILD", "NO_SITE_NEW_BUILD", "MINOR_IMPROVEMENT", "NO_OPPORTUNITY"]),
    auditVersion: z.string().min(1).max(120),
    capturedAt: TimestampSchema,
    refreshAfter: TimestampSchema,
    finalUrl: z.string().url().max(2_048).nullable(),
    artifacts: z.array(z.object({
      kind: z.enum(["DESKTOP", "MOBILE", "DOM"]),
      reference: z.string().min(1).max(2_048).nullable(),
      availability: z.enum(["REFERENCE_RECORDED", "NOT_CAPTURED"]),
      previewAvailable: z.literal(false),
    }).strict()).length(3),
    findings: z.array(DetailFindingSchema).max(100),
    evidence: z.array(DetailEvidenceSchema).max(250),
    evidenceTruncated: z.boolean(),
    passedCheckCount: z.number().int().nonnegative(),
    manualReviewReasons: z.array(z.string().min(1).max(120)).max(100),
  }).strict(),
  routes: z.array(DetailContactSchema).max(100),
  ignoredRouteRows: z.number().int().nonnegative(),
  history: z.object({
    scope: z.literal("V2_SHADOW_ONLY"),
    events: z.array(HistoryEventSchema).max(OWNER_LEAD_HISTORY_LIMIT),
    truncated: z.boolean(),
    unavailable: z.array(UnavailableHistorySchema).length(4),
  }).strict(),
  authority: z.object({
    readOnly: z.literal(true),
    mutationAuthorized: z.literal(false),
    outreachAuthorized: z.literal(false),
    sendAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
}).strict();

export type OwnerLeadDetailResponse = z.infer<typeof OwnerLeadDetailResponseSchema>;

export const OWNER_LEAD_DETAIL_QUERY = `
SELECT
  business."id" AS "businessId",
  business."canonicalName" AS "canonicalName",
  business."normalizedDomain" AS "normalizedDomain",
  business."independenceStatus" AS "independenceStatus",
  business."status" AS "businessStatus",
  location."addressLine" AS "addressLine",
  location."city" AS "city",
  location."region" AS "region",
  location."country" AS "country",
  location."postalCode" AS "postalCode",
  location."geoCell" AS "geoCell",
  sourceRecord."sourceRunId" AS "sourceRunId",
  sourceRun."adapter" AS "sourceAdapter",
  sourceRecord."rawPayloadJson" AS "sourceRawPayloadJson",
  sourceRecord."capturedAt" AS "sourceCapturedAt",
  website."id" AS "websiteSnapshotId",
  website."finalUrl" AS "websiteFinalUrl",
  website."classification" AS "websiteClassification",
  website."auditVersion" AS "websiteAuditVersion",
  website."desktopArtifactRef" AS "websiteDesktopArtifactRef",
  website."mobileArtifactRef" AS "websiteMobileArtifactRef",
  website."domArtifactRef" AS "websiteDomArtifactRef",
  website."deterministicChecksJson" AS "auditJson",
  website."capturedAt" AS "websiteCapturedAt",
  website."refreshAfter" AS "websiteRefreshAfter",
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
JOIN "RevenueSourceRun" sourceRun ON sourceRun."id" = sourceRecord."sourceRunId"
JOIN "RevenueWebsiteSnapshot" website ON website."id" = (
  SELECT candidateWebsite."id"
  FROM "RevenueWebsiteSnapshot" candidateWebsite
  WHERE candidateWebsite."businessId" = business."id"
  ORDER BY candidateWebsite."capturedAt" DESC, candidateWebsite."id" DESC
  LIMIT 1
)
JOIN "RevenueQualificationSnapshot" qualification ON qualification."id" = (
  SELECT candidateQualification."id"
  FROM "RevenueQualificationSnapshot" candidateQualification
  WHERE candidateQualification."businessId" = business."id"
  ORDER BY candidateQualification."createdAt" DESC, candidateQualification."id" DESC
  LIMIT 1
)
WHERE business."id" = ?
  AND location."country" = 'CA'
  AND location."region" = 'ON'
  AND location."city" IN ('KITCHENER', 'WATERLOO', 'CAMBRIDGE')
  AND qualification."shadowOnly" = 1
LIMIT 1`;

export const OWNER_LEAD_HISTORY_QUERY = `
SELECT
  timeline."eventType" AS "eventType",
  timeline."eventId" AS "eventId",
  timeline."occurredAt" AS "occurredAt",
  timeline."primaryValue" AS "primaryValue",
  timeline."secondaryValue" AS "secondaryValue",
  timeline."sourceUrl" AS "sourceUrl"
FROM (
  SELECT
    'SOURCE_CAPTURED' AS "eventType",
    sourceRecord."id" AS "eventId",
    sourceRecord."capturedAt" AS "occurredAt",
    sourceRun."adapter" AS "primaryValue",
    sourceRecord."sourceOwnedId" AS "secondaryValue",
    NULL AS "sourceUrl"
  FROM "RevenueSourceRecord" sourceRecord
  JOIN "RevenueSourceRun" sourceRun ON sourceRun."id" = sourceRecord."sourceRunId"
  WHERE sourceRecord."businessId" = ?

  UNION ALL

  SELECT
    'WEBSITE_AUDITED',
    website."id",
    website."capturedAt",
    website."classification",
    website."auditVersion",
    website."finalUrl"
  FROM "RevenueWebsiteSnapshot" website
  WHERE website."businessId" = ?

  UNION ALL

  SELECT
    'QUALIFICATION_SCORED',
    qualification."id",
    qualification."createdAt",
    qualification."band",
    CAST(qualification."totalScore" AS TEXT),
    NULL
  FROM "RevenueQualificationSnapshot" qualification
  WHERE qualification."businessId" = ?
    AND qualification."shadowOnly" = 1

  UNION ALL

  SELECT
    'CONTACT_DISCOVERED',
    contact."id",
    contact."sourceCapturedAt",
    contact."channel",
    contact."status",
    contact."sourceUrl"
  FROM "RevenueContactPoint" contact
  WHERE contact."businessId" = ?
    AND contact."sourceCapturedAt" IS NOT NULL

  UNION ALL

  SELECT
    'CONTACT_VERIFIED',
    verification."id",
    verification."verifiedAt",
    contact."channel",
    verification."status",
    contact."sourceUrl"
  FROM "RevenueVerificationResult" verification
  JOIN "RevenueContactPoint" contact ON contact."id" = verification."contactPointId"
  WHERE contact."businessId" = ?
) timeline
ORDER BY timeline."occurredAt" DESC, timeline."eventType" ASC, timeline."eventId" ASC
LIMIT ?`;

function currentTimestamp(value: string, generatedAtMs: number, maxAgeMs: number) {
  const valueMs = Date.parse(value);
  return valueMs <= generatedAtMs && generatedAtMs - valueMs <= maxAgeMs;
}

function contactReadiness(
  contact: z.infer<typeof OwnerLeadContactPointSchema>,
  generatedAt: string,
) {
  if (contact.status === "SUPPRESSED" || contact.status === "INVALID") return "BLOCKED" as const;
  const generatedAtMs = Date.parse(generatedAt);
  if (
    contact.status === "STALE"
    || !currentTimestamp(contact.sourceCapturedAt, generatedAtMs, OWNER_LEAD_MAX_SOURCE_AGE_MS)
    || (contact.staleAfter !== null && Date.parse(contact.staleAfter) <= generatedAtMs)
  ) return "STALE" as const;
  if (contact.channel === "EMAIL") {
    const verification = contact.emailVerification;
    return contact.status === "VERIFIED"
      && verification?.status === "DELIVERABLE"
      && verification.verifiedAt !== null
      && verification.staleAfter !== null
      && Date.parse(verification.verifiedAt) <= generatedAtMs
      && Date.parse(verification.staleAfter) > generatedAtMs
      ? "CURRENT_USABLE" as const
      : "UNVERIFIED" as const;
  }
  return contact.status === "USABLE" || contact.status === "VERIFIED"
    ? "CURRENT_USABLE" as const
    : "UNVERIFIED" as const;
}

function normalizeHistoryRow(value: unknown) {
  const raw = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const sourceUrl = typeof raw.sourceUrl === "string"
    ? normalizePublicWebsiteUrl(raw.sourceUrl)
    : null;
  return HistoryRowSchema.parse({ ...raw, sourceUrl });
}

function historyEvent(row: z.infer<typeof HistoryRowSchema>) {
  const copy = {
    SOURCE_CAPTURED: {
      title: "Source record captured",
      description: `${row.primaryValue} recorded source identity ${row.secondaryValue ?? "without an external identifier"}.`,
    },
    WEBSITE_AUDITED: {
      title: "Website audit captured",
      description: `The website was classified ${row.primaryValue.toLowerCase().replaceAll("_", " ")} under ${row.secondaryValue ?? "an unrecorded audit version"}.`,
    },
    QUALIFICATION_SCORED: {
      title: "Lead quality scored",
      description: `The shadow qualification band was ${row.primaryValue.toLowerCase()} with a priority score of ${row.secondaryValue ?? "unknown"}.`,
    },
    CONTACT_DISCOVERED: {
      title: `${row.primaryValue.toLowerCase()} route discovered`,
      description: `The route entered the v2 evidence model with status ${row.secondaryValue?.toLowerCase() ?? "unknown"}.`,
    },
    CONTACT_VERIFIED: {
      title: `${row.primaryValue.toLowerCase()} verification recorded`,
      description: `The verification result was ${row.secondaryValue?.toLowerCase() ?? "unknown"}.`,
    },
  } as const;
  return HistoryEventSchema.parse({
    eventType: row.eventType,
    eventId: row.eventId,
    occurredAt: row.occurredAt,
    sourceUrl: row.sourceUrl,
    ...copy[row.eventType],
  });
}

function artifact(kind: "DESKTOP" | "MOBILE" | "DOM", reference: string | null) {
  return {
    kind,
    reference,
    availability: reference ? "REFERENCE_RECORDED" as const : "NOT_CAPTURED" as const,
    previewAvailable: false as const,
  };
}

function assertSnapshotMatchesAudit(
  row: z.infer<typeof DetailCandidateRowSchema>,
  audit: z.infer<typeof DeterministicWebsiteAuditResultSchema>,
) {
  if (
    row.websiteSnapshotId.length === 0
    || row.websiteClassification !== audit.classification
    || row.websiteAuditVersion !== audit.auditVersion
    || row.websiteCapturedAt !== audit.capturedAt
    || (row.websiteFinalUrl ? normalizePublicWebsiteUrl(row.websiteFinalUrl) : null)
      !== (audit.finalUrl ? normalizePublicWebsiteUrl(audit.finalUrl) : null)
    || row.websiteDesktopArtifactRef !== audit.desktopArtifactRef
    || row.websiteMobileArtifactRef !== audit.mobileArtifactRef
    || row.websiteDomArtifactRef !== audit.domArtifactRef
  ) {
    throw new Error("The current website snapshot does not match its deterministic audit receipt.");
  }
  if (!currentTimestamp(row.websiteCapturedAt, Date.parse(row.websiteRefreshAfter), OWNER_LEAD_MAX_AUDIT_AGE_MS)) {
    throw new Error("The website refresh window is inconsistent with the captured audit.");
  }
}

export async function readOwnerLeadDetail(
  database: D1DatabaseLike,
  businessId: string,
  generatedAt: string,
): Promise<OwnerLeadDetailResponse | null> {
  const exactBusinessId = OwnerLeadBusinessIdSchema.parse(businessId);
  TimestampSchema.parse(generatedAt);

  const candidateResult = await database
    .prepare(OWNER_LEAD_DETAIL_QUERY)
    .bind(exactBusinessId)
    .all<unknown>();
  const rawCandidate = candidateResult.results?.[0];
  if (!rawCandidate) return null;
  if ((candidateResult.results?.length ?? 0) !== 1) {
    throw new Error("The exact owner lead lookup returned more than one current candidate.");
  }
  const candidate = DetailCandidateRowSchema.parse(rawCandidate);
  if (candidate.businessId !== exactBusinessId) {
    throw new Error("The owner lead lookup returned the wrong business identity.");
  }

  const contactResult = await database
    .prepare(ownerLeadContactQuery(1))
    .bind(exactBusinessId)
    .all<unknown>();
  const contacts: Array<z.infer<typeof OwnerLeadContactPointSchema>> = [];
  let ignoredRouteRows = 0;
  for (const rawContact of contactResult.results ?? []) {
    try {
      const contact = mapOwnerLeadContactRow(rawContact);
      if (!contact || contact.businessId !== exactBusinessId) {
        ignoredRouteRows += 1;
      } else {
        contacts.push(contact);
      }
    } catch {
      ignoredRouteRows += 1;
    }
  }

  const lead = projectOwnerLead(mapOwnerLeadCandidate(candidate, generatedAt, contacts));
  const audit = DeterministicWebsiteAuditResultSchema.parse(parseOwnerLeadJson(candidate.auditJson));
  assertSnapshotMatchesAudit(candidate, audit);
  const claimsById = new Map(audit.claims.map((claim) => [claim.claimId, claim]));
  const evidence = audit.claims.slice(0, 250).map((claim) => DetailEvidenceSchema.parse({
    ...claim,
    sourceUrl: normalizePublicWebsiteUrl(claim.sourceUrl),
  }));
  const findings = audit.checks
    .filter((check) => check.outcome !== "PASS")
    .slice(0, 100)
    .map((check) => {
      const claim = check.claimId ? claimsById.get(check.claimId) ?? null : null;
      return DetailFindingSchema.parse({
        ...check,
        claim: claim ? { ...claim, sourceUrl: normalizePublicWebsiteUrl(claim.sourceUrl) } : null,
      });
    });

  const historyResult = await database
    .prepare(OWNER_LEAD_HISTORY_QUERY)
    .bind(
      exactBusinessId,
      exactBusinessId,
      exactBusinessId,
      exactBusinessId,
      exactBusinessId,
      OWNER_LEAD_HISTORY_LIMIT + 1,
    )
    .all<unknown>();
  const rawHistory = historyResult.results ?? [];
  const historyRows = rawHistory
    .slice(0, OWNER_LEAD_HISTORY_LIMIT)
    .map(normalizeHistoryRow)
    .map(historyEvent);
  const routes = contacts
    .map((contact) => DetailContactSchema.parse({
      ...contact,
      recommended: contact.contactPointId === lead.route.contactPointId,
      readiness: contactReadiness(contact, generatedAt),
    }))
    .sort((left, right) => Number(right.recommended) - Number(left.recommended)
      || left.channel.localeCompare(right.channel, "en-CA")
      || left.contactPointId.localeCompare(right.contactPointId, "en-CA"));

  return OwnerLeadDetailResponseSchema.parse({
    readModelVersion: OWNER_LEAD_DETAIL_READ_MODEL_VERSION,
    generatedAt,
    lead,
    identity: {
      addressLine: candidate.addressLine,
      postalCode: candidate.postalCode,
      geoCell: candidate.geoCell,
      sourceRunId: candidate.sourceRunId,
      sourceAdapter: candidate.sourceAdapter,
    },
    website: {
      snapshotId: candidate.websiteSnapshotId,
      siteState: audit.siteState,
      classification: audit.classification,
      auditVersion: audit.auditVersion,
      capturedAt: audit.capturedAt,
      refreshAfter: candidate.websiteRefreshAfter,
      finalUrl: audit.finalUrl ? normalizePublicWebsiteUrl(audit.finalUrl) : null,
      artifacts: [
        artifact("DESKTOP", audit.desktopArtifactRef),
        artifact("MOBILE", audit.mobileArtifactRef),
        artifact("DOM", audit.domArtifactRef),
      ],
      findings,
      evidence,
      evidenceTruncated: audit.claims.length > evidence.length || audit.checks.filter((check) => check.outcome !== "PASS").length > findings.length,
      passedCheckCount: audit.checks.filter((check) => check.outcome === "PASS").length,
      manualReviewReasons: audit.manualReviewReasons.slice(0, 100),
    },
    routes,
    ignoredRouteRows,
    history: {
      scope: "V2_SHADOW_ONLY",
      events: historyRows,
      truncated: rawHistory.length > OWNER_LEAD_HISTORY_LIMIT,
      unavailable: [
        { area: "OUTREACH", state: "NOT_AVAILABLE_IN_V2", reason: "The v2 shadow read model does not yet contain outreach touches." },
        { area: "REPLIES", state: "NOT_AVAILABLE_IN_V2", reason: "The v2 shadow read model does not yet contain inbound reply events." },
        { area: "OPPORTUNITIES", state: "NOT_AVAILABLE_IN_V2", reason: "The v2 shadow read model does not yet contain opportunity events." },
        { area: "CLIENTS", state: "NOT_AVAILABLE_IN_V2", reason: "The v2 shadow read model does not yet contain client-conversion events." },
      ],
    },
    authority: {
      readOnly: true,
      mutationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  });
}
