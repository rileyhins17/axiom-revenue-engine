import { createHash } from "node:crypto";

import type { EngineSiteSignals } from "./engine-site-capture";

/**
 * Proposed experiment v5: automatic lead triage from captured homepage signals.
 * It does not replace the deterministic audit v4 or any production threshold; it
 * is graded separately against the answer key before anyone relies on it.
 *
 * WRONG  — not an independent single-market operator (generic city-named domain
 *          with no street address, or a location page of a multi-location brand).
 * STRONG — a provable problem that costs calls or quotes: no phone layout,
 *          sideways scrolling, a years-stale site, or a weak call/quote path.
 * WEAK   — everything else (the website broadly works).
 */
export const ENGINE_LEAD_RULES_VERSION = "engine-lead-rules-v5-experiment" as const;
export type EngineLeadLabel = "STRONG" | "WEAK" | "WRONG";
export type EngineLeadDecision = { label: EngineLeadLabel; reasons: string[] };

const CITY = /kitchener|waterloo|cambridge|guelph|tricity|kw/i;
const TRADE = /roof|hvac|heating|cooling|air|furnace|landscap|lawn/i;

export function wordpressMajor(generator: string | null): number | null {
  const match = generator?.match(/^WordPress\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function classifyEngineLead(websiteUrl: string, signals: EngineSiteSignals, currentYear: number): EngineLeadDecision {
  const url = new URL(signals.finalUrl || websiteUrl);
  const host = url.hostname.replace(/^www\./, "");
  const domainName = host.split(".")[0] ?? host;
  const wrong: string[] = [];
  if (/\/locations?\//i.test(url.pathname) || /\/locations?\//i.test(new URL(websiteUrl).pathname)) wrong.push("Location page of a multi-location brand.");
  if (CITY.test(domainName) && TRADE.test(domainName) && !signals.hasStreetAddress) wrong.push("Generic city-and-trade domain with no street address on the homepage.");
  if (wrong.length) return { label: "WRONG", reasons: wrong };

  const strong: string[] = [];
  if (signals.phoneLayoutWidth > 500) strong.push("No phone layout: a phone shows the shrunken desktop page.");
  if (signals.phoneScrollWidth > signals.phoneLayoutWidth * 1.2) strong.push("The phone view scrolls sideways.");
  const wp = wordpressMajor(signals.generator);
  if (wp !== null && wp < 5) strong.push(`Runs WordPress ${wp}, which is years out of support.`);
  if (signals.copyrightYear !== null && signals.copyrightYear <= currentYear - 6) strong.push(`Footer last updated ${signals.copyrightYear}.`);
  if (!signals.phoneTapToCall && !signals.quoteAction) strong.push("No tap-to-call and no quote or booking button.");
  else if (!signals.phoneTapToCall && signals.wordCount < 300) strong.push("No tap-to-call on a very thin homepage.");
  else if (!signals.quoteAction && signals.wordCount < 250) strong.push("No quote or booking button on a very thin homepage.");
  return strong.length ? { label: "STRONG", reasons: strong } : { label: "WEAK", reasons: ["The website broadly works on desktop and phone."] };
}

/** Fixed tuning/holdout split, chosen by a hash of the review ID before tuning. */
export function evaluationSplit(reviewId: string): "TUNE" | "HOLDOUT" {
  return createHash("sha256").update(`m3-split-v1:${reviewId}`).digest()[0]! < 154 ? "TUNE" : "HOLDOUT";
}
