import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Handshake, Phone, PhoneCall, ShieldCheck, Sparkles, Trophy } from "lucide-react";

import { getDatabase } from "@/lib/cloudflare";
import { listProspects, prospectActivityStats, prospectCounts, type ProspectDb, type ProspectRow } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today | Axiom Revenue Engine" };

const title = (value: string) => value === "HVAC" ? value : value.charAt(0) + value.slice(1).toLowerCase();

function startOfWeekToronto(now: Date) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "America/Toronto" }));
  const day = (local.getDay() + 6) % 7;
  local.setHours(0, 0, 0, 0);
  local.setDate(local.getDate() - day);
  const offset = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "America/Toronto" })).getTime();
  return new Date(local.getTime() + offset).toISOString();
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Phone; label: string; value: number | string; hint?: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center gap-2 text-xs font-medium text-slate-600"><Icon className="size-4" aria-hidden="true" />{label}</div>
    <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    {hint ? <p className="mt-1 text-xs text-slate-600">{hint}</p> : null}
  </div>;
}

function LeadRow({ row }: { row: ProspectRow }) {
  return <li className="flex items-center justify-between gap-3 border-b border-slate-200 py-2.5 last:border-0">
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{row.name}</p>
      <p className="truncate text-xs text-slate-600">{title(row.city)} · {title(row.niche)} · {row.reasons[0] ?? "No website"}</p>
    </div>
    {row.phone
      ? <a href={`tel:${row.phone.replace(/[^\d+]/g, "")}`} className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium tabular-nums">{row.phone}</a>
      : <span className="shrink-0 text-xs text-slate-600">no phone yet</span>}
  </li>;
}

export default async function TodayPage() {
  const session = await requireSession();
  const now = new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const db = getDatabase() as unknown as ProspectDb;
  const firstName = session.user.name?.split(" ")[0] || (session.user.email?.startsWith("aidan") ? "Aidan" : "Riley");

  let data: { stats: Awaited<ReturnType<typeof prospectActivityStats>>; counts: Awaited<ReturnType<typeof prospectCounts>>; followups: ProspectRow[]; best: ProspectRow[]; sendingOff: boolean | null } | null = null;
  try {
    const [stats, counts, followups, call, setting] = await Promise.all([
      prospectActivityStats(db, startOfWeekToronto(now)),
      prospectCounts(db, today),
      listProspects(db, "followups", today, 8),
      listProspects(db, "call", today, 40),
      db.prepare(`SELECT "enabled","globalPaused","emergencyPaused" FROM "OutreachAutomationSetting" LIMIT 1`).bind().first<{ enabled: number; globalPaused: number; emergencyPaused: number }>(),
    ]);
    const best = [...call.filter((row) => row.phone && row.attempts === 0), ...call.filter((row) => !row.phone && row.attempts === 0)].slice(0, 8);
    data = { stats, counts, followups, best, sendingOff: setting ? !setting.enabled || Boolean(setting.globalPaused) || Boolean(setting.emergencyPaused) : null };
  } catch {
    data = null;
  }

  const date = new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Toronto" }).format(now);
  if (!data) {
    return <section className="mx-auto w-full max-w-6xl px-6 py-8"><h1 className="text-2xl font-semibold">Today</h1><p className="mt-2 text-sm">The call data could not be loaded. Refresh in a minute.</p></section>;
  }
  const { stats, counts, followups, best } = data;
  const aidan = stats.byActor.AIDAN ?? { calls: 0, visits: 0, conversations: 0 };
  const riley = stats.byActor.RILEY ?? { calls: 0, visits: 0, conversations: 0 };

  return <section className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-slate-600">{date}</p>
        <h1 className="text-2xl font-semibold">Good to see you, {firstName}</h1>
      </div>
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${data.sendingOff === false ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
          <ShieldCheck className="size-3.5" aria-hidden="true" />{data.sendingOff === false ? "Automatic sending is ON" : "Automatic sending is off"}
        </span>
        <Link href={"/prospects" as Route} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
          Start calling <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </header>

    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-600">This week</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat icon={PhoneCall} label="Aidan's calls" value={aidan.calls} hint={`${aidan.conversations} real conversations`} />
        <Stat icon={PhoneCall} label="Riley's calls" value={riley.calls} hint={`${riley.conversations} real conversations`} />
        <Stat icon={Handshake} label="Walk-ins" value={aidan.visits + riley.visits} />
        <Stat icon={Sparkles} label="Interested" value={stats.interested} />
        <Stat icon={CalendarCheck} label="Meetings booked" value={stats.meetings} />
        <Stat icon={Trophy} label="Won" value={stats.won} />
      </div>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Follow-ups due</h2>
          <Link href={"/prospects?view=followups" as Route} className="text-xs font-medium text-emerald-800 hover:underline">All {counts.followups}</Link>
        </div>
        {followups.length ? <ul className="mt-2">{followups.map((row) => <LeadRow key={row.prospectId} row={row} />)}</ul>
          : <p className="mt-3 text-sm text-slate-600">Nothing due. When a call ends with &ldquo;call back,&rdquo; set a date and it shows up here.</p>}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Best leads to call next</h2>
          <Link href={"/prospects" as Route} className="text-xs font-medium text-emerald-800 hover:underline">Call list ({counts.call})</Link>
        </div>
        {best.length ? <ul className="mt-2">{best.map((row) => <LeadRow key={row.prospectId} row={row} />)}</ul>
          : <p className="mt-3 text-sm text-slate-600">No new leads. The engine adds more after its next weekly search.</p>}
      </div>
    </div>

    <p className="text-xs text-slate-600">{counts.call} businesses ready to call · {counts.visit} with an address for walk-ins · {counts.contacted} contacted so far. Leads come from the engine&apos;s weekly search of Kitchener, Waterloo and Cambridge roofing, HVAC and landscaping businesses.</p>
  </section>;
}
