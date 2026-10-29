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

/** Rebuilds the owner form from a validated, saved review of this exact packet. */
export function restoreM2OwnerIdentityDrafts(
  packet: M2OwnerIdentityReadyPacket,
  decisions: unknown,
): M2OwnerIdentityDraftMap {
  const invalid = (): never => { throw new Error("The saved review could not be verified against this business list."); };
  if (!Array.isArray(decisions) || decisions.length !== packet.selected.length) return invalid();
  const byId = new Map<string, Record<string, unknown>>();
  for (const value of decisions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const decision = value as Record<string, unknown>;
    if (typeof decision.reviewId !== "string" || byId.has(decision.reviewId)) return invalid();
    byId.set(decision.reviewId, decision);
  }

  const restored: M2OwnerIdentityDraftMap = {};
  for (const candidate of packet.selected) {
    const decision = byId.get(candidate.reviewId);
    if (!decision || typeof decision.rationale !== "string") return invalid();
    const draft = emptyM2OwnerIdentityDraft();
    draft.rationale = decision.rationale;
    if (decision.action === "HOLD" || decision.action === "REJECT") {
      draft.action = decision.action;
    } else if (decision.action === "KEEP" || decision.action === "KEEP_AS_BLOCKED") {
      if (decision.identityConfirmed !== true || decision.marketAndNicheConfirmed !== true
        || decision.independenceConfirmed !== true) return invalid();
      draft.action = decision.action;
      draft.identityConfirmed = true;
      draft.marketAndNicheConfirmed = true;
      draft.independenceConfirmed = true;
    } else if (decision.action === "REPLACE") {
      const replacement = decision.replacement;
      if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) return invalid();
      const item = replacement as Record<string, unknown>;
      const alternate = packet.supportedAlternates.find((choice) => choice.name === item.name
        && choice.officialWebsite === item.websiteUrl && choice.sourceUrl === item.sourceEvidenceUrl);
      if (!alternate || item.rationale !== decision.rationale
        || item.identityConfirmed !== true || item.marketAndNicheConfirmed !== true || item.independenceConfirmed !== true
        || !["KITCHENER", "WATERLOO", "CAMBRIDGE"].includes(String(item.city))
        || !["ROOFING", "HVAC", "LANDSCAPING"].includes(String(item.niche))) return invalid();
      draft.action = "REPLACE";
      draft.alternateKey = m2OwnerIdentityAlternateKey(alternate);
      draft.city = item.city as M2OwnerMarket;
      draft.niche = item.niche as M2OwnerNiche;
      draft.identityConfirmed = true;
      draft.marketAndNicheConfirmed = true;
      draft.independenceConfirmed = true;
    } else {
      return invalid();
    }
    if (!isM2OwnerIdentityDecisionComplete(candidate, draft, packet.supportedAlternates)) return invalid();
    restored[candidate.reviewId] = draft;
  }
  return restored;
}

/** Never replace browser edits made while the saved review was loading. */
export function selectM2OwnerIdentityDrafts(
  browserDrafts: M2OwnerIdentityDraftMap,
  savedDrafts: M2OwnerIdentityDraftMap,
  editedSinceLoad: boolean,
): { drafts: M2OwnerIdentityDraftMap; showingSaved: boolean } {
  if (editedSinceLoad) return { drafts: browserDrafts, showingSaved: false };
  const hasBrowserChoice = Object.values(browserDrafts).some((draft) => Boolean(draft.action || draft.rationale.trim()
    || draft.alternateKey || draft.identityConfirmed || draft.marketAndNicheConfirmed || draft.independenceConfirmed));
  if (!hasBrowserChoice) return { drafts: savedDrafts, showingSaved: true };
  const sortedEntries = (drafts: M2OwnerIdentityDraftMap) => JSON.stringify(
    Object.entries(drafts).sort(([left], [right]) => left.localeCompare(right, "en")),
  );
  if (sortedEntries(browserDrafts) === sortedEntries(savedDrafts)) {
    return { drafts: savedDrafts, showingSaved: true };
  }
  return { drafts: browserDrafts, showingSaved: false };
}
