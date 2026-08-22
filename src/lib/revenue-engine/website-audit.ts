import { z } from "zod";

import { EvidenceClaimSchema, type EvidenceClaim } from "@/lib/revenue-engine/evidence";

export const DETERMINISTIC_WEBSITE_AUDIT_VERSION = "website-audit-deterministic-v2";

export const WebsiteSiteStateSchema = z.enum(["NO_SITE", "UNREACHABLE", "CAPTURED"]);
export const WebsiteClassificationSchema = z.enum([
  "REBUILD",
  "NO_SITE_NEW_BUILD",
  "MINOR_IMPROVEMENT",
  "NO_OPPORTUNITY",
]);

export const WebsitePageKindSchema = z.enum(["HOME", "SERVICE", "ABOUT", "CONTACT", "OTHER"]);
export const WebsiteActionKindSchema = z.enum(["PHONE", "QUOTE", "BOOK", "CONTACT"]);
export const WebsiteTrustSignalSchema = z.enum([
  "TESTIMONIAL",
  "REVIEW",
  "PROJECT_GALLERY",
  "TEAM",
  "CREDENTIAL",
  "WARRANTY",
  "PROCESS",
  "CASE_STUDY",
]);

export const WebsiteActionSchema = z
  .object({
    kind: WebsiteActionKindSchema,
    label: z.string().trim().min(1).max(120),
    href: z.string().trim().max(2048).nullable(),
    visible: z.boolean().nullable(),
    aboveFold: z.boolean().nullable(),
  })
  .strict();

export const WebsiteFormSchema = z
  .object({
    visible: z.boolean().nullable(),
    hasSubmitControl: z.boolean(),
    disabled: z.boolean(),
    actionUrl: z.string().url().nullable(),
  })
  .strict();

export const WebsitePageSnapshotSchema = z
  .object({
    kind: WebsitePageKindSchema,
    url: z.string().url(),
    title: z.string().trim().max(300).nullable(),
    metaDescription: z.string().trim().max(600).nullable(),
    visibleText: z.string().max(100_000),
    actions: z.array(WebsiteActionSchema).max(100),
    forms: z.array(WebsiteFormSchema).max(30),
    trustSignals: z.array(WebsiteTrustSignalSchema).max(50),
    structuredDataTypes: z.array(z.string().trim().min(1).max(120)).max(50),
    contentComplete: z.boolean(),
    evidenceCoverage: z
      .object({
        desktopRenderCaptured: z.boolean(),
        actionVisibilityComplete: z.boolean(),
        formVisibilityComplete: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((page, context) => {
    if (
      !page.evidenceCoverage.desktopRenderCaptured
      && (page.evidenceCoverage.actionVisibilityComplete || page.evidenceCoverage.formVisibilityComplete)
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete visual coverage requires a captured desktop render.",
        path: ["evidenceCoverage"],
      });
    }
    if (
      page.evidenceCoverage.actionVisibilityComplete
      && page.actions.some((action) => action.visible === null || action.aboveFold === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete action coverage cannot contain unknown visibility or placement.",
        path: ["actions"],
      });
    }
    if (
      page.evidenceCoverage.formVisibilityComplete
      && page.forms.some((form) => form.visible === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete form coverage cannot contain unknown visibility.",
        path: ["forms"],
      });
    }
    if (page.actions.some((action) => action.aboveFold === true && action.visible !== true)) {
      context.addIssue({
        code: "custom",
        message: "An action cannot be above the fold unless it is visibly rendered.",
        path: ["actions"],
      });
    }
  });

export const ResourceProbeSchema = z
  .object({
    url: z.string().url(),
    type: z.enum(["PAGE", "ASSET"]),
    internal: z.boolean(),
    statusCode: z.number().int().min(0).max(599),
  })
  .strict();

export const MobileSnapshotSchema = z
  .object({
    captured: z.boolean(),
    horizontalOverflow: z.boolean().nullable(),
    navigationUsable: z.boolean().nullable(),
    textReadable: z.boolean().nullable(),
    minimumTapTargetPx: z.number().nonnegative().max(500).nullable(),
  })
  .strict();

export const DeterministicWebsiteAuditInputSchema = z
  .object({
    businessId: z.string().trim().min(1).max(128),
    businessName: z.string().trim().min(1).max(256),
    niche: z.string().trim().min(1).max(128),
    expectedServices: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    expectedLocations: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    sourceEvidenceUrl: z.string().url(),
    siteState: WebsiteSiteStateSchema,
    requestedUrl: z.string().url().nullable(),
    finalUrl: z.string().url().nullable(),
    statusCode: z.number().int().min(0).max(599),
    redirectCount: z.number().int().nonnegative().max(20),
    capturedAt: z.string().datetime({ offset: true }),
    desktopArtifactRef: z.string().trim().min(1).nullable(),
    mobileArtifactRef: z.string().trim().min(1).nullable(),
    domArtifactRef: z.string().trim().min(1).nullable(),
    pageSetComplete: z.boolean(),
    pages: z.array(WebsitePageSnapshotSchema).max(10),
    resourceProbes: z.array(ResourceProbeSchema).max(250),
    mobile: MobileSnapshotSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.siteState === "CAPTURED" && (!input.finalUrl || input.pages.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "A captured site requires a final URL and at least one page snapshot.",
        path: ["siteState"],
      });
    }
    if (input.siteState === "CAPTURED" && (input.statusCode < 200 || input.statusCode >= 400)) {
      context.addIssue({
        code: "custom",
        message: "A captured site requires a successful HTTP status.",
        path: ["statusCode"],
      });
    }
    if (input.siteState === "NO_SITE" && (input.requestedUrl || input.finalUrl || input.pages.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "A no-site record cannot contain captured website data.",
        path: ["siteState"],
      });
    }
    if (
      input.siteState === "NO_SITE" &&
      (input.desktopArtifactRef || input.mobileArtifactRef || input.domArtifactRef || input.resourceProbes.length > 0 || input.mobile.captured)
    ) {
      context.addIssue({
        code: "custom",
        message: "A no-site record cannot contain website capture artifacts or probes.",
        path: ["siteState"],
      });
    }
    if (input.siteState === "UNREACHABLE" && !input.requestedUrl) {
      context.addIssue({
        code: "custom",
        message: "An unreachable site requires the URL that was probed.",
        path: ["requestedUrl"],
      });
    }
    if (
      input.siteState === "UNREACHABLE"
      && (
        input.finalUrl
        || input.pages.length > 0
        || input.desktopArtifactRef
        || input.mobileArtifactRef
        || input.domArtifactRef
        || input.resourceProbes.length > 0
        || input.mobile.captured
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "An unreachable site cannot retain successful capture evidence.",
        path: ["siteState"],
      });
    }
    if (input.mobile.captured && !input.mobileArtifactRef) {
      context.addIssue({
        code: "custom",
        message: "Measured mobile evidence requires its artifact reference.",
        path: ["mobileArtifactRef"],
      });
    }
    if (
      !input.mobile.captured
      && (
        input.mobile.horizontalOverflow !== null
        || input.mobile.navigationUsable !== null
        || input.mobile.textReadable !== null
        || input.mobile.minimumTapTargetPx !== null
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "An uncaptured mobile view cannot contain measured results.",
        path: ["mobile"],
      });
    }
  });

const AuditCheckSchema = z
  .object({
    checkId: z.string().trim().min(1).max(80),
    outcome: z.enum(["PASS", "FAIL", "UNKNOWN"]),
    severity: z.enum(["CRITICAL", "IMPORTANT", "MINOR"]),
    category: EvidenceClaimSchema.shape.category,
    scoreImpact: z.number().int().min(0).max(100),
    claimId: z.string().trim().min(1).nullable(),
  })
  .strict();

export const DeterministicWebsiteAuditResultSchema = z
  .object({
    businessId: z.string().trim().min(1).max(128),
    auditVersion: z.literal(DETERMINISTIC_WEBSITE_AUDIT_VERSION),
    siteState: WebsiteSiteStateSchema,
    classification: WebsiteClassificationSchema,
    rebuildNeedScore: z.number().int().min(0).max(100),
    evidenceConfidence: z.number().int().min(0).max(100),
    capturedAt: z.string().datetime({ offset: true }),
    finalUrl: z.string().url().nullable(),
    desktopArtifactRef: z.string().trim().min(1).nullable(),
    mobileArtifactRef: z.string().trim().min(1).nullable(),
    domArtifactRef: z.string().trim().min(1).nullable(),
    checks: z.array(AuditCheckSchema),
    claims: z.array(EvidenceClaimSchema),
    manualReviewReasons: z.array(z.string().trim().min(1).max(120)),
  })
  .strict();

export type DeterministicWebsiteAuditInput = z.infer<typeof DeterministicWebsiteAuditInputSchema>;
export type DeterministicWebsiteAuditResult = z.infer<typeof DeterministicWebsiteAuditResultSchema>;
type AuditCheck = z.infer<typeof AuditCheckSchema>;
type EvidenceCategory = EvidenceClaim["category"];

type CheckInput = {
  checkId: string;
  outcome: AuditCheck["outcome"];
  severity: AuditCheck["severity"];
  category: EvidenceCategory;
  scoreImpact: number;
  observation: string;
  sourceUrl: string;
  method: EvidenceClaim["method"];
  confidence: number;
  conversionCritical?: boolean;
  artifactRef?: string | null;
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function includesAnyTerm(text: string, terms: string[]) {
  const haystack = ` ${normalizeSearchText(text)} `;
  return terms.some((term) => {
    const needle = normalizeSearchText(term);
    return needle.length > 0 && haystack.includes(` ${needle} `);
  });
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function classificationFor(input: DeterministicWebsiteAuditInput, checks: AuditCheck[]) {
  if (input.siteState === "NO_SITE") return "NO_SITE_NEW_BUILD" as const;
  if (input.siteState === "UNREACHABLE") return "REBUILD" as const;

  const score = checks
    .filter((check) => check.outcome === "FAIL")
    .reduce((total, check) => total + check.scoreImpact, 0);
  const criticalFailures = checks.filter(
    (check) => check.outcome === "FAIL" && check.severity === "CRITICAL",
  ).length;
  if (score >= 55 || criticalFailures >= 2) return "REBUILD" as const;
  if (score >= 10) return "MINOR_IMPROVEMENT" as const;
  return "NO_OPPORTUNITY" as const;
}

export function auditWebsiteDeterministically(value: DeterministicWebsiteAuditInput): DeterministicWebsiteAuditResult {
  const input = DeterministicWebsiteAuditInputSchema.parse(value);
  const checks: AuditCheck[] = [];
  const claims: EvidenceClaim[] = [];

  const addCheck = (check: CheckInput) => {
    const claimId = check.outcome === "FAIL"
      ? `claim:${input.businessId}:${DETERMINISTIC_WEBSITE_AUDIT_VERSION}:${check.checkId}`
      : null;
    checks.push(AuditCheckSchema.parse({
      checkId: check.checkId,
      outcome: check.outcome,
      severity: check.severity,
      category: check.category,
      scoreImpact: check.scoreImpact,
      claimId,
    }));

    if (claimId) {
      claims.push(EvidenceClaimSchema.parse({
        claimId,
        observation: check.observation,
        sourceUrl: check.sourceUrl,
        capturedAt: input.capturedAt,
        method: check.method,
        confidence: check.confidence,
        auditVersion: DETERMINISTIC_WEBSITE_AUDIT_VERSION,
        artifactRef: check.artifactRef ?? null,
        conversionCritical: check.conversionCritical ?? false,
        category: check.category,
      }));
    }
  };

  const fallbackUrl = input.requestedUrl || input.sourceEvidenceUrl;
  if (input.siteState === "NO_SITE") {
    addCheck({
      checkId: "website_presence",
      outcome: "FAIL",
      severity: "CRITICAL",
      category: "availability",
      scoreImpact: 100,
      observation: "No public website was present in the captured source record.",
      sourceUrl: input.sourceEvidenceUrl,
      method: "source_api",
      confidence: 100,
      conversionCritical: true,
    });
  } else if (input.siteState === "UNREACHABLE") {
    addCheck({
      checkId: "website_availability",
      outcome: "FAIL",
      severity: "CRITICAL",
      category: "availability",
      scoreImpact: 100,
      observation: `The website returned HTTP status ${input.statusCode || "unavailable"} during the audit.`,
      sourceUrl: fallbackUrl,
      method: "http_probe",
      confidence: 100,
      conversionCritical: true,
    });
  } else {
    const home = input.pages.find((page) => page.kind === "HOME") || input.pages[0];
    const allText = input.pages.map((page) => page.visibleText).join(" ");
    const sourceUrl = home.url;
    const visibleActions = home.actions.filter((action) => action.visible === true);
    const primaryAction = visibleActions.some((action) => action.aboveFold);
    const tapToCall = visibleActions.some((action) => action.kind === "PHONE" && action.href?.startsWith("tel:"));
    const usableForm = input.pages.some((page) =>
      page.forms.some((form) => form.visible && form.hasSubmitControl && !form.disabled),
    );
    const servicePageCount = input.pages.filter((page) => page.kind === "SERVICE").length;
    const trustSignalCount = new Set(input.pages.flatMap((page) => page.trustSignals)).size;
    const brokenResources = input.resourceProbes.filter(
      (probe) => probe.internal && probe.statusCode >= 400,
    );

    addCheck({
      checkId: "website_availability",
      outcome: input.statusCode >= 200 && input.statusCode < 400 ? "PASS" : "FAIL",
      severity: "CRITICAL",
      category: "availability",
      scoreImpact: 100,
      observation: `The captured website returned HTTP status ${input.statusCode}.`,
      sourceUrl,
      method: "http_probe",
      confidence: 100,
      conversionCritical: true,
    });
    addCheck({
      checkId: "redirect_chain",
      outcome: input.redirectCount <= 3 ? "PASS" : "FAIL",
      severity: "MINOR",
      category: "availability",
      scoreImpact: 5,
      observation: `The website required ${input.redirectCount} redirects before the final page loaded.`,
      sourceUrl,
      method: "http_probe",
      confidence: 100,
    });
    addCheck({
      checkId: "https",
      outcome: input.finalUrl?.startsWith("https://") ? "PASS" : "FAIL",
      severity: "IMPORTANT",
      category: "availability",
      scoreImpact: 10,
      observation: "The final website URL does not use HTTPS.",
      sourceUrl,
      method: "http_probe",
      confidence: 100,
    });
    addCheck({
      checkId: "broken_internal_resources",
      outcome: input.resourceProbes.length === 0 ? "UNKNOWN" : brokenResources.length === 0 ? "PASS" : "FAIL",
      severity: "IMPORTANT",
      category: "availability",
      scoreImpact: 12,
      observation: brokenResources.length > 0
        ? `The captured internal ${brokenResources[0].type.toLocaleLowerCase("en-CA")} returned HTTP status ${brokenResources[0].statusCode}; ${brokenResources.length} internal request(s) failed in total.`
        : "No captured internal page or asset request returned an error status.",
      sourceUrl: brokenResources[0]?.url || sourceUrl,
      method: "http_probe",
      confidence: 100,
    });
    addCheck({
      checkId: "offer_clarity",
      outcome: includesAnyTerm(home.visibleText, input.expectedServices)
        ? "PASS"
        : home.contentComplete ? "FAIL" : "UNKNOWN",
      severity: "IMPORTANT",
      category: "offer_clarity",
      scoreImpact: 15,
      observation: `The homepage text does not mention any expected ${input.niche} service term supplied to the audit.`,
      sourceUrl,
      method: "deterministic_dom",
      confidence: 95,
      artifactRef: input.domArtifactRef,
    });
    addCheck({
      checkId: "local_relevance",
      outcome: includesAnyTerm(allText, input.expectedLocations)
        ? "PASS"
        : input.pageSetComplete && input.pages.every((page) => page.contentComplete) ? "FAIL" : "UNKNOWN",
      severity: "IMPORTANT",
      category: "local_relevance",
      scoreImpact: 8,
      observation: "The captured site text does not mention an expected service location supplied to the audit.",
      sourceUrl,
      method: "deterministic_dom",
      confidence: 95,
      artifactRef: input.domArtifactRef,
    });
    addCheck({
      checkId: "primary_conversion_action",
      outcome: primaryAction
        ? "PASS"
        : home.evidenceCoverage.actionVisibilityComplete ? "FAIL" : "UNKNOWN",
      severity: "CRITICAL",
      category: "conversion_action",
      scoreImpact: 25,
      observation: "The homepage does not expose a visible phone, quote, booking, or contact action above the fold.",
      sourceUrl,
      method: "deterministic_dom",
      confidence: 98,
      conversionCritical: true,
      artifactRef: input.desktopArtifactRef,
    });
    addCheck({
      checkId: "tap_to_call",
      outcome: tapToCall
        ? "PASS"
        : home.evidenceCoverage.actionVisibilityComplete ? "FAIL" : "UNKNOWN",
      severity: "IMPORTANT",
      category: "conversion_action",
      scoreImpact: 10,
      observation: "The captured homepage does not expose a visible tap-to-call phone link.",
      sourceUrl,
      method: "deterministic_dom",
      confidence: 98,
      artifactRef: input.domArtifactRef,
    });
    addCheck({
      checkId: "form_availability",
      outcome: usableForm
        ? "PASS"
        : input.pages.every((page) => page.evidenceCoverage.formVisibilityComplete) ? "FAIL" : "UNKNOWN",
      severity: "IMPORTANT",
      category: "form",
      scoreImpact: 10,
      observation: "No visible form with an enabled submit control was found in the captured pages.",
      sourceUrl,
      method: "deterministic_dom",
      confidence: 98,
      artifactRef: input.domArtifactRef,
    });
    addCheck({
      checkId: "service_pages",
      outcome: servicePageCount > 0 ? "PASS" : input.pageSetComplete ? "FAIL" : "UNKNOWN",
      severity: "IMPORTANT",
      category: "offer_clarity",
      scoreImpact: 8,
      observation: "No dedicated service page was present in the captured page set.",
      sourceUrl,
      method: "deterministic_dom",
      confidence: 95,
      artifactRef: input.domArtifactRef,
    });
    addCheck({
      checkId: "trust_signals",
      outcome: trustSignalCount > 0
        ? "PASS"
        : input.pageSetComplete && input.pages.every((page) => page.contentComplete) ? "FAIL" : "UNKNOWN",
      severity: "IMPORTANT",
      category: "trust",
      scoreImpact: 12,
      observation: "The captured pages contain no recognized testimonial, review, project, team, credential, warranty, process, or case-study signal.",
      sourceUrl,
      method: "deterministic_dom",
      confidence: 90,
      artifactRef: input.domArtifactRef,
    });
    addCheck({
      checkId: "page_title",
      outcome: home.title ? "PASS" : home.contentComplete ? "FAIL" : "UNKNOWN",
      severity: "MINOR",
      category: "seo",
      scoreImpact: 3,
      observation: "The captured homepage has no non-empty page title.",
      sourceUrl,
      method: "deterministic_dom",
      confidence: 100,
      artifactRef: input.domArtifactRef,
    });
    addCheck({
      checkId: "meta_description",
      outcome: home.metaDescription ? "PASS" : home.contentComplete ? "FAIL" : "UNKNOWN",
      severity: "MINOR",
      category: "seo",
      scoreImpact: 2,
      observation: "The captured homepage has no non-empty meta description.",
      sourceUrl,
      method: "deterministic_dom",
      confidence: 100,
      artifactRef: input.domArtifactRef,
    });
    addCheck({
      checkId: "structured_data",
      outcome: home.structuredDataTypes.length > 0 ? "PASS" : home.contentComplete ? "FAIL" : "UNKNOWN",
      severity: "MINOR",
      category: "seo",
      scoreImpact: 3,
      observation: "No structured-data type was present in the captured homepage DOM.",
      sourceUrl,
      method: "deterministic_dom",
      confidence: 100,
      artifactRef: input.domArtifactRef,
    });

    const mobileSource = input.mobileArtifactRef || input.domArtifactRef;
    addCheck({
      checkId: "mobile_overflow",
      outcome: !input.mobile.captured || input.mobile.horizontalOverflow === null
        ? "UNKNOWN"
        : input.mobile.horizontalOverflow ? "FAIL" : "PASS",
      severity: "CRITICAL",
      category: "mobile",
      scoreImpact: 15,
      observation: "The captured mobile view has horizontal overflow.",
      sourceUrl,
      method: "browser_render",
      confidence: 98,
      conversionCritical: true,
      artifactRef: mobileSource,
    });
    addCheck({
      checkId: "mobile_navigation",
      outcome: !input.mobile.captured || input.mobile.navigationUsable === null
        ? "UNKNOWN"
        : input.mobile.navigationUsable ? "PASS" : "FAIL",
      severity: "CRITICAL",
      category: "navigation",
      scoreImpact: 20,
      observation: "The captured mobile navigation was not usable under the deterministic audit criteria.",
      sourceUrl,
      method: "browser_render",
      confidence: 95,
      conversionCritical: true,
      artifactRef: mobileSource,
    });
    addCheck({
      checkId: "mobile_readability",
      outcome: !input.mobile.captured || input.mobile.textReadable === null
        ? "UNKNOWN"
        : input.mobile.textReadable ? "PASS" : "FAIL",
      severity: "CRITICAL",
      category: "mobile",
      scoreImpact: 15,
      observation: "The captured mobile page did not meet the deterministic text-readability criteria.",
      sourceUrl,
      method: "browser_render",
      confidence: 95,
      conversionCritical: true,
      artifactRef: mobileSource,
    });
    addCheck({
      checkId: "mobile_tap_targets",
      outcome: !input.mobile.captured || input.mobile.minimumTapTargetPx === null
        ? "UNKNOWN"
        : input.mobile.minimumTapTargetPx >= 24 ? "PASS" : "FAIL",
      severity: "IMPORTANT",
      category: "mobile",
      scoreImpact: 8,
      observation: `The smallest captured mobile tap target measured ${input.mobile.minimumTapTargetPx ?? "unknown"} CSS pixels, below the 24-pixel audit threshold.`,
      sourceUrl,
      method: "browser_render",
      confidence: 98,
      artifactRef: mobileSource,
    });
  }

  const failedScore = checks
    .filter((check) => check.outcome === "FAIL")
    .reduce((total, check) => total + check.scoreImpact, 0);
  const assessedCount = checks.filter((check) => check.outcome !== "UNKNOWN").length;
  const evidenceConfidence = checks.length === 0 ? 0 : Math.round((assessedCount / checks.length) * 100);
  const manualReviewReasons = checks
    .filter((check) => check.outcome === "UNKNOWN")
    .map((check) => `unverified:${check.checkId}`);

  return DeterministicWebsiteAuditResultSchema.parse({
    businessId: input.businessId,
    auditVersion: DETERMINISTIC_WEBSITE_AUDIT_VERSION,
    siteState: input.siteState,
    classification: classificationFor(input, checks),
    rebuildNeedScore: clampScore(failedScore),
    evidenceConfidence,
    capturedAt: input.capturedAt,
    finalUrl: input.finalUrl,
    desktopArtifactRef: input.desktopArtifactRef,
    mobileArtifactRef: input.mobileArtifactRef,
    domArtifactRef: input.domArtifactRef,
    checks,
    claims,
    manualReviewReasons,
  });
}
