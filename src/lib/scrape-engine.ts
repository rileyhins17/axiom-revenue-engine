// Historical parsing helpers only. Normalized URLs are not approved network destinations.
import { rejectLegacyBrowserWork } from "@/lib/retired-legacy-browser";

import type { ScrapeJobEventPayload, ScrapeLeadWriteInput } from "@/lib/scrape-jobs";

import { type ScrapeQualityStatus } from "@/lib/scrape-quality";

export type MapsListing = {
  ariaLabel: string;
  cardText: string;
  name: string;
  url: string;
  websiteUrl: string;
};

export type CollectedMapsTarget = {
  address: string;
  category: string;
  detailMode: "direct" | "fallback";
  phone: string;
  ratingText: string;
  title: string;
  website: string;
};

export interface ExecuteScrapeJobInput {
  city: string;
  country: string;
  existingDedupeKeys: string[];
  jobId: string;
  maxDepth: number;
  niche: string;
  persistLead: (lead: ScrapeLeadWriteInput) => Promise<void>;
  radius: string;
  region: string;
  sendEvent: (data: ScrapeJobEventPayload) => Promise<void>;
  shouldAbort?: () => boolean;
  skipMapsDetailPages?: boolean;
}

export interface ExecuteScrapeJobResult {
  aborted: boolean;
  avgScore: number;
  leadsFound: number;
  qualityIssues?: string[];
  qualityStatus?: ScrapeQualityStatus;
  targetsFound?: number;
  targetsWithCategory?: number;
  targetsWithPhone?: number;
  targetsWithRatingReviews?: number;
  targetsWithWebsite?: number;
  withEmail: number;
}

export type MapsDetailSnapshot = {
  addressText: string;
  bodyText: string;
  categoryText: string;
  h1: string;
  metaTitle: string;
  ogTitle: string;
  phoneDataId: string;
  phoneHref: string;
  ratingAriaLabel: string;
  ratingText: string;
  websiteHref: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeWebsiteUrl(value: string): string {
  const clean = normalizeWhitespace(value);
  if (!clean) return "";

  // Unwrap Google redirect URLs (e.g. google.com/url?q=https%3A%2F%2Fexample.com)
  const googleRedirectMatch = /[?&](?:q|url)=(https?(?:%3A|:)[^&#]+)/i.exec(clean);
  if (googleRedirectMatch) {
    try {
      const decoded = decodeURIComponent(googleRedirectMatch[1]);
      return normalizeWebsiteUrl(decoded);
    } catch {
      return "";
    }
  }

  try {
    const url = new URL(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`);
    // Filter any google.com URL (maps redirects, /url wrapper, etc.)
    if (url.hostname.includes("google.")) {
      return "";
    }
    return url.toString();
  } catch {
    if (/google\.[^/]*\/maps|maps\.google\./i.test(clean)) {
      return "";
    }
    return clean;
  }
}

function extractWebsiteTokenFromText(value: string): string {
  const matches = value.matchAll(
    /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s<>"')\]]*)?/gi,
  );

  for (const match of matches) {
    const index = match.index ?? 0;
    const previousChar = value[index - 1] || "";
    const candidate = match[0].replace(/[),.;:]+$/g, "");
    if (previousChar === "@" || candidate.includes("@")) continue;
    if (/google\.|maps\.|goo\.gl|gstatic\.|ggpht\./i.test(candidate)) continue;

    const normalized = normalizeWebsiteUrl(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (normalized) return normalized;
  }

  return "";
}

function extractWebsiteFromBodyText(bodyText: string): string {
  const lines = bodyText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // Primary: look for the "Website" label and read the next non-empty line
  const websiteIdx = lines.findIndex((l) => /^website$/i.test(l));
  if (websiteIdx >= 0 && websiteIdx + 1 < lines.length) {
    const candidate = lines[websiteIdx + 1];
    const website = extractWebsiteTokenFromText(candidate);
    if (website) return website;
  }

  for (const line of lines) {
    if (/\b(?:website|visit website|open website)\b/i.test(line)) {
      const website = extractWebsiteTokenFromText(line);
      if (website) return website;
    }
  }

  // Secondary: any line that looks like a bare domain (no spaces, has a TLD)
  const domainLike = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9\-.]+\.[a-z]{2,}(?:\/\S*)?$/i;
  const candidates: string[] = [];
  for (const line of lines) {
    if (domainLike.test(line) && line.length < 120 && !/google\.|maps\.|goo\.gl/i.test(line)) {
      candidates.push(line);
    }
  }

  const candidate = candidates.at(-1);
  return candidate ? normalizeWebsiteUrl(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`) : "";
}

function normalizePhoneText(phone: string): string {
  return normalizeWhitespace(phone).replace(/[.,;]+$/g, "");
}

function hasPhoneLikeText(value: string): boolean {
  return /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/.test(value);
}

function isLikelyHoursText(value: string): boolean {
  return /^(open|closed|opens|closes|hours?|website|call|directions|share|save)$/i.test(value) ||
    /\b(open|closed|closes|opens)\b/i.test(value);
}

function isLikelyAddressText(value: string): boolean {
  // Street-number + street-type pattern (works for any city, not a hardcoded list)
  if (/\d{1,6}\s+\w/.test(value) && /(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|way|ln|lane|ct|court|hwy|highway|pkwy|parkway|unit|suite|floor)\b/i.test(value)) {
    return true;
  }
  // Canadian postal code present → almost certainly an address fragment
  if (/[a-z]\d[a-z]\s*\d[a-z]\d/i.test(value)) {
    return true;
  }
  return false;
}

function extractPhoneFromText(value: string): string {
  const match = value.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  return match ? normalizePhoneText(match[0]) : "";
}

function cleanMapsAddressCandidate(value: string): string {
  const clean = normalizeWhitespace(value);
  if (!clean) {
    return "";
  }

  return normalizeWhitespace(
    clean
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/\s*(?:Closed|Open now|Open|Opens|Closes|Hours|Website|Directions|Share|Save|Photos|Phone)\b.*$/i, "")
      .replace(/\s*\(?\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\)?\s*$/i, "")
      .replace(/\s*[\u2022\u00b7]\s*$/, ""),
  );
}

function isMeaningfulMapsTitle(value: string): boolean {
  const clean = normalizeWhitespace(value);
  return Boolean(clean) && clean.length >= 3 && !/^google maps$/i.test(clean);
}

function isMeaningfulMapsCategory(value: string, title: string): boolean {
  const clean = normalizeWhitespace(value);
  const normalizedTitle = normalizeWhitespace(title);
  if (!clean || clean.length > 80) {
    return false;
  }

  if (/^\d+(?:\.\d+)?$/.test(clean)) {
    return false;
  }

  if (/^google maps$/i.test(clean)) {
    return false;
  }

  if (/^(see|saved|recents|get app|search|share|directions|website|photos|hours?|open|closed|call|menu|overview|nearby|about)$/i.test(clean)) {
    return false;
  }

  if (/\b(get app|saved|recents|search this area|search this place|share|directions|website|photos|menu|overview|nearby)\b/i.test(clean)) {
    return false;
  }

  if (/[\p{S}\p{C}]/u.test(clean.replace(/[&'â€™.\-]/g, ""))) {
    return false;
  }

  const cleanLower = clean.toLowerCase();
  const titleLower = normalizedTitle.toLowerCase();
  if (clean === normalizedTitle || (titleLower && cleanLower.startsWith(titleLower))) {
    return false;
  }

  const cleanWords = cleanLower.split(/[^a-z0-9]+/).filter(Boolean);
  const titleWords = titleLower.split(/[^a-z0-9]+/).filter(Boolean);
  const sharedWordCount = cleanWords.filter((word) => titleWords.includes(word)).length;
  if (cleanWords.length > 3 && sharedWordCount / Math.max(cleanWords.length, 1) >= 0.7) {
    return false;
  }

  if (/[<>]/.test(clean) || /<\/?[a-z]/i.test(clean)) {
    return false;
  }

  if (/^(overview|about|directions|nearby|save|share|website|address)$/i.test(clean)) {
    return false;
  }

  if (/^(restaurants?|hotels?|things to do|transit|parking|pharmacies|atms)$/i.test(clean)) {
    return false;
  }

  return true;
}

function extractMapsCategoryFromText(value: string, title: string): string {
  const clean = normalizeWhitespace(value);
  const normalizedTitle = normalizeWhitespace(title);
  if (!clean) {
    return "";
  }

  let working = clean;
  if (normalizedTitle) {
    const lowerWorking = working.toLowerCase();
    const lowerTitle = normalizedTitle.toLowerCase();
    if (lowerWorking.startsWith(lowerTitle)) {
      working = working.slice(normalizedTitle.length).trim();
    }
  }

  working = working.replace(/^\d+(?:\.\d+)?\s*/, "").trim();
  working = working.replace(/^[ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·\-ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â|:]+\s*/u, "").trim();

  const cutTokens = [
    /(?:^|\s)(?:ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢|ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·|\||ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â|-)(?:\s|$)/,
    /\bClosed\b/i,
    /\bOpen now\b/i,
    /\bOpens\b/i,
    /\bHours\b/i,
    /\bWebsite\b/i,
    /\bDirections\b/i,
    /\bShare\b/i,
    /\bSave\b/i,
    /\bPhotos\b/i,
    /\bPhone\b/i,
    /\bAddress\b/i,
    /\d{1,6}\s+[A-Za-z0-9'ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢.\-/& ]{2,80}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Ln|Lane|Ct|Court|Cres|Crescent|Pkwy|Parkway|Pl|Place|Ter|Terrace|Hwy|Highway)\b/i,
    /\d{1,6}\s+[A-Za-z0-9'ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢.\-/& ]{2,80}\s+(?:Kitchener|Waterloo|Guelph|Hamilton|Cambridge|Toronto|London|Burlington|Ontario|ON)\b/i,
  ];

  let endIndex = working.length;
  for (const token of cutTokens) {
    const matchIndex = working.search(token);
    if (matchIndex > 0 && matchIndex < endIndex) {
      endIndex = matchIndex;
    }
  }

  let candidate = working.slice(0, endIndex).trim();
  candidate = candidate.replace(/^\d+(?:\.\d+)?\s*/, "").trim();
  candidate = candidate.replace(/^[ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·\-ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â|:]+\s*/u, "").trim();

  if (!candidate || candidate.length > 80) {
    return "";
  }

  if (isLikelyHoursText(candidate) || hasPhoneLikeText(candidate) || isLikelyAddressText(candidate)) {
    return "";
  }

  if (/reviews?|ratings?|stars?/i.test(candidate)) {
    return "";
  }

  if (/^google maps$/i.test(candidate)) {
    return "";
  }

  return candidate;
}

function extractAddressFromMapsText(text: string, title: string): string {
  const source = normalizeWhitespace(text);
  const normalizedTitle = normalizeWhitespace(title);
  if (!source) {
    return "";
  }

  let tail = source;
  if (normalizedTitle) {
    const index = source.toLowerCase().indexOf(normalizedTitle.toLowerCase());
    if (index >= 0) {
      tail = source.slice(index + normalizedTitle.length).trim();
    }
  }

  const patterns = [
    /\d{1,6}\s+[A-Za-z0-9'Ã¢â‚¬â„¢\.\-/& ]{2,80}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Ln|Lane|Ct|Court|Cres|Crescent|Pkwy|Parkway|Pl|Place|Ter|Terrace|Hwy|Highway)\b[^|]{0,80}/i,
    /\d{1,6}\s+[A-Za-z0-9'Ã¢â‚¬â„¢\.\-/& ]{2,80}\s+(?:Kitchener|Waterloo|Guelph|Hamilton|Cambridge|Toronto|London|Burlington|Ontario|ON)\b[^|]{0,80}/i,
  ];

  for (const pattern of patterns) {
    const match = tail.match(pattern) || source.match(pattern);
    if (match) {
      return cleanMapsAddressCandidate(match[0]);
    }
  }

  return "";
}

function extractCategoryFromMapsText(text: string, title: string): string {
  return extractMapsCategoryFromText(text, title);
}

function extractCategoryFromBodyText(bodyText: string, title: string): string {
  const lines = bodyText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const normalizedTitle = normalizeWhitespace(title).toLowerCase();
  const titleIndex = lines.findIndex((line) => {
    const lower = line.toLowerCase();
    return Boolean(lower && normalizedTitle && (lower === normalizedTitle || lower.includes(normalizedTitle) || normalizedTitle.includes(lower)));
  });
  const scanLines = titleIndex >= 0 ? lines.slice(titleIndex + 1) : lines;

  for (const line of scanLines) {
    const lower = line.toLowerCase();
    if (!line || lower === normalizedTitle) continue;
    if (/^\d+(?:\.\d+)?$/.test(line)) continue;

    const dotIndex = line.search(/[\u00B7\u2022]/u);
    if (dotIndex > 0) {
      let candidate = normalizeWhitespace(line.slice(0, dotIndex));
      candidate = candidate.replace(/^\d+(?:\.\d+)?\s*/, "").trim();
      if (!candidate || candidate.length > 40) continue;
      if (/^google maps$/i.test(candidate)) continue;
      if (isLikelyHoursText(candidate) || hasPhoneLikeText(candidate) || isLikelyAddressText(candidate)) continue;
      return candidate;
    }

    if (line.length <= 60 && isMeaningfulMapsCategory(line, title)) {
      return line;
    }

    if (isLikelyHoursText(line) || hasPhoneLikeText(line) || isLikelyAddressText(line)) {
      continue;
    }
    if (/reviews?|ratings?|stars?|open now|closed|hours?|website|directions|save|share|address/i.test(line)) {
      continue;
    }
  }

  return "";
}

function buildMapsListingFallback(listing: MapsListing): {
  address: string;
  category: string;
  phone: string;
  ratingText: string;
  title: string;
  website: string;
} {
  const rawText = [listing.ariaLabel, listing.cardText].filter(Boolean).join("\n");
  const sourceText = normalizeWhitespace(rawText);
  const title = normalizeWhitespace(listing.name || sourceText.split(" ").slice(0, 8).join(" "));
  const ratingText = sourceText;
  return {
    address: extractAddressFromMapsText(sourceText, title),
    category: extractCategoryFromBodyText(rawText, title) || extractCategoryFromBodyText(sourceText, title) || extractMapsCategoryFromText(sourceText, title),
    phone: extractPhoneFromText(sourceText),
    ratingText,
    title,
    website: normalizeWebsiteUrl(listing.websiteUrl) || extractWebsiteFromBodyText(rawText),
  };
}

function scoreMapsDetailSnapshot(raw: MapsDetailSnapshot, fallbackTitle: string): number {
  const bodyText = raw.bodyText.replace(/\r\n/g, "\n");
  const titleCandidate = normalizeWhitespace(raw.h1 || raw.ogTitle || raw.metaTitle || fallbackTitle);
  let score = isMeaningfulMapsTitle(titleCandidate) ? 1 : 0;

  if (normalizeWebsiteUrl(raw.websiteHref) || extractWebsiteFromBodyText(bodyText)) score += 3;
  if (raw.phoneDataId || raw.phoneHref || extractPhoneFromText(bodyText)) score += 2;
  if (cleanMapsAddressCandidate(raw.addressText.replace(/^Address:\s*/i, "")) || extractAddressFromMapsText(bodyText, titleCandidate)) score += 2;
  if (extractMapsCategoryFromText(raw.categoryText, titleCandidate) || extractCategoryFromBodyText(bodyText, titleCandidate)) score += 1;
  if (raw.ratingAriaLabel || raw.ratingText) score += 1;

  return score;
}

function extractMapsDetailFromSnapshot(
  raw: MapsDetailSnapshot,
  place: MapsListing,
  fallbackTitle: string,
  listingFallback: Omit<CollectedMapsTarget, "detailMode">,
): CollectedMapsTarget {
  const bodyText = raw.bodyText.replace(/\r\n/g, "\n");

  const titleCandidate = normalizeWhitespace(raw.h1 || raw.ogTitle || raw.metaTitle || "");
  const title = isMeaningfulMapsTitle(titleCandidate)
    ? titleCandidate
    : normalizeWhitespace(fallbackTitle || listingFallback.title || place.name);

  const website =
    normalizeWebsiteUrl(raw.websiteHref) ||
    extractWebsiteFromBodyText(bodyText) ||
    listingFallback.website;

  const phone = normalizePhoneText(
    raw.phoneDataId.replace("phone:tel:", "") ||
      raw.phoneHref.replace(/^tel:/i, "") ||
      extractPhoneFromText(bodyText) ||
      listingFallback.phone,
  );

  const address = normalizeWhitespace(
    cleanMapsAddressCandidate(raw.addressText.replace(/^Address:\s*/i, "")) ||
      extractAddressFromMapsText(bodyText, title) ||
      listingFallback.address,
  );

  const directCategory = extractCategoryFromBodyText(bodyText, title);
  const category = normalizeWhitespace(
    extractMapsCategoryFromText(raw.categoryText, title) ||
      directCategory ||
      extractCategoryFromMapsText(bodyText, title) ||
      listingFallback.category,
  );
  const finalCategory = isMeaningfulMapsCategory(category, title)
    ? category
    : (isMeaningfulMapsCategory(listingFallback.category, title) ? listingFallback.category : "");

  const ratingText = normalizeWhitespace(
    raw.ratingAriaLabel || raw.ratingText || listingFallback.ratingText || bodyText,
  );

  return {
    address,
    category: finalCategory,
    detailMode: scoreMapsDetailSnapshot(raw, fallbackTitle) >= 3 ? "direct" : "fallback",
    phone,
    ratingText,
    title,
    website,
  };
}

export const scrapeEngineTestInternals = {
  buildMapsListingFallback,
  extractMapsDetailFromSnapshot,
  extractWebsiteFromBodyText,
  normalizeWebsiteUrl,
  scoreMapsDetailSnapshot,
};

export async function executeScrapeJob(input: ExecuteScrapeJobInput): Promise<ExecuteScrapeJobResult> {
  void input;
  return rejectLegacyBrowserWork();
}





