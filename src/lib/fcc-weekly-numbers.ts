/**
 * The Monday 8 am numbers email (Riley, Nov 1, idea 33; all campaigns since Nov 13). Once a week, on
 * Monday from 8:00 Toronto, both founders get last week's numbers for every campaign: emails sent
 * (first emails and follow-ups, by inbox), who wrote back, no thanks, bounces, each campaign's
 * success number and what is left. FCC ended on Nov 12, 2026 and is not in it. Read-only: it changes
 * no contact, send or switch. It rides the Worker's 15-minute check, like the reply checks.
 *
 * - "Last week" is the Monday to Sunday before this one, in Toronto days.
 * - At most one attempt an hour until the week's email goes.
 * - The email goes before the week is marked done, so a failed send is retried next hour and nobody
 *   gets two. The "already sent" note keeps its old name in KvStore, so it carries over a release.
 *
 * The numbers themselves come from `weekNumbers` (outreach-week.ts), which the Today screen also reads.
 */
import { claimFccWeeklyNumbersTry, readFccWeeklyNumbers, saveFccWeeklyNumbers } from "@/lib/fcc-campaign-control";
import type { FccOwnerMail } from "@/lib/fcc-campaign-replies";
import { torontoDay, torontoWeekday } from "@/lib/fcc-campaign-sender";
import { torontoMinute } from "@/lib/fcc-campaign-tick";
import { lastWeek, weekNumbers, type CampaignWeek, type WeekNumbers, type WeekReply } from "@/lib/outreach/outreach-week";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export { lastWeek, torontoMidnightIso } from "@/lib/outreach/outreach-week";

/** Minutes after midnight, Toronto time, from which Monday's email can go. */
export const FCC_WEEKLY_NUMBERS_FROM_MINUTE = 8 * 60;
/** How much of what someone wrote the email quotes. */
const QUOTE_LENGTH = 200;

export type FccWeeklyNumbersConfig = {
  /** The Today screen. */
  screenUrl: string;
  /** Emails both founders. Throws when it could not. */
  tellFounders: (mail: FccOwnerMail) => Promise<void>;
};

export type FccWeeklyNumbersResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "SENT"; weekOf: string; sent: number; replies: number };

const skip = (reason: string): FccWeeklyNumbersResult => ({ status: "SKIPPED", reason });
const longDay = (day: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "long", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const shortTime = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
/** "Riley's inbox", or the address itself when the inbox has no name. */
const inboxOf = (name: string) => (name.includes("@") ? name : `${firstName(name)}'s inbox`);

export async function runFccWeeklyNumbers(db: ProspectDb, config: FccWeeklyNumbersConfig, now = new Date()): Promise<FccWeeklyNumbersResult> {
  if (torontoWeekday(now) !== "Mon") return skip("not Monday");
  const minute = torontoMinute(now);
  if (minute < FCC_WEEKLY_NUMBERS_FROM_MINUTE) return skip("before 8:00");
  const weekOf = torontoDay(now);
  const last = await readFccWeeklyNumbers(db);
  if (last?.weekOf === weekOf) return skip("already sent this week");
  if (!(await claimFccWeeklyNumbersTry(db, `${weekOf} ${Math.floor(minute / 60)}`, now))) return skip("already tried this hour");

  const { from, to } = lastWeek(now);
  const week = await weekNumbers(db, from, to, now);
  await config.tellFounders(weeklyMail(week, config.screenUrl));
  await saveFccWeeklyNumbers(db, { weekOf, at: now.toISOString(), from, to }, now);
  return { status: "SENT", weekOf, sent: week.totals.sent, replies: week.totals.replies };
}

const realReplies = (count: number) => plural(count, "real reply", "real replies");
const sentWords = (first: number, followUps: number) => `${plural(first, "first email")} and ${plural(followUps, "follow-up")}`;

/** One campaign's few lines: its name and state, last week, its success number, all time, and what is left. */
function campaignLines(week: CampaignWeek) {
  const state = week.state === "live" ? "Live" : `Paused${week.stateReason ? `: ${week.stateReason.trim().replace(/\.$/, "")}` : ""}`;
  // Per 100 first emails of the same week, so a small week and a big one can be compared.
  const rate = week.sent.first > 0 ? ` (${Math.round((week.success / week.sent.first) * 1000) / 10} per 100 emailed)` : "";
  return [
    `${week.name} (${state})`,
    `Sent last week: ${sentWords(week.sent.first, week.sent.followUps)}. ${realReplies(week.replies)}, ${week.noThanks} no thanks, ${plural(week.bounced, "bounce")}.`,
    `${week.successLabel}: ${week.success}${rate}`,
    `All time: ${week.allTime.emailed} emailed, ${realReplies(week.allTime.replies)}. ${week.successLabel}: ${week.allTime.success}.`,
    `Left: ${week.left.ready} ready, ${week.left.waitingApproval} waiting for approval, ${plural(week.left.followUpsDue, "follow-up")} due.`,
  ];
}

/** One person who wrote back: who, what they said, and which inbox answers. */
function personLines(reply: WeekReply, index: number) {
  const quote = (reply.quote ?? "").replace(/\s+/g, " ").trim();
  const from = inboxOf(reply.answerFromName ?? reply.inboxName);
  const elsewhere = reply.answerFrom && reply.answerFrom !== reply.inbox ? ` It came to ${inboxOf(reply.inboxName)}.` : "";
  const answered = reply.answeredAt ? ` Answered${reply.answeredBy ? ` by ${reply.answeredBy}` : ""}.` : "";
  return [
    `${index + 1}. ${reply.label} (${reply.from})${reply.kind === "no_thanks" ? ", said no thanks" : ""}. ${reply.campaign}${reply.at ? `, ${shortTime(reply.at)}` : ""}.`,
    quote ? `"${quote.length > QUOTE_LENGTH ? `${quote.slice(0, QUOTE_LENGTH).trimEnd()}...` : quote}"` : "(Open the email to read it.)",
    `${reply.kind === "no_thanks" ? `If you answer, answer from ${from}.` : `Answer from ${from}.`}${elsewhere}${answered}`,
  ];
}

/** Both founders' Monday email, in plain words. */
export function weeklyMail(week: WeekNumbers, screenUrl: string): FccOwnerMail {
  const totals = week.totals;
  const days = `${longDay(week.from)} to ${longDay(week.to)}`;
  const inboxes = week.byInbox.map((inbox) => `${firstName(inbox.name)} ${inbox.sent}`).join(", ");
  const sent = totals.sent === 0 ? "no emails sent" : `${plural(totals.sent, "email")} sent (${sentWords(totals.first, totals.followUps)}${inboxes ? `; ${inboxes}` : ""})`;
  const totalsLine = `All campaigns: ${sent}, ${realReplies(totals.replies)}, ${totals.noThanks} no thanks, ${plural(totals.automatic, "automatic reply", "automatic replies")}, ${plural(totals.bounced, "bounce")}.`;
  const silent = totals.sent + totals.replies + totals.noThanks + totals.automatic + totals.bounced === 0;
  const silentLine = "It was a silent week: nothing went out and nobody wrote back.";
  // A campaign is shown when anything happened in it last week or anything is left in it.
  const shown = week.campaigns.filter((campaign) => campaign.sent.first + campaign.sent.followUps + campaign.replies + campaign.noThanks + campaign.automatic + campaign.bounced + campaign.success
    + campaign.left.ready + campaign.left.waitingApproval + campaign.left.followUpsDue > 0).map(campaignLines);
  const people = week.people.map(personLines);
  // Someone counted but not listed: more than 50 wrote back, or the reply was seen just before a follow-up and its words aren't stored yet.
  const unlisted = totals.replies + totals.noThanks - new Set(week.people.map((reply) => `${reply.contactId} ${reply.kind}`)).size;
  const unlistedLine = unlisted > 0 ? `${unlisted} more wrote back and ${unlisted === 1 ? "is" : "are"} not listed here. Look on the Replies screen.` : "";

  const subject = `Last week's numbers (${days})`;
  const text = [
    `Last week's numbers for every campaign, ${days}.`, "",
    totalsLine, ...(silent ? [silentLine] : []), "",
    ...shown.flatMap((lines) => [...lines, ""]),
    ...(people.length ? ["Who wrote back:", ...people.flatMap(([title, ...rest]) => [title!, ...rest.map((line) => `   ${line}`)]), ...(unlistedLine ? [unlistedLine] : []), ""]
      : unlistedLine ? [unlistedLine, ""] : []),
    `Everything is on the Today screen: ${screenUrl}`,
  ].join("\n");
  const html = [
    `<p>Last week's numbers for every campaign, <strong>${escapeHtml(days)}</strong>.</p>`,
    `<p>${escapeHtml(totalsLine)}${silent ? `<br>${escapeHtml(silentLine)}` : ""}</p>`,
    ...shown.map(([title, ...rest]) => `<p><strong>${escapeHtml(title!)}</strong><br>${rest.map(escapeHtml).join("<br>")}</p>`),
    ...(people.length ? [`<p><strong>Who wrote back:</strong></p>`, ...people.map(([title, ...rest]) => `<p><strong>${escapeHtml(title!)}</strong><br>${rest.map(escapeHtml).join("<br>")}</p>`)] : []),
    ...(unlistedLine ? [`<p>${escapeHtml(unlistedLine)}</p>`] : []),
    `<p><a href="${escapeHtml(screenUrl)}">Everything is on the Today screen</a></p>`,
  ].join("\n");
  return { subject, text, html };
}
