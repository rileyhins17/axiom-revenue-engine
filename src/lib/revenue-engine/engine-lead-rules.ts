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
export const ENGINE_LEAD_RULES_VERSION = "engine-lead-rules-v7" as const;
/** Points needed before a site is called weak, and at least one of them must be a visible, serious problem. */
export const STRONG_THRESHOLD = 3;
export type EngineLeadLabel = "STRONG" | "WEAK" | "WRONG";
export type EngineReasonCode = "LOCATION_PAGE" | "GENERIC_DOMAIN" | "NO_PHONE_LAYOUT" | "WIDE_ON_PHONE" | "NO_HTTPS" | "SIDEWAYS_SCROLL" | "OLD_WORDPRESS" | "STALE_FOOTER"
  | "NO_CALL_OR_QUOTE" | "NO_CALL_THIN" | "NO_QUOTE_THIN" | "WORKS";
export type EngineLeadDecision = { label: EngineLeadLabel; reasons: string[]; codes: EngineReasonCode[]; score?: number };

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

  // Serious problems (2 points) are visible the moment the site opens. Minor ones
  // (1 point) are weaker evidence and can only add weight to a serious problem.
  // Calibrated by screenshot review of every flagged site (scripts/audit-weak-sites.ts).
  const found: [EngineReasonCode, string, number][] = [];
  const shrunkOnPhone = signals.phoneLayoutWidth > 500;
  if (shrunkOnPhone && signals.phoneViewportMeta !== true) found.push(["NO_PHONE_LAYOUT", "No phone layout: a phone shows the shrunken desktop page.", 2]);
  else if (shrunkOnPhone) found.push(["WIDE_ON_PHONE", "Some content is wider than a phone screen, so the page zooms out.", 1]);
  if (!shrunkOnPhone && signals.phoneScrollWidth > signals.phoneLayoutWidth * 1.2) found.push(["SIDEWAYS_SCROLL", "The phone view scrolls sideways.", 2]);
  const wp = wordpressMajor(signals.generator);
  if (wp !== null && wp < 5) found.push(["OLD_WORDPRESS", `Runs WordPress ${wp}, which is years out of support.`, 2]);
  if (url.protocol === "http:") found.push(["NO_HTTPS", "No secure connection: browsers mark the site \"Not secure\".", 2]);
  if (signals.copyrightYear !== null && signals.copyrightYear <= currentYear - 5) found.push(["STALE_FOOTER", `Footer last updated ${signals.copyrightYear}.`, 1]);
  if (!signals.phoneTapToCall && !signals.desktopTapToCall && !signals.quoteAction) found.push(["NO_CALL_OR_QUOTE", "No tap-to-call and no quote or booking button.", 1]);
  else if (!signals.phoneTapToCall && signals.wordCount < 300) found.push(["NO_CALL_THIN", "No tap-to-call on a very thin homepage.", 1]);
  else if (!signals.quoteAction && signals.wordCount < 250) found.push(["NO_QUOTE_THIN", "No quote or booking button on a very thin homepage.", 1]);
  const score = found.reduce((sum, [, , points]) => sum + points, 0);
  const serious = found.some(([, , points]) => points >= 2);
  const ordered = [...found].sort((a, b) => b[2] - a[2]);
  return score >= STRONG_THRESHOLD && serious
    ? { label: "STRONG", reasons: ordered.map(([, text]) => text), codes: ordered.map(([code]) => code), score }
    : { label: "WEAK", reasons: found.length ? ["Minor issues only; the website broadly works.", ...ordered.map(([, text]) => text)] : ["The website broadly works on desktop and phone."], codes: found.length ? ordered.map(([code]) => code) : ["WORKS"], score };
}

/** Fixed tuning/holdout split, chosen by a hash of the review ID before tuning. */
export function evaluationSplit(reviewId: string): "TUNE" | "HOLDOUT" {
  return createHash("sha256").update(`m3-split-v1:${reviewId}`).digest()[0]! < 154 ? "TUNE" : "HOLDOUT";
}

const CALL_NOTE: Partial<Record<EngineReasonCode, string>> = {
  NO_HTTPS: "Your site doesn't use a secure connection, so browsers show a \"Not secure\" warning to visitors.",
  WIDE_ON_PHONE: "On a phone, part of your homepage is wider than the screen, so the page zooms out.",
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
