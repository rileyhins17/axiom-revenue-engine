import { z } from "zod";

import {
  RevenueContactDiscoveryCandidateSchema,
  contactDiscoveryCanonicalJson,
  contactDiscoveryDigest,
  type RevenueContactDiscoveryCandidate,
} from "@/lib/revenue-engine/contact-discovery";
import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";

export const REVENUE_CONTACT_VERIFICATION_VERSION = "revenue-contact-verification-v1";
export const REVENUE_CONTACT_VERIFICATION_MAX_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1_000;

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const VerificationAuthoritySchema = z.object({
  runtimeConnected: z.literal(false),
  verificationPersistenceAuthorized: z.literal(false),
  qualificationPersistenceAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export const RevenueContactVerificationRequestSchema = z.object({
  verificationVersion: z.literal(REVENUE_CONTACT_VERIFICATION_VERSION),
  requestId: z.string().regex(/^contact-verification-request:[a-f0-9]{64}$/),
  idempotencyKey: z.string().trim().min(8).max(200),
  businessId: z.string().trim().min(1).max(128),
  candidate: RevenueContactDiscoveryCandidateSchema,
  requestedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  verifierKind: z.literal("FIXTURE"),
  limits: z.object({
    maxProviderOperations: z.literal(0),
    maxCostUsd: z.literal(0),
  }).strict(),
  authority: VerificationAuthoritySchema,
}).strict().superRefine((request, context) => {
  if (request.businessId !== request.candidate.businessId) {
    context.addIssue({ code: "custom", message: "Verification business and candidate identities must match.", path: ["businessId"] });
  }
});

export type RevenueContactVerificationRequest = z.infer<typeof RevenueContactVerificationRequestSchema>;

const VerificationEvidenceSchema = z.object({
  provider: z.literal("FIXTURE"),
  method: z.literal("FIXTURE_RECEIPT"),
  evidenceReceiptId: z.string().regex(/^fixture-verification:[a-zA-Z0-9._:-]{1,160}$/),
  sourceUrl: z.string().url().max(2_048),
  verifiedAt: TimestampSchema,
  staleAfter: TimestampSchema,
  confidence: z.number().int().min(80).max(100),
}).strict().superRefine((evidence, context) => {
  try {
    if (normalizePublicWebsiteUrl(evidence.sourceUrl) !== evidence.sourceUrl) {
      context.addIssue({ code: "custom", message: "Verification evidence must use a canonical public source URL.", path: ["sourceUrl"] });
    }
  } catch {
    context.addIssue({ code: "custom", message: "Verification evidence must use a canonical public source URL.", path: ["sourceUrl"] });
  }
  const verifiedAtMs = Date.parse(evidence.verifiedAt);
  const staleAfterMs = Date.parse(evidence.staleAfter);
  if (staleAfterMs <= verifiedAtMs || staleAfterMs - verifiedAtMs > REVENUE_CONTACT_VERIFICATION_MAX_FRESHNESS_MS) {
    context.addIssue({ code: "custom", message: "Verification freshness must be positive and no longer than 30 days.", path: ["staleAfter"] });
  }
});

const EmailVerificationObservationSchema = VerificationEvidenceSchema.extend({
  channel: z.literal("EMAIL"),
  status: z.enum(["DELIVERABLE", "UNDELIVERABLE", "CATCH_ALL", "UNKNOWN"]),
  catchAll: z.boolean(),
}).strict().superRefine((observation, context) => {
  if (observation.catchAll !== (observation.status === "CATCH_ALL")) {
    context.addIssue({ code: "custom", message: "Catch-all state must agree with the email verification status.", path: ["catchAll"] });
  }
});

const PhoneVerificationObservationSchema = VerificationEvidenceSchema.extend({
  channel: z.literal("PHONE"),
  status: z.enum(["PUBLISHED", "UNAVAILABLE", "UNKNOWN"]),
}).strict();

const FormVerificationObservationSchema = VerificationEvidenceSchema.extend({
  channel: z.literal("FORM"),
  status: z.enum(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]),
}).strict();

const SocialVerificationObservationSchema = VerificationEvidenceSchema.extend({
  channel: z.literal("SOCIAL"),
  status: z.enum(["ACTIVE", "INACTIVE", "UNKNOWN"]),
}).strict();

export const RevenueContactVerificationObservationSchema = z.discriminatedUnion("channel", [
  EmailVerificationObservationSchema,
  PhoneVerificationObservationSchema,
  FormVerificationObservationSchema,
  SocialVerificationObservationSchema,
]);

export type RevenueContactVerificationObservation = z.infer<typeof RevenueContactVerificationObservationSchema>;

const OwnerProjectionSchema = z.object({
  status: z.enum(["CANDIDATE", "USABLE", "VERIFIED", "INVALID"]),
  emailVerification: z.object({
    status: z.enum(["DELIVERABLE", "UNKNOWN", "UNDELIVERABLE", "CATCH_ALL"]),
    verifiedAt: TimestampSchema,
    staleAfter: TimestampSchema,
  }).strict().nullable(),
  automationPermitted: z.literal(false),
}).strict();

export const RevenueContactVerificationResultSchema = z.object({
  verificationVersion: z.literal(REVENUE_CONTACT_VERIFICATION_VERSION),
  verificationResultId: z.string().regex(/^contact-verification-result:[a-f0-9]{64}$/),
  verificationResultDigest: Sha256Schema,
  requestId: z.string().regex(/^contact-verification-request:[a-f0-9]{64}$/),
  requestDigest: Sha256Schema,
  businessId: z.string().trim().min(1).max(128),
  candidateId: z.string().regex(/^contact-candidate:[a-f0-9]{64}$/),
  candidateDigest: Sha256Schema,
  channel: z.enum(["EMAIL", "PHONE", "FORM", "SOCIAL"]),
  value: z.string().trim().min(1).max(2_048),
  recipientKind: z.enum(["NAMED_PERSON", "ROLE", "BUSINESS", "UNKNOWN"]),
  completedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  verifierKind: z.literal("FIXTURE"),
  observation: RevenueContactVerificationObservationSchema,
  ownerProjection: OwnerProjectionSchema,
  usableRoute: z.boolean(),
  recommendedAction: z.enum(["REVIEW_EMAIL", "MANUAL_PHONE", "MANUAL_FORM", "MANUAL_SOCIAL", "RESEARCH"]),
  consentBasis: z.literal("UNASSESSED"),
  complianceReviewRequired: z.boolean(),
  autonomousEmailEligible: z.literal(false),
  authority: VerificationAuthoritySchema,
}).strict().superRefine((result, context) => {
  if (result.channel !== result.observation.channel) {
    context.addIssue({ code: "custom", message: "Verification result and observation channels must match.", path: ["channel"] });
  }
  const expectedProjection = deriveProjection({ recipientKind: result.recipientKind }, result.observation);
  if (contactDiscoveryCanonicalJson(expectedProjection) !== contactDiscoveryCanonicalJson({
    ownerProjection: result.ownerProjection,
    usableRoute: result.usableRoute,
    recommendedAction: result.recommendedAction,
    complianceReviewRequired: result.complianceReviewRequired,
  })) {
    context.addIssue({ code: "custom", message: "Verification route semantics must be derived from the exact channel outcome.", path: ["ownerProjection"] });
  }
  const { verificationResultDigest: _digest, verificationResultId: _id, ...core } = result;
  void _digest;
  void _id;
  const expectedDigest = contactDiscoveryDigest(core);
  if (result.verificationResultDigest !== expectedDigest || result.verificationResultId !== `contact-verification-result:${expectedDigest}`) {
    context.addIssue({ code: "custom", message: "Verification result identity and digest must bind its exact content.", path: ["verificationResultDigest"] });
  }
});

export type RevenueContactVerificationResult = z.infer<typeof RevenueContactVerificationResultSchema>;

function deriveProjection(
  candidate: Pick<RevenueContactDiscoveryCandidate, "recipientKind">,
  observation: RevenueContactVerificationObservation,
): Pick<RevenueContactVerificationResult, "ownerProjection" | "usableRoute" | "recommendedAction" | "complianceReviewRequired"> {
  if (observation.channel === "EMAIL") {
    const supportedRecipient = candidate.recipientKind === "NAMED_PERSON" || candidate.recipientKind === "ROLE";
    const usable = observation.status === "DELIVERABLE" && supportedRecipient;
    const status = usable
      ? "VERIFIED" as const
      : observation.status === "UNDELIVERABLE"
        ? "INVALID" as const
        : "CANDIDATE" as const;
    return {
      ownerProjection: {
        status,
        emailVerification: {
          status: observation.status,
          verifiedAt: observation.verifiedAt,
          staleAfter: observation.staleAfter,
        },
        automationPermitted: false,
      },
      usableRoute: usable,
      recommendedAction: usable ? "REVIEW_EMAIL" : "RESEARCH",
      complianceReviewRequired: true,
    };
  }
  const positive = observation.channel === "PHONE"
    ? observation.status === "PUBLISHED"
    : observation.channel === "FORM"
      ? observation.status === "AVAILABLE"
      : observation.status === "ACTIVE";
  const invalid = observation.channel === "PHONE"
    ? observation.status === "UNAVAILABLE"
    : observation.channel === "FORM"
      ? observation.status === "UNAVAILABLE"
      : observation.status === "INACTIVE";
  return {
    ownerProjection: {
      status: positive ? "USABLE" : invalid ? "INVALID" : "CANDIDATE",
      emailVerification: null,
      automationPermitted: false,
    },
    usableRoute: positive,
    recommendedAction: positive
      ? observation.channel === "PHONE"
        ? "MANUAL_PHONE"
        : observation.channel === "FORM"
          ? "MANUAL_FORM"
          : "MANUAL_SOCIAL"
      : "RESEARCH",
    complianceReviewRequired: false,
  };
}

export function buildFixtureContactVerificationResult(input: {
  request: RevenueContactVerificationRequest;
  observation: RevenueContactVerificationObservation;
  completedAt: string;
}): RevenueContactVerificationResult {
  const request = RevenueContactVerificationRequestSchema.parse(input.request);
  const observation = RevenueContactVerificationObservationSchema.parse(input.observation);
  const completedAt = TimestampSchema.parse(input.completedAt);
  if (request.candidate.channel !== observation.channel) {
    throw new Error("Verification observation channel must match the exact contact candidate.");
  }
  if (Date.parse(observation.verifiedAt) < Date.parse(request.requestedAt)) {
    throw new Error("Contact verification evidence cannot predate the request.");
  }
  if (Date.parse(completedAt) < Date.parse(observation.verifiedAt)) {
    throw new Error("Contact verification cannot complete before its evidence was captured.");
  }
  const projection = deriveProjection(request.candidate, observation);
  const core = {
    verificationVersion: REVENUE_CONTACT_VERIFICATION_VERSION,
    requestId: request.requestId,
    requestDigest: contactDiscoveryDigest(request),
    businessId: request.businessId,
    candidateId: request.candidate.candidateId,
    candidateDigest: request.candidate.candidateDigest,
    channel: request.candidate.channel,
    value: request.candidate.value,
    recipientKind: request.candidate.recipientKind,
    completedAt,
    mode: "SHADOW" as const,
    verifierKind: "FIXTURE" as const,
    observation,
    ...projection,
    consentBasis: "UNASSESSED" as const,
    autonomousEmailEligible: false as const,
    authority: request.authority,
  };
  const verificationResultDigest = contactDiscoveryDigest(core);
  return RevenueContactVerificationResultSchema.parse({
    ...core,
    verificationResultId: `contact-verification-result:${verificationResultDigest}`,
    verificationResultDigest,
  });
}

export function contactVerificationResultMatchesCandidate(
  result: RevenueContactVerificationResult,
  candidate: RevenueContactDiscoveryCandidate,
) {
  const parsedResult = RevenueContactVerificationResultSchema.safeParse(result);
  const parsedCandidate = RevenueContactDiscoveryCandidateSchema.safeParse(candidate);
  if (!parsedResult.success || !parsedCandidate.success) return false;
  return parsedResult.data.businessId === parsedCandidate.data.businessId
    && parsedResult.data.candidateId === parsedCandidate.data.candidateId
    && parsedResult.data.candidateDigest === parsedCandidate.data.candidateDigest
    && parsedResult.data.channel === parsedCandidate.data.channel
    && parsedResult.data.value === parsedCandidate.data.value
    && parsedResult.data.recipientKind === parsedCandidate.data.recipientKind
    && contactDiscoveryCanonicalJson(parsedCandidate.data) === contactDiscoveryCanonicalJson(candidate);
}

export function contactVerificationResultMatchesRequest(
  result: RevenueContactVerificationResult,
  request: RevenueContactVerificationRequest,
) {
  const parsedResult = RevenueContactVerificationResultSchema.safeParse(result);
  const parsedRequest = RevenueContactVerificationRequestSchema.safeParse(request);
  if (!parsedResult.success || !parsedRequest.success) return false;
  return parsedResult.data.requestId === parsedRequest.data.requestId
    && parsedResult.data.requestDigest === contactDiscoveryDigest(parsedRequest.data)
    && parsedResult.data.businessId === parsedRequest.data.businessId
    && parsedResult.data.candidateId === parsedRequest.data.candidate.candidateId
    && parsedResult.data.candidateDigest === parsedRequest.data.candidate.candidateDigest
    && Date.parse(parsedResult.data.completedAt) >= Date.parse(parsedRequest.data.requestedAt)
    && contactDiscoveryCanonicalJson(parsedResult.data.authority) === contactDiscoveryCanonicalJson(parsedRequest.data.authority);
}
