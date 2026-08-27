import { createHash } from "node:crypto";

import { z } from "zod";

import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";

export const REVENUE_CONTACT_DISCOVERY_VERSION = "revenue-contact-discovery-v1";
export const REVENUE_CONTACT_EVIDENCE_VERSION = "revenue-contact-evidence-v1";
export const REVENUE_CONTACT_DISCOVERY_MAX_EVIDENCE_AGE_MS = 90 * 24 * 60 * 60 * 1_000;

const TimestampSchema = z.string().datetime({ offset: true });
const BusinessIdSchema = z.string().trim().min(1).max(128);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const NullableLabelSchema = z.string().trim().min(1).max(160).nullable();
const ContactChannelSchema = z.enum(["EMAIL", "PHONE", "FORM", "SOCIAL"]);
const RecipientKindSchema = z.enum(["NAMED_PERSON", "ROLE", "BUSINESS", "UNKNOWN"]);
const SocialPlatformSchema = z.enum(["FACEBOOK", "INSTAGRAM", "LINKEDIN", "X"]);

const DiscoveryAuthoritySchema = z.object({
  runtimeConnected: z.literal(false),
  contactPersistenceAuthorized: z.literal(false),
  verificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

export const RevenueContactDiscoveryRequestSchema = z.object({
  discoveryVersion: z.literal(REVENUE_CONTACT_DISCOVERY_VERSION),
  requestId: z.string().regex(/^contact-discovery-request:[a-f0-9]{64}$/),
  idempotencyKey: z.string().trim().min(8).max(200),
  businessId: BusinessIdSchema,
  websiteUrl: z.string().url().max(2_048).nullable(),
  sourceEvidenceUrl: z.string().url().max(2_048),
  requestedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  adapterKind: z.literal("FIXTURE"),
  limits: z.object({
    maxCandidates: z.number().int().min(1).max(25),
    maxProviderOperations: z.literal(0),
    maxCostUsd: z.literal(0),
  }).strict(),
  authority: DiscoveryAuthoritySchema,
}).strict().superRefine((request, context) => {
  for (const field of ["websiteUrl", "sourceEvidenceUrl"] as const) {
    const value = request[field];
    if (value === null) continue;
    try {
      if (normalizePublicWebsiteUrl(value) !== value) {
        context.addIssue({ code: "custom", message: `${field} must be a canonical public HTTP(S) URL.`, path: [field] });
      }
    } catch {
      context.addIssue({ code: "custom", message: `${field} must be a canonical public HTTP(S) URL.`, path: [field] });
    }
  }
});

export type RevenueContactDiscoveryRequest = z.infer<typeof RevenueContactDiscoveryRequestSchema>;

const ContactPublicationContextSchema = z.object({
  publiclyPublished: z.boolean(),
  contraryContactStatement: z.enum(["PRESENT", "NOT_OBSERVED", "UNKNOWN"]),
  roleRelevance: z.enum(["RELEVANT", "NOT_RELEVANT", "UNKNOWN"]),
  consentBasis: z.literal("UNASSESSED"),
}).strict();

const ContactEvidenceMethodSchema = z.enum([
  "HTML_MAILTO",
  "HTML_TEL",
  "HTML_TEXT",
  "HTML_FORM",
  "HTML_SOCIAL_LINK",
  "SOURCE_RECORD",
  "OWNER_REVIEW",
]);

const CONTACT_METHODS_BY_CHANNEL: Record<z.infer<typeof ContactChannelSchema>, ReadonlySet<z.infer<typeof ContactEvidenceMethodSchema>>> = {
  EMAIL: new Set(["HTML_MAILTO", "HTML_TEXT", "SOURCE_RECORD", "OWNER_REVIEW"]),
  PHONE: new Set(["HTML_TEL", "HTML_TEXT", "SOURCE_RECORD", "OWNER_REVIEW"]),
  FORM: new Set(["HTML_FORM", "SOURCE_RECORD", "OWNER_REVIEW"]),
  SOCIAL: new Set(["HTML_SOCIAL_LINK", "SOURCE_RECORD", "OWNER_REVIEW"]),
};

export const RevenueContactObservationSchema = z.object({
  channel: ContactChannelSchema,
  value: z.string().trim().min(1).max(2_048),
  label: NullableLabelSchema,
  personName: NullableLabelSchema,
  role: NullableLabelSchema,
  recipientKind: RecipientKindSchema,
  socialPlatform: SocialPlatformSchema.nullable(),
  evidence: z.object({
    evidenceVersion: z.literal(REVENUE_CONTACT_EVIDENCE_VERSION),
    sourceUrl: z.string().url().max(2_048),
    capturedAt: TimestampSchema,
    method: ContactEvidenceMethodSchema,
    observation: z.string().trim().min(1).max(500),
    confidence: z.number().int().min(0).max(100),
    publication: ContactPublicationContextSchema,
  }).strict(),
}).strict().superRefine((observation, context) => {
  if (!CONTACT_METHODS_BY_CHANNEL[observation.channel].has(observation.evidence.method)) {
    context.addIssue({ code: "custom", message: "The evidence method does not match the contact channel.", path: ["evidence", "method"] });
  }
  if (observation.channel === "SOCIAL" && observation.socialPlatform === null) {
    context.addIssue({ code: "custom", message: "Social contacts require a platform.", path: ["socialPlatform"] });
  }
  if (observation.channel !== "SOCIAL" && observation.socialPlatform !== null) {
    context.addIssue({ code: "custom", message: "Only social contacts may declare a platform.", path: ["socialPlatform"] });
  }
  if (observation.recipientKind === "NAMED_PERSON" && observation.personName === null) {
    context.addIssue({ code: "custom", message: "Named-person contacts require a person name.", path: ["personName"] });
  }
  if (observation.recipientKind === "ROLE" && observation.role === null) {
    context.addIssue({ code: "custom", message: "Role contacts require a role.", path: ["role"] });
  }
  try {
    if (normalizePublicWebsiteUrl(observation.evidence.sourceUrl) !== observation.evidence.sourceUrl) {
      context.addIssue({ code: "custom", message: "Contact evidence must use a canonical public source URL.", path: ["evidence", "sourceUrl"] });
    }
  } catch {
    context.addIssue({ code: "custom", message: "Contact evidence must use a canonical public source URL.", path: ["evidence", "sourceUrl"] });
  }
});

export type RevenueContactObservation = z.infer<typeof RevenueContactObservationSchema>;

export const RevenueContactEvidenceClaimSchema = z.object({
  evidenceVersion: z.literal(REVENUE_CONTACT_EVIDENCE_VERSION),
  evidenceId: z.string().regex(/^contact-evidence:[a-f0-9]{64}$/),
  sourceUrl: z.string().url().max(2_048),
  capturedAt: TimestampSchema,
  method: ContactEvidenceMethodSchema,
  observation: z.string().trim().min(1).max(500),
  confidence: z.number().int().min(0).max(100),
  publication: ContactPublicationContextSchema,
}).strict().superRefine((claim, context) => {
  const { evidenceId: _evidenceId, ...core } = claim;
  void _evidenceId;
  if (claim.evidenceId !== `contact-evidence:${contactDiscoveryDigest(core)}`) {
    context.addIssue({ code: "custom", message: "Contact evidence identity must bind its exact provenance and observation.", path: ["evidenceId"] });
  }
  try {
    if (normalizePublicWebsiteUrl(claim.sourceUrl) !== claim.sourceUrl) {
      context.addIssue({ code: "custom", message: "Contact evidence must use a canonical public source URL.", path: ["sourceUrl"] });
    }
  } catch {
    context.addIssue({ code: "custom", message: "Contact evidence must use a canonical public source URL.", path: ["sourceUrl"] });
  }
});

export const RevenueContactDiscoveryCandidateSchema = z.object({
  candidateId: z.string().regex(/^contact-candidate:[a-f0-9]{64}$/),
  candidateDigest: Sha256Schema,
  businessId: BusinessIdSchema,
  channel: ContactChannelSchema,
  value: z.string().trim().min(1).max(2_048),
  label: NullableLabelSchema,
  personName: NullableLabelSchema,
  role: NullableLabelSchema,
  recipientKind: RecipientKindSchema,
  socialPlatform: SocialPlatformSchema.nullable(),
  evidenceClaims: z.array(RevenueContactEvidenceClaimSchema).min(1).max(20),
  verificationStatus: z.literal("NOT_VERIFIED"),
  consentBasis: z.literal("UNASSESSED"),
  automationPermitted: z.literal(false),
}).strict().superRefine((candidate, context) => {
  let normalized: string;
  try {
    normalized = normalizeRevenueContactValue(candidate.channel, candidate.value, candidate.socialPlatform);
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "The contact value is invalid.", path: ["value"] });
    return;
  }
  if (normalized !== candidate.value) {
    context.addIssue({ code: "custom", message: "The contact value must be canonical.", path: ["value"] });
  }
  const expectedId = contactCandidateId(candidate.businessId, candidate.channel, candidate.value);
  if (candidate.candidateId !== expectedId) {
    context.addIssue({ code: "custom", message: "Contact candidate identity must bind the business, channel, and value.", path: ["candidateId"] });
  }
  const { candidateDigest: _candidateDigest, ...core } = candidate;
  void _candidateDigest;
  if (candidate.candidateDigest !== contactDiscoveryDigest(core)) {
    context.addIssue({ code: "custom", message: "Contact candidate digest must bind the exact candidate and evidence set.", path: ["candidateDigest"] });
  }
  if (new Set(candidate.evidenceClaims.map((claim) => claim.evidenceId)).size !== candidate.evidenceClaims.length) {
    context.addIssue({ code: "custom", message: "Contact evidence identities must be unique.", path: ["evidenceClaims"] });
  }
  if (candidate.evidenceClaims.some((claim, index, claims) => index > 0 && claims[index - 1]!.evidenceId.localeCompare(claim.evidenceId, "en-CA") >= 0)) {
    context.addIssue({ code: "custom", message: "Contact evidence must use deterministic identity order.", path: ["evidenceClaims"] });
  }
  addRecipientIssues(candidate, context);
});

export type RevenueContactDiscoveryCandidate = z.infer<typeof RevenueContactDiscoveryCandidateSchema>;

export const RevenueContactDiscoveryResultSchema = z.object({
  discoveryVersion: z.literal(REVENUE_CONTACT_DISCOVERY_VERSION),
  discoveryResultId: z.string().regex(/^contact-discovery-result:[a-f0-9]{64}$/),
  discoveryResultDigest: Sha256Schema,
  requestId: z.string().regex(/^contact-discovery-request:[a-f0-9]{64}$/),
  requestDigest: Sha256Schema,
  businessId: BusinessIdSchema,
  completedAt: TimestampSchema,
  mode: z.literal("SHADOW"),
  adapterKind: z.literal("FIXTURE"),
  candidates: z.array(RevenueContactDiscoveryCandidateSchema).max(25),
  channelsWithCandidates: z.array(ContactChannelSchema).max(4),
  researchRequired: z.boolean(),
  authority: DiscoveryAuthoritySchema,
}).strict().superRefine((result, context) => {
  const { discoveryResultDigest: _digest, discoveryResultId: _id, ...core } = result;
  void _digest;
  void _id;
  const expectedDigest = contactDiscoveryDigest(core);
  if (result.discoveryResultDigest !== expectedDigest || result.discoveryResultId !== `contact-discovery-result:${expectedDigest}`) {
    context.addIssue({ code: "custom", message: "Discovery result identity and digest must bind its exact content.", path: ["discoveryResultDigest"] });
  }
  if (result.candidates.some((candidate) => candidate.businessId !== result.businessId)) {
    context.addIssue({ code: "custom", message: "Every contact candidate must belong to the requested business.", path: ["candidates"] });
  }
  if (new Set(result.candidates.map((candidate) => candidate.candidateId)).size !== result.candidates.length) {
    context.addIssue({ code: "custom", message: "Contact candidate identities must be unique.", path: ["candidates"] });
  }
  const expectedChannels = [...new Set(result.candidates.map((candidate) => candidate.channel))]
    .sort((left, right) => CONTACT_CHANNEL_ORDER[left] - CONTACT_CHANNEL_ORDER[right]);
  if (contactDiscoveryCanonicalJson(expectedChannels) !== contactDiscoveryCanonicalJson(result.channelsWithCandidates)) {
    context.addIssue({ code: "custom", message: "Channel summary must match the candidate set.", path: ["channelsWithCandidates"] });
  }
  if (result.researchRequired !== (result.candidates.length === 0)) {
    context.addIssue({ code: "custom", message: "Research is required exactly when discovery found no evidence-backed candidates.", path: ["researchRequired"] });
  }
});

export type RevenueContactDiscoveryResult = z.infer<typeof RevenueContactDiscoveryResultSchema>;

const CONTACT_CHANNEL_ORDER: Record<z.infer<typeof ContactChannelSchema>, number> = {
  EMAIL: 0,
  PHONE: 1,
  FORM: 2,
  SOCIAL: 3,
};

const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "admin", "billing", "booking", "contact", "estimates", "hello", "info", "office",
  "projects", "quotes", "sales", "service", "support",
]);

const SOCIAL_HOSTS: Record<z.infer<typeof SocialPlatformSchema>, ReadonlySet<string>> = {
  FACEBOOK: new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]),
  INSTAGRAM: new Set(["instagram.com", "www.instagram.com"]),
  LINKEDIN: new Set(["linkedin.com", "www.linkedin.com", "ca.linkedin.com"]),
  X: new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]),
};

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function contactDiscoveryCanonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function contactDiscoveryDigest(value: unknown) {
  return createHash("sha256").update(contactDiscoveryCanonicalJson(value)).digest("hex");
}

function normalizeEmail(value: string) {
  const normalized = value.trim().toLocaleLowerCase("en-CA");
  if (normalized.length > 254 || /\s/.test(normalized)) throw new Error("Email contacts must contain one valid address.");
  const parts = normalized.split("@");
  if (parts.length !== 2) throw new Error("Email contacts must contain one valid address.");
  const [local, domain] = parts as [string, string];
  if (
    !local
    || local.length > 64
    || local.startsWith(".")
    || local.endsWith(".")
    || local.includes("..")
    || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)
    || domain === "example.com"
    || domain.endsWith(".example")
    || domain.endsWith(".invalid")
    || domain.endsWith(".test")
    || domain.endsWith(".localhost")
  ) {
    throw new Error("Email contacts must contain one valid public address.");
  }
  return normalized;
}

function normalizeCanadianPhone(value: string) {
  if (!/^[+\d\s().-]+$/.test(value)) {
    throw new Error("Phone contacts must be a Canadian E.164 number.");
  }
  const digits = value.replace(/[^\d+]/g, "");
  if ((digits.match(/\+/g) ?? []).length > 1 || (digits.includes("+") && !digits.startsWith("+"))) {
    throw new Error("Phone contacts must be a Canadian E.164 number.");
  }
  const numeric = digits.replace(/^\+/, "");
  const national = numeric.length === 11 && numeric.startsWith("1") ? numeric.slice(1) : numeric;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) {
    throw new Error("Phone contacts must be a Canadian E.164 number.");
  }
  return `+1${national}`;
}

export function normalizeRevenueContactValue(
  channel: z.infer<typeof ContactChannelSchema>,
  value: string,
  socialPlatform: z.infer<typeof SocialPlatformSchema> | null,
) {
  if (channel === "EMAIL") return normalizeEmail(value);
  if (channel === "PHONE") return normalizeCanadianPhone(value);
  const normalized = normalizePublicWebsiteUrl(value);
  if (channel === "SOCIAL") {
    if (socialPlatform === null || !SOCIAL_HOSTS[socialPlatform].has(new URL(normalized).hostname)) {
      throw new Error("Social contact URL does not match its declared platform.");
    }
  }
  return normalized;
}

function addRecipientIssues(
  candidate: Pick<RevenueContactDiscoveryCandidate, "channel" | "value" | "personName" | "role" | "recipientKind" | "socialPlatform">,
  context: z.RefinementCtx,
) {
  if (candidate.channel === "SOCIAL" && candidate.socialPlatform === null) {
    context.addIssue({ code: "custom", message: "Social contacts require a platform.", path: ["socialPlatform"] });
  }
  if (candidate.channel !== "SOCIAL" && candidate.socialPlatform !== null) {
    context.addIssue({ code: "custom", message: "Only social contacts may declare a platform.", path: ["socialPlatform"] });
  }
  if (candidate.recipientKind === "NAMED_PERSON" && candidate.personName === null) {
    context.addIssue({ code: "custom", message: "Named-person contacts require a person name.", path: ["personName"] });
  }
  if (candidate.recipientKind === "ROLE" && candidate.role === null) {
    context.addIssue({ code: "custom", message: "Role contacts require a role.", path: ["role"] });
  }
  if (
    candidate.channel === "EMAIL"
    && candidate.recipientKind === "NAMED_PERSON"
    && GENERIC_EMAIL_LOCAL_PARTS.has(candidate.value.split("@")[0] ?? "")
  ) {
    context.addIssue({ code: "custom", message: "A generic email local part cannot be represented as a named person.", path: ["recipientKind"] });
  }
}

function contactCandidateId(businessId: string, channel: z.infer<typeof ContactChannelSchema>, value: string) {
  return `contact-candidate:${contactDiscoveryDigest({ businessId, channel, value })}`;
}

function buildEvidenceClaim(evidence: RevenueContactObservation["evidence"]): z.infer<typeof RevenueContactEvidenceClaimSchema> {
  const core = { ...evidence };
  return RevenueContactEvidenceClaimSchema.parse({
    ...core,
    evidenceId: `contact-evidence:${contactDiscoveryDigest(core)}`,
  });
}

function buildCandidate(
  businessId: string,
  value: string,
  observations: RevenueContactObservation[],
): RevenueContactDiscoveryCandidate {
  const first = observations[0]!;
  const identity = {
    personName: first.personName,
    role: first.role,
    recipientKind: first.recipientKind,
    socialPlatform: first.socialPlatform,
  };
  for (const observation of observations.slice(1)) {
    if (contactDiscoveryCanonicalJson(identity) !== contactDiscoveryCanonicalJson({
      personName: observation.personName,
      role: observation.role,
      recipientKind: observation.recipientKind,
      socialPlatform: observation.socialPlatform,
    })) {
      throw new Error("Evidence for one contact value cannot disagree about recipient identity or platform.");
    }
  }
  const evidenceClaims = observations
    .map((observation) => buildEvidenceClaim(observation.evidence))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId, "en-CA"));
  if (new Set(evidenceClaims.map((claim) => claim.evidenceId)).size !== evidenceClaims.length) {
    throw new Error("Duplicate contact evidence is not allowed.");
  }
  const labels = observations.flatMap((observation) => observation.label ? [observation.label] : []).sort((left, right) => left.localeCompare(right, "en-CA"));
  const core = {
    candidateId: contactCandidateId(businessId, first.channel, value),
    businessId,
    channel: first.channel,
    value,
    label: labels[0] ?? null,
    ...identity,
    evidenceClaims,
    verificationStatus: "NOT_VERIFIED" as const,
    consentBasis: "UNASSESSED" as const,
    automationPermitted: false as const,
  };
  return RevenueContactDiscoveryCandidateSchema.parse({ ...core, candidateDigest: contactDiscoveryDigest(core) });
}

export function buildFixtureContactDiscoveryResult(input: {
  request: RevenueContactDiscoveryRequest;
  observations: RevenueContactObservation[];
  completedAt: string;
}): RevenueContactDiscoveryResult {
  const request = RevenueContactDiscoveryRequestSchema.parse(input.request);
  const completedAt = TimestampSchema.parse(input.completedAt);
  if (Date.parse(completedAt) < Date.parse(request.requestedAt)) {
    throw new Error("Contact discovery cannot complete before it was requested.");
  }
  const observations = z.array(RevenueContactObservationSchema).max(request.limits.maxCandidates * 20).parse(input.observations);
  const grouped = new Map<string, { value: string; observations: RevenueContactObservation[] }>();
  for (const observation of observations) {
    const capturedAtMs = Date.parse(observation.evidence.capturedAt);
    if (capturedAtMs > Date.parse(completedAt) || Date.parse(completedAt) - capturedAtMs > REVENUE_CONTACT_DISCOVERY_MAX_EVIDENCE_AGE_MS) {
      throw new Error("Contact evidence must be current and not future-dated.");
    }
    const value = normalizeRevenueContactValue(observation.channel, observation.value, observation.socialPlatform);
    const key = `${observation.channel}:${value}`;
    const group = grouped.get(key) ?? { value, observations: [] };
    group.observations.push(observation);
    grouped.set(key, group);
  }
  if (grouped.size > request.limits.maxCandidates) {
    throw new Error("Contact discovery exceeded its candidate limit.");
  }
  const candidates = [...grouped.values()]
    .map((group) => buildCandidate(request.businessId, group.value, group.observations))
    .sort((left, right) => CONTACT_CHANNEL_ORDER[left.channel] - CONTACT_CHANNEL_ORDER[right.channel]
      || left.value.localeCompare(right.value, "en-CA"));
  const channelsWithCandidates = [...new Set(candidates.map((candidate) => candidate.channel))]
    .sort((left, right) => CONTACT_CHANNEL_ORDER[left] - CONTACT_CHANNEL_ORDER[right]);
  const core = {
    discoveryVersion: REVENUE_CONTACT_DISCOVERY_VERSION,
    requestId: request.requestId,
    requestDigest: contactDiscoveryDigest(request),
    businessId: request.businessId,
    completedAt,
    mode: "SHADOW" as const,
    adapterKind: "FIXTURE" as const,
    candidates,
    channelsWithCandidates,
    researchRequired: candidates.length === 0,
    authority: request.authority,
  };
  const discoveryResultDigest = contactDiscoveryDigest(core);
  return RevenueContactDiscoveryResultSchema.parse({
    ...core,
    discoveryResultId: `contact-discovery-result:${discoveryResultDigest}`,
    discoveryResultDigest,
  });
}

export function contactDiscoveryResultMatchesRequest(
  result: RevenueContactDiscoveryResult,
  request: RevenueContactDiscoveryRequest,
) {
  const parsedResult = RevenueContactDiscoveryResultSchema.safeParse(result);
  const parsedRequest = RevenueContactDiscoveryRequestSchema.safeParse(request);
  if (!parsedResult.success || !parsedRequest.success) return false;
  return parsedResult.data.requestId === parsedRequest.data.requestId
    && parsedResult.data.requestDigest === contactDiscoveryDigest(parsedRequest.data)
    && parsedResult.data.businessId === parsedRequest.data.businessId
    && parsedResult.data.mode === parsedRequest.data.mode
    && parsedResult.data.adapterKind === parsedRequest.data.adapterKind
    && parsedResult.data.candidates.length <= parsedRequest.data.limits.maxCandidates
    && Date.parse(parsedResult.data.completedAt) >= Date.parse(parsedRequest.data.requestedAt)
    && contactDiscoveryCanonicalJson(parsedResult.data.authority) === contactDiscoveryCanonicalJson(parsedRequest.data.authority);
}
