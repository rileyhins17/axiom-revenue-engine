/**
 * Each sending inbox today, as the Today and Inboxes screens (and the Claude connector) show it: how many
 * emails left it of its safe amount, bounces, whether it rests for the day, when its next email can go,
 * which campaigns use it, and whether the hourly reply check could open it. Read-only. It mirrors the
 * sender's own rules (outreach-sender.ts, outreach-inboxes.ts) and changes none of them.
 *
 * A fixed handful of queries however many inboxes there are: the free plan allows 50 database reads a request.
 */
import { torontoDay, torontoWeekday } from "@/lib/fcc-campaign-sender";
import { torontoMinute } from "@/lib/fcc-campaign-tick";
import { readKv } from "@/lib/outreach/outreach-control";
import { AFTERNOON_FROM, AFTERNOON_MAX_BOUNCES, PAUSE_BOUNCES, gapAfter, inboxCapNow, inboxDayMax, mailboxOwner } from "@/lib/outreach/outreach-inboxes";
import { readInboxes, type Campaign, type Inbox } from "@/lib/outreach/outreach-model";
import { OUTREACH_REPLY_STATE } from "@/lib/outreach/outreach-replies";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export type InboxCampaignUse = { key: string; name: string; state: "live" | "paused"; perDay: number; sentToday: number };

export type InboxNext =
  | { kind: "off" }
  | { kind: "resting"; bounces: number }
  | { kind: "day-full" }
  | { kind: "no-second-half"; bounces: number }
  | { kind: "nothing-due" }
  | { kind: "paused" }
  | { kind: "now" }
  | { kind: "at"; day: string; minute: number };

export type InboxHealth = {
  address: string;
  /** The name on its emails, and its owner's first name ("Riley"). */
  name: string; firstName: string;
  enabled: boolean;
  /** Emails that left it today, every campaign together, of the most it may send today. */
  sentToday: number; dayMax: number;
  /** The most it may have sent by now: half the day before 12:30, the whole of it after. */
  capNow: number;
  /** Its full daily amount once its ramp is over, and the ramp while it is new (null when it has none). */
  fullMax: number; ramp: { steps: number[]; from: string } | null;
  bouncesToday: number;
  /** 3 bounces today: it sends nothing more until tomorrow. Nobody is paused. */
  resting: boolean;
  next: InboxNext;
  /** "next 1:12 p.m." / "resting today (3 bounces)" / ... */
  nextText: string;
  campaigns: InboxCampaignUse[];
  /** When the hourly reply check last read it, and whether the latest check could open it. Null: never read. */
  replyCheck: { lastReadAt: string | null; couldOpen: boolean };
  /** The inbox its replies are read in, when that is another one (mail that forwards). */
  readsVia: string | null;
  gmail: boolean;
};

const n = (value: unknown) => Number(value ?? 0);
export const firstNameOf = (name: string, fallback: string) => name.trim().split(/\s+/)[0] || fallback;

export function clockText(minute: number) {
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${hour < 12 ? "a.m." : "p.m."}`;
}
const weekdayOf = (day: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short" }).format(new Date(`${day}T12:00:00Z`)).replace(".", "");

/** "1:12 p.m." today, "9:00 a.m. Mon" another day. */
export function momentText(day: string, minute: number, today: string) {
  return day === today ? clockText(minute) : `${clockText(minute)} ${weekdayOf(day)}`;
}

/** The next minute a campaign's send hours are open, from `now` on (today included), or null within a week. */
export function campaignNextWindow(campaign: Pick<Campaign, "sendDays" | "windowStart" | "windowEnd" | "startDay" | "endDay">, now: Date): { day: string; minute: number; open: boolean } | null {
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const at = new Date(now.getTime() + ahead * 86_400_000);
    const day = torontoDay(at);
    if (campaign.startDay && day < campaign.startDay) continue;
    if (campaign.endDay && day > campaign.endDay) return null;
    if (!campaign.sendDays.includes(torontoWeekday(at))) continue;
    if (ahead > 0) return { day, minute: campaign.windowStart, open: false };
    const minute = torontoMinute(now);
    if (minute < campaign.windowStart) return { day, minute: campaign.windowStart, open: false };
    if (minute < campaign.windowEnd) return { day, minute, open: true };
  }
  return null;
}

type Wanting = { campaign: Campaign; perDay: number; sentFromInbox: number; sentAll: number; due: boolean };

/**
 * When the inbox's next email can go, by the sender's rules in the sender's order: the inbox's own day and bounces
 * first, then the gap after its last email, then whether any live campaign has someone due and room left.
 */
export function inboxNext(input: {
  enabled: boolean; dayMax: number; sentToday: number; bouncesToday: number; lastSendAt: string | null; lastSendId: string | null; wanting: Wanting[];
}, now: Date): InboxNext {
  const today = torontoDay(now);
  const minute = torontoMinute(now);
  if (!input.enabled || input.dayMax <= 0) return { kind: "off" };
  if (input.bouncesToday >= PAUSE_BOUNCES) return { kind: "resting", bounces: input.bouncesToday };
  const live = input.wanting.filter((item) => item.campaign.state === "live" && !item.campaign.problem && item.perDay > 0 && item.campaign.dailyLimit > 0);
  if (live.length === 0) return { kind: input.wanting.length ? "paused" : "nothing-due" };
  const withWork = live.filter((item) => item.due);
  if (withWork.length === 0) return { kind: "nothing-due" };

  // Tomorrow's (or a later day's) first open window, for when today is done.
  const later = () => {
    const tomorrow = new Date(now.getTime() + 86_400_000 - minute * 60_000);
    const windows = withWork.map((item) => campaignNextWindow(item.campaign, tomorrow))
      .filter((window): window is NonNullable<typeof window> => window !== null && window.day > today)
      .sort((a, b) => (a.day === b.day ? a.minute - b.minute : a.day.localeCompare(b.day)));
    return windows[0] ? { kind: "at" as const, day: windows[0].day, minute: windows[0].minute } : { kind: "nothing-due" as const };
  };

  const openToday = withWork.map((item) => ({ item, window: campaignNextWindow(item.campaign, now) }))
    .filter((row) => row.window !== null && row.window.day === today && row.item.sentFromInbox < row.item.perDay && row.item.sentAll < row.item.campaign.dailyLimit);
  if (openToday.length === 0) return later();

  if (input.sentToday >= input.dayMax) return input.sentToday > 0 ? { kind: "day-full" } : later();
  const secondHalf = input.sentToday >= Math.ceil(input.dayMax / 2);
  if (secondHalf && input.bouncesToday > AFTERNOON_MAX_BOUNCES) return { kind: "no-second-half", bounces: input.bouncesToday };

  // The earliest minute today: a campaign's window, the afternoon half, and the gap after the last email.
  let earliest = Math.min(...openToday.map((row) => row.window!.minute));
  if (secondHalf) earliest = Math.max(earliest, AFTERNOON_FROM);
  if (input.lastSendAt && input.lastSendId && torontoDay(new Date(input.lastSendAt)) === today) {
    earliest = Math.max(earliest, torontoMinute(new Date(Date.parse(input.lastSendAt) + gapAfter(input.lastSendId))) + 1);
  }
  const lastClose = Math.max(...openToday.map((row) => row.item.campaign.windowEnd));
  if (earliest >= lastClose) return later();
  return earliest <= minute + 1 ? { kind: "now" } : { kind: "at", day: today, minute: earliest };
}

export function inboxNextText(next: InboxNext, today: string) {
  switch (next.kind) {
    case "off": return "switched off";
    case "resting": return `resting today (${next.bounces} bounces)`;
    case "day-full": return "done for today";
    case "no-second-half": return `no afternoon half today (${next.bounces} bounces)`;
    case "nothing-due": return "nobody waiting";
    case "paused": return "its campaigns are paused";
    case "now": return "sending now";
    case "at": return `next ${momentText(next.day, next.minute, today)}`;
  }
}

/**
 * Every sending inbox today. `campaigns` are the campaigns already read by the caller with `due` (someone waits for an
 * email in an approved batch) and today's count; `fccFirstInbox` is FCC_SENDER_ADDRESS, whose FCC rows carry no address.
 */
export type ReplyCheckState = { inboxes?: Record<string, string>; at?: string; unread?: string[] };
/** When the hourly reply check last finished, where each inbox was last read, and which it couldn't open. */
export const readReplyCheck = (db: ProspectDb) => readKv<ReplyCheckState>(db, OUTREACH_REPLY_STATE).catch(() => null);

export async function inboxHealth(db: ProspectDb, campaigns: Array<{ campaign: Campaign; due: boolean; sentToday: number }>, fccFirstInbox: string | null | undefined, now = new Date(),
  replyCheck?: ReplyCheckState | null): Promise<InboxHealth[]> {
  const day = torontoDay(now);
  const minute = torontoMinute(now);
  const first = (fccFirstInbox ?? "").trim().toLowerCase();
  // FCC's rows name its first inbox "" (older rows) and any other by address: fold both tables onto the address.
  const fccAddress = `CASE WHEN lower(COALESCE("senderAddress",'')) = '' THEN ? ELSE lower("senderAddress") END`;
  const [inboxes, sent, lastSends, bounces, byCampaign, replyState] = await Promise.all([
    readInboxes(db),
    db.prepare(`SELECT address, SUM(n) AS n FROM (
        SELECT ${fccAddress} AS address, COUNT(*) AS n FROM "FccCampaignSend" WHERE "sendDay" = ? AND "status" IN ('CLAIMED','SENT') GROUP BY 1
        UNION ALL SELECT "senderAddress" AS address, COUNT(*) AS n FROM "OutreachSend" WHERE "sendDay" = ? AND "status" IN ('CLAIMED','SENT') GROUP BY 1
      ) GROUP BY address`).bind(first, day, day).all<{ address: string; n: number }>(),
    db.prepare(`SELECT address, "sendId", MAX("createdAt") AS "createdAt" FROM (
        SELECT ${fccAddress} AS address, "sendId", "createdAt" FROM "FccCampaignSend" WHERE "sendDay" = ?
        UNION ALL SELECT "senderAddress" AS address, "sendId", "createdAt" FROM "OutreachSend" WHERE "sendDay" = ?
      ) GROUP BY address`).bind(first, day, day).all<{ address: string; sendId: string; createdAt: string }>(),
    db.prepare(`SELECT address, SUM(n) AS n FROM (
        SELECT CASE WHEN lower(COALESCE(s."senderAddress",'')) = '' THEN ? ELSE lower(s."senderAddress") END AS address, COUNT(DISTINCT c."id") AS n
          FROM "FccCampaignContact" c JOIN "FccCampaignSend" s ON s."contactId" = c."id" WHERE s."sendDay" = ? AND c."status" = 'bounced' GROUP BY 1
        UNION ALL SELECT s."senderAddress" AS address, COUNT(DISTINCT c."id") AS n
          FROM "OutreachContact" c JOIN "OutreachSend" s ON s."contactId" = c."id" WHERE s."sendDay" = ? AND s."kind" = 'real' AND c."status" = 'bounced' GROUP BY 1
      ) GROUP BY address`).bind(first, day, day).all<{ address: string; n: number }>(),
    db.prepare(`SELECT "campaignKey" AS key, "senderAddress" AS address, COUNT(*) AS n FROM "OutreachSend"
      WHERE "sendDay" = ? AND "kind" = 'real' AND "status" IN ('CLAIMED','SENT') GROUP BY 1, 2`).bind(day).all<{ key: string; address: string; n: number }>(),
    replyCheck === undefined ? readReplyCheck(db) : Promise.resolve(replyCheck),
  ]);
  const sentBy = new Map(sent.results.map((row) => [row.address, n(row.n)]));
  const lastBy = new Map(lastSends.results.map((row) => [row.address, row]));
  const bouncesBy = new Map(bounces.results.map((row) => [row.address, n(row.n)]));
  const campaignSent = (key: string, address: string) => n(byCampaign.results.find((row) => row.key === key && row.address === address)?.n);

  return inboxes.map((inbox: Inbox): InboxHealth => {
    const dayMax = inboxDayMax(inbox, day);
    const sentToday = sentBy.get(inbox.address) ?? 0;
    const bouncesToday = bouncesBy.get(inbox.address) ?? 0;
    const using = campaigns.filter(({ campaign }) => campaign.inboxes.some((share) => share.address === inbox.address));
    const wanting: Wanting[] = using.map(({ campaign, due, sentToday: sentAll }) => ({
      campaign, due, sentAll, perDay: campaign.inboxes.find((share) => share.address === inbox.address)!.perDay, sentFromInbox: campaignSent(campaign.key, inbox.address),
    }));
    const last = lastBy.get(inbox.address);
    const next = inboxNext({ enabled: inbox.enabled, dayMax, sentToday, bouncesToday, lastSendAt: last?.createdAt ?? null, lastSendId: last?.sendId ?? null, wanting }, now);
    const owner = mailboxOwner(inbox, inboxes);
    const readAddress = owner?.address ?? inbox.address;
    const ramping = inbox.rampFrom && inbox.ramp.length > 0 && dayMax < inbox.dailyMax;
    return {
      address: inbox.address, name: inbox.name, firstName: firstNameOf(inbox.name, inbox.address), enabled: inbox.enabled,
      sentToday, dayMax, capNow: inboxCapNow(dayMax, minute), fullMax: inbox.dailyMax, ramp: ramping ? { steps: inbox.ramp, from: inbox.rampFrom! } : null,
      bouncesToday, resting: bouncesToday >= PAUSE_BOUNCES, next, nextText: inboxNextText(next, day),
      campaigns: wanting.map((item) => ({ key: item.campaign.key, name: item.campaign.name, state: item.campaign.state, perDay: item.perDay, sentToday: item.sentFromInbox })),
      replyCheck: { lastReadAt: replyState?.inboxes?.[readAddress] ?? null, couldOpen: !(replyState?.unread ?? []).includes(readAddress) },
      readsVia: owner && owner.address !== inbox.address ? owner.address : null,
      gmail: /(^|\.)gmail\.com$/i.test(inbox.imapHost.trim()) || /(^|\.)gmail\.com$/i.test((owner?.imapHost ?? "").trim()),
    };
  });
}
