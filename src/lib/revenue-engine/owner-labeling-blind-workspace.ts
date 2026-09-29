import { z } from "zod";

import type { BlindOwnerLabelingPacket } from "@/lib/revenue-engine/owner-labeling-blind";
import { OwnerWorkspaceReasonSchema } from "@/lib/revenue-engine/owner-labeling-workspace";

export const OWNER_LABELING_BLIND_WORKSPACE_VERSION = "owner-labeling-blind-workspace-v1";

const BlindClaimSchema = z.object({
  claimId: z.string().trim().min(1),
  observation: z.string().trim().min(1),
  sourceUrl: z.string().url(),
  capturedAt: z.string().datetime({ offset: true }),
  method: z.string().trim().min(1),
  confidence: z.number().int().min(0).max(100),
}).strict();

const BlindWorkspaceEntrySchema = z.object({
  leadId: z.string().trim().min(1).max(128),
  businessId: z.string().trim().min(1).max(128),
  businessName: z.string().trim().min(1).max(256),
  city: z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]),
  niche: z.enum(["ROOFING", "HVAC", "LANDSCAPING"]),
  sourceEvidenceUrl: z.string().url(),
  websiteUrl: z.string().url().nullable(),
  audit: z.object({
    siteState: z.enum(["NO_SITE", "UNREACHABLE", "CAPTURED"]),
    capturedAt: z.string().datetime({ offset: true }),
    claims: z.array(BlindClaimSchema).max(50),
  }).strict(),
  ownerReview: z.object({
    label: z.enum(["UNREVIEWED", "STRONG", "WEAK", "WRONG"]),
    reasons: z.array(OwnerWorkspaceReasonSchema).max(5),
    notes: z.string().trim().max(500),
    reviewedAt: z.string().datetime({ offset: true }).nullable(),
  }).strict(),
}).strict();

export const BlindOwnerLabelingWorkspaceResponseSchema = z.object({
  workspaceVersion: z.literal(OWNER_LABELING_BLIND_WORKSPACE_VERSION),
  packetId: z.string().regex(/^kw-owner-labeling:[a-f0-9]{64}$/),
  packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  blindDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceImportId: z.string().trim().min(8).max(128),
  policyVersion: z.string().trim().min(1).max(80),
  preparedAt: z.string().datetime({ offset: true }),
  summary: z.object({
    targetSize: z.literal(50),
    loaded: z.literal(50),
    reviewed: z.number().int().min(0).max(50),
  }).strict(),
  entries: z.array(BlindWorkspaceEntrySchema).length(50),
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
  if (new Set(leadIds).size !== 50) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Blind workspace leads must be unique." });
  }
  const reviewed = workspace.entries.filter((entry) => entry.ownerReview.label !== "UNREVIEWED").length;
  if (workspace.summary.reviewed !== reviewed) {
    context.addIssue({ code: "custom", path: ["summary", "reviewed"], message: "Blind workspace progress must match the exact entries." });
  }
});

export type BlindOwnerLabelingWorkspaceResponse = z.infer<typeof BlindOwnerLabelingWorkspaceResponseSchema>;

export function projectBlindOwnerLabelingWorkspace(value: BlindOwnerLabelingPacket) {
  // The authenticated upload boundary validates the packet and its digest
  // before calling this browser-safe projection module.
  const packet = value;
  if (packet.entries.length !== 50 || packet.summary.loaded !== 50) {
    throw new Error("The blind owner workspace requires the fixed 50-business cohort.");
  }
  return BlindOwnerLabelingWorkspaceResponseSchema.parse({
    workspaceVersion: OWNER_LABELING_BLIND_WORKSPACE_VERSION,
    packetId: packet.fullPacketId,
    packetDigest: packet.fullPacketDigest,
    blindDigest: packet.blindDigest,
    sourceImportId: packet.sourceImportId,
    policyVersion: packet.policyVersion,
    preparedAt: packet.preparedAt,
    summary: {
      targetSize: packet.summary.targetSize,
      loaded: packet.summary.loaded,
      reviewed: packet.entries.filter((entry) => entry.ownerReview.label !== "UNREVIEWED").length,
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
        siteState: entry.audit.siteState,
        capturedAt: entry.audit.capturedAt,
        claims: entry.audit.claims.map((claim) => ({
          claimId: claim.claimId,
          observation: claim.observation,
          sourceUrl: claim.sourceUrl,
          capturedAt: claim.capturedAt,
          method: claim.method,
          confidence: claim.confidence,
        })),
      },
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
