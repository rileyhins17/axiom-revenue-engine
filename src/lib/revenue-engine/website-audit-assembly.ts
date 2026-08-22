import { z } from "zod";

import {
  ArtifactWriteReceiptSchema,
  type ArtifactWriteReceipt,
} from "@/lib/revenue-engine/content-addressed-artifact-store";
import {
  BrowserPageEvidenceSchema,
  mergeHtmlPageWithBrowserEvidence,
  type BrowserPageEvidence,
  type MergedBrowserPageEvidence,
} from "@/lib/revenue-engine/browser-page-evidence";
import { HtmlPageFactsSchema } from "@/lib/revenue-engine/html-page-facts";
import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";
import {
  DeterministicWebsiteAuditInputSchema,
  ResourceProbeSchema,
  WebsitePageKindSchema,
  type DeterministicWebsiteAuditInput,
} from "@/lib/revenue-engine/website-audit";
import {
  WebsiteCaptureResultSchema,
} from "@/lib/revenue-engine/website-capture";

export const WEBSITE_AUDIT_ASSEMBLY_VERSION = "website-audit-assembly-v1";
export const WEBSITE_AUDIT_MAX_PAGES = 5;
export const WEBSITE_AUDIT_MAX_BROWSER_CAPTURES = 6;
export const WEBSITE_AUDIT_MAX_BROWSER_MS = 120_000;
export const WEBSITE_AUDIT_MAX_ARTIFACT_BYTES = 31_457_280;
export const WEBSITE_AUDIT_MAX_HTML_BYTES = 5_242_880;
export const WEBSITE_AUDIT_MAX_EVIDENCE_AGE_HOURS = 24;
export const WEBSITE_AUDIT_MAX_CAPTURE_SKEW_MINUTES = 120;

const REQUIRED_PAGE_KINDS = ["HOME", "SERVICE", "ABOUT", "CONTACT"] as const;
const ARTIFACT_REF_PATTERN = /^artifact:sha256:[a-f0-9]{64}$/;

const WebsiteAuditAssemblyPolicySchema = z
  .object({
    requiredPageKinds: z.tuple([
      z.literal("HOME"),
      z.literal("SERVICE"),
      z.literal("ABOUT"),
      z.literal("CONTACT"),
    ]),
    maxPages: z.literal(WEBSITE_AUDIT_MAX_PAGES),
    maxBrowserCaptures: z.literal(WEBSITE_AUDIT_MAX_BROWSER_CAPTURES),
    maxBrowserMs: z.literal(WEBSITE_AUDIT_MAX_BROWSER_MS),
    maxArtifactBytes: z.literal(WEBSITE_AUDIT_MAX_ARTIFACT_BYTES),
    maxHtmlBytes: z.literal(WEBSITE_AUDIT_MAX_HTML_BYTES),
    maxEvidenceAgeHours: z.literal(WEBSITE_AUDIT_MAX_EVIDENCE_AGE_HOURS),
    maxCaptureSkewMinutes: z.literal(WEBSITE_AUDIT_MAX_CAPTURE_SKEW_MINUTES),
  })
  .strict();

export function defaultWebsiteAuditAssemblyPolicy() {
  return WebsiteAuditAssemblyPolicySchema.parse({
    requiredPageKinds: [...REQUIRED_PAGE_KINDS],
    maxPages: WEBSITE_AUDIT_MAX_PAGES,
    maxBrowserCaptures: WEBSITE_AUDIT_MAX_BROWSER_CAPTURES,
    maxBrowserMs: WEBSITE_AUDIT_MAX_BROWSER_MS,
    maxArtifactBytes: WEBSITE_AUDIT_MAX_ARTIFACT_BYTES,
    maxHtmlBytes: WEBSITE_AUDIT_MAX_HTML_BYTES,
    maxEvidenceAgeHours: WEBSITE_AUDIT_MAX_EVIDENCE_AGE_HOURS,
    maxCaptureSkewMinutes: WEBSITE_AUDIT_MAX_CAPTURE_SKEW_MINUTES,
  });
}

function canonicalPublicUrl(value: string) {
  const normalized = normalizePublicWebsiteUrl(value);
  if (normalized !== value) throw new Error("Website audit assembly URLs must already be canonical public URLs.");
  return normalized;
}

function siteAuthority(value: string) {
  return new URL(value).hostname.toLocaleLowerCase("en-CA").replace(/^www\./, "");
}

function successfulReceiptFor(
  receipts: ArtifactWriteReceipt[],
  evidence: Extract<BrowserPageEvidence, { outcome: "CAPTURED" }>,
) {
  const receipt = receipts.find((candidate) => candidate.planId === evidence.captureId);
  if (!receipt || receipt.outcome !== "COMPLETED") return null;
  const screenshot = receipt.items.find((item) => item.kind === "BROWSER_SCREENSHOT");
  const measurement = receipt.items.find((item) => item.kind === "BROWSER_MEASUREMENT");
  if (
    !screenshot
    || !measurement
    || screenshot.artifactRef !== evidence.screenshotArtifactRef
    || screenshot.sha256 !== evidence.screenshotSha256
    || measurement.artifactRef !== evidence.measurementArtifactRef
  ) return null;
  return receipt;
}

const WebsiteAuditPageAssemblyInputSchema = z
  .object({
    pageKind: WebsitePageKindSchema,
    capture: WebsiteCaptureResultSchema,
    html: HtmlPageFactsSchema.nullable(),
    browser: z.array(BrowserPageEvidenceSchema).max(2),
    artifactReceipts: z.array(ArtifactWriteReceiptSchema).max(2),
  })
  .strict()
  .superRefine((page, context) => {
    const capturedBrowser = page.browser.filter(
      (evidence): evidence is Extract<BrowserPageEvidence, { outcome: "CAPTURED" }> => evidence.outcome === "CAPTURED",
    );
    if (page.capture.outcome !== "CAPTURED") {
      if (page.html || page.browser.length > 0 || page.artifactReceipts.length > 0) {
        context.addIssue({
          code: "custom",
          message: "An unavailable selected page cannot retain successful HTML, Browser, or artifact evidence.",
          path: ["capture"],
        });
      }
      return;
    }
    if (!page.html) {
      context.addIssue({ code: "custom", message: "A captured selected page requires extracted HTML facts.", path: ["html"] });
      return;
    }
    if (page.html.pageKind !== page.pageKind) {
      context.addIssue({ code: "custom", message: "Page kind must match the extracted HTML facts.", path: ["pageKind"] });
    }
    if (page.capture.finalUrl !== page.html.url || page.capture.capturedAt !== page.html.capturedAt) {
      context.addIssue({
        code: "custom",
        message: "Captured page URL and timestamp must match its HTML extraction.",
        path: ["html"],
      });
    }
    if (
      page.html.captureVersion !== page.capture.captureVersion
      || new TextEncoder().encode(page.capture.html).byteLength !== page.capture.bodyBytes
    ) {
      context.addIssue({
        code: "custom",
        message: "Captured HTML bytes and version must match the extraction source.",
        path: ["html"],
      });
    }
    if (page.artifactReceipts.some((receipt) => receipt.outcome !== "COMPLETED")) {
      context.addIssue({ code: "custom", message: "Page assembly accepts only completed artifact receipts.", path: ["artifactReceipts"] });
    }
    if (
      new Set(page.browser.map((evidence) => evidence.profile)).size !== page.browser.length
      || new Set(page.browser.map((evidence) => evidence.captureId)).size !== page.browser.length
    ) {
      context.addIssue({ code: "custom", message: "Browser profiles and capture IDs must be unique per selected page.", path: ["browser"] });
    }
    if (new Set(page.artifactReceipts.map((receipt) => receipt.planId)).size !== page.artifactReceipts.length) {
      context.addIssue({ code: "custom", message: "Artifact receipt plan IDs must be unique per selected page.", path: ["artifactReceipts"] });
    }
    if (capturedBrowser.length !== page.artifactReceipts.length) {
      context.addIssue({
        code: "custom",
        message: "Every successful Browser capture requires exactly one completed artifact receipt.",
        path: ["artifactReceipts"],
      });
    }
    for (const evidence of capturedBrowser) {
      if (!ARTIFACT_REF_PATTERN.test(evidence.screenshotArtifactRef) || !ARTIFACT_REF_PATTERN.test(evidence.measurementArtifactRef)) {
        context.addIssue({
          code: "custom",
          message: "Successful Browser captures require content-addressed artifact references.",
          path: ["browser"],
        });
      }
      if (!successfulReceiptFor(page.artifactReceipts, evidence)) {
        context.addIssue({
          code: "custom",
          message: "Browser evidence must match its completed artifact receipt.",
          path: ["artifactReceipts"],
        });
      }
    }
  });

export const WebsiteAuditAssemblyRequestSchema = z
  .object({
    assemblyVersion: z.literal(WEBSITE_AUDIT_ASSEMBLY_VERSION),
    assemblyId: z.string().uuid(),
    workflowId: z.string().uuid(),
    assembledAt: z.string().datetime({ offset: true }),
    mode: z.literal("SHADOW"),
    assemblerKind: z.literal("FIXTURE"),
    maxCostUsd: z.literal(0),
    businessId: z.string().trim().min(1).max(128),
    businessName: z.string().trim().min(1).max(256),
    niche: z.string().trim().min(1).max(128),
    expectedServices: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    expectedLocations: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    sourceEvidenceUrl: z.string().url(),
    policy: WebsiteAuditAssemblyPolicySchema,
    pages: z.array(WebsiteAuditPageAssemblyInputSchema).min(1).max(WEBSITE_AUDIT_MAX_PAGES),
    resourceProbes: z.array(ResourceProbeSchema).max(100),
  })
  .strict()
  .superRefine((request, context) => {
    const addIssue = (message: string, path: Array<string | number>) => context.addIssue({ code: "custom", message, path });
    try {
      canonicalPublicUrl(request.sourceEvidenceUrl);
    } catch (error) {
      addIssue(error instanceof Error ? error.message : "Source evidence URL is not public.", ["sourceEvidenceUrl"]);
    }

    const homePages = request.pages.filter((page) => page.pageKind === "HOME");
    if (homePages.length !== 1 || homePages[0]?.capture.outcome !== "CAPTURED") {
      addIssue("Website audit assembly requires exactly one successfully captured homepage.", ["pages"]);
    }

    const canonicalPageUrls = new Set<string>();
    const canonicalFinalUrls = new Set<string>();
    const evidenceTimes: number[] = [];
    let browserCaptures = 0;
    let browserMs = 0;
    let artifactBytes = 0;
    let htmlBytes = 0;
    let authority: string | null = null;
    const homeFinalUrl = homePages.length === 1 && homePages[0].capture.outcome === "CAPTURED"
      ? homePages[0].capture.finalUrl
      : null;
    if (homeFinalUrl) {
      try {
        authority = siteAuthority(canonicalPublicUrl(homeFinalUrl));
      } catch {
        authority = null;
      }
    }
    for (const [pageIndex, page] of request.pages.entries()) {
      if (!page.capture.requestedUrl) {
        addIssue("Every selected page requires a canonical public requested URL.", ["pages", pageIndex, "capture", "requestedUrl"]);
      } else {
        try {
          const url = canonicalPublicUrl(page.capture.requestedUrl);
          if (canonicalPageUrls.has(url)) addIssue("Selected page URLs must be unique.", ["pages", pageIndex, "capture", "requestedUrl"]);
          canonicalPageUrls.add(url);
        } catch (error) {
          addIssue(error instanceof Error ? error.message : "Selected page URL is not public.", ["pages", pageIndex, "capture", "requestedUrl"]);
        }
      }
      evidenceTimes.push(Date.parse(page.capture.capturedAt));
      if (page.capture.outcome === "CAPTURED") {
        htmlBytes += page.capture.bodyBytes;
        if (!page.capture.finalUrl) {
          addIssue("A captured selected page requires a final URL.", ["pages", pageIndex, "capture", "finalUrl"]);
        } else {
          try {
            const finalUrl = canonicalPublicUrl(page.capture.finalUrl);
            if (canonicalFinalUrls.has(finalUrl)) addIssue("Captured final page URLs must be unique.", ["pages", pageIndex, "capture", "finalUrl"]);
            canonicalFinalUrls.add(finalUrl);
            const currentAuthority = siteAuthority(finalUrl);
            if (authority !== currentAuthority) addIssue("Every selected page must remain on the homepage authority.", ["pages", pageIndex, "capture", "finalUrl"]);
          } catch (error) {
            addIssue(error instanceof Error ? error.message : "Captured page URL is not public.", ["pages", pageIndex, "capture", "finalUrl"]);
          }
        }
      }
      if (page.html) evidenceTimes.push(Date.parse(page.html.capturedAt));
      for (const [browserIndex, evidence] of page.browser.entries()) {
        browserCaptures += 1;
        browserMs += evidence.browserMsUsed;
        evidenceTimes.push(Date.parse(evidence.capturedAt));
        if (evidence.businessId !== request.businessId || evidence.pageKind !== page.pageKind) {
          addIssue("Browser evidence must belong to the assembly business and selected page kind.", ["pages", pageIndex, "browser", browserIndex]);
        }
        if (evidence.browserMsUsed > 20_000) {
          addIssue("One Browser capture exceeded the approved per-capture time limit.", ["pages", pageIndex, "browser", browserIndex, "browserMsUsed"]);
        }
      }
      for (const [receiptIndex, receipt] of page.artifactReceipts.entries()) {
        if (receipt.workflowId !== request.workflowId) {
          addIssue("Artifact receipt must belong to the assembly workflow.", ["pages", pageIndex, "artifactReceipts", receiptIndex, "workflowId"]);
        }
        artifactBytes += receipt.items.reduce((sum, item) => sum + item.byteLength, 0);
        evidenceTimes.push(Date.parse(receipt.startedAt));
        evidenceTimes.push(Date.parse(receipt.completedAt));
        evidenceTimes.push(...receipt.items.map((item) => Date.parse(item.uploadedAt)));
      }
    }

    if (browserCaptures > request.policy.maxBrowserCaptures) addIssue("Business Browser capture count exceeds its assembly budget.", ["pages"]);
    if (browserMs > request.policy.maxBrowserMs) addIssue("Business Browser time exceeds its assembly budget.", ["pages"]);
    if (artifactBytes > request.policy.maxArtifactBytes) addIssue("Business artifact bytes exceed the assembly budget.", ["pages"]);
    if (htmlBytes > request.policy.maxHtmlBytes) addIssue("Business HTML bytes exceed the assembly budget.", ["pages"]);

    const assembledMs = Date.parse(request.assembledAt);
    const oldest = Math.min(...evidenceTimes);
    const newest = Math.max(...evidenceTimes);
    if (newest > assembledMs) addIssue("Audit evidence cannot be captured after assembly time.", ["assembledAt"]);
    if (assembledMs - oldest > request.policy.maxEvidenceAgeHours * 60 * 60 * 1_000) {
      addIssue("Audit evidence is older than the approved freshness window.", ["assembledAt"]);
    }
    if (newest - oldest > request.policy.maxCaptureSkewMinutes * 60 * 1_000) {
      addIssue("Audit evidence exceeds the approved cross-page capture window.", ["pages"]);
    }

    for (const [probeIndex, probe] of request.resourceProbes.entries()) {
      try {
        const url = canonicalPublicUrl(probe.url);
        if (probe.internal && authority && siteAuthority(url) !== authority) {
          addIssue("An internal resource probe must remain on the homepage authority.", ["resourceProbes", probeIndex, "url"]);
        }
      } catch (error) {
        addIssue(error instanceof Error ? error.message : "Resource probe URL is not public.", ["resourceProbes", probeIndex, "url"]);
      }
    }
  });

export type WebsiteAuditAssemblyRequest = z.infer<typeof WebsiteAuditAssemblyRequestSchema>;

const WebsiteAuditPageReceiptSchema = z
  .object({
    pageKind: WebsitePageKindSchema,
    requestedUrl: z.string().url(),
    outcome: z.enum(["CAPTURED", "FAILED", "REJECTED"]),
    finalUrl: z.string().url().nullable(),
    contentComplete: z.boolean(),
    desktopCaptured: z.boolean(),
    mobileCaptured: z.boolean(),
    browserMsUsed: z.number().int().nonnegative().max(WEBSITE_AUDIT_MAX_BROWSER_MS),
    artifactBytes: z.number().int().nonnegative().max(WEBSITE_AUDIT_MAX_ARTIFACT_BYTES),
    warnings: z.array(z.string().trim().min(1).max(180)).max(100),
  })
  .strict();

export const WebsiteAuditAssemblySchema = z
  .object({
    assemblyVersion: z.literal(WEBSITE_AUDIT_ASSEMBLY_VERSION),
    assemblyId: z.string().uuid(),
    workflowId: z.string().uuid(),
    assembledAt: z.string().datetime({ offset: true }),
    mode: z.literal("SHADOW"),
    assemblerKind: z.literal("FIXTURE"),
    status: z.enum(["READY", "PARTIAL"]),
    pageSetComplete: z.boolean(),
    missingRequiredPageKinds: z.array(WebsitePageKindSchema).max(REQUIRED_PAGE_KINDS.length),
    incompleteRequiredPageKinds: z.array(WebsitePageKindSchema).max(REQUIRED_PAGE_KINDS.length),
    evidenceWindow: z.object({
      startedAt: z.string().datetime({ offset: true }),
      endedAt: z.string().datetime({ offset: true }),
    }).strict(),
    budget: z.object({
      maxCostUsd: z.literal(0),
      totalCostUsd: z.literal(0),
      providerOperations: z.literal(0),
      htmlBytes: z.number().int().nonnegative().max(WEBSITE_AUDIT_MAX_HTML_BYTES),
      browserCaptures: z.number().int().nonnegative().max(WEBSITE_AUDIT_MAX_BROWSER_CAPTURES),
      browserMsUsed: z.number().int().nonnegative().max(WEBSITE_AUDIT_MAX_BROWSER_MS),
      artifactBytes: z.number().int().nonnegative().max(WEBSITE_AUDIT_MAX_ARTIFACT_BYTES),
    }).strict(),
    pages: z.array(WebsiteAuditPageReceiptSchema).min(1).max(WEBSITE_AUDIT_MAX_PAGES),
    auditInput: DeterministicWebsiteAuditInputSchema,
    warnings: z.array(z.string().trim().min(1).max(180)).max(200),
  })
  .strict()
  .superRefine((assembly, context) => {
    if (assembly.pageSetComplete !== (assembly.status === "READY")) {
      context.addIssue({ code: "custom", message: "Only a complete page set can be ready for a full audit.", path: ["status"] });
    }
    if (assembly.auditInput.pageSetComplete !== assembly.pageSetComplete) {
      context.addIssue({ code: "custom", message: "Audit input completeness must match the assembly receipt.", path: ["auditInput", "pageSetComplete"] });
    }
  });

export type WebsiteAuditAssembly = z.infer<typeof WebsiteAuditAssemblySchema>;

const PAGE_ORDER: Record<z.infer<typeof WebsitePageKindSchema>, number> = {
  HOME: 0,
  SERVICE: 1,
  ABOUT: 2,
  CONTACT: 3,
  OTHER: 4,
};

function pageIsComplete(merged: MergedBrowserPageEvidence | null) {
  return Boolean(
    merged
    && merged.page.contentComplete
    && merged.page.evidenceCoverage.desktopRenderCaptured
    && merged.page.evidenceCoverage.actionVisibilityComplete
    && merged.page.evidenceCoverage.formVisibilityComplete,
  );
}

export function assembleWebsiteAuditInput(value: unknown): WebsiteAuditAssembly {
  const request = WebsiteAuditAssemblyRequestSchema.parse(value);
  const mergedPages: Array<{ input: WebsiteAuditAssemblyRequest["pages"][number]; merged: MergedBrowserPageEvidence | null }> = [];
  const warnings = new Set<string>();
  const evidenceTimes: number[] = [];
  let htmlBytes = 0;
  let browserCaptures = 0;
  let browserMsUsed = 0;
  let artifactBytes = 0;

  for (const page of request.pages) {
    evidenceTimes.push(Date.parse(page.capture.capturedAt));
    if (page.capture.outcome !== "CAPTURED" || !page.html) {
      warnings.add(`page_unavailable:${page.pageKind}:${page.capture.failure?.code || page.capture.outcome}`);
      mergedPages.push({ input: page, merged: null });
      continue;
    }
    htmlBytes += page.capture.bodyBytes;
    for (const evidence of page.browser) {
      browserCaptures += 1;
      browserMsUsed += evidence.browserMsUsed;
      evidenceTimes.push(Date.parse(evidence.capturedAt));
    }
    for (const receipt of page.artifactReceipts) {
      artifactBytes += receipt.items.reduce((sum, item) => sum + item.byteLength, 0);
      evidenceTimes.push(Date.parse(receipt.startedAt));
      evidenceTimes.push(Date.parse(receipt.completedAt));
      evidenceTimes.push(...receipt.items.map((item) => Date.parse(item.uploadedAt)));
    }
    const merged = mergeHtmlPageWithBrowserEvidence({
      businessId: request.businessId,
      html: page.html,
      browser: page.browser,
    });
    for (const warning of merged.warnings) {
      if (page.pageKind !== "HOME" && warning === "mobile:unavailable") continue;
      warnings.add(`${page.pageKind}:${warning}`);
    }
    if (!pageIsComplete(merged)) warnings.add(`page_incomplete:${page.pageKind}`);
    mergedPages.push({ input: page, merged });
  }

  const capturedByKind = new Map<z.infer<typeof WebsitePageKindSchema>, MergedBrowserPageEvidence[]>();
  for (const page of mergedPages) {
    if (!page.merged) continue;
    const current = capturedByKind.get(page.input.pageKind) || [];
    current.push(page.merged);
    capturedByKind.set(page.input.pageKind, current);
  }
  const missingRequiredPageKinds = REQUIRED_PAGE_KINDS.filter((kind) => (capturedByKind.get(kind) || []).length === 0);
  const incompleteRequiredPageKinds = REQUIRED_PAGE_KINDS.filter((kind) => {
    const candidates = capturedByKind.get(kind) || [];
    return candidates.length > 0 && !candidates.some(pageIsComplete);
  });
  for (const kind of missingRequiredPageKinds) warnings.add(`missing_required_page:${kind}`);
  for (const kind of incompleteRequiredPageKinds) warnings.add(`incomplete_required_page:${kind}`);

  const homeEntry = mergedPages.find((page) => page.input.pageKind === "HOME" && page.merged);
  if (!homeEntry?.merged || homeEntry.input.capture.outcome !== "CAPTURED") {
    throw new Error("Validated website audit assembly lost its required homepage.");
  }
  const home = homeEntry.merged;
  const capturedHomeMobile = homeEntry.input.browser.find(
    (evidence) => evidence.profile === "MOBILE_390X844" && evidence.outcome === "CAPTURED",
  );
  const homeMobileComplete = home.mobile.captured
    && home.mobile.horizontalOverflow !== null
    && home.mobile.navigationUsable !== null
    && home.mobile.textReadable !== null
    && home.mobile.minimumTapTargetPx !== null
    && Boolean(
      capturedHomeMobile
      && capturedHomeMobile.coverage.layoutComplete
      && capturedHomeMobile.coverage.actionsComplete
      && capturedHomeMobile.coverage.formsComplete
      && capturedHomeMobile.coverage.navigationComplete
      && capturedHomeMobile.coverage.textComplete,
    );
  if (!homeMobileComplete) warnings.add("homepage_mobile_incomplete");
  const everySelectedPageComplete = mergedPages.every((page) => pageIsComplete(page.merged));
  const pageSetComplete = missingRequiredPageKinds.length === 0
    && incompleteRequiredPageKinds.length === 0
    && everySelectedPageComplete
    && homeMobileComplete;

  const pages = mergedPages
    .filter((page): page is { input: WebsiteAuditAssemblyRequest["pages"][number]; merged: MergedBrowserPageEvidence } => Boolean(page.merged))
    .sort((left, right) => PAGE_ORDER[left.input.pageKind] - PAGE_ORDER[right.input.pageKind]
      || left.merged.page.url.localeCompare(right.merged.page.url, "en-CA"));
  const pageReceipts = mergedPages
    .map(({ input, merged }) => WebsiteAuditPageReceiptSchema.parse({
      pageKind: input.pageKind,
      requestedUrl: input.capture.requestedUrl!,
      outcome: input.capture.outcome,
      finalUrl: input.capture.finalUrl,
      contentComplete: Boolean(merged?.page.contentComplete),
      desktopCaptured: Boolean(merged?.page.evidenceCoverage.desktopRenderCaptured),
      mobileCaptured: Boolean(merged?.mobile.captured),
      browserMsUsed: input.browser.reduce((sum, evidence) => sum + evidence.browserMsUsed, 0),
      artifactBytes: input.artifactReceipts.reduce(
        (sum, receipt) => sum + receipt.items.reduce((itemSum, item) => itemSum + item.byteLength, 0),
        0,
      ),
      warnings: merged
        ? merged.warnings.filter((warning) => input.pageKind === "HOME" || warning !== "mobile:unavailable")
        : [input.capture.failure?.code || input.capture.outcome],
    }))
    .sort((left, right) => PAGE_ORDER[left.pageKind] - PAGE_ORDER[right.pageKind]
      || left.requestedUrl.localeCompare(right.requestedUrl, "en-CA"));

  const oldest = new Date(Math.min(...evidenceTimes)).toISOString();
  const newest = new Date(Math.max(...evidenceTimes)).toISOString();
  const auditInput: DeterministicWebsiteAuditInput = DeterministicWebsiteAuditInputSchema.parse({
    businessId: request.businessId,
    businessName: request.businessName,
    niche: request.niche,
    expectedServices: request.expectedServices,
    expectedLocations: request.expectedLocations,
    sourceEvidenceUrl: request.sourceEvidenceUrl,
    siteState: "CAPTURED",
    requestedUrl: homeEntry.input.capture.requestedUrl,
    finalUrl: homeEntry.input.capture.finalUrl,
    statusCode: homeEntry.input.capture.statusCode,
    redirectCount: homeEntry.input.capture.redirectCount,
    capturedAt: oldest,
    desktopArtifactRef: home.desktopArtifactRef,
    mobileArtifactRef: home.mobileArtifactRef,
    domArtifactRef: home.desktopMeasurementArtifactRef,
    pageSetComplete,
    pages: pages.map((page) => page.merged.page),
    resourceProbes: request.resourceProbes,
    mobile: home.mobile,
  });

  return WebsiteAuditAssemblySchema.parse({
    assemblyVersion: WEBSITE_AUDIT_ASSEMBLY_VERSION,
    assemblyId: request.assemblyId,
    workflowId: request.workflowId,
    assembledAt: request.assembledAt,
    mode: request.mode,
    assemblerKind: request.assemblerKind,
    status: pageSetComplete ? "READY" : "PARTIAL",
    pageSetComplete,
    missingRequiredPageKinds,
    incompleteRequiredPageKinds,
    evidenceWindow: { startedAt: oldest, endedAt: newest },
    budget: {
      maxCostUsd: 0,
      totalCostUsd: 0,
      providerOperations: 0,
      htmlBytes,
      browserCaptures,
      browserMsUsed,
      artifactBytes,
    },
    pages: pageReceipts,
    auditInput,
    warnings: [...warnings].sort((left, right) => left.localeCompare(right, "en-CA")),
  });
}
