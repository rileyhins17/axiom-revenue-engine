import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  capturePublicWebsiteDocument,
  WebsiteCaptureResultSchema,
  type WebsiteCaptureResult,
} from "@/lib/revenue-engine/website-capture";

const NOW = new Date("2026-08-22T18:00:00.000Z");

function outcomeCode(result: WebsiteCaptureResult) {
  return result.outcome === "CAPTURED" ? null : result.failure.code;
}

test("captures bounded HTML and manually revalidates a relative redirect", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = input.toString();
    calls.push({ url, init });
    if (calls.length === 1) {
      return new Response(null, { status: 301, headers: { Location: "/home" } });
    }
    return new Response("<!doctype html><title>Local roofer</title>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };

  const result = await capturePublicWebsiteDocument(
    "kw-roofing.ca",
    { fetch: fakeFetch, now: () => NOW },
    { timeoutMs: 100 },
  );

  assert.equal(result.outcome, "CAPTURED");
  if (result.outcome !== "CAPTURED") return;
  assert.equal(result.requestedUrl, "https://kw-roofing.ca/");
  assert.equal(result.finalUrl, "https://kw-roofing.ca/home");
  assert.equal(result.redirectCount, 1);
  assert.equal(result.capturedAt, NOW.toISOString());
  assert.equal(result.contentType, "text/html");
  assert.ok(result.bodyBytes > 0);
  assert.ok(result.rawBytes instanceof Uint8Array);
  assert.equal(result.bodyBytes, result.rawBytes.byteLength);
  assert.equal(result.contentDigest, createHash("sha256").update(result.rawBytes).digest("hex"));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.init?.redirect === "manual"));
  assert.ok(calls.every((call) => call.init?.credentials === "omit"));
});

test("preserves distinct exact bytes when invalid UTF-8 sequences decode alike", async () => {
  const firstBytes = new Uint8Array([0xc3, 0x28]);
  const secondBytes = new Uint8Array([0xe2, 0x28]);
  const capture = async (bytes: Uint8Array) => capturePublicWebsiteDocument("https://public-roofer.ca", {
    fetch: async () => new Response(Buffer.from(bytes), { headers: { "Content-Type": "text/html" } }),
    now: () => NOW,
  });
  const first = await capture(firstBytes);
  const second = await capture(secondBytes);
  assert.equal(first.outcome, "CAPTURED");
  assert.equal(second.outcome, "CAPTURED");
  if (first.outcome !== "CAPTURED" || second.outcome !== "CAPTURED") return;
  assert.equal(first.html, second.html);
  assert.notEqual(first.contentDigest, second.contentDigest);
  assert.deepEqual(Array.from(first.rawBytes), Array.from(firstBytes));
  assert.deepEqual(Array.from(second.rawBytes), Array.from(secondBytes));
});

test("owns streamed chunks and validates capture byte identity and length", async () => {
  const sourceChunk = new Uint8Array([60, 104, 49, 62, 111, 107, 60, 47, 104, 49, 62]);
  const result = await capturePublicWebsiteDocument("https://public-roofer.ca", {
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sourceChunk);
        controller.close();
      },
    }), { headers: { "Content-Type": "text/html" } }),
    now: () => NOW,
  });
  assert.equal(result.outcome, "CAPTURED");
  if (result.outcome !== "CAPTURED") return;
  sourceChunk[0] = 0;
  assert.equal(result.rawBytes[0], 60);
  assert.equal(result.bodyBytes, result.rawBytes.byteLength);
  assert.equal(result.contentDigest, createHash("sha256").update(result.rawBytes).digest("hex"));
  assert.throws(() => WebsiteCaptureResultSchema.parse({ ...result, contentDigest: "a".repeat(64) }), /digest|invalid/i);
  assert.throws(() => WebsiteCaptureResultSchema.parse({ ...result, bodyBytes: result.bodyBytes + 1 }), /bodyBytes|invalid/i);
});

test("rejects an initial private target without calling fetch", async () => {
  let calls = 0;
  const result = await capturePublicWebsiteDocument("http://127.0.0.1/admin", {
    fetch: async () => {
      calls += 1;
      return new Response("not reached");
    },
    now: () => NOW,
  });

  assert.equal(result.outcome, "REJECTED");
  assert.equal(outcomeCode(result), "BLOCKED_URL");
  assert.equal(calls, 0);
  assert.equal("rawBytes" in result, false);
  assert.equal("contentDigest" in result, false);
});

test("rejects a redirect to a private target before the second request", async () => {
  let calls = 0;
  const result = await capturePublicWebsiteDocument("https://public-roofer.ca", {
    fetch: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/metadata" } });
    },
    now: () => NOW,
  });

  assert.equal(result.outcome, "REJECTED");
  assert.equal(outcomeCode(result), "BLOCKED_REDIRECT");
  assert.equal(calls, 1);
  assert.equal("rawBytes" in result, false);
  assert.equal("contentDigest" in result, false);
});

test("fails closed on redirect loops and redirect overflow", async () => {
  const loop = await capturePublicWebsiteDocument("https://public-roofer.ca", {
    fetch: async () => new Response(null, { status: 302, headers: { Location: "/" } }),
    now: () => NOW,
  });
  assert.equal(outcomeCode(loop), "REDIRECT_LOOP");

  let redirect = 0;
  const overflow = await capturePublicWebsiteDocument("https://public-roofer.ca", {
    fetch: async () => {
      redirect += 1;
      return new Response(null, { status: 302, headers: { Location: `/step-${redirect}` } });
    },
    now: () => NOW,
  }, { maxRedirects: 2 });
  assert.equal(outcomeCode(overflow), "TOO_MANY_REDIRECTS");
  assert.equal(redirect, 3);
});

test("blocks declared and streamed bodies above the byte limit", async () => {
  const declared = await capturePublicWebsiteDocument("https://public-roofer.ca", {
    fetch: async () => new Response("small", {
      headers: { "Content-Type": "text/html", "Content-Length": "1000" },
    }),
    now: () => NOW,
  }, { maxResponseBytes: 32 });
  assert.equal(outcomeCode(declared), "RESPONSE_TOO_LARGE");
  assert.equal("rawBytes" in declared, false);
  assert.equal("contentDigest" in declared, false);

  const streamed = await capturePublicWebsiteDocument("https://public-roofer.ca", {
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a".repeat(20)));
        controller.enqueue(new TextEncoder().encode("b".repeat(20)));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/html" } }),
    now: () => NOW,
  }, { maxResponseBytes: 32 });
  assert.equal(outcomeCode(streamed), "RESPONSE_TOO_LARGE");
  assert.equal("rawBytes" in streamed, false);
  assert.equal("contentDigest" in streamed, false);
});

test("rejects non-HTML content before reading its body", async () => {
  const result = await capturePublicWebsiteDocument("https://public-roofer.ca/brochure.pdf", {
    fetch: async () => new Response("%PDF", { headers: { "Content-Type": "application/pdf" } }),
    now: () => NOW,
  });
  assert.equal(outcomeCode(result), "UNSUPPORTED_CONTENT_TYPE");
  assert.equal("rawBytes" in result, false);
  assert.equal("contentDigest" in result, false);
});

test("aborts a capture that exceeds its total timeout", async () => {
  const hangingFetch: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const result = await capturePublicWebsiteDocument(
    "https://public-roofer.ca",
    { fetch: hangingFetch, now: () => NOW },
    { timeoutMs: 5 },
  );
  assert.equal(outcomeCode(result), "TIMEOUT");
  assert.equal("rawBytes" in result, false);
  assert.equal("contentDigest" in result, false);
});

test("reports HTTP failures without treating an error page as captured evidence", async () => {
  const result = await capturePublicWebsiteDocument("https://public-roofer.ca", {
    fetch: async () => new Response("maintenance", {
      status: 503,
      headers: { "Content-Type": "text/html" },
    }),
    now: () => NOW,
  });
  assert.equal(result.outcome, "FAILED");
  assert.equal(outcomeCode(result), "HTTP_STATUS");
  assert.equal(result.statusCode, 503);
  assert.equal(result.html, null);
  assert.equal("rawBytes" in result, false);
  assert.equal("contentDigest" in result, false);
});
