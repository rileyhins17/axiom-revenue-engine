import { z } from "zod";

import type {
  PrivateKwOwnerLabelSubmission,
  PrivateKwOwnerLabelingPacket,
} from "@/lib/revenue-engine/private-kw-owner-labeling";

export const OWNER_LABELING_WORKSPACE_VERSION = "owner-labeling-workspace-v1";
export const OWNER_LABELING_DRAFT_VERSION = "owner-labeling-draft-v1";

export const OwnerWorkspaceLabelSchema = z.enum(["STRONG", "WEAK", "WRONG"]);
export const OwnerWorkspaceReasonSchema = z.enum([
  "GOOD_COMMERCIAL_FIT",
  "CLEAR_REBUILD_NEED",
  "WEBSITE_ALREADY_STRONG",
  "TOO_SMALL_OR_LOW_VALUE",
  "CHAIN_OR_FRANCHISE",
  "NOT_LOCAL",
  "WRONG_BUSINESS_TYPE",
  "WRONG_BUSINESS_IDENTITY",
  "WEAK_OR_STALE_EVIDENCE",
  "NO_REALISTIC_ROUTE",
  "OTHER",
]);

export type OwnerWorkspaceLabel = z.infer<typeof OwnerWorkspaceLabelSchema>;
export type OwnerWorkspaceReason = z.infer<typeof OwnerWorkspaceReasonSchema>;

export const OWNER_LABEL_OPTIONS: ReadonlyArray<{
  value: OwnerWorkspaceLabel;
  label: string;
  explanation: string;
}> = [
  { value: "STRONG", label: "Strong", explanation: "Axiom should seriously consider this business." },
  { value: "WEAK", label: "Weak", explanation: "Real business, but not a good enough opportunity." },
  { value: "WRONG", label: "Wrong", explanation: "Wrong identity, market, niche, or business type." },
];

export const OWNER_REASON_OPTIONS: Record<OwnerWorkspaceLabel, ReadonlyArray<{
  value: OwnerWorkspaceReason;
  label: string;
}>> = {
  STRONG: [
    { value: "GOOD_COMMERCIAL_FIT", label: "Good commercial fit" },
    { value: "CLEAR_REBUILD_NEED", label: "Clear rebuild need" },
    { value: "OTHER", label: "Another strong reason" },
  ],
  WEAK: [
    { value: "WEBSITE_ALREADY_STRONG", label: "Website is already strong" },
    { value: "TOO_SMALL_OR_LOW_VALUE", label: "Too small or low value" },
    { value: "WEAK_OR_STALE_EVIDENCE", label: "Evidence is weak or stale" },
    { value: "NO_REALISTIC_ROUTE", label: "No realistic contact route" },
    { value: "OTHER", label: "Another weakness" },
  ],
  WRONG: [
    { value: "CHAIN_OR_FRANCHISE", label: "Chain or franchise" },
    { value: "NOT_LOCAL", label: "Not in the local market" },
    { value: "WRONG_BUSINESS_TYPE", label: "Wrong business type" },
    { value: "WRONG_BUSINESS_IDENTITY", label: "Wrong business identity" },
    { value: "OTHER", label: "Another hard mismatch" },
  ],
};

const ScoresSchema = z.object({
  businessFit: z.number().int().min(0).max(100),
  rebuildNeed: z.number().int().min(0).max(100),
  reachability: z.number().int().min(0).max(100),
  timing: z.number().int().min(0).max(100),
  evidenceConfidence: z.number().int().min(0).max(100),
}).strict();

const WorkspaceClaimSchema = z.object({
  claimId: z.string().trim().min(1),
  observation: z.string().trim().min(1),
  sourceUrl: z.string().url(),
  capturedAt: z.string().datetime({ offset: true }),
  method: z.string().trim().min(1),
  confidence: z.number().int().min(0).max(100),
  conversionCritical: z.boolean(),
  category: z.string().trim().min(1),
  severity: z.enum(["CRITICAL", "IMPORTANT", "MINOR"]),
}).strict();

const WorkspaceEntrySchema = z.object({
  leadId: z.string().trim().min(1).max(128),
  businessId: z.string().trim().min(1).max(128),
  businessName: z.string().trim().min(1).max(256),
  city: z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]),
  niche: z.enum(["ROOFING", "HVAC", "LANDSCAPING"]),
  sourceEvidenceUrl: z.string().url(),
  websiteUrl: z.string().url().nullable(),
  audit: z.object({
    classification: z.enum(["REBUILD", "NO_SITE_NEW_BUILD", "MINOR_IMPROVEMENT", "NO_OPPORTUNITY"]),
    siteState: z.enum(["NO_SITE", "UNREACHABLE", "CAPTURED"]),
    capturedAt: z.string().datetime({ offset: true }),
    claims: z.array(WorkspaceClaimSchema).max(50),
    manualReviewReasons: z.array(z.string().trim().min(1).max(120)).max(50),
  }).strict(),
  engineAssessment: z.object({
    label: OwnerWorkspaceLabelSchema,
    scores: ScoresSchema,
    policyVersion: z.string().trim().min(1).max(80),
    assessedAt: z.string().datetime({ offset: true }),
  }).strict(),
  ownerReview: z.object({
    label: z.enum(["UNREVIEWED", "STRONG", "WEAK", "WRONG"]),
    reasons: z.array(OwnerWorkspaceReasonSchema).max(5),
    notes: z.string().trim().max(500),
    reviewedAt: z.string().datetime({ offset: true }).nullable(),
  }).strict(),
}).strict();

export const OwnerLabelingWorkspaceResponseSchema = z.object({
  workspaceVersion: z.literal(OWNER_LABELING_WORKSPACE_VERSION),
  packetId: z.string().regex(/^kw-owner-labeling:[a-f0-9]{64}$/),
  packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceImportId: z.string().trim().min(8).max(128),
  policyVersion: z.string().trim().min(1).max(80),
  preparedAt: z.string().datetime({ offset: true }),
  summary: z.object({
    targetSize: z.literal(50),
    loaded: z.literal(50),
    reviewed: z.number().int().min(0).max(50),
    agreements: z.number().int().min(0).max(50),
    agreementPercent: z.number().int().min(0).max(100),
    ready: z.boolean(),
    gateReasons: z.array(z.string().trim().min(1).max(120)).max(10),
  }).strict(),
  entries: z.array(WorkspaceEntrySchema).length(50),
  authority: z.object({
    reviewOnly: z.literal(true),
    databaseMutationAuthorized: z.literal(false),
    qualificationAuthorized: z.literal(false),
    consentDecisionAuthorized: z.literal(false),
    outreachAuthorized: z.literal(false),
    sendAuthorized: z.literal(false),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
}).strict().superRefine((workspace, context) => {
  const leadIds = workspace.entries.map((entry) => entry.leadId);
  if (new Set(leadIds).size !== leadIds.length) {
    context.addIssue({ code: "custom", message: "Owner workspace leads must be unique.", path: ["entries"] });
  }
  const reviewed = workspace.entries.filter((entry) => entry.ownerReview.label !== "UNREVIEWED").length;
  if (workspace.summary.reviewed !== reviewed) {
    context.addIssue({ code: "custom", message: "Owner workspace progress must match its exact entries.", path: ["summary", "reviewed"] });
  }
});

export type OwnerLabelingWorkspaceResponse = z.infer<typeof OwnerLabelingWorkspaceResponseSchema>;

const DraftDecisionSchema = z.object({
  label: OwnerWorkspaceLabelSchema.nullable(),
  reasons: z.array(OwnerWorkspaceReasonSchema).max(5),
  notes: z.string().max(500),
}).strict();

export type OwnerLabelingDraftDecision = z.infer<typeof DraftDecisionSchema>;

export const OwnerLabelingDraftSchema = z.object({
  draftVersion: z.literal(OWNER_LABELING_DRAFT_VERSION),
  packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  reviewedBy: z.enum(["RILEY", "AIDAN"]),
  decisions: z.record(z.string().trim().min(1).max(128), DraftDecisionSchema),
}).strict();

export type OwnerLabelingDraft = z.infer<typeof OwnerLabelingDraftSchema>;

function allowedReasons(label: OwnerWorkspaceLabel) {
  return new Set(OWNER_REASON_OPTIONS[label].map((reason) => reason.value));
}

export function isCompleteOwnerLabelingDecision(decision: OwnerLabelingDraftDecision | undefined) {
  if (!decision?.label || decision.reasons.length === 0) return false;
  const allowed = allowedReasons(decision.label);
  return decision.reasons.every((reason) => allowed.has(reason));
}

export function parseOwnerLabelingDraft(value: unknown, packetDigest: string, leadIds: Set<string>) {
  const result = OwnerLabelingDraftSchema.safeParse(value);
  if (!result.success || result.data.packetDigest !== packetDigest) return null;
  if (Object.keys(result.data.decisions).some((leadId) => !leadIds.has(leadId))) return null;
  if (Object.values(result.data.decisions).some((decision) => {
    if (!decision.label) return decision.reasons.length > 0;
    const allowed = allowedReasons(decision.label);
    return decision.reasons.some((reason) => !allowed.has(reason));
  })) return null;
  return result.data;
}

export function projectOwnerLabelingWorkspace(packet: PrivateKwOwnerLabelingPacket) {
  if (packet.entries.length !== 50 || packet.summary.loaded !== 50) {
    throw new Error("The owner workspace requires the fixed 50-business evaluation cohort.");
  }
  return OwnerLabelingWorkspaceResponseSchema.parse({
    workspaceVersion: OWNER_LABELING_WORKSPACE_VERSION,
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    sourceImportId: packet.sourceImportId,
    policyVersion: packet.policyVersion,
    preparedAt: packet.preparedAt,
    summary: {
      targetSize: packet.summary.targetSize,
      loaded: packet.summary.loaded,
      reviewed: packet.summary.reviewed,
      agreements: packet.summary.agreements,
      agreementPercent: packet.summary.agreementPercent,
      ready: packet.summary.ready,
      gateReasons: packet.summary.gateReasons,
    },
    entries: packet.entries.map((entry) => ({
      leadId: entry.leadId,
      businessId: entry.businessId,
      businessName: entry.businessName,
      city: entry.city,
      niche: entry.niche,
      sourceEvidenceUrl: entry.sourceEvidenceUrl,
      websiteUrl: entry.websiteUrl,
      audit: {
        classification: entry.audit.classification,
        siteState: entry.audit.siteState,
        capturedAt: entry.audit.capturedAt,
        claims: entry.audit.claims.map((claim) => ({
          claimId: claim.claimId,
          observation: claim.observation,
          sourceUrl: claim.sourceUrl,
          capturedAt: claim.capturedAt,
          method: claim.method,
          confidence: claim.confidence,
          conversionCritical: claim.conversionCritical,
          category: claim.category,
          severity: entry.audit.checks.find((check) => check.claimId === claim.claimId)?.severity ?? "MINOR",
        })),
        manualReviewReasons: entry.audit.manualReviewReasons,
      },
      engineAssessment: entry.engineAssessment,
      ownerReview: entry.ownerReview,
    })),
    authority: {
      reviewOnly: packet.authority.reviewOnly,
      databaseMutationAuthorized: packet.authority.databaseMutationAuthorized,
      qualificationAuthorized: packet.authority.qualificationAuthorized,
      consentDecisionAuthorized: packet.authority.consentDecisionAuthorized,
      outreachAuthorized: packet.authority.outreachAuthorized,
      sendAuthorized: packet.authority.sendAuthorized,
      providerOperationsAuthorized: packet.authority.providerOperationsAuthorized,
      costAuthorizedUsd: packet.authority.costAuthorizedUsd,
    },
  });
}

export function buildOwnerLabelSubmission(input: {
  packetId: string;
  packetDigest: string;
  reviewedBy: "RILEY" | "AIDAN";
  reviewedAt: string;
  decisions: Record<string, OwnerLabelingDraftDecision>;
}): PrivateKwOwnerLabelSubmission {
  const identity = z.object({
    packetId: z.string().regex(/^kw-owner-labeling:[a-f0-9]{64}$/),
    packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    reviewedBy: z.enum(["RILEY", "AIDAN"]),
    reviewedAt: z.string().datetime({ offset: true }),
  }).strict().parse({
    packetId: input.packetId,
    packetDigest: input.packetDigest,
    reviewedBy: input.reviewedBy,
    reviewedAt: input.reviewedAt,
  });
  const started = Object.entries(input.decisions).filter(([, decision]) => (
    decision.label !== null || decision.reasons.length > 0 || decision.notes.trim().length > 0
  ));
  if (started.some(([, decision]) => !isCompleteOwnerLabelingDecision(decision))) {
    throw new Error("Every started lead review needs one verdict and at least one matching reason.");
  }
  const decisions = started
    .map(([leadId, decision]) => ({
      leadId: z.string().trim().min(1).max(128).parse(leadId),
      label: decision.label!,
      reasons: decision.reasons,
      notes: z.string().trim().max(500).parse(decision.notes),
    }))
    .sort((left, right) => left.leadId.localeCompare(right.leadId, "en-CA"));
  if (decisions.length === 0) throw new Error("Complete at least one lead review before exporting.");
  if (decisions.length > 50) throw new Error("One owner-review checkpoint cannot exceed 50 decisions.");
  return {
    submissionVersion: "kw-private-owner-labeling-v1",
    packetId: identity.packetId,
    packetDigest: identity.packetDigest,
    reviewedBy: identity.reviewedBy,
    reviewedAt: identity.reviewedAt,
    decisions,
    reviewOnly: true,
    databaseMutationAuthorized: false,
    qualificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
}
