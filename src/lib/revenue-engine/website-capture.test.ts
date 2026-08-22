import assert from "node:assert/strict";
import test from "node:test";

import {
  capturePublicWebsiteDocument,
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
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.init?.redirect === "manual"));
  assert.ok(calls.every((call) => call.init?.credentials === "omit"));
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
});

test("rejects non-HTML content before reading its body", async () => {
  const result = await capturePublicWebsiteDocument("https://public-roofer.ca/brochure.pdf", {
    fetch: async () => new Response("%PDF", { headers: { "Content-Type": "application/pdf" } }),
    now: () => NOW,
  });
  assert.equal(outcomeCode(result), "UNSUPPORTED_CONTENT_TYPE");
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
});
