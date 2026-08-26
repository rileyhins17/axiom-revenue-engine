import { createHash } from "node:crypto";

import { z } from "zod";

import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";
import {
  REVENUE_QUALIFICATION_POLICY_VERSION,
  qualifyRevenueLead,
} from "@/lib/revenue-engine/qualification";
import {
  DeterministicWebsiteAuditResultSchema,
  deterministicWebsiteAuditClaimId,
} from "@/lib/revenue-engine/website-audit";

export const REVENUE_LEAD_ASSESSMENT_VERSION = "revenue-lead-assessment-v1";
export const REVENUE_LEAD_ASSESSMENT_MAX_AUDIT_AGE_MS = 24 * 60 * 60 * 1_000;
export const REVENUE_LEAD_ASSESSMENT_BASIS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;
export const REVENUE_LEAD_ASSESSMENT_REFRESH_MS = 60 * 24 * 60 * 60 * 1_000;

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const BusinessIdSchema = z.string().trim().min(1).max(128);
const ArtifactRefSchema = z.string().regex(/^artifact:sha256:[a-f0-9]{64}$/);

export const RevenueQualificationBasisClaimSchema = z.object({
  basisId: z.string().trim().min(1).max(128),
  dimension: z.enum(["BUSINESS_FIT", "TIMING"]),
  observation: z.string().trim().min(1).max(500),
  sourceUrl: z.string().url().max(2_048),
  capturedAt: TimestampSchema,
  method: z.enum(["source_api", "owner_review"]),
  confidence: z.number().int().min(80).max(100),
}).strict().superRefine((claim, context) => {
  try {
    if (normalizePublicWebsiteUrl(claim.sourceUrl) !== claim.sourceUrl) {
      context.addIssue({ code: "custom", message: "Qualification basis must use a canonical public source URL.", path: ["sourceUrl"] });
    }
  } catch {
    context.addIssue({ code: "custom", message: "Qualification basis must use a canonical public source URL.", path: ["sourceUrl"] });
  }
});

const PolicyBlockSchema = z.enum([
  "DUPLICATE",
  "LEGAL_OR_POLICY",
  "OWNER_REJECTED",
  "OUTSIDE_TARGET_MARKET",
]);

export const RevenueLeadAssessmentRequestSchema = z.object({
  assessmentVersion: z.literal(REVENUE_LEAD_ASSESSMENT_VERSION),
  idempotencyKey: z.string().trim().min(8).max(200),
  workflowReceiptId: z.string().trim().min(1).max(200),
  assessedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  businessFitScore: z.number().int().min(0).max(100),
  timingScore: z.number().int().min(0).max(100),
  basisClaims: z.array(RevenueQualificationBasisClaimSchema).min(2).max(20),
  policyBlocks: z.array(PolicyBlockSchema).max(10),
}).strict().superRefine((request, context) => {
  const assessedAtMs = Date.parse(request.assessedAt);
  const basisIds = request.basisClaims.map((claim) => claim.basisId);
  if (new Set(basisIds).size !== basisIds.length) {
    context.addIssue({ code: "custom", message: "Qualification basis identities must be unique.", path: ["basisClaims"] });
  }
  if (new Set(request.policyBlocks).size !== request.policyBlocks.length) {
    context.addIssue({ code: "custom", message: "Qualification policy blocks must be unique.", path: ["policyBlocks"] });
  }
  for (const dimension of ["BUSINESS_FIT", "TIMING"] as const) {
    if (!request.basisClaims.some((claim) => claim.dimension === dimension)) {
      context.addIssue({ code: "custom", message: `Qualification requires a ${dimension} basis.`, path: ["basisClaims"] });
    }
  }
  request.basisClaims.forEach((claim, index) => {
    const capturedAtMs = Date.parse(claim.capturedAt);
    if (capturedAtMs > assessedAtMs || assessedAtMs - capturedAtMs > REVENUE_LEAD_ASSESSMENT_BASIS_MAX_AGE_MS) {
      context.addIssue({ code: "custom", message: "Qualification basis must be current and not future-dated.", path: ["basisClaims", index, "capturedAt"] });
    }
  });
});

export type RevenueLeadAssessmentRequest = z.infer<typeof RevenueLeadAssessmentRequestSchema>;

export const RevenueLeadAssessmentBusinessSchema = z.object({
  id: BusinessIdSchema,
  canonicalName: z.string().trim().min(1).max(256),
  independenceStatus: z.enum(["UNKNOWN", "INDEPENDENT", "CHAIN", "FRANCHISE"]),
  status: z.enum(["RESEARCH_ONLY", "ACTIVE", "SUPPRESSED", "MERGED"]),
}).strict();

export const PersistedSealedWebsiteReceiptSchema = z.object({
  workflowReceiptId: z.string().trim().min(1).max(200),
  workflowRunId: z.string().uuid(),
  rowWorkflowVersion: z.string().trim().min(1).max(100),
  rowStatus: z.enum(["COMPLETED", "PARTIAL"]),
  receiptDigest: Sha256Schema,
  receiptJson: z.string().min(2).max(8_388_608),
  recordedAt: TimestampSchema,
  closureStatus: z.literal("SEALED"),
  terminalReceiptId: z.string().trim().min(1).max(200),
}).strict();

const PersistableWebsiteReceiptSchema = z.object({
  workflowVersion: z.string().trim().min(1).max(100),
  workflowId: z.string().uuid(),
  businessId: BusinessIdSchema,
  completedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  status: z.enum(["COMPLETED", "PARTIAL"]),
  audit: DeterministicWebsiteAuditResultSchema,
  budget: z.object({
    totalCostUsd: z.number().nonnegative(),
    providerOperations: z.number().int().nonnegative(),
  }).passthrough(),
}).passthrough();

const RevenueQualificationResultSchema = z.object({
  policyVersion: z.literal(REVENUE_QUALIFICATION_POLICY_VERSION),
  shadowOnly: z.literal(true),
  autonomousEmailEligible: z.literal(false),
  band: z.enum(["PRIORITY", "REVIEW", "RESEARCH", "DISQUALIFIED"]),
  totalScore: z.number().int().min(0).max(100),
  scores: z.object({
    rebuildNeed: z.number().int().min(0).max(100),
    businessFit: z.number().int().min(0).max(100),
    reachability: z.literal(0),
    timing: z.number().int().min(0).max(100),
    evidenceConfidence: z.number().int().min(0).max(100),
  }).strict(),
  recommendedChannel: z.literal("RESEARCH"),
  supportedObservationCount: z.number().int().nonnegative().max(100),
  conversionCriticalCount: z.number().int().nonnegative().max(100),
  failedGates: z.array(z.string().trim().min(1).max(120)).max(50),
  evidenceClaimIds: z.array(z.string().trim().min(1).max(256)).max(100),
}).strict();

export const RevenueLeadAssessmentSchema = z.object({
  assessmentVersion: z.literal(REVENUE_LEAD_ASSESSMENT_VERSION),
  assessmentId: z.string().regex(/^assessment:[a-f0-9]{64}$/),
  assessmentKey: z.string().trim().min(8).max(200),
  assessmentDigest: Sha256Schema,
  business: RevenueLeadAssessmentBusinessSchema,
  workflow: z.object({
    workflowReceiptId: z.string().trim().min(1).max(200),
    workflowRunId: z.string().uuid(),
    workflowVersion: z.string().trim().min(1).max(100),
    receiptDigest: Sha256Schema,
    completedAt: TimestampSchema,
    recordedAt: TimestampSchema,
    status: z.enum(["COMPLETED", "PARTIAL"]),
    sealed: z.literal(true),
  }).strict(),
  websiteSnapshotId: z.string().regex(/^website:[a-f0-9]{64}$/),
  qualificationSnapshotId: z.string().regex(/^qualification:[a-f0-9]{64}$/),
  qualificationSnapshotKey: z.string().regex(/^qualification-key:[a-f0-9]{64}$/),
  auditDigest: Sha256Schema,
  qualificationDigest: Sha256Schema,
  basisDigest: Sha256Schema,
  websiteUrl: z.string().url().max(2_048),
  refreshAfter: TimestampSchema,
  audit: DeterministicWebsiteAuditResultSchema,
  qualification: RevenueQualificationResultSchema,
  basisClaims: z.array(RevenueQualificationBasisClaimSchema).min(2).max(20),
  policyBlocks: z.array(PolicyBlockSchema).max(10),
  assessedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  authority: z.object({
    runtimeConnected: z.literal(false),
    outreachAuthorized: z.literal(false),
    sendAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
}).strict();

export type RevenueLeadAssessment = z.infer<typeof RevenueLeadAssessmentSchema>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function revenueLeadAssessmentCanonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function revenueLeadAssessmentDigest(value: unknown) {
  return createHash("sha256").update(revenueLeadAssessmentCanonicalJson(value)).digest("hex");
}

function assertPublicUrl(value: string, label: string) {
  try {
    return normalizePublicWebsiteUrl(value);
  } catch {
    throw new Error(`${label} must be a canonical public HTTP(S) URL.`);
  }
}

function addMilliseconds(value: string, milliseconds: number) {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

const POLICY_BLOCK_CODES: Record<z.infer<typeof PolicyBlockSchema>, string> = {
  DUPLICATE: "duplicate_business",
  LEGAL_OR_POLICY: "legal_or_policy_block",
  OWNER_REJECTED: "owner_rejected",
  OUTSIDE_TARGET_MARKET: "outside_target_market",
};

export function buildRevenueLeadAssessment(input: {
  request: RevenueLeadAssessmentRequest;
  business: z.infer<typeof RevenueLeadAssessmentBusinessSchema>;
  sealedReceipt: z.infer<typeof PersistedSealedWebsiteReceiptSchema>;
}): RevenueLeadAssessment {
  const request = RevenueLeadAssessmentRequestSchema.parse(input.request);
  const business = RevenueLeadAssessmentBusinessSchema.parse(input.business);
  const sealed = PersistedSealedWebsiteReceiptSchema.parse(input.sealedReceipt);
  if (sealed.workflowReceiptId !== request.workflowReceiptId || sealed.terminalReceiptId !== sealed.workflowReceiptId) {
    throw new Error("Assessment requires the exact terminal sealed workflow receipt.");
  }

  let rawReceipt: unknown;
  try {
    rawReceipt = JSON.parse(sealed.receiptJson) as unknown;
  } catch {
    throw new Error("The sealed workflow receipt JSON is invalid.");
  }
  if (revenueLeadAssessmentDigest(rawReceipt) !== sealed.receiptDigest) {
    throw new Error("The sealed workflow receipt digest does not bind its exact JSON.");
  }
  const receipt = PersistableWebsiteReceiptSchema.parse(rawReceipt);
  if (
    receipt.workflowId !== sealed.workflowRunId
    || receipt.workflowVersion !== sealed.rowWorkflowVersion
    || receipt.status !== sealed.rowStatus
    || receipt.businessId !== business.id
    || receipt.audit.businessId !== business.id
  ) {
    throw new Error("Workflow receipt, audit, and business identities do not match.");
  }

  const assessedAtMs = Date.parse(request.assessedAt);
  const auditCapturedAtMs = Date.parse(receipt.audit.capturedAt);
  if (
    Date.parse(receipt.completedAt) > assessedAtMs
    || Date.parse(sealed.recordedAt) > assessedAtMs
    || Date.parse(sealed.recordedAt) < Date.parse(receipt.completedAt)
    || auditCapturedAtMs > Date.parse(receipt.completedAt)
    || assessedAtMs - auditCapturedAtMs > REVENUE_LEAD_ASSESSMENT_MAX_AUDIT_AGE_MS
  ) {
    throw new Error("Only a current, non-future sealed audit can become a shadow assessment.");
  }

  const claimIds = receipt.audit.claims.map((claim) => claim.claimId);
  if (new Set(claimIds).size !== claimIds.length) throw new Error("Audit evidence claim identities must be unique.");
  const checkClaimIds = receipt.audit.checks.flatMap((check) => check.claimId ? [check.claimId] : []);
  if (
    checkClaimIds.length !== claimIds.length
    || [...checkClaimIds].sort().some((claimId, index) => claimId !== [...claimIds].sort()[index])
  ) {
    throw new Error("Audit checks and evidence claims must form one exact set.");
  }
  for (const claim of receipt.audit.claims) {
    if (assertPublicUrl(claim.sourceUrl, "Audit evidence") !== claim.sourceUrl) {
      throw new Error("Audit evidence must use a canonical public HTTP(S) URL.");
    }
    if (claim.capturedAt !== receipt.audit.capturedAt || claim.auditVersion !== receipt.audit.auditVersion) {
      throw new Error("Audit evidence provenance must match the exact audit capture and version.");
    }
    if (claim.artifactRef && !ArtifactRefSchema.safeParse(claim.artifactRef).success) {
      throw new Error("Persisted audit evidence must use a content-addressed artifact reference.");
    }
  }
  for (const check of receipt.audit.checks) {
    if (
      check.claimId
      && check.claimId !== deterministicWebsiteAuditClaimId(business.id, receipt.audit.capturedAt, check.checkId)
    ) {
      throw new Error("Audit evidence identity does not bind the exact business, capture, and check.");
    }
  }
  for (const artifactRef of [receipt.audit.desktopArtifactRef, receipt.audit.mobileArtifactRef, receipt.audit.domArtifactRef]) {
    if (artifactRef && !ArtifactRefSchema.safeParse(artifactRef).success) {
      throw new Error("Persisted website artifacts must use content-addressed references.");
    }
  }

  const websiteUrl = assertPublicUrl(
    receipt.audit.finalUrl ?? receipt.audit.claims[0]?.sourceUrl ?? "",
    "Website snapshot",
  );
  const derivedBlocks = [
    ...request.policyBlocks.map((block) => POLICY_BLOCK_CODES[block]),
    ...(business.independenceStatus === "CHAIN" || business.independenceStatus === "FRANCHISE"
      ? ["chain_or_franchise"] : []),
    ...(business.status === "SUPPRESSED" ? ["business_suppressed"] : []),
    ...(business.status === "MERGED" ? ["business_merged"] : []),
  ];
  const qualification = RevenueQualificationResultSchema.parse(qualifyRevenueLead({
    scores: {
      rebuildNeed: receipt.audit.rebuildNeedScore,
      businessFit: request.businessFitScore,
      reachability: 0,
      timing: request.timingScore,
      evidenceConfidence: receipt.audit.evidenceConfidence,
    },
    evidenceClaims: receipt.audit.claims,
    availableChannels: ["RESEARCH"],
    blocks: Array.from(new Set(derivedBlocks)).sort(),
  }));
  const auditDigest = revenueLeadAssessmentDigest(receipt.audit);
  const basisDigest = revenueLeadAssessmentDigest({
    basisClaims: request.basisClaims,
    businessFitScore: request.businessFitScore,
    timingScore: request.timingScore,
    policyBlocks: request.policyBlocks,
  });
  const qualificationDigest = revenueLeadAssessmentDigest(qualification);
  const websiteSnapshotId = `website:${auditDigest}`;
  const qualificationSnapshotId = `qualification:${revenueLeadAssessmentDigest({
    idempotencyKey: request.idempotencyKey,
    qualificationDigest,
  })}`;
  const qualificationSnapshotKey = `qualification-key:${revenueLeadAssessmentDigest(request.idempotencyKey)}`;
  const assessmentId = `assessment:${revenueLeadAssessmentDigest(request.idempotencyKey)}`;
  const core = {
    assessmentVersion: request.assessmentVersion,
    assessmentId,
    assessmentKey: request.idempotencyKey,
    business,
    workflow: {
      workflowReceiptId: sealed.workflowReceiptId,
      workflowRunId: sealed.workflowRunId,
      workflowVersion: receipt.workflowVersion,
      receiptDigest: sealed.receiptDigest,
      completedAt: receipt.completedAt,
      recordedAt: sealed.recordedAt,
      status: receipt.status,
      sealed: true as const,
    },
    websiteSnapshotId,
    qualificationSnapshotId,
    qualificationSnapshotKey,
    auditDigest,
    qualificationDigest,
    basisDigest,
    websiteUrl,
    refreshAfter: addMilliseconds(receipt.audit.capturedAt, REVENUE_LEAD_ASSESSMENT_REFRESH_MS),
    audit: receipt.audit,
    qualification,
    basisClaims: request.basisClaims,
    policyBlocks: request.policyBlocks,
    assessedAt: request.assessedAt,
    mode: "SHADOW" as const,
    authority: {
      runtimeConnected: false as const,
      outreachAuthorized: false as const,
      sendAuthorized: false as const,
      providerOperationsAuthorized: 0 as const,
      costAuthorizedUsd: 0 as const,
    },
  };
  return RevenueLeadAssessmentSchema.parse({
    ...core,
    assessmentDigest: revenueLeadAssessmentDigest(core),
  });
}
