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
export type EngineReasonCode = "LOCATION_PAGE" | "GENERIC_DOMAIN" | "NO_PHONE_LAYOUT" | "SIDEWAYS_SCROLL" | "OLD_WORDPRESS" | "STALE_FOOTER"
  | "NO_CALL_OR_QUOTE" | "NO_CALL_THIN" | "NO_QUOTE_THIN" | "WORKS";
export type EngineLeadDecision = { label: EngineLeadLabel; reasons: string[]; codes: EngineReasonCode[] };

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
  const wrong: [EngineReasonCode, string][] = [];
  if (/\/locations?\//i.test(url.pathname) || /\/locations?\//i.test(new URL(websiteUrl).pathname)) wrong.push(["LOCATION_PAGE", "Location page of a multi-location brand."]);
  if (CITY.test(domainName) && TRADE.test(domainName) && !signals.hasStreetAddress) wrong.push(["GENERIC_DOMAIN", "Generic city-and-trade domain with no street address on the homepage."]);
  if (wrong.length) return { label: "WRONG", reasons: wrong.map(([, text]) => text), codes: wrong.map(([code]) => code) };

  const strong: [EngineReasonCode, string][] = [];
  if (signals.phoneLayoutWidth > 500) strong.push(["NO_PHONE_LAYOUT", "No phone layout: a phone shows the shrunken desktop page."]);
  if (signals.phoneScrollWidth > signals.phoneLayoutWidth * 1.2) strong.push(["SIDEWAYS_SCROLL", "The phone view scrolls sideways."]);
  const wp = wordpressMajor(signals.generator);
  if (wp !== null && wp < 5) strong.push(["OLD_WORDPRESS", `Runs WordPress ${wp}, which is years out of support.`]);
  if (signals.copyrightYear !== null && signals.copyrightYear <= currentYear - 6) strong.push(["STALE_FOOTER", `Footer last updated ${signals.copyrightYear}.`]);
  if (!signals.phoneTapToCall && !signals.quoteAction) strong.push(["NO_CALL_OR_QUOTE", "No tap-to-call and no quote or booking button."]);
  else if (!signals.phoneTapToCall && signals.wordCount < 300) strong.push(["NO_CALL_THIN", "No tap-to-call on a very thin homepage."]);
  else if (!signals.quoteAction && signals.wordCount < 250) strong.push(["NO_QUOTE_THIN", "No quote or booking button on a very thin homepage."]);
  return strong.length
    ? { label: "STRONG", reasons: strong.map(([, text]) => text), codes: strong.map(([code]) => code) }
    : { label: "WEAK", reasons: ["The website broadly works on desktop and phone."], codes: ["WORKS"] };
}

/** Fixed tuning/holdout split, chosen by a hash of the review ID before tuning. */
export function evaluationSplit(reviewId: string): "TUNE" | "HOLDOUT" {
  return createHash("sha256").update(`m3-split-v1:${reviewId}`).digest()[0]! < 154 ? "TUNE" : "HOLDOUT";
}

const CALL_NOTE: Partial<Record<EngineReasonCode, string>> = {
  NO_PHONE_LAYOUT: "On a phone, your site shows the full desktop page shrunk down, so it is hard to read and tap.",
  SIDEWAYS_SCROLL: "On a phone, your homepage is wider than the screen, so visitors have to scroll sideways.",
  OLD_WORDPRESS: "Your site runs on a WordPress version that stopped getting security updates years ago.",
  STALE_FOOTER: "The footer still shows an old year, which can make the site look unmaintained to new customers.",
  NO_CALL_OR_QUOTE: "From a phone there is no one-tap call button and no quote or booking button on the homepage.",
  NO_CALL_THIN: "There is no one-tap call button on phones, and the homepage says very little about your services.",
  NO_QUOTE_THIN: "There is no quote or booking button, and the homepage says very little about your services.",
};

/** One or two factual sentences an owner could mention. A draft only; owners approve wording. */
export function callNotes(codes: readonly string[]): string[] {
  return codes.map((code) => CALL_NOTE[code as EngineReasonCode]).filter((note): note is string => Boolean(note)).slice(0, 2);
}
