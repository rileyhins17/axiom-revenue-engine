/**
 * What the FCC screen and the Today card show. Read-only: nothing here changes
 * the campaign. Every number comes straight from the FCC tables.
 */
import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION, FCC_DAILY_SEND_CAP, FCC_NOV6_CAMPAIGN_KEY, FCC_NOV6_LAST_SEND_DAY, fccCopySql } from "@/lib/fcc-campaign";
import { readFccNotes, type FccControlNote, type FccRunNote } from "@/lib/fcc-campaign-control";
import { FCC_DAY7_DUE_SQL, FCC_DAY7_JOIN_SQL, fccSentToday, torontoDay, torontoWeekday } from "@/lib/fcc-campaign-sender";
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
  /** Day-3 and day-7 follow-ups together; day7Due is how many of the due ones are day-7. */
  followUpsDue: number;
  followUpsLater: number;
  nextFollowUpDay: string | null;
  day7Due: number;
  replies: FccPerson[];
  bounces: FccPerson[];
  problems: FccPerson[];
};

const [FIRST, SECOND] = FCC_SEND_WINDOWS;
/**
 * A March row the hot list owns: sendable there, and either the hot list is still open or it reached them (a claimed
 * send counts: it may have gone out before a crash). Binds the hot-list key, then today.
 */
const ON_HOT_LIST = `EXISTS (SELECT 1 FROM "FccCampaignContact" h WHERE h."campaignKey" = ? AND h."email" = c."email" AND h."sendable" = 1 AND (h."status" <> 'ready' OR ? <= '${FCC_NOV6_LAST_SEND_DAY}'
  OR EXISTS (SELECT 1 FROM "FccCampaignSend" hs WHERE hs."contactId" = h."id" AND hs."step" = 1 AND hs."status" IN ('CLAIMED','SENT'))))`;
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

  const [notes, sends, groups, hotList, followUps, day7, replies, bounces, problems, sentToday, bouncesToday] = await Promise.all([
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
    // Day-7 follow-ups: everyone with a first email and a day-3 one but no day-7 yet, by the day it falls due.
    db.prepare(`SELECT SUM(due <= ?) AS due, SUM(due > ?) AS later, MIN(CASE WHEN due > ? THEN due END) AS nextDay FROM (
        SELECT ${FCC_DAY7_DUE_SQL} AS due FROM "FccCampaignContact" c
        ${FCC_DAY7_JOIN_SQL}
        WHERE c."campaignKey" = ? AND c."status" = 'step2_sent'
          AND NOT EXISTS (SELECT 1 FROM "FccCampaignSend" s WHERE s."contactId" = c."id" AND s."step" = 3 AND s."status" IN ('CLAIMED','SENT'))
          AND NOT ${ON_HOT_LIST})`)
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

  const byStep = (step: number) => sends.results.find((row) => Number(row.step) === step);
  const followUpsSent = (pick: "today" | "total") => Number(byStep(2)?.[pick] ?? 0) + Number(byStep(3)?.[pick] ?? 0);
  const nextDays = [followUps?.nextDay, day7?.nextDay].filter((value): value is string => Boolean(value)).sort();
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
    sentToday: { first: Number(byStep(1)?.today ?? 0), followUps: followUpsSent("today") },
    sentAllTime: { first: Number(byStep(1)?.total ?? 0), followUps: followUpsSent("total") },
    bouncesToday,
    ready: batches.reduce((sum, batch) => sum + batch.ready, 0),
    held: batches.reduce((sum, batch) => sum + batch.held, 0),
    batches,
    followUpsDue: Number(followUps?.due ?? 0) + Number(day7?.due ?? 0), followUpsLater: Number(followUps?.later ?? 0) + Number(day7?.later ?? 0),
    nextFollowUpDay: nextDays[0] ?? null, day7Due: Number(day7?.due ?? 0),
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

/** Each email version's row on the FCC screen, oldest first. v7a and v7b are the subject test: the same email under two subjects. */
const VERSION_NAMES: Record<string, string> = {
  v3: "Calmer email (Oct 28)", v4: "Question email (Oct 29–Nov 1)", v5: "Question email, new signature", nov6: "November 6 email",
  v7a: "Subject test: “Question about …'s RMD listing”", v7b: "Subject test: “…'s FCC listing”",
};
const VERSION_ORDER = Object.keys(VERSION_NAMES);
const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/**
 * The campaign's results for the FCC screen, over the March list and the November 6 list. "Real"
 * replies leave out out-of-office and other automatic replies; "said no" is a guess from the words
 * of the reply (stop, no thanks, not interested, remove, unsubscribe). Someone on both lists has
 * two rows, both marked replied when they answer, so a reply counts once: for the latest email
 * they got before it was found. The headline counts people; the version and inbox rows count
 * first emails. `inboxes` names each sending inbox; "" is the first inbox (Aidan's).
 */
export async function fccStats(db: ProspectDb, inboxes: FccInboxRef[], now = new Date()): Promise<FccStats> {
  const day = torontoDay(now);
  const name = (key: string) => inboxes.find((inbox) => inbox.key === key)?.name ?? (key || "First inbox");
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const answered = `c."status" = 'replied' AND NOT EXISTS (SELECT 1 FROM "FccCampaignContact" o WHERE o."email" = c."email" AND o."campaignKey" IN (?, ?)
    AND o."id" <> c."id" AND o."status" = 'replied' AND o."step1SentAt" > c."step1SentAt" AND o."step1SentAt" <= c."updatedAt")`;
  const reason = `lower(COALESCE(c."stoppedReason",''))`;
  const saidNo = ["%stop%", "%no thank%", "%not interested%", "%remove%", "%unsubscribe%"].map((words) => `${reason} LIKE '${words}'`).join(" OR ");
  const [groups, people, sends, setting] = await Promise.all([
    db.prepare(`SELECT "version", "inbox", COUNT(*) AS emailed, SUM("followedUp") AS followedUp,
        SUM("answered" AND NOT "automatic") AS real, SUM("answered" AND "automatic") AS automatic, SUM("answered" AND NOT "automatic" AND "saidNo") AS saidNo,
        SUM("answered" AND "followedUp") AS afterFollowUp, SUM("status" = 'bounced') AS bounced, SUM("status" = 'suppressed') AS stopped
      FROM (SELECT ${fccCopySql('c."step1MessageId"')} AS "version", COALESCE(c."senderAddress",'') AS "inbox", c."status" AS "status",
          c."step2SentAt" IS NOT NULL AS "followedUp", (${answered}) AS "answered", ${reason} LIKE '%automatic reply%' AS "automatic", (${saidNo}) AS "saidNo"
        FROM "FccCampaignContact" c WHERE c."campaignKey" IN (?, ?) AND c."step1SentAt" IS NOT NULL)
      GROUP BY 1, 2`)
      .bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY, FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY)
      .all<{ version: string; inbox: string; emailed: number; followedUp: number; real: number; automatic: number; saidNo: number; afterFollowUp: number; bounced: number; stopped: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT "email") AS n FROM "FccCampaignContact" WHERE "campaignKey" IN (?, ?) AND "step1SentAt" IS NOT NULL`)
      .bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY).first<{ n: number }>(),
    db.prepare(`SELECT "sendDay" AS day, COALESCE("senderAddress",'') AS inbox, "step", COUNT(*) AS n FROM "FccCampaignSend"
      WHERE "status" IN ('CLAIMED','SENT') AND "sendDay" >= ? GROUP BY 1, 2, 3`).bind(since).all<{ day: string; inbox: string; step: number; n: number }>(),
    db.prepare(`SELECT "dailyCap" FROM "FccCampaignSetting" WHERE "id" = 1`).bind().first<{ dailyCap: number }>(),
  ]);
  const rows = groups.results.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? value : Number(value ?? 0)]))) as typeof groups.results;
  const sum = (pick: (row: (typeof rows)[number]) => number, filter: (row: (typeof rows)[number]) => boolean = () => true) => rows.filter(filter).reduce((total, row) => total + pick(row), 0);
  const emailed = Number(people?.n ?? 0);
  const real = sum((row) => row.real);
  const bounced = sum((row) => row.bounced);
  const rank = (value: string) => (VERSION_ORDER.includes(value) ? VERSION_ORDER.indexOf(value) : VERSION_ORDER.length);
  const group = (key: (row: (typeof rows)[number]) => string, label: (value: string) => string, order = (a: string, b: string) => a.localeCompare(b)): FccRateRow[] =>
    [...new Set(rows.map(key))].sort(order).map((value) => {
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
  // Every first email brings two follow-ups (day 3 and day 7), so about a third of each day's emails can go to new companies.
  const newPerDay = Math.floor(today.reduce((total, inbox) => total + inbox.dailyMax, 0) / 3);
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
    byVersion: group((row) => row.version, (value) => VERSION_NAMES[value] ?? value, (a, b) => rank(a) - rank(b) || a.localeCompare(b)),
    byInbox: group((row) => row.inbox, name),
    today,
    newPerDay,
    weekdaysLeft: newPerDay > 0 ? Math.ceil(ready / newPerDay) : null,
  };
}
