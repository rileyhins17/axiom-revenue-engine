import { z } from "zod";
import type { M2ManualWebsiteObservationCommand, M2ManualWebsiteObservationTarget } from "./m2-manual-website-observation";
import { privateKwM2ReceiptCanonicalDigest } from "./private-kw-m2-canonical";

const TimestampSchema = z.string().datetime({ offset: true });

/** One delegated Codex source decision for an exact page and facts-only retention. */
export const M2CodexManualObservationAuthorizationSchema = z.object({
  authorizationId: z.string().uuid(),
  status: z.literal("APPROVED"),
  authorizedBy: z.literal("CODEX"),
  delegationBasis: z.literal("OWNER_DELEGATION"),
  delegationVersion: z.literal("M2_CODEX_LOCAL_MANUAL_FACTS_ONLY_V1"),
  delegatedBy: z.literal("RILEY"),
  scope: z.literal("LOCAL_MANUAL_OBSERVATION_ONLY"),
  commandId: z.string().uuid(),
  reviewId: z.string().regex(/^M2-(0[1-9]|10)$/),
  businessName: z.string().trim().min(1).max(256),
  businessIdentityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  websiteOrigin: z.string().url(),
  pageUrl: z.string().url(),
  method: z.literal("MANUAL"),
  authorizedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  retentionReviewDate: TimestampSchema,
  retention: z.literal("DERIVED_FACTS_ONLY"),
  rawHtmlRetentionAuthorized: z.literal(false),
  copiedTextRetentionAuthorized: z.literal(false),
  personalOrContactDataAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedCad: z.literal(0),
}).strict();
export type M2CodexManualObservationAuthorization = z.infer<typeof M2CodexManualObservationAuthorizationSchema>;

export function assertM2CodexManualObservationAuthorization(
  authorizationInput: unknown,
  target: M2ManualWebsiteObservationTarget,
  command: M2ManualWebsiteObservationCommand,
  now: Date,
) {
  const authorization = M2CodexManualObservationAuthorizationSchema.parse(authorizationInput);
  const approved = new URL(target.approvedWebsiteUrl);
  const origin = new URL(authorization.websiteOrigin);
  const page = new URL(authorization.pageUrl);
  const expiresAt = Date.parse(authorization.expiresAt);
  const retentionReviewDate = Date.parse(authorization.retentionReviewDate);
  const authorizedAt = Date.parse(authorization.authorizedAt);
  if (!Number.isFinite(now.getTime()) || authorizedAt > now.getTime() || expiresAt <= now.getTime()) {
    throw new Error("The source-specific manual authorization is not currently valid.");
  }
  if (authorization.reviewId !== target.reviewId
    || authorization.businessName !== target.businessName
    || authorization.businessIdentityDigest !== target.businessIdentityDigest
    || authorization.commandId !== command.commandId
    || origin.origin !== approved.origin
    || authorization.websiteOrigin !== origin.origin
    || authorization.pageUrl !== page.href
    || authorization.pageUrl !== command.observedUrl
    || command.reviewId !== target.reviewId) {
    throw new Error("The source-specific authorization does not match this exact current identity and page.");
  }
  if (retentionReviewDate <= now.getTime() || retentionReviewDate - authorizedAt > 30 * 24 * 60 * 60 * 1000) {
    throw new Error("The facts-only retention review date must be current and no more than 30 days after authorization.");
  }
  return { authorization, authorizationDigest: privateKwM2ReceiptCanonicalDigest(authorization) };
}
