import type { Browser } from "playwright";

import {
  auditWebsiteDeterministically,
  type DeterministicWebsiteAuditInput,
  type DeterministicWebsiteAuditResult,
} from "./website-audit";

/**
 * Local, automatic homepage capture for the deterministic website audit.
 *
 * One homepage view at desktop and one at phone width, no forms, no clicks, no
 * downloads. Page text lives only in memory for the audit; callers persist only
 * the audit result and the derived signals below.
 */
export const ENGINE_SITE_CAPTURE_VERSION = "engine-site-capture-v1" as const;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
// Builders such as Wix choose their phone layout from the user agent, so the phone view must look like a phone.
const PHONE_USER_AGENT = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const NAVIGATION_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_500;

export type EngineSiteSignals = {
  finalUrl: string;
  /** The business's own page title, used as its display name. */
  siteTitle?: string | null;
  /** The site's declared name (og:site_name), when present. */
  siteName?: string | null;
  statusCode: number;
  copyrightYear: number | null;
  generator: string | null;
  hasStreetAddress: boolean;
  phoneLayoutWidth: number;
  phoneScrollWidth: number;
  phoneTapToCall: boolean;
  desktopTapToCall: boolean;
  quoteAction: boolean;
  wordCount: number;
};

export type EngineSiteCapture =
  | { status: "CAPTURED"; audit: DeterministicWebsiteAuditResult; signals: EngineSiteSignals }
  | { status: "UNREACHABLE"; audit: DeterministicWebsiteAuditResult; reason: string };

type DesktopFacts = {
  title: string | null; siteName: string | null; metaDescription: string | null; visibleText: string; generator: string | null;
  actions: { kind: "PHONE" | "QUOTE" | "BOOK" | "CONTACT"; label: string; href: string | null; visible: boolean; aboveFold: boolean }[];
  forms: { visible: boolean; hasSubmitControl: boolean; disabled: boolean; actionUrl: string | null }[];
  structuredDataTypes: string[];
};
type PhoneFacts = { layoutWidth: number; scrollWidth: number; menuVisible: boolean; minPrimaryTap: number | null; tapToCall: boolean };

/* Runs inside the page. Kept dependency-free and side-effect free. */
function readDesktop(): DesktopFacts {
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
  };
  const kindOf = (href: string | null, text: string) => {
    if (href?.startsWith("tel:")) return "PHONE" as const;
    if (/quote|estimate/i.test(text)) return "QUOTE" as const;
    if (/\bbook|schedul|appointment/i.test(text)) return "BOOK" as const;
    if (/\bcall\b/i.test(text)) return "PHONE" as const;
    if (/contact/i.test(text)) return "CONTACT" as const;
    return null;
  };
  const actions: DesktopFacts["actions"] = [];
  for (const el of Array.from(document.querySelectorAll("a, button"))) {
    const href = el.getAttribute("href");
    const label = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const kind = kindOf(href, label);
    if (!kind || (!label && !href)) continue;
    const isVisible = visible(el);
    actions.push({ kind, label: label || kind, href: href ? href.slice(0, 2048) : null, visible: isVisible, aboveFold: isVisible && el.getBoundingClientRect().top < window.innerHeight });
    if (actions.length >= 100) break;
  }
  const forms = Array.from(document.forms).slice(0, 30).map((form) => ({
    visible: visible(form),
    hasSubmitControl: Boolean(form.querySelector("button, input[type=submit], input[type=image]")),
    disabled: Boolean(form.querySelector("fieldset[disabled]")),
    actionUrl: (() => { try { return form.action ? new URL(form.action, location.href).toString() : null; } catch { return null; } })(),
  }));
  const structuredDataTypes: string[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const parsed = JSON.parse(script.textContent ?? "") as unknown;
      const stack = [parsed];
      while (stack.length && structuredDataTypes.length < 50) {
        const item = stack.pop();
        if (Array.isArray(item)) stack.push(...item);
        else if (item && typeof item === "object") {
          const type = (item as Record<string, unknown>)["@type"];
          if (typeof type === "string") structuredDataTypes.push(type.slice(0, 120));
          const graph = (item as Record<string, unknown>)["@graph"];
          if (graph) stack.push(graph);
        }
      }
    } catch { /* Invalid structured data counts as absent. */ }
  }
  return {
    title: document.title.trim().slice(0, 300) || null,
    siteName: document.querySelector('meta[property="og:site_name"]')?.getAttribute("content")?.trim().slice(0, 120) || null,
    metaDescription: document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim().slice(0, 600) || null,
    visibleText: (document.body?.innerText ?? "").slice(0, 100_000),
    generator: document.querySelector('meta[name="generator"]')?.getAttribute("content")?.slice(0, 120) ?? null,
    actions, forms, structuredDataTypes: [...new Set(structuredDataTypes)],
  };
}

function readPhone(): PhoneFacts {
  const primary = Array.from(document.querySelectorAll('a[href^="tel:"], a, button')).filter((el) => {
    const text = (el.textContent ?? "").toLowerCase();
    return (el.getAttribute("href") ?? "").startsWith("tel:") || /quote|estimate|book|call/.test(text);
  }).map((el) => el.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
  const top = Array.from(document.querySelectorAll("a, button")).some((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top < 200;
  });
  return {
    layoutWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    menuVisible: top,
    minPrimaryTap: primary.length ? Math.round(Math.min(...primary.map((rect) => Math.min(rect.width, rect.height)))) : null,
    tapToCall: Array.from(document.querySelectorAll('a[href^="tel:"]')).some((el) => el.getBoundingClientRect().width > 0),
  };
}

const TRUST_PATTERNS: [RegExp, DeterministicWebsiteAuditInput["pages"][number]["trustSignals"][number]][] = [
  [/testimonial/i, "TESTIMONIAL"], [/review|rated|stars?\b/i, "REVIEW"], [/gallery|our work|projects/i, "PROJECT_GALLERY"],
  [/our team|meet the/i, "TEAM"], [/certified|licensed|insured|tssa|accredited/i, "CREDENTIAL"], [/warrant|guarantee/i, "WARRANTY"],
  [/how it works|our process/i, "PROCESS"], [/case stud/i, "CASE_STUDY"],
];

export function copyrightYear(text: string): number | null {
  const years = [...text.matchAll(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((match) => Number(match[1]));
  return years.length ? Math.max(...years) : null;
}

export function hasStreetAddress(text: string): boolean {
  return /\b\d{1,5}\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?\s+(?:St|Street|Rd|Road|Ave|Avenue|Dr|Drive|Blvd|Boulevard|Cres|Crescent|Way|Ct|Court|Pl|Place|Line|Pkwy|Parkway|Hwy|Highway)\b/.test(text);
}

function baseInput(business: { businessId: string; businessName: string; niche: string; websiteUrl: string }, capturedAt: string) {
  return {
    businessId: business.businessId, businessName: business.businessName, niche: business.niche,
    expectedServices: [business.niche.toLowerCase()], expectedLocations: ["Kitchener", "Waterloo", "Cambridge"],
    sourceEvidenceUrl: business.websiteUrl, capturedAt, desktopArtifactRef: null, mobileArtifactRef: null, domArtifactRef: null,
    resourceProbes: [],
  };
}

export async function captureAndAuditSite(
  browser: Browser,
  business: { businessId: string; businessName: string; niche: string; websiteUrl: string },
  clock: () => Date = () => new Date(),
): Promise<EngineSiteCapture> {
  const capturedAt = clock().toISOString();
  const desktop = await browser.newContext({ viewport: DESKTOP, javaScriptEnabled: true, serviceWorkers: "block", acceptDownloads: false });
  const phone = await browser.newContext({ viewport: PHONE, userAgent: PHONE_USER_AGENT, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block", acceptDownloads: false });
  // tsx/esbuild wraps named functions with a __name helper that does not exist in the page.
  for (const context of [desktop, phone]) await context.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
  try {
    const page = await desktop.newPage();
    const response = await page.goto(business.websiteUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch((error: unknown) => error as Error);
    const statusCode = response instanceof Error || !response ? 0 : response.status();
    if (!response || response instanceof Error || statusCode < 200 || statusCode >= 400) {
      const reason = response instanceof Error ? response.message.split("\n")[0]!.slice(0, 200) : `HTTP ${statusCode}`;
      const audit = auditWebsiteDeterministically({
        ...baseInput(business, capturedAt), siteState: "UNREACHABLE", requestedUrl: business.websiteUrl, finalUrl: null,
        statusCode, redirectCount: 0, pageSetComplete: false, pages: [],
        mobile: { captured: false, horizontalOverflow: null, navigationUsable: null, textReadable: null, minimumTapTargetPx: null },
      });
      return { status: "UNREACHABLE", audit, reason };
    }
    await page.waitForTimeout(SETTLE_MS);
    const facts = await page.evaluate(readDesktop);
    const redirects = response.request().redirectedFrom() ? 1 : 0;
    const phonePage = await phone.newPage();
    await phonePage.goto(business.websiteUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await phonePage.waitForTimeout(SETTLE_MS);
    const phoneFacts = await phonePage.evaluate(readPhone);
    const text = facts.visibleText;
    const audit = auditWebsiteDeterministically({
      ...baseInput(business, capturedAt), siteState: "CAPTURED", requestedUrl: business.websiteUrl, finalUrl: page.url(),
      // Views were measured live but deliberately not stored (derived-facts-only retention).
      desktopArtifactRef: `not-retained:${ENGINE_SITE_CAPTURE_VERSION}:desktop:${capturedAt}`,
      mobileArtifactRef: `not-retained:${ENGINE_SITE_CAPTURE_VERSION}:phone:${capturedAt}`,
      domArtifactRef: `not-retained:${ENGINE_SITE_CAPTURE_VERSION}:dom:${capturedAt}`,
      statusCode, redirectCount: redirects, pageSetComplete: false,
      pages: [{
        kind: "HOME", url: page.url(), title: facts.title, metaDescription: facts.metaDescription, visibleText: text,
        actions: facts.actions, forms: facts.forms,
        trustSignals: TRUST_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, signal]) => signal),
        structuredDataTypes: facts.structuredDataTypes, contentComplete: true,
        evidenceCoverage: { desktopRenderCaptured: true, actionVisibilityComplete: true, formVisibilityComplete: true },
      }],
      mobile: {
        captured: true,
        horizontalOverflow: phoneFacts.scrollWidth > phoneFacts.layoutWidth + 2,
        navigationUsable: phoneFacts.menuVisible,
        // Without a device-width viewport the phone lays the page out ~980px wide and shrinks the text.
        textReadable: phoneFacts.layoutWidth <= 500,
        minimumTapTargetPx: phoneFacts.minPrimaryTap === null ? null : Math.min(phoneFacts.minPrimaryTap, 500),
      },
    });
    return {
      status: "CAPTURED", audit,
      signals: {
        finalUrl: page.url(), siteTitle: facts.title?.slice(0, 120) ?? null, siteName: facts.siteName, statusCode, copyrightYear: copyrightYear(text), generator: facts.generator,
        hasStreetAddress: hasStreetAddress(text), phoneLayoutWidth: phoneFacts.layoutWidth, phoneScrollWidth: phoneFacts.scrollWidth,
        phoneTapToCall: phoneFacts.tapToCall, desktopTapToCall: facts.actions.some((action) => action.href?.startsWith("tel:") && action.visible),
        quoteAction: facts.actions.some((action) => (action.kind === "QUOTE" || action.kind === "BOOK") && action.visible),
        wordCount: text.split(/\s+/).filter(Boolean).length,
      },
    };
  } finally {
    await desktop.close();
    await phone.close();
  }
}

/** A readable business name from the site's own name, title and address. */
export function businessDisplayName(url: string, siteTitle?: string | null, siteName?: string | null): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const hostKey = host.split(".")[0]!.toLowerCase().replace(/[^a-z0-9]/g, "");
  const generic = /^(home|welcome|index|untitled)$/i;
  const overlap = (text: string) => {
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
    return words.filter((word) => hostKey.includes(word)).length;
  };
  if (siteName && !generic.test(siteName.trim()) && overlap(siteName) > 0) return siteName.trim();
  const parts = (siteTitle ?? "").split(/\s[|–—:-]\s|\s\|\s?|\s?\|\s/).map((part) => part.trim()).filter((part) => part && !generic.test(part));
  const best = parts.map((part) => ({ part, score: overlap(part) })).sort((left, right) => right.score - left.score)[0];
  if (best && best.score > 0) return best.part.replace(/^www./i, "").slice(0, 80);
  return host;
}
