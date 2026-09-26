import type { ProspectDb } from "./engine-prospects-d1";
import {
  buildTextSearchRequest, CITY_NAME, PLACES_MAX_REQUESTS_PER_MONTH, QUERIES, websiteOrigin,
  type DiscoveryCity, type DiscoveryNiche,
} from "./places-discovery";

/**
 * Server-side lead discovery (runs on the Worker, never on anyone's computer).
 * Rotates through every town x trade x phrasing, a few Google Places searches at a
 * time, strictly under the monthly free-tier cap. Businesses with no website join
 * the call list straight away with Google's phone and address; businesses with a
 * website wait in DiscoveryHeld for a website check before joining.
 */
export const DISCOVERY_MAX_PAGES_PER_CELL = 3;
export const SCHEDULED_REQUESTS_PER_RUN = 30; // Google Cloud daily quota is 40 Text Search requests.
export const OWNER_REQUESTS_PER_RUN = 10;

export type DiscoveryCell = { city: DiscoveryCity; niche: DiscoveryNiche; query: string };
/**
 * Towns and trades the EngineProspect table accepts today. The wider market
 * (Guelph, Brantford, Stratford, Woodstock, Elmira, New Hamburg, Ayr, Breslau;
 * plumbing and electrical) switches on after the table rebuild migration.
 */
export const ACTIVE_CITIES: readonly DiscoveryCity[] = ["KITCHENER", "WATERLOO", "CAMBRIDGE"];
export const ACTIVE_NICHES: readonly DiscoveryNiche[] = ["ROOFING", "HVAC", "LANDSCAPING"];
export const DISCOVERY_CELLS: DiscoveryCell[] = ACTIVE_NICHES.flatMap((niche) =>
  QUERIES[niche].flatMap((query) => ACTIVE_CITIES.map((city) => ({ city, niche, query }))));

export type DiscoveryResult = { runId: string; requests: number; found: number; added: number; held: number; stopReason: string | null };
type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>;
type Place = { id?: string; displayName?: { text?: string }; websiteUri?: string; formattedAddress?: string; businessStatus?: string; nationalPhoneNumber?: string };

const hostKey = (origin: string) => new URL(origin).hostname.toLowerCase().replace(/^www\./, "");

export async function runDiscovery(db: ProspectDb, options: {
  apiKey: string | undefined; trigger: "SCHEDULE" | "OWNER"; actor?: "RILEY" | "AIDAN" | null; maxRequests: number;
  fetcher?: Fetcher; now?: Date; newId?: () => string;
}): Promise<DiscoveryResult> {
  const now = options.now ?? new Date();
  const runId = `cloud-${now.toISOString().replace(/[:.]/g, "-")}-${(options.newId?.() ?? crypto.randomUUID()).slice(0, 8)}`;
  const month = now.toISOString().slice(0, 7);
  const result: DiscoveryResult = { runId, requests: 0, found: 0, added: 0, held: 0, stopReason: null };
  await db.prepare(`INSERT INTO "DiscoveryRun" ("runId","trigger","actor","startedAt") VALUES (?,?,?,?)`).bind(runId, options.trigger, options.actor ?? null, now.toISOString()).run();
  const finish = async (stopReason: string | null) => {
    result.stopReason = stopReason;
    await db.prepare(`UPDATE "DiscoveryRun" SET "finishedAt"=?,"requests"=?,"found"=?,"added"=?,"held"=?,"stopReason"=? WHERE "runId"=?`)
      .bind(new Date().toISOString(), result.requests, result.found, result.added, result.held, stopReason, runId).run();
    return result;
  };
  if (!options.apiKey) return finish("The Google Places key isn't set up on the server yet.");

  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const cursor = await db.prepare(`SELECT "cellIndex","pageToken" FROM "DiscoveryCursor" WHERE "id" = 1`).bind().first<{ cellIndex: number; pageToken: string | null }>();
  let cellIndex = (cursor?.cellIndex ?? 0) % DISCOVERY_CELLS.length;
  let pageToken = cursor?.pageToken ?? null;
  let pagesInCell = 0;

  for (let i = 0; i < Math.max(0, Math.min(options.maxRequests, 60)); i += 1) {
    // Atomic monthly cap: only count a request if the month is still under the cap.
    await db.prepare(`INSERT INTO "PlacesUsage" ("month","requests") VALUES (?,0) ON CONFLICT("month") DO NOTHING`).bind(month).run();
    const reserved = await db.prepare(`UPDATE "PlacesUsage" SET "requests" = "requests" + 1 WHERE "month" = ? AND "requests" < ?`).bind(month, PLACES_MAX_REQUESTS_PER_MONTH).run() as { changes?: number; meta?: { changes?: number } };
    if ((reserved.meta?.changes ?? reserved.changes ?? 0) !== 1) return finish("This month's free Google search allowance is used up; it resets on the 1st.");

    const cell = DISCOVERY_CELLS[cellIndex]!;
    const request = buildTextSearchRequest(cell.city, cell.niche, options.apiKey, pageToken ?? undefined, cell.query);
    const response = await fetcher(request.url, { method: "POST", headers: request.headers, body: request.body }).catch(() => null);
    result.requests += 1;
    if (!response) return finish("Couldn't reach Google. It will try again next time.");
    if (response.status === 429) return finish("Google's daily search limit was reached; it continues tomorrow.");
    if (response.status !== 200) return finish(`Google returned an error (${response.status}).`);
    const body = await response.json() as { places?: Place[]; nextPageToken?: string };

    for (const place of body.places ?? []) {
      if (!place.id || (place.businessStatus && place.businessStatus !== "OPERATIONAL")) continue;
      result.found += 1;
      const name = place.displayName?.text?.trim().slice(0, 200);
      if (!name) continue;
      const phone = place.nationalPhoneNumber?.slice(0, 40) ?? null;
      const address = place.formattedAddress?.replace(/,\s*Canada$/i, "").slice(0, 200) ?? null;
      const origin = websiteOrigin(place.websiteUri);
      const known = await db.prepare(`SELECT 1 AS n FROM "EngineProspect" WHERE "placeId" = ? OR "prospectId" = ? OR "prospectId" = ? LIMIT 1`)
        .bind(place.id, `place:${place.id}`, origin ? hostKey(origin) : "").first();
      if (known) continue;
      if (!origin) {
        if (!phone) continue; // Nothing to call.
        const inserted = await db.prepare(`INSERT INTO "EngineProspect" ("prospectId","placeId","name","city","niche","websiteUrl","phone","address","label","reasons","runId","firstSeenAt","lastSeenAt")
          VALUES (?,?,?,?,?,NULL,?,?,'NO_WEBSITE',?,?,?,?) ON CONFLICT("prospectId") DO NOTHING`)
          .bind(`place:${place.id}`, place.id, name, cell.city, cell.niche, phone, address, JSON.stringify(["No website listed on Google."]), runId, now.toISOString(), now.toISOString()).run() as { changes?: number; meta?: { changes?: number } };
        if ((inserted.meta?.changes ?? inserted.changes ?? 0) === 1) result.added += 1;
      } else {
        const held = await db.prepare(`INSERT INTO "DiscoveryHeld" ("placeId","name","city","niche","websiteUrl","phone","address","firstSeenAt") VALUES (?,?,?,?,?,?,?,?) ON CONFLICT("placeId") DO NOTHING`)
          .bind(place.id, name, cell.city, cell.niche, origin, phone, address, now.toISOString()).run() as { changes?: number; meta?: { changes?: number } };
        if ((held.meta?.changes ?? held.changes ?? 0) === 1) result.held += 1;
      }
    }

    pagesInCell += 1;
    if (body.nextPageToken && pagesInCell < DISCOVERY_MAX_PAGES_PER_CELL) pageToken = body.nextPageToken;
    else { cellIndex = (cellIndex + 1) % DISCOVERY_CELLS.length; pageToken = null; pagesInCell = 0; }
    await db.prepare(`UPDATE "DiscoveryCursor" SET "cellIndex"=?,"pageToken"=?,"updatedAt"=? WHERE "id"=1`).bind(cellIndex, pageToken, new Date().toISOString()).run();
  }
  return finish(null);
}

export async function latestDiscoveryRuns(db: ProspectDb, limit = 5) {
  return (await db.prepare(`SELECT "runId","trigger","actor","startedAt","requests","found","added","held","stopReason" FROM "DiscoveryRun" ORDER BY "startedAt" DESC LIMIT ?`)
    .bind(limit).all<DiscoveryResult & { trigger: string; actor: string | null; startedAt: string }>()).results;
}

export const MARKET_SUMMARY = { towns: ACTIVE_CITIES.map((city) => CITY_NAME[city]), trades: ACTIVE_NICHES.length, searches: DISCOVERY_CELLS.length };
