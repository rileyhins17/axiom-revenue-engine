import type { Metadata } from "next";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Inbox, Lock, MailCheck, MailX, PauseCircle, Reply, Send, type LucideIcon } from "lucide-react";

import { FccPauseButton } from "@/components/fcc/fcc-pause-button";
import { getDatabase } from "@/lib/cloudflare";
import { fccScreen, type FccPerson, type FccScreen } from "@/lib/fcc-campaign-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "FCC | Axiom Revenue Engine" };

const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

const STATES: Record<FccScreen["state"], { text: string; tone: string; icon: LucideIcon }> = {
  live: { text: "Live", tone: "bg-emerald-50 text-emerald-900 ring-emerald-200", icon: CheckCircle2 },
  paused: { text: "Paused", tone: "bg-amber-50 text-amber-900 ring-amber-200", icon: PauseCircle },
  locked: { text: "Locked", tone: "bg-slate-100 text-slate-700 ring-slate-200", icon: Lock },
};

function Stat({ icon: Icon, label, value, note }: { icon: LucideIcon; label: string; value: string | number; note?: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="flex items-center gap-2 text-xs font-medium text-slate-600"><Icon className="size-4" aria-hidden="true" />{label}</p>
    <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    {note ? <p className="mt-0.5 text-xs text-slate-600">{note}</p> : null}
  </div>;
}

function People({ title, icon: Icon, empty, people }: { title: string; icon: LucideIcon; empty: string; people: FccPerson[] }) {
  return <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="flex items-center gap-2 font-semibold"><Icon className="size-4" aria-hidden="true" />{title}<span className="text-sm font-normal text-slate-600">({people.length})</span></h2>
    {people.length ? <ul className="mt-2 divide-y divide-slate-100">{people.map((person) => <li key={`${person.email}-${person.at}`} className="py-2.5">
      <p className="truncate text-sm font-medium">{person.company}</p>
      <p className="truncate text-xs text-slate-600">{person.email} · {when(person.at)}</p>
      {person.note ? <p className="mt-0.5 text-xs text-slate-600">{person.note}</p> : null}
    </li>)}</ul> : <p className="mt-2 text-sm text-slate-600">{empty}</p>}
  </div>;
}

export default async function FccPage() {
  const session = await requireSession();
  let data: FccScreen;
  try {
    data = await fccScreen(getDatabase() as unknown as ProspectDb);
  } catch {
    return <section className="mx-auto max-w-6xl px-6 py-8"><h1 className="text-2xl font-semibold">FCC emails</h1><p className="mt-2 text-sm">The FCC numbers couldn&apos;t be loaded. Refresh in a minute.</p></section>;
  }
  const owner = Boolean(getM2OwnerIdentityActor(session.user.email ?? ""));
  const state = STATES[data.state];
  const StateIcon = state.icon;
  const sentToday = data.sentToday.first + data.sentToday.followUps;

  return <section className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">FCC emails</h1>
        <p className="max-w-3xl text-sm text-slate-600">The FCC March 1 pack, from Aidan&apos;s Gmail. On weekdays: {data.batchSize} from 10 a.m., one every 1 to 3 minutes, then up to {data.batchSize} more from 12:30 if 1 or fewer bounced. {data.batchSize * 2} a day at most. One follow-up 3 days later. Stops for anyone who replies or bounces.</p>
      </div>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${state.tone}`}><StateIcon className="size-4" aria-hidden="true" />{state.text}</span>
    </header>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="flex items-center gap-2 font-semibold"><CalendarClock className="size-4" aria-hidden="true" />Next send</h2>
        <p className="text-lg">{data.nextSend}</p>
        {data.state === "paused" && data.control?.action === "paused"
          ? <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Paused by {data.control.by}, {when(data.control.at)}: {data.control.reason}</span></p>
          : null}
        {data.state === "locked" ? <p className="text-sm text-slate-600">No go is recorded for the current email, so nothing can send.</p>
          : data.goBy && data.goAt ? <p className="text-sm text-slate-600">Go given by {data.goBy}, {when(data.goAt)}.</p> : null}
        {data.lastRun ? <p className="flex gap-2 text-sm text-slate-600"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Last check {when(data.lastRun.at)}: {data.lastRun.note}</span></p> : null}
      </div>
      <aside className="h-fit space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Pause or resume</h2>
        {data.state === "locked"
          ? <p className="text-sm text-slate-600">Locked until a founder gives the go on this email.</p>
          : owner ? <FccPauseButton state={data.state} /> : <p className="text-sm text-slate-600">Only Riley or Aidan can pause or resume FCC emails.</p>}
        <p className="text-xs text-slate-600">The emergency stop in Settings is for the old website outreach and does not stop FCC emails. Use this button.</p>
      </aside>
    </div>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Stat icon={Send} label="Sent today" value={sentToday} note={`${data.sentToday.first} first, ${data.sentToday.followUps} follow-up · max ${data.batchSize * 2}`} />
      <Stat icon={MailCheck} label="Sent all time" value={data.sentAllTime.first + data.sentAllTime.followUps} note={`${data.sentAllTime.first} first, ${data.sentAllTime.followUps} follow-up`} />
      <Stat icon={Inbox} label="Ready to send" value={data.ready} note="waiting for a first email" />
      <Stat icon={Lock} label="Held" value={data.held} note="generic inboxes and holds" />
      <Stat icon={Reply} label="Follow-ups due" value={data.followUpsDue} note={data.followUpsLater ? `${data.followUpsLater} more from ${data.nextFollowUpDay}` : "none scheduled yet"} />
      <Stat icon={MailX} label="Bounced today" value={data.bouncesToday} note="1 or fewer by noon: second batch goes" />
    </div>

    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-5 py-3 font-semibold">By batch</h2>
      {data.batches.length ? <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-5 py-2">Batch</th><th className="px-5 py-2">Loaded</th><th className="px-5 py-2 text-right">Ready</th><th className="px-5 py-2 text-right">Held</th><th className="px-5 py-2 text-right">Emailed</th><th className="px-5 py-2 text-right">Stopped</th></tr></thead>
        <tbody>{data.batches.map((batch) => <tr key={batch.loadedAt} className="border-t border-slate-100">
          <td className="px-5 py-2 font-medium">{batch.name}</td><td className="px-5 py-2">{when(batch.loadedAt)}</td>
          <td className="px-5 py-2 text-right tabular-nums">{batch.ready}</td><td className="px-5 py-2 text-right tabular-nums">{batch.held}</td>
          <td className="px-5 py-2 text-right tabular-nums">{batch.emailed}</td><td className="px-5 py-2 text-right tabular-nums">{batch.stopped}</td>
        </tr>)}</tbody>
      </table> : <p className="px-5 py-6 text-sm text-slate-600">No contacts loaded yet.</p>}
    </div>

    <div className="grid gap-4 lg:grid-cols-3">
      <People title="Replies" icon={Reply} people={data.replies} empty="No replies recorded yet. Aidan's Gmail shows replies first; the sender checks for them before each follow-up." />
      <People title="Bounces" icon={MailX} people={data.bounces} empty="Nothing has bounced." />
      <People title="Problems" icon={AlertTriangle} people={data.problems} empty="No email has failed to send." />
    </div>

    <p className="text-xs text-slate-600">This screen only reads the campaign. Pause and Resume are its only controls, and they only affect FCC emails.</p>
  </section>;
}
