import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";

import {
  evaluatePrivateKwRobotsPolicy,
} from "@/lib/revenue-engine/private-kw-source-policy";
import { createPrivateKwPublicHttpTransport } from "@/lib/revenue-engine/private-kw-public-http-transport";

const NOW = new Date("2026-09-21T15:00:00.000Z");

function transportFor(robots: string, status = 200) {
  let calls = 0;
  const transport = createPrivateKwPublicHttpTransport({
    resolveDns: async () => [{ address: "93.184.216.34", family: 4 as const }],
    executeConnection: async () => {
      calls += 1;
      return {
        statusCode: status,
        headers: { "content-type": "text/plain" },
        body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(robots)); controller.close(); } }),
        abort() {},
      };
    },
    now: () => NOW,
  });
  return { transport, calls: () => calls };
}

test("parses robots allow, longest rule, crawl delay, and records a digest without body text", async () => {
  const { transport, calls } = transportFor([
    "User-agent: *",
    "Disallow: /",
    "Allow: /public",
    "Crawl-delay: 2",
    "",
  ].join("\n"));
  const decision = await evaluatePrivateKwRobotsPolicy({
    approvedSourceUrl: "https://example.com/",
    auditUserAgent: "AxiomAudit/1.0",
    termsDecision: "TERMS_REVIEWED_FOR_FACTS",
    transport,
    now: () => NOW,
    sleep: async () => {},
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.matchedRule, "Disallow: /");
  assert.equal(decision.crawlDelaySeconds, 2);
  assert.equal(decision.contentDigest, createHash("sha256").update("User-agent: *\nDisallow: /\nAllow: /public\nCrawl-delay: 2\n").digest("hex"));
  assert.equal(decision.transportReceiptDigests[0], transport.takeReceipts()[0]?.receiptDigest);
  assert.equal("bodyText" in decision, false);
  assert.equal(calls(), 1);
});

test("enforces crawl delay through the injected bounded sleep and treats empty Disallow as allowed", async () => {
  const { transport } = transportFor("User-agent: *\nDisallow:\nCrawl-delay: 2\n");
  const sleeps: number[] = [];
  const decision = await evaluatePrivateKwRobotsPolicy({
    approvedSourceUrl: "https://example.com/",
    auditUserAgent: "AxiomAudit/1.0",
    termsDecision: "TERMS_REVIEWED_FOR_FACTS",
    transport,
    now: () => NOW,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });
  assert.equal(decision.allowed, true);
  assert.deepEqual(sleeps, [2000]);
});

test("blocks a crawl delay that would cross the policy deadline", async () => {
  const { transport } = transportFor("User-agent: *\nCrawl-delay: 2\n");
  const decision = await evaluatePrivateKwRobotsPolicy({
    approvedSourceUrl: "https://example.com/",
    auditUserAgent: "AxiomAudit/1.0",
    termsDecision: "TERMS_REVIEWED_FOR_FACTS",
    transport,
    now: () => NOW,
    policyDeadlineAt: new Date(NOW.getTime() + 1000),
    sleep: async () => { throw new Error("must not sleep past deadline"); },
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /deadline|delay/i);
});

test("fails closed on duplicate or conflicting crawl-delay declarations", async () => {
  for (const robots of [
    "User-agent: *\nCrawl-delay: 2\nCrawl-delay: 2\n",
    "User-agent: AxiomAudit/1.0\nCrawl-delay: 2\nUser-agent: AxiomAudit/1.0\nCrawl-delay: 3\n",
  ]) {
    const { transport } = transportFor(robots);
    const decision = await evaluatePrivateKwRobotsPolicy({
      approvedSourceUrl: "https://example.com/",
      auditUserAgent: "AxiomAudit/1.0",
      termsDecision: "TERMS_REVIEWED_FOR_FACTS",
      transport,
      now: () => NOW,
      sleep: async () => {},
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /malformed|conflict|delay/i);
  }
});

test("rejects unbounded robots byte and redirect overrides before any request", async () => {
  for (const options of [
    { maxRobotsBytes: Infinity },
    { maxRobotsBytes: 131073 },
    { maxRobotsBytes: 1.5 },
    { maxRobotsBytes: -1 },
    { maxRedirects: Infinity },
    { maxRedirects: 4 },
    { maxRedirects: 1.5 },
    { maxRedirects: -1 },
  ]) {
    const { transport, calls } = transportFor("User-agent: *\n");
    await assert.rejects(() => evaluatePrivateKwRobotsPolicy({
      approvedSourceUrl: "https://example.com/",
      auditUserAgent: "AxiomAudit/1.0",
      termsDecision: "TERMS_REVIEWED_FOR_FACTS",
      transport,
      ...options,
    }));
    assert.equal(calls(), 0);
  }
});

test("rejects a tampered transport receipt digest", async () => {
  const transport = {
    request: async () => new Response("User-agent: *\n", { status: 200, headers: { "content-type": "text/plain" } }),
    takeReceipts: () => [{
      transportVersion: "kw-m2-public-transport-v1",
      requestId: 1,
      normalizedUrl: "https://example.com/robots.txt",
      method: "GET" as const,
      hostname: "example.com",
      selectedAddress: "93.184.216.34",
      selectedFamily: 4 as const,
      addressClass: "PUBLIC",
      statusCode: 200,
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
      socketOpened: true,
      networkRequestCount: 1 as const,
      acceptedAddressesDigest: "0".repeat(64),
      receiptDigest: "f".repeat(64),
    }],
  } as never;
  await assert.rejects(() => evaluatePrivateKwRobotsPolicy({
    approvedSourceUrl: "https://example.com/",
    auditUserAgent: "AxiomAudit/1.0",
    termsDecision: "TERMS_REVIEWED_FOR_FACTS",
    transport,
    now: () => NOW,
  }), /digest/i);
});

test("requires explicit terms approval and fails closed on unavailable or malformed robots", async () => {
  for (const [robots, status] of [["User-agent: *\nDisallow: /private\n", 200], ["not a directive", 200], ["", 503]] as const) {
    const { transport } = transportFor(robots, status);
    const decision = await evaluatePrivateKwRobotsPolicy({
      approvedSourceUrl: "https://example.com/",
      auditUserAgent: "AxiomAudit/1.0",
      termsDecision: "UNKNOWN",
      transport,
      now: () => NOW,
      sleep: async () => {},
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /terms|robots/i);
  }
});

test("does not follow a robots redirect to another host", async () => {
  const transport = createPrivateKwPublicHttpTransport({
    resolveDns: async () => [{ address: "93.184.216.34", family: 4 as const }],
    executeConnection: async () => ({
      statusCode: 302,
      headers: { location: "https://other-domain.ca/robots.txt" },
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      abort() {},
    }),
  });
  const decision = await evaluatePrivateKwRobotsPolicy({
    approvedSourceUrl: "https://example.com/",
    auditUserAgent: "AxiomAudit/1.0",
    termsDecision: "TERMS_REVIEWED_FOR_FACTS",
    transport,
    now: () => NOW,
    sleep: async () => {},
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /host/i);
});
