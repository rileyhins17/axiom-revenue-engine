import type { Metadata } from "next";
import Link from "next/link";

import { ProspectRow, type ProspectRowView } from "@/components/prospects/prospect-row";
import { getDatabase } from "@/lib/cloudflare";
import { historyView, prospectOutcomeText, titleCase } from "@/lib/prospect-format";
import { listActivityFor, listProspects, prospectCounts, ProspectViewSchema, type ProspectDb, type ProspectRow as Row } from "@/lib/revenue-engine/engine-prospects-d1";
import { ACTIVE_CITIES, ACTIVE_NICHES } from "@/lib/revenue-engine/cloud-discovery";
import { listContactEditsFor } from "@/lib/caller-v2/contact-edits";
import type { CallerDb } from "@/lib/caller-v2/database";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Call list | Axiom Revenue Engine" };

const TABS = [
  { view: "call", label: "To call (new)", help: "Businesses nobody has called yet. Once you call one, it leaves this list." },
  { view: "followups", label: "Retries due", help: "Already called. No answer or voicemail comes back here after 2 days; callbacks on the day you picked." },
  { view: "review", label: "Needs a decision", help: "You talked to them but didn't pick what happens next. Open one and choose: call back, interested, not interested…" },
  { view: "visit", label: "Walk-ins", help: "Businesses with a street address you can visit in person." },
  { view: "contacted", label: "Contacted", help: "Everyone you've called, visited or emailed, newest first." },
  { view: "all", label: "Everything", help: "Every business the engine has found, including closed ones." },
] as const;
const CITIES = ACTIVE_CITIES;
const TRADES = ACTIVE_NICHES;
const title = titleCase;
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
    className={`rounded-full px-3 py-1 text-sm ${active ? "bg-[#0a0a0a] text-[#fbf6ea]" : "border border-slate-300 hover:bg-slate-100"}`}>{children}</Link>;
}

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession();
  const search = await searchParams;
  const view = ProspectViewSchema.catch("call").parse(search.view);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const db = getDatabase() as unknown as ProspectDb;
  let rows: Row[];
  let counts: Awaited<ReturnType<typeof prospectCounts>>;
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
  const history = await listActivityFor(db, shown.filter((row) => row.attempts > 0 || row.lastOutcome).map((row) => row.prospectId));
  // Caller edits are extra context; the list still loads if they can't be read.
  const edits = await listContactEditsFor(db as unknown as CallerDb, shown.map((row) => row.prospectId)).catch(() => new Map<string, never[]>());
  const who = (actor: string) => actor === "AIDAN" ? "Aidan" : "Riley";
  const views: ProspectRowView[] = shown.map((row) => {
    const list = edits.get(row.prospectId) ?? [];
    const note = list.find((item) => item.note), fix = list.find((item) => item.newPhone);
    return {
    prospectId: row.prospectId, name: row.name, city: row.city, niche: row.niche, label: row.label, reasons: row.reasons,
    phone: row.phone, address: row.address, websiteUrl: row.websiteUrl, mapsUrl: mapsUrl(row),
    altPhone: row.altPhone ?? null, googleRatingCount: row.googleRatingCount ?? null, googleRating: row.googleRating ?? null,
    lastOutcomeText: prospectOutcomeText(row.lastOutcome, row.lastCallerOutcome), lastActivity: day(row.lastActivityAt),
    followUpAt: row.followUpAt, attempts: row.attempts,
    history: historyView(history.get(row.prospectId) ?? []),
    callerNote: note?.note ? { note: note.note, who: who(note.actor), when: day(note.createdAt) ?? "" } : null,
    callerPhoneFix: fix ? { previousPhone: fix.previousPhone, who: who(fix.actor), when: day(fix.createdAt) ?? "" } : null,
  };
  });

  const activeFilters = [search.city, search.trade, search.kind].filter(Boolean).length;
  const filterChips = <>
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
  </>;

  return <section className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">Call list</h1>
        <p className="hidden text-sm text-slate-600 sm:block">Local roofing, HVAC, landscaping, plumbing and electrical businesses across Waterloo Region and nearby towns with a weak website or none. Call, log what happened, and it&apos;s shared between Riley and Aidan.</p>
      </div>
      <form action="/prospects" className="flex w-full gap-2 sm:w-auto">
        {Object.entries({ view, city: search.city, trade: search.trade, kind: search.kind }).filter(([, value]) => value).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <input name="q" defaultValue={search.q ?? ""} placeholder="Search name or phone" aria-label="Search" type="search" enterKeyHint="search" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm sm:w-64" />
      </form>
    </header>

    <nav className="owner-scroll-row flex gap-2 border-b border-slate-200 pb-3 md:flex-wrap" aria-label="Lists">
      {TABS.map((tab) => <Chip key={tab.view} active={tab.view === view} to={href(search, { view: tab.view })}>{tab.label} ({counts[tab.view]})</Chip>)}
    </nav>
    <p className="-mt-2 text-sm text-slate-600">{TABS.find((tab) => tab.view === view)?.help}</p>
    {/* Phones: the town/trade/website filters fold away; a computer shows them inline. */}
    <details className="owner-filters rounded-xl border border-slate-200 bg-white md:hidden">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between px-4 text-sm font-semibold">
        Filters{activeFilters ? <span className="rounded-full bg-[#0a0a0a] px-2 py-0.5 text-xs text-[#f2e3c2]">{activeFilters} on</span> : <span className="text-xs font-normal text-slate-600">town, trade, website</span>}
      </summary>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-3 text-sm">{filterChips}</div>
    </details>
    <div className="hidden flex-wrap items-center gap-2 text-sm md:flex">{filterChips}</div>

    <p className="text-sm text-slate-600">{filtered.length} businesses{filtered.length > shown.length ? ` (showing first ${shown.length})` : ""}</p>
    {shown.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm">Nothing matches. Try another list or clear the filters.</p> :
      <div className="rounded-xl border border-slate-200 bg-white md:overflow-x-auto">
        <table className="owner-card-table w-full text-left md:min-w-[960px]">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr><th className="px-3 py-2 font-semibold">Business</th><th className="px-3 py-2 font-semibold">Where</th><th className="px-3 py-2 font-semibold">Why call</th><th className="px-3 py-2 font-semibold">Phone</th><th className="px-3 py-2 font-semibold">Last result</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>{views.map((row) => <ProspectRow key={row.prospectId} row={row} />)}</tbody>
        </table>
      </div>}
  </section>;
}
