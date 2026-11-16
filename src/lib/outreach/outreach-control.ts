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

/**
 * A named approver opens a waiting batch for its words: the batch's own (every batch loaded since Nov 5 has them),
 * or the campaign's for an older batch.
 */
export async function approveBatch(db: ProspectDb, batchId: string, by: string, note: string | null, now = new Date()): Promise<ApproveResult> {
  const batch = await db.prepare(`SELECT "id","campaignKey","status","ready","wordsVersion" FROM "OutreachBatch" WHERE "id" = ?`).bind(batchId)
    .first<{ id: string; campaignKey: string; status: string; ready: number; wordsVersion: string | null }>();
  if (!batch) return { ok: false, why: "There's no such batch." };
  const campaign = await readCampaign(db, batch.campaignKey);
  if (!campaign) return { ok: false, why: "The batch's campaign is missing." };
  if (!campaign.approvers.includes(by)) return { ok: false, why: `Only ${campaign.approvers.join(" or ") || "a named founder"} can approve this campaign's batches.` };
  const words = batch.wordsVersion ?? campaign.wordsVersion;
  if (!words) return { ok: false, why: "This batch has no email words." };
  if (batch.status === "stopped") return { ok: false, why: "This batch was stopped." };
  const result = await db.prepare(`UPDATE "OutreachBatch" SET "status" = 'approved', "approvedBy" = ?, "approvedAt" = ?, "approvedWords" = ?, "approvalNote" = ?
    WHERE "id" = ? AND ("status" = 'waiting' OR ("status" = 'approved' AND COALESCE("approvedWords",'') <> ?))`)
    .bind(by.slice(0, 120), now.toISOString(), words, note?.slice(0, 300) ?? null, batchId, words).run();
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

// ---------- holding rows back, and a new campaign (the Claude connector's controls, ADR 0062) ----------

/** How every hold made here starts, so only these holds can be taken back by releaseContacts. */
export const FOUNDER_HOLD = "Held by";
/** The most addresses one hold or release takes (one statement, inside D1's limit of bound values). */
export const MAX_HOLD_ADDRESSES = 80;

const cleanAddresses = (emails: string[]) => [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_HOLD_ADDRESSES);

async function recount(db: ProspectDb, batchId: string) {
  await db.prepare(`UPDATE "OutreachBatch" SET "ready" = (SELECT COUNT(*) FROM "OutreachContact" WHERE "batchId" = ? AND "status" = 'ready'),
    "held" = (SELECT COUNT(*) FROM "OutreachContact" WHERE "batchId" = ? AND "status" = 'held') WHERE "id" = ?`).bind(batchId, batchId, batchId).run();
}

/**
 * Holds rows of one batch back: people who were never emailed and still wait for their first email. A held
 * row is never sent. Rows already emailed, replied, bounced or held are left alone. Returns how many it held.
 */
export async function holdContacts(db: ProspectDb, batchId: string, emails: string[], reason: string, by: string, now = new Date()) {
  const addresses = cleanAddresses(emails);
  if (addresses.length === 0) return 0;
  const why = `${FOUNDER_HOLD} ${by.slice(0, 80)}: ${reason.trim()}`.slice(0, 300);
  const result = await db.prepare(`UPDATE "OutreachContact" SET "status" = 'held', "holdReason" = ?, "updatedAt" = ?
    WHERE "batchId" = ? AND "status" = 'ready' AND "stepsSent" = 0 AND "email" IN (${addresses.map(() => "?").join(",")})`)
    .bind(why, now.toISOString(), batchId, ...addresses).run();
  const held = changes(result);
  if (held > 0) await recount(db, batchId);
  return held;
}

/** Takes back holds made by holdContacts, and only those: a row the list check held stays held. */
export async function releaseContacts(db: ProspectDb, batchId: string, emails: string[], now = new Date()) {
  const addresses = cleanAddresses(emails);
  if (addresses.length === 0) return 0;
  const result = await db.prepare(`UPDATE "OutreachContact" SET "status" = 'ready', "holdReason" = NULL, "updatedAt" = ?
    WHERE "batchId" = ? AND "status" = 'held' AND "stepsSent" = 0 AND "holdReason" LIKE ? AND "email" IN (${addresses.map(() => "?").join(",")})`)
    .bind(now.toISOString(), batchId, `${FOUNDER_HOLD} %`, ...addresses).run();
  const released = changes(result);
  if (released > 0) await recount(db, batchId);
  return released;
}

export type NewCampaign = {
  key: string; name: string;
  /** The founder whose sending inbox sends it: the switched-on inbox the engine already has under their name. */
  founder: string;
  /** Most emails a day, follow-ups included. Never more than the inbox's own daily limit. */
  dailyLimit: number;
  followUps: number; followUpBusinessDays: number;
  approvers: string[]; successLabel?: string | null; note?: string | null;
};
export type NewCampaignResult = { ok: true; inbox: string } | { ok: false; why: string };

/**
 * A new campaign, always paused and with no words: it can't send until a list is loaded with its words, a
 * named approver approves the batch and a founder resumes it. It uses the founder's own sending inbox, one the
 * engine already has, and stays inside that inbox's daily limit; every other setting is the table's default
 * (weekdays, 9:00 to 2:30).
 */
export async function createCampaign(db: ProspectDb, input: NewCampaign, by: string, now = new Date()): Promise<NewCampaignResult> {
  if (await readCampaign(db, input.key)) return { ok: false, why: "There is already a campaign with that key." };
  // A sending inbox belongs to the founder its name starts with ("Riley Hinsperger"), as on the Inboxes screen.
  const { results } = await db.prepare(`SELECT "address","name","dailyMax","enabled" FROM "OutreachInbox" ORDER BY "createdAt","address"`).bind()
    .all<{ address: string; name: string; dailyMax: number; enabled: number }>();
  const inbox = results.find((row) => row.enabled === 1 && row.name.trim().split(/\s+/)[0] === input.founder);
  if (!inbox) return { ok: false, why: `${input.founder} has no sending inbox switched on in the engine.` };
  const address = inbox.address.trim().toLowerCase();
  if (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 1) return { ok: false, why: "The daily limit must be at least 1." };
  if (input.dailyLimit > inbox.dailyMax) return { ok: false, why: `The daily limit can't be more than the inbox's own limit of ${inbox.dailyMax} a day.` };
  if (input.approvers.length === 0) return { ok: false, why: "A campaign needs at least one approver." };
  const rules = input.successLabel?.trim() ? { successLabel: input.successLabel.trim().slice(0, 40) } : {};
  const at = now.toISOString();
  await db.prepare(`INSERT INTO "OutreachCampaign" ("key","name","state","stateReason","stateBy","stateAt","dailyLimit","inboxesJson","followUps","followUpBusinessDays","rulesJson","approversJson","note","createdAt","updatedAt")
    VALUES (?,?,'paused',?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(input.key, input.name.trim().slice(0, 80), "New campaign: not started yet", by.slice(0, 120), at, input.dailyLimit, JSON.stringify([{ address, perDay: input.dailyLimit }]),
      input.followUps, input.followUpBusinessDays, JSON.stringify(rules), JSON.stringify(input.approvers), input.note?.trim().slice(0, 1000) || null, at, at).run();
  return { ok: true, inbox: address };
}
