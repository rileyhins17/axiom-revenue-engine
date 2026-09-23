import { z } from "zod";
import { privateKwM2ReceiptCanonicalDigest } from "./private-kw-m2-canonical";

export const M2_MANUAL_WEBSITE_OBSERVATION_VERSION = "kw-m2-manual-website-observation-v1" as const;
export const M2_MANUAL_WEBSITE_AUDIT_VERSION = "kw-m2-manual-audit-v1" as const;

const ReviewIdSchema = z.string().regex(/^M2-(0[1-9]|10)$/);
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const M2ManualWebsiteObservationTargetSchema = z.object({
  reviewId: ReviewIdSchema,
  businessName: z.string().trim().min(1).max(256),
  approvedWebsiteUrl: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
  businessIdentityDigest: DigestSchema,
}).strict();
export type M2ManualWebsiteObservationTarget = z.infer<typeof M2ManualWebsiteObservationTargetSchema>;

export const M2ManualWebsiteObservationCommandSchema = z.object({
  commandId: z.string().uuid(),
  reviewId: ReviewIdSchema,
  observedUrl: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  evidenceState: z.enum(["OBSERVED", "INSUFFICIENT"]),
  observation: z.string().max(500),
  noCopiedOrPersonalData: z.literal(true),
}).strict();
export type M2ManualWebsiteObservationCommand = z.infer<typeof M2ManualWebsiteObservationCommandSchema>;

const AuthoritySchema = z.object({
  qualificationAuthorized: z.literal(false),
  contactAuthorized: z.literal(false),
  consentAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedCad: z.literal(0),
}).strict();

const M2ManualWebsiteObservationShape = z.object({
  observationVersion: z.literal(M2_MANUAL_WEBSITE_OBSERVATION_VERSION),
  observationId: z.string().regex(/^m2-manual-observation:[a-f0-9]{64}$/),
  commandId: z.string().uuid(),
  recordedBy: z.enum(["RILEY", "AIDAN"]),
  reviewId: ReviewIdSchema,
  businessName: z.string().trim().min(1).max(256),
  businessIdentityDigest: DigestSchema,
  observedUrl: z.string().url(),
  observedAt: TimestampSchema,
  method: z.literal("MANUAL"),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  evidenceState: z.enum(["OBSERVED", "INSUFFICIENT"]),
  observation: z.string().max(500).nullable(),
  auditVersion: z.literal(M2_MANUAL_WEBSITE_AUDIT_VERSION),
  assessment: z.object({
    websiteNeed: z.literal("UNKNOWN"),
    qualification: z.literal("RESEARCH"),
    scores: z.object({
      rebuildNeed: z.literal(0), businessFit: z.literal(0), timing: z.literal(0),
      reachability: z.literal(0), evidenceConfidence: z.literal(0),
    }).strict(),
  }).strict(),
  authority: AuthoritySchema,
}).strict();

export const M2ManualWebsiteObservationSchema = M2ManualWebsiteObservationShape.superRefine((value, ctx) => {
  const hasObservation = Boolean(value.observation?.trim());
  if (value.evidenceState === "OBSERVED" && (!value.observation || value.observation.trim().length < 20)) {
    ctx.addIssue({ code: "custom", path: ["observation"], message: "A manual observation must contain at least 20 characters in the operator's own words." });
  }
  if (value.evidenceState === "INSUFFICIENT" && hasObservation) {
    ctx.addIssue({ code: "custom", path: ["observation"], message: "Insufficient evidence cannot contain a guessed observation." });
  }
});
export type M2ManualWebsiteObservation = z.infer<typeof M2ManualWebsiteObservationSchema>;

export const M2ManualWebsiteObservationInputSchema = M2ManualWebsiteObservationShape.omit({ observationId: true });
export const M2ManualWebsiteObservationAssessment = {
  websiteNeed: "UNKNOWN",
  qualification: "RESEARCH",
  scores: { rebuildNeed: 0, businessFit: 0, timing: 0, reachability: 0, evidenceConfidence: 0 },
} as const;
export const M2_MANUAL_WEBSITE_OBSERVATION_AUTHORITY = {
  qualificationAuthorized: false,
  contactAuthorized: false,
  consentAuthorized: false,
  outreachAuthorized: false,
  sendAuthorized: false,
  deploymentAuthorized: false,
  providerOperationsAuthorized: 0,
  costAuthorizedCad: 0,
} as const;

const contactValueSignals = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+?\d[\d ().-]{7,}\d)/,
];
const forbiddenPersonalOrCopiedSignals = [
  ...contactValueSignals,
  /https?:\/\//i,
];

export function buildM2ManualWebsiteObservation(
  input: unknown,
  targetInput: M2ManualWebsiteObservationTarget,
  recordedBy: "RILEY" | "AIDAN",
  observedAt: string,
): Omit<M2ManualWebsiteObservation, "observationId"> {
  const command = M2ManualWebsiteObservationCommandSchema.parse(input);
  const target = M2ManualWebsiteObservationTargetSchema.parse(targetInput);
  if (!TimestampSchema.safeParse(observedAt).success) throw new Error("The manual observation time is invalid.");
  if (command.reviewId !== target.reviewId) throw new Error("This observation does not match the approved M2 identity.");

  const approvedUrl = new URL(target.approvedWebsiteUrl);
  const observedUrl = new URL(command.observedUrl);
  if (observedUrl.username || observedUrl.password || observedUrl.origin !== approvedUrl.origin) {
    throw new Error("The observation URL must use the exact approved website origin.");
  }
  if (observedUrl.search || observedUrl.hash || contactValueSignals.some((pattern) => pattern.test(command.observedUrl))) {
    throw new Error("The observed URL cannot contain query values, fragments, or contact details.");
  }

  let observation: string | null = null;
  if (command.evidenceState === "OBSERVED") {
    const text = command.observation.trim().replace(/\s+/g, " ");
    if (text.length < 20 || forbiddenPersonalOrCopiedSignals.some((pattern) => pattern.test(text))) {
      throw new Error("Use one concise company-level observation in your own words, without copied page text or personal/contact details.");
    }
    observation = text;
  } else if (command.observation.trim()) {
    throw new Error("Insufficient evidence must be saved without a guessed observation.");
  }

  return M2ManualWebsiteObservationInputSchema.parse({
    observationVersion: M2_MANUAL_WEBSITE_OBSERVATION_VERSION,
    commandId: command.commandId,
    recordedBy,
    reviewId: target.reviewId,
    businessName: target.businessName,
    businessIdentityDigest: target.businessIdentityDigest,
    observedUrl: command.observedUrl,
    observedAt,
    method: "MANUAL",
    confidence: command.confidence,
    evidenceState: command.evidenceState,
    observation,
    auditVersion: M2_MANUAL_WEBSITE_AUDIT_VERSION,
    assessment: M2ManualWebsiteObservationAssessment,
    authority: M2_MANUAL_WEBSITE_OBSERVATION_AUTHORITY,
  });
}

export function sealM2ManualWebsiteObservation(input: Omit<M2ManualWebsiteObservation, "observationId">): M2ManualWebsiteObservation {
  const digest = privateKwM2ReceiptCanonicalDigest(input);
  return M2ManualWebsiteObservationSchema.parse({ ...input, observationId: `m2-manual-observation:${digest}` });
}
