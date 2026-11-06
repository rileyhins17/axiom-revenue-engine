/**
 * Inbox safety, shared by every campaign and the FCC sender (Riley, Nov 5: "No inbox goes over the
 * daily amount it has proven safe, all campaigns counted together"). For one inbox on one Toronto day:
 *
 * - its day's maximum is its own dailyMax, or its ramp while new (by week from rampFrom);
 * - the first half of that maximum may go from the start of the day; the rest only from 12:30 and only
 *   if the inbox had at most 1 bounce that day (FCC's second-batch rule, applied to the whole inbox);
 * - one email at a time, 1 to 3 minutes apart, whichever campaign sends it;
 * - 3 bounces in a day from the inbox stops every campaign that sends from it.
 *
 * FCC rows name their inbox the old way ("" for FCC's first inbox, otherwise its address), so each
 * inbox is referred to by its address plus that FCC key.
 */
import type { Inbox } from "@/lib/outreach/outreach-model";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export const AFTERNOON_FROM = 12 * 60 + 30;
export const AFTERNOON_MAX_BOUNCES = 1;
export const PAUSE_BOUNCES = 3;
export const GAP_MIN_MS = 60_000;
export const GAP_MAX_MS = 180_000;

export type InboxRef = { address: string; fccKey: string };

/** `address` as both tables name it. `fccFirstInbox` is FCC_SENDER_ADDRESS, whose FCC rows carry no address. */
export function inboxRef(address: string, fccFirstInbox: string | null | undefined): InboxRef {
  const normal = address.trim().toLowerCase();
  return { address: normal, fccKey: normal === (fccFirstInbox ?? "").trim().toLowerCase() ? "" : normal };
}

/** The wait after an email: 1 to 3 minutes, fixed by its send id so every run agrees (same as FCC's gapAfter). */
export function gapAfter(sendId: string) {
  let hash = 2166136261;
  for (const char of sendId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return GAP_MIN_MS + (hash % (GAP_MAX_MS - GAP_MIN_MS + 1));
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** Most emails the inbox may send on `day`, every campaign together. */
export function inboxDayMax(inbox: Pick<Inbox, "dailyMax" | "ramp" | "rampFrom" | "enabled">, day: string) {
  if (!inbox.enabled) return 0;
  if (!inbox.rampFrom || inbox.ramp.length === 0) return inbox.dailyMax;
  const days = daysBetween(inbox.rampFrom, day);
  if (days < 0) return Math.min(inbox.dailyMax, inbox.ramp[0] ?? 0);
  return Math.min(inbox.dailyMax, inbox.ramp[Math.floor(days / 7)] ?? inbox.dailyMax);
}

/** The inbox's limit right now: half the day's maximum before 12:30, the whole of it after. */
export function inboxCapNow(dayMax: number, minute: number) {
  return minute < AFTERNOON_FROM ? Math.ceil(dayMax / 2) : dayMax;
}

const FCC_SENT = `SELECT COUNT(*) FROM "FccCampaignSend" WHERE "sendDay" = ? AND "status" IN ('CLAIMED','SENT') AND lower(COALESCE("senderAddress",'')) = ?`;
const OUTREACH_SENT = `SELECT COUNT(*) FROM "OutreachSend" WHERE "sendDay" = ? AND "status" IN ('CLAIMED','SENT') AND "senderAddress" = ?`;

/** SQL (with its binds) for every email claimed or sent from the inbox on `day`, FCC and campaigns together. */
export function inboxSentSql(day: string, inbox: InboxRef) {
  return { sql: `((${FCC_SENT}) + (${OUTREACH_SENT}))`, binds: [day, inbox.fccKey, day, inbox.address] };
}

/** SQL (with its binds) that is true when the inbox claimed any email after `sinceIso` on `day`. */
export function inboxClaimedSinceSql(day: string, sinceIso: string, inbox: InboxRef) {
  return {
    sql: `(EXISTS (SELECT 1 FROM "FccCampaignSend" WHERE "sendDay" = ? AND "createdAt" > ? AND lower(COALESCE("senderAddress",'')) = ?)
      OR EXISTS (SELECT 1 FROM "OutreachSend" WHERE "sendDay" = ? AND "createdAt" > ? AND "senderAddress" = ?))`,
    binds: [day, sinceIso, inbox.fccKey, day, sinceIso, inbox.address],
  };
}

export async function inboxSentToday(db: ProspectDb, day: string, inbox: InboxRef) {
  const { sql, binds } = inboxSentSql(day, inbox);
  return Number((await db.prepare(`SELECT ${sql} AS n`).bind(...binds).first<{ n: number }>())?.n ?? 0);
}

/** The inbox's latest email today, from either table, for the gap before the next one. */
export async function inboxLastSend(db: ProspectDb, day: string, inbox: InboxRef) {
  return db.prepare(`SELECT "sendId","createdAt" FROM (
      SELECT "sendId","createdAt" FROM "FccCampaignSend" WHERE "sendDay" = ? AND lower(COALESCE("senderAddress",'')) = ?
      UNION ALL
      SELECT "sendId","createdAt" FROM "OutreachSend" WHERE "sendDay" = ? AND "senderAddress" = ?
    ) ORDER BY "createdAt" DESC LIMIT 1`).bind(day, inbox.fccKey, day, inbox.address).first<{ sendId: string; createdAt: string }>();
}

/** People emailed from the inbox today (any campaign) who have since bounced. */
export async function inboxBouncesToday(db: ProspectDb, day: string, inbox: InboxRef) {
  return Number((await db.prepare(`SELECT
      (SELECT COUNT(DISTINCT c."id") FROM "FccCampaignContact" c JOIN "FccCampaignSend" s ON s."contactId" = c."id"
        WHERE s."sendDay" = ? AND c."status" = 'bounced' AND lower(COALESCE(s."senderAddress",'')) = ?)
    + (SELECT COUNT(DISTINCT c."id") FROM "OutreachContact" c JOIN "OutreachSend" s ON s."contactId" = c."id"
        WHERE s."sendDay" = ? AND s."kind" = 'real' AND c."status" = 'bounced' AND s."senderAddress" = ?) AS n`)
    .bind(day, inbox.fccKey, day, inbox.address).first<{ n: number }>())?.n ?? 0);
}

/** The inbox's settings row, if it has one. FCC uses it to respect a lowered limit. */
export async function inboxSetting(db: ProspectDb, address: string) {
  const row = await db.prepare(`SELECT "dailyMax","rampJson","rampFrom","enabled" FROM "OutreachInbox" WHERE "address" = ?`).bind(address.trim().toLowerCase())
    .first<{ dailyMax: number; rampJson: string; rampFrom: string | null; enabled: number }>();
  if (!row) return null;
  let ramp: number[] = [];
  try { ramp = JSON.parse(row.rampJson) as number[]; } catch { return { dailyMax: 0, ramp: [], rampFrom: null, enabled: false }; }
  if (!Array.isArray(ramp) || !ramp.every((value) => Number.isInteger(value) && value >= 0)) return { dailyMax: 0, ramp: [], rampFrom: null, enabled: false };
  return { dailyMax: row.dailyMax, ramp, rampFrom: row.rampFrom, enabled: row.enabled === 1 };
}
