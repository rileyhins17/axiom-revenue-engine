import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle, BadgeCheck, BarChart3, CalendarClock, CheckCircle2, Clock, FileText, Layers, MailSearch, MailX, PauseCircle, Search, Settings2, Upload, Users,
  type LucideIcon,
} from "lucide-react";

import { CampaignPauseButton } from "@/components/campaigns/campaign-actions";
import { buttonVariants } from "@/components/ui/button";
import { Badge, Empty, Facts, Notice, OwnerPage, PageHeader, Panel, RowLink, StatCard, type Tone } from "@/components/owner/kit";
import { getDatabase } from "@/lib/cloudflare";
import { engineSetting } from "@/lib/engine-settings";
import { readReplyCheck } from "@/lib/outreach/outreach-inbox-health";
import { dayText, per100, plural, whenText } from "@/lib/outreach/outreach-format";
import { findContacts, type ContactHit } from "@/lib/outreach/outreach-lookup";
import { successLabelOf } from "@/lib/outreach/outreach-model";
import { OUTREACH_AUTO_PAUSE_BY } from "@/lib/outreach/outreach-sender";
import { campaignDetail, type BatchDetail, type BatchPhase, type CampaignDetail, type PersonRow } from "@/lib/outreach/outreach-status";
import { campaignFooter } from "@/lib/outreach/outreach-words";
import { ownerForAccount } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaign | Axiom Revenue Engine" };

const clock = (minute: number) => `${Math.floor(minute / 60) % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${minute < 720 ? "a.m." : "p.m."}`;
const PHASES: Array<{ phase: BatchPhase; title: string; empty?: string }> = [
  { phase: "waiting", title: "Waiting for approval" },
  { phase: "sending", title: "Sending" },
  { phase: "done", title: "Done" },
  { phase: "stopped", title: "Stopped" },
];
const PHASE_BADGE: Record<BatchPhase, { text: string; tone: Tone }> = {
  waiting: { text: "Waiting for approval", tone: "warning" }, sending: { text: "Sending", tone: "success" }, done: { text: "Done", tone: "neutral" }, stopped: { text: "Stopped", tone: "neutral" },
};

function BatchRowLink({ campaign, batch, approvers }: { campaign: string; batch: BatchDetail; approvers: string }) {
  const held = batch.heldReasons.slice(0, 2).map((item) => `${item.reason.replace(/\.$/, "")} (${item.rows})`).join("; ");
  const badge = batch.phase === "waiting" && batch.status === "approved" ? { text: "Words changed: approve again", tone: "warning" as Tone }
    : batch.phase === "waiting" ? { text: `Waits for ${approvers}`, tone: "warning" as Tone } : PHASE_BADGE[batch.phase];
  return <RowLink href={`/campaigns/${campaign}/batches/${batch.id}` as Route} title={<>{batch.name}<Badge tone={badge.tone}>{badge.text}</Badge></>}
    meta={batch.approvedBy && batch.approvedAt ? `Approved by ${batch.approvedBy}, ${whenText(batch.approvedAt)}` : `Loaded by ${batch.loadedBy}, ${whenText(batch.loadedAt)}`}>
    <span className="block text-sm owner-text">
      {batch.phase === "waiting" ? <><span className="owner-num">{batch.ready}</span> {batch.ready === 1 ? "email goes" : "emails go"} once approved</>
        : <><span className="owner-num">{batch.emailed}</span> emailed · <span className="owner-num">{batch.ready}</span> still to go{batch.followUpsLeft ? ` · ${plural(batch.followUpsLeft, "follow-up")} to come` : ""}</>}
      {batch.emailed ? <> · {plural(batch.replies, "reply", "replies")} · {plural(batch.bounced, "bounce")}</> : null}
    </span>
    {batch.held ? <span className="owner-meta block">{batch.held} held, never sent{held ? `: ${held}` : ""}</span> : null}
  </RowLink>;
}

function People({ id, title, icon, empty, people }: { id?: string; title: string; icon: LucideIcon; empty: string; people: PersonRow[] }) {
  return <Panel id={id} title={title} icon={icon} count={people.length}>
    {people.length ? <ul className="owner-list">{people.map((person, index) => <li key={`${person.email}-${index}`}>
      <p className="text-sm font-semibold owner-ink">{person.label}</p>
      <p className="owner-meta break-all">{person.email}{person.at ? ` · ${whenText(person.at)}` : ""}</p>
      {person.note ? <p className="mt-1 text-sm owner-text">{person.note}</p> : null}
    </li>)}</ul> : <Empty>{empty}</Empty>}
  </Panel>;
}

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const { key } = await params;
  const query = ((await searchParams).q ?? "").trim().slice(0, 120);
  const mailing = engineSetting("FCC_CAMPAIGN_MAILING_ADDRESS");
  let data: CampaignDetail | null;
  let replyCheck: { at?: string } | null = null;
  let found: ContactHit[] = [];
  try {
    const db = getDatabase() as unknown as ProspectDb;
    [data, replyCheck, found] = await withTimeout(Promise.all([
      campaignDetail(db, key, engineSetting("FCC_SENDER_ADDRESS")), readReplyCheck(db), query.length >= 2 ? findContacts(db, query, { campaign: key, limit: 25 }) : Promise.resolve([]),
    ]), 12_000, "campaign");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="Campaign" title="Campaign" />
      <Notice tone="warning" icon={AlertTriangle} title="This campaign couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  if (!data) notFound();
  const { campaign, counts } = data;
  const owner = Boolean(ownerForAccount(session.user.email ?? ""));
  const autoPaused = campaign.state === "paused" && campaign.stateBy === OUTREACH_AUTO_PAUSE_BY;
  const approvers = campaign.approvers.join(" or ") || "its approver";
  const [first, second] = campaign.words.steps;
  const rules = Object.entries(campaign.rules.holdUnless ?? {}).map(([column, values]) => `${column} must be ${values.slice(0, 2).join(" or ")}`);
  const label = successLabelOf(campaign);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const coming = data.followUps.coming.filter((row) => row.day > today);
  const withResults = data.batches.filter((batch) => batch.emailed > 0);

  return <OwnerPage>
    <PageHeader eyebrow={<Link href={"/campaigns" as Route} className="hover:underline">Campaigns</Link>} title={campaign.name}
      status={campaign.state === "live" ? <Badge tone="success" icon={CheckCircle2}>Live</Badge>
        : <Badge tone={autoPaused ? "danger" : "warning"} icon={PauseCircle}>{autoPaused ? "Paused itself" : "Paused"}</Badge>}
      description={campaign.note ?? undefined} />

    {campaign.problem ? <Notice tone="danger" icon={AlertTriangle} title="This campaign can't send." role="alert">Its settings can&rsquo;t be used: {campaign.problem}.</Notice> : null}

    {/* 1. Where it stands, and the switch */}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Next send" icon={CalendarClock}>
        <p className="text-lg font-medium leading-snug owner-ink">{data.nextSend}</p>
        {campaign.state === "paused" && campaign.stateReason
          ? <div className="mt-4"><Notice tone={autoPaused ? "danger" : "warning"} icon={AlertTriangle} title={`Paused${campaign.stateBy ? ` by ${campaign.stateBy}` : ""}${campaign.stateAt ? `, ${whenText(campaign.stateAt)}` : ""}`}>{campaign.stateReason}</Notice></div>
          : null}
        <ul className="mt-4 space-y-1.5 text-sm" style={{ color: "var(--owner-muted)" }}>
          {data.lastRun ? <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Last check {whenText(data.lastRun.at)}: {data.lastRun.note}</span></li> : null}
          <li className="flex gap-2"><MailSearch className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{replyCheck?.at ? `Inboxes last read for replies ${whenText(replyCheck.at)}` : "Inboxes are read for replies every hour, 7 a.m. to 9 p.m., once this campaign has sent."}</span></li>
          <li className="flex gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Batches are approved by {approvers}.</span></li>
        </ul>
      </Panel>
      <Panel title={campaign.state === "live" ? "Pause" : "Resume"} icon={PauseCircle}>
        {owner ? <CampaignPauseButton campaign={campaign.key} state={campaign.state} /> : <Empty>Only Riley or Aidan can pause or resume campaigns.</Empty>}
      </Panel>
    </div>

    {/* 2. Batches: what waits for an approval first */}
    <Panel id="batches" title="Batches" icon={Layers} count={data.batches.length}
      description="Each loaded list. Open one to read its sample emails and its held rows."
      action={owner ? <Link href={`/campaigns/${campaign.key}/load` as Route} className={buttonVariants({ variant: "outline", size: "sm" })}><Upload aria-hidden="true" />Load a list</Link> : undefined}>
      {data.batches.length ? <div className="space-y-5">
        {PHASES.map(({ phase, title }) => {
          const batches = data!.batches.filter((batch) => batch.phase === phase);
          if (!batches.length) return null;
          return <div key={phase}>
            <p className="owner-section-label mb-1">{title} ({batches.length})</p>
            <ul className="owner-rows">{batches.map((batch) => <li key={batch.id}><BatchRowLink campaign={campaign.key} batch={batch} approvers={approvers} /></li>)}</ul>
          </div>;
        })}
      </div> : <Empty>No list loaded yet.{owner ? " Load one to get started." : ""}</Empty>}
    </Panel>

    {/* 3. Numbers */}
    <section aria-label="Numbers" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Sent today" value={counts.sentToday} detail={`of today's ${campaign.dailyLimit}`} />
        <StatCard label="Emailed" value={counts.emailed} detail={`${plural(counts.followUpsSent, "follow-up")} sent too`} />
        <StatCard href={`/replies?filter=all&campaign=${campaign.key}` as Route} label="Replies" value={counts.replies}
          detail={`${per100(counts.replies, counts.emailed) ?? "0.0"} per 100 emailed · ${counts.noThanks} no thanks · ${counts.automatic} automatic`} />
        <StatCard href={`/replies?filter=all&campaign=${campaign.key}` as Route} label={label} value={data.success}
          detail={`${per100(data.success, counts.emailed) ?? "0.0"} per 100 emailed. Marked on the Replies screen.`} />
        <StatCard label="Bounced" value={counts.bounced} detail={`${per100(counts.bounced, counts.emailed) ?? "0.0"} per 100 emailed`} />
        <StatCard label="Ready to send" value={counts.ready} detail={counts.waiting ? `${counts.waiting} more wait for approval` : "In approved batches"} />
        <StatCard label="Follow-ups due" value={counts.followUpsDue} detail={campaign.followUps ? `${coming.reduce((sum, row) => sum + row.people, 0)} more coming` : "This campaign sends no follow-up"} />
        <StatCard label="Held" value={counts.held} detail="Never sent: each batch says why" />
      </div>

      {campaign.followUps && (coming.length || data.followUps.onHold) ? <Panel title="Follow-ups" icon={CalendarClock}
        description={`One follow-up ${campaign.followUpBusinessDays} business days after the first email, in the same thread, only to people who haven't replied.`}>
        {data.followUps.onHold ? <div className="mb-4"><Notice tone="warning" icon={PauseCircle} title={`${plural(data.followUps.onHold, "follow-up")} on hold`}>
          These people got their first email, and their follow-up has no day set, so it won&rsquo;t go. Claude can put them back on a day when a founder says so.
        </Notice></div> : null}
        {coming.length ? <Facts items={coming.slice(0, 8).map((row) => ({ label: dayText(row.day), value: plural(row.people, "follow-up") }))} /> : <Empty>No follow-up is scheduled.</Empty>}
      </Panel> : null}

      {withResults.length ? <Panel title="Numbers by batch" icon={BarChart3} flush>
        <div className="overflow-x-auto"><table className="owner-table min-w-[560px]">
          <thead><tr><th>Batch</th><th className="text-right">Emailed</th><th className="text-right">Replies</th><th className="text-right">No thanks</th><th className="text-right">Bounced</th><th className="text-right">{label}</th></tr></thead>
          <tbody>{withResults.map((batch) => <tr key={batch.id}>
            <td className="font-semibold"><Link className="hover:underline" href={`/campaigns/${campaign.key}/batches/${batch.id}` as Route}>{batch.name}</Link></td>
            <td className="text-right owner-num">{batch.emailed}</td><td className="text-right owner-num">{batch.replies}</td><td className="text-right owner-num">{batch.noThanks}</td>
            <td className="text-right owner-num">{batch.bounced}</td><td className="text-right owner-num">{batch.success}</td>
          </tr>)}</tbody>
        </table></div>
      </Panel> : null}

      {data.days.length ? <Panel title="Emails out per day" icon={BarChart3} flush>
        <div className="overflow-x-auto"><table className="owner-table min-w-[340px]">
          <thead><tr><th>Day</th><th className="text-right">First</th><th className="text-right">Follow-up</th><th className="text-right">Total</th></tr></thead>
          <tbody>{data.days.slice(0, 10).map((row) => <tr key={row.day}><td className="font-semibold">{dayText(row.day)}</td><td className="text-right owner-num">{row.first}</td>
            <td className="text-right owner-num">{row.followUps}</td><td className="text-right owner-num">{row.first + row.followUps}</td></tr>)}</tbody>
        </table></div>
      </Panel> : null}
    </section>

    {/* 4. The words */}
    <Panel title="The words" icon={FileText} description="Each batch keeps the words it was loaded with. These are the latest, filled in when the next list is loaded. Blanks in {braces} come from each row.">
      {first ? <div className="space-y-4">
        <div className="owner-email">
          <div className="owner-email-head"><p><span>First email · Subject:</span> <b>{first.subject}</b></p></div>
          <pre className="owner-email-body">{first.body}</pre>
        </div>
        {second ? <div className="owner-email">
          <div className="owner-email-head"><p><span>Follow-up, {campaign.followUpBusinessDays} business days later · Subject:</span> Re: the first email&rsquo;s subject</p></div>
          <pre className="owner-email-body">{second.body}</pre>
        </div> : null}
        <div><p className="owner-meta">The engine adds this under every email</p><pre className="mt-1 whitespace-pre-wrap font-sans text-sm" style={{ color: "var(--owner-muted)" }}>{campaignFooter(mailing || "(the mailing address)")}</pre></div>
      </div> : <Empty>No words loaded yet. They come with the first list.</Empty>}
    </Panel>

    {/* 5. Schedule and limits: read-only here */}
    <Panel title="Schedule and limits" icon={Settings2} description="Read-only. Changing a limit, an inbox or who is emailed takes both founders' yes; ask Claude.">
      <Facts items={[
        { label: "Send days", value: `${campaign.sendDays.join(", ")}, ${clock(campaign.windowStart)} to ${clock(campaign.windowEnd)} Toronto time` },
        ...(campaign.startDay || campaign.endDay ? [{ label: "Runs", value: `${campaign.startDay ? `from ${dayText(campaign.startDay)}` : ""}${campaign.endDay ? ` to ${dayText(campaign.endDay)}` : ""}`.trim() }] : []),
        { label: "Daily limit", value: `${campaign.dailyLimit} emails, follow-ups included` },
        ...data.inboxes.map((inbox) => ({ label: `${inbox.name.split(" ")[0]}'s inbox`, value: `${inbox.sentByCampaign} of ${inbox.perDay} today (the whole inbox: ${inbox.inboxSent} of ${inbox.inboxDayMax})` })),
        { label: "Follow-up", value: campaign.followUps ? `${campaign.followUps}, ${campaign.followUpBusinessDays} business days after the email before` : "None" },
        { label: "Approved by", value: approvers },
        { label: "A row is held when", value: [...rules, "a blank the words use is empty", campaign.rules.noLinksInFirst ? "the first email would carry a link" : null, "its domain has no mail server", "the address is on the do-not-email list"].filter(Boolean).join("; ") },
        { label: "Judged by", value: label },
      ]} />
      <p className="owner-meta mt-3"><Link className="owner-link" href={"/inboxes" as Route}>See the inboxes</Link></p>
    </Panel>

    {/* 6. People */}
    <Panel id="people" title="People" icon={Users} description="Find anyone on this campaign's lists by email address or organisation: where they stand, what they got, and whether they replied.">
      <form action={`/campaigns/${campaign.key}#people`} method="get" className="owner-search" role="search">
        <input type="search" name="q" defaultValue={query} placeholder="Address or organisation" aria-label="Find a person or organisation" autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <button type="submit" className={buttonVariants({ size: "lg" })}><Search aria-hidden="true" /><span className="sr-only sm:not-sr-only">Find</span></button>
      </form>
      {query.length >= 2 ? <div className="mt-4">
        {found.length ? <ul className="owner-list">{found.map((person) => <li key={person.id}>
          <p className="text-sm font-semibold owner-ink">{person.organisation}{person.person ? <span className="font-normal owner-text"> · {person.person}</span> : null}</p>
          <p className="owner-meta break-all">{person.email} · batch {person.batch}</p>
          <p className="mt-1 text-sm owner-text">{person.statusText}{person.emailsSent ? `. ${plural(person.emailsSent, "email")} sent${person.firstSentAt ? `, the first ${whenText(person.firstSentAt)}` : ""}` : ""}{person.replies ? `. ${plural(person.replies, "reply", "replies")} recorded` : ""}.</p>
          {person.reason ? <p className="owner-meta">{person.reason}</p> : null}
        </li>)}</ul> : <Empty>Nobody on this campaign&rsquo;s lists matches &ldquo;{query}&rdquo;.</Empty>}
      </div> : null}
    </Panel>

    <div className="grid gap-4 lg:grid-cols-2">
      <People title="Bounces" icon={MailX} people={data.bounces} empty="Nothing has bounced." />
      <People id="problems" title="Problems" icon={AlertTriangle} people={data.problems} empty="No email has failed to send." />
    </div>

    {/* 7. Load a list */}
    {owner ? <Panel title="Load a list" icon={Upload} description={`Check a list against this campaign's words and rules, then load it as a batch. Nothing in it sends until ${approvers} approves it.`}>
      <Link href={`/campaigns/${campaign.key}/load` as Route} className={buttonVariants({ variant: "outline", size: "lg" })}><Upload aria-hidden="true" />Load a list</Link>
    </Panel> : null}
  </OwnerPage>;
}
