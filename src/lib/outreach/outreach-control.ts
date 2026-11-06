/**
 * A campaign's switches: Pause and Resume (each campaign has its own), batch approval, and the
 * sender's latest note for the screen. Pausing is always allowed. Resuming needs usable settings and
 * words. Approving a batch needs one of the campaign's named approvers, and pins the words it was
 * approved on: changed words lock every batch again until someone approves it on the new words.
 */
import { readCampaign } from "@/lib/outreach/outreach-model";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

const changes = (result: unknown) => {
  const r = result as { changes?: number; meta?: { changes?: number } };
  return r.meta?.changes ?? r.changes ?? 0;
};

async function put(db: ProspectDb, key: string, value: unknown, now: Date) {
  await db.prepare(`INSERT INTO "KvStore" ("key","value","updatedAt") VALUES (?,?,?)
    ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"`)
    .bind(key, JSON.stringify(value), now.toISOString()).run();
}

export async function readKv<T>(db: ProspectDb, key: string): Promise<T | null> {
  const row = await db.prepare(`SELECT "value" FROM "KvStore" WHERE "key" = ?`).bind(key).first<{ value: string }>();
  if (!row) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}
export const writeKv = put;

/** Stops one campaign. False when it was already paused (the first reason is kept). */
export async function pauseCampaign(db: ProspectDb, key: string, reason: string, by: string, now = new Date()) {
  const result = await db.prepare(`UPDATE "OutreachCampaign" SET "state" = 'paused', "stateReason" = ?, "stateBy" = ?, "stateAt" = ?, "updatedAt" = ?
    WHERE "key" = ? AND "state" = 'live'`).bind(reason.slice(0, 300), by.slice(0, 120), now.toISOString(), now.toISOString(), key).run();
  return changes(result) === 1;
}

export type ResumeResult = "RESUMED" | "ALREADY_LIVE" | "NOT_READY" | "MISSING";

/** Starts one campaign again. It still sends only approved batches, on the words they were approved on. */
export async function resumeCampaign(db: ProspectDb, key: string, by: string, now = new Date()): Promise<{ result: ResumeResult; why?: string }> {
  const campaign = await readCampaign(db, key);
  if (!campaign) return { result: "MISSING" };
  if (campaign.state === "live") return { result: "ALREADY_LIVE" };
  if (campaign.problem) return { result: "NOT_READY", why: `its settings can't be used: ${campaign.problem}` };
  if (!campaign.words.steps[0]?.subject || !campaign.wordsVersion) return { result: "NOT_READY", why: "it has no email words yet" };
  if (campaign.inboxes.length === 0 || campaign.dailyLimit <= 0) return { result: "NOT_READY", why: "it has no inbox or no daily limit" };
  const result = await db.prepare(`UPDATE "OutreachCampaign" SET "state" = 'live', "stateReason" = NULL, "stateBy" = ?, "stateAt" = ?, "updatedAt" = ?
    WHERE "key" = ? AND "state" = 'paused'`).bind(by.slice(0, 120), now.toISOString(), now.toISOString(), key).run();
  return { result: changes(result) === 1 ? "RESUMED" : "ALREADY_LIVE" };
}

export type ApproveResult = { ok: true } | { ok: false; why: string };

/** A named approver opens a waiting batch for the campaign's current words. */
export async function approveBatch(db: ProspectDb, batchId: string, by: string, note: string | null, now = new Date()): Promise<ApproveResult> {
  const batch = await db.prepare(`SELECT "id","campaignKey","status","ready" FROM "OutreachBatch" WHERE "id" = ?`).bind(batchId)
    .first<{ id: string; campaignKey: string; status: string; ready: number }>();
  if (!batch) return { ok: false, why: "There's no such batch." };
  const campaign = await readCampaign(db, batch.campaignKey);
  if (!campaign) return { ok: false, why: "The batch's campaign is missing." };
  if (!campaign.approvers.includes(by)) return { ok: false, why: `Only ${campaign.approvers.join(" or ") || "a named founder"} can approve this campaign's batches.` };
  if (!campaign.wordsVersion) return { ok: false, why: "The campaign has no email words yet." };
  if (batch.status === "stopped") return { ok: false, why: "This batch was stopped." };
  const result = await db.prepare(`UPDATE "OutreachBatch" SET "status" = 'approved', "approvedBy" = ?, "approvedAt" = ?, "approvedWords" = ?, "approvalNote" = ?
    WHERE "id" = ? AND ("status" = 'waiting' OR ("status" = 'approved' AND COALESCE("approvedWords",'') <> ?))`)
    .bind(by.slice(0, 120), now.toISOString(), campaign.wordsVersion, note?.slice(0, 300) ?? null, batchId, campaign.wordsVersion).run();
  if (changes(result) !== 1) return { ok: false, why: "This batch is already approved for these words." };
  return { ok: true };
}

/** Takes a batch out of sending for good: its contacts that weren't emailed yet never will be. */
export async function stopBatch(db: ProspectDb, batchId: string, by: string, now = new Date()) {
  const result = await db.prepare(`UPDATE "OutreachBatch" SET "status" = 'stopped', "approvalNote" = ? WHERE "id" = ? AND "status" <> 'stopped'`)
    .bind(`Stopped by ${by.slice(0, 80)}, ${now.toISOString()}`, batchId).run();
  return changes(result) === 1;
}

export type RunNote = { note: string; at: string };
const runKey = (campaign: string) => `outreach.lastRun:${campaign}`;

export async function noteCampaignRun(db: ProspectDb, campaign: string, note: string, now = new Date()) {
  await put(db, runKey(campaign), { note: note.slice(0, 300), at: now.toISOString() } satisfies RunNote, now);
}

export async function readCampaignRun(db: ProspectDb, campaign: string) {
  return readKv<RunNote>(db, runKey(campaign));
}
