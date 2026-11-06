import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle, BadgeCheck, CalendarClock, CheckCircle2, Clock, FileText, Inbox, Layers, ListChecks, Lock, MailCheck, MailSearch, MailX, PauseCircle, Reply, Send, Settings2, TrendingUp, Upload,
  type LucideIcon,
} from "lucide-react";

import { CampaignPauseButton } from "@/components/campaigns/campaign-actions";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Empty, Notice, OwnerPage, PageHeader, Panel, StatCard, type Tone } from "@/components/owner/kit";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import { readKv } from "@/lib/outreach/outreach-control";
import { OUTREACH_REPLY_STATE } from "@/lib/outreach/outreach-replies";
import { campaignDetail, type CampaignDetail, type PersonRow } from "@/lib/outreach/outreach-status";
import { campaignFooter } from "@/lib/outreach/outreach-words";
import { ownerForAccount } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaign | Axiom Revenue Engine" };

const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const dayLabel = (day: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T17:00:00Z`));
const clock = (minute: number) => `${Math.floor(minute / 60) % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${minute < 720 ? "a.m." : "p.m."}`;

const STATES: Record<"live" | "paused", { text: string; tone: Tone; icon: LucideIcon }> = {
  live: { text: "Live", tone: "success", icon: CheckCircle2 },
  paused: { text: "Paused", tone: "warning", icon: PauseCircle },
};
const BATCH: Record<string, { text: string; tone: Tone }> = {
  waiting: { text: "Waiting for approval", tone: "warning" }, approved: { text: "Approved", tone: "success" }, stopped: { text: "Stopped", tone: "neutral" },
};

function People({ title, icon, empty, people }: { title: string; icon: LucideIcon; empty: string; people: PersonRow[] }) {
  return <Panel title={title} icon={icon} count={people.length}>
    {people.length ? <ul className="owner-list">{people.map((person, index) => <li key={`${person.email}-${index}`}>
      <p className="text-sm font-semibold">{person.label}</p>
      <p className="owner-meta break-all">{person.email}{person.inbox ? ` · came to ${person.inbox}` : ""}</p>
      {person.at ? <p className="owner-meta">{when(person.at)}</p> : null}
      {person.note ? <p className="mt-1 text-sm text-[#3b3a36]">{person.note}</p> : null}
    </li>)}</ul> : <Empty>{empty}</Empty>}
  </Panel>;
}

export default async function CampaignPage({ params }: { params: Promise<{ key: string }> }) {
  const session = await requireSession();
  const { key } = await params;
  const env = getCloudflareBindings() ?? {};
  const firstInbox = typeof env.FCC_SENDER_ADDRESS === "string" ? env.FCC_SENDER_ADDRESS : null;
  const mailing = typeof env.FCC_CAMPAIGN_MAILING_ADDRESS === "string" ? env.FCC_CAMPAIGN_MAILING_ADDRESS : "";
  let data: CampaignDetail | null;
  let replyCheck: { at?: string } | null = null;
  try {
    const db = getDatabase() as unknown as ProspectDb;
    [data, replyCheck] = await withTimeout(Promise.all([campaignDetail(db, key, firstInbox), readKv<{ at?: string }>(db, OUTREACH_REPLY_STATE).catch(() => null)]), 12_000, "campaign");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="Campaign" title="Campaign" />
      <Notice tone="warning" icon={AlertTriangle} title="This campaign couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  if (!data) notFound();
  const { campaign, counts } = data;
  const state = STATES[campaign.state];
  const owner = Boolean(ownerForAccount(session.user.email ?? ""));
  const [first, second] = campaign.words.steps;
  const rules = Object.entries(campaign.rules.holdUnless ?? {}).map(([column, values]) => `${column} must be ${values.slice(0, 2).join(" or ")}`);

  return <OwnerPage>
    <PageHeader eyebrow={<Link href={"/campaigns" as Route} className="hover:underline">Campaigns</Link>} title={campaign.name}
      status={<Badge tone={state.tone} icon={state.icon}>{state.text}</Badge>} description={campaign.note ?? undefined} />

    {campaign.problem ? <Notice tone="danger" icon={AlertTriangle} title="This campaign can't send." role="alert">Its settings can&rsquo;t be used: {campaign.problem}.</Notice> : null}

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Next send" icon={CalendarClock}>
        <p className="text-lg font-medium leading-snug">{data.nextSend}</p>
        {campaign.state === "paused" && campaign.stateReason
          ? <div className="mt-4"><Notice tone="warning" icon={AlertTriangle} title={`Paused${campaign.stateBy ? ` by ${campaign.stateBy}` : ""}${campaign.stateAt ? `, ${when(campaign.stateAt)}` : ""}`}>{campaign.stateReason}</Notice></div>
          : null}
        <ul className="mt-4 space-y-1.5 text-sm text-[#5c584f]">
          {data.lastRun ? <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Last check {when(data.lastRun.at)}: {data.lastRun.note}</span></li> : null}
          <li className="flex gap-2"><MailSearch className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{replyCheck?.at ? `Inboxes last read for replies ${when(replyCheck.at)}.` : "Inboxes are read for replies every hour, 7 a.m. to 9 p.m., once this campaign has sent."}</span></li>
          <li className="flex gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Batches are approved by {campaign.approvers.join(" or ") || "nobody yet"}.</span></li>
        </ul>
      </Panel>
      <Panel title="Pause or resume" icon={PauseCircle}>
        {owner ? <CampaignPauseButton campaign={campaign.key} state={campaign.state} /> : <Empty>Only Riley or Aidan can pause or resume campaigns.</Empty>}
      </Panel>
    </div>

    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
      <StatCard icon={Send} label="Sent today" value={counts.sentToday} detail={`of today's ${campaign.dailyLimit}`} />
      <StatCard icon={MailCheck} label="Emailed" value={counts.emailed} detail={`${counts.followUpsSent} follow-ups sent`} />
      <StatCard icon={Inbox} label="Ready to send" value={counts.ready} detail={counts.waiting ? `${counts.waiting} more waiting for approval` : "In approved batches"} />
      <StatCard icon={Lock} label="Held" value={counts.held} detail="Never sent: see each batch for why" />
      <StatCard icon={Reply} label="Replies" value={counts.replies} detail={`${counts.noThanks} said no thanks, plus ${counts.automatic} automatic`} />
      <StatCard icon={MailX} label="Bounced" value={counts.bounced} detail={`${counts.stopped} stopped by us`} />
      <StatCard icon={CalendarClock} label="Follow-ups due" value={counts.followUpsDue} detail={campaign.followUps ? `${campaign.followUpBusinessDays} business days after the first email` : "No follow-up"} />
      <StatCard icon={AlertTriangle} label="Problems" value={counts.failed} detail="Gmail refused; waits for a person" />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Inboxes today" icon={Inbox} flush description="This campaign's share, and the whole inbox with FCC and every campaign.">
        {data.inboxes.length ? <div className="overflow-x-auto"><table className="owner-table min-w-[460px]">
          <thead><tr><th>Inbox</th><th className="text-right">This campaign</th><th className="text-right">Whole inbox</th></tr></thead>
          <tbody>{data.inboxes.map((inbox) => <tr key={inbox.address}>
            <td><p className="font-semibold">{inbox.name}</p><p className="owner-meta break-all">{inbox.address}</p></td>
            <td className="text-right tabular-nums">{inbox.sentByCampaign} of {inbox.perDay}</td>
            <td className="text-right tabular-nums">{inbox.inboxSent} of {inbox.inboxDayMax}<p className="owner-meta">{inbox.inboxCapNow} allowed so far today</p></td>
          </tr>)}</tbody>
        </table></div> : <div className="px-5 py-6 sm:px-6"><Empty>No inbox sends this campaign.</Empty></div>}
      </Panel>
      <Panel title="Settings" icon={Settings2}>
        <ul className="owner-list text-sm text-[#3b3a36]">
          <li>{campaign.sendDays.join(", ")} from {clock(campaign.windowStart)} to {clock(campaign.windowEnd)} Toronto time{campaign.startDay ? `, from ${dayLabel(campaign.startDay)}` : ""}{campaign.endDay ? ` to ${dayLabel(campaign.endDay)}` : ""}.</li>
          <li>Up to {campaign.dailyLimit} a day, follow-ups included, one every 1 to 3 minutes. Follow-ups go before new first emails.</li>
          <li>{campaign.followUps ? `${campaign.followUps} follow-up${campaign.followUps === 1 ? "" : "s"}, ${campaign.followUpBusinessDays} business days apart, in the same thread from the same inbox.` : "No follow-up."} Any reply, bounce or &ldquo;no thanks&rdquo; stops it for good.</li>
          <li>Held when: {[...rules, "a blank the words use is empty", campaign.rules.noLinksInFirst ? "the first email would carry a link or web address" : null, "the address is on the do-not-email list"].filter(Boolean).join("; ")}.</li>
          <li>Words version {campaign.wordsVersion ?? "not loaded"}.</li>
        </ul>
      </Panel>
    </div>

    <Panel title="Latest email words" icon={FileText} description="Each batch keeps the words it was loaded with; these are the latest, filled in when the next list is loaded. Blanks in {braces} come from each row; the engine adds the footer.">
      {first ? <div className="space-y-4 text-sm">
        <div><p className="owner-meta">First email · Subject</p><p className="font-semibold">{first.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-[#3b3a36]">{first.body}</pre></div>
        {second ? <div><p className="owner-meta">Follow-up · Subject: Re: the first email&rsquo;s subject</p><pre className="mt-2 whitespace-pre-wrap font-sans text-[#3b3a36]">{second.body}</pre></div> : null}
        <div><p className="owner-meta">Footer on every email</p><pre className="mt-1 whitespace-pre-wrap font-sans text-[#5c584f]">{campaignFooter(mailing || "(the mailing address)")}</pre></div>
      </div> : <Empty>No words loaded yet.</Empty>}
    </Panel>

    <Panel title="Batches" icon={Layers} flush description="Each loaded list. Open one to read its sample emails, its held rows, and approve it."
      action={owner ? <Link href={`/campaigns/${campaign.key}/load` as Route} className={buttonVariants({ variant: "outline", size: "sm" })}><Upload aria-hidden="true" />Load a list</Link> : undefined}>
      {data.batches.length ? <div className="overflow-x-auto"><table className="owner-table min-w-[640px]">
        <thead><tr><th>Batch</th><th>Loaded</th><th>Status</th><th className="text-right">Ready</th><th className="text-right">Held</th><th className="text-right">Emailed</th><th className="text-right">Stopped</th></tr></thead>
        <tbody>{data.batches.map((batch) => {
          const status = batch.status === "approved" && !batch.wordsCurrent ? { text: "Words changed: approve again", tone: "warning" as Tone } : BATCH[batch.status] ?? { text: batch.status, tone: "neutral" as Tone };
          return <tr key={batch.id}>
            <td className="font-semibold"><Link className="hover:underline" href={`/campaigns/${campaign.key}/batches/${batch.id}` as Route}>{batch.name}</Link></td>
            <td className="whitespace-nowrap">{when(batch.loadedAt)}<p className="owner-meta">by {batch.loadedBy}</p></td>
            <td><Badge tone={status.tone}>{status.text}</Badge>{batch.approvedBy && batch.approvedAt ? <p className="owner-meta">{batch.approvedBy}, {when(batch.approvedAt)}</p> : null}</td>
            <td className="text-right tabular-nums">{batch.ready}</td><td className="text-right tabular-nums">{batch.held}</td>
            <td className="text-right tabular-nums">{batch.emailed}</td><td className="text-right tabular-nums">{batch.stopped}</td>
          </tr>;
        })}</tbody>
      </table></div> : <div className="px-5 py-6 sm:px-6"><Empty>No list loaded yet.</Empty></div>}
    </Panel>

    <div className="grid gap-4 lg:grid-cols-3">
      <People title="Replies" icon={Reply} people={data.replies} empty="No replies yet." />
      <People title="Bounces" icon={MailX} people={data.bounces} empty="Nothing has bounced." />
      <People title="Problems" icon={AlertTriangle} people={data.problems} empty="No email has failed to send." />
    </div>

    <Panel title="Emails out per day" icon={TrendingUp} flush>
      {data.days.length ? <div className="overflow-x-auto"><table className="owner-table min-w-[360px]">
        <thead><tr><th>Day</th><th className="text-right">First</th><th className="text-right">Follow-up</th><th className="text-right">Total</th></tr></thead>
        <tbody>{data.days.map((row) => <tr key={row.day}><td className="font-semibold">{dayLabel(row.day)}</td><td className="text-right tabular-nums">{row.first}</td>
          <td className="text-right tabular-nums">{row.followUps}</td><td className="text-right tabular-nums">{row.first + row.followUps}</td></tr>)}</tbody>
      </table></div> : <div className="px-5 py-6 sm:px-6"><Empty>Nothing sent yet.</Empty></div>}
    </Panel>

    <Panel title="How this campaign sends" icon={ListChecks}>
      <ul className="owner-list text-sm text-[#3b3a36]">
        <li>Only approved batches send, and only on the words they were approved on.</li>
        <li>It shares each inbox with FCC and other campaigns: no inbox goes over its safe daily amount, and campaigns go before FCC.</li>
        <li>It pauses itself when 3 of its own emails bounce in a day, on a Google warning, or when Gmail refuses a send or a login. Only a founder&rsquo;s Resume restarts it.</li>
        <li>An inbox with 3 bounces in a day, from any campaign or FCC, sends nothing more that day and starts again the next morning. Nothing is paused.</li>
        <li>Every hour from 7 a.m. to 9 p.m. both inboxes are read for replies. A reply stops that person&rsquo;s follow-ups; a &ldquo;no thanks&rdquo; also puts them on the do-not-email list for every campaign.</li>
      </ul>
    </Panel>
  </OwnerPage>;
}
