import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isTransientCloudBrowserError,
  runCloudScrapeWorker,
  shouldDisableLegacyCloudCrawler,
  shouldSkipCloudMapsDetailPages,
  shouldUseExistingLeadForScrapeDedupe,
} from "./cloud-scrape-worker";

test("deployed Cloudflare Browser Rendering cannot run the legacy crawler", () => {
  assert.equal(shouldDisableLegacyCloudCrawler(), true);
});

test("legacy cloud crawler entry point never claims a job", async () => {
  assert.deepEqual(await runCloudScrapeWorker(), {
    claimed: false,
    reason: "Legacy browser crawler is disabled",
  });
});

test("cloud worker checks the production crawler block before loading scrape policy or claiming work", () => {
  const source = readFileSync(new URL("./cloud-scrape-worker.ts", import.meta.url), "utf8");
  const entrypoint = source.slice(source.indexOf("export async function runCloudScrapeWorker()"));
  const block = entrypoint.indexOf("shouldDisableLegacyCloudCrawler()");
  const bindings = entrypoint.indexOf("const bindings = getCloudflareBindings()");
  const environment = entrypoint.indexOf("const env = getServerEnv()");
  const claim = entrypoint.indexOf("claimCloudJob(");
  assert.ok(block >= 0);
  assert.ok(bindings > block);
  assert.ok(environment > block);
  assert.ok(claim > environment);
});

test("archived empty scrape ghosts do not block a future quality scrape", () => {
  assert.equal(
    shouldUseExistingLeadForScrapeDedupe({
      axiomScore: 34,
      axiomTier: "D",
      email: "",
      isArchived: true,
      websiteDomain: null,
      websiteUrl: null,
    }),
    false,
  );
});

test("usable existing leads still participate in scrape dedupe", () => {
  assert.equal(
    shouldUseExistingLeadForScrapeDedupe({
      email: "owner@example.com",
      isArchived: true,
    }),
    true,
  );

  assert.equal(
    shouldUseExistingLeadForScrapeDedupe({
      isArchived: false,
      websiteUrl: null,
    }),
    true,
  );
});

test("cloud scrape skips Maps detail pages unless explicitly enabled", () => {
  assert.equal(
    shouldSkipCloudMapsDetailPages({ CLOUD_SCRAPE_DETAIL_PAGES_ENABLED: false }),
    true,
  );
  assert.equal(
    shouldSkipCloudMapsDetailPages({ CLOUD_SCRAPE_DETAIL_PAGES_ENABLED: false }),
    true,
  );
  assert.equal(
    shouldSkipCloudMapsDetailPages({ CLOUD_SCRAPE_DETAIL_PAGES_ENABLED: true }),
    false,
  );
});

test("Cloudflare Browser Rendering rate limits are retryable scrape failures", () => {
  assert.equal(
    isTransientCloudBrowserError("Unable to create new browser: code: 429: message: Rate limit exceeded"),
    true,
  );
  assert.equal(isTransientCloudBrowserError("Maps selector changed"), false);
});
