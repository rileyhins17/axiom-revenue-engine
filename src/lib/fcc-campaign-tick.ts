/**
 * The FCC send tick, following Aidan's send rules (Oct 27). The Worker runs it
 * every minute through the day; each run sends at most one email, 1 to 3
 * minutes after the one before, so 30 take about an hour instead of going out
 * in a burst.
 *
 * - First batch: up to the daily cap (30) from 10:00 Toronto time.
 * - Second batch: up to 30 more from 12:30, only when today has 1 bounce or fewer.
 *   So 60 a day is the ceiling, follow-ups (day 3 and day 7) included.
 * - Each inbox runs its own tick with its own count, gap and bounces. An added
 *   inbox starts slowly (FCC_NEW_INBOX_RAMP) so Google doesn't flag it.
 * - Pause everything (a founder must press Resume) on a Google warning in the
 *   inbox, 3 or more bounces in a day, a login Gmail refuses, or an email Gmail
 *   refuses.
 * Nothing is sent without a successful inbox check first.
 */
import { FCC_DAILY_SEND_CAP } from "@/lib/fcc-campaign";
import { noteFccRun, pauseFcc, readFccBounceScan, saveFccBounceScan } from "@/lib/fcc-campaign-control";
import {
  fccClosedGate, fccSentToday, fccSetting, runFccDailySend, senderKey, torontoDay,
  type FccMailbox, type FccRunResult, type FccSendConfig,
} from "@/lib/fcc-campaign-sender";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

/** Minutes after midnight, Toronto time. */
export const FCC_SEND_WINDOWS = [
  { batch: 1, start: 10 * 60, end: 12 * 60 },
  { batch: 2, start: 12 * 60 + 30, end: 14 * 60 + 30 },
] as const;
export const FCC_GAP_MIN_MS = 60_000;
export const FCC_GAP_MAX_MS = 180_000;
/** The second batch goes only when the day has at most this many bounces. */
export const FCC_SECOND_BATCH_MAX_BOUNCES = 1;
/** This many bounces in a day pauses the campaign. */
export const FCC_PAUSE_BOUNCES = 3;
export const FCC_AUTO_PAUSE_BY = "the automatic safety check";
/**
 * An added inbox's daily emails on its first, second and third day of sending; from the fourth it sends as many as the
 * first inbox (Aidan, Nov 2: equal volume). Fast because Riley's Gmail is an old, already-used account: a new domain needs weeks.
 */
export const FCC_NEW_INBOX_RAMP = [15, 30, 45] as const;

const TICK_MS = 60_000;
const JITTER_MS = 15_000;
const LOGIN_REFUSED = /\b53[45]\b|5\.7\.(?:8|9|14)\b|AUTHENTICATIONFAILED|password|log ?in|auth/i;

export type FccTickResult = FccRunResult | { status: "PAUSED"; reason: string };
export type FccTickOptions = { wait?: (ms: number) => Promise<void>; random?: () => number };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

export function torontoMinute(now: Date) {
  const [hour, minute] = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Toronto" })
    .format(now).split(":").map(Number);
  return hour! * 60 + minute!;
}

/** The wait after an email: 1 to 3 minutes, fixed by its send id so every run agrees on it. */
export function gapAfter(sendId: string) {
  let hash = 2166136261;
  for (const char of sendId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return FCC_GAP_MIN_MS + (hash % (FCC_GAP_MAX_MS - FCC_GAP_MIN_MS + 1));
}

/** Contacts emailed today (by every inbox, or only `sender`) that have since bounced, whether Gmail refused them or a bounce came back. */
export async function fccBouncesToday(db: ProspectDb, day: string, sender?: Pick<FccSendConfig, "fromAddress" | "primary">) {
  const mine = sender ? ` AND COALESCE(s."senderAddress",'') = ?` : "";
  return Number((await db.prepare(`SELECT COUNT(DISTINCT c."id") AS n FROM "FccCampaignContact" c
    JOIN "FccCampaignSend" s ON s."contactId" = c."id" WHERE s."sendDay" = ? AND c."status" = 'bounced'${mine}`)
    .bind(...(sender ? [day, senderKey(sender)] : [day])).first<{ n: number }>())?.n ?? 0);
}

/** Most emails `sender` may send on `day`: both batches for the first inbox; the ramp for an added one, counted in days it has already sent, so a paused day doesn't move it up. */
export async function fccDailyMax(db: ProspectDb, sender: Pick<FccSendConfig, "fromAddress" | "primary">, dailyCap: number, day: string) {
  const full = Math.min(FCC_DAILY_SEND_CAP, Math.max(0, dailyCap)) * FCC_SEND_WINDOWS.length;
  if (sender.primary !== false) return full;
  const earlier = await db.prepare(`SELECT COUNT(DISTINCT "sendDay") AS days FROM "FccCampaignSend" WHERE "senderAddress" = ? AND "sendDay" < ? AND "status" IN ('CLAIMED','SENT')`)
    .bind(sender.fromAddress, day).first<{ days: number }>();
  return Math.min(full, FCC_NEW_INBOX_RAMP[Number(earlier?.days ?? 0)] ?? full);
}

export async function runFccSendTick(db: ProspectDb, config: FccSendConfig, now = new Date(), options: FccTickOptions = {}): Promise<FccTickResult> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const setting = await fccSetting(db);
  const closed = fccClosedGate(setting, config, now);
  if (closed || !setting) return { status: "SKIPPED", reason: closed ?? "setting row missing" };
  const minute = torontoMinute(now);
  const window = FCC_SEND_WINDOWS.find((w) => minute >= w.start && minute < w.end);
  if (!window) return { status: "SKIPPED", reason: "outside the send windows" };

  const day = torontoDay(now);
  const inbox = senderKey(config);
  // An added inbox names itself in notes and pause reasons; the first inbox's wording is unchanged.
  const label = config.primary === false ? `${(config.fromName ?? config.fromAddress).trim().split(/\s+/)[0]}'s inbox: ` : "";
  const dailyMax = await fccDailyMax(db, config, setting.dailyCap, day);
  const cap = window.batch === 1 ? Math.ceil(dailyMax / FCC_SEND_WINDOWS.length) : dailyMax;
  if (await fccSentToday(db, day, config) >= cap) return { status: "SKIPPED", reason: window.batch === 1 ? "first batch done" : "today's limit reached" };
  const last = await db.prepare(`SELECT "sendId","createdAt" FROM "FccCampaignSend" WHERE "sendDay" = ? AND COALESCE("senderAddress",'') = ? ORDER BY "createdAt" DESC LIMIT 1`)
    .bind(day, inbox).first<{ sendId: string; createdAt: string }>();
  const dueAt = last ? Date.parse(last.createdAt) + gapAfter(last.sendId) : now.getTime();
  // A later run will be closer; don't log in to Gmail just to wait.
  if (dueAt - now.getTime() >= TICK_MS) return { status: "SKIPPED", reason: "waiting between emails" };

  const pause = async (cause: string): Promise<FccTickResult> => {
    const reason = `${label}${cause}`;
    await pauseFcc(db, reason, FCC_AUTO_PAUSE_BY, now);
    await noteFccRun(db, `Paused: ${reason}`, now);
    return { status: "PAUSED", reason };
  };
  const noSecondBatch = async (bounces: number): Promise<FccTickResult> => {
    await noteFccRun(db, `${label}No second batch today: ${bounces} emails bounced this morning.`, now);
    return { status: "SKIPPED", reason: "no second batch: too many bounces" };
  };
  // Decide from what is already known before logging in to Gmail at all.
  const knownBounces = await fccBouncesToday(db, day, config);
  if (knownBounces >= FCC_PAUSE_BOUNCES) return pause(`${knownBounces} emails bounced today`);
  if (window.batch === 2 && knownBounces > FCC_SECOND_BATCH_MAX_BOUNCES) return noSecondBatch(knownBounces);

  let mailbox: FccMailbox;
  try {
    mailbox = await config.mailbox!();
  } catch (error) {
    const detail = message(error);
    if (LOGIN_REFUSED.test(detail)) return pause(`Gmail refused the inbox login (${detail})`);
    await noteFccRun(db, `${label}Couldn't check the Gmail inbox, so nothing was sent. Trying again next minute. (${detail})`, now);
    return { status: "SKIPPED", reason: `inbox check failed: ${detail}` };
  }
  try {
    const sinceIso = `${day}T12:00:00.000Z`;
    const warning = await mailbox.googleWarning(sinceIso);
    if (warning) return await pause(warning);

    // Match bounces to today's contacts only when a new bounce message has arrived since the last look.
    const bounceMessages = await mailbox.bounceCount(sinceIso);
    const scanned = await readFccBounceScan(db, inbox);
    if (bounceMessages > (scanned?.day === day ? scanned.count : 0)) {
      const { results: sentToday } = await db.prepare(`SELECT DISTINCT c."id", c."email" FROM "FccCampaignContact" c
        JOIN "FccCampaignSend" s ON s."contactId" = c."id"
        WHERE s."sendDay" = ? AND s."status" = 'SENT' AND c."status" IN ('step1_sent','step2_sent') AND COALESCE(s."senderAddress",'') = ?`)
        .bind(day, inbox).all<{ id: string; email: string }>();
      const bounced = new Set(await mailbox.bouncedAmong(sentToday.map((contact) => contact.email), sinceIso));
      for (const contact of sentToday.filter((row) => bounced.has(row.email))) {
        await db.prepare(`UPDATE "FccCampaignContact" SET "status" = 'bounced', "stoppedReason" = 'The email bounced', "updatedAt" = ? WHERE "id" = ?`)
          .bind(now.toISOString(), contact.id).run();
        await db.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES (?,'BOUNCED') ON CONFLICT DO NOTHING`).bind(contact.email.toLowerCase()).run();
      }
      await saveFccBounceScan(db, day, bounceMessages, now, inbox);
    }
    const bounces = await fccBouncesToday(db, day, config);
    if (bounces >= FCC_PAUSE_BOUNCES) return await pause(`${bounces} emails bounced today`);
    if (window.batch === 2 && bounces > FCC_SECOND_BATCH_MAX_BOUNCES) return await noSecondBatch(bounces);

    const delay = Math.max(0, dueAt - now.getTime()) + Math.floor(random() * JITTER_MS);
    if (delay > 0) await wait(delay);
    const sendAt = new Date(now.getTime() + delay);
    let result: FccRunResult;
    try {
      // The inbox is already open; the sender borrows it for follow-up reply checks.
      result = await runFccDailySend(db, { ...config, mailbox: async () => ({ ...mailbox, close: async () => undefined }) }, sendAt,
        { cap, limit: 1, minGapMs: FCC_GAP_MIN_MS - 10_000 });
    } catch (error) {
      const detail = message(error);
      if (LOGIN_REFUSED.test(detail)) return await pause(`Gmail refused the sending login (${detail})`);
      await noteFccRun(db, `${label}Couldn't connect to Gmail to send. Trying again next minute. (${detail})`, sendAt);
      return { status: "SKIPPED", reason: `could not connect: ${detail}` };
    }
    if (result.status === "RAN" && result.failed > 0) {
      const failure = await db.prepare(`SELECT "detail" FROM "FccCampaignSend" WHERE "sendDay" = ? AND "status" = 'FAILED' AND COALESCE("senderAddress",'') = ? ORDER BY "createdAt" DESC LIMIT 1`)
        .bind(day, inbox).first<{ detail: string | null }>();
      return await pause(`Gmail refused an email (${failure?.detail ?? "no detail"})`);
    }
    if (result.status === "RAN" && result.bounced > 0) {
      const total = await fccBouncesToday(db, day, config);
      if (total >= FCC_PAUSE_BOUNCES) return await pause(`${total} emails bounced today`);
    }
    const sent = await fccSentToday(db, day, config);
    await noteFccRun(db, label + (result.status === "SKIPPED"
      ? `Nothing to send: ${result.reason}.`
      : result.firstEmails + result.followUps + result.day7FollowUps > 0
        ? `Sent email ${sent} of today's ${cap} (${result.day7FollowUps > 0 ? "a day-7 follow-up" : result.followUps > 0 ? "a follow-up" : "a first email"}).`
        : `Checked ${result.replied + result.bounced + result.suppressed} contacts; nothing sent this minute.`), sendAt);
    return result;
  } finally {
    await mailbox.close().catch(() => undefined);
  }
}
