import type { Metadata } from "next";
import { AlertTriangle, BadgeCheck, CalendarClock, CheckCircle2, Clock, Inbox, Layers, ListChecks, Lock, MailCheck, MailX, PauseCircle, Reply, Send, type LucideIcon } from "lucide-react";

import { FccPauseButton } from "@/components/fcc/fcc-pause-button";
import { Badge, Empty, Notice, OwnerPage, PageHeader, Panel, StatCard, type Tone } from "@/components/owner/kit";
import { getDatabase } from "@/lib/cloudflare";
import { fccScreen, type FccPerson, type FccScreen } from "@/lib/fcc-campaign-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "FCC | Axiom Revenue Engine" };

const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
/** "Sat, Oct 31" for a stored timestamp; anything else is shown as it is. */
const day = (value: string) => Number.isNaN(Date.parse(value)) ? value
  : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric" }).format(new Date(value));

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
  try {
    data = await fccScreen(getDatabase() as unknown as ProspectDb);
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

  return <OwnerPage>
    <PageHeader eyebrow="Campaign" title="FCC emails" status={<Badge tone={state.tone} icon={state.icon}>{state.text}</Badge>}
      description="The FCC March 1 pack, sent from Aidan's Gmail on weekdays." />

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
      <StatCard icon={Send} label="Sent today" value={sentToday} detail={`${data.sentToday.first} first, ${data.sentToday.followUps} follow-up · max ${cap}`} />
      <StatCard icon={MailCheck} label="Sent all time" value={data.sentAllTime.first + data.sentAllTime.followUps} detail={`${data.sentAllTime.first} first, ${data.sentAllTime.followUps} follow-up`} />
      <StatCard icon={Inbox} label="Ready to send" value={data.ready} detail="Waiting for a first email" />
      <StatCard icon={Lock} label="Held" value={data.held} detail="Generic inboxes and holds" />
      <StatCard icon={Reply} label="Follow-ups due" value={data.followUpsDue} detail={data.followUpsLater && data.nextFollowUpDay ? `${data.followUpsLater} more from ${day(data.nextFollowUpDay)}` : "None scheduled yet"} />
      <StatCard icon={MailX} label="Bounced today" value={data.bouncesToday} detail="1 or fewer by noon: the second batch goes" />
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
      <People title="Replies" icon={Reply} people={data.replies} empty="No replies recorded yet. Aidan's Gmail shows replies first; the sender checks for them before each follow-up." />
      <People title="Bounces" icon={MailX} people={data.bounces} empty="Nothing has bounced." />
      <People title="Problems" icon={AlertTriangle} people={data.problems} empty="No email has failed to send." />
    </div>

    <Panel title="How sending works" icon={ListChecks}>
      <ul className="owner-list text-sm text-[#3b3a36]">
        <li>Weekdays from 10 a.m.: {data.batchSize} emails, one every 1 to 3 minutes.</li>
        <li>From 12:30: up to {data.batchSize} more, only if 1 or fewer bounced in the morning. {cap} a day at most.</li>
        <li>One follow-up 3 days later. Anyone who replies or bounces gets nothing more.</li>
        <li>It pauses itself on a Google warning, Gmail refusing a send, or 3 bounces in a day.</li>
      </ul>
    </Panel>

    <p className="owner-meta">This screen only reads the campaign. Pause and Resume are its only controls, and they only affect FCC emails.</p>
  </OwnerPage>;
}
