import type { M2OwnerIdentityPacketResult } from "@/lib/revenue-engine/m2-owner-identity-packet";

export const M2_OWNER_IDENTITY_DECISION_VERSION = "kw-m2-owner-decisions-v1" as const;

export type M2OwnerIdentityReadyPacket = Extract<M2OwnerIdentityPacketResult, { status: "READY" }>;
export type M2OwnerIdentityCandidate = M2OwnerIdentityReadyPacket["selected"][number];
export type M2OwnerIdentityAlternate = M2OwnerIdentityReadyPacket["supportedAlternates"][number];
export type M2OwnerReviewer = "RILEY" | "AIDAN";
export type M2OwnerAction = "KEEP" | "KEEP_AS_BLOCKED" | "REPLACE" | "HOLD" | "REJECT";
export type M2OwnerMarket = "KITCHENER" | "WATERLOO" | "CAMBRIDGE";
export type M2OwnerNiche = "ROOFING" | "HVAC" | "LANDSCAPING";

export type M2OwnerIdentityDraft = {
  action: M2OwnerAction | null;
  rationale: string;
  identityConfirmed: boolean;
  marketAndNicheConfirmed: boolean;
  independenceConfirmed: boolean;
  alternateKey: string;
  city: M2OwnerMarket | "";
  niche: M2OwnerNiche | "";
};

export type M2OwnerIdentityDraftMap = Record<string, M2OwnerIdentityDraft>;

export function emptyM2OwnerIdentityDraft(): M2OwnerIdentityDraft {
  return {
    action: null,
    rationale: "",
    identityConfirmed: false,
    marketAndNicheConfirmed: false,
    independenceConfirmed: false,
    alternateKey: "",
    city: "",
    niche: "",
  };
}

export function m2OwnerIdentityDraftStorageKey(packetSha256: string): string {
  return `axiom-m2-owner-identity:${packetSha256}`;
}

export function m2OwnerIdentityAlternateKey(alternate: M2OwnerIdentityAlternate): string {
  return JSON.stringify([alternate.name, alternate.officialWebsite, alternate.sourceUrl]);
}

function hasConfirmations(draft: M2OwnerIdentityDraft) {
  return draft.identityConfirmed && draft.marketAndNicheConfirmed && draft.independenceConfirmed;
}

export function isM2OwnerIdentityDecisionComplete(
  candidate: M2OwnerIdentityCandidate,
  draft: M2OwnerIdentityDraft | undefined,
  supportedAlternates: readonly M2OwnerIdentityAlternate[],
): boolean {
  if (!draft?.action || draft.rationale.trim().length < 10 || draft.rationale.length > 500) return false;
  if (draft.action === "KEEP") return !candidate.accessBlocked && hasConfirmations(draft);
  if (draft.action === "KEEP_AS_BLOCKED") return candidate.accessBlocked && hasConfirmations(draft);
  if (draft.action === "REPLACE") {
    return Boolean(
      supportedAlternates.some((alternate) => m2OwnerIdentityAlternateKey(alternate) === draft.alternateKey)
      && draft.city
      && draft.niche
      && hasConfirmations(draft),
    );
  }
  return draft.action === "HOLD" || draft.action === "REJECT";
}

export type M2OwnerIdentityDecisionLedger = {
  decisionVersion: typeof M2_OWNER_IDENTITY_DECISION_VERSION;
  researchReviewSha256: string;
  reviewedBy: M2OwnerReviewer;
  reviewedAt: string;
  decisions: Array<Record<string, unknown>>;
};

export function buildM2OwnerIdentityDecisionLedger(input: {
  packet: M2OwnerIdentityReadyPacket;
  reviewedBy: M2OwnerReviewer | null;
  reviewedAt: string;
  drafts: M2OwnerIdentityDraftMap;
}): M2OwnerIdentityDecisionLedger {
  if (!input.reviewedBy) throw new Error("Choose Riley or Aidan as the reviewer before downloading.");
  if (!/^([a-f0-9]{64})$/.test(input.packet.packetSha256)) throw new Error("The research packet digest is invalid.");
  if (!Number.isFinite(Date.parse(input.reviewedAt)) || new Date(input.reviewedAt).toISOString() !== input.reviewedAt) {
    throw new Error("The review time must be an ISO timestamp.");
  }
  if (input.packet.selected.length !== 10) throw new Error("The packet must contain exactly ten proposed identities.");

  const decisions = input.packet.selected.map((candidate) => {
    const draft = input.drafts[candidate.reviewId];
    if (!draft || !draft.action || !isM2OwnerIdentityDecisionComplete(candidate, draft, input.packet.supportedAlternates)) {
      throw new Error(`Finish the review for ${candidate.reviewId} before downloading.`);
    }
    const rationale = draft.rationale.trim();
    if (draft.action === "KEEP" || draft.action === "KEEP_AS_BLOCKED") {
      return {
        reviewId: candidate.reviewId,
        action: draft.action,
        rationale,
        identityConfirmed: true,
        marketAndNicheConfirmed: true,
        independenceConfirmed: true,
      };
    }
    if (draft.action === "REPLACE") {
      const alternate = input.packet.supportedAlternates.find((item) => m2OwnerIdentityAlternateKey(item) === draft.alternateKey);
      if (!alternate || !draft.city || !draft.niche) throw new Error(`Choose a supported replacement, city, and niche for ${candidate.reviewId}.`);
      return {
        reviewId: candidate.reviewId,
        action: "REPLACE",
        rationale,
        replacement: {
          name: alternate.name,
          city: draft.city,
          niche: draft.niche,
          sourceEvidenceUrl: alternate.sourceUrl,
          websiteUrl: alternate.officialWebsite,
          identityConfirmed: true,
          marketAndNicheConfirmed: true,
          independenceConfirmed: true,
          rationale,
        },
      };
    }
    return { reviewId: candidate.reviewId, action: draft.action, rationale };
  });

  return {
    decisionVersion: M2_OWNER_IDENTITY_DECISION_VERSION,
    researchReviewSha256: input.packet.packetSha256,
    reviewedBy: input.reviewedBy,
    reviewedAt: input.reviewedAt,
    decisions,
  };
}
