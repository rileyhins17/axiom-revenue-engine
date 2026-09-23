import { createHash } from "node:crypto";
import { z } from "zod";

import { identityDigest } from "./m2-delegated-targets";
import type { M2WebsiteNeedAssessment, M2WebsiteNeedTarget, WebsiteNeed } from "./m2-website-need-assessment";

/**
 * M3: a fixed 50-business website-need evaluation set (ten M2 + forty M3 cases).
 * The rule label comes only from the deterministic need rule; the reviewer label is
 * a separate holistic judgement, including whether the business is a real
 * independent target at all. Their disagreements show where the rule needs work.
 */
export const M3_SELECTION_SHA256 = "d7848b6e4ba6c831c106cee5d1f8cfee76b40409323b65015af174ec0fbc16fb";
export const M3_EVALUATION_VERSION = "kw-m3-website-need-evaluation-v1" as const;

const CitySchema = z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]);
const NicheSchema = z.enum(["ROOFING", "HVAC", "LANDSCAPING"]);
export const M3SelectionSchema = z.object({
  selectionVersion: z.literal("kw-m3-selection-v1"),
  prescreenFile: z.string().min(1),
  prescreenSha256: z.string().regex(/^[a-f0-9]{64}$/),
  selectedBy: z.literal("CLAUDE"),
  delegatedBy: z.literal("RILEY"),
  rule: z.string().min(10),
  entries: z.array(z.object({
    reviewId: z.string().regex(/^M3-(0[1-9]|[1-3][0-9]|40)$/),
    prescreenIndex: z.number().int().min(0),
    businessName: z.string().trim().min(1).max(256),
    city: CitySchema,
    niche: NicheSchema,
    approvedWebsiteUrl: z.string().url(),
  }).strict()).length(40),
}).strict();
export type M3Selection = z.infer<typeof M3SelectionSchema>;

export function parseM3Selection(bytes: Uint8Array, expectedSha256 = M3_SELECTION_SHA256): M3Selection {
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw new Error("The M3 selection does not match its recorded digest.");
  const selection = M3SelectionSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (new Set(selection.entries.map((entry) => entry.reviewId)).size !== 40) throw new Error("M3 review IDs must be unique.");
  return selection;
}

export function m3Targets(selection: M3Selection): M2WebsiteNeedTarget[] {
  return selection.entries.map((entry) => ({
    reviewId: entry.reviewId, businessName: entry.businessName, approvedWebsiteUrl: entry.approvedWebsiteUrl,
    businessIdentityDigest: identityDigest(entry.reviewId, entry.businessName, entry.approvedWebsiteUrl),
  }));
}

export const LeadLabelSchema = z.enum(["STRONG", "WEAK", "WRONG"]);
export type LeadLabel = z.infer<typeof LeadLabelSchema>;
export const M3ReviewerLabelsSchema = z.object({
  labelsVersion: z.literal("kw-m3-reviewer-labels-v1"),
  labelledBy: z.literal("CLAUDE"),
  delegatedBy: z.literal("RILEY"),
  labels: z.record(z.string(), z.object({ label: LeadLabelSchema, reason: z.string().trim().min(10).max(300) }).strict()),
}).strict();

/** The rule sees only website need: a rebuild case is STRONG, everything else WEAK. */
export function ruleLabel(need: WebsiteNeed): LeadLabel {
  return need === "REBUILD" ? "STRONG" : "WEAK";
}

export type M3Case = { reviewId: string; businessName: string; city: z.infer<typeof CitySchema>; niche: z.infer<typeof NicheSchema>; assessment: M2WebsiteNeedAssessment; reviewerLabel: LeadLabel };

export function summarizeM3Evaluation(cases: M3Case[]) {
  const countBy = <K extends string>(key: (item: M3Case) => K) => cases.reduce<Record<string, number>>((acc, item) => { acc[key(item)] = (acc[key(item)] ?? 0) + 1; return acc; }, {});
  const byCity = countBy((item) => item.city);
  const byNiche = countBy((item) => item.niche);
  const balanced = CitySchema.options.every((city) => (byCity[city] ?? 0) >= 10) && NicheSchema.options.every((niche) => (byNiche[niche] ?? 0) >= 10);
  const agreements = cases.filter((item) => ruleLabel(item.assessment.websiteNeed) === item.reviewerLabel).length;
  const classes = LeadLabelSchema.options.map((label) => {
    const truePositive = cases.filter((item) => item.reviewerLabel === label && ruleLabel(item.assessment.websiteNeed) === label).length;
    const actual = cases.filter((item) => item.reviewerLabel === label).length;
    const predicted = cases.filter((item) => ruleLabel(item.assessment.websiteNeed) === label).length;
    return { label, reviewerCount: actual, ruleCount: predicted, recall: actual ? truePositive / actual : null, precision: predicted ? truePositive / predicted : null };
  });
  return {
    evaluationVersion: M3_EVALUATION_VERSION,
    total: cases.length,
    complete: cases.length === 50,
    balanced,
    byCity, byNiche,
    websiteNeed: countBy((item) => item.assessment.websiteNeed),
    reviewerLabels: countBy((item) => item.reviewerLabel),
    ruleAgreement: { agreements, total: cases.length, percent: cases.length ? Math.round((agreements / cases.length) * 100) : 0 },
    classes,
    disagreements: cases.filter((item) => ruleLabel(item.assessment.websiteNeed) !== item.reviewerLabel)
      .map((item) => ({ reviewId: item.reviewId, rule: ruleLabel(item.assessment.websiteNeed), reviewer: item.reviewerLabel })),
    ownerAgreement: "NOT_MEASURED" as const,
  };
}
