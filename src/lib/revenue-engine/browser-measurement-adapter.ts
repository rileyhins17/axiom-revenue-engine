import { createHash } from "node:crypto";

import { z } from "zod";

import {
  BROWSER_PAGE_EVIDENCE_VERSION,
  BROWSER_PAGE_MEASUREMENT_VERSION,
  BrowserActionMeasurementSchema,
  BrowserDocumentMeasurementSchema,
  BrowserFormMeasurementSchema,
  BrowserNavigationMeasurementSchema,
  BrowserNetworkReceiptSchema,
  BrowserPageEvidenceSchema,
  BrowserTextMeasurementSchema,
  BrowserViewportProfileSchema,
  BrowserViewportSchema,
  type BrowserPageEvidence,
} from "@/lib/revenue-engine/browser-page-evidence";
import { normalizePublicWebsiteUrl } from "@/lib/revenue-engine/public-website-url";
import { WebsitePageKindSchema } from "@/lib/revenue-engine/website-audit";

export const BROWSER_MEASUREMENT_ADAPTER_VERSION = "browser-measurement-adapter-v1";
export const BROWSER_MEASUREMENT_DRAFT_VERSION = "browser-measurement-draft-v1";
export const BROWSER_MEASUREMENT_MAX_REDIRECTS = 5;
export const BROWSER_MEASUREMENT_MAX_SCREENSHOT_BYTES = 5_242_880;
export const BROWSER_MEASUREMENT_MAX_JSON_BYTES = 1_048_576;
export const BROWSER_MEASUREMENT_MAX_BROWSER_MS = 20_000;

const BrowserMeasurementPolicySchema = z
  .object({
    maxRedirects: z.literal(BROWSER_MEASUREMENT_MAX_REDIRECTS),
    navigationTimeoutMs: z.literal(15_000),
    actionTimeoutMs: z.literal(5_000),
    maxBrowserMs: z.literal(BROWSER_MEASUREMENT_MAX_BROWSER_MS),
    maxScreenshotBytes: z.literal(BROWSER_MEASUREMENT_MAX_SCREENSHOT_BYTES),
    maxMeasurementJsonBytes: z.literal(BROWSER_MEASUREMENT_MAX_JSON_BYTES),
    maxRequestsObserved: z.literal(1_000),
    javaScriptEnabled: z.literal(true),
    serviceWorkersBlocked: z.literal(true),
    cacheDisabled: z.literal(true),
  })
  .strict();

export const BrowserMeasurementRequestSchema = z
  .object({
    adapterVersion: z.literal(BROWSER_MEASUREMENT_ADAPTER_VERSION),
    requestId: z.string().uuid(),
    workflowId: z.string().uuid(),
    businessId: z.string().trim().min(1).max(128),
    pageKind: WebsitePageKindSchema,
    requestedUrl: z.string().url(),
    profile: BrowserViewportProfileSchema,
    viewport: BrowserViewportSchema,
    requestedAt: z.string().datetime({ offset: true }),
    mode: z.literal("SHADOW"),
    runnerKind: z.literal("FIXTURE"),
    maxCostUsd: z.literal(0),
    artifactWriteAuthorized: z.literal(false),
    policy: BrowserMeasurementPolicySchema,
  })
  .strict()
  .superRefine((request, context) => {
    try {
      if (normalizePublicWebsiteUrl(request.requestedUrl) !== request.requestedUrl) {
        context.addIssue({
          code: "custom",
          message: "Browser measurement URLs must already be canonical public URLs.",
          path: ["requestedUrl"],
        });
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Browser measurement URL is not public.",
        path: ["requestedUrl"],
      });
    }
    const expected = request.profile === "DESKTOP_1440X900"
      ? { width: 1_440, height: 900, isMobile: false, hasTouch: false }
      : { width: 390, height: 844, isMobile: true, hasTouch: true };
    for (const field of ["width", "height", "isMobile", "hasTouch"] as const) {
      if (request.viewport[field] !== expected[field]) {
        context.addIssue({
          code: "custom",
          message: `${request.profile} requires its fixed comparison viewport.`,
          path: ["viewport", field],
        });
      }
    }
  });

export type BrowserMeasurementRequest = z.infer<typeof BrowserMeasurementRequestSchema>;

const BrowserMeasurementFieldsSchema = z
  .object({
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
  })
  .strict();

const RawBrowserResultBaseSchema = z.object({
  provider: z.literal("CLOUDFLARE_BROWSER_RENDERING"),
  providerRequestId: z.string().trim().min(1).max(200).nullable(),
  browserMsUsed: z.number().int().nonnegative().max(120_000),
  networkPolicy: BrowserNetworkReceiptSchema,
  warnings: z.array(z.string().trim().min(1).max(120)).max(20),
});

const ScreenshotBytesSchema = z.custom<Uint8Array>(
  (value) => value instanceof Uint8Array,
  "Screenshot payload must be a Uint8Array.",
);

export const RawBrowserMeasurementResultSchema = z.discriminatedUnion("outcome", [
  RawBrowserResultBaseSchema.extend({
    outcome: z.literal("CAPTURED"),
    finalUrl: z.string().url(),
    redirectChain: z.array(z.string().url()).min(1).max(BROWSER_MEASUREMENT_MAX_REDIRECTS + 1),
    screenshotMediaType: z.literal("image/webp"),
    screenshotBytes: ScreenshotBytesSchema,
    measurements: BrowserMeasurementFieldsSchema,
    failure: z.null(),
  }).strict(),
  RawBrowserResultBaseSchema.extend({
    outcome: z.enum(["FAILED", "REJECTED"]),
    finalUrl: z.string().url().nullable(),
    redirectChain: z.array(z.string().url()).min(1).max(BROWSER_MEASUREMENT_MAX_REDIRECTS + 1),
    screenshotMediaType: z.null(),
    screenshotBytes: z.null(),
    measurements: z.null(),
    failure: z
      .object({
        code: z.enum(["URL_REJECTED", "NAVIGATION_FAILED", "TIMEOUT", "RATE_LIMITED", "CAPTURE_FAILED", "MEASUREMENT_FAILED"]),
        message: z.string().trim().min(1).max(200),
      })
      .strict(),
  }).strict(),
]);

export type RawBrowserMeasurementResult = z.infer<typeof RawBrowserMeasurementResultSchema>;

const BytesSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array, "Artifact bytes must be a Uint8Array.");

export const BrowserMeasurementDraftSchema = z.discriminatedUnion("outcome", [
  z.object({
    draftVersion: z.literal(BROWSER_MEASUREMENT_DRAFT_VERSION),
    request: BrowserMeasurementRequestSchema,
    outcome: z.literal("CAPTURED"),
    finalUrl: z.string().url(),
    capturedAt: z.string().datetime({ offset: true }),
    provider: z.literal("CLOUDFLARE_BROWSER_RENDERING"),
    providerRequestId: z.string().trim().min(1).max(200).nullable(),
    browserMsUsed: z.number().int().nonnegative().max(BROWSER_MEASUREMENT_MAX_BROWSER_MS),
    networkPolicy: BrowserNetworkReceiptSchema,
    screenshot: z.object({
      mediaType: z.literal("image/webp"),
      bytes: BytesSchema,
      byteLength: z.number().int().positive().max(BROWSER_MEASUREMENT_MAX_SCREENSHOT_BYTES),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
    measurement: z.object({
      mediaType: z.literal("application/json"),
      bytes: BytesSchema,
      byteLength: z.number().int().positive().max(BROWSER_MEASUREMENT_MAX_JSON_BYTES),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      value: BrowserMeasurementFieldsSchema,
    }).strict(),
    warnings: z.array(z.string().trim().min(1).max(120)).max(20),
    costUsd: z.literal(0),
    artifactWriteAuthorized: z.literal(false),
    failure: z.null(),
  }).strict(),
  z.object({
    draftVersion: z.literal(BROWSER_MEASUREMENT_DRAFT_VERSION),
    request: BrowserMeasurementRequestSchema,
    outcome: z.enum(["FAILED", "REJECTED"]),
    finalUrl: z.string().url().nullable(),
    capturedAt: z.string().datetime({ offset: true }),
    provider: z.literal("CLOUDFLARE_BROWSER_RENDERING"),
    providerRequestId: z.string().trim().min(1).max(200).nullable(),
    browserMsUsed: z.number().int().nonnegative().max(BROWSER_MEASUREMENT_MAX_BROWSER_MS),
    networkPolicy: BrowserNetworkReceiptSchema,
    screenshot: z.null(),
    measurement: z.null(),
    warnings: z.array(z.string().trim().min(1).max(120)).max(20),
    costUsd: z.literal(0),
    artifactWriteAuthorized: z.literal(false),
    failure: z.object({
      code: z.enum(["URL_REJECTED", "NAVIGATION_FAILED", "TIMEOUT", "RATE_LIMITED", "CAPTURE_FAILED", "MEASUREMENT_FAILED"]),
      message: z.string().trim().min(1).max(200),
    }).strict(),
  }).strict(),
]);

export type BrowserMeasurementDraft = z.infer<typeof BrowserMeasurementDraftSchema>;

export interface BrowserMeasurementRunner {
  kind: "FIXTURE";
  run(request: BrowserMeasurementRequest): Promise<unknown>;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function validateDraftArtifactIntegrity(draft: Extract<BrowserMeasurementDraft, { outcome: "CAPTURED" }>) {
  const measurementBytes = new TextEncoder().encode(JSON.stringify(canonicalValue(draft.measurement.value)));
  const screenshotValid = draft.screenshot.byteLength === draft.screenshot.bytes.byteLength
    && draft.screenshot.sha256 === sha256(draft.screenshot.bytes);
  const measurementValid = draft.measurement.byteLength === draft.measurement.bytes.byteLength
    && draft.measurement.byteLength === measurementBytes.byteLength
    && equalBytes(draft.measurement.bytes, measurementBytes)
    && draft.measurement.sha256 === sha256(measurementBytes);
  if (!screenshotValid || !measurementValid) {
    throw new Error("Browser measurement draft artifact integrity check failed.");
  }
}

function publicCanonicalUrl(value: string) {
  const normalized = normalizePublicWebsiteUrl(value);
  if (normalized !== value) throw new Error("Browser runner returned a non-canonical public URL.");
  return normalized;
}

function validateNetworkAndRedirects(
  request: BrowserMeasurementRequest,
  raw: RawBrowserMeasurementResult,
) {
  if (raw.browserMsUsed > request.policy.maxBrowserMs) {
    throw new Error("Browser runner exceeded the request browser-time limit.");
  }
  if (raw.networkPolicy.requestsObserved > request.policy.maxRequestsObserved) {
    throw new Error("Browser runner exceeded the observed-request limit.");
  }
  const redirectChain = raw.redirectChain.map(publicCanonicalUrl);
  const documentUrls = raw.networkPolicy.documentUrls.map(publicCanonicalUrl);
  if (redirectChain[0] !== request.requestedUrl || documentUrls[0] !== request.requestedUrl) {
    throw new Error("Browser runner did not begin at the authorized public URL.");
  }
  if (redirectChain.length - 1 > request.policy.maxRedirects) {
    throw new Error("Browser runner exceeded the redirect limit.");
  }
  if (redirectChain.length !== documentUrls.length || redirectChain.some((url, index) => url !== documentUrls[index])) {
    throw new Error("Browser runner document navigation does not match its validated redirect receipt.");
  }
  if (raw.finalUrl && redirectChain.at(-1) !== publicCanonicalUrl(raw.finalUrl)) {
    throw new Error("Browser runner final URL does not match the validated redirect chain.");
  }
}

export async function createBrowserMeasurementDraft(
  value: BrowserMeasurementRequest,
  dependencies: { runner: BrowserMeasurementRunner; now?: () => Date },
): Promise<BrowserMeasurementDraft> {
  const request = BrowserMeasurementRequestSchema.parse(value);
  if (dependencies.runner.kind !== "FIXTURE") {
    throw new Error("Browser measurement adapter version 1 accepts fixture runners only.");
  }
  const raw = RawBrowserMeasurementResultSchema.parse(await dependencies.runner.run(request));
  validateNetworkAndRedirects(request, raw);
  const capturedAt = (dependencies.now || (() => new Date()))().toISOString();

  if (raw.outcome !== "CAPTURED") {
    return BrowserMeasurementDraftSchema.parse({
      draftVersion: BROWSER_MEASUREMENT_DRAFT_VERSION,
      request,
      outcome: raw.outcome,
      finalUrl: raw.finalUrl,
      capturedAt,
      provider: raw.provider,
      providerRequestId: raw.providerRequestId,
      browserMsUsed: raw.browserMsUsed,
      networkPolicy: raw.networkPolicy,
      screenshot: null,
      measurement: null,
      warnings: raw.warnings,
      costUsd: 0,
      artifactWriteAuthorized: false,
      failure: raw.failure,
    });
  }

  if (raw.screenshotBytes.byteLength === 0 || raw.screenshotBytes.byteLength > request.policy.maxScreenshotBytes) {
    throw new Error("Browser screenshot payload is empty or exceeds its byte limit.");
  }
  const measurementBytes = new TextEncoder().encode(JSON.stringify(canonicalValue(raw.measurements)));
  if (measurementBytes.byteLength === 0 || measurementBytes.byteLength > request.policy.maxMeasurementJsonBytes) {
    throw new Error("Browser measurement payload is empty or exceeds its byte limit.");
  }

  return BrowserMeasurementDraftSchema.parse({
    draftVersion: BROWSER_MEASUREMENT_DRAFT_VERSION,
    request,
    outcome: "CAPTURED",
    finalUrl: raw.finalUrl,
    capturedAt,
    provider: raw.provider,
    providerRequestId: raw.providerRequestId,
    browserMsUsed: raw.browserMsUsed,
    networkPolicy: raw.networkPolicy,
    screenshot: {
      mediaType: raw.screenshotMediaType,
      bytes: raw.screenshotBytes,
      byteLength: raw.screenshotBytes.byteLength,
      sha256: sha256(raw.screenshotBytes),
    },
    measurement: {
      mediaType: "application/json",
      bytes: measurementBytes,
      byteLength: measurementBytes.byteLength,
      sha256: sha256(measurementBytes),
      value: raw.measurements,
    },
    warnings: raw.warnings,
    costUsd: 0,
    artifactWriteAuthorized: false,
    failure: null,
  });
}

export function finalizeBrowserMeasurementDraft(
  value: BrowserMeasurementDraft,
  artifactRefs: { screenshotArtifactRef: string; measurementArtifactRef: string } | null,
): BrowserPageEvidence {
  const draft = BrowserMeasurementDraftSchema.parse(value);
  if (draft.outcome !== "CAPTURED") {
    if (artifactRefs) throw new Error("Failed browser measurements cannot receive successful artifact references.");
    return BrowserPageEvidenceSchema.parse({
      evidenceVersion: BROWSER_PAGE_EVIDENCE_VERSION,
      measurementVersion: BROWSER_PAGE_MEASUREMENT_VERSION,
      captureId: draft.request.requestId,
      businessId: draft.request.businessId,
      pageKind: draft.request.pageKind,
      requestedUrl: draft.request.requestedUrl,
      profile: draft.request.profile,
      viewport: draft.request.viewport,
      capturedAt: draft.capturedAt,
      provider: draft.provider,
      providerRequestId: draft.providerRequestId,
      browserMsUsed: draft.browserMsUsed,
      networkPolicy: draft.networkPolicy,
      warnings: draft.warnings,
      outcome: draft.outcome,
      finalUrl: draft.finalUrl,
      screenshotArtifactRef: null,
      screenshotSha256: null,
      measurementArtifactRef: null,
      document: null,
      actions: [],
      forms: [],
      navigation: null,
      text: null,
      coverage: {
        layoutComplete: false,
        actionsComplete: false,
        formsComplete: false,
        navigationComplete: false,
        textComplete: false,
      },
      failure: draft.failure,
    });
  }
  if (!artifactRefs) throw new Error("Captured browser measurements require both persisted artifact references.");
  validateDraftArtifactIntegrity(draft);
  if (
    artifactRefs.screenshotArtifactRef !== `artifact:sha256:${draft.screenshot.sha256}`
    || artifactRefs.measurementArtifactRef !== `artifact:sha256:${draft.measurement.sha256}`
  ) {
    throw new Error("Persisted browser artifact references must match the draft content hashes.");
  }
  return BrowserPageEvidenceSchema.parse({
    evidenceVersion: BROWSER_PAGE_EVIDENCE_VERSION,
    measurementVersion: BROWSER_PAGE_MEASUREMENT_VERSION,
    captureId: draft.request.requestId,
    businessId: draft.request.businessId,
    pageKind: draft.request.pageKind,
    requestedUrl: draft.request.requestedUrl,
    profile: draft.request.profile,
    viewport: draft.request.viewport,
    capturedAt: draft.capturedAt,
    provider: draft.provider,
    providerRequestId: draft.providerRequestId,
    browserMsUsed: draft.browserMsUsed,
    networkPolicy: draft.networkPolicy,
    warnings: draft.warnings,
    outcome: "CAPTURED",
    finalUrl: draft.finalUrl,
    screenshotArtifactRef: artifactRefs.screenshotArtifactRef,
    screenshotSha256: draft.screenshot.sha256,
    measurementArtifactRef: artifactRefs.measurementArtifactRef,
    document: draft.measurement.value.document,
    actions: draft.measurement.value.actions,
    forms: draft.measurement.value.forms,
    navigation: draft.measurement.value.navigation,
    text: draft.measurement.value.text,
    coverage: draft.measurement.value.coverage,
    failure: null,
  });
}

export function defaultBrowserMeasurementPolicy() {
  return BrowserMeasurementPolicySchema.parse({
    maxRedirects: BROWSER_MEASUREMENT_MAX_REDIRECTS,
    navigationTimeoutMs: 15_000,
    actionTimeoutMs: 5_000,
    maxBrowserMs: BROWSER_MEASUREMENT_MAX_BROWSER_MS,
    maxScreenshotBytes: BROWSER_MEASUREMENT_MAX_SCREENSHOT_BYTES,
    maxMeasurementJsonBytes: BROWSER_MEASUREMENT_MAX_JSON_BYTES,
    maxRequestsObserved: 1_000,
    javaScriptEnabled: true,
    serviceWorkersBlocked: true,
    cacheDisabled: true,
  });
}
