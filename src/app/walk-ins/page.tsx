import type { Metadata } from "next";
import { AlertTriangle, Route as RouteIcon } from "lucide-react";

import { Empty, Notice, OwnerPage, PageHeader, Panel } from "@/components/owner/kit";
import { WalkInCard, type WalkInView } from "@/components/prospects/walk-in-card";
import { buttonVariants } from "@/components/ui/button";
import { getDatabase } from "@/lib/cloudflare";
import { mapsUrl, OUTCOME_TEXT, titleCase, torontoToday } from "@/lib/prospect-format";
import { listProspects, type ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { ACTIVE_CITIES } from "@/lib/revenue-engine/cloud-discovery";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Walk-ins | Axiom Revenue Engine" };

const CITIES = ACTIVE_CITIES;

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
    return <OwnerPage><PageHeader eyebrow="Archive: Axiom Web" title="Walk-ins" /><Notice tone="warning" icon={AlertTriangle} title="The walk-ins couldn't be loaded." role="status">Refresh in a minute.</Notice></OwnerPage>;
  }
  const byCity = CITIES.map((city) => ({
    city,
    stops: rows.filter((row) => row.city === city && row.address).sort((a, b) => (a.address ?? "").localeCompare(b.address ?? "")).map((row): WalkInView => ({
      prospectId: row.prospectId, name: row.name, niche: titleCase(row.niche), label: row.label, address: row.address!, phone: row.phone,
      reasons: row.reasons, mapsUrl: mapsUrl(row), last: row.lastOutcome ? OUTCOME_TEXT[row.lastOutcome] ?? row.lastOutcome : null,
    })),
  })).filter((group) => group.stops.length);

  return <OwnerPage>
    <PageHeader eyebrow="Archive: Axiom Web" title="Walk-ins"
      description={`${rows.length} businesses with a street address and a weak or missing website. Open a route, walk in, and log the visit.`} />
    {byCity.length === 0 ? <Panel><Empty>No walk-in addresses yet. The next engine run adds more.</Empty></Panel> : null}
    {byCity.map((group) => <section key={group.city} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{titleCase(group.city)} <span className="text-sm font-medium text-[#6b665c]">({group.stops.length})</span></h2>
        <a href={routeUrl(group.stops)} target="_blank" rel="noreferrer noopener" className={buttonVariants({ size: "sm" })}>
          <RouteIcon aria-hidden="true" />{group.stops.length === 1 ? "Route to this stop" : `Route first ${Math.min(10, group.stops.length)} stops`}
        </a>
      </div>
      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{group.stops.map((stop, index) => <WalkInCard key={stop.prospectId} stop={stop} index={index + 1} />)}</ol>
    </section>)}
  </OwnerPage>;
}
