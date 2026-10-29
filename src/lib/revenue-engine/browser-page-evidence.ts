import { z } from "zod";

import { HtmlPageFactsSchema, type HtmlPageFacts } from "@/lib/revenue-engine/html-page-facts";
import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";
import {
  MobileSnapshotSchema,
  WebsiteActionKindSchema,
  WebsitePageKindSchema,
  WebsitePageSnapshotSchema,
} from "@/lib/revenue-engine/website-audit";

export const BROWSER_PAGE_EVIDENCE_VERSION = "browser-page-evidence-v1";
export const BROWSER_PAGE_MEASUREMENT_VERSION = "browser-page-measurement-v1";
export const BROWSER_HTML_MERGE_VERSION = "browser-html-merge-v1";
export const BROWSER_NETWORK_POLICY_VERSION = "browser-network-policy-v1";

export const BrowserViewportProfileSchema = z.enum([
  "DESKTOP_1440X900",
  "MOBILE_390X844",
]);

export const BrowserViewportSchema = z
  .object({
    width: z.number().int().min(320).max(2_560),
    height: z.number().int().min(480).max(2_000),
    deviceScaleFactor: z.literal(1),
    isMobile: z.boolean(),
    hasTouch: z.boolean(),
  })
  .strict();

export const BrowserNetworkReceiptSchema = z
  .object({
    policyVersion: z.literal(BROWSER_NETWORK_POLICY_VERSION),
    requestInterceptionEnabled: z.literal(true),
    allRequestUrlsValidated: z.literal(true),
    privateNetworkRequestsAllowed: z.literal(0),
    credentialsUsed: z.literal(false),
    formSubmissions: z.literal(0),
    downloadsAccepted: z.literal(0),
    requestsObserved: z.number().int().nonnegative().max(1_000),
    requestsBlocked: z.number().int().nonnegative().max(1_000),
    documentUrls: z.array(z.string().url()).min(1).max(6),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.requestsBlocked > receipt.requestsObserved) {
      context.addIssue({
        code: "custom",
        message: "Blocked browser requests cannot exceed observed requests.",
        path: ["requestsBlocked"],
      });
    }
  });

export const BrowserBoundingBoxSchema = z
  .object({
    x: z.number().finite().min(-10_000).max(100_000),
    y: z.number().finite().min(-10_000).max(1_000_000),
    width: z.number().finite().positive().max(100_000),
    height: z.number().finite().positive().max(100_000),
  })
  .strict();

export const BrowserActionMeasurementSchema = z
  .object({
    actionId: z.string().trim().min(1).max(160),
    kind: WebsiteActionKindSchema,
    label: z.string().trim().min(1).max(120),
    href: z.string().trim().max(2_048).nullable(),
    visible: z.boolean(),
    enabled: z.boolean(),
    boundingBox: BrowserBoundingBoxSchema.nullable(),
  })
  .strict()
  .superRefine((action, context) => {
    if (action.visible !== Boolean(action.boundingBox)) {
      context.addIssue({
        code: "custom",
        message: "A visible browser action requires a measured box, while a hidden action cannot retain one.",
        path: ["boundingBox"],
      });
    }
  });

export const BrowserFormMeasurementSchema = z
  .object({
    formId: z.string().trim().min(1).max(160),
    actionUrl: z.string().url().nullable(),
    method: z.enum(["GET", "POST", "OTHER"]),
    visible: z.boolean(),
    hasSubmitControl: z.boolean(),
    disabled: z.boolean(),
    boundingBox: BrowserBoundingBoxSchema.nullable(),
  })
  .strict()
  .superRefine((form, context) => {
    if (form.visible !== Boolean(form.boundingBox)) {
      context.addIssue({
        code: "custom",
        message: "A visible browser form requires a measured box, while a hidden form cannot retain one.",
        path: ["boundingBox"],
      });
    }
  });

export const BrowserDocumentMeasurementSchema = z
  .object({
    clientWidth: z.number().int().positive().max(100_000),
    documentScrollWidth: z.number().int().positive().max(100_000),
    bodyScrollWidth: z.number().int().nonnegative().max(100_000),
  })
  .strict();

export const BrowserNavigationMeasurementSchema = z
  .object({
    status: z.enum(["USABLE", "UNUSABLE", "UNKNOWN"]),
    probePerformed: z.boolean(),
    reasonCodes: z.array(z.string().trim().min(1).max(80)).max(10),
  })
  .strict();

export const BrowserTextMeasurementSchema = z
  .object({
    readable: z.boolean().nullable(),
    minimumFontSizePx: z.number().finite().positive().max(200).nullable(),
    measuredTextNodes: z.number().int().nonnegative().max(100_000),
  })
  .strict();

const BrowserEvidenceBaseSchema = z.object({
  evidenceVersion: z.literal(BROWSER_PAGE_EVIDENCE_VERSION),
  measurementVersion: z.literal(BROWSER_PAGE_MEASUREMENT_VERSION),
  captureId: z.string().trim().min(8).max(160),
  businessId: z.string().trim().min(1).max(128),
  pageKind: WebsitePageKindSchema,
  requestedUrl: z.string().url(),
  profile: BrowserViewportProfileSchema,
  viewport: BrowserViewportSchema,
  capturedAt: z.string().datetime({ offset: true }),
  provider: z.literal("CLOUDFLARE_BROWSER_RENDERING"),
  providerRequestId: z.string().trim().min(1).max(200).nullable(),
  browserMsUsed: z.number().int().nonnegative().max(120_000),
  networkPolicy: BrowserNetworkReceiptSchema,
  warnings: z.array(z.string().trim().min(1).max(120)).max(20),
});

const CapturedBrowserPageEvidenceSchema = BrowserEvidenceBaseSchema.extend({
  outcome: z.literal("CAPTURED"),
  finalUrl: z.string().url(),
  screenshotArtifactRef: z.string().trim().min(1).max(500),
  screenshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  measurementArtifactRef: z.string().trim().min(1).max(500),
  document: BrowserDocumentMeasurementSchema,
  actions: z.array(BrowserActionMeasurementSchema).max(100),
  forms: z.array(BrowserFormMeasurementSchema).max(30),
  navigation: BrowserNavigationMeasurementSchema,
  text: BrowserTextMeasurementSchema,
  coverage: z
    .object({
      layoutComplete: z.boolean(),
      actionsComplete: z.boolean(),
      formsComplete: z.boolean(),
      navigationComplete: z.boolean(),
      textComplete: z.boolean(),
    })
    .strict(),
  failure: z.null(),
}).strict();

const FailedBrowserPageEvidenceSchema = BrowserEvidenceBaseSchema.extend({
  outcome: z.enum(["FAILED", "REJECTED"]),
  finalUrl: z.string().url().nullable(),
  screenshotArtifactRef: z.null(),
  screenshotSha256: z.null(),
  measurementArtifactRef: z.null(),
  document: z.null(),
  actions: z.tuple([]),
  forms: z.tuple([]),
  navigation: z.null(),
  text: z.null(),
  coverage: z
    .object({
      layoutComplete: z.literal(false),
      actionsComplete: z.literal(false),
      formsComplete: z.literal(false),
      navigationComplete: z.literal(false),
      textComplete: z.literal(false),
    })
    .strict(),
  failure: z
    .object({
      code: z.enum(["URL_REJECTED", "NAVIGATION_FAILED", "TIMEOUT", "RATE_LIMITED", "CAPTURE_FAILED", "MEASUREMENT_FAILED"]),
      message: z.string().trim().min(1).max(200),
    })
    .strict(),
}).strict();

export const BrowserPageEvidenceSchema = z
  .discriminatedUnion("outcome", [CapturedBrowserPageEvidenceSchema, FailedBrowserPageEvidenceSchema])
  .superRefine((evidence, context) => {
    const expected = evidence.profile === "DESKTOP_1440X900"
      ? { width: 1_440, height: 900, isMobile: false, hasTouch: false }
      : { width: 390, height: 844, isMobile: true, hasTouch: true };
    for (const field of ["width", "height", "isMobile", "hasTouch"] as const) {
      if (evidence.viewport[field] !== expected[field]) {
        context.addIssue({
          code: "custom",
          message: `${evidence.profile} requires its fixed comparison viewport.`,
          path: ["viewport", field],
        });
      }
    }
    const urls: Array<{ path: Array<string | number>; value: string }> = [
      { path: ["requestedUrl"], value: evidence.requestedUrl },
      ...evidence.networkPolicy.documentUrls.map((value, index) => ({
        path: ["networkPolicy", "documentUrls", index],
        value,
      })),
    ];
    if (evidence.finalUrl) urls.push({ path: ["finalUrl"], value: evidence.finalUrl });
    for (const url of urls) {
      try {
        if (normalizePublicWebsiteUrl(url.value) !== url.value) {
          context.addIssue({
            code: "custom",
            message: "Browser evidence URLs must be canonical public URLs.",
            path: url.path,
          });
        }
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "Browser evidence URL is not public.",
          path: url.path,
        });
      }
    }
    if (evidence.outcome !== "CAPTURED") return;
    if (
      evidence.screenshotArtifactRef.toLocaleLowerCase("en-CA").startsWith("data:")
      || evidence.measurementArtifactRef.toLocaleLowerCase("en-CA").startsWith("data:")
    ) {
      context.addIssue({ code: "custom", message: "Browser artifacts must be references, not embedded data.", path: ["screenshotArtifactRef"] });
    }
    const actionIds = new Set(evidence.actions.map((action) => action.actionId));
    const formIds = new Set(evidence.forms.map((form) => form.formId));
    if (actionIds.size !== evidence.actions.length) {
      context.addIssue({ code: "custom", message: "Browser action IDs must be unique within a capture.", path: ["actions"] });
    }
    if (formIds.size !== evidence.forms.length) {
      context.addIssue({ code: "custom", message: "Browser form IDs must be unique within a capture.", path: ["forms"] });
    }
    if (evidence.coverage.navigationComplete && (!evidence.navigation.probePerformed || evidence.navigation.status === "UNKNOWN")) {
      context.addIssue({ code: "custom", message: "Complete navigation evidence requires a performed probe and a known result.", path: ["navigation"] });
    }
    if (evidence.coverage.textComplete && (
      evidence.text.readable === null
      || evidence.text.minimumFontSizePx === null
      || evidence.text.measuredTextNodes === 0
    )) {
      context.addIssue({ code: "custom", message: "Complete text evidence requires measured nodes, size, and readability.", path: ["text"] });
    }
    if (evidence.profile === "DESKTOP_1440X900" && (evidence.coverage.navigationComplete || evidence.coverage.textComplete)) {
      context.addIssue({ code: "custom", message: "Navigation and readability completion are mobile-only in version 1.", path: ["coverage"] });
    }
  });

export type BrowserPageEvidence = z.infer<typeof BrowserPageEvidenceSchema>;

export const MergedBrowserPageEvidenceSchema = z
  .object({
    mergeVersion: z.literal(BROWSER_HTML_MERGE_VERSION),
    businessId: z.string().trim().min(1).max(128),
    page: WebsitePageSnapshotSchema,
    desktopArtifactRef: z.string().trim().min(1).max(500).nullable(),
    mobileArtifactRef: z.string().trim().min(1).max(500).nullable(),
    desktopMeasurementArtifactRef: z.string().trim().min(1).max(500).nullable(),
    mobileMeasurementArtifactRef: z.string().trim().min(1).max(500).nullable(),
    mobile: MobileSnapshotSchema,
    warnings: z.array(z.string().trim().min(1).max(160)).max(50),
  })
  .strict();

export type MergedBrowserPageEvidence = z.infer<typeof MergedBrowserPageEvidenceSchema>;

function normalizedLabel(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-CA").replace(/\s+/g, " ").trim();
}

function normalizedHref(value: string | null, baseUrl: string) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value.trim().toLocaleLowerCase("en-CA");
  }
}

function actionKey(action: { kind: string; label: string; href: string | null }, baseUrl: string) {
  return `${action.kind}|${normalizedHref(action.href, baseUrl)}|${normalizedLabel(action.label)}`;
}

function formKey(form: { actionUrl: string | null; method?: string }, baseUrl: string) {
  return `${form.method || ""}|${normalizedHref(form.actionUrl, baseUrl)}`;
}

function isAboveFold(box: z.infer<typeof BrowserBoundingBoxSchema>, viewportHeight: number) {
  return box.y < viewportHeight && box.y + box.height > 0;
}

function canonicalUrl(value: string) {
  return new URL(value).href;
}

export function mergeHtmlPageWithBrowserEvidence(input: {
  businessId: string;
  html: HtmlPageFacts;
  browser: BrowserPageEvidence[];
}): MergedBrowserPageEvidence {
  const html = HtmlPageFactsSchema.parse(input.html);
  const browser = input.browser.map((item) => BrowserPageEvidenceSchema.parse(item));
  const profiles = new Set(browser.map((item) => item.profile));
  if (profiles.size !== browser.length) {
    throw new Error("Browser evidence can contain at most one result per fixed viewport profile.");
  }
  for (const evidence of browser) {
    if (evidence.businessId !== input.businessId || evidence.pageKind !== html.pageKind) {
      throw new Error("Browser evidence must belong to the same business and page kind as the HTML facts.");
    }
    if (evidence.outcome === "CAPTURED" && canonicalUrl(evidence.finalUrl) !== canonicalUrl(html.url)) {
      throw new Error("Browser evidence final URL must match the HTML page URL before facts can be merged.");
    }
  }

  const desktop = browser.find((item) => item.profile === "DESKTOP_1440X900");
  const mobile = browser.find((item) => item.profile === "MOBILE_390X844");
  const capturedDesktop = desktop?.outcome === "CAPTURED" ? desktop : null;
  const capturedMobile = mobile?.outcome === "CAPTURED" ? mobile : null;
  const desktopActions = new Map(
    (capturedDesktop?.actions || []).map((action) => [actionKey(action, html.url), action]),
  );
  const mergedActionKeys = new Set<string>();
  const actions = html.actions.map((action) => {
    const key = actionKey(action, html.url);
    mergedActionKeys.add(key);
    const measured = desktopActions.get(key);
    const visible = measured
      ? measured.visible
      : !action.notExplicitlyHidden || capturedDesktop?.coverage.actionsComplete ? false : null;
    return {
      kind: action.kind,
      label: action.label,
      href: action.href,
      visible,
      aboveFold: visible && measured?.boundingBox
        ? isAboveFold(measured.boundingBox, capturedDesktop!.viewport.height)
        : visible === false ? false : null,
    };
  });
  for (const action of capturedDesktop?.actions || []) {
    const key = actionKey(action, html.url);
    if (mergedActionKeys.has(key)) continue;
    actions.push({
      kind: action.kind,
      label: action.label,
      href: action.href,
      visible: action.visible,
      aboveFold: action.visible && action.boundingBox
        ? isAboveFold(action.boundingBox, capturedDesktop!.viewport.height)
        : false,
    });
  }

  const desktopForms = new Map(
    (capturedDesktop?.forms || []).map((form) => [formKey(form, html.url), form]),
  );
  const mergedFormKeys = new Set<string>();
  const forms = html.forms.map((form) => {
    const key = formKey(form, html.url);
    mergedFormKeys.add(key);
    const measured = desktopForms.get(key);
    return {
      visible: measured
        ? measured.visible
        : !form.notExplicitlyHidden || capturedDesktop?.coverage.formsComplete ? false : null,
      hasSubmitControl: measured?.hasSubmitControl ?? form.hasEnabledSubmitControl,
      disabled: measured?.disabled ?? !form.hasEnabledSubmitControl,
      actionUrl: form.actionUrl,
    };
  });
  for (const form of capturedDesktop?.forms || []) {
    const key = formKey(form, html.url);
    if (mergedFormKeys.has(key)) continue;
    forms.push({
      visible: form.visible,
      hasSubmitControl: form.hasSubmitControl,
      disabled: form.disabled,
      actionUrl: form.actionUrl,
    });
  }

  const visibleMobileTargets = capturedMobile?.coverage.actionsComplete
    ? capturedMobile.actions.filter((action) => action.visible && action.enabled && action.boundingBox)
    : [];
  const minimumTapTargetPx = visibleMobileTargets.length > 0
    ? Math.min(...visibleMobileTargets.map((action) => Math.min(action.boundingBox!.width, action.boundingBox!.height)))
    : null;

  const warnings = new Set(html.warnings.map((warning) => `html:${warning}`));
  if (!html.complete) warnings.add("html:incomplete");
  for (const evidence of browser) {
    for (const warning of evidence.warnings) warnings.add(`${evidence.profile.toLocaleLowerCase("en-CA")}:${warning}`);
    if (evidence.outcome !== "CAPTURED") warnings.add(`${evidence.profile.toLocaleLowerCase("en-CA")}:${evidence.failure.code}`);
  }
  if (!capturedDesktop) warnings.add("desktop:unavailable");
  if (!capturedMobile) warnings.add("mobile:unavailable");

  return MergedBrowserPageEvidenceSchema.parse({
    mergeVersion: BROWSER_HTML_MERGE_VERSION,
    businessId: input.businessId,
    page: {
      kind: html.pageKind,
      url: html.url,
      title: html.title,
      metaDescription: html.metaDescription,
      visibleText: html.visibleText,
      actions,
      forms,
      trustSignals: html.trustSignals,
      structuredDataTypes: html.structuredDataTypes,
      contentComplete: html.complete,
      evidenceCoverage: {
        desktopRenderCaptured: Boolean(capturedDesktop),
        actionVisibilityComplete: Boolean(capturedDesktop?.coverage.actionsComplete),
        formVisibilityComplete: Boolean(capturedDesktop?.coverage.formsComplete),
      },
    },
    desktopArtifactRef: capturedDesktop?.screenshotArtifactRef || null,
    mobileArtifactRef: capturedMobile?.screenshotArtifactRef || null,
    desktopMeasurementArtifactRef: capturedDesktop?.measurementArtifactRef || null,
    mobileMeasurementArtifactRef: capturedMobile?.measurementArtifactRef || null,
    mobile: {
      captured: Boolean(capturedMobile),
      horizontalOverflow: capturedMobile?.coverage.layoutComplete
        ? Math.max(capturedMobile.document.documentScrollWidth, capturedMobile.document.bodyScrollWidth)
          > capturedMobile.document.clientWidth + 1
        : null,
      navigationUsable: capturedMobile?.coverage.navigationComplete
        ? capturedMobile.navigation.status === "USABLE"
        : null,
      textReadable: capturedMobile?.coverage.textComplete ? capturedMobile.text.readable : null,
      minimumTapTargetPx,
    },
    warnings: [...warnings],
  });
}
