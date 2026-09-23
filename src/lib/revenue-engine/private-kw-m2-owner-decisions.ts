import { createHash } from "node:crypto";
import {
  PrivateKwImportPlanSchema,
  type PrivateKwImportPlan,
} from "./private-kw-import";
import { buildPrivateKwPersistencePlan } from "./private-kw-persistence-plan";
import { normalizePublicWebsiteUrl } from "./public-website-url";
import {
  PrivateKwShadowSliceInputSchema,
  buildPrivateKwShadowSliceManifest,
} from "./private-kw-shadow-slice";
import { privateKwM2Digest } from "./private-kw-m2-authorization";
import { z } from "zod";

export const PRIVATE_KW_M2_OWNER_DECISIONS_VERSION = "kw-m2-owner-decisions-v1";

const CandidateReviewSchema = z.object({
  reviewId: z.string().regex(/^M2-(0[1-9]|10)$/),
  name: z.string().trim().min(1).max(256),
  officialWebsite: z.string().url(),
  city: z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]),
  niche: z.enum(["ROOFING", "HVAC", "LANDSCAPING"]),
  primarySource: z.string().url(),
  sources: z.array(z.string().url()).min(1),
  disposition: z.literal("PROPOSED_FOR_OWNER_IDENTITY_REVIEW"),
  ownerIdentityReview: z.literal("PENDING"),
}).passthrough();

const AlternateReviewSchema = z.object({
  name: z.string().trim().min(1).max(256),
  officialWebsite: z.string().url(),
  sourceUrl: z.string().url(),
  sources: z.array(z.string().url()).min(1),
  disposition: z.literal("SUPPORTED_ALTERNATE"),
}).passthrough();

export const PrivateKwM2ResearchReviewSchema = z.object({
  schemaVersion: z.literal(1),
  protocolVersion: z.literal("m2-public-research-v1"),
  researchOnly: z.literal(true),
  ownerIdentityReview: z.literal("PENDING"),
  selected: z.array(CandidateReviewSchema).length(10),
  unselected: z.array(z.unknown()),
}).passthrough().superRefine((value, context) => {
  const expected = Array.from({ length: 10 }, (_, index) => `M2-${String(index + 1).padStart(2, "0")}`);
  const ids = value.selected.map((candidate) => candidate.reviewId);
  if (new Set(ids).size !== 10 || expected.some((id) => !ids.includes(id))) {
    context.addIssue({ code: "custom", path: ["selected"], message: "Research review must contain M2-01 through M2-10 exactly once." });
  }
});

const ConfirmationsSchema = z.object({
  identityConfirmed: z.literal(true),
  marketAndNicheConfirmed: z.literal(true),
  independenceConfirmed: z.literal(true),
}).strict();

const ReplacementDecisionSchema = z.object({
  name: z.string().trim().min(1).max(256),
  city: z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]),
  niche: z.enum(["ROOFING", "HVAC", "LANDSCAPING"]),
  sourceEvidenceUrl: z.string().url(),
  websiteUrl: z.string().url(),
  ...ConfirmationsSchema.shape,
  rationale: z.string().trim().min(10).max(500),
}).strict();

const OwnerDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    reviewId: CandidateReviewSchema.shape.reviewId,
    action: z.enum(["KEEP", "KEEP_AS_BLOCKED"]),
    rationale: z.string().trim().min(10).max(500),
    ...ConfirmationsSchema.shape,
  }).strict(),
  z.object({
    reviewId: CandidateReviewSchema.shape.reviewId,
    action: z.literal("REPLACE"),
    rationale: z.string().trim().min(10).max(500),
    replacement: ReplacementDecisionSchema,
  }).strict(),
  z.object({
    reviewId: CandidateReviewSchema.shape.reviewId,
    action: z.enum(["HOLD", "REJECT"]),
    rationale: z.string().trim().min(10).max(500),
  }).strict(),
]);

export const PrivateKwM2OwnerDecisionsSchema = z.object({
  decisionVersion: z.literal(PRIVATE_KW_M2_OWNER_DECISIONS_VERSION),
  researchReviewSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourcePlanDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reviewedBy: z.enum(["RILEY", "AIDAN"]),
  reviewedAt: z.string().datetime({ offset: true }),
  decisions: z.array(OwnerDecisionSchema).length(10),
}).strict().superRefine((value, context) => {
  const ids = value.decisions.map((decision) => decision.reviewId);
  if (new Set(ids).size !== 10) {
    context.addIssue({ code: "custom", path: ["decisions"], message: "Owner decisions must contain exactly one decision for each proposed M2 identity." });
  }
});

export type PrivateKwM2OwnerDecisions = z.infer<typeof PrivateKwM2OwnerDecisionsSchema>;
export type PrivateKwM2ResearchReview = z.infer<typeof PrivateKwM2ResearchReviewSchema>;

export type PrivateKwM2OwnerDecisionSelectionInput = {
  researchReview: unknown;
  researchReviewBytes: Uint8Array;
  sourcePlan: unknown;
  decisions: unknown;
  createdAt: string;
};

const DOCUMENTED_ACCESS_BLOCKS = new Map([
  ["M2-06", "comfortairontario.ca"],
  ["M2-10", "tricitylandscaper.ca"],
]);

function hasDocumentedAccessBlock(candidate: z.infer<typeof CandidateReviewSchema>) {
  const expectedHost = DOCUMENTED_ACCESS_BLOCKS.get(candidate.reviewId);
  if (!expectedHost) return false;
  try {
    const actualHost = new URL(candidate.officialWebsite).hostname.toLocaleLowerCase("en-CA");
    if (actualHost !== expectedHost) {
      throw new Error(`${candidate.reviewId} no longer matches the reviewed access-denied site ${expectedHost}; re-audit the packet before preparing decisions.`);
    }
    return true;
  } catch {
    throw new Error(`${candidate.reviewId} no longer matches the reviewed access-denied site ${expectedHost}; re-audit the packet before preparing decisions.`);
  }
}

function findSelectedSourceRecord(review: z.infer<typeof CandidateReviewSchema>, plan: PrivateKwImportPlan) {
  const sourceOwnedId = review.reviewId.toLocaleLowerCase("en-CA");
  const matches = plan.records.filter((record) => record.sourceOwnedId.toLocaleLowerCase("en-CA") === sourceOwnedId);
  if (matches.length !== 1) throw new Error(`Source plan must contain exactly one record for ${review.reviewId}.`);
  const [record] = matches;
  if (
    record.business.canonicalName !== review.name
    || record.location.city !== review.city
    || record.niche !== review.niche
    || record.sourceRecord.sourceEvidenceUrl !== review.primarySource
    || record.sourceRecord.websiteUrl !== normalizePublicWebsiteUrl(review.officialWebsite)
    || record.business.independenceStatus !== "INDEPENDENT"
  ) {
    throw new Error(`Source plan identity, market, niche, independence, or source does not match ${review.reviewId}.`);
  }
  return record;
}

function findReplacementSourceRecord(
  replacement: z.infer<typeof ReplacementDecisionSchema>,
  researchReview: z.infer<typeof PrivateKwM2ResearchReviewSchema>,
  plan: PrivateKwImportPlan,
) {
  const alternates = researchReview.unselected
    .map((item) => AlternateReviewSchema.safeParse(item))
    .filter((item) => item.success)
    .map((item) => item.data);
  const reviewMatches = alternates.filter((candidate) =>
    candidate.name === replacement.name
    && candidate.officialWebsite === replacement.websiteUrl
    && candidate.sourceUrl === replacement.sourceEvidenceUrl
    && candidate.sources.includes(replacement.sourceEvidenceUrl),
  );
  if (reviewMatches.length !== 1) {
    throw new Error("Replacement must match one exact supported alternate in the saved research review.");
  }
  const matches = plan.records.filter((record) =>
    record.business.canonicalName === replacement.name
    && record.location.city === replacement.city
    && record.niche === replacement.niche
    && record.sourceRecord.sourceEvidenceUrl === replacement.sourceEvidenceUrl
    && record.sourceRecord.websiteUrl === normalizePublicWebsiteUrl(replacement.websiteUrl)
    && record.business.independenceStatus === "INDEPENDENT",
  );
  if (matches.length !== 1) {
    throw new Error("Replacement is not present exactly once in the supplied source plan; prepare a new reviewed source plan first.");
  }
  return matches[0]!;
}

export function buildPrivateKwM2OwnerDecisionSelection(input: PrivateKwM2OwnerDecisionSelectionInput) {
  const review = PrivateKwM2ResearchReviewSchema.parse(input.researchReview);
  const sourcePlan = PrivateKwImportPlanSchema.parse(input.sourcePlan);
  const decisions = PrivateKwM2OwnerDecisionsSchema.parse(input.decisions);
  const researchReviewSha256 = createHash("sha256").update(input.researchReviewBytes).digest("hex");
  const sourcePlanDigest = buildPrivateKwPersistencePlan(sourcePlan).sourcePlanDigest;
  if (decisions.researchReviewSha256 !== researchReviewSha256) {
    throw new Error("Owner decisions do not bind the exact research review digest (SHA-256).");
  }
  let reviewFromBytes: unknown;
  try {
    reviewFromBytes = JSON.parse(Buffer.from(input.researchReviewBytes).toString("utf8"));
  } catch {
    throw new Error("Research review bytes are not valid JSON.");
  }
  if (privateKwM2Digest(reviewFromBytes) !== privateKwM2Digest(review)) {
    throw new Error("Research review bytes do not match the parsed research review.");
  }
  if (decisions.sourcePlanDigest !== undefined && decisions.sourcePlanDigest !== sourcePlanDigest) {
    throw new Error("Owner decisions do not bind the exact source plan digest.");
  }

  const decisionsById = new Map(decisions.decisions.map((decision) => [decision.reviewId, decision]));
  const reviewById = new Map(review.selected.map((candidate) => [candidate.reviewId, candidate]));
  const selected = [] as Array<{ businessId: string; evaluationCandidateId: string; sourceReview: {
    decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE"; reviewedBy: "RILEY" | "AIDAN"; reviewedAt: string;
    rationale: string; identityConfirmed: true; marketAndNicheConfirmed: true; independenceConfirmed: true;
  } }>;

  for (const reviewId of Array.from({ length: 10 }, (_, index) => `M2-${String(index + 1).padStart(2, "0")}`)) {
    const decision = decisionsById.get(reviewId)!;
    const candidate = reviewById.get(reviewId)!;
    const documentedAccessBlock = hasDocumentedAccessBlock(candidate);
    if (documentedAccessBlock && decision.action === "KEEP") {
      throw new Error(`${reviewId} has a documented access denial and requires KEEP_AS_BLOCKED or an explicit HOLD/REJECT disposition.`);
    }
    if (decision.action === "KEEP_AS_BLOCKED" && !documentedAccessBlock) {
      throw new Error(`${reviewId} has no documented access denial and cannot use KEEP_AS_BLOCKED.`);
    }
    if (decision.action === "KEEP_AS_BLOCKED") {
      throw new Error(`${reviewId} remains explicitly blocked in the owner decision ledger and cannot enter a shadow selection; replace it with a reviewed source-plan member or leave the cohort incomplete.`);
    }
    if (decision.action === "HOLD" || decision.action === "REJECT") continue;
    const sourceRecord = decision.action === "REPLACE"
      ? findReplacementSourceRecord(decision.replacement, review, sourcePlan)
      : findSelectedSourceRecord(candidate, sourcePlan);
    const rationale = decision.action === "REPLACE" ? decision.replacement.rationale : decision.rationale;
    selected.push({
      businessId: sourceRecord.business.id,
      evaluationCandidateId: sourceRecord.evaluationCandidateId,
      sourceReview: {
        decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE",
        reviewedBy: decisions.reviewedBy,
        reviewedAt: decisions.reviewedAt,
        rationale,
        identityConfirmed: true,
        marketAndNicheConfirmed: true,
        independenceConfirmed: true,
      },
    });
  }
  if (selected.length !== 10) {
    throw new Error(`Exactly ten confirmed candidates are required; owner decisions currently select ${selected.length}.`);
  }
  if (new Set(selected.map((item) => item.businessId)).size !== 10 || new Set(selected.map((item) => item.evaluationCandidateId)).size !== 10) {
    throw new Error("The final selection contains duplicate business or candidate identities.");
  }
  const selection = PrivateKwShadowSliceInputSchema.parse({
    sliceVersion: "kw-shadow-slice-v1",
    sliceKey: `m2-owner-review-${decisions.reviewedAt.slice(0, 10).replaceAll("-", "")}`,
    sourceImportId: sourcePlan.importId,
    sourcePlanDigest,
    createdAt: input.createdAt,
    selections: selected,
    mode: "SHADOW",
    authority: {
      planOnly: true,
      liveSourceAuthorized: false,
      browserCaptureAuthorized: false,
      artifactStorageAuthorized: false,
      databaseMutationAuthorized: false,
      contactDiscoveryExecutionAuthorized: false,
      contactVerificationExecutionAuthorized: false,
      consentDecisionAuthorized: false,
      qualificationAuthorized: false,
      mailboxSyncAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      deploymentAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  });
  buildPrivateKwShadowSliceManifest(sourcePlan, selection);
  return selection;
}
