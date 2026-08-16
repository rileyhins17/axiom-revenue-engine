import { getDatabase } from "@/lib/cloudflare";

export const REVENUE_QUALIFICATION_POLICY_VERSION = "axiom-revenue-v2";
export const REVENUE_OUTREACH_MIN_SCORE = 30;
export const REVENUE_PRIORITY_MIN_SCORE = 70;

export type QualificationBand = "RESEARCH" | "REVIEW" | "OUTREACH" | "PRIORITY";
export type RecommendedChannel = "EMAIL" | "PHONE" | "FORM" | "SOCIAL" | "RESEARCH";

type ScoreBreakdownInput = {
  businessValue?: number;
  localFit?: number;
  painOpportunity?: number;
  reachability?: number;
};

export type RevenueQualificationDraft = {
  autonomousEmailEligible: boolean;
  band: QualificationBand;
  businessFitScore: number;
  evidence: Record<string, unknown>;
  hardGateStatus: "PASS" | "DISQUALIFIED";
  legacyScore: number;
  policyVersion: string;
  reachabilityScore: number;
  reasonCodes: string[];
  recommendedChannel: RecommendedChannel;
  timingScore: number;
  totalScore: number;
  websiteNeedScore: number;
};

export type BuildRevenueQualificationInput = {
  emailReady: boolean;
  hardDisqualified: boolean;
  hasContactForm: boolean;
  hasSocialMessaging: boolean;
  legacyScore: number;
  phone?: string | null;
  phoneConfidence?: number | null;
  reasonCodes?: string[];
  scoreBreakdown: ScoreBreakdownInput | string | null;
  websiteLabel?: string | null;
  websiteStatus?: string | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function parseScoreBreakdown(value: BuildRevenueQualificationInput["scoreBreakdown"]): ScoreBreakdownInput {
  if (!value) return {};
  if (typeof value === "object") return value;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as ScoreBreakdownInput) : {};
  } catch {
    return {};
  }
}

function scale(value: number | undefined, fromMax: number, toMax: number) {
  return Math.round((clamp(Number(value || 0), 0, fromMax) / fromMax) * toMax);
}

function hasCallablePhone(phone: string | null | undefined, confidence: number | null | undefined) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 && Number(confidence || 0) >= 0.5;
}

function pickRecommendedChannel(input: BuildRevenueQualificationInput): RecommendedChannel {
  if (input.emailReady) return "EMAIL";
  if (hasCallablePhone(input.phone, input.phoneConfidence)) return "PHONE";
  if (input.hasContactForm) return "FORM";
  if (input.hasSocialMessaging) return "SOCIAL";
  return "RESEARCH";
}

export function buildRevenueQualification(
  input: BuildRevenueQualificationInput,
): RevenueQualificationDraft {
  const breakdown = parseScoreBreakdown(input.scoreBreakdown);
  const websiteNeedScore = scale(breakdown.painOpportunity, 35, 40);
  const businessFitScore = Math.round(clamp(Number(breakdown.businessValue || 0), 0, 25));
  const reachabilityScore = scale(breakdown.reachability, 25, 20);
  const timingScore = Math.round(clamp(Number(breakdown.localFit || 0), 0, 15));
  const totalScore = websiteNeedScore + businessFitScore + reachabilityScore + timingScore;
  const recommendedChannel = pickRecommendedChannel(input);
  const hardGateStatus = input.hardDisqualified ? "DISQUALIFIED" : "PASS";

  let band: QualificationBand;
  if (input.hardDisqualified || totalScore < REVENUE_OUTREACH_MIN_SCORE) {
    band = "RESEARCH";
  } else if (recommendedChannel === "RESEARCH") {
    band = "REVIEW";
  } else if (totalScore >= REVENUE_PRIORITY_MIN_SCORE) {
    band = "PRIORITY";
  } else {
    band = "OUTREACH";
  }

  const routeReason = `route_${recommendedChannel.toLowerCase()}`;
  const reasonCodes = Array.from(
    new Set([
      ...(input.reasonCodes || []),
      routeReason,
      ...(input.hardDisqualified ? ["hard_disqualified"] : []),
    ]),
  );

  return {
    autonomousEmailEligible:
      recommendedChannel === "EMAIL" && (band === "OUTREACH" || band === "PRIORITY"),
    band,
    businessFitScore,
    evidence: {
      emailReady: input.emailReady,
      hasCallablePhone: hasCallablePhone(input.phone, input.phoneConfidence),
      hasContactForm: input.hasContactForm,
      hasSocialMessaging: input.hasSocialMessaging,
      websiteLabel: input.websiteLabel || null,
      websiteStatus: input.websiteStatus || null,
    },
    hardGateStatus,
    legacyScore: Math.round(clamp(input.legacyScore, 0, 100)),
    policyVersion: REVENUE_QUALIFICATION_POLICY_VERSION,
    reachabilityScore,
    reasonCodes,
    recommendedChannel,
    timingScore,
    totalScore,
    websiteNeedScore,
  };
}

export async function recordQualificationSnapshot(input: {
  draft: RevenueQualificationDraft;
  leadId: number;
  sourceJobId?: string | null;
}) {
  const snapshotKey = `${input.leadId}:${input.draft.policyVersion}:${input.sourceJobId || "manual"}`;
  const now = new Date().toISOString();

  return getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO "QualificationSnapshot" (
        "id", "snapshotKey", "leadId", "policyVersion", "legacyScore", "totalScore",
        "websiteNeedScore", "businessFitScore", "reachabilityScore", "timingScore",
        "hardGateStatus", "band", "recommendedChannel", "autonomousEmailEligible",
        "reasonCodesJson", "evidenceJson", "sourceJobId", "createdAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      snapshotKey,
      input.leadId,
      input.draft.policyVersion,
      input.draft.legacyScore,
      input.draft.totalScore,
      input.draft.websiteNeedScore,
      input.draft.businessFitScore,
      input.draft.reachabilityScore,
      input.draft.timingScore,
      input.draft.hardGateStatus,
      input.draft.band,
      input.draft.recommendedChannel,
      input.draft.autonomousEmailEligible ? 1 : 0,
      JSON.stringify(input.draft.reasonCodes),
      JSON.stringify(input.draft.evidence),
      input.sourceJobId || null,
      now,
    )
    .run();
}
