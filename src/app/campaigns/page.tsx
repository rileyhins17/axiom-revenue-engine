import type { Metadata, Route } from "next";
import { AlertTriangle, CheckCircle2, Layers, PauseCircle, Send } from "lucide-react";

import { Badge, Empty, Notice, OwnerPage, PageHeader, Panel, RowLink } from "@/components/owner/kit";
import { getDatabase } from "@/lib/cloudflare";
import { per100, plural } from "@/lib/outreach/outreach-format";
import { OUTREACH_AUTO_PAUSE_BY } from "@/lib/outreach/outreach-sender";
import { campaignSummaries, type CampaignSummary } from "@/lib/outreach/outreach-status";
import { thisWeek, weekNumbers, type WeekNumbers } from "@/lib/outreach/outreach-week";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns | Axiom Revenue Engine" };

/** Every campaign: where it stands today, what waits, and its results since it started. */
export default async function CampaignsPage() {
  await requireSession();
  const now = new Date();
  let summaries: CampaignSummary[];
  let week: WeekNumbers | null = null;
  try {
    const db = getDatabase() as unknown as ProspectDb;
    const range = thisWeek(now);
    [summaries, week] = await withTimeout(Promise.all([campaignSummaries(db, now), weekNumbers(db, range.from, range.to, now).catch(() => null)]), 12_000, "campaigns");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="Outreach" title="Campaigns" />
      <Notice tone="warning" icon={AlertTriangle} title="The campaigns couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  return <OwnerPage>
    <PageHeader eyebrow="Outreach" title="Campaigns"
      description="Every list the engine sends. Each has its own batches, words, schedule, daily limit, follow-up and Pause, and they share each inbox's safe daily amount." />
    <Panel title="All campaigns" icon={Layers} count={summaries.length}>
      {summaries.length ? <ul className="owner-rows">
        {summaries.map(({ campaign, counts, nextSend }) => {
          const numbers = week?.campaigns.find((row) => row.key === campaign.key);
          const autoPaused = campaign.state === "paused" && campaign.stateBy === OUTREACH_AUTO_PAUSE_BY;
          const waiting = counts.ready + counts.waiting + counts.followUpsDue;
          const rate = per100(counts.replies, counts.emailed);
          const successRate = numbers ? per100(numbers.allTime.success, counts.emailed) : null;
          return <li key={campaign.key}>
            <RowLink href={`/campaigns/${campaign.key}` as Route}
              title={<>{campaign.name}{campaign.state === "live"
                ? <Badge tone="success" icon={CheckCircle2}>Live</Badge>
                : <Badge tone={autoPaused ? "danger" : "warning"} icon={PauseCircle}>{autoPaused ? "Paused itself" : "Paused"}</Badge>}</>}
              meta={nextSend}>
              <span className="block text-sm owner-text">
                <span className="owner-num">{counts.sentToday}</span> of {campaign.dailyLimit} sent today · <span className="owner-num">{waiting}</span> waiting{counts.waiting ? ` (${counts.waiting} not approved yet)` : ""} · {plural(numbers?.replies ?? 0, "reply", "replies")} this week
              </span>
              <span className="owner-meta block">
                Since it started: {counts.emailed} emailed, {plural(counts.replies, "reply", "replies")}{rate ? ` (${rate} per 100)` : ""}, {counts.noThanks} no thanks, {plural(counts.bounced, "bounce")}
                {numbers ? `, ${numbers.successLabel.toLowerCase()} ${numbers.allTime.success}${successRate ? ` (${successRate} per 100)` : ""}` : ""}.
              </span>
            </RowLink>
          </li>;
        })}
      </ul> : <Empty>No campaigns yet. Claude adds one with a list, its words, a schedule and both founders&rsquo; yes.</Empty>}
    </Panel>
    <Panel title="How every campaign sends" icon={Send}>
      <ul className="owner-list text-sm owner-text">
        <li>Nothing goes to anyone until the campaign is live and its batch is approved by the person named on it, after reading samples exactly as they will go out.</li>
        <li>One email at a time per inbox, 1 to 3 minutes apart, whichever campaign sends it. No inbox goes over its safe daily amount, all campaigns together: half of it before 12:30, the rest only if that inbox had 1 bounce or fewer.</li>
        <li>Anyone who bounced or said no thanks in any campaign is never emailed again. A reply from anyone at the same organisation stops the follow-ups.</li>
        <li>A campaign pauses itself when 3 of its own emails bounce in a day, on a Google warning, or when Gmail refuses a send or a login. An inbox with 3 bounces in a day rests until the next morning.</li>
      </ul>
    </Panel>
  </OwnerPage>;
}
