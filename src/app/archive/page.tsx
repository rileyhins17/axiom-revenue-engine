import type { Metadata, Route } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BarChart3, Footprints, Headset, ListOrdered, Mail, Phone, Radar, RotateCcw, Target } from "lucide-react";

import { WhatsNew } from "@/components/help/whats-new";
import { FindLeadsButton } from "@/components/prospects/find-leads-button";
import { CountUp } from "@/components/motion/count-up";
import { Badge, Empty, Notice, OwnerPage, PageHeader, Panel, StatCard } from "@/components/owner/kit";
import { buttonVariants } from "@/components/ui/button";
import { getDatabase } from "@/lib/cloudflare";
import { displayPhone, titleCase, torontoMidnight, torontoToday } from "@/lib/prospect-format";
import { emailSetting, sentToday } from "@/lib/revenue-engine/engine-email";
import { listProspects, prospectActivityStats, prospectCounts, type ProspectDb, type ProspectRow } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Archive: Axiom Web | Axiom Revenue Engine" };

/** The paused website campaign's screens, kept as they were. Nothing here is deleted. */
const ARCHIVED_SCREENS = [
  { href: "/call", label: "Call queue" },
  { href: "/prospects", label: "Call list" },
  { href: "/walk-ins", label: "Walk-ins" },
  { href: "/email", label: "Website email" },
] as const;

type Stats = Awaited<ReturnType<typeof prospectActivityStats>>;
const person = (stats: Stats, actor: "AIDAN" | "RILEY") => stats.byActor[actor] ?? { calls: 0, visits: 0, conversations: 0 };

const DAILY_DIAL_GOAL = 40;

function Scoreboard({ label, today, week }: { label: string; today: Stats; week: Stats }) {
  const actor = label === "Aidan" ? "AIDAN" : "RILEY";
  const t = person(today, actor); const w = person(week, actor);
  const pct = Math.min(100, Math.round((t.calls / DAILY_DIAL_GOAL) * 100));
  return <Panel title={label} action={pct >= 100
    ? <Badge tone="gold"><span className="owner-flame" aria-hidden="true">🔥</span>Goal hit · {t.calls} dials</Badge>
    : <Badge tone="neutral" icon={Target}>{t.calls} / {DAILY_DIAL_GOAL} dials today</Badge>}>
    <div className="h-2 rounded-full bg-[#efe9dc]" role="progressbar" aria-label={`${label} dials toward today's goal`} aria-valuenow={t.calls} aria-valuemin={0} aria-valuemax={DAILY_DIAL_GOAL}>
      <div className="owner-grow h-2 rounded-full bg-gradient-to-r from-[#b8893b] to-[#e3c07a]" style={{ width: `${pct}%` }} />
    </div>
    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
      {[["Calls", t.calls, w.calls], ["Talked", t.conversations, w.conversations], ["Walk-ins", t.visits, w.visits]].map(([name, day, total]) =>
        <div key={name as string} className="rounded-xl bg-[#f6f1e6] p-3">
          <p className="text-2xl font-semibold tabular-nums"><CountUp value={Number(day)} /></p>
          <p className="text-xs text-[#5c584f]">{name} today</p>
          <p className="text-xs text-[#5c584f]">{total} this week</p>
        </div>)}
    </div>
  </Panel>;
}

function LeadRow({ row }: { row: ProspectRow }) {
  return <li className="flex items-center justify-between gap-3">
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold">{row.name}</p>
      <p className="owner-meta truncate">{titleCase(row.city)} · {titleCase(row.niche)}{row.followUpAt ? ` · due ${row.followUpAt}` : ""}</p>
    </div>
    {row.phone ? <a href={`tel:${row.phone.replace(/[^\d+]/g, "")}`} className={cn(buttonVariants({ variant: "outline", size: "xs" }), "shrink-0 tabular-nums")}><Phone aria-hidden="true" />{displayPhone(row.phone)}</a>
      : <span className="owner-meta shrink-0">No phone</span>}
  </li>;
}

export default async function ArchivePage() {
  const session = await requireSession();
  const now = new Date();
  const today = torontoToday(now);
  const db = getDatabase() as unknown as ProspectDb;
  const firstName = session.user.name?.split(" ")[0] || (session.user.email?.startsWith("aidan") ? "Aidan" : "Riley");

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
    return <OwnerPage><PageHeader eyebrow="Old website campaign" title="Archive: Axiom Web" /><Notice tone="warning" icon={AlertTriangle} title="The call data couldn't be loaded." role="status">Refresh in a minute.</Notice></OwnerPage>;
  }
  const { todayStats, weekStats, allStats, counts, followups, email, emailedToday, upNext } = data;
  const talked = Object.values(allStats.byActor).reduce((sum, a) => sum + a.conversations, 0);
  const funnel = [
    ["Businesses found", counts.all], ["Contacted", counts.contacted], ["Real conversations", talked],
    ["Interested", allStats.interested], ["Meetings", allStats.meetings], ["Won", allStats.won],
  ] as const;
  const max = Math.max(1, counts.all);

  return <OwnerPage>
    <PageHeader eyebrow="Old website campaign" title="Archive: Axiom Web" status={<Badge tone="neutral">Paused</Badge>}
      description="Kept as it was. Nothing here sends automatically, and none of its businesses, calls or notes were deleted." />
    <nav aria-label="Archived screens" className="flex flex-wrap gap-2">
      {ARCHIVED_SCREENS.map((screen) => <Link key={screen.href} href={screen.href as Route} className={buttonVariants({ variant: "outline", size: "sm" })}>{screen.label}</Link>)}
    </nav>

    <div className="grid gap-4 lg:grid-cols-3">
      <Link href={"/call" as Route} className="owner-feature lg:col-span-2">
        <p className="owner-feature-label"><Headset aria-hidden="true" />Call queue</p>
        <p className="owner-feature-value owner-gold-text"><CountUp value={counts.call + counts.followups} /></p>
        <p className="owner-feature-text">calls to make right now: <b>{counts.call}</b> never called{counts.followups ? <>, <b>{counts.followups}</b> retr{counts.followups === 1 ? "y" : "ies"} due</> : null}</p>
        <span className={cn(buttonVariants({ variant: "gold" }), "mt-6 self-start")}>Start calling <ArrowRight aria-hidden="true" /></span>
      </Link>
      <div className="grid gap-4">
        <StatCard href={"/walk-ins" as Route} icon={Footprints} label="Walk-ins" value={counts.visit} detail="With an address, routed by city" />
        <StatCard href={"/email" as Route} icon={Mail} label="Automatic email" value={email?.enabled ? `${emailedToday} / ${Math.min(10, email.dailyCap)}` : "Off"}
          detail={email?.enabled ? "Sent today" : "Approve the email to turn it on"} />
      </div>
    </div>

    {counts.call < 15 ? <Notice tone="info" icon={Radar} action={<FindLeadsButton />}
      title={counts.call === 0 ? "You're out of new businesses to call." : `Only ${counts.call} new business${counts.call === 1 ? "" : "es"} left to call.`}>
      The engine also searches by itself every weekday at 7am. Press the button to get more right now.
    </Notice> : null}

    {upNext.length ? <Panel title="Up next in the queue" icon={ListOrdered}
      action={<Link href={"/call" as Route} className={buttonVariants({ variant: "link", size: "sm" })}>Open the queue</Link>}>
      <ol className="owner-list">{upNext.map((row, index) => <li key={row.prospectId} className="flex items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f1ece1] text-xs font-semibold">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <p className="owner-meta truncate">{titleCase(row.city)} · {titleCase(row.niche)} · {row.label === "NO_WEBSITE" ? "No website" : row.reasons[0]}</p>
        </div>
        <a href={`tel:${row.phone!.replace(/[^\d+]/g, "")}`} className={cn(buttonVariants({ variant: "outline", size: "xs" }), "shrink-0 tabular-nums")}><Phone aria-hidden="true" />{displayPhone(row.phone)}</a>
      </li>)}</ol>
    </Panel> : null}

    <WhatsNew />

    <div className="grid gap-4 md:grid-cols-2">
      {(firstName === "Aidan" ? ["Aidan", "Riley"] : ["Riley", "Aidan"]).map((label) => <Scoreboard key={label} label={label} today={todayStats} week={weekStats} />)}
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Results so far" icon={BarChart3}>
        <ul className="space-y-2.5">{funnel.map(([label, value]) => <li key={label} className="grid grid-cols-[130px_minmax(0,1fr)_40px] items-center gap-3 text-sm">
          <span className="text-[#5c584f]">{label}</span>
          <span className="h-2.5 rounded-full bg-[#efe9dc]"><span className="owner-grow block h-2.5 rounded-full bg-gradient-to-r from-[#b8893b] to-[#e3c07a]" style={{ width: `${Math.max(value ? 2 : 0, Math.round((value / max) * 100))}%` }} /></span>
          <span className="text-right font-semibold tabular-nums">{value}</span>
        </li>)}</ul>
      </Panel>
      <Panel title="Retries due today" icon={RotateCcw}
        description="People you already called who didn't answer (they come back after 2 days) or asked you to call back."
        action={<Link href={"/prospects?view=followups" as Route} className={buttonVariants({ variant: "link", size: "sm" })}>See all {counts.followups}</Link>}>
        {followups.length ? <ul className="owner-list">{followups.map((row) => <LeadRow key={row.prospectId} row={row} />)}</ul>
          : <Empty>Nothing due today.{counts.scheduled ? ` ${counts.scheduled} more coming up later this week.` : ""}</Empty>}
        {counts.review ? <Link href={"/prospects?view=review" as Route} className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#ecdcb8] bg-[#fbf6ea] px-4 py-3 text-sm hover:bg-[#f7ecd4]">
          <span><b>{counts.review}</b> call{counts.review === 1 ? "" : "s"} need{counts.review === 1 ? "s" : ""} a decision: you talked to them but didn&apos;t pick a next step.</span>
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </Link> : null}
      </Panel>
    </div>
  </OwnerPage>;
}
