import type { Metadata, Route } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Inbox, MailSearch, MoonStar, PowerOff } from "lucide-react";

import { Badge, Empty, Facts, Meter, Notice, OwnerPage, PageHeader, Panel, type Tone } from "@/components/owner/kit";
import { getDatabase } from "@/lib/cloudflare";
import { engineSetting } from "@/lib/engine-settings";
import { dayText, whenText } from "@/lib/outreach/outreach-format";
import type { InboxHealth } from "@/lib/outreach/outreach-inbox-health";
import { todayData, type TodayData } from "@/lib/outreach/outreach-today";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inboxes | Axiom Revenue Engine" };

function state(inbox: InboxHealth): { text: string; tone: Tone; icon: typeof Inbox } {
  if (!inbox.enabled || inbox.dayMax <= 0) return { text: "Switched off", tone: "neutral", icon: PowerOff };
  if (inbox.resting) return { text: "Resting today", tone: "warning", icon: MoonStar };
  if (!inbox.replyCheck.couldOpen) return { text: "Can't be read", tone: "danger", icon: AlertTriangle };
  return { text: "Healthy", tone: "success", icon: CheckCircle2 };
}

/** Each sending inbox today. Read-only: limits and inboxes change only with both founders' yes. */
export default async function InboxesPage() {
  await requireSession();
  let data: TodayData;
  try {
    data = await withTimeout(todayData(getDatabase() as unknown as ProspectDb, engineSetting("FCC_SENDER_ADDRESS")), 12_000, "inboxes");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow="More" title="Inboxes" />
      <Notice tone="warning" icon={AlertTriangle} title="The inboxes couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  return <OwnerPage>
    <PageHeader eyebrow="More" title="Inboxes"
      description="The inboxes the engine sends from. Each has a safe daily amount for every campaign together: half of it before 12:30, the rest only with 1 bounce or fewer, one email every 1 to 3 minutes. 3 bounces in a day rest an inbox until the next morning." />

    {data.replyCheck.unread.length || data.replyCheck.stale
      ? <Notice tone="danger" icon={AlertTriangle} title={data.replyCheck.unread.length ? "The last reply check couldn't open an inbox." : "The hourly reply check has stopped."} role="alert">
        Replies may be waiting unseen. Look in the inbox yourself today, then ask Claude to check its app password.
      </Notice>
      : <Notice tone="info" icon={MailSearch} title={data.replyCheck.at ? `Inboxes last read for replies ${whenText(data.replyCheck.at)}` : "The inboxes haven't been read for replies yet."}>
        Every hour from 7 a.m. to 9 p.m., every day, once a campaign has sent. Reading only: the engine never changes mail.
      </Notice>}

    {data.inboxes.length ? data.inboxes.map((inbox) => {
      const badge = state(inbox);
      return <Panel key={inbox.address} title={`${inbox.firstName}'s inbox`} icon={Inbox} action={<Badge tone={badge.tone} icon={badge.icon}>{badge.text}</Badge>}>
        <p className="owner-meta break-all">{inbox.name} · {inbox.address}</p>
        <div className="mt-4 space-y-2">
          <p className="text-[15px] owner-ink"><b className="owner-num text-2xl font-semibold">{inbox.sentToday}</b> of {inbox.dayMax} sent today · {inbox.nextText}</p>
          <Meter value={inbox.sentToday} max={inbox.dayMax} mark={inbox.capNow} tone={inbox.resting ? "warning" : undefined} label={`${inbox.sentToday} of ${inbox.dayMax} sent today`} />
          {inbox.capNow < inbox.dayMax ? <p className="owner-meta">The mark is the {inbox.capNow} it may send before 12:30.</p> : null}
        </div>
        {inbox.resting ? <div className="mt-4"><Notice tone="warning" icon={MoonStar} title="Resting until tomorrow.">
          {inbox.bouncesToday} of its emails bounced today, so it sends nothing more today. Nobody is paused. If one list is bad, pause that campaign before tomorrow.
        </Notice></div> : null}
        <div className="mt-4"><Facts items={[
          { label: "Bounces today", value: `${inbox.bouncesToday} of 3` },
          { label: "Safe daily amount", value: inbox.ramp
            ? `${inbox.dayMax} today, on its way to ${inbox.fullMax} (a new inbox: ${inbox.ramp.steps.join(", then ")} a day by week, from ${dayText(inbox.ramp.from)})`
            : `${inbox.fullMax} a day` },
          { label: "Replies last read", value: inbox.replyCheck.lastReadAt
            ? `${whenText(inbox.replyCheck.lastReadAt)}${inbox.replyCheck.couldOpen ? "" : ". The latest check couldn't open it"}`
            : inbox.replyCheck.couldOpen ? "Not read yet" : "The latest check couldn't open it" },
          ...(inbox.readsVia ? [{ label: "Its replies are read in", value: inbox.readsVia }] : []),
        ]} /></div>
        <div className="mt-4">
          <p className="owner-section-label mb-1">Campaigns that use it</p>
          {inbox.campaigns.length ? <ul className="owner-rows">{inbox.campaigns.map((campaign) => <li key={campaign.key}>
            <Link href={`/campaigns/${campaign.key}` as Route} className="owner-row">
              <span className="min-w-0"><span className="owner-row-title">{campaign.name}{campaign.state === "paused" ? <Badge tone="warning">Paused</Badge> : null}</span></span>
              <span className="owner-meta owner-num flex-none">{campaign.sentToday} of {campaign.perDay} today</span>
            </Link>
          </li>)}</ul> : <Empty>No campaign sends from it.</Empty>}
        </div>
      </Panel>;
    }) : <Panel><Empty>No sending inbox is set up.</Empty></Panel>}

    <p className="owner-meta">Read-only. Adding an inbox or raising a limit takes both founders&rsquo; yes; ask Claude.</p>
  </OwnerPage>;
}
