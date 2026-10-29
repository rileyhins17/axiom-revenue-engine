import { createHash } from "node:crypto";

import { z } from "zod";

import {
  KW_LEAD_EVALUATION_TARGET_SIZE,
  KwLeadEvaluationEntrySchema,
} from "@/lib/revenue-engine/lead-quality-evaluation";
import {
  PRIVATE_KW_OWNER_LABELING_POLICY_VERSION,
  PRIVATE_KW_OWNER_LABELING_VERSION,
  PrivateKwOwnerLabelingPacketSchema,
  privateKwOwnerLabelingCanonicalJson,
  type PrivateKwOwnerLabelingPacket,
} from "@/lib/revenue-engine/private-kw-owner-labeling";
import { DeterministicWebsiteAuditResultSchema } from "@/lib/revenue-engine/website-audit";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const PacketIdSchema = z.string().regex(/^kw-owner-labeling:[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

const BlindClaimSchema = z.object({
  claimId: KwLeadEvaluationEntrySchema.shape.audit.shape.claims.element.shape.claimId,
  observation: KwLeadEvaluationEntrySchema.shape.audit.shape.claims.element.shape.observation,
  sourceUrl: KwLeadEvaluationEntrySchema.shape.audit.shape.claims.element.shape.sourceUrl,
  capturedAt: KwLeadEvaluationEntrySchema.shape.audit.shape.claims.element.shape.capturedAt,
  method: KwLeadEvaluationEntrySchema.shape.audit.shape.claims.element.shape.method,
  confidence: KwLeadEvaluationEntrySchema.shape.audit.shape.claims.element.shape.confidence,
}).strict();

const BlindAuditSchema = z.object({
  siteState: DeterministicWebsiteAuditResultSchema.shape.siteState,
  capturedAt: DeterministicWebsiteAuditResultSchema.shape.capturedAt,
  claims: z.array(BlindClaimSchema).max(50),
}).strict();

const BlindEntrySchema = z.object({
  entryVersion: KwLeadEvaluationEntrySchema.shape.entryVersion,
  leadId: KwLeadEvaluationEntrySchema.shape.leadId,
  businessId: KwLeadEvaluationEntrySchema.shape.businessId,
  businessIdentityKey: KwLeadEvaluationEntrySchema.shape.businessIdentityKey,
  businessName: KwLeadEvaluationEntrySchema.shape.businessName,
  city: KwLeadEvaluationEntrySchema.shape.city,
  niche: KwLeadEvaluationEntrySchema.shape.niche,
  sourceEvidenceUrl: KwLeadEvaluationEntrySchema.shape.sourceEvidenceUrl,
  websiteUrl: KwLeadEvaluationEntrySchema.shape.websiteUrl,
  audit: BlindAuditSchema,
  ownerReview: KwLeadEvaluationEntrySchema.shape.ownerReview,
  addedAt: KwLeadEvaluationEntrySchema.shape.addedAt,
}).strict();

const AuthoritySchema = z.object({
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

const BlindSummarySchema = z.object({
  targetSize: z.literal(KW_LEAD_EVALUATION_TARGET_SIZE),
  loaded: z.literal(KW_LEAD_EVALUATION_TARGET_SIZE),
  reviewed: z.number().int().min(0).max(KW_LEAD_EVALUATION_TARGET_SIZE),
}).strict();

const BlindPacketShapeSchema = z.object({
  blindPacketVersion: z.literal("kw-owner-labeling-blind-v1"),
  fullPacketId: PacketIdSchema,
  fullPacketDigest: Sha256Schema,
  blindDigest: Sha256Schema,
  parentPacketId: PacketIdSchema.nullable(),
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  market: z.literal("KITCHENER_WATERLOO_CAMBRIDGE"),
  targetSize: z.literal(KW_LEAD_EVALUATION_TARGET_SIZE),
  policyVersion: z.literal(PRIVATE_KW_OWNER_LABELING_POLICY_VERSION),
  preparedAt: TimestampSchema,
  entries: z.array(BlindEntrySchema).length(KW_LEAD_EVALUATION_TARGET_SIZE),
  summary: BlindSummarySchema,
  authority: AuthoritySchema,
}).strict();

function digest(value: unknown) {
  return createHash("sha256").update(privateKwOwnerLabelingCanonicalJson(value)).digest("hex");
}

export const BlindOwnerLabelingPacketSchema = BlindPacketShapeSchema.superRefine((packet, context) => {
  const { blindDigest, ...core } = packet;
  if (digest(core) !== blindDigest) {
    context.addIssue({ code: "custom", message: "Blind packet digest does not match its exact contents.", path: ["blindDigest"] });
  }
  const leadIds = packet.entries.map((entry) => entry.leadId);
  const businessIds = packet.entries.map((entry) => entry.businessId);
  const identityKeys = packet.entries.map((entry) => entry.businessIdentityKey);
  if (new Set(leadIds).size !== leadIds.length || new Set(businessIds).size !== businessIds.length || new Set(identityKeys).size !== identityKeys.length) {
    context.addIssue({ code: "custom", message: "Blind packet businesses and identities must be unique.", path: ["entries"] });
  }
  if (packet.summary.targetSize !== packet.targetSize || packet.summary.loaded !== packet.entries.length) {
    context.addIssue({ code: "custom", message: "Blind packet counts must match its fixed cohort.", path: ["summary"] });
  }
  const reviewed = packet.entries.filter((entry) => entry.ownerReview.label !== "UNREVIEWED").length;
  if (packet.summary.reviewed !== reviewed) {
    context.addIssue({ code: "custom", message: "Blind packet progress must match its owner-review entries.", path: ["summary", "reviewed"] });
  }
});

const AssessmentSidecarEntrySchema = z.object({
  leadId: KwLeadEvaluationEntrySchema.shape.leadId,
  businessId: KwLeadEvaluationEntrySchema.shape.businessId,
  engineAssessment: KwLeadEvaluationEntrySchema.shape.engineAssessment,
  auditHints: DeterministicWebsiteAuditResultSchema,
}).strict();

export const OwnerLabelingAssessmentSidecarSchema = z.object({
  sidecarVersion: z.literal("kw-owner-labeling-assessment-sidecar-v1"),
  fullPacketId: PacketIdSchema,
  fullPacketDigest: Sha256Schema,
  blindDigest: Sha256Schema,
  parentPacketId: PacketIdSchema.nullable(),
  sourceImportId: z.string().trim().min(8).max(128),
  sourcePlanDigest: Sha256Schema,
  market: z.literal("KITCHENER_WATERLOO_CAMBRIDGE"),
  targetSize: z.literal(KW_LEAD_EVALUATION_TARGET_SIZE),
  policyVersion: z.literal(PRIVATE_KW_OWNER_LABELING_POLICY_VERSION),
  preparedAt: TimestampSchema,
  entries: z.array(AssessmentSidecarEntrySchema).length(KW_LEAD_EVALUATION_TARGET_SIZE),
  summary: PrivateKwOwnerLabelingPacketSchema.shape.summary,
  authority: AuthoritySchema,
}).strict().superRefine((sidecar, context) => {
  const leadIds = sidecar.entries.map((entry) => entry.leadId);
  const businessIds = sidecar.entries.map((entry) => entry.businessId);
  if (new Set(leadIds).size !== leadIds.length || new Set(businessIds).size !== businessIds.length) {
    context.addIssue({ code: "custom", message: "Assessment sidecar businesses must be unique.", path: ["entries"] });
  }
  if (sidecar.entries.some((entry) => entry.engineAssessment.policyVersion !== sidecar.policyVersion)) {
    context.addIssue({ code: "custom", message: "Assessment sidecar policy versions must match every exact assessment.", path: ["entries"] });
  }
});

export type BlindOwnerLabelingPacket = z.infer<typeof BlindOwnerLabelingPacketSchema>;
export type OwnerLabelingAssessmentSidecar = z.infer<typeof OwnerLabelingAssessmentSidecarSchema>;

export function splitOwnerLabelingPacket(fullPacketValue: PrivateKwOwnerLabelingPacket) {
  const fullPacket = PrivateKwOwnerLabelingPacketSchema.parse(fullPacketValue);
  if (fullPacket.entries.length !== KW_LEAD_EVALUATION_TARGET_SIZE || fullPacket.summary.loaded !== KW_LEAD_EVALUATION_TARGET_SIZE) {
    throw new Error("Owner-labeling split requires exactly 50 complete assessments.");
  }

  const blindCore = {
    blindPacketVersion: "kw-owner-labeling-blind-v1" as const,
    fullPacketId: fullPacket.packetId,
    fullPacketDigest: fullPacket.packetDigest,
    parentPacketId: fullPacket.parentPacketId,
    sourceImportId: fullPacket.sourceImportId,
    sourcePlanDigest: fullPacket.sourcePlanDigest,
    market: fullPacket.market,
    targetSize: fullPacket.targetSize,
    policyVersion: fullPacket.policyVersion,
    preparedAt: fullPacket.preparedAt,
    entries: fullPacket.entries.map((entry) => ({
      entryVersion: entry.entryVersion,
      leadId: entry.leadId,
      businessId: entry.businessId,
      businessIdentityKey: entry.businessIdentityKey,
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
      addedAt: entry.addedAt,
    })),
    summary: {
      targetSize: fullPacket.targetSize,
      loaded: fullPacket.summary.loaded,
      reviewed: fullPacket.summary.reviewed,
    },
    authority: fullPacket.authority,
  };
  const blindPacket = BlindOwnerLabelingPacketSchema.parse({
    ...blindCore,
    blindDigest: digest(blindCore),
  });
  const assessmentSidecar = OwnerLabelingAssessmentSidecarSchema.parse({
    sidecarVersion: "kw-owner-labeling-assessment-sidecar-v1",
    fullPacketId: fullPacket.packetId,
    fullPacketDigest: fullPacket.packetDigest,
    blindDigest: blindPacket.blindDigest,
    parentPacketId: fullPacket.parentPacketId,
    sourceImportId: fullPacket.sourceImportId,
    sourcePlanDigest: fullPacket.sourcePlanDigest,
    market: fullPacket.market,
    targetSize: fullPacket.targetSize,
    policyVersion: fullPacket.policyVersion,
    preparedAt: fullPacket.preparedAt,
    entries: fullPacket.entries.map((entry) => ({
      leadId: entry.leadId,
      businessId: entry.businessId,
      engineAssessment: entry.engineAssessment,
      auditHints: entry.audit,
    })),
    summary: fullPacket.summary,
    authority: fullPacket.authority,
  });

  return { blindPacket, assessmentSidecar };
}

export function rejoinOwnerLabelingPacket(blindPacketValue: unknown, assessmentSidecarValue: unknown): PrivateKwOwnerLabelingPacket {
  const blindPacket = BlindOwnerLabelingPacketSchema.parse(blindPacketValue);
  const assessmentSidecar = OwnerLabelingAssessmentSidecarSchema.parse(assessmentSidecarValue);

  for (const key of [
    "fullPacketId",
    "fullPacketDigest",
    "parentPacketId",
    "sourceImportId",
    "sourcePlanDigest",
    "market",
    "targetSize",
    "policyVersion",
    "preparedAt",
  ] as const) {
    if (assessmentSidecar[key] !== blindPacket[key]) {
      throw new Error(`Assessment sidecar ${key} does not match its blind packet.`);
    }
  }
  if (assessmentSidecar.blindDigest !== blindPacket.blindDigest) {
    throw new Error("Assessment sidecar does not match the exact blind packet contents.");
  }
  if (assessmentSidecar.entries.length !== blindPacket.entries.length || assessmentSidecar.entries.length !== KW_LEAD_EVALUATION_TARGET_SIZE) {
    throw new Error("Owner-labeling rejoin requires exactly 50 assessments and dossiers.");
  }

  const sidecarsByLeadId = new Map(assessmentSidecar.entries.map((entry) => [entry.leadId, entry]));
  const entries = blindPacket.entries.map((entry) => {
    const sidecarEntry = sidecarsByLeadId.get(entry.leadId);
    if (!sidecarEntry || sidecarEntry.businessId !== entry.businessId) {
      throw new Error("Assessment sidecar IDs do not exactly match the blind dossiers.");
    }
    if (sidecarEntry.auditHints.businessId !== entry.businessId) {
      throw new Error("Assessment sidecar audit hints do not match the blind business identity.");
    }
    if (
      sidecarEntry.auditHints.siteState !== entry.audit.siteState
      || sidecarEntry.auditHints.capturedAt !== entry.audit.capturedAt
      || sidecarEntry.auditHints.claims.length !== entry.audit.claims.length
    ) {
      throw new Error("Assessment sidecar audit does not match the blind factual evidence.");
    }
    const fullClaimsById = new Map(sidecarEntry.auditHints.claims.map((claim) => [claim.claimId, claim]));
    if (fullClaimsById.size !== sidecarEntry.auditHints.claims.length) {
      throw new Error("Assessment sidecar contains duplicate evidence claim IDs.");
    }
    for (const blindClaim of entry.audit.claims) {
      const fullClaim = fullClaimsById.get(blindClaim.claimId);
      if (
        !fullClaim
        || fullClaim.observation !== blindClaim.observation
        || fullClaim.sourceUrl !== blindClaim.sourceUrl
        || fullClaim.capturedAt !== blindClaim.capturedAt
        || fullClaim.method !== blindClaim.method
        || fullClaim.confidence !== blindClaim.confidence
      ) {
        throw new Error("Assessment sidecar audit does not match the exact blind evidence claims.");
      }
    }
    return {
      ...entry,
      audit: sidecarEntry.auditHints,
      engineAssessment: sidecarEntry.engineAssessment,
    };
  });
  if (sidecarsByLeadId.size !== entries.length) {
    throw new Error("Assessment sidecar contains an unknown business.");
  }

  return PrivateKwOwnerLabelingPacketSchema.parse({
    packetVersion: PRIVATE_KW_OWNER_LABELING_VERSION,
    packetId: blindPacket.fullPacketId,
    packetDigest: blindPacket.fullPacketDigest,
    parentPacketId: blindPacket.parentPacketId,
    sourceImportId: blindPacket.sourceImportId,
    sourcePlanDigest: blindPacket.sourcePlanDigest,
    market: blindPacket.market,
    targetSize: blindPacket.targetSize,
    policyVersion: blindPacket.policyVersion,
    preparedAt: blindPacket.preparedAt,
    entries,
    summary: assessmentSidecar.summary,
    authority: assessmentSidecar.authority,
  });
}
