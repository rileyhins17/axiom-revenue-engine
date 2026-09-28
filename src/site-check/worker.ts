import { launch } from "@cloudflare/playwright";
import type { Browser } from "playwright";

import { runSiteChecks } from "../lib/revenue-engine/cloud-site-check";
import { captureAndAuditSite } from "../lib/revenue-engine/engine-site-capture";
import type { ProspectDb } from "../lib/revenue-engine/engine-prospects-d1";

/**
 * axiom-site-check: grades the homepages of businesses that list a website, on
 * Cloudflare's browser (Browser Run), never on anyone's computer. A few at a time,
 * every 10 minutes during weekday business hours. It is a separate Worker from the
 * main app (axiom-ops-omniscient) so it can never slow down or break calling; it only
 * adds businesses to the call list and records each check on DiscoveryHeld.
 * No public address: it answers every web request with 404.
 */
type Env = { DB: unknown; BROWSER: Parameters<typeof launch>[0]; SITE_CHECK_ENABLED?: string };
type Context = { waitUntil(promise: Promise<unknown>): void };

const siteCheckWorker = {
  async scheduled(_controller: unknown, env: Env, ctx: Context) {
    if (env.SITE_CHECK_ENABLED !== "true") {
      console.log(JSON.stringify({ event: "site_check", skipped: "SITE_CHECK_ENABLED is not true" }));
      return;
    }
    ctx.waitUntil(runSiteChecks(env.DB as ProspectDb, {
      openCapture: async () => {
        const browser = await launch(env.BROWSER);
        return {
          capture: (business) => captureAndAuditSite(browser as unknown as Browser, business),
          close: () => browser.close(),
        };
      },
    })
      .then((result) => console.log(JSON.stringify({ event: "site_check", ...result })))
      .catch((error) => console.error("[site-check] failure", error instanceof Error ? error.message : "unknown")));
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};

export default siteCheckWorker;
