import type { Metadata, Route } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, Lock, MailX, Reply, Send } from "lucide-react";

import { CountUp } from "@/components/motion/count-up";
import { Empty, Notice, OwnerPage, PageHeader, Panel, StatCard } from "@/components/owner/kit";
import { buttonVariants } from "@/components/ui/button";
import { getDatabase } from "@/lib/cloudflare";
import { fccScreen, fccStats, type FccScreen, type FccStats } from "@/lib/fcc-campaign-status";
import { sendingInboxes } from "@/lib/fcc-screen-inboxes";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today | Axiom Revenue Engine" };

const STATE_TEXT: Record<FccScreen["state"], string> = { live: "Live", paused: "Paused", locked: "Locked" };
const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
/** "Fri, Nov 6" for a day ("2026-11-06") or a timestamp; anything else is shown as it is. */
function day(value: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric" }).format(date);
}

/** Today is the FCC campaign at a glance: what went out, who wrote back, and what's next. */
export default async function TodayPage() {
  const session = await requireSession();
  const now = new Date();
  const firstName = session.user.name?.split(" ")[0] || (session.user.email?.startsWith("aidan") ? "Aidan" : "Riley");
  const hour = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone: "America/Toronto" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Toronto" }).format(now);

  let fcc: FccScreen | null = null;
  let stats: FccStats | null = null;
  try {
    const db = getDatabase() as unknown as ProspectDb;
    [fcc, stats] = await withTimeout(Promise.all([fccScreen(db, now), fccStats(db, sendingInboxes(), now)]), 12_000, "today-numbers");
  } catch {
    fcc = null;
  }
  // Out-of-office and other automatic replies need no answer; the reply check saves them as "sent an automatic reply".
  const toAnswer = (fcc?.replies ?? []).filter((person) => !/automatic reply/i.test(person.note ?? ""));

  return <OwnerPage>
    <PageHeader eyebrow={date} title={`${greeting}, ${firstName}.`} />

    {fcc?.state === "paused"
      ? <Notice tone="warning" icon={AlertTriangle} title="FCC emails are paused." role="status"
        action={<Link href={"/fcc" as Route} className={buttonVariants({ variant: "outline", size: "sm" })}>Open FCC to resume</Link>}>
        {fcc.control?.action === "paused" ? `${fcc.control.reason} (${fcc.control.by}, ${when(fcc.control.at)})` : "Nothing sends until someone presses Resume."}
      </Notice>
      : null}
    {fcc?.state === "locked"
      ? <Notice tone="warning" icon={Lock} title="FCC emails are locked." role="status">
        The current email has no founder&apos;s go yet, so nothing can send. Ask Claude to record the go once you&apos;ve both read it.
      </Notice>
      : null}

    {fcc && stats ? <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Link href={"/fcc" as Route} className="owner-feature lg:col-span-2">
          <p className="owner-feature-label"><Send aria-hidden="true" />FCC emails · {STATE_TEXT[fcc.state]}</p>
          <p className="owner-feature-value owner-gold-text"><CountUp value={fcc.sentToday.first + fcc.sentToday.followUps} /></p>
          <p className="owner-feature-text">
            sent today: {stats.today.map((inbox) => `${inbox.name} ${inbox.sentToday} of ${inbox.dailyMax}`).join(", ")}. <b>{fcc.ready}</b> companies ready.
          </p>
          <p className="owner-feature-text flex items-start gap-2"><CalendarClock className="mt-1 size-4 shrink-0 text-[#e3c07a]" aria-hidden="true" />{fcc.nextSend}</p>
          <span className={cn(buttonVariants({ variant: "gold" }), "mt-6 self-start")}>Open FCC <ArrowRight aria-hidden="true" /></span>
        </Link>
        <div className="grid gap-4">
          <StatCard href={"/fcc" as Route} icon={Reply} label="Real replies" value={stats.replies.real}
            detail={`${stats.replies.saidNo} said no · ${stats.emailed} companies emailed`} />
          <StatCard href={"/fcc" as Route} icon={MailX} label="Bounced today" value={fcc.bouncesToday}
            detail={`${fcc.bounces.length} in total · 3 in a day pauses sending`} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Latest replies" icon={Reply} count={toAnswer.length}
          description="Answer each one within 2 hours with the saved replies in Gmail. Out-of-office and other automatic replies are left out.">
          {toAnswer.length ? <ul className="owner-list">{toAnswer.slice(0, 3).map((person) => <li key={`${person.email}-${person.at}`}>
            <p className="text-sm font-semibold">{person.company}</p>
            <p className="owner-meta">{when(person.at)}</p>
            {person.note ? <p className="mt-1 line-clamp-3 text-sm text-[#3b3a36]">{person.note}</p> : null}
          </li>)}</ul> : <Empty>No replies yet. The inboxes are checked every morning from 9.</Empty>}
        </Panel>
        <Panel title="Coming up" icon={CalendarClock}>
          <ul className="owner-list text-sm text-[#3b3a36]">
            <li>{fcc.followUpsDue
              ? <><b>{fcc.followUpsDue}</b> follow-up{fcc.followUpsDue === 1 ? " is" : "s are"} due and go out before new companies.</>
              : fcc.nextFollowUpDay ? <>The next follow-ups start <b>{day(fcc.nextFollowUpDay)}</b>.</> : "No follow-ups are scheduled yet."}</li>
            <li>{stats.weekdaysLeft === null ? "No companies are left to email." : <>The ready list lasts about <b>{stats.weekdaysLeft} weekdays</b> at {stats.newPerDay} new companies a day.</>}</li>
          </ul>
        </Panel>
      </div>
    </> : <Notice tone="warning" icon={AlertTriangle} title="The FCC numbers couldn't be loaded." role="status">Refresh in a minute.</Notice>}
  </OwnerPage>;
}
