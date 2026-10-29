import { z } from "zod";

import { DeterministicWebsiteAuditResultSchema } from "@/lib/revenue-engine/website-audit";

export const KW_LEAD_EVALUATION_VERSION = "kw-lead-quality-v1";
export const KW_LEAD_EVALUATION_TARGET_SIZE = 50;
export const KW_LEAD_EVALUATION_MINIMUM_AGREEMENT = 85;

export const KwEvaluationCitySchema = z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]);
export const KwEvaluationNicheSchema = z.enum(["ROOFING", "HVAC", "LANDSCAPING"]);
export const LeadQualityLabelSchema = z.enum(["STRONG", "WEAK", "WRONG"]);
export const OwnerLeadQualityLabelSchema = z.enum(["UNREVIEWED", ...LeadQualityLabelSchema.options]);
export const OwnerLeadReasonSchema = z.enum([
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

const EvaluationScoresSchema = z
  .object({
    businessFit: z.number().int().min(0).max(100),
    rebuildNeed: z.number().int().min(0).max(100),
    reachability: z.number().int().min(0).max(100),
    timing: z.number().int().min(0).max(100),
    evidenceConfidence: z.number().int().min(0).max(100),
  })
  .strict();

export const KwLeadEvaluationEntrySchema = z
  .object({
    entryVersion: z.literal(KW_LEAD_EVALUATION_VERSION),
    leadId: z.string().trim().min(1).max(128),
    businessId: z.string().trim().min(1).max(128),
    businessIdentityKey: z.string().trim().min(8).max(256),
    businessName: z.string().trim().min(1).max(256),
    city: KwEvaluationCitySchema,
    niche: KwEvaluationNicheSchema,
    sourceEvidenceUrl: z.string().url(),
    websiteUrl: z.string().url().nullable(),
    audit: DeterministicWebsiteAuditResultSchema,
    engineAssessment: z
      .object({
        label: LeadQualityLabelSchema,
        scores: EvaluationScoresSchema,
        policyVersion: z.string().trim().min(1).max(80),
        assessedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    ownerReview: z
      .object({
        label: OwnerLeadQualityLabelSchema,
        reasons: z.array(OwnerLeadReasonSchema).max(5),
        notes: z.string().trim().max(500),
        reviewedAt: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
    addedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.audit.businessId !== entry.businessId) {
      context.addIssue({
        code: "custom",
        message: "The audit must belong to the evaluated business.",
        path: ["audit", "businessId"],
      });
    }
    if (entry.ownerReview.label === "UNREVIEWED" && entry.ownerReview.reviewedAt) {
      context.addIssue({
        code: "custom",
        message: "An unreviewed lead cannot have a review timestamp.",
        path: ["ownerReview", "reviewedAt"],
      });
    }
    if (entry.ownerReview.label !== "UNREVIEWED" && !entry.ownerReview.reviewedAt) {
      context.addIssue({
        code: "custom",
        message: "A reviewed lead requires a review timestamp.",
        path: ["ownerReview", "reviewedAt"],
      });
    }
    if (entry.ownerReview.label !== "UNREVIEWED" && entry.ownerReview.reasons.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A reviewed lead requires at least one short reason.",
        path: ["ownerReview", "reasons"],
      });
    }
  });

export const KwLeadEvaluationSetSchema = z
  .object({
    setVersion: z.literal(KW_LEAD_EVALUATION_VERSION),
    setId: z.string().trim().min(8).max(128),
    market: z.literal("KITCHENER_WATERLOO_CAMBRIDGE"),
    targetSize: z.literal(KW_LEAD_EVALUATION_TARGET_SIZE),
    createdAt: z.string().datetime({ offset: true }),
    entries: z.array(KwLeadEvaluationEntrySchema).max(KW_LEAD_EVALUATION_TARGET_SIZE),
  })
  .strict()
  .superRefine((set, context) => {
    const leadIds = new Set(set.entries.map((entry) => entry.leadId));
    if (leadIds.size !== set.entries.length) {
      context.addIssue({
        code: "custom",
        message: "Evaluation lead IDs must be unique.",
        path: ["entries"],
      });
    }
    const identities = new Set(set.entries.map((entry) => entry.businessIdentityKey));
    if (identities.size !== set.entries.length) {
      context.addIssue({
        code: "custom",
        message: "Evaluation business identities must be unique.",
        path: ["entries"],
      });
    }
    const businessIds = new Set(set.entries.map((entry) => entry.businessId));
    if (businessIds.size !== set.entries.length) {
      context.addIssue({
        code: "custom",
        message: "Evaluation businesses must be unique.",
        path: ["entries"],
      });
    }
  });

export type KwLeadEvaluationEntry = z.infer<typeof KwLeadEvaluationEntrySchema>;
export type KwLeadEvaluationSet = z.infer<typeof KwLeadEvaluationSetSchema>;

export function summarizeKwLeadEvaluation(value: KwLeadEvaluationSet) {
  const set = KwLeadEvaluationSetSchema.parse(value);
  const reviewed = set.entries.filter((entry) => entry.ownerReview.label !== "UNREVIEWED");
  const agreements = reviewed.filter((entry) => entry.ownerReview.label === entry.engineAssessment.label).length;
  const agreementPercent = reviewed.length === 0 ? 0 : Math.round((agreements / reviewed.length) * 100);
  const countsByCity = Object.fromEntries(
    KwEvaluationCitySchema.options.map((city) => [city, set.entries.filter((entry) => entry.city === city).length]),
  ) as Record<z.infer<typeof KwEvaluationCitySchema>, number>;
  const countsByNiche = Object.fromEntries(
    KwEvaluationNicheSchema.options.map((niche) => [niche, set.entries.filter((entry) => entry.niche === niche).length]),
  ) as Record<z.infer<typeof KwEvaluationNicheSchema>, number>;
  const gateReasons = [
    ...(set.entries.length !== KW_LEAD_EVALUATION_TARGET_SIZE
      ? [`needs_${KW_LEAD_EVALUATION_TARGET_SIZE - set.entries.length}_more_leads`]
      : []),
    ...(reviewed.length !== KW_LEAD_EVALUATION_TARGET_SIZE
      ? [`needs_${KW_LEAD_EVALUATION_TARGET_SIZE - reviewed.length}_more_owner_reviews`]
      : []),
    ...(Object.values(countsByCity).some((count) => count < 10) ? ["each_city_needs_at_least_10_leads"] : []),
    ...(Object.values(countsByNiche).some((count) => count < 10) ? ["each_niche_needs_at_least_10_leads"] : []),
    ...(reviewed.length === KW_LEAD_EVALUATION_TARGET_SIZE && agreementPercent < KW_LEAD_EVALUATION_MINIMUM_AGREEMENT
      ? [`agreement_below_${KW_LEAD_EVALUATION_MINIMUM_AGREEMENT}_percent`]
      : []),
  ];

  return {
    targetSize: KW_LEAD_EVALUATION_TARGET_SIZE,
    loaded: set.entries.length,
    reviewed: reviewed.length,
    agreements,
    agreementPercent,
    countsByCity,
    countsByNiche,
    ready: gateReasons.length === 0,
    gateReasons,
  };
}
