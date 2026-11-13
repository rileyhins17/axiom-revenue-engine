/**
 * The Today screen as data: what needs a founder, then whether everything is OK. Read-only.
 *
 * `needsYou` is the rule for the cards at the top, most urgent first, each with one thing to press:
 *   1. a campaign that paused itself, or one whose settings can't be read (nothing in it sends);
 *   2. the hourly reply check stopped or couldn't open an inbox (a reply could sit unseen);
 *   3. real replies nobody has answered yet (answered from the inbox that sent the email, by its owner);
 *   4. batches waiting for this founder's Approve (only a campaign's named approver gets the card;
 *      the other founder sees one quiet line, "waits for Aidan");
 *   5. an inbox resting for the day after 3 bounces;
 *   6. emails Gmail refused, which wait for a person.
 * With no card it says one calm line and when the next email goes.
 */
import { torontoDay } from "@/lib/fcc-campaign-sender";
import { torontoMinute } from "@/lib/fcc-campaign-tick";
import { clockText, inboxHealth, momentText, readReplyCheck, type InboxHealth } from "@/lib/outreach/outreach-inbox-health";
import { readCampaigns, type Campaign } from "@/lib/outreach/outreach-model";
import { OUTREACH_REPLY_HOURS } from "@/lib/outreach/outreach-replies";
import { repliesToAnswer, type RepliesToAnswer } from "@/lib/outreach/outreach-reply-list";
import { OUTREACH_AUTO_PAUSE_BY } from "@/lib/outreach/outreach-sender";
import { campaignCounts, type CampaignCounts } from "@/lib/outreach/outreach-status";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export type WaitingBatch = {
  id: string; campaignKey: string; campaign: string; name: string;
  /** Emails that go once it is approved. */
  ready: number; held: number; loadedAt: string; loadedBy: string;
  approvers: string[];
  /** "waiting": never approved. "words-changed": approved before its campaign's words changed, so it needs another look. */
  why: "waiting" | "words-changed";
};

export type TodayCampaign = { campaign: Campaign; counts: CampaignCounts; waitingBatches: number; autoPaused: boolean };

export type TodayData = {
  /** The Toronto day and minute this was read. */
  day: string; minute: number;
  campaigns: TodayCampaign[];
  waitingBatches: WaitingBatch[];
  toAnswer: RepliesToAnswer;
  inboxes: InboxHealth[];
  /** Every campaign's emails out today. */
  sentToday: number;
  replyCheck: { at: string | null; unread: string[]; stale: boolean };
};

export type NeedsYouCard = {
  key: string;
  tone: "danger" | "warning" | "gold";
  title: string;
  detail?: string;
  /** Up to four rows under the title; a row with `href` opens that screen. */
  rows?: Array<{ text: string; meta?: string; href?: string }>;
  action: { label: string; href: string };
};
export type NeedsYou = {
  cards: NeedsYouCard[];
  /** Things to know that need nothing from this founder. */
  quiet: string[];
  /** The one line when there is no card. */
  calm: string;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const list = (items: string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
const whenText = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/** Everything Today shows except the week's numbers (outreach-week.ts), in about a dozen reads. */
export async function todayData(db: ProspectDb, fccFirstInbox: string | null | undefined, now = new Date()): Promise<TodayData> {
  const day = torontoDay(now);
  const minute = torontoMinute(now);
  const campaigns = await readCampaigns(db);
  const [counts, batches, toAnswer, replyCheck] = await Promise.all([
    Promise.all(campaigns.map((campaign) => campaignCounts(db, campaign.key, now))),
    db.prepare(`SELECT b."id", b."campaignKey", b."name", b."loadedAt", b."loadedBy", b."status", b."approvedWords", b."wordsVersion",
        SUM(c."status" = 'ready') AS ready, SUM(c."status" = 'held') AS held
      FROM "OutreachBatch" b LEFT JOIN "OutreachContact" c ON c."batchId" = b."id" WHERE b."status" IN ('waiting','approved') GROUP BY b."id" ORDER BY b."sendOrder"`).bind()
      .all<{ id: string; campaignKey: string; name: string; loadedAt: string; loadedBy: string; status: string; approvedWords: string | null; wordsVersion: string | null; ready: number | null; held: number | null }>(),
    // A few more than the card shows, so each founder's card can lead with the replies that are theirs to answer.
    repliesToAnswer(db, 8),
    readReplyCheck(db),
  ]);
  const byKey = new Map(campaigns.map((campaign) => [campaign.key, campaign]));
  const waitingBatches = batches.results.flatMap((row): WaitingBatch[] => {
    const campaign = byKey.get(row.campaignKey);
    if (!campaign) return [];
    const wordsCurrent = row.approvedWords !== null && row.approvedWords === (row.wordsVersion ?? campaign.wordsVersion);
    const why = row.status === "waiting" ? "waiting" : !wordsCurrent ? "words-changed" : null;
    // A batch with nobody left to email needs no approval.
    if (!why || Number(row.ready ?? 0) === 0) return [];
    return [{ id: row.id, campaignKey: row.campaignKey, campaign: campaign.name, name: row.name, ready: Number(row.ready ?? 0), held: Number(row.held ?? 0),
      loadedAt: row.loadedAt, loadedBy: row.loadedBy, approvers: campaign.approvers, why }];
  });
  const rows: TodayCampaign[] = campaigns.map((campaign, index) => ({
    campaign, counts: counts[index]!, waitingBatches: waitingBatches.filter((batch) => batch.campaignKey === campaign.key).length,
    autoPaused: campaign.state === "paused" && campaign.stateBy === OUTREACH_AUTO_PAUSE_BY,
  }));
  const inboxes = await inboxHealth(db, rows.map((row) => ({ campaign: row.campaign, due: row.counts.ready + row.counts.followUpsDue > 0, sentToday: row.counts.sentToday })), fccFirstInbox, now, replyCheck);
  // The health check's own rule: once anyone has been emailed, a check that hasn't finished for 2 hours inside its hours.
  const emailedAny = rows.some((row) => row.counts.emailed > 0);
  const inHours = minute >= OUTREACH_REPLY_HOURS.from + 120 && minute < OUTREACH_REPLY_HOURS.to + 30;
  const stale = emailedAny && inHours && (!replyCheck?.at || Date.parse(replyCheck.at) < now.getTime() - 2 * 3_600_000);
  return {
    day, minute, campaigns: rows, waitingBatches, toAnswer, inboxes,
    sentToday: rows.reduce((sum, row) => sum + row.counts.sentToday, 0),
    replyCheck: { at: replyCheck?.at ?? null, unread: emailedAny ? replyCheck?.unread ?? [] : [], stale },
  };
}

/** When the next email goes, from the inboxes' own next moments. */
export function nextEmailText(data: Pick<TodayData, "inboxes" | "day">) {
  if (data.inboxes.some((inbox) => inbox.next.kind === "now")) return "Emails are going out now.";
  const moments = data.inboxes.flatMap((inbox) => (inbox.next.kind === "at" ? [inbox.next] : []))
    .sort((a, b) => (a.day === b.day ? a.minute - b.minute : a.day.localeCompare(b.day)));
  return moments[0] ? `Next email goes at ${momentText(moments[0].day, moments[0].minute, data.day)}.` : "No email is waiting to go.";
}

/** The cards for one founder (`viewer` is "Riley" or "Aidan"; null for anyone else, who gets no approval or answer cards). */
export function needsYou(data: TodayData, viewer: string | null): NeedsYou {
  const cards: NeedsYouCard[] = [];
  const quiet: string[] = [];
  const inboxName = (address: string) => data.inboxes.find((inbox) => inbox.address === address)?.firstName ?? address;

  // 1. Nothing in the campaign sends until someone acts.
  for (const { campaign, autoPaused } of data.campaigns) {
    if (campaign.problem) {
      cards.push({ key: `problem:${campaign.key}`, tone: "danger", title: `${campaign.name} can't send`, detail: `Its settings can't be used: ${campaign.problem}. Ask Claude to fix the setting.`,
        action: { label: "Open the campaign", href: `/campaigns/${campaign.key}` } });
    } else if (autoPaused) {
      cards.push({ key: `paused:${campaign.key}`, tone: "danger", title: `${campaign.name} paused itself`,
        detail: `${campaign.stateReason ?? "No reason was saved"}${campaign.stateAt ? ` (${whenText(campaign.stateAt)})` : ""}. Nothing in it sends until a founder presses Resume.`,
        action: { label: "Open the campaign", href: `/campaigns/${campaign.key}` } });
    } else if (campaign.state === "paused" && campaign.wordsVersion) {
      quiet.push(`${campaign.name} is paused${campaign.stateBy ? ` (${campaign.stateBy}${campaign.stateAt ? `, ${whenText(campaign.stateAt)}` : ""})` : ""}.`);
    }
  }

  // 2. Replies could be sitting unseen.
  if (data.replyCheck.unread.length) {
    const names = data.replyCheck.unread.map((address) => `${inboxName(address)}'s inbox`);
    cards.push({ key: "reply-check-inbox", tone: "danger", title: `The reply check couldn't open ${names.join(" and ")}`,
      detail: "Replies there may be waiting unseen. Look in that inbox yourself today, then ask Claude to check its app password.", action: { label: "See the inboxes", href: "/inboxes" } });
  } else if (data.replyCheck.stale) {
    cards.push({ key: "reply-check-stale", tone: "danger", title: "The hourly reply check has stopped",
      detail: `It last finished ${data.replyCheck.at ? whenText(data.replyCheck.at) : "never"}, so a reply could be waiting unseen. Look in both inboxes yourself today.`,
      action: { label: "See the inboxes", href: "/inboxes" } });
  }

  // 3. Real replies nobody has answered. The owner of the inbox that sent the email answers.
  if (data.toAnswer.count > 0) {
    const mine = data.toAnswer.byInbox.filter((group) => !group.name || same(group.name, viewer)).reduce((sum, group) => sum + group.count, 0);
    const others = data.toAnswer.byInbox.filter((group) => group.name && !same(group.name, viewer));
    if (viewer && mine > 0) {
      cards.push({
        key: "replies", tone: "gold", title: `${plural(mine, "reply", "replies")} for you to answer`,
        detail: others.length ? `${others.map((group) => `${group.count} more ${group.count === 1 ? "waits" : "wait"} for ${group.name}`).join(", ")}.` : undefined,
        rows: data.toAnswer.newest.filter((reply) => !reply.answerFromName || same(reply.answerFromName, viewer)).slice(0, 2).map((reply) => ({
          text: `${reply.organisation}: ${firstWords(reply.text ?? "Open it to read what they wrote.", 110)}`,
          meta: `${reply.campaign} · ${reply.at ? whenText(reply.at) : "time unknown"} · answer from ${reply.answerFromName ? "your inbox" : "the inbox it came to"}`,
        })),
        action: { label: "Open replies", href: "/replies" },
      });
    } else {
      quiet.push(`${others.map((group) => `${plural(group.count, "reply", "replies")} ${group.count === 1 ? "waits" : "wait"} for ${group.name} to answer`).join(", ")}.`);
    }
  }

  // 4. Batches waiting for this founder's Approve.
  const mineToApprove = data.waitingBatches.filter((batch) => viewer !== null && batch.approvers.includes(viewer));
  const forOthers = data.waitingBatches.filter((batch) => !mineToApprove.includes(batch));
  if (mineToApprove.length === 1) {
    const batch = mineToApprove[0]!;
    cards.push({ key: `approve:${batch.id}`, tone: "gold", title: `${batch.name}: ${plural(batch.ready, "email")} ${batch.ready === 1 ? "waits" : "wait"} for your Approve`,
      detail: batch.why === "words-changed" ? `${batch.campaign}. Its campaign's words changed after it was approved, so it needs another look.` : `${batch.campaign}. Read its samples first; nothing in it sends before you approve.`,
      action: { label: "Read the samples", href: `/campaigns/${batch.campaignKey}/batches/${batch.id}` } });
  } else if (mineToApprove.length > 1) {
    const emails = mineToApprove.reduce((sum, batch) => sum + batch.ready, 0);
    const keys = [...new Set(mineToApprove.map((batch) => batch.campaignKey))];
    cards.push({
      key: "approve", tone: "gold", title: `${mineToApprove.length} batches (${plural(emails, "email")}) wait for your Approve`,
      detail: mineToApprove.length > 4 ? `The first 4 are below; ${mineToApprove.length - 4} more are on the campaign's screen.` : "Each has its own samples to read. Nothing in them sends before you approve.",
      rows: mineToApprove.slice(0, 4).map((batch) => ({ text: batch.name, meta: `${plural(batch.ready, "email")} · ${batch.campaign}${batch.why === "words-changed" ? " · words changed" : ""}`,
        href: `/campaigns/${batch.campaignKey}/batches/${batch.id}` })),
      action: { label: keys.length === 1 ? "See all its batches" : "Open campaigns", href: keys.length === 1 ? `/campaigns/${keys[0]}#batches` : "/campaigns" },
    });
  }
  if (forOthers.length) {
    const emails = forOthers.reduce((sum, batch) => sum + batch.ready, 0);
    const who = list([...new Set(forOthers.flatMap((batch) => batch.approvers))]) || "a named founder";
    quiet.push(`${plural(forOthers.length, "batch", "batches")} (${plural(emails, "email")}) ${forOthers.length === 1 ? "waits" : "wait"} for ${who} to approve.`);
  }

  // 5. An inbox that stopped for the day. Nobody is paused; it starts again tomorrow.
  for (const inbox of data.inboxes.filter((row) => row.resting)) {
    cards.push({ key: `resting:${inbox.address}`, tone: "warning", title: `${inbox.firstName}'s inbox is resting today`,
      detail: `${inbox.bouncesToday} of its emails bounced today, so it sends nothing more until tomorrow. Nothing is paused. If one list is bad, pause that campaign before then.`,
      action: { label: "See the inboxes", href: "/inboxes" } });
  }
  for (const inbox of data.inboxes.filter((row) => row.next.kind === "no-second-half")) {
    quiet.push(`${inbox.firstName}'s inbox sends no afternoon half today (${inbox.bouncesToday} bounces). It starts again tomorrow.`);
  }

  // 6. Emails Gmail refused wait for a person.
  for (const { campaign, counts } of data.campaigns.filter((row) => row.counts.failed > 0)) {
    cards.push({ key: `failed:${campaign.key}`, tone: "warning", title: `${plural(counts.failed, "email")} in ${campaign.name} failed to send`,
      detail: "Gmail refused them. They wait for a person: see who on the campaign's screen, then ask Claude to retry or stop them.",
      action: { label: "Open the campaign", href: `/campaigns/${campaign.key}#problems` } });
  }

  // A live campaign with nobody left is worth one line: sending stops by itself when the list runs out.
  for (const { campaign, counts, waitingBatches } of data.campaigns) {
    if (campaign.state === "live" && !campaign.problem && counts.ready + counts.followUpsDue === 0 && waitingBatches === 0) quiet.push(`${campaign.name} has nobody waiting for an email. Load a list to keep it going.`);
  }

  return { cards, quiet: quiet.filter((line) => line.length > 1), calm: `Nothing needs you. ${nextEmailText(data)}` };
}

export { clockText };

/** The start of a message for a card: whole words, with "..." when it was cut. */
function firstWords(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:!?]+$/, "")}...`;
}
