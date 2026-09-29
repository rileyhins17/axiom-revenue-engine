import { z } from "zod";

import {
  OwnerWorkspaceLabelSchema,
  OwnerWorkspaceReasonSchema,
  isCompleteOwnerLabelingDecision,
  type OwnerLabelingDraftDecision,
} from "@/lib/revenue-engine/owner-labeling-workspace";

export const OWNER_FIRST_PASS_EXPORT_VERSION = "kw-owner-first-pass-v1";

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const PacketIdSchema = z.string().regex(/^kw-owner-labeling:[a-f0-9]{64}$/);
const FirstPassDecisionSchema = z.object({
  leadId: z.string().trim().min(1).max(128),
  label: OwnerWorkspaceLabelSchema,
  reasons: z.array(OwnerWorkspaceReasonSchema).min(1).max(5),
  notes: z.string().trim().max(500),
}).strict();

export const OwnerFirstPassExportSchema = z.object({
  exportVersion: z.literal(OWNER_FIRST_PASS_EXPORT_VERSION),
  packetId: PacketIdSchema,
  packetDigest: DigestSchema,
  blindDigest: DigestSchema,
  reviewedBy: z.enum(["RILEY", "AIDAN"]),
  reviewedAt: z.string().datetime({ offset: true }),
  decisions: z.array(FirstPassDecisionSchema).max(50),
  reviewOnly: z.literal(true),
  databaseMutationAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict().superRefine((exported, context) => {
  const ids = exported.decisions.map((decision) => decision.leadId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["decisions"], message: "A first-pass export may include each lead only once; duplicate decisions are rejected." });
  }
  exported.decisions.forEach((decision, index) => {
    if (!isCompleteOwnerLabelingDecision(decision)) {
      context.addIssue({ code: "custom", path: ["decisions", index], message: "Each first-pass decision needs a complete label and matching reason." });
    }
  });
});

export type OwnerFirstPassExport = z.infer<typeof OwnerFirstPassExportSchema>;

export type OwnerFirstPassEntryRef = {
  leadId: string;
  ownerReview: { label: "UNREVIEWED" | "STRONG" | "WEAK" | "WRONG" };
};

export type OwnerFirstPassPacketRef = {
  packetId: string;
  packetDigest: string;
  blindDigest: string;
  entries: readonly OwnerFirstPassEntryRef[];
};

export function validateOwnerFirstPassForReveal(value: unknown, packet: OwnerFirstPassPacketRef) {
  const exported = OwnerFirstPassExportSchema.parse(value);
  if (exported.packetId !== packet.packetId || exported.packetDigest !== packet.packetDigest || exported.blindDigest !== packet.blindDigest) {
    throw new Error("The first-pass export must match this exact blind packet.");
  }
  const requiredIds = packet.entries.filter((entry) => entry.ownerReview.label === "UNREVIEWED").map((entry) => entry.leadId);
  const required = new Set(requiredIds);
  if (required.size !== requiredIds.length || packet.entries.length !== 50 || new Set(packet.entries.map((entry) => entry.leadId)).size !== 50) {
    throw new Error("First-pass reveal requires the exact 50-business cohort.");
  }
  const received = new Set(exported.decisions.map((decision) => decision.leadId));
  if (received.size !== required.size || [...received].some((leadId) => !required.has(leadId))) {
    throw new Error("The first-pass export must cover every unreviewed business and no other business.");
  }
  return exported;
}

export function buildOwnerFirstPassExport(input: OwnerFirstPassPacketRef & {
  reviewedBy: "RILEY" | "AIDAN";
  reviewedAt: string;
  decisions: Record<string, OwnerLabelingDraftDecision>;
}) {
  const known = new Set(input.entries.map((entry) => entry.leadId));
  const required = new Set(input.entries.filter((entry) => entry.ownerReview.label === "UNREVIEWED").map((entry) => entry.leadId));
  if (Object.keys(input.decisions).some((leadId) => !known.has(leadId))) {
    throw new Error("A first-pass export contains an unknown business.");
  }
  const decisions = [...required].map((leadId) => {
    const decision = input.decisions[leadId];
    if (!isCompleteOwnerLabelingDecision(decision)) {
      throw new Error("A complete first-pass label and reason are required for every unreviewed business.");
    }
    return { leadId, label: decision.label!, reasons: decision.reasons, notes: decision.notes };
  }).sort((left, right) => left.leadId.localeCompare(right.leadId, "en-CA"));
  return validateOwnerFirstPassForReveal({
    exportVersion: OWNER_FIRST_PASS_EXPORT_VERSION,
    packetId: input.packetId,
    packetDigest: input.packetDigest,
    blindDigest: input.blindDigest,
    reviewedBy: input.reviewedBy,
    reviewedAt: input.reviewedAt,
    decisions,
    reviewOnly: true,
    databaseMutationAuthorized: false,
    qualificationAuthorized: false,
    consentDecisionAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  }, input);
}
