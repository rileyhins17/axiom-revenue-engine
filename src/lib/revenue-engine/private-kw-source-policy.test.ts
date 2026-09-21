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
  assert.equal("bodyText" in decision, false);
  assert.equal(calls(), 1);
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
