/**
 * FCC campaign pause and resume. The switch itself is FccCampaignSetting.enabled.
 * Who paused it, why, and the sender's latest note live in KvStore so the FCC
 * screen can say it in plain English. Pausing is always allowed. Resuming only
 * reopens a campaign a founder already gave the go on for the current copy.
 * Nothing here reads or changes the retired outreach switches.
 */
import { FCC_COPY_VERSION } from "@/lib/fcc-campaign";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

const CONTROL_KEY = "fcc.control";
const RUN_KEY = "fcc.lastRun";
const BATCH_NAMES_KEY = "fcc.batchNames";

export type FccControlNote = { action: "paused" | "resumed"; reason: string | null; by: string; at: string };
export type FccRunNote = { note: string; at: string };
export type FccResumeResult = "RESUMED" | "ALREADY_LIVE" | "LOCKED";

const changes = (result: unknown) => {
  const r = result as { changes?: number; meta?: { changes?: number } };
  return r.meta?.changes ?? r.changes ?? 0;
};

async function put(db: ProspectDb, key: string, value: unknown, now: Date) {
  await db.prepare(`INSERT INTO "KvStore" ("key","value","updatedAt") VALUES (?,?,?)
    ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"`)
    .bind(key, JSON.stringify(value), now.toISOString()).run();
}

async function get<T>(db: ProspectDb, key: string): Promise<T | null> {
  const row = await db.prepare(`SELECT "value" FROM "KvStore" WHERE "key" = ?`).bind(key).first<{ value: string }>();
  if (!row) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}

/** Stops FCC sending. Returns false when it was already stopped (the first reason is kept). */
export async function pauseFcc(db: ProspectDb, reason: string, by: string, now = new Date()) {
  const result = await db.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 0, "updatedAt" = ? WHERE "id" = 1 AND "enabled" = 1`)
    .bind(now.toISOString()).run();
  if (changes(result) !== 1) return false;
  await put(db, CONTROL_KEY, { action: "paused", reason: reason.slice(0, 300), by: by.slice(0, 120), at: now.toISOString() } satisfies FccControlNote, now);
  return true;
}

/** Restarts FCC sending, but only for the copy a founder already gave the go on. */
export async function resumeFcc(db: ProspectDb, by: string, now = new Date()): Promise<FccResumeResult> {
  const result = await db.prepare(`UPDATE "FccCampaignSetting" SET "enabled" = 1, "updatedAt" = ?
    WHERE "id" = 1 AND "enabled" = 0 AND "approvedCopy" = ? AND "goBy" IS NOT NULL`).bind(now.toISOString(), FCC_COPY_VERSION).run();
  if (changes(result) === 1) {
    await put(db, CONTROL_KEY, { action: "resumed", reason: null, by: by.slice(0, 120), at: now.toISOString() } satisfies FccControlNote, now);
    return "RESUMED";
  }
  const setting = await db.prepare(`SELECT "enabled","approvedCopy","goBy" FROM "FccCampaignSetting" WHERE "id" = 1`).bind()
    .first<{ enabled: number; approvedCopy: string | null; goBy: string | null }>();
  return setting?.enabled === 1 && setting.approvedCopy === FCC_COPY_VERSION && setting.goBy ? "ALREADY_LIVE" : "LOCKED";
}

const BOUNCE_SCAN_KEY = "fcc.bounceScan";

/** How many bounce messages the sender had already matched to contacts on `day`. */
export async function readFccBounceScan(db: ProspectDb) {
  return get<{ day: string; count: number }>(db, BOUNCE_SCAN_KEY);
}

export async function saveFccBounceScan(db: ProspectDb, day: string, count: number, now = new Date()) {
  await put(db, BOUNCE_SCAN_KEY, { day, count }, now);
}

/** The sender's latest note, shown on the FCC screen. */
export async function noteFccRun(db: ProspectDb, note: string, now = new Date()) {
  await put(db, RUN_KEY, { note: note.slice(0, 300), at: now.toISOString() } satisfies FccRunNote, now);
}

export async function readFccNotes(db: ProspectDb) {
  return {
    control: await get<FccControlNote>(db, CONTROL_KEY),
    lastRun: await get<FccRunNote>(db, RUN_KEY),
    /** Import time (a contact's createdAt) to a batch name, e.g. "Batch 2". */
    batchNames: (await get<Record<string, string>>(db, BATCH_NAMES_KEY)) ?? {},
  };
}
