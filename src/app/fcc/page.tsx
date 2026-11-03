import type { Metadata } from "next";
import {
  Activity, AlertTriangle, BadgeCheck, CalendarClock, CalendarDays, CheckCircle2, Clock, Inbox, Layers, ListChecks, Lock, MailCheck, MailX, PauseCircle, Percent,
  Reply, Send, TrendingUp, type LucideIcon,
} from "lucide-react";

import { FccPauseButton } from "@/components/fcc/fcc-pause-button";
import { Badge, Empty, Notice, OwnerPage, PageHeader, Panel, StatCard, type Tone } from "@/components/owner/kit";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import { fccScreen, fccStats, type FccInboxRef, type FccPerson, type FccRateRow, type FccScreen, type FccStats } from "@/lib/fcc-campaign-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "FCC | Axiom Revenue Engine" };

const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
/** "Sat, Oct 31" for a stored timestamp; anything else is shown as it is. */
const day = (value: string) => Number.isNaN(Date.parse(value)) ? value
  : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric" }).format(new Date(value));

const pct = (value: number | null) => (value === null ? "None yet" : `${(value * 100).toFixed(1)}%`);

/** The sending inboxes by first name: the first inbox is "", an added one is its address. */
function sendingInboxes(): FccInboxRef[] {
  const env = getCloudflareBindings() ?? {};
  const text = (key: string) => (typeof env[key] === "string" ? (env[key] as string).trim() : "");
  const first = (name: string, fallback: string) => name.split(/\s+/)[0] || fallback;
  const inboxes: FccInboxRef[] = [{ key: "", name: first(text("FCC_SENDER_NAME"), "Aidan") }];
  if (text("FCC_SENDER2_ADDRESS")) inboxes.push({ key: text("FCC_SENDER2_ADDRESS"), name: first(text("FCC_SENDER2_NAME"), "Riley") });
  return inboxes;
}

function RateRows({ rows }: { rows: FccRateRow[] }) {
  return <>{rows.map((row) => <tr key={row.label}>
    <td className="font-semibold">{row.label}</td><td className="text-right tabular-nums">{row.emailed}</td>
    <td className="text-right tabular-nums">{row.replies}</td><td className="text-right tabular-nums">{pct(row.rate)}</td>
    <td className="text-right tabular-nums">{row.bounced}</td>
  </tr>)}</>;
}

const STATES: Record<FccScreen["state"], { text: string; tone: Tone; icon: LucideIcon }> = {
  live: { text: "Live", tone: "success", icon: CheckCircle2 },
  paused: { text: "Paused", tone: "warning", icon: PauseCircle },
  locked: { text: "Locked", tone: "neutral", icon: Lock },
};

function People({ title, icon, empty, people }: { title: string; icon: LucideIcon; empty: string; people: FccPerson[] }) {
  return <Panel title={title} icon={icon} count={people.length}>
    {people.length ? <ul className="owner-list">{people.map((person) => <li key={`${person.email}-${person.at}`}>
      <p className="text-sm font-semibold">{person.company}</p>
      <p className="owner-meta break-all">{person.email}</p>
      <p className="owner-meta">{when(person.at)}</p>
      {person.note ? <p className="mt-1 text-sm text-[#3b3a36]">{person.note}</p> : null}
    </li>)}</ul> : <Empty>{empty}</Empty>}
  </Panel>;
}

export default async function FccPage() {
  const session = await requireSession();
  let data: FccScreen;
  let stats: FccStats;
  const inboxes = sendingInboxes();
  try {
    const db = getDatabase() as unknown as ProspectDb;
    [data, stats] = await Promise.all([fccScreen(db), fccStats(db, inboxes)]);
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="Campaign" title="FCC emails" />
      <Notice tone="warning" icon={AlertTriangle} title="The FCC numbers couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  const owner = Boolean(getM2OwnerIdentityActor(session.user.email ?? ""));
  const state = STATES[data.state];
  const sentToday = data.sentToday.first + data.sentToday.followUps;
  const cap = data.batchSize * 2;
  const senders = inboxes.map((inbox) => `${inbox.name}'s`).join(" and ");

  return <OwnerPage>
    <PageHeader eyebrow="Campaign" title="FCC emails" status={<Badge tone={state.tone} icon={state.icon}>{state.text}</Badge>}
      description={`The FCC March 1 pack, sent from ${senders} Gmail on weekdays.`} />

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Next send" icon={CalendarClock}>
        <p className="text-lg font-medium leading-snug">{data.nextSend}</p>
        {data.state === "paused" && data.control?.action === "paused"
          ? <div className="mt-4"><Notice tone="warning" icon={AlertTriangle} title={`Paused by ${data.control.by}, ${when(data.control.at)}`}>{data.control.reason}</Notice></div>
          : null}
        <ul className="mt-4 space-y-1.5 text-sm text-[#5c584f]">
          {data.state === "locked" ? <li className="flex gap-2"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>No go is recorded for the current email, so nothing can send.</span></li>
            : data.goBy && data.goAt ? <li className="flex gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Go given by {data.goBy}, {when(data.goAt)}</span></li> : null}
          {data.lastRun ? <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Last check {when(data.lastRun.at)}: {data.lastRun.note}</span></li> : null}
        </ul>
      </Panel>
      <Panel title="Pause or resume" icon={PauseCircle}>
        {data.state === "locked"
          ? <Empty>Locked until a founder gives the go on this email.</Empty>
          : owner ? <FccPauseButton state={data.state} /> : <Empty>Only Riley or Aidan can pause or resume FCC emails.</Empty>}
        <p className="owner-meta mt-3">This is the only FCC stop. The emergency stop in Settings is for the old website outreach.</p>
      </Panel>
    </div>

    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
      <StatCard icon={Send} label="Sent today" value={sentToday} detail={`${data.sentToday.first} first, ${data.sentToday.followUps} follow-up · ${stats.today.map((inbox) => `${inbox.name} ${inbox.sentToday} of ${inbox.dailyMax}`).join(", ")}`} />
      <StatCard icon={MailCheck} label="Sent all time" value={data.sentAllTime.first + data.sentAllTime.followUps} detail={`${data.sentAllTime.first} first, ${data.sentAllTime.followUps} follow-up`} />
      <StatCard icon={Inbox} label="Ready to send" value={data.ready} detail="Waiting for a first email" />
      <StatCard icon={Lock} label="Held" value={data.held} detail="Generic inboxes and holds" />
      <StatCard icon={Reply} label="Follow-ups due" value={data.followUpsDue} detail={[
        data.day7Due ? `${data.day7Due} of them day-7` : "",
        data.followUpsLater && data.nextFollowUpDay ? `${data.followUpsLater} more from ${day(data.nextFollowUpDay)}` : data.followUpsDue ? "" : "None scheduled yet",
      ].filter(Boolean).join(" · ")} />
      <StatCard icon={MailX} label="Bounced today" value={data.bouncesToday} detail="1 or fewer by noon: the second batch goes" />
    </div>

    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
      <StatCard icon={Percent} label="Reply rate" value={pct(stats.replyRate)} detail={`${stats.replies.real} real ${stats.replies.real === 1 ? "reply" : "replies"} from ${stats.emailed} people emailed`} />
      <StatCard icon={Reply} label="Real replies" value={stats.replies.real} detail={`${stats.replies.saidNo} said no, ${stats.replies.afterFollowUp} after a follow-up, plus ${stats.replies.automatic} automatic`} />
      <StatCard icon={MailX} label="Bounce rate" value={pct(stats.bounceRate)} detail={`${stats.bounced} of ${stats.emailed} bounced; ${stats.stopped} stopped by us`} />
      <StatCard icon={CalendarDays} label="List left" value={stats.weekdaysLeft === null ? "None" : `${stats.weekdaysLeft} weekdays`} detail={`${data.ready} ready, about ${stats.newPerDay} new companies a day`} />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Emails out per day" icon={TrendingUp} flush>
        {stats.days.length ? <div className="overflow-x-auto"><table className="owner-table min-w-[480px]">
          <thead><tr><th>Day</th><th className="text-right">First</th><th className="text-right">Follow-up</th><th className="text-right">Total</th><th>By inbox</th></tr></thead>
          <tbody>{stats.days.map((row) => <tr key={row.day}>
            <td className="whitespace-nowrap font-semibold">{day(`${row.day}T12:00:00Z`)}</td>
            <td className="text-right tabular-nums">{row.first}</td><td className="text-right tabular-nums">{row.followUps}</td>
            <td className="text-right tabular-nums">{row.first + row.followUps}</td>
            <td className="whitespace-nowrap">{row.byInbox.map((inbox) => `${inbox.name} ${inbox.sent}`).join(", ")}</td>
          </tr>)}</tbody>
        </table></div> : <div className="px-5 py-6 sm:px-6"><Empty>No emails sent in the last 30 days.</Empty></div>}
      </Panel>
      <Panel title="What's working" icon={Activity} flush description="Real replies only, by email version and by inbox.">
        {stats.emailed ? <div className="overflow-x-auto"><table className="owner-table min-w-[480px]">
          <thead><tr><th>Group</th><th className="text-right">Emailed</th><th className="text-right">Replies</th><th className="text-right">Rate</th><th className="text-right">Bounced</th></tr></thead>
          <tbody><RateRows rows={stats.byVersion} /><RateRows rows={stats.byInbox.map((row) => ({ ...row, label: `${row.label}'s inbox` }))} /></tbody>
        </table></div> : <div className="px-5 py-6 sm:px-6"><Empty>Nobody has been emailed yet.</Empty></div>}
      </Panel>
    </div>

    <Panel title="By batch" icon={Layers} flush>
      {data.batches.length ? <div className="overflow-x-auto"><table className="owner-table min-w-[560px]">
        <thead><tr><th>Batch</th><th>Loaded</th><th className="text-right">Ready</th><th className="text-right">Held</th><th className="text-right">Emailed</th><th className="text-right">Stopped</th></tr></thead>
        <tbody>{data.batches.map((batch) => <tr key={batch.loadedAt}>
          <td className="whitespace-nowrap font-semibold">{batch.name}</td><td className="whitespace-nowrap">{when(batch.loadedAt)}</td>
          <td className="text-right tabular-nums">{batch.ready}</td><td className="text-right tabular-nums">{batch.held}</td>
          <td className="text-right tabular-nums">{batch.emailed}</td><td className="text-right tabular-nums">{batch.stopped}</td>
        </tr>)}</tbody>
      </table></div> : <div className="px-5 py-6 sm:px-6"><Empty>No contacts loaded yet.</Empty></div>}
    </Panel>

    <div className="grid gap-4 lg:grid-cols-3">
      <People title="Replies" icon={Reply} people={data.replies} empty="No replies yet. Every inbox is checked each morning from 9 and before each follow-up." />
      <People title="Bounces" icon={MailX} people={data.bounces} empty="Nothing has bounced." />
      <People title="Problems" icon={AlertTriangle} people={data.problems} empty="No email has failed to send." />
    </div>

    <Panel title="How sending works" icon={ListChecks}>
      <ul className="owner-list text-sm text-[#3b3a36]">
        <li>Weekdays from 10 a.m.: {data.batchSize} emails, one every 1 to 3 minutes.</li>
        <li>From 12:30: up to {data.batchSize} more, only if 1 or fewer bounced in the morning. {cap} a day at most.</li>
        <li>Two follow-ups, from the same inbox in the same thread: one 3 days after the first email, and a last one about 7 days after it (at least 4 days after the first follow-up). Anyone who replies or bounces gets nothing more, and the last one skips any company where someone else replied, was stopped, bounced or is on hold.</li>
        <li>New first emails test two subjects, half each: &ldquo;Question about &hellip;&rsquo;s RMD listing&rdquo; and &ldquo;&hellip;&rsquo;s FCC listing&rdquo;. What&rsquo;s working shows replies for each. Companies that weren&rsquo;t on the November 6 list, whose Recertify button looks closed, get the flag-off email: no price and no &ldquo;15 minutes&rdquo;.</li>
        <li>Each inbox keeps its own count. A new inbox starts at 15 a day, then 30 in its second week, then the full amount.</li>
        <li>Every morning from 9, the inboxes are checked for replies, and both founders get an email saying who replied and what they said.</li>
        <li>It pauses itself on a Google warning, Gmail refusing a send, or 3 bounces in a day.</li>
      </ul>
    </Panel>

    <p className="owner-meta">This screen only reads the campaign. Pause and Resume are its only controls, and they only affect FCC emails.</p>
  </OwnerPage>;
}
