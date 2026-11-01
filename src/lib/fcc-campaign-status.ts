/**
 * What the FCC screen and the Today card show. Read-only: nothing here changes
 * the campaign. Every number comes straight from the FCC tables.
 */
import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION, FCC_DAILY_SEND_CAP, FCC_NOV6_CAMPAIGN_KEY, FCC_NOV6_LAST_SEND_DAY } from "@/lib/fcc-campaign";
import { readFccNotes, type FccControlNote, type FccRunNote } from "@/lib/fcc-campaign-control";
import { fccSentToday, torontoDay, torontoWeekday } from "@/lib/fcc-campaign-sender";
import { FCC_SECOND_BATCH_MAX_BOUNCES, FCC_SEND_WINDOWS, fccBouncesToday, torontoMinute } from "@/lib/fcc-campaign-tick";
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

const [FIRST, ...LATER] = FCC_SEND_WINDOWS;
const clockTime = (minute: number) => {
  const hour = Math.floor(minute / 60);
  const mm = String(minute % 60).padStart(2, "0");
  return hour < 12 ? `${hour}:${mm} a.m.` : `${hour === 12 ? 12 : hour - 12}:${mm} p.m.`;
};
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
  const moreAllowed = bouncesToday <= FCC_SECOND_BATCH_MAX_BOUNCES;
  if (minute < FIRST.start) return `Today at 10:00 a.m. (first ${batchSize}, one every 1 to 3 minutes).`;
  if (minute < FIRST.end && sentToday < batchSize) return `Sending now: one email every 1 to 3 minutes until ${batchSize} are out.`;
  for (const window of LATER) {
    if (sentToday >= batchSize * window.batch) continue;
    if (minute < window.start) {
      return moreAllowed
        ? `Today at ${clockTime(window.start)} (up to ${batchSize} more, because ${bouncesToday === 0 ? "nothing has bounced" : "only 1 has bounced"}).`
        : `${tomorrow} No more batches today: ${bouncesToday} emails bounced.`;
    }
    if (minute < window.end && moreAllowed) return "Sending now: the next batch, one email every 1 to 3 minutes.";
  }
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
    db.prepare(`SELECT MIN("createdAt") AS createdAt, COUNT(*) AS total, SUM("status" = 'ready') AS ready, SUM("status" = 'held') AS held,
        SUM("step1SentAt" IS NOT NULL) AS emailed, SUM("status" IN ('replied','bounced','suppressed','failed')) AS stopped
      FROM "FccCampaignContact" WHERE "campaignKey" = ?`)
      .bind(FCC_NOV6_CAMPAIGN_KEY).first<{ createdAt: string | null; total: number; ready: number; held: number; emailed: number; stopped: number }>(),
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
    // After its last day the hot list sends nothing more: its leftovers stay in the total, but aren't ready here.
    batches.unshift({
      name: "November 6 list", loadedAt: hotList.createdAt, total: Number(hotList.total), ready: day <= FCC_NOV6_LAST_SEND_DAY ? Number(hotList.ready) : 0, held: Number(hotList.held),
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
