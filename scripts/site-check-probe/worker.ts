import { launch } from "@cloudflare/playwright";
import type { Browser } from "playwright";

import { classifyEngineLead } from "../../src/lib/revenue-engine/engine-lead-rules";
import { captureAndAuditSite } from "../../src/lib/revenue-engine/engine-site-capture";

/**
 * Verification harness for the cloud website check, run only with
 * `wrangler dev --remote --config scripts/site-check-probe/wrangler.jsonc`: the browser runs
 * on Cloudflare (Browser Run), never on this computer. It grades the given homepages and
 * returns the label, reasons and measured signals, so they can be compared with the labels
 * the local weekly run gave the same sites. No database binding: it cannot change data.
 *   GET /?url=https://example.com/&url=https://other.example/
 */
type Env = { BROWSER: Parameters<typeof launch>[0] };

export default {
  async fetch(request: Request, env: Env) {
    const urls = new URL(request.url).searchParams.getAll("url").slice(0, 6);
    if (!urls.length) return Response.json({ error: "pass ?url=" }, { status: 400 });
    const browser = await launch(env.BROWSER);
    const results = [];
    try {
      for (const url of urls) {
        const started = Date.now();
        try {
          const capture = await captureAndAuditSite(browser as unknown as Browser, { businessId: url, businessName: url, niche: "trade", websiteUrl: url });
          if (capture.status !== "CAPTURED") { results.push({ url, status: capture.status, reason: capture.reason, ms: Date.now() - started }); continue; }
          const decision = classifyEngineLead(url, capture.signals, new Date().getUTCFullYear());
          const { finalUrl, phoneLayoutWidth, phoneViewportMeta, phoneScrollWidth, phoneTapToCall, desktopTapToCall, quoteAction, wordCount, copyrightYear, generator, underConstruction, hasStreetAddress } = capture.signals;
          results.push({ url, status: "CAPTURED", label: decision.label, codes: decision.codes, reasons: decision.reasons, ms: Date.now() - started,
            signals: { finalUrl, phoneLayoutWidth, phoneViewportMeta, phoneScrollWidth, phoneTapToCall, desktopTapToCall, quoteAction, wordCount, copyrightYear, generator, underConstruction, hasStreetAddress } });
        } catch (error) {
          results.push({ url, status: "ERROR", error: error instanceof Error ? error.message.split("\n")[0] : String(error), ms: Date.now() - started });
        }
      }
    } finally {
      await browser.close();
    }
    return Response.json({ results });
  },
};
