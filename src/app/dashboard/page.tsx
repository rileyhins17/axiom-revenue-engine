import type { Metadata, Route } from "next";
import Link from "next/link";
import { ArrowRight, Footprints, Headset, Mail, Phone, Target } from "lucide-react";

import { WhatsNew } from "@/components/help/whats-new";
import { CountUp } from "@/components/motion/count-up";
import { getDatabase } from "@/lib/cloudflare";
import { titleCase, torontoMidnight, torontoToday } from "@/lib/prospect-format";
import { emailSetting, sentToday } from "@/lib/revenue-engine/engine-email";
import { listProspects, prospectActivityStats, prospectCounts, type ProspectDb, type ProspectRow } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today | Axiom Revenue Engine" };

type Stats = Awaited<ReturnType<typeof prospectActivityStats>>;
const person = (stats: Stats, actor: "AIDAN" | "RILEY") => stats.byActor[actor] ?? { calls: 0, visits: 0, conversations: 0 };

const DAILY_DIAL_GOAL = 40;

function Scoreboard({ label, today, week }: { label: string; today: Stats; week: Stats }) {
  const actor = label === "Aidan" ? "AIDAN" : "RILEY";
  const t = person(today, actor); const w = person(week, actor);
  const pct = Math.min(100, Math.round((t.calls / DAILY_DIAL_GOAL) * 100));
  return <div className="owner-card-lift rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-semibold">{label}</p>
      {pct >= 100
        ? <p className="owner-pop rounded-full bg-[#0a0a0a] px-2.5 py-0.5 text-xs font-semibold text-[#f2e3c2]">Goal hit · {t.calls} dials</p>
        : <p className="flex items-center gap-1 text-xs text-slate-600"><Target className="size-3.5" aria-hidden="true" />{t.calls} / {DAILY_DIAL_GOAL} dials today</p>}
    </div>
    <div className="mt-2 h-2 rounded-full bg-slate-100" role="progressbar" aria-label={`${label} dials toward today's goal`} aria-valuenow={t.calls} aria-valuemin={0} aria-valuemax={DAILY_DIAL_GOAL}>
      <div className="owner-grow h-2 rounded-full bg-gradient-to-r from-[#b8893b] to-[#e3c07a]" style={{ width: `${pct}%` }} />
    </div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
      {[["Calls", t.calls, w.calls], ["Talked", t.conversations, w.conversations], ["Walk-ins", t.visits, w.visits]].map(([name, day, total]) =>
        <div key={name as string} className="rounded-lg bg-slate-50 p-2">
          <p className="text-2xl font-semibold tabular-nums"><CountUp value={Number(day)} /></p>
          <p className="text-[11px] text-slate-600">{name} today</p>
          <p className="text-[11px] text-slate-600">{total} this week</p>
        </div>)}
    </div>
  </div>;
}

function LeadRow({ row }: { row: ProspectRow }) {
  return <li className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{row.name}</p>
      <p className="truncate text-xs text-slate-600">{titleCase(row.city)} · {titleCase(row.niche)}{row.followUpAt ? ` · due ${row.followUpAt}` : ""}</p>
    </div>
    {row.phone ? <a href={`tel:${row.phone.replace(/[^\d+]/g, "")}`} className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium tabular-nums hover:bg-slate-50">{row.phone}</a>
      : <span className="shrink-0 text-xs text-slate-600">no phone</span>}
  </li>;
}

export default async function TodayPage() {
  const session = await requireSession();
  const now = new Date();
  const today = torontoToday(now);
  const db = getDatabase() as unknown as ProspectDb;
  const firstName = session.user.name?.split(" ")[0] || (session.user.email?.startsWith("aidan") ? "Aidan" : "Riley");
  const hour = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone: "America/Toronto" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Toronto" }).format(now);

  let data;
  try {
    const [todayStats, weekStats, allStats, counts, followups, email, emailedToday, upNext] = await Promise.all([
      prospectActivityStats(db, torontoMidnight(now)),
      prospectActivityStats(db, torontoMidnight(now, { week: true })),
      prospectActivityStats(db, "1970-01-01"),
      prospectCounts(db, today),
      listProspects(db, "followups", today, 8),
      emailSetting(db).catch(() => null),
      sentToday(db, today).catch(() => 0),
      listProspects(db, "call", today, 40),
    ]);
    data = { todayStats, weekStats, allStats, counts, followups, email, emailedToday, upNext: upNext.filter((row) => row.phone && row.attempts === 0).slice(0, 5) };
  } catch {
    return <section className="mx-auto w-full max-w-6xl px-6 py-8"><h1 className="text-2xl font-semibold">Today</h1><p className="mt-2 text-sm">The call data could not be loaded. Refresh in a minute.</p></section>;
  }
  const { todayStats, weekStats, allStats, counts, followups, email, emailedToday, upNext } = data;
  const talked = Object.values(allStats.byActor).reduce((sum, a) => sum + a.conversations, 0);
  const funnel = [
    ["Businesses found", counts.all], ["Contacted", counts.contacted], ["Real conversations", talked],
    ["Interested", allStats.interested], ["Meetings", allStats.meetings], ["Won", allStats.won],
  ] as const;
  const max = Math.max(1, counts.all);

  return <section className="owner-stagger mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <header>
      <p className="text-sm text-slate-600">{date}</p>
      <h1>{greeting}, {firstName}.</h1>
    </header>

    <WhatsNew />

    <div className="grid gap-4 lg:grid-cols-3">
      <Link href={"/call" as Route} className="group min-w-0 rounded-2xl owner-cta p-6  shadow-sm  lg:col-span-2">
        <p className="flex items-center gap-2 text-sm font-medium text-[#e9dfc8]"><Headset className="size-4" aria-hidden="true" />Call queue</p>
        <p className="font-display owner-gold-text mt-2 text-6xl tabular-nums"><CountUp value={counts.call + counts.followups} /></p>
        <p className="text-[#e9dfc8]">calls to make right now: <b>{counts.call}</b> never called{counts.followups ? <>, <b>{counts.followups}</b> retr{counts.followups === 1 ? "y" : "ies"} due</> : null}</p>
        <p className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-[#f7e9c8] px-4 py-2 font-semibold text-[#0a0a0a] shadow-[0_8px_24px_-8px_rgba(227,192,122,0.6)] transition group-hover:bg-[#fbf1da]">Start calling <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden="true" /></p>
      </Link>
      <div className="grid gap-4">
        <Link href={"/walk-ins" as Route} className="owner-card-lift min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-600"><Footprints className="size-4" aria-hidden="true" />Walk-ins</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{counts.visit}</p>
          <p className="text-sm text-slate-600">with an address, routed by city</p>
        </Link>
        <Link href={"/email" as Route} className="owner-card-lift min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-600"><Mail className="size-4" aria-hidden="true" />Automatic email</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{email?.enabled ? `${emailedToday} / ${Math.min(10, email.dailyCap)}` : "Off"}</p>
          <p className="text-sm text-slate-600">{email?.enabled ? "sent today" : "approve the email to turn it on"}</p>
        </Link>
      </div>
    </div>

    {upNext.length ? <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Up next in the queue</h2>
        <Link href={"/call" as Route} className="text-xs font-medium text-[#7a5818] hover:underline">Open the queue</Link>
      </div>
      <ol className="mt-3 divide-y divide-slate-100">{upNext.map((row, index) => <li key={row.prospectId} className="flex items-center gap-3 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.name}</p>
          <p className="truncate text-xs text-slate-600">{titleCase(row.city)} · {titleCase(row.niche)} · {row.label === "NO_WEBSITE" ? "No website" : row.reasons[0]}</p>
        </div>
        <a href={`tel:${row.phone!.replace(/[^\d+]/g, "")}`} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium tabular-nums hover:bg-slate-50"><Phone className="size-3" aria-hidden="true" />{row.phone}</a>
      </li>)}</ol>
    </div> : null}

    <div className="grid gap-4 md:grid-cols-2">
      <Scoreboard label="Aidan" today={todayStats} week={weekStats} />
      <Scoreboard label="Riley" today={todayStats} week={weekStats} />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Results so far</h2>
        <ul className="mt-3 space-y-2">{funnel.map(([label, value]) => <li key={label} className="grid grid-cols-[120px_minmax(0,1fr)_40px] items-center gap-3 text-sm">
          <span className="text-slate-600">{label}</span>
          <span className="h-2.5 rounded-full bg-slate-100"><span className="owner-grow block h-2.5 rounded-full bg-gradient-to-r from-[#b8893b] to-[#e3c07a]" style={{ width: `${Math.max(value ? 2 : 0, Math.round((value / max) * 100))}%` }} /></span>
          <span className="text-right font-semibold tabular-nums">{value}</span>
        </li>)}</ul>
      </div>
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Retries due today</h2>
          <Link href={"/prospects?view=followups" as Route} className="text-xs font-medium text-[#7a5818] hover:underline">See all {counts.followups}</Link>
        </div>
        <p className="mt-1 text-xs text-slate-600">People you already called who didn&apos;t answer (they come back after 2 days) or asked you to call back.</p>
        {followups.length ? <ul className="mt-2">{followups.map((row) => <LeadRow key={row.prospectId} row={row} />)}</ul>
          : <p className="mt-3 text-sm text-slate-600">Nothing due today.{counts.scheduled ? ` ${counts.scheduled} more coming up later this week.` : ""}</p>}
        {counts.review ? <Link href={"/prospects?view=review" as Route} className="mt-4 flex items-center justify-between rounded-xl border border-[#e6d6b3] bg-[#fbf3e2] px-3 py-2.5 text-sm hover:bg-[#f7ecd4]">
          <span><b>{counts.review}</b> call{counts.review === 1 ? "" : "s"} need{counts.review === 1 ? "s" : ""} a decision: you talked to them but didn&apos;t pick a next step.</span>
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </Link> : null}
      </div>
    </div>
  </section>;
}
