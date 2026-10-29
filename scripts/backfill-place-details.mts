// One-off: fetch Google's name, phone and address for engine prospects that lack
// them (no-website leads from the first run, plus parked-domain leads), and write
// a small run file that publish-engine-run.mts can upsert. Hard cap 25 lookups,
// counted in the same monthly Places ledger as discovery.
//   node node_modules/tsx/dist/cli.mjs scripts/backfill-place-details.mts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

process.loadEnvFile?.(".env.local");
const KEY = process.env.AXIOM_GOOGLE_PLACES_KEY?.trim();
if (!KEY) throw new Error("AXIOM_GOOGLE_PLACES_KEY missing");
const RUNS = path.join("data", "kw-evaluation", "engine-runs");
const LEDGER = path.join("data", "kw-evaluation", "places-usage-ledger.json");
const MONTH_CAP = 600;
const MAX_LOOKUPS = 25;

type Target = { placeId: string; city: string; niche: string; parkedFrom?: string };
const first = JSON.parse(readFileSync(path.join(RUNS, "run-2026-09-24T03-01-36-357Z.json"), "utf8")) as { results: { placeId: string; city: string; niche: string; label: string }[] };
const targets: Target[] = first.results.filter((r) => r.label === "NO_WEBSITE").map(({ placeId, city, niche }) => ({ placeId, city, niche }));
targets.push({ placeId: "ChIJKatNGBSLK4gR6E6sqSjyYNQ", city: "KITCHENER", niche: "ROOFING", parkedFrom: "https://koebelsroofing.com/" });
if (targets.length > MAX_LOOKUPS) throw new Error(`refusing ${targets.length} lookups`);

const month = new Date().toISOString().slice(0, 7);
let ledger: { month: string; requests: number };
try { ledger = JSON.parse(readFileSync(LEDGER, "utf8")); } catch { ledger = { month, requests: 0 }; }
if (ledger.month !== month) ledger = { month, requests: 0 };
if (ledger.requests + targets.length > MONTH_CAP) throw new Error(`monthly cap: ${ledger.requests} used`);

const results = [];
for (const target of targets) {
  ledger.requests += 1;
  writeFileSync(LEDGER, JSON.stringify(ledger) + "\n");
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(target.placeId)}`, {
    headers: { "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": "id,displayName,formattedAddress,nationalPhoneNumber,businessStatus" },
  });
  if (!response.ok) { console.log(target.placeId, "HTTP", response.status); continue; }
  const place = await response.json() as { displayName?: { text?: string }; formattedAddress?: string; nationalPhoneNumber?: string; businessStatus?: string };
  if (place.businessStatus && place.businessStatus !== "OPERATIONAL") { console.log(target.placeId, place.businessStatus); continue; }
  const common = {
    placeId: target.placeId, city: target.city, niche: target.niche, name: place.displayName?.text?.slice(0, 200) ?? null,
    phone: place.nationalPhoneNumber ?? null, address: place.formattedAddress?.replace(/,\s*Canada$/i, "").slice(0, 200) ?? null,
  };
  results.push(target.parkedFrom
    ? { ...common, websiteUrl: target.parkedFrom, label: "STRONG", reasons: ["The web address is parked and listed for sale; there is no working website."], codes: ["PARKED_DOMAIN"] }
    : { ...common, websiteUrl: null, label: "NO_WEBSITE", reasons: ["No website listed on Google."] });
}
const startedAt = new Date().toISOString();
const file = `run-${startedAt.replace(/[:.]/g, "-")}-backfill.json`;
writeFileSync(path.join(RUNS, file), JSON.stringify({ runVersion: "engine-backfill-v1", startedAt, results }, null, 2));
console.log(JSON.stringify({ file, lookups: targets.length, monthRequests: ledger.requests, named: results.filter((r) => r.name).length, withPhone: results.filter((r) => r.phone).length }));
