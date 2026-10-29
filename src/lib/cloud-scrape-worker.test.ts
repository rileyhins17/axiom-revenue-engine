import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isTransientCloudBrowserError,
  runCloudScrapeWorker,
  shouldSkipCloudMapsDetailPages,
  shouldUseExistingLeadForScrapeDedupe,
} from "./cloud-scrape-worker";

test("legacy cloud crawler is inert under every binding configuration", async () => {
  assert.deepEqual(await runCloudScrapeWorker(), {
    claimed: false,
    reason: "Legacy browser crawler is disabled",
  });
});

test("cloud worker cannot read bindings, environment, jobs, or providers", () => {
  const source = readFileSync(new URL("./cloud-scrape-worker.ts", import.meta.url), "utf8");
  const entrypoint = source.slice(source.indexOf("export async function runCloudScrapeWorker()"));
  const body = entrypoint.slice(0, entrypoint.indexOf("\n}"));
  assert.doesNotMatch(
    body,
    /getCloudflareBindings|getServerEnv|getAutomationSettings|claimCloudJob|executeScrapeJob|launchAutomationBrowser/,
  );
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
