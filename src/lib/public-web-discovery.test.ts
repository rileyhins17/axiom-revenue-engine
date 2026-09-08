import assert from "node:assert/strict";
import { test } from "node:test";
import { collectWebsiteDiscoveryPages, collectSearchDiscoveryPage } from "./public-web-discovery";
import type { AutomationBrowserContext } from "./browser-rendering";
import { LEGACY_BROWSER_RETIRED_REASON } from "./retired-legacy-browser";

test("retired discovery rejects every destination before inspecting an injected browser", async () => {
  const context = new Proxy({}, { get() { throw new Error("Must not inspect a browser context"); } }) as AutomationBrowserContext;
  for (const url of ["https://example.ca", "http://127.0.0.1", "http://10.0.0.1", "http://169.254.169.254", "http://[::1]", "file:///fixture", "malformed"]) {
    await assert.rejects(collectWebsiteDiscoveryPages(context, url, () => { throw new Error("Must not emit events"); }),
      { message: LEGACY_BROWSER_RETIRED_REASON });
  }
  await assert.rejects(collectSearchDiscoveryPage(context, "synthetic query"), { message: LEGACY_BROWSER_RETIRED_REASON });
});
