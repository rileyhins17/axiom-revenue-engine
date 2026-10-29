/**
 * What the FCC screen and the Today card show. Read-only: nothing here changes
 * the campaign. Every number comes straight from the FCC tables.
 */
import { FCC_CAMPAIGN_KEY, FCC_COPY_VERSION, FCC_DAILY_SEND_CAP } from "@/lib/fcc-campaign";
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

const [FIRST, SECOND] = FCC_SEND_WINDOWS;
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

  const [notes, sends, groups, followUps, replies, bounces, problems, sentToday, bouncesToday] = await Promise.all([
    readFccNotes(db),
    db.prepare(`SELECT "step", SUM("sendDay" = ?) AS today, COUNT(*) AS total FROM "FccCampaignSend" WHERE "status" IN ('CLAIMED','SENT') GROUP BY "step"`)
      .bind(day).all<{ step: number; today: number; total: number }>(),
    db.prepare(`SELECT "createdAt", COUNT(*) AS total, SUM("status" = 'ready') AS ready, SUM("status" = 'held') AS held,
        SUM("step1SentAt" IS NOT NULL) AS emailed, SUM("status" IN ('replied','bounced','suppressed','failed')) AS stopped
      FROM "FccCampaignContact" WHERE "campaignKey" = ? GROUP BY "createdAt" ORDER BY "createdAt"`)
      .bind(FCC_CAMPAIGN_KEY).all<{ createdAt: string; total: number; ready: number; held: number; emailed: number; stopped: number }>(),
    db.prepare(`SELECT SUM("step2DueAt" <= ?) AS due, SUM("step2DueAt" > ?) AS later, MIN(CASE WHEN "step2DueAt" > ? THEN "step2DueAt" END) AS nextDay
      FROM "FccCampaignContact" WHERE "campaignKey" = ? AND "status" = 'step1_sent'`)
      .bind(day, day, day, FCC_CAMPAIGN_KEY).first<{ due: number | null; later: number | null; nextDay: string | null }>(),
    db.prepare(`SELECT "company","email","updatedAt" AS at,"stoppedReason" AS note FROM "FccCampaignContact"
      WHERE "campaignKey" = ? AND "status" = 'replied' ORDER BY "updatedAt" DESC LIMIT 50`).bind(FCC_CAMPAIGN_KEY).all<FccPerson>(),
    db.prepare(`SELECT "company","email","updatedAt" AS at,"stoppedReason" AS note FROM "FccCampaignContact"
      WHERE "campaignKey" = ? AND "status" = 'bounced' ORDER BY "updatedAt" DESC LIMIT 50`).bind(FCC_CAMPAIGN_KEY).all<FccPerson>(),
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
