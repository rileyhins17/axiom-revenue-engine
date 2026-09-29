import { createHash } from "node:crypto";

import { z } from "zod";

import {
  PublicWebsiteUrlError,
  normalizePublicWebsiteUrl,
} from "@/lib/revenue-engine/public-website-url";

export const WEBSITE_CAPTURE_VERSION = "website-capture-v1";
export const WEBSITE_CAPTURE_MAX_REDIRECTS = 5;
export const WEBSITE_CAPTURE_MAX_RESPONSE_BYTES = 1_048_576;
export const WEBSITE_CAPTURE_TIMEOUT_MS = 10_000;
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const WebsiteCaptureFailureCodeSchema = z.enum([
  "INVALID_URL",
  "BLOCKED_URL",
  "BLOCKED_REDIRECT",
  "INVALID_REDIRECT",
  "REDIRECT_WITHOUT_LOCATION",
  "REDIRECT_LOOP",
  "TOO_MANY_REDIRECTS",
  "TIMEOUT",
  "FETCH_FAILED",
  "HTTP_STATUS",
  "UNSUPPORTED_CONTENT_TYPE",
  "RESPONSE_TOO_LARGE",
  "EMPTY_BODY",
]);

const WebsiteCaptureBaseSchema = z.object({
  captureVersion: z.literal(WEBSITE_CAPTURE_VERSION),
  policy: z
    .object({
      maxRedirects: z.number().int().min(0).max(WEBSITE_CAPTURE_MAX_REDIRECTS),
      maxResponseBytes: z.number().int().min(1).max(WEBSITE_CAPTURE_MAX_RESPONSE_BYTES),
      timeoutMs: z.number().int().min(1).max(WEBSITE_CAPTURE_TIMEOUT_MS),
    })
    .strict(),
  capturedAt: z.string().datetime({ offset: true }),
  requestedUrl: z.string().url().nullable(),
  finalUrl: z.string().url().nullable(),
  statusCode: z.number().int().min(0).max(599),
  redirectCount: z.number().int().nonnegative().max(WEBSITE_CAPTURE_MAX_REDIRECTS),
  redirectChain: z.array(z.string().url()).max(WEBSITE_CAPTURE_MAX_REDIRECTS + 1),
});

const WebsiteCaptureResultUnionSchema = z.discriminatedUnion("outcome", [
  WebsiteCaptureBaseSchema.extend({
    outcome: z.literal("CAPTURED"),
    contentType: z.enum(["text/html", "application/xhtml+xml"]),
    bodyBytes: z.number().int().positive().max(WEBSITE_CAPTURE_MAX_RESPONSE_BYTES),
    rawBytes: z.instanceof(Uint8Array),
    contentDigest: DigestSchema,
    html: z.string().min(1),
    failure: z.null(),
  }).strict(),
  WebsiteCaptureBaseSchema.extend({
    outcome: z.literal("REJECTED"),
    contentType: z.null(),
    bodyBytes: z.literal(0),
    html: z.null(),
    failure: z
      .object({
        code: z.enum(["INVALID_URL", "BLOCKED_URL", "BLOCKED_REDIRECT", "INVALID_REDIRECT"]),
        message: z.string().trim().min(1).max(200),
      })
      .strict(),
  }).strict(),
  WebsiteCaptureBaseSchema.extend({
    outcome: z.literal("FAILED"),
    contentType: z.string().trim().min(1).max(200).nullable(),
    bodyBytes: z.number().int().nonnegative().max(WEBSITE_CAPTURE_MAX_RESPONSE_BYTES),
    html: z.null(),
    failure: z
      .object({
        code: WebsiteCaptureFailureCodeSchema.exclude([
          "INVALID_URL",
          "BLOCKED_URL",
          "BLOCKED_REDIRECT",
          "INVALID_REDIRECT",
        ]),
        message: z.string().trim().min(1).max(200),
      })
      .strict(),
  }).strict(),
]);

export const WebsiteCaptureResultSchema = WebsiteCaptureResultUnionSchema.superRefine((value, context) => {
  if (value.outcome !== "CAPTURED") return;
  if (value.bodyBytes !== value.rawBytes.byteLength) {
    context.addIssue({ code: "custom", path: ["bodyBytes"], message: "Captured bodyBytes must equal rawBytes.byteLength." });
  }
  const digest = createHash("sha256").update(value.rawBytes).digest("hex");
  if (value.contentDigest !== digest) {
    context.addIssue({ code: "custom", path: ["contentDigest"], message: "Captured contentDigest must equal SHA-256(rawBytes)." });
  }
});

export type WebsiteCaptureResult = z.infer<typeof WebsiteCaptureResultSchema>;

type WebsiteCapturePolicy = {
  maxRedirects?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

type WebsiteCaptureDependencies = {
  fetch: typeof globalThis.fetch;
  now?: () => Date;
};

class WebsiteCaptureFault extends Error {
  readonly code: z.infer<typeof WebsiteCaptureFailureCodeSchema>;

  constructor(code: z.infer<typeof WebsiteCaptureFailureCodeSchema>, message: string) {
    super(message);
    this.name = "WebsiteCaptureFault";
    this.code = code;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);

function normalizedPolicy(value: WebsiteCapturePolicy) {
  return z
    .object({
      maxRedirects: z.number().int().min(0).max(WEBSITE_CAPTURE_MAX_REDIRECTS).default(WEBSITE_CAPTURE_MAX_REDIRECTS),
      maxResponseBytes: z
        .number()
        .int()
        .min(1)
        .max(WEBSITE_CAPTURE_MAX_RESPONSE_BYTES)
        .default(WEBSITE_CAPTURE_MAX_RESPONSE_BYTES),
      timeoutMs: z.number().int().min(1).max(WEBSITE_CAPTURE_TIMEOUT_MS).default(WEBSITE_CAPTURE_TIMEOUT_MS),
    })
    .strict()
    .parse(value);
}

function contentTypeOf(response: Response) {
  const header = response.headers.get("content-type");
  const mime = header?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-CA") || null;
  return mime?.slice(0, 200) || null;
}

async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw new WebsiteCaptureFault("RESPONSE_TOO_LARGE", "The website response exceeded the capture byte limit.");
  }
  if (!response.body) throw new WebsiteCaptureFault("EMPTY_BODY", "The website returned no document body.");

  const reader = response.body.getReader();
  const cancelOnAbort = () => {
    void reader.cancel("capture_timeout");
  };
  signal.addEventListener("abort", cancelOnAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) {
        throw new WebsiteCaptureFault("TIMEOUT", "The website capture exceeded its time limit.");
      }
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("capture_byte_limit");
        throw new WebsiteCaptureFault("RESPONSE_TOO_LARGE", "The website response exceeded the capture byte limit.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener("abort", cancelOnAbort);
  }
  if (total === 0) throw new WebsiteCaptureFault("EMPTY_BODY", "The website returned an empty document body.");

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const contentDigest = createHash("sha256").update(bytes).digest("hex");
  return { rawBytes: bytes, contentDigest, bodyBytes: total, html: new TextDecoder().decode(bytes) };
}

function rejectedResult(
  policy: ReturnType<typeof normalizedPolicy>,
  capturedAt: string,
  requestedUrl: string | null,
  redirectChain: string[],
  code: "INVALID_URL" | "BLOCKED_URL" | "BLOCKED_REDIRECT" | "INVALID_REDIRECT",
  message: string,
  statusCode = 0,
): WebsiteCaptureResult {
  return WebsiteCaptureResultSchema.parse({
    captureVersion: WEBSITE_CAPTURE_VERSION,
    policy,
    capturedAt,
    requestedUrl,
    finalUrl: null,
    statusCode,
    redirectCount: Math.max(0, redirectChain.length - 1),
    redirectChain,
    outcome: "REJECTED",
    contentType: null,
    bodyBytes: 0,
    html: null,
    failure: { code, message },
  });
}

/**
 * Fetch one public website document through a strictly bounded, injectable
 * transport. This module is not called by the inert Worker; production wiring
 * requires a later release gate and provider-free fixture tests come first.
 */
export async function capturePublicWebsiteDocument(
  websiteUrl: string,
  dependencies: WebsiteCaptureDependencies,
  policyOverrides: WebsiteCapturePolicy = {},
): Promise<WebsiteCaptureResult> {
  const policy = normalizedPolicy(policyOverrides);
  const capturedAt = (dependencies.now || (() => new Date()))().toISOString();
  let requestedUrl: string;
  try {
    requestedUrl = normalizePublicWebsiteUrl(websiteUrl);
  } catch (error) {
    if (error instanceof PublicWebsiteUrlError) {
      return rejectedResult(policy, capturedAt, null, [], error.code, error.message);
    }
    throw error;
  }

  const redirectChain = [requestedUrl];
  const seen = new Set(redirectChain);
  const controller = new AbortController();
  let currentUrl = requestedUrl;
  let currentStatus = 0;
  let currentContentType: string | null = null;
  let currentBodyBytes = 0;

  const work = async (): Promise<WebsiteCaptureResult> => {
    while (true) {
      let response: Response;
      try {
        response = await dependencies.fetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Accept: "text/html,application/xhtml+xml;q=0.9",
            "Accept-Language": "en-CA,en;q=0.8",
            "User-Agent": "AxiomRevenueEngineWebsiteAudit/0.1 (+https://getaxiom.ca)",
          },
        });
      } catch {
        if (controller.signal.aborted) {
          throw new WebsiteCaptureFault("TIMEOUT", "The website capture exceeded its time limit.");
        }
        throw new WebsiteCaptureFault("FETCH_FAILED", "The public website request failed.");
      }

      currentStatus = response.status;
      currentContentType = contentTypeOf(response);
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new WebsiteCaptureFault("REDIRECT_WITHOUT_LOCATION", "The website returned a redirect without a destination.");
        }
        if (redirectChain.length - 1 >= policy.maxRedirects) {
          throw new WebsiteCaptureFault("TOO_MANY_REDIRECTS", "The website exceeded the redirect limit.");
        }

        let redirectUrl: string;
        try {
          redirectUrl = normalizePublicWebsiteUrl(new URL(location, currentUrl).toString());
        } catch (error) {
          if (error instanceof PublicWebsiteUrlError) {
            return rejectedResult(
              policy,
              capturedAt,
              requestedUrl,
              redirectChain,
              error.code === "BLOCKED_URL" ? "BLOCKED_REDIRECT" : "INVALID_REDIRECT",
              "The redirect destination did not pass the public website policy.",
              currentStatus,
            );
          }
          throw error;
        }
        if (seen.has(redirectUrl)) {
          throw new WebsiteCaptureFault("REDIRECT_LOOP", "The website entered a redirect loop.");
        }
        redirectChain.push(redirectUrl);
        seen.add(redirectUrl);
        currentUrl = redirectUrl;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new WebsiteCaptureFault("HTTP_STATUS", `The website returned HTTP status ${response.status}.`);
      }
      if (!currentContentType || !ALLOWED_CONTENT_TYPES.has(currentContentType)) {
        throw new WebsiteCaptureFault("UNSUPPORTED_CONTENT_TYPE", "The website did not return an HTML document.");
      }

      const body = await readBoundedBody(response, policy.maxResponseBytes, controller.signal);
      currentBodyBytes = body.bodyBytes;
      return WebsiteCaptureResultSchema.parse({
        captureVersion: WEBSITE_CAPTURE_VERSION,
        policy,
        capturedAt,
        requestedUrl,
        finalUrl: currentUrl,
        statusCode: currentStatus,
        redirectCount: redirectChain.length - 1,
        redirectChain,
        outcome: "CAPTURED",
        contentType: currentContentType,
        bodyBytes: body.bodyBytes,
        rawBytes: body.rawBytes,
        contentDigest: body.contentDigest,
        html: body.html,
        failure: null,
      });
    }
  };

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort("capture_timeout");
      reject(new WebsiteCaptureFault("TIMEOUT", "The website capture exceeded its time limit."));
    }, policy.timeoutMs);
  });

  try {
    return await Promise.race([work(), timeout]);
  } catch (error) {
    const fault = error instanceof WebsiteCaptureFault
      ? error
      : new WebsiteCaptureFault("FETCH_FAILED", "The public website request failed.");
    return WebsiteCaptureResultSchema.parse({
      captureVersion: WEBSITE_CAPTURE_VERSION,
      policy,
      capturedAt,
      requestedUrl,
      finalUrl: currentUrl,
      statusCode: currentStatus,
      redirectCount: redirectChain.length - 1,
      redirectChain,
      outcome: "FAILED",
      contentType: currentContentType,
      bodyBytes: currentBodyBytes,
      html: null,
      failure: { code: fault.code, message: fault.message },
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
