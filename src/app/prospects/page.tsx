import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, MapPin, Phone } from "lucide-react";

import { LogActivityForm } from "@/components/prospects/log-activity-form";
import { getDatabase } from "@/lib/cloudflare";
import { listProspectActivity, listProspects, prospectCounts, ProspectViewSchema, type ProspectDb, type ProspectRow } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Call list | Axiom Revenue Engine" };

const TABS = [
  { view: "call", label: "Call list" },
  { view: "followups", label: "Follow-ups due" },
  { view: "visit", label: "Walk-ins" },
  { view: "contacted", label: "Contacted" },
] as const;
const OUTCOME_TEXT: Record<string, string> = {
  NO_ANSWER: "No answer", VOICEMAIL: "Left voicemail", GATEKEEPER: "Talked to staff", CALL_BACK: "Call back later", INTERESTED: "Interested",
  MEETING_BOOKED: "Meeting booked", NOT_INTERESTED: "Not interested", WON: "Won", WRONG_NUMBER: "Wrong number", DO_NOT_CONTACT: "Do not contact", NOTE: "Note",
};
const title = (value: string) => value === "HVAC" ? value : value.charAt(0) + value.slice(1).toLowerCase();
const mapsUrl = (row: ProspectRow) => row.placeId
  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.name)}&query_place_id=${encodeURIComponent(row.placeId)}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.name} ${row.address ?? title(row.city)}`)}`;

async function Prospect({ db, row }: { db: ProspectDb; row: ProspectRow }) {
  const history = row.attempts > 0 || row.lastOutcome ? await listProspectActivity(db, row.prospectId) : [];
  return <li className="rounded-xl border border-border/70 bg-card p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-semibold">{row.name}</p>
      <p className="text-xs text-muted-foreground">{title(row.city)} · {title(row.niche)}{row.label === "NO_WEBSITE" ? " · No website" : ""}</p>
    </div>
    <ul className="mt-2 space-y-1 text-sm">{row.reasons.slice(0, 3).map((reason) => <li key={reason}>• {reason}</li>)}</ul>
    <div className="mt-3 flex flex-wrap gap-3 text-sm">
      {row.phone ? <a href={`tel:${row.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white"><Phone className="size-4" aria-hidden="true" />{row.phone}</a> : null}
      <a href={mapsUrl(row)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2"><MapPin className="size-4" aria-hidden="true" />{row.phone ? "Map" : "Phone & map on Google"}</a>
      {row.websiteUrl ? <a href={row.websiteUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2"><ExternalLink className="size-4" aria-hidden="true" />Website</a> : null}
    </div>
    {row.address ? <p className="mt-2 text-xs text-muted-foreground">{row.address}</p> : null}
    {history.length ? <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium">History ({history.length}){row.lastOutcome ? ` · last: ${OUTCOME_TEXT[row.lastOutcome]}` : ""}</summary>
      <ul className="mt-2 space-y-1">{history.map((item) => <li key={item.activityId} className="text-xs">
        <span className="font-medium">{new Date(item.createdAt).toLocaleDateString("en-CA", { timeZone: "America/Toronto" })} · {item.actor === "AIDAN" ? "Aidan" : "Riley"} · {item.channel.toLowerCase()} · {OUTCOME_TEXT[item.outcome]}</span>
        {item.note ? ` — ${item.note}` : ""}{item.followUpAt ? ` (follow up ${item.followUpAt})` : ""}</li>)}</ul>
    </details> : null}
    <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold text-emerald-800">Log call or visit</summary><LogActivityForm prospectId={row.prospectId} /></details>
  </li>;
}

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireSession();
  const view = ProspectViewSchema.catch("call").parse((await searchParams).view);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const db = getDatabase() as unknown as ProspectDb;
  let rows: ProspectRow[] = [];
  let counts: Record<string, number> = {};
  try {
    [rows, counts] = await Promise.all([listProspects(db, view, today, 200), prospectCounts(db, today)]);
  } catch {
    return <section className="mx-auto max-w-5xl p-6"><h1 className="text-xl font-semibold">Call list</h1><p className="mt-2 text-sm">The call list isn&apos;t available yet. The engine&apos;s first published run will appear here.</p></section>;
  }
  return <section className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
    <div>
      <h1 className="text-xl font-semibold">Call list</h1>
      <p className="text-sm text-muted-foreground">Local roofing, HVAC and landscaping businesses the engine found with a website problem, or no website. Log every call or visit so Riley and Aidan see the same history.</p>
    </div>
    <nav className="flex flex-wrap gap-2" aria-label="Lists">
      {TABS.map((tab) => <Link key={tab.view} href={`/prospects?view=${tab.view}`} aria-current={tab.view === view ? "page" : undefined}
        className={`rounded-full px-3 py-1.5 text-sm ${tab.view === view ? "bg-foreground text-background" : "border border-border"}`}>{tab.label} ({counts[tab.view] ?? 0})</Link>)}
    </nav>
    {rows.length === 0 ? <p className="text-sm">Nothing here right now.</p> : <ul className="space-y-3">{rows.map((row) => <Prospect key={row.prospectId} db={db} row={row} />)}</ul>}
  </section>;
}
