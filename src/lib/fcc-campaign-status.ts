/**
 * What the FCC screen and the Today card show. Read-only: nothing here changes
 * the campaign. Every number comes straight from the FCC tables.
 */
import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION, FCC_DAILY_SEND_CAP, FCC_NOV6_CAMPAIGN_KEY, FCC_NOV6_LAST_SEND_DAY } from "@/lib/fcc-campaign";
import { readFccNotes, type FccControlNote, type FccRunNote } from "@/lib/fcc-campaign-control";
import { fccSentToday, torontoDay, torontoWeekday } from "@/lib/fcc-campaign-sender";
import { FCC_SECOND_BATCH_MAX_BOUNCES, FCC_SEND_WINDOWS, fccBouncesToday, fccDailyMax, torontoMinute } from "@/lib/fcc-campaign-tick";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export type FccState = "live" | "paused" | "locked";
export type FccPerson = { company: string; email: string; at: string; note: string | null };
export type FccBatch = { name: string; loadedAt: string; total: number; ready: number; held: number; emailed: number; stopped: number };

export type FccScreen = {
  state: FccState;
  goBy: string | null;
  goAt: string | null;
  control: FccControlNote | null;
  lastRun: FccRunNote | null;
  nextSend: string;
  batchSize: number;
  sentToday: { first: number; followUps: number };
  sentAllTime: { first: number; followUps: number };
  bouncesToday: number;
  ready: number;
  held: number;
  batches: FccBatch[];
  followUpsDue: number;
  followUpsLater: number;
  nextFollowUpDay: string | null;
  replies: FccPerson[];
  bounces: FccPerson[];
  problems: FccPerson[];
};

const [FIRST, SECOND] = FCC_SEND_WINDOWS;
/** A March row the hot list owns: sendable there, and either the hot list is still open or it reached them. Binds the hot-list key, then today. */
const ON_HOT_LIST = `EXISTS (SELECT 1 FROM "FccCampaignContact" h WHERE h."campaignKey" = ? AND h."email" = c."email" AND h."sendable" = 1 AND (h."status" <> 'ready' OR ? <= '${FCC_NOV6_LAST_SEND_DAY}'))`;
const toronto = (now: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", ...options }).format(now);

/** The next weekday after today, as "Thursday, October 29". */
function nextWeekday(now: Date) {
  for (let days = 1; days <= 7; days += 1) {
    const day = new Date(now.getTime() + days * 86_400_000);
    if (!["Sat", "Sun"].includes(torontoWeekday(day))) return toronto(day, { weekday: "long", month: "long", day: "numeric" });
  }
  return "the next weekday";
}

/** When the next email goes, in plain English. */
export function fccNextSend(state: FccState, now: Date, sentToday: number, batchSize: number, bouncesToday: number) {
  if (state === "locked") return "Nothing is scheduled. Sending starts only after a founder gives the go on this email.";
  if (state === "paused") return "Nothing sends while FCC is paused. Press Resume to start again.";
  const tomorrow = `${nextWeekday(now)} at 10:00 a.m.`;
  if (["Sat", "Sun"].includes(torontoWeekday(now))) return tomorrow;
  const minute = torontoMinute(now);
  const secondAllowed = bouncesToday <= FCC_SECOND_BATCH_MAX_BOUNCES;
  if (minute < FIRST.start) return `Today at 10:00 a.m. (first ${batchSize}, one every 1 to 3 minutes).`;
  if (minute < FIRST.end && sentToday < batchSize) return `Sending now: one email every 1 to 3 minutes until ${batchSize} are out.`;
  if (minute < SECOND.start && sentToday < batchSize * 2) {
    return secondAllowed
      ? `Today at 12:30 p.m. (up to ${batchSize} more, because ${bouncesToday === 0 ? "nothing has bounced" : "only 1 has bounced"}).`
      : `${tomorrow} No second batch today: ${bouncesToday} emails bounced this morning.`;
  }
  if (minute < SECOND.end && sentToday < batchSize * 2 && secondAllowed) return "Sending now: the second batch, one email every 1 to 3 minutes.";
  return tomorrow;
}

export async function fccScreen(db: ProspectDb, now = new Date()): Promise<FccScreen> {
  const day = torontoDay(now);
  const setting = await db.prepare(`SELECT "enabled","dailyCap","approvedCopy","goBy","goAt" FROM "FccCampaignSetting" WHERE "id" = 1`).bind()
    .first<{ enabled: number; dailyCap: number; approvedCopy: string | null; goBy: string | null; goAt: string | null }>();
  const approved = setting?.approvedCopy === FCC_COPY_VERSION && Boolean(setting?.goBy);
  const state: FccState = !setting || !approved ? "locked" : setting.enabled === 1 ? "live" : "paused";
  const batchSize = Math.min(FCC_DAILY_SEND_CAP, Math.max(0, setting?.dailyCap ?? 0));

  const [notes, sends, groups, hotList, followUps, replies, bounces, problems, sentToday, bouncesToday] = await Promise.all([
    readFccNotes(db),
    db.prepare(`SELECT "step", SUM("sendDay" = ?) AS today, COUNT(*) AS total FROM "FccCampaignSend" WHERE "status" IN ('CLAIMED','SENT') GROUP BY "step"`)
      .bind(day).all<{ step: number; today: number; total: number }>(),
    db.prepare(`SELECT c."createdAt", COUNT(*) AS total, SUM(c."status" = 'ready' AND NOT ${ON_HOT_LIST}) AS ready, SUM(c."status" = 'held') AS held,
        SUM(c."step1SentAt" IS NOT NULL) AS emailed, SUM(c."status" IN ('replied','bounced','suppressed','failed')) AS stopped
      FROM "FccCampaignContact" c WHERE c."campaignKey" = ? GROUP BY c."createdAt" ORDER BY c."createdAt"`)
      .bind(FCC_NOV6_CAMPAIGN_KEY, day, FCC_CAMPAIGN_KEY).all<{ createdAt: string; total: number; ready: number; held: number; emailed: number; stopped: number }>(),
    // One row for the whole hot list: the importer gives each of its contacts its own createdAt to keep file order.
    db.prepare(`SELECT MIN("createdAt") AS createdAt, COUNT(*) AS total, SUM("status" = 'ready' AND ? <= '${FCC_NOV6_LAST_SEND_DAY}') AS ready, SUM("status" = 'held') AS held,
        SUM("step1SentAt" IS NOT NULL) AS emailed, SUM("status" IN ('replied','bounced','suppressed','failed')) AS stopped
      FROM "FccCampaignContact" WHERE "campaignKey" = ?`)
      .bind(day, FCC_NOV6_CAMPAIGN_KEY).first<{ createdAt: string | null; total: number; ready: number; held: number; emailed: number; stopped: number }>(),
    db.prepare(`SELECT SUM(c."step2DueAt" <= ?) AS due, SUM(c."step2DueAt" > ?) AS later, MIN(CASE WHEN c."step2DueAt" > ? THEN c."step2DueAt" END) AS nextDay
      FROM "FccCampaignContact" c WHERE c."campaignKey" = ? AND c."status" = 'step1_sent' AND NOT ${ON_HOT_LIST}`)
      .bind(day, day, day, FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY, day).first<{ due: number | null; later: number | null; nextDay: string | null }>(),
    // One row per address: a reply or bounce on someone on both lists stops both of their rows.
    db.prepare(`SELECT "company","email",MAX("updatedAt") AS at,"stoppedReason" AS note FROM "FccCampaignContact"
      WHERE "campaignKey" IN (?, ?) AND "status" = 'replied' GROUP BY "email" ORDER BY at DESC LIMIT 50`).bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY).all<FccPerson>(),
    db.prepare(`SELECT "company","email",MAX("updatedAt") AS at,"stoppedReason" AS note FROM "FccCampaignContact"
      WHERE "campaignKey" IN (?, ?) AND "status" = 'bounced' GROUP BY "email" ORDER BY at DESC LIMIT 50`).bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY).all<FccPerson>(),
    db.prepare(`SELECT c."company", s."email", COALESCE(s."finishedAt", s."createdAt") AS at, s."detail" AS note
      FROM "FccCampaignSend" s JOIN "FccCampaignContact" c ON c."id" = s."contactId" WHERE s."status" = 'FAILED' ORDER BY at DESC LIMIT 20`).bind().all<FccPerson>(),
    fccSentToday(db, day),
    fccBouncesToday(db, day),
  ]);

  const byStep = (step: number) => sends.results.find((row) => row.step === step);
  const batches = groups.results.map((row) => ({
    name: notes.batchNames[row.createdAt] ?? `Loaded ${toronto(new Date(row.createdAt), { month: "short", day: "numeric" })}`,
    loadedAt: row.createdAt, total: Number(row.total), ready: Number(row.ready), held: Number(row.held), emailed: Number(row.emailed), stopped: Number(row.stopped),
  }));
  if (hotList?.createdAt) {
    batches.unshift({
      name: "November 6 list", loadedAt: hotList.createdAt, total: Number(hotList.total), ready: Number(hotList.ready), held: Number(hotList.held),
      emailed: Number(hotList.emailed), stopped: Number(hotList.stopped),
    });
  }
  return {
    state, goBy: setting?.goBy ?? null, goAt: setting?.goAt ?? null, control: notes.control, lastRun: notes.lastRun,
    nextSend: fccNextSend(state, now, sentToday, batchSize, bouncesToday), batchSize,
    sentToday: { first: Number(byStep(1)?.today ?? 0), followUps: Number(byStep(2)?.today ?? 0) },
    sentAllTime: { first: Number(byStep(1)?.total ?? 0), followUps: Number(byStep(2)?.total ?? 0) },
    bouncesToday,
    ready: batches.reduce((sum, batch) => sum + batch.ready, 0),
    held: batches.reduce((sum, batch) => sum + batch.held, 0),
    batches,
    followUpsDue: Number(followUps?.due ?? 0), followUpsLater: Number(followUps?.later ?? 0), nextFollowUpDay: followUps?.nextDay ?? null,
    replies: replies.results, bounces: bounces.results, problems: problems.results,
  };
}

export type FccInboxRef = { key: string; name: string };
export type FccRateRow = { label: string; emailed: number; replies: number; rate: number | null; bounced: number };
export type FccDayRow = { day: string; first: number; followUps: number; byInbox: Array<{ name: string; sent: number }> };
export type FccInboxToday = { name: string; sentToday: number; dailyMax: number };
export type FccStats = {
  emailed: number;
  followUpsSent: number;
  replies: { real: number; automatic: number; saidNo: number; afterFollowUp: number };
  replyRate: number | null;
  bounced: number;
  bounceRate: number | null;
  stopped: number;
  days: FccDayRow[];
  byVersion: FccRateRow[];
  byInbox: FccRateRow[];
  today: FccInboxToday[];
  /** New companies a weekday once follow-ups take their share, and how many weekdays the ready list lasts at that pace. */
  newPerDay: number;
  weekdaysLeft: number | null;
};

const VERSION_NAMES: Record<string, string> = { v3: "Calmer email (Oct 28)", v4: "Question email (Oct 29–Nov 1)", v5: "Question email, new signature" };
const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/**
 * The campaign's results for the FCC screen. "Real" replies leave out
 * out-of-office and other automatic replies; "said no" is a guess from the
 * words of the reply (stop, no thanks, not interested, remove, unsubscribe).
 * `inboxes` names each sending inbox; "" is the first inbox (Aidan's).
 */
export async function fccStats(db: ProspectDb, inboxes: FccInboxRef[], now = new Date()): Promise<FccStats> {
  const day = torontoDay(now);
  const name = (key: string) => inboxes.find((inbox) => inbox.key === key)?.name ?? (key || "First inbox");
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [groups, sends, setting] = await Promise.all([
    db.prepare(`SELECT CASE WHEN "step1MessageId" LIKE '<fcc-v5-%' THEN 'v5' WHEN "step1MessageId" LIKE '<fcc-v4-%' THEN 'v4' ELSE 'v3' END AS version, COALESCE("senderAddress",'') AS inbox,
        COUNT(*) AS emailed, SUM("step2SentAt" IS NOT NULL) AS followedUp,
        SUM("status" = 'replied' AND lower(COALESCE("stoppedReason",'')) NOT LIKE '%automatic reply%') AS real,
        SUM("status" = 'replied' AND lower(COALESCE("stoppedReason",'')) LIKE '%automatic reply%') AS automatic,
        SUM("status" = 'replied' AND lower(COALESCE("stoppedReason",'')) NOT LIKE '%automatic reply%' AND (lower("stoppedReason") LIKE '%stop%'
          OR lower("stoppedReason") LIKE '%no thank%' OR lower("stoppedReason") LIKE '%not interested%' OR lower("stoppedReason") LIKE '%remove%'
          OR lower("stoppedReason") LIKE '%unsubscribe%')) AS saidNo,
        SUM("status" = 'replied' AND "step2SentAt" IS NOT NULL) AS afterFollowUp,
        SUM("status" = 'bounced') AS bounced, SUM("status" = 'suppressed') AS stopped
      FROM "FccCampaignContact" WHERE "campaignKey" = ? AND "step1SentAt" IS NOT NULL GROUP BY 1, 2`)
      .bind(FCC_CAMPAIGN_KEY).all<{ version: string; inbox: string; emailed: number; followedUp: number; real: number; automatic: number; saidNo: number; afterFollowUp: number; bounced: number; stopped: number }>(),
    db.prepare(`SELECT "sendDay" AS day, COALESCE("senderAddress",'') AS inbox, "step", COUNT(*) AS n FROM "FccCampaignSend"
      WHERE "status" IN ('CLAIMED','SENT') AND "sendDay" >= ? GROUP BY 1, 2, 3`).bind(since).all<{ day: string; inbox: string; step: number; n: number }>(),
    db.prepare(`SELECT "dailyCap" FROM "FccCampaignSetting" WHERE "id" = 1`).bind().first<{ dailyCap: number }>(),
  ]);
  const rows = groups.results.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? value : Number(value ?? 0)]))) as typeof groups.results;
  const sum = (pick: (row: (typeof rows)[number]) => number, filter: (row: (typeof rows)[number]) => boolean = () => true) => rows.filter(filter).reduce((total, row) => total + pick(row), 0);
  const emailed = sum((row) => row.emailed);
  const real = sum((row) => row.real);
  const bounced = sum((row) => row.bounced);
  const group = (key: (row: (typeof rows)[number]) => string, label: (value: string) => string): FccRateRow[] =>
    [...new Set(rows.map(key))].sort().map((value) => {
      const mine = (row: (typeof rows)[number]) => key(row) === value;
      const count = sum((row) => row.emailed, mine);
      const replies = sum((row) => row.real, mine);
      return { label: label(value), emailed: count, replies, rate: rate(replies, count), bounced: sum((row) => row.bounced, mine) };
    });

  const byDay = new Map<string, FccDayRow>();
  for (const send of sends.results) {
    const row = byDay.get(send.day) ?? { day: send.day, first: 0, followUps: 0, byInbox: [] };
    const count = Number(send.n);
    if (Number(send.step) === 1) row.first += count; else row.followUps += count;
    const inboxRow = row.byInbox.find((entry) => entry.name === name(send.inbox));
    if (inboxRow) inboxRow.sent += count; else row.byInbox.push({ name: name(send.inbox), sent: count });
    byDay.set(send.day, row);
  }

  const keys = [...new Set(["", ...inboxes.map((inbox) => inbox.key), ...rows.map((row) => row.inbox)])];
  const today = await Promise.all(keys.map(async (key) => {
    const sender = { fromAddress: key, primary: key === "" };
    return { name: name(key), sentToday: await fccSentToday(db, day, sender), dailyMax: await fccDailyMax(db, sender, setting?.dailyCap ?? 0, day) };
  }));
  // Every first email brings one follow-up three days later, so about half of each day's emails can go to new companies.
  const newPerDay = Math.floor(today.reduce((total, inbox) => total + inbox.dailyMax, 0) / 2);
  const ready = Number((await db.prepare(`SELECT COUNT(*) AS n FROM "FccCampaignContact" WHERE "campaignKey" = ? AND "status" = 'ready' AND "sendable" = 1`)
    .bind(FCC_CAMPAIGN_KEY).first<{ n: number }>())?.n ?? 0);

  return {
    emailed,
    followUpsSent: sum((row) => row.followedUp),
    replies: { real, automatic: sum((row) => row.automatic), saidNo: sum((row) => row.saidNo), afterFollowUp: sum((row) => row.afterFollowUp) },
    replyRate: rate(real, emailed),
    bounced,
    bounceRate: rate(bounced, emailed),
    stopped: sum((row) => row.stopped),
    days: [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14),
    byVersion: group((row) => row.version, (value) => VERSION_NAMES[value] ?? value),
    byInbox: group((row) => row.inbox, name),
    today,
    newPerDay,
    weekdaysLeft: newPerDay > 0 ? Math.ceil(ready / newPerDay) : null,
  };
}
