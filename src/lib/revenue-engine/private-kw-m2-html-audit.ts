import { z } from "zod";

import {
  auditWebsiteDeterministically,
  DeterministicWebsiteAuditInputSchema,
  DeterministicWebsiteAuditResultSchema,
  type DeterministicWebsiteAuditResult,
  WebsitePageSnapshotSchema,
} from "@/lib/revenue-engine/website-audit";
import type { HtmlPageFacts } from "@/lib/revenue-engine/html-page-facts";
import type { WebsiteCaptureResult } from "@/lib/revenue-engine/website-capture";

export const PRIVATE_KW_M2_HTML_AUDIT_VERSION = "kw-m2-html-audit-v1";
const ALLOWED_CHECK_IDS = new Set(["website_availability", "redirect_chain", "https"]);

const HtmlOnlyPageSchema = z.object({
  pageKind: z.enum(["HOME", "SERVICE", "ABOUT", "CONTACT"]),
  requestedUrl: z.string().url(),
  finalUrl: z.string().url().nullable(),
  capturedAt: z.string().datetime({ offset: true }),
  statusCode: z.number().int().min(0).max(599),
  contentComplete: z.literal(false),
}).strict();

export const PrivateKwM2HtmlAvailabilityProofSchema = z.object({
  proofVersion: z.literal(PRIVATE_KW_M2_HTML_AUDIT_VERSION),
  sourceIdentityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  requestedUrl: z.string().url(),
  finalUrl: z.string().url().nullable(),
  statusCode: z.number().int().min(0).max(599),
  redirectCount: z.number().int().nonnegative().max(20),
  capturedAt: z.string().datetime({ offset: true }),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  checks: z.array(z.object({
    checkId: z.enum(["website_availability", "redirect_chain", "https"]),
    outcome: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    category: z.literal("availability"),
    method: z.literal("http_probe"),
    confidence: z.literal(0),
    conversionCritical: z.literal(false),
    sourceUrl: z.string().url(),
    capturedAt: z.string().datetime({ offset: true }),
    artifactRef: z.null(),
  }).strict()).max(3),
}).strict();

export const PrivateKwM2HtmlAuditReceiptSchema = z.object({
  auditVersion: z.literal(PRIVATE_KW_M2_HTML_AUDIT_VERSION),
  assemblerKind: z.literal("HTML_ONLY"),
  browserEvidencePresent: z.literal(false),
  state: z.enum(["HTML_ONLY_PARTIAL", "HTML_ONLY_UNAVAILABLE"]),
  pages: z.array(HtmlOnlyPageSchema).min(1).max(4),
  availability: PrivateKwM2HtmlAvailabilityProofSchema.nullable(),
  unknownLimitations: z.array(z.string().trim().min(1).max(120)).max(20),
  desktopArtifactRef: z.null(),
  mobileArtifactRef: z.null(),
  domArtifactRef: z.null(),
  classification: z.undefined().optional(),
  rebuildNeedScore: z.undefined().optional(),
  evidenceConfidence: z.undefined().optional(),
}).strict();

export type PrivateKwM2HtmlAuditReceipt = z.infer<typeof PrivateKwM2HtmlAuditReceiptSchema>;
export type PrivateKwM2HtmlAvailabilityProof = z.infer<typeof PrivateKwM2HtmlAvailabilityProofSchema>;
export type PrivateKwM2HtmlAuditPage = z.infer<typeof HtmlOnlyPageSchema>;

function toPage(pageKind: PrivateKwM2HtmlAuditPage["pageKind"], capture: WebsiteCaptureResult, facts: HtmlPageFacts): PrivateKwM2HtmlAuditPage {
  if (capture.outcome !== "CAPTURED") {
    return {
      pageKind,
      requestedUrl: capture.requestedUrl ?? facts.url,
      finalUrl: null,
      capturedAt: capture.capturedAt,
      statusCode: capture.statusCode,
      contentComplete: false,
    };
  }
  return {
    pageKind,
    requestedUrl: capture.requestedUrl!,
    finalUrl: capture.finalUrl,
    capturedAt: capture.capturedAt,
    statusCode: capture.statusCode,
    contentComplete: false,
  };
}

function toSnapshot(page: PrivateKwM2HtmlAuditPage): z.infer<typeof WebsitePageSnapshotSchema> {
  return {
    kind: page.pageKind,
    url: page.finalUrl ?? page.requestedUrl,
    title: null,
    metaDescription: null,
    visibleText: "",
    actions: [],
    forms: [],
    trustSignals: [],
    structuredDataTypes: [],
    contentComplete: false,
    evidenceCoverage: {
      desktopRenderCaptured: false,
      actionVisibilityComplete: false,
      formVisibilityComplete: false,
    },
  };
}

function availability(
  audit: DeterministicWebsiteAuditResult,
  sourceIdentityDigest: string,
  capture: WebsiteCaptureResult,
): PrivateKwM2HtmlAvailabilityProof {
  if (capture.outcome !== "CAPTURED") return {
    proofVersion: PRIVATE_KW_M2_HTML_AUDIT_VERSION,
    sourceIdentityDigest,
    requestedUrl: capture.requestedUrl!,
    finalUrl: null,
    statusCode: capture.statusCode,
    redirectCount: capture.redirectCount,
    capturedAt: capture.capturedAt,
    contentDigest: null,
    checks: [],
  };

  const checks = audit.checks
    .filter((check) => ALLOWED_CHECK_IDS.has(check.checkId))
    .map((check) => ({
      checkId: check.checkId as "website_availability" | "redirect_chain" | "https",
      outcome: check.outcome,
      category: "availability" as const,
      method: "http_probe" as const,
      confidence: 0 as const,
      conversionCritical: false as const,
      sourceUrl: capture.finalUrl!,
      capturedAt: capture.capturedAt,
      artifactRef: null,
    }));
  return PrivateKwM2HtmlAvailabilityProofSchema.parse({
    proofVersion: PRIVATE_KW_M2_HTML_AUDIT_VERSION,
    sourceIdentityDigest,
    requestedUrl: capture.requestedUrl!,
    finalUrl: capture.finalUrl,
    statusCode: capture.statusCode,
    redirectCount: capture.redirectCount,
    capturedAt: capture.capturedAt,
    contentDigest: capture.contentDigest,
    checks,
  });
}

export function buildPrivateKwM2HtmlAuditReceipt(input: {
  sourceIdentityDigest: string;
  businessId: string;
  businessName: string;
  niche: string;
  expectedServices: string[];
  expectedLocations: string[];
  sourceEvidenceUrl: string;
  pages: Array<{ pageKind: PrivateKwM2HtmlAuditPage["pageKind"]; capture: WebsiteCaptureResult; facts: HtmlPageFacts }>;
}): PrivateKwM2HtmlAuditReceipt {
  const pages = input.pages.map((page) => toPage(page.pageKind, page.capture, page.facts));
  const home = pages.find((page) => page.pageKind === "HOME") ?? pages[0];
  if (!home || !home.finalUrl) throw new Error("HTML-only audit requires a captured homepage.");
  const auditInput = DeterministicWebsiteAuditInputSchema.parse({
    businessId: input.businessId,
    businessName: input.businessName,
    niche: input.niche,
    expectedServices: input.expectedServices,
    expectedLocations: input.expectedLocations,
    sourceEvidenceUrl: input.sourceEvidenceUrl,
    siteState: "CAPTURED",
    requestedUrl: home.requestedUrl,
    finalUrl: home.finalUrl,
    statusCode: home.statusCode,
    redirectCount: pages[0]!.pageKind === "HOME" ? input.pages[0]!.capture.redirectCount : 0,
    capturedAt: home.capturedAt,
    desktopArtifactRef: null,
    mobileArtifactRef: null,
    domArtifactRef: null,
    pageSetComplete: false,
    pages: pages.map(toSnapshot),
    resourceProbes: [],
    mobile: {
      captured: false,
      horizontalOverflow: null,
      navigationUsable: null,
      textReadable: null,
      minimumTapTargetPx: null,
    },
  });
  const rawAudit = DeterministicWebsiteAuditResultSchema.parse(auditWebsiteDeterministically(auditInput));
  const audit = DeterministicWebsiteAuditResultSchema.parse({
    ...rawAudit,
    checks: rawAudit.checks.map((check) => ALLOWED_CHECK_IDS.has(check.checkId)
      ? check
      : { ...check, outcome: "UNKNOWN", claimId: null }),
    claims: rawAudit.claims.filter((claim) => {
      const checkId = rawAudit.checks.find((check) => check.claimId === claim.claimId)?.checkId;
      return checkId !== undefined && ALLOWED_CHECK_IDS.has(checkId);
    }),
  });
  for (const claim of audit.claims) {
    if (claim.category !== "availability" || claim.method !== "http_probe") {
      throw new Error("HTML-only audit produced a disallowed claim category or method.");
    }
    if (!ALLOWED_CHECK_IDS.has(audit.checks.find((check) => check.claimId === claim.claimId)?.checkId ?? "")) {
      throw new Error("HTML-only audit produced a claim outside the availability allowlist.");
    }
  }
  const availabilityProof = availability(audit, input.sourceIdentityDigest, input.pages[0]!.capture);
  return PrivateKwM2HtmlAuditReceiptSchema.parse({
    auditVersion: PRIVATE_KW_M2_HTML_AUDIT_VERSION,
    assemblerKind: "HTML_ONLY",
    browserEvidencePresent: false,
    state: "HTML_ONLY_PARTIAL",
    pages,
    availability: availabilityProof,
    unknownLimitations: [
      "BROWSER_EVIDENCE_UNKNOWN",
      "MOBILE_EVIDENCE_UNKNOWN",
      "ABOVE_FOLD_EVIDENCE_UNKNOWN",
      "HTML_ONLY_STRUCTURAL_FACTS",
      "QUALIFICATION_NOT_PERFORMED",
      "CONTACT_DATA_DISCARDED",
    ],
    desktopArtifactRef: null,
    mobileArtifactRef: null,
    domArtifactRef: null,
  });
}
