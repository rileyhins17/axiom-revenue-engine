/**
 * The Monday 8 am FCC numbers email (Riley, Nov 1, idea 33). Once a week, on
 * Monday from 8:00 Toronto, both founders get last week's FCC numbers: emails
 * sent (first emails and follow-ups, by inbox), who wrote back, the reply rate,
 * bounces, and what is left on the list. Read-only: it changes no contact, send
 * or switch. It rides the Worker's 15-minute check, like the daily reply check.
 *
 * - "Last week" is the Monday to Sunday before this one, in Toronto days.
 * - At most one attempt an hour until the week's email goes.
 * - The email goes before the week is marked done, so a failed send is retried
 *   next hour and nobody gets two.
 */
import { FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { claimFccWeeklyNumbersTry, readFccWeeklyNumbers, saveFccWeeklyNumbers } from "@/lib/fcc-campaign-control";
import type { FccOwnerMail } from "@/lib/fcc-campaign-replies";
import { torontoDay, torontoWeekday } from "@/lib/fcc-campaign-sender";
import { fccScreen, fccStats, type FccInboxRef } from "@/lib/fcc-campaign-status";
import { torontoMinute } from "@/lib/fcc-campaign-tick";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

/** Minutes after midnight, Toronto time, from which Monday's email can go. */
export const FCC_WEEKLY_NUMBERS_FROM_MINUTE = 8 * 60;
const DAY_MS = 86_400_000;

export type FccWeeklyNumbersConfig = {
  screenUrl: string;
  /** The sending inboxes: "" is the first inbox (Aidan's), an added one is its address. */
  inboxes: FccInboxRef[];
  /** Emails both founders. Throws when it could not. */
  tellFounders: (mail: FccOwnerMail) => Promise<void>;
};

export type FccWeeklyNumbersResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "SENT"; weekOf: string; sent: number; replies: number };

export type FccWeekNumbers = {
  /** Toronto days, Monday and Sunday. */
  from: string; to: string;
  sent: { first: number; followUps: number; byInbox: Array<{ name: string; sent: number }> };
  /** People who wrote back in the week, by hand or automatically, and how many said no. */
  replies: { real: number; automatic: number; saidNo: number; people: Array<{ company: string; email: string; note: string | null }> };
  bounced: number;
};

const skip = (reason: string): FccWeeklyNumbersResult => ({ status: "SKIPPED", reason });
const longDay = (day: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "long", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
const percent = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 1000) / 10}%`);
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Midnight at the start of a Toronto day, as an ISO instant (right through the clock change). */
export function torontoMidnightIso(day: string) {
  let guess = Date.parse(`${day}T05:00:00Z`);
  for (let tries = 0; tries < 3; tries += 1) {
    const [hour, minute] = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Toronto" })
      .format(new Date(guess)).split(":").map(Number);
    const off = (torontoDay(new Date(guess)) < day ? -1 : 0) * 1440 + hour! * 60 + minute!;
    if (off === 0) break;
    guess -= off * 60_000;
  }
  return new Date(guess).toISOString();
}

/** The day after a Toronto day. */
const dayAfter = (day: string) => torontoDay(new Date(Date.parse(`${day}T12:00:00Z`) + DAY_MS));

/** Last week's numbers, Monday `from` to Sunday `to` (Toronto days), straight from the FCC tables. */
export async function fccWeekNumbers(db: ProspectDb, inboxes: FccInboxRef[], from: string, to: string): Promise<FccWeekNumbers> {
  const name = (key: string) => inboxes.find((inbox) => inbox.key === key)?.name ?? (key || "First inbox");
  const start = torontoMidnightIso(from);
  const end = torontoMidnightIso(dayAfter(to));
  const reason = `lower(COALESCE("stoppedReason",''))`;
  const saidNo = ["%stop%", "%no thank%", "%not interested%", "%remove%", "%unsubscribe%"].map((words) => `${reason} LIKE '${words}'`).join(" OR ");
  const [sends, people, bounces] = await Promise.all([
    db.prepare(`SELECT COALESCE("senderAddress",'') AS inbox, "step", COUNT(*) AS n FROM "FccCampaignSend"
      WHERE "status" IN ('CLAIMED','SENT') AND "sendDay" BETWEEN ? AND ? GROUP BY 1, 2`).bind(from, to).all<{ inbox: string; step: number; n: number }>(),
    // One row per address: someone on both lists has two rows marked replied together.
    db.prepare(`SELECT "company", "email", MAX("stoppedReason") AS note, MAX(${reason} LIKE '%automatic reply%') AS automatic, MAX(${saidNo}) AS saidNo
      FROM "FccCampaignContact" WHERE "campaignKey" IN (?, ?) AND "status" = 'replied' AND "updatedAt" >= ? AND "updatedAt" < ?
      GROUP BY "email" ORDER BY MAX("updatedAt") DESC`).bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY, start, end)
      .all<{ company: string; email: string; note: string | null; automatic: number; saidNo: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT "email") AS n FROM "FccCampaignContact" WHERE "campaignKey" IN (?, ?) AND "status" = 'bounced' AND "updatedAt" >= ? AND "updatedAt" < ?`)
      .bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY, start, end).first<{ n: number }>(),
  ]);
  const byInbox = new Map<string, number>();
  let first = 0;
  let followUps = 0;
  for (const row of sends.results) {
    const count = Number(row.n);
    if (Number(row.step) === 1) first += count; else followUps += count;
    byInbox.set(name(row.inbox), (byInbox.get(name(row.inbox)) ?? 0) + count);
  }
  const replied = people.results;
  return {
    from, to,
    sent: { first, followUps, byInbox: [...byInbox].map(([inboxName, sent]) => ({ name: inboxName, sent })) },
    replies: {
      real: replied.filter((row) => !Number(row.automatic)).length,
      automatic: replied.filter((row) => Number(row.automatic)).length,
      saidNo: replied.filter((row) => !Number(row.automatic) && Number(row.saidNo)).length,
      people: replied.filter((row) => !Number(row.automatic)).map((row) => ({ company: row.company, email: row.email, note: row.note })),
    },
    bounced: Number(bounces?.n ?? 0),
  };
}

/** The Monday to Sunday before `now`'s Toronto week. */
export function lastWeek(now: Date) {
  const today = torontoDay(now);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const back = days.indexOf(torontoWeekday(now)) + 7;
  const from = torontoDay(new Date(Date.parse(`${today}T12:00:00Z`) - back * DAY_MS));
  const to = torontoDay(new Date(Date.parse(`${from}T12:00:00Z`) + 6 * DAY_MS));
  return { from, to };
}

export async function runFccWeeklyNumbers(db: ProspectDb, config: FccWeeklyNumbersConfig, now = new Date()): Promise<FccWeeklyNumbersResult> {
  if (torontoWeekday(now) !== "Mon") return skip("not Monday");
  const minute = torontoMinute(now);
  if (minute < FCC_WEEKLY_NUMBERS_FROM_MINUTE) return skip("before 8:00");
  const weekOf = torontoDay(now);
  const last = await readFccWeeklyNumbers(db);
  if (last?.weekOf === weekOf) return skip("already sent this week");
  if (!(await claimFccWeeklyNumbersTry(db, `${weekOf} ${Math.floor(minute / 60)}`, now))) return skip("already tried this hour");

  const { from, to } = lastWeek(now);
  const [week, stats, screen] = await Promise.all([fccWeekNumbers(db, config.inboxes, from, to), fccStats(db, config.inboxes, now), fccScreen(db, now)]);
  await config.tellFounders(weeklyMail(week, stats, screen, config.screenUrl));
  await saveFccWeeklyNumbers(db, { weekOf, at: now.toISOString(), from, to }, now);
  return { status: "SENT", weekOf, sent: week.sent.first + week.sent.followUps, replies: week.replies.real };
}

type Stats = Awaited<ReturnType<typeof fccStats>>;
type Screen = Awaited<ReturnType<typeof fccScreen>>;

/** Both founders' Monday email, in plain words. */
export function weeklyMail(week: FccWeekNumbers, stats: Stats, screen: Screen, screenUrl: string): FccOwnerMail {
  const total = week.sent.first + week.sent.followUps;
  const inboxes = week.sent.byInbox.map((inbox) => `${inbox.name} ${inbox.sent}`).join(", ");
  const sentLine = total === 0
    ? "No FCC emails went out last week."
    : `${plural(total, "FCC email")} went out last week: ${plural(week.sent.first, "first email")} and ${plural(week.sent.followUps, "follow-up")}${inboxes ? ` (${inboxes})` : ""}.`;
  const automatic = week.replies.automatic ? plural(week.replies.automatic, "automatic reply", "automatic replies") : "";
  const repliesLine = week.replies.real === 0
    ? `Nobody wrote back last week${automatic ? ` (${automatic}, out of office)` : ""}.`
    : `${plural(week.replies.real, "person wrote", "people wrote")} back last week${week.replies.saidNo ? `, ${week.replies.saidNo} of them saying no` : ""}${automatic ? `, plus ${automatic}` : ""}.`;
  const bouncesLine = week.bounced === 0 ? "Nothing bounced last week." : `${plural(week.bounced, "email")} bounced last week.`;
  const allTime = `All time: ${plural(stats.emailed, "company", "companies")} emailed, ${plural(stats.replies.real, "real reply", "real replies")} (reply rate ${percent(stats.replyRate)}), ${plural(stats.bounced, "bounce")} (${percent(stats.bounceRate)}).`;
  const stateLine = screen.state === "live" ? "Sending is live." : screen.state === "paused" ? "Sending is PAUSED." : "Sending is locked: the current email has no founder's go.";
  const pace = stats.weekdaysLeft !== null ? `; at ${stats.newPerDay} new companies a weekday the list lasts about ${plural(stats.weekdaysLeft, "more weekday")}` : "";
  const left = `Left on the list: ${plural(screen.ready, "company", "companies")} ready for a first email, ${plural(screen.followUpsDue, "follow-up")} due now and ${screen.followUpsLater} coming${pace}.`;
  const versions = stats.byVersion.filter((row) => row.emailed > 0).map((row) => `${row.label}: ${row.emailed} emailed, ${plural(row.replies, "reply", "replies")} (${percent(row.rate)})`);
  const people = week.replies.people.map((person, index) => `${index + 1}. ${person.company} (${person.email})${person.note ? `: ${person.note}` : ""}`);

  const subject = `FCC: last week's numbers (${longDay(week.from)} to ${longDay(week.to)})`;
  const text = [
    `FCC numbers for ${longDay(week.from)} to ${longDay(week.to)}.`, "",
    sentLine, repliesLine, bouncesLine, "",
    ...(people.length ? ["Who wrote back:", ...people, ""] : []),
    allTime, stateLine, left, "",
    ...(versions.length ? ["By email version, all time:", ...versions.map((line) => `- ${line}`), ""] : []),
    `Everything is on the FCC screen: ${screenUrl}`,
  ].join("\n");
  const html = [
    `<p>FCC numbers for <strong>${escapeHtml(longDay(week.from))} to ${escapeHtml(longDay(week.to))}</strong>.</p>`,
    `<p>${escapeHtml(sentLine)}<br>${escapeHtml(repliesLine)}<br>${escapeHtml(bouncesLine)}</p>`,
    ...(people.length ? [`<p><strong>Who wrote back:</strong><br>${people.map(escapeHtml).join("<br>")}</p>`] : []),
    `<p>${escapeHtml(allTime)}<br>${escapeHtml(stateLine)}<br>${escapeHtml(left)}</p>`,
    ...(versions.length ? [`<p><strong>By email version, all time:</strong><br>${versions.map(escapeHtml).join("<br>")}</p>`] : []),
    `<p><a href="${escapeHtml(screenUrl)}">Everything is on the FCC screen</a></p>`,
  ].join("\n");
  return { subject, text, html };
}
