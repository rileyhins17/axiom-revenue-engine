import { z } from "zod";

/**
 * Automatic discovery through Google Places API (New) Text Search.
 *
 * Places is a discovery hint only. The engine keeps the place ID and the
 * business's own website origin, then judges the business from its own site.
 * Other Places content (names, addresses, phones) is used transiently for
 * de-duplication and is not persisted as canonical data.
 *
 * Off unless explicitly enabled with a key. Every run is bounded by a request cap
 * and a monthly cap checked before each request.
 */
export const PLACES_DISCOVERY_VERSION = "places-text-search-discovery-v1" as const;
export const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
/** websiteUri makes each request a Text Search Enterprise event (1,000 free per month as of 2026-09). */
export const PLACES_FIELD_MASK = "places.id,places.displayName,places.websiteUri,places.formattedAddress,places.types,places.businessStatus,nextPageToken";
export const PLACES_MAX_REQUESTS_PER_RUN = 30;
export const PLACES_MAX_REQUESTS_PER_MONTH = 200;
/** Worst case if no free tier applied: US$28 per 1,000 Enterprise events. */
export const PLACES_WORST_CASE_USD_PER_REQUEST = 0.028;

export const DiscoveryCitySchema = z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]);
export const DiscoveryNicheSchema = z.enum(["ROOFING", "HVAC", "LANDSCAPING"]);
export type DiscoveryCity = z.infer<typeof DiscoveryCitySchema>;
export type DiscoveryNiche = z.infer<typeof DiscoveryNicheSchema>;

const QUERY: Record<DiscoveryNiche, string> = { ROOFING: "roofing contractor", HVAC: "heating and air conditioning contractor", LANDSCAPING: "landscaping company" };
const CITY_NAME: Record<DiscoveryCity, string> = { KITCHENER: "Kitchener", WATERLOO: "Waterloo", CAMBRIDGE: "Cambridge" };

const PlaceSchema = z.object({
  id: z.string().min(1).max(300),
  displayName: z.object({ text: z.string().max(300) }).partial().optional(),
  websiteUri: z.string().url().optional(),
  formattedAddress: z.string().max(500).optional(),
  types: z.array(z.string().max(80)).max(50).optional(),
  businessStatus: z.string().max(40).optional(),
}).passthrough();
const TextSearchResponseSchema = z.object({ places: z.array(PlaceSchema).max(20).optional(), nextPageToken: z.string().max(2000).optional() }).passthrough();

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
};

export function buildTextSearchRequest(city: DiscoveryCity, niche: DiscoveryNiche, apiKey: string, pageToken?: string) {
  return {
    url: PLACES_TEXT_SEARCH_URL,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": PLACES_FIELD_MASK },
    body: JSON.stringify({ textQuery: `${QUERY[niche]} in ${CITY_NAME[city]}, Ontario`, regionCode: "CA", languageCode: "en", pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
  };
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
  cells: { city: DiscoveryCity; niche: DiscoveryNiche }[];
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
      const response = await input.transport(buildTextSearchRequest(cell.city, cell.niche, input.apiKey, pageToken));
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
