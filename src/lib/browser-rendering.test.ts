import assert from "node:assert/strict";
import test from "node:test";

import { applyScrapeResourceBlocking, isAllowedLegacyCrawlerRequestUrl } from "./browser-rendering";

test("legacy crawler stops when request interception cannot be installed", async () => {
  await assert.rejects(applyScrapeResourceBlocking({}), /request routing is unavailable/);
  await assert.rejects(
    applyScrapeResourceBlocking({ route: async () => { throw new Error("route install failed"); } }),
    /request routing could not be installed/,
  );
});

test("legacy crawler request policy allows only canonical public HTTP targets", () => {
  assert.equal(isAllowedLegacyCrawlerRequestUrl("https://example.ca/contact"), true);
  assert.equal(isAllowedLegacyCrawlerRequestUrl("http://127.0.0.1/admin"), false);
  assert.equal(isAllowedLegacyCrawlerRequestUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(isAllowedLegacyCrawlerRequestUrl("http://router.local/admin"), false);
  assert.equal(isAllowedLegacyCrawlerRequestUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedLegacyCrawlerRequestUrl("data:text/plain,secret"), false);
});

test("legacy crawler aborts a redirect or subresource request to a private target", async () => {
  let handler: ((route: unknown) => unknown) | undefined;
  await applyScrapeResourceBlocking({
    route: async (_pattern: string, candidate: (route: unknown) => unknown) => {
      handler = candidate;
    },
  });

  let aborted = 0;
  let continued = 0;
  await handler?.({
    request: () => ({
      resourceType: () => "document",
      url: () => "http://169.254.169.254/latest/meta-data",
    }),
    abort: async () => { aborted += 1; },
    continue: async () => { continued += 1; },
  });
  assert.equal(aborted, 1);
  assert.equal(continued, 0);
});
