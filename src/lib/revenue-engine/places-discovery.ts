import { z } from "zod";

/**
 * Automatic discovery through Google Places API (New) Text Search.
 *
 * The engine keeps the place ID and the business's own website origin, then judges
 * the business from its own site.
 *
 * OWNER DECISION 2026-09-26 (Riley): Google's name, phone and address ARE stored on
 * EngineProspect so the call list works without a lookup per call. Google Maps
 * Platform terms only allow storing place IDs; the owner accepted the risk that the
 * API key could be suspended. Revisit before scaling or if Google objects.
 *
 * Off unless explicitly enabled with a key. Every run is bounded by a request cap
 * and a monthly cap checked before each request.
 */
export const PLACES_DISCOVERY_VERSION = "places-text-search-discovery-v1" as const;
export const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
/** websiteUri makes each request a Text Search Enterprise event (1,000 free per month as of 2026-09). */
/** rating and userRatingCount are Enterprise fields too, so they do not change what a request costs. */
export const PLACES_FIELD_MASK = "places.id,places.displayName,places.websiteUri,places.formattedAddress,places.types,places.businessStatus,places.nationalPhoneNumber,places.rating,places.userRatingCount,nextPageToken";
export const PLACES_MAX_REQUESTS_PER_RUN = 150;
export const PLACES_MAX_REQUESTS_PER_MONTH = 600;
/** Worst case if no free tier applied: US$28 per 1,000 Enterprise events. */
export const PLACES_WORST_CASE_USD_PER_REQUEST = 0.028;

export const DiscoveryCitySchema = z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE", "GUELPH", "BRANTFORD", "STRATFORD", "WOODSTOCK", "ELMIRA", "NEW_HAMBURG", "AYR", "BRESLAU"]);
export const DiscoveryNicheSchema = z.enum(["ROOFING", "HVAC", "LANDSCAPING", "PLUMBING", "ELECTRICAL"]);
export type DiscoveryCity = z.infer<typeof DiscoveryCitySchema>;
export type DiscoveryNiche = z.infer<typeof DiscoveryNicheSchema>;

/** Several phrasings per trade surface more businesses than one query's 60-result limit. */
export const QUERIES: Record<DiscoveryNiche, readonly string[]> = {
  ROOFING: ["roofing contractor", "roofer", "roof repair", "eavestrough and gutter company", "shingle roof replacement", "flat roof repair", "siding and soffit contractor"],
  HVAC: ["heating and air conditioning contractor", "furnace repair", "air conditioning installation", "HVAC company", "heat pump installer", "duct cleaning service", "boiler repair"],
  LANDSCAPING: ["landscaping company", "lawn care service", "interlock and patio contractor", "snow removal company", "tree service", "fence and deck builder", "sod and garden installation"],
  PLUMBING: ["plumber", "plumbing company", "drain cleaning service", "water heater installation", "sump pump installation", "emergency plumber", "bathroom plumbing contractor"],
  ELECTRICAL: ["electrician", "electrical contractor", "residential electrician", "generator installation", "EV charger installation", "electrical panel upgrade", "lighting installation contractor"],
};
export const CITY_NAME: Record<DiscoveryCity, string> = {
  KITCHENER: "Kitchener", WATERLOO: "Waterloo", CAMBRIDGE: "Cambridge", GUELPH: "Guelph", BRANTFORD: "Brantford", STRATFORD: "Stratford",
  WOODSTOCK: "Woodstock", ELMIRA: "Elmira", NEW_HAMBURG: "New Hamburg", AYR: "Ayr", BRESLAU: "Breslau",
};

const PlaceSchema = z.object({
  id: z.string().min(1).max(300),
  displayName: z.object({ text: z.string().max(300) }).partial().optional(),
  websiteUri: z.string().url().optional(),
  formattedAddress: z.string().max(500).optional(),
  types: z.array(z.string().max(80)).max(50).optional(),
  businessStatus: z.string().max(40).optional(),
  nationalPhoneNumber: z.string().max(40).optional(),
}).passthrough();
const TextSearchResponseSchema = z.object({ places: z.array(PlaceSchema).max(20).optional(), nextPageToken: z.string().max(20_000).optional() }).passthrough();

export type PlacesTransport = (request: { url: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json: unknown }>;
export type PlacesUsageLedger = { month: string; requests: number };

export type DiscoveredBusiness = {
  placeId: string;
  city: DiscoveryCity;
  niche: DiscoveryNiche;
  websiteUrl: string | null;
  /** Transient, for the owner summary and de-duplication only. */
  displayName: string;
  addressMentionsCity: boolean;
  /** Google's listed phone and address: the most reliable way to reach a trade business. */
  phone?: string | null;
  address?: string | null;
};

/**
 * The market area: Waterloo Region, Guelph, Brantford, Stratford and Woodstock (all eleven
 * towns, with a margin) but not Toronto, Hamilton or London. Without it Google also returns
 * same-named towns abroad: "roofer in Cambridge, Ontario" found Cambridge in England and
 * Maryland on 2026-09-28.
 */
export const MARKET_RECTANGLE = { low: { latitude: 42.95, longitude: -81.1 }, high: { latitude: 43.8, longitude: -79.95 } } as const;

export function buildTextSearchRequest(city: DiscoveryCity, niche: DiscoveryNiche, apiKey: string, pageToken?: string, query = QUERIES[niche][0]!) {
  return {
    url: PLACES_TEXT_SEARCH_URL,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": PLACES_FIELD_MASK },
    body: JSON.stringify({ textQuery: `${query} in ${CITY_NAME[city]}, Ontario`, regionCode: "CA", languageCode: "en", pageSize: 20, locationRestriction: { rectangle: MARKET_RECTANGLE }, ...(pageToken ? { pageToken } : {}) }),
  };
}

/**
 * An Ontario address, as Google formats it ("12 King St, Guelph, ON N1H 1A1, Canada") or as the
 * engine stores it (", Canada" removed). A missing address counts as in the market.
 */
export function inOntario(address: string | null | undefined): boolean {
  if (!address) return true;
  return /,\s*ON(?:\s+[A-Z]\d[A-Z](?:\s*\d[A-Z]\d)?)?\s*(?:,\s*Canada)?\s*$/.test(address.trim());
}

/** Wix's free sites live at a path (name.wixsite.com/site); every other site is judged from its homepage. */
export function siteAddress(websiteUri: string | undefined, origin: string): string {
  try {
    const url = new URL(websiteUri ?? "");
    if (/\.wixsite\.com$/i.test(url.hostname) && url.pathname.length > 1) return `https://${url.hostname.toLowerCase()}${url.pathname}`.slice(0, 300);
  } catch { /* fall through to the homepage */ }
  return origin;
}

export function websiteOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    // Social and directory pages are not the business's own website.
    if (/(^|\.)(facebook|instagram|linkedin|yelp|homestars|google|business\.site|linktr)\./i.test(url.hostname) || /business\.site$/i.test(url.hostname)) return null;
    return `https://${url.hostname.toLowerCase()}/`;
  } catch { return null; }
}

function currentMonth(now: Date) {
  return now.toISOString().slice(0, 7);
}

export async function discoverBusinesses(input: {
  apiKey: string | undefined;
  enabled: boolean;
  cells: { city: DiscoveryCity; niche: DiscoveryNiche; query?: string }[];
  transport: PlacesTransport;
  ledger: PlacesUsageLedger;
  saveLedger: (ledger: PlacesUsageLedger) => Promise<void>;
  maxPagesPerCell?: number;
  now?: () => Date;
}) {
  if (!input.enabled || !input.apiKey) throw new Error("Places discovery is off. Set AXIOM_PLACES_DISCOVERY_ENABLED=1 and a restricted key to run it.");
  const now = input.now ?? (() => new Date());
  let ledger = input.ledger.month === currentMonth(now()) ? { ...input.ledger } : { month: currentMonth(now()), requests: 0 };
  let runRequests = 0;
  const found = new Map<string, DiscoveredBusiness>();
  const stops: string[] = [];
  for (const cell of input.cells) {
    let pageToken: string | undefined;
    for (let page = 0; page < (input.maxPagesPerCell ?? 3); page++) {
      if (runRequests >= PLACES_MAX_REQUESTS_PER_RUN) { stops.push("RUN_CAP"); break; }
      if (ledger.requests >= PLACES_MAX_REQUESTS_PER_MONTH) { stops.push("MONTH_CAP"); break; }
      // Count the attempt before sending it, so a crash can never under-count usage.
      ledger = { ...ledger, requests: ledger.requests + 1 };
      await input.saveLedger(ledger);
      runRequests += 1;
      const response = await input.transport(buildTextSearchRequest(cell.city, cell.niche, input.apiKey, pageToken, cell.query));
      if (response.status !== 200) { stops.push(`HTTP_${response.status}`); break; }
      const parsed = TextSearchResponseSchema.parse(response.json);
      for (const place of parsed.places ?? []) {
        if (place.businessStatus && place.businessStatus !== "OPERATIONAL") continue;
        const website = websiteOrigin(place.websiteUri);
        const key = website ? website.replace("://www.", "://") : `place:${place.id}`;
        if (found.has(key)) continue;
        found.set(key, {
          placeId: place.id, city: cell.city, niche: cell.niche, websiteUrl: website,
          displayName: (place.displayName?.text ?? "").slice(0, 200),
          addressMentionsCity: new RegExp(CITY_NAME[cell.city], "i").test(place.formattedAddress ?? ""),
          phone: place.nationalPhoneNumber?.slice(0, 40) ?? null,
          address: place.formattedAddress?.replace(/,\s*Canada$/i, "").slice(0, 200) ?? null,
        });
      }
      pageToken = parsed.nextPageToken;
      if (!pageToken) break;
    }
    if (stops.includes("RUN_CAP") || stops.includes("MONTH_CAP")) break;
  }
  return {
    version: PLACES_DISCOVERY_VERSION,
    requestsThisRun: runRequests,
    ledger,
    worstCaseUsdThisRun: Math.round(runRequests * PLACES_WORST_CASE_USD_PER_REQUEST * 100) / 100,
    stops: [...new Set(stops)],
    businesses: [...found.values()],
  };
}
