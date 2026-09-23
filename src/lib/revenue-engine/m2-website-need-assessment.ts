import { z } from "zod";

import { privateKwM2ReceiptCanonicalDigest } from "./private-kw-m2-canonical";
import type { M2ManualWebsiteObservationTarget } from "./m2-manual-website-observation";

/**
 * A delegated, evidence-backed website-need assessment for one saved M2 identity.
 *
 * The reviewer views ordinary public pages at desktop and phone widths and records
 * findings in their own words. The stated website need must equal the need derived
 * deterministically from those findings, so a reviewer cannot claim a rebuild the
 * findings do not support. Website need is not qualification: contact, consent,
 * outreach and spend authority stay off, and the owners can still correct it.
 */
export const M2_WEBSITE_NEED_ASSESSMENT_VERSION = "kw-m2-website-need-assessment-v1" as const;
export const M2_WEBSITE_NEED_AUDIT_VERSION = "kw-m2-browser-view-audit-v1" as const;
export const M2_WEBSITE_NEED_SOURCE_DECISION = "adr-0059-delegated-browser-view-derived-facts-v1" as const;

const ReviewIdSchema = z.string().regex(/^M2-(0[1-9]|10)$/);
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const HttpUrlSchema = z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol));

export const WebsiteNeedSchema = z.enum(["REBUILD", "MINOR_IMPROVEMENT", "NO_OPPORTUNITY", "INCOMPLETE"]);
export type WebsiteNeed = z.infer<typeof WebsiteNeedSchema>;
const ViewportSchema = z.enum(["DESKTOP", "PHONE"]);
const ConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

const FindingSchema = z.object({
  findingId: z.string().regex(/^F([1-9]|1[0-9]|20)$/),
  pageUrl: HttpUrlSchema,
  viewport: ViewportSchema,
  category: z.enum(["PHONE_USABILITY", "CONVERSION_PATH", "TRUST_AND_CURRENCY", "SERVICE_CONTENT", "TECHNICAL", "VISUAL_DESIGN"]),
  kind: z.enum(["ISSUE", "STRENGTH"]),
  severity: z.enum(["CRITICAL", "MAJOR", "MINOR"]).nullable(),
  conversionCritical: z.boolean(),
  confidence: ConfidenceSchema,
  finding: z.string().trim().min(20).max(280),
}).strict().superRefine((finding, ctx) => {
  if (finding.kind === "ISSUE" && finding.severity === null) ctx.addIssue({ code: "custom", path: ["severity"], message: "An issue needs a severity." });
  if (finding.kind === "STRENGTH" && (finding.severity !== null || finding.conversionCritical)) {
    ctx.addIssue({ code: "custom", path: ["severity"], message: "A strength has no severity and cannot be conversion-critical." });
  }
});
export type M2WebsiteNeedFinding = z.infer<typeof FindingSchema>;

export const M2WebsiteNeedCommandSchema = z.object({
  commandId: z.string().uuid(),
  reviewId: ReviewIdSchema,
  pagesViewed: z.array(z.object({
    url: HttpUrlSchema,
    viewedAt: TimestampSchema,
    viewports: z.array(ViewportSchema).min(1).max(2),
  }).strict()).min(1).max(4),
  findings: z.array(FindingSchema).min(1).max(20),
  websiteNeed: WebsiteNeedSchema,
  evidenceConfidence: ConfidenceSchema,
  businessFitNote: z.string().trim().min(20).max(400),
  rationale: z.string().trim().min(20).max(600),
  noCopiedOrPersonalData: z.literal(true),
}).strict();
export type M2WebsiteNeedCommand = z.infer<typeof M2WebsiteNeedCommandSchema>;

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
export const M2_WEBSITE_NEED_AUTHORITY = {
  qualificationAuthorized: false,
  contactAuthorized: false,
  consentAuthorized: false,
  outreachAuthorized: false,
  sendAuthorized: false,
  deploymentAuthorized: false,
  providerOperationsAuthorized: 0,
  costAuthorizedCad: 0,
} as const;

const AssessmentShape = M2WebsiteNeedCommandSchema.omit({ noCopiedOrPersonalData: true }).extend({
  assessmentVersion: z.literal(M2_WEBSITE_NEED_ASSESSMENT_VERSION),
  auditVersion: z.literal(M2_WEBSITE_NEED_AUDIT_VERSION),
  sourceDecision: z.literal(M2_WEBSITE_NEED_SOURCE_DECISION),
  assessedBy: z.literal("CLAUDE"),
  delegatedBy: z.literal("RILEY"),
  method: z.literal("AGENT_BROWSER_VIEW"),
  evidenceRetention: z.literal("DERIVED_FACTS_ONLY"),
  businessName: z.string().trim().min(1).max(256),
  approvedWebsiteUrl: HttpUrlSchema,
  businessIdentityDigest: DigestSchema,
  assessedAt: TimestampSchema,
  qualification: z.literal("RESEARCH"),
  ownerReview: z.literal("PENDING_OWNER_CONFIRMATION"),
  authority: AuthoritySchema,
});
export const M2WebsiteNeedAssessmentSchema = AssessmentShape.extend({
  assessmentId: z.string().regex(/^m2-website-need:[a-f0-9]{64}$/),
}).strict();
export type M2WebsiteNeedAssessment = z.infer<typeof M2WebsiteNeedAssessmentSchema>;

const contactOrCopySignals = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+?\d[\d ().-]{7,}\d)/,
  /https?:\/\//i,
];

/**
 * The fixed need rule. REBUILD needs at least three major-or-critical issues, one
 * of them conversion-critical (the plan's "three supported observations including
 * a conversion-critical issue"). A homepage viewed at only one width is INCOMPLETE.
 */
export function deriveM2WebsiteNeed(input: Pick<M2WebsiteNeedCommand, "pagesViewed" | "findings">, approvedWebsiteUrl: string): WebsiteNeed {
  const home = new URL(approvedWebsiteUrl);
  const homeViews = new Set(input.pagesViewed
    .filter((page) => new URL(page.url).origin === home.origin && new URL(page.url).pathname === "/")
    .flatMap((page) => page.viewports));
  if (!homeViews.has("DESKTOP") || !homeViews.has("PHONE")) return "INCOMPLETE";
  const issues = input.findings.filter((finding) => finding.kind === "ISSUE");
  const serious = issues.filter((finding) => finding.severity === "CRITICAL" || finding.severity === "MAJOR");
  if (serious.length >= 3 && serious.some((finding) => finding.conversionCritical)) return "REBUILD";
  if (serious.length >= 1 || issues.length >= 2) return "MINOR_IMPROVEMENT";
  return "NO_OPPORTUNITY";
}

function sameOriginWithoutSecrets(value: string, approved: URL, label: string) {
  const url = new URL(value);
  if (url.origin !== approved.origin || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be a plain page on the approved website origin.`);
  }
}

export function buildM2WebsiteNeedAssessment(
  commandInput: unknown,
  target: M2ManualWebsiteObservationTarget,
  assessedAt: string,
): M2WebsiteNeedAssessment {
  const command = M2WebsiteNeedCommandSchema.parse(commandInput);
  if (!TimestampSchema.safeParse(assessedAt).success) throw new Error("The assessment time is invalid.");
  if (command.reviewId !== target.reviewId) throw new Error("This assessment does not match the saved M2 identity.");
  const approved = new URL(target.approvedWebsiteUrl);
  for (const page of command.pagesViewed) {
    sameOriginWithoutSecrets(page.url, approved, "A viewed page");
    if (Date.parse(page.viewedAt) > Date.parse(assessedAt)) throw new Error("A page cannot be viewed after the assessment time.");
  }
  const viewed = new Set(command.pagesViewed.flatMap((page) => page.viewports.map((viewport) => `${page.url}|${viewport}`)));
  const ids = new Set<string>();
  for (const finding of command.findings) {
    if (ids.has(finding.findingId)) throw new Error("Finding IDs must be unique.");
    ids.add(finding.findingId);
    if (!viewed.has(`${finding.pageUrl}|${finding.viewport}`)) throw new Error(`${finding.findingId} must cite a page and width that was actually viewed.`);
    if (contactOrCopySignals.some((pattern) => pattern.test(finding.finding))) {
      throw new Error(`${finding.findingId} must be in your own words without contact details or links.`);
    }
  }
  for (const text of [command.rationale, command.businessFitNote]) {
    if (contactOrCopySignals.some((pattern) => pattern.test(text))) throw new Error("Notes cannot contain contact details or links.");
  }
  const derived = deriveM2WebsiteNeed(command, target.approvedWebsiteUrl);
  if (derived !== command.websiteNeed) {
    throw new Error(`The findings support ${derived}, not ${command.websiteNeed}.`);
  }
  const { noCopiedOrPersonalData: _declared, ...rest } = command;
  void _declared;
  const core = {
    ...rest,
    assessmentVersion: M2_WEBSITE_NEED_ASSESSMENT_VERSION,
    auditVersion: M2_WEBSITE_NEED_AUDIT_VERSION,
    sourceDecision: M2_WEBSITE_NEED_SOURCE_DECISION,
    assessedBy: "CLAUDE" as const,
    delegatedBy: "RILEY" as const,
    method: "AGENT_BROWSER_VIEW" as const,
    evidenceRetention: "DERIVED_FACTS_ONLY" as const,
    businessName: target.businessName,
    approvedWebsiteUrl: target.approvedWebsiteUrl,
    businessIdentityDigest: target.businessIdentityDigest,
    assessedAt,
    qualification: "RESEARCH" as const,
    ownerReview: "PENDING_OWNER_CONFIRMATION" as const,
    authority: M2_WEBSITE_NEED_AUTHORITY,
  };
  const parsedCore = AssessmentShape.parse(core);
  return M2WebsiteNeedAssessmentSchema.parse({ ...parsedCore, assessmentId: `m2-website-need:${privateKwM2ReceiptCanonicalDigest(parsedCore)}` });
}

/** Rejects a stored record whose identity does not match its exact content. */
export function verifyM2WebsiteNeedAssessment(value: unknown): M2WebsiteNeedAssessment {
  const record = M2WebsiteNeedAssessmentSchema.parse(value);
  const { assessmentId, ...core } = record;
  if (assessmentId !== `m2-website-need:${privateKwM2ReceiptCanonicalDigest(core)}`) {
    throw new Error("A website-need assessment does not match its content digest.");
  }
  if (deriveM2WebsiteNeed(record, record.approvedWebsiteUrl) !== record.websiteNeed) {
    throw new Error("A stored website-need assessment is not supported by its findings.");
  }
  return record;
}
