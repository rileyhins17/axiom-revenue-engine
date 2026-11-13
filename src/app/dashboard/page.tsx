import type { Metadata, Route } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarRange, CheckCircle2, CircleCheck, Layers, PauseCircle, Send, Sparkles } from "lucide-react";

import { CountUp } from "@/components/motion/count-up";
import { Badge, Meter, NeedCard, Notice, OwnerPage, PageHeader, Panel, RowLink, SectionLabel, StatCard } from "@/components/owner/kit";
import { getDatabase } from "@/lib/cloudflare";
import { engineSetting } from "@/lib/engine-settings";
import { dayText, per100, plural } from "@/lib/outreach/outreach-format";
import { needsYou, todayData, type TodayData } from "@/lib/outreach/outreach-today";
import { thisWeek, weekNumbers, type WeekNumbers } from "@/lib/outreach/outreach-week";
import { ownerForAccount } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today | Axiom Revenue Engine" };

/** Today: what needs you, then whether everything is OK. Every campaign together; nothing about FCC. */
export default async function TodayPage() {
  const session = await requireSession();
  const now = new Date();
  const viewer = ownerForAccount(session.user.email ?? "")?.name ?? null;
  const firstName = viewer ?? session.user.name?.split(" ")[0] ?? "there";
  const hour = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone: "America/Toronto" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Toronto" }).format(now);

  let data: TodayData;
  let week: WeekNumbers | null = null;
  try {
    const db = getDatabase() as unknown as ProspectDb;
    const range = thisWeek(now);
    // The week's numbers are the second half of the screen: if they fail, the first half still shows.
    [data, week] = await withTimeout(Promise.all([todayData(db, engineSetting("FCC_SENDER_ADDRESS"), now), weekNumbers(db, range.from, range.to, now).catch(() => null)]), 12_000, "today");
  } catch {
    return <OwnerPage>
      <PageHeader eyebrow={date} title={`${greeting}, ${firstName}.`} />
      <Notice tone="warning" icon={AlertTriangle} title="Today's numbers couldn't be loaded." role="status">Refresh in a minute.</Notice>
    </OwnerPage>;
  }
  const needs = needsYou(data, viewer);
  const weekOf = (key: string) => week?.campaigns.find((row) => row.key === key);

  return <OwnerPage>
    <PageHeader eyebrow={date} title={`${greeting}, ${firstName}.`} />

    <section aria-label="Needs you" className="space-y-3">
      <SectionLabel icon={Sparkles}>Needs you</SectionLabel>
      {needs.cards.length
        ? needs.cards.map((card) => <NeedCard key={card.key} tone={card.tone} title={card.title} detail={card.detail} rows={card.rows} action={card.action} />)
        : <p className="owner-calm" role="status"><CircleCheck aria-hidden="true" />{needs.calm}</p>}
      {needs.quiet.length ? <ul className="owner-quiet">{needs.quiet.map((line) => <li key={line}>{line}</li>)}</ul> : null}
    </section>

    <section aria-label="Sending today" className="space-y-3">
      <SectionLabel icon={Send}>Sending today</SectionLabel>
      <Link href={"/inboxes" as Route} className="owner-feature">
        <p className="owner-feature-value owner-gold-text"><CountUp value={data.sentToday} /></p>
        <p className="owner-feature-text">{data.sentToday === 1 ? "email sent today" : "emails sent today"}, every campaign together.</p>
        {data.inboxes.length ? <div className="owner-feature-rows">
          {data.inboxes.map((inbox) => <div key={inbox.address} className="owner-feature-row">
            <p><b>{inbox.firstName}</b> <span className="owner-num">{inbox.sentToday} of {inbox.dayMax}</span> · {inbox.nextText}</p>
            <Meter value={inbox.sentToday} max={inbox.dayMax} mark={inbox.capNow} tone={inbox.resting ? "warning" : undefined}
              label={`${inbox.firstName}'s inbox: ${inbox.sentToday} of ${inbox.dayMax} sent today`} />
          </div>)}
        </div> : <p className="owner-feature-text">No sending inbox is set up.</p>}
      </Link>
    </section>

    <Panel title="Campaigns" icon={Layers} count={data.campaigns.length}>
      {data.campaigns.length ? <ul className="owner-rows">
        {data.campaigns.map(({ campaign, counts, autoPaused }) => {
          const waiting = counts.ready + counts.waiting + counts.followUpsDue;
          return <li key={campaign.key}>
            <RowLink href={`/campaigns/${campaign.key}` as Route}
              title={<>{campaign.name}{campaign.state === "live"
                ? <Badge tone="success" icon={CheckCircle2}>Live</Badge>
                : <Badge tone={autoPaused ? "danger" : "warning"} icon={PauseCircle}>{autoPaused ? "Paused itself" : "Paused"}</Badge>}</>}
              meta={<><span className="owner-num">{counts.sentToday}</span> sent today · <span className="owner-num">{waiting}</span> waiting{counts.waiting ? ` (${counts.waiting} not approved yet)` : ""} · {plural(weekOf(campaign.key)?.replies ?? 0, "reply", "replies")} this week</>} />
          </li>;
        })}
      </ul> : <p className="owner-empty">No campaigns yet.</p>}
    </Panel>

    {week ? <section aria-label="This week" className="space-y-3">
      <SectionLabel icon={CalendarRange}>This week, {dayText(week.from)} to today</SectionLabel>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Emails sent" value={week.totals.sent} detail={`${week.totals.first} first, ${week.totals.followUps} follow-up${week.totals.followUps === 1 ? "" : "s"}`} />
        <StatCard href={"/replies" as Route} label="Real replies" value={week.totals.replies} detail={`${plural(week.totals.automatic, "automatic reply", "automatic replies")} left out`} />
        <StatCard href={"/replies?filter=no-thanks" as Route} label="No thanks" value={week.totals.noThanks} detail="Never emailed again" />
        <StatCard label="Bounces" value={week.totals.bounced} detail="3 in a day rests an inbox" />
      </div>
      {week.campaigns.filter((row) => row.sent.first + row.sent.followUps > 0 || row.success > 0).length ? <Panel title="What each campaign is judged by">
        <ul className="owner-rows">
          {week.campaigns.filter((row) => row.sent.first + row.sent.followUps > 0 || row.success > 0).map((row) => {
            const rate = per100(row.success, row.sent.first);
            return <li key={row.key}>
              <RowLink href={`/campaigns/${row.key}` as Route} title={row.name}
                meta={<>{row.successLabel}: <b className="owner-ink owner-num">{row.success}</b>{rate ? ` (${rate} per 100 emailed)` : ""} · {plural(row.replies, "reply", "replies")} · {row.noThanks} no thanks · {plural(row.bounced, "bounce")}</>} />
            </li>;
          })}
        </ul>
      </Panel> : null}
    </section> : null}
  </OwnerPage>;
}
