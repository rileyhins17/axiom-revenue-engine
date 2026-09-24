import type { Metadata } from "next";
import { Route as RouteIcon } from "lucide-react";

import { WalkInCard, type WalkInView } from "@/components/prospects/walk-in-card";
import { getDatabase } from "@/lib/cloudflare";
import { mapsUrl, OUTCOME_TEXT, titleCase, torontoToday } from "@/lib/prospect-format";
import { listProspects, type ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Walk-ins | Axiom Revenue Engine" };

const CITIES = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;

/** Google Maps directions through up to 10 stops (Maps' own limit for a shared link). */
function routeUrl(stops: WalkInView[]) {
  const places = stops.slice(0, 10).map((stop) => `${stop.address}, Ontario`);
  const destination = places.at(-1) ?? "";
  const waypoints = places.slice(0, -1).join("|");
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(destination)}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}`;
}

export default async function WalkInsPage() {
  await requireSession();
  const db = getDatabase() as unknown as ProspectDb;
  let rows: Awaited<ReturnType<typeof listProspects>>;
  try {
    rows = await listProspects(db, "visit", torontoToday(), 1000);
  } catch {
    return <section className="mx-auto max-w-6xl px-6 py-8"><h1 className="text-2xl font-semibold">Walk-ins</h1><p className="mt-2 text-sm">Could not load. Refresh in a minute.</p></section>;
  }
  const byCity = CITIES.map((city) => ({
    city,
    stops: rows.filter((row) => row.city === city && row.address).sort((a, b) => (a.address ?? "").localeCompare(b.address ?? "")).map((row): WalkInView => ({
      prospectId: row.prospectId, name: row.name, niche: titleCase(row.niche), label: row.label, address: row.address!, phone: row.phone,
      reasons: row.reasons, mapsUrl: mapsUrl(row), last: row.lastOutcome ? OUTCOME_TEXT[row.lastOutcome] ?? row.lastOutcome : null,
    })),
  })).filter((group) => group.stops.length);

  return <section className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <header>
      <h1 className="text-2xl font-semibold">Walk-ins</h1>
      <p className="text-sm text-slate-600">{rows.length} businesses with a street address and a weak or missing website. Open a route, walk in, and log the visit.</p>
    </header>
    {byCity.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm">No walk-in addresses yet. The next engine run adds more.</p> : null}
    {byCity.map((group) => <div key={group.city} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{titleCase(group.city)} <span className="text-sm font-normal text-slate-600">({group.stops.length})</span></h2>
        <a href={routeUrl(group.stops)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
          <RouteIcon className="size-4" aria-hidden="true" />Route first {Math.min(10, group.stops.length)} stops
        </a>
      </div>
      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{group.stops.map((stop, index) => <WalkInCard key={stop.prospectId} stop={stop} index={index + 1} />)}</ol>
    </div>)}
  </section>;
}
