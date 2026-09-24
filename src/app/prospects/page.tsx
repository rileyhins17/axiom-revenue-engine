import type { Metadata } from "next";
import Link from "next/link";

import { ProspectRow, type ProspectRowView } from "@/components/prospects/prospect-row";
import { getDatabase } from "@/lib/cloudflare";
import { listProspectActivity, listProspects, prospectCounts, ProspectViewSchema, type ProspectDb, type ProspectRow as Row } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Call list | Axiom Revenue Engine" };

const TABS = [
  { view: "call", label: "To call" },
  { view: "followups", label: "Follow-ups due" },
  { view: "visit", label: "Walk-ins" },
  { view: "contacted", label: "Contacted" },
  { view: "all", label: "Everything" },
] as const;
const OUTCOME_TEXT: Record<string, string> = {
  NO_ANSWER: "No answer", VOICEMAIL: "Left voicemail", GATEKEEPER: "Talked to staff", CALL_BACK: "Call back later", INTERESTED: "Interested",
  MEETING_BOOKED: "Meeting booked", NOT_INTERESTED: "Not interested", WON: "Won", WRONG_NUMBER: "Wrong number", DO_NOT_CONTACT: "Do not contact", NOTE: "Note",
};
const CITIES = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
const TRADES = ["ROOFING", "HVAC", "LANDSCAPING"] as const;
const title = (value: string) => value === "HVAC" ? value : value.charAt(0) + value.slice(1).toLowerCase();
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Toronto" }) : null;
const mapsUrl = (row: Row) => row.placeId
  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.name)}&query_place_id=${encodeURIComponent(row.placeId)}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.name} ${row.address ?? title(row.city)} Ontario`)}`;

type Search = { view?: string; city?: string; trade?: string; kind?: string; q?: string };

function href(current: Search, change: Partial<Search>) {
  const next = { ...current, ...change };
  const params = new URLSearchParams(Object.entries(next).filter(([, value]) => value) as [string, string][]);
  return `/prospects?${params.toString()}`;
}

function Chip({ active, to, children }: { active: boolean; to: string; children: React.ReactNode }) {
  return <Link href={to as never} aria-current={active ? "page" : undefined}
    className={`rounded-full px-3 py-1 text-sm ${active ? "bg-slate-900 text-white" : "border border-slate-300 hover:bg-slate-100"}`}>{children}</Link>;
}

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession();
  const search = await searchParams;
  const view = ProspectViewSchema.catch("call").parse(search.view);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const db = getDatabase() as unknown as ProspectDb;
  let rows: Row[];
  let counts: Record<string, number>;
  try {
    [rows, counts] = await Promise.all([listProspects(db, view, today, 1000), prospectCounts(db, today)]);
  } catch {
    return <section className="mx-auto max-w-6xl px-6 py-8"><h1 className="text-2xl font-semibold">Call list</h1><p className="mt-2 text-sm">The call list could not be loaded. Refresh in a minute.</p></section>;
  }
  const q = search.q?.trim().toLowerCase() ?? "";
  const filtered = rows.filter((row) => (!search.city || row.city === search.city) && (!search.trade || row.niche === search.trade)
    && (!search.kind || (search.kind === "none" ? row.label === "NO_WEBSITE" : search.kind === "bad" ? row.label === "STRONG" : row.label === "WEAK"))
    && (!q || row.name.toLowerCase().includes(q) || (row.phone ?? "").includes(q)));
  const shown = filtered.slice(0, 250);
  const views: ProspectRowView[] = await Promise.all(shown.map(async (row) => ({
    prospectId: row.prospectId, name: row.name, city: row.city, niche: row.niche, label: row.label, reasons: row.reasons,
    phone: row.phone, address: row.address, websiteUrl: row.websiteUrl, mapsUrl: mapsUrl(row),
    lastOutcomeText: row.lastOutcome ? OUTCOME_TEXT[row.lastOutcome] ?? row.lastOutcome : null, lastActivity: day(row.lastActivityAt),
    followUpAt: row.followUpAt, attempts: row.attempts,
    history: row.attempts > 0 || row.lastOutcome ? (await listProspectActivity(db, row.prospectId)).map((item) => ({
      id: item.activityId, when: day(item.createdAt) ?? "", who: item.actor === "AIDAN" ? "Aidan" : "Riley",
      what: `${item.channel === "VISIT" ? "Visit" : item.channel === "CALL" ? "Call" : "Note"}: ${OUTCOME_TEXT[item.outcome] ?? item.outcome}`, note: item.note, followUpAt: item.followUpAt,
    })) : [],
  })));

  return <section className="mx-auto w-full max-w-7xl space-y-5 px-6 py-8">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Call list</h1>
        <p className="text-sm text-slate-600">Local roofing, HVAC and landscaping businesses with a weak website or none. Call, log what happened, and it&apos;s shared between Riley and Aidan.</p>
      </div>
      <form action="/prospects" className="flex gap-2">
        {Object.entries({ view, city: search.city, trade: search.trade, kind: search.kind }).filter(([, value]) => value).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <input name="q" defaultValue={search.q ?? ""} placeholder="Search name or phone" aria-label="Search" className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
      </form>
    </header>

    <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" aria-label="Lists">
      {TABS.map((tab) => <Chip key={tab.view} active={tab.view === view} to={href(search, { view: tab.view })}>{tab.label}{tab.view in counts ? ` (${counts[tab.view as keyof typeof counts]})` : ""}</Chip>)}
    </nav>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-600">City</span>
      <Chip active={!search.city} to={href(search, { city: undefined })}>All</Chip>
      {CITIES.map((city) => <Chip key={city} active={search.city === city} to={href(search, { city })}>{title(city)}</Chip>)}
      <span className="ml-3 text-slate-600">Trade</span>
      <Chip active={!search.trade} to={href(search, { trade: undefined })}>All</Chip>
      {TRADES.map((trade) => <Chip key={trade} active={search.trade === trade} to={href(search, { trade })}>{title(trade)}</Chip>)}
      <span className="ml-3 text-slate-600">Website</span>
      <Chip active={!search.kind} to={href(search, { kind: undefined })}>Any</Chip>
      <Chip active={search.kind === "bad"} to={href(search, { kind: "bad" })}>Weak</Chip>
      <Chip active={search.kind === "none"} to={href(search, { kind: "none" })}>None</Chip>
    </div>

    <p className="text-sm text-slate-600">{filtered.length} businesses{filtered.length > shown.length ? ` (showing first ${shown.length})` : ""}</p>
    {shown.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm">Nothing matches. Try another list or clear the filters.</p> :
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] text-left">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr><th className="px-3 py-2 font-semibold">Business</th><th className="px-3 py-2 font-semibold">Where</th><th className="px-3 py-2 font-semibold">Why call</th><th className="px-3 py-2 font-semibold">Phone</th><th className="px-3 py-2 font-semibold">Last result</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>{views.map((row) => <ProspectRow key={row.prospectId} row={row} />)}</tbody>
        </table>
      </div>}
  </section>;
}
