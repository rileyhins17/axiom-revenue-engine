import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_PAGE_FACTS_VERSION,
  extractHtmlPageFacts,
} from "@/lib/revenue-engine/html-page-facts";
import {
  WEBSITE_CAPTURE_VERSION,
  type WebsiteCaptureResult,
} from "@/lib/revenue-engine/website-capture";

function captured(html: string): WebsiteCaptureResult {
  return {
    captureVersion: WEBSITE_CAPTURE_VERSION,
    policy: { maxRedirects: 5, maxResponseBytes: 1_048_576, timeoutMs: 10_000 },
    capturedAt: "2026-08-22T20:00:00.000Z",
    requestedUrl: "https://public-roofer.ca/",
    finalUrl: "https://public-roofer.ca/",
    statusCode: 200,
    redirectCount: 0,
    redirectChain: ["https://public-roofer.ca/"],
    outcome: "CAPTURED",
    contentType: "text/html",
    bodyBytes: new TextEncoder().encode(html).byteLength,
    html,
    failure: null,
  };
}

test("extracts deterministic page facts without executing page scripts", async () => {
  const globalRecord = globalThis as { axiomFixtureExecuted?: number };
  globalRecord.axiomFixtureExecuted = 0;
  const result = await extractHtmlPageFacts(captured(`
    <!doctype html>
    <html>
      <head>
        <title>Public Roofer | Kitchener</title>
        <meta name="description" content="Roof repair and replacement in Kitchener.">
        <style>.secret { display:block }</style>
        <script>globalThis.axiomFixtureExecuted = 1</script>
        <script type="application/ld+json">
          {"@graph":[{"@type":"LocalBusiness"},{"@type":["RoofingContractor","Organization"]}]}
        </script>
      </head>
      <body>
        <h1>Roof repair for Kitchener homeowners</h1>
        <section class="customer-reviews"><h2>Customer Reviews</h2></section>
        <h2>Meet the Team</h2>
        <h2>Our Warranty</h2>
        <a href="tel:+15195550123"><span>Call now</span></a>
        <a href="/free-estimate">Get a quote</a>
        <a href="/services/roof-repair">Roof repair services</a>
        <a href="https://external.example.org/services">External services</a>
        <form action="/contact" method="post"><button>Send request</button></form>
        <div hidden>Hidden claim must not appear</div>
      </body>
    </html>
  `), "HOME");

  assert.equal(result.extractorVersion, HTML_PAGE_FACTS_VERSION);
  assert.equal(result.complete, true);
  assert.equal(result.title, "Public Roofer | Kitchener");
  assert.equal(result.metaDescription, "Roof repair and replacement in Kitchener.");
  assert.match(result.visibleText, /Roof repair for Kitchener homeowners/);
  assert.doesNotMatch(result.visibleText, /Hidden claim|axiomFixtureExecuted|display:block/);
  assert.equal(globalRecord.axiomFixtureExecuted, 0);
  assert.ok(result.actions.some((action) => action.kind === "PHONE" && action.href?.startsWith("tel:")));
  assert.ok(result.actions.some((action) => action.kind === "QUOTE"));
  assert.ok(result.actions.every((action) => action.aboveFold === "UNKNOWN"));
  assert.deepEqual(result.forms, [{
    actionUrl: "https://public-roofer.ca/contact",
    method: "POST",
    notExplicitlyHidden: true,
    hasEnabledSubmitControl: true,
  }]);
  assert.ok(result.trustSignals.includes("REVIEW"));
  assert.ok(result.trustSignals.includes("TEAM"));
  assert.ok(result.trustSignals.includes("WARRANTY"));
  assert.deepEqual(result.structuredDataTypes, ["LocalBusiness", "Organization", "RoofingContractor"]);
  assert.ok(result.discoveredInternalLinks.some((link) => link.kindHint === "SERVICE" && link.label === "Roof repair services"));
  assert.ok(result.discoveredInternalLinks.every((link) => new URL(link.url).hostname === "public-roofer.ca"));
});

test("unsafe links and form actions are retained only as non-navigable facts", async () => {
  const result = await extractHtmlPageFacts(captured(`
    <html><head><script type="application/ld+json">{broken</script></head><body>
      <a href="javascript:alert(1)">Contact us</a>
      <a href="http://127.0.0.1/admin">Internal</a>
      <form action="http://service.internal/submit"><input type="submit" value="Request quote"></form>
      <p style="visibility:hidden">Invisible bait</p>
    </body></html>
  `), "CONTACT");

  assert.ok(result.warnings.includes("invalid_json_ld"));
  assert.equal(result.discoveredInternalLinks.length, 0);
  assert.equal(result.forms[0]?.actionUrl, null);
  assert.equal(result.forms[0]?.hasEnabledSubmitControl, true);
  assert.doesNotMatch(result.visibleText, /Invisible bait/);
  assert.ok(result.actions.some((action) => action.kind === "CONTACT" && action.href === null));
});

test("token and text ceilings mark incomplete extraction instead of inventing full coverage", async () => {
  const repeated = Array.from({ length: 200 }, (_, index) => `<span>visible-${index}</span>`).join("");
  const result = await extractHtmlPageFacts(captured(`<html><body>${repeated}</body></html>`), "HOME", {
    maxTokens: 100,
    maxTextChars: 100,
  });
  assert.equal(result.complete, false);
  assert.ok(result.warnings.includes("token_limit_reached"));
  assert.ok(result.warnings.includes("visible_text_limit_reached"));
  assert.ok(result.visibleText.length <= 100);
  assert.equal(result.tokenCount, 101);
});

test("only a completed, schema-valid HTML capture can enter extraction", async () => {
  const failed: WebsiteCaptureResult = {
    captureVersion: WEBSITE_CAPTURE_VERSION,
    policy: { maxRedirects: 5, maxResponseBytes: 1_048_576, timeoutMs: 10_000 },
    capturedAt: "2026-08-22T20:00:00.000Z",
    requestedUrl: "https://public-roofer.ca/",
    finalUrl: "https://public-roofer.ca/",
    statusCode: 503,
    redirectCount: 0,
    redirectChain: ["https://public-roofer.ca/"],
    outcome: "FAILED",
    contentType: "text/html",
    bodyBytes: 0,
    html: null,
    failure: { code: "HTTP_STATUS", message: "Unavailable." },
  };
  await assert.rejects(extractHtmlPageFacts(failed, "HOME"), /completed website capture/);
});
