import type { Metadata, Route } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Layers, Lock, PauseCircle, Send, type LucideIcon } from "lucide-react";

import { Badge, Empty, Notice, OwnerPage, PageHeader, Panel, type Tone } from "@/components/owner/kit";
import { getDatabase } from "@/lib/cloudflare";
import { fccScreen, type FccScreen } from "@/lib/fcc-campaign-status";
import { campaignSummaries, type CampaignSummary } from "@/lib/outreach/outreach-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns | Axiom Revenue Engine" };

const STATE: Record<"live" | "paused" | "locked", { text: string; tone: Tone; icon: LucideIcon }> = {
  live: { text: "Live", tone: "success", icon: CheckCircle2 },
  paused: { text: "Paused", tone: "warning", icon: PauseCircle },
  locked: { text: "Locked", tone: "neutral", icon: Lock },
};

function Row({ href, name, state, sentToday, limit, ready, waiting, replies, bounced, next }: {
  href: Route; name: string; state: "live" | "paused" | "locked"; sentToday: number; limit: string; ready: number; waiting: number | null; replies: number; bounced: number; next: string;
}) {
  const badge = STATE[state];
  return <li>
    <Link href={href} className="group flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="flex items-center gap-2 text-base font-semibold">{name} <Badge tone={badge.tone} icon={badge.icon}>{badge.text}</Badge></p>
        <p className="owner-meta">{next}</p>
        <p className="text-sm text-[#3b3a36]">Sent today {sentToday} of {limit} · {ready} ready{waiting ? ` · ${waiting} waiting for approval` : ""} · {replies} {replies === 1 ? "reply" : "replies"} · {bounced} bounced</p>
      </div>
      <span className="flex items-center gap-1 text-sm font-semibold text-[#8a6420]">Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
    </Link>
  </li>;
}

export default async function CampaignsPage() {
  await requireSession();
  let summaries: CampaignSummary[];
  let fcc: FccScreen | null = null;
  try {
    const db = getDatabase() as unknown as ProspectDb;
    [summaries, fcc] = await withTimeout(Promise.all([campaignSummaries(db), fccScreen(db).catch(() => null)]), 12_000, "campaigns");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="Outreach" title="Campaigns" />
      <Notice tone="warning" icon={AlertTriangle} title="The campaigns couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  return <OwnerPage>
    <PageHeader eyebrow="Outreach" title="Campaigns"
      description="Every outreach list the engine sends, side by side. Each has its own list, words, schedule, daily limit, follow-up and Pause. They share each inbox's safe daily amount, and campaigns go before FCC." />
    <Panel title="All campaigns" icon={Layers} count={summaries.length + (fcc ? 1 : 0)}>
      {summaries.length || fcc ? <ul className="owner-list">
        {summaries.map((summary) => <Row key={summary.campaign.key} href={`/campaigns/${summary.campaign.key}` as Route} name={summary.campaign.name}
          state={summary.campaign.state} sentToday={summary.counts.sentToday} limit={String(summary.campaign.dailyLimit)} ready={summary.counts.ready}
          waiting={summary.counts.waiting} replies={summary.counts.replies} bounced={summary.counts.bounced} next={summary.nextSend} />)}
        {fcc ? <Row href={"/fcc" as Route} name="FCC March 1 pack" state={fcc.state} sentToday={fcc.sentToday.first + fcc.sentToday.followUps} limit={String(fcc.batchSize * 2)}
          ready={fcc.ready} waiting={null} replies={fcc.replies.length} bounced={fcc.bounces.length} next={fcc.nextSend} /> : null}
      </ul> : <Empty>No campaigns yet.</Empty>}
    </Panel>
    <Panel title="How every campaign sends" icon={Send}>
      <ul className="owner-list text-sm text-[#3b3a36]">
        <li>Nothing goes to anyone until the campaign is live and its batch is approved by the person named on it, after reading samples exactly as they will go out. Changed words lock every batch until it is approved again.</li>
        <li>One email at a time per inbox, 1 to 3 minutes apart, whichever campaign sends it. No inbox goes over its safe daily amount, all campaigns and FCC together: half of it before 12:30, the rest only if that inbox had 1 bounce or fewer.</li>
        <li>Every email carries our mailing address and a &ldquo;reply no thanks&rdquo; line. A row with a blank field the words use is held, never sent.</li>
        <li>Anyone who bounced or said no thanks in any campaign is never emailed by any campaign again. A reply from anyone at the same organisation stops the follow-ups.</li>
        <li>A campaign pauses itself on a Google warning, Gmail refusing a send or a login, or 3 bounces in a day from one inbox.</li>
      </ul>
    </Panel>
  </OwnerPage>;
}
