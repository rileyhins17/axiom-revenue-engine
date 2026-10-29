import { EvidenceClaimSchema, isSupportedEvidenceClaim, type EvidenceClaim } from "@/lib/revenue-engine/evidence";

export const REVENUE_QUALIFICATION_POLICY_VERSION = "revenue-shadow-v3";

export type ReachableChannel = "EMAIL" | "PHONE" | "FORM" | "SOCIAL" | "RESEARCH";
export type RevenueQualificationBand = "PRIORITY" | "REVIEW" | "RESEARCH" | "DISQUALIFIED";

export type RevenueQualityScores = {
  rebuildNeed: number;
  businessFit: number;
  reachability: number;
  timing: number;
  evidenceConfidence: number;
};

export type RevenueQualificationInput = {
  scores: RevenueQualityScores;
  evidenceClaims: EvidenceClaim[];
  availableChannels: ReachableChannel[];
  blocks?: string[];
};

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function selectRoute(channels: ReachableChannel[]) {
  for (const channel of ["EMAIL", "PHONE", "FORM", "SOCIAL"] satisfies ReachableChannel[]) {
    if (channels.includes(channel)) return channel;
  }
  return "RESEARCH" as const;
}

export function calculateWeightedPriority(scores: RevenueQualityScores) {
  const normalized = {
    rebuildNeed: clampScore(scores.rebuildNeed),
    businessFit: clampScore(scores.businessFit),
    reachability: clampScore(scores.reachability),
    timing: clampScore(scores.timing),
    evidenceConfidence: clampScore(scores.evidenceConfidence),
  };

  return Math.round(
    normalized.rebuildNeed * 0.35 +
      normalized.businessFit * 0.3 +
      normalized.reachability * 0.2 +
      normalized.timing * 0.1 +
      normalized.evidenceConfidence * 0.05,
  );
}

/**
 * Deterministic shadow qualification. It can rank and explain leads but is
 * structurally incapable of authorizing outreach.
 */
export function qualifyRevenueLead(input: RevenueQualificationInput) {
  const scores = {
    rebuildNeed: clampScore(input.scores.rebuildNeed),
    businessFit: clampScore(input.scores.businessFit),
    reachability: clampScore(input.scores.reachability),
    timing: clampScore(input.scores.timing),
    evidenceConfidence: clampScore(input.scores.evidenceConfidence),
  };
  const evidenceClaims = input.evidenceClaims
    .map((claim) => EvidenceClaimSchema.parse(claim))
    .filter(isSupportedEvidenceClaim);
  const conversionCriticalCount = evidenceClaims.filter((claim) => claim.conversionCritical).length;
  const route = selectRoute(input.availableChannels);
  const totalScore = calculateWeightedPriority(scores);
  const blocks = Array.from(new Set((input.blocks || []).filter(Boolean)));
  const failedGates = [
    ...(totalScore < 70 ? ["total_below_70"] : []),
    ...(scores.rebuildNeed < 65 ? ["rebuild_need_below_65"] : []),
    ...(scores.businessFit < 60 ? ["business_fit_below_60"] : []),
    ...(scores.evidenceConfidence < 80 ? ["evidence_confidence_below_80"] : []),
    ...(evidenceClaims.length < 3 ? ["fewer_than_three_supported_observations"] : []),
    ...(conversionCriticalCount < 1 ? ["missing_conversion_critical_observation"] : []),
    ...(route === "RESEARCH" ? ["no_usable_channel"] : []),
    ...blocks,
  ];

  let band: RevenueQualificationBand = "RESEARCH";
  if (blocks.length > 0) band = "DISQUALIFIED";
  else if (failedGates.length === 0) band = "PRIORITY";
  else if (route !== "RESEARCH" && totalScore >= 55) band = "REVIEW";

  return {
    policyVersion: REVENUE_QUALIFICATION_POLICY_VERSION,
    shadowOnly: true as const,
    autonomousEmailEligible: false as const,
    band,
    totalScore,
    scores,
    recommendedChannel: route,
    supportedObservationCount: evidenceClaims.length,
    conversionCriticalCount,
    failedGates,
    evidenceClaimIds: evidenceClaims.map((claim) => claim.claimId),
  };
}
