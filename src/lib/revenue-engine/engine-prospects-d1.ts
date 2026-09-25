import { z } from "zod";

/** Minimal D1 surface used here (real D1 in Workers, better-sqlite3 adapter in tests). */
export type ProspectDb = {
  prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> } };
};

export const PROSPECT_OUTCOMES = [
  "NO_ANSWER", "VOICEMAIL", "GATEKEEPER", "CALL_BACK", "NOT_INTERESTED", "INTERESTED", "MEETING_BOOKED", "WON", "WRONG_NUMBER", "DO_NOT_CONTACT", "NOTE",
] as const;
export type ProspectOutcome = (typeof PROSPECT_OUTCOMES)[number];
export const ProspectViewSchema = z.enum(["call", "visit", "followups", "contacted", "all"]);
export type ProspectView = z.infer<typeof ProspectViewSchema>;

export const ProspectActivityCommandSchema = z.object({
  idempotencyKey: z.string().uuid(),
  prospectId: z.string().min(1).max(300),
  channel: z.enum(["CALL", "VISIT", "EMAIL", "NOTE"]),
  outcome: z.enum(PROSPECT_OUTCOMES),
  note: z.string().max(1000),
  followUpAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).strict();
export type ProspectActivityCommand = z.infer<typeof ProspectActivityCommandSchema>;

export type ProspectRow = {
  prospectId: string; placeId: string | null; name: string; city: string; niche: string;
  websiteUrl: string | null; phone: string | null; address: string | null; label: "STRONG" | "WEAK" | "NO_WEBSITE";
  reasons: string[]; lastSeenAt: string;
  lastOutcome: ProspectOutcome | null; lastCallerOutcome?: string | null; lastActivityAt: string | null; lastActor: string | null; followUpAt: string | null; attempts: number;
};
export type ProspectActivity = {
  activityId: string; channel: string; outcome: ProspectOutcome; callerOutcome?: string | null; note: string; followUpAt: string | null; actor: string; createdAt: string;
};

export const PROSPECT_LATEST_SQL = `
  SELECT p.*,
    (SELECT a."outcome" FROM "EngineProspectActivityCurrent" a WHERE a."prospectId"=p."prospectId" ORDER BY a.effectiveAt DESC, a.activityRowId DESC LIMIT 1) AS lastOutcome,
    (SELECT a."callerOutcome" FROM "EngineProspectActivityCurrent" a WHERE a."prospectId"=p."prospectId" ORDER BY a.effectiveAt DESC, a.activityRowId DESC LIMIT 1) AS lastCallerOutcome,
    (SELECT a.effectiveAt FROM "EngineProspectActivityCurrent" a WHERE a."prospectId"=p."prospectId" AND (a.callerAttempted IS NULL OR a.callerAttempted<>0) ORDER BY a.effectiveAt DESC, a.activityRowId DESC LIMIT 1) AS lastActivityAt,
    (SELECT a."actor" FROM "EngineProspectActivityCurrent" a WHERE a."prospectId"=p."prospectId" ORDER BY a.effectiveAt DESC, a.activityRowId DESC LIMIT 1) AS lastActor,
    (SELECT a."followUpAt" FROM "EngineProspectActivityCurrent" a WHERE a."prospectId"=p."prospectId" ORDER BY a.effectiveAt DESC, a.activityRowId DESC LIMIT 1) AS followUpAt,
    (SELECT COUNT(*) FROM "EngineProspectActivityCurrent" a WHERE a."prospectId"=p."prospectId" AND a."channel" IN ('CALL','VISIT','EMAIL')) AS attempts,
    (EXISTS (SELECT 1 FROM "EngineProspectActivity" a WHERE a."prospectId"=p."prospectId" AND a."outcome"='DO_NOT_CONTACT')
      OR EXISTS (SELECT 1 FROM CallerContactControl c WHERE c.workspaceId='axiom' AND c.sourceEntityId=p.prospectId AND c.stopped=1)) AS stopped
  FROM "EngineProspect" p`;
const LATEST = PROSPECT_LATEST_SQL;

const CLOSED = `('NOT_INTERESTED','WON','WRONG_NUMBER','DO_NOT_CONTACT','MEETING_BOOKED')`;

function parseRow(row: Record<string, unknown>): ProspectRow {
  let reasons: string[] = [];
  try { reasons = JSON.parse(String(row.reasons)) as string[]; } catch { reasons = []; }
  return {
    prospectId: String(row.prospectId), placeId: (row.placeId as string | null) ?? null, name: String(row.name), city: String(row.city), niche: String(row.niche),
    websiteUrl: (row.websiteUrl as string | null) ?? null, phone: (row.phone as string | null) ?? null, address: (row.address as string | null) ?? null,
    label: row.label as ProspectRow["label"], reasons, lastSeenAt: String(row.lastSeenAt),
    lastOutcome: (row.lastOutcome as ProspectOutcome | null) ?? null, lastActivityAt: (row.lastActivityAt as string | null) ?? null,
    lastCallerOutcome: (row.lastCallerOutcome as string | null) ?? null,
    lastActor: (row.lastActor as string | null) ?? null, followUpAt: (row.followUpAt as string | null) ?? null, attempts: Number(row.attempts ?? 0),
  };
}

/** Owner views. Call/visit lists hide stopped and closed businesses; STRONG and no-website leads first. */
export async function listProspects(db: ProspectDb, view: ProspectView, today: string, limit = 300): Promise<ProspectRow[]> {
  const where: Record<ProspectView, string> = {
    call: `stopped = 0 AND label IN ('STRONG','NO_WEBSITE') AND (lastOutcome IS NULL OR lastOutcome NOT IN ${CLOSED}) AND (followUpAt IS NULL OR followUpAt <= ?)`,
    visit: `stopped = 0 AND label IN ('STRONG','NO_WEBSITE') AND address IS NOT NULL AND (lastOutcome IS NULL OR lastOutcome NOT IN ${CLOSED})`,
    followups: `stopped = 0 AND followUpAt IS NOT NULL AND followUpAt <= ? AND (lastOutcome IS NULL OR lastOutcome NOT IN ${CLOSED})`,
    contacted: `attempts > 0`,
    all: `1 = 1`,
  };
  const order = view === "contacted" ? `lastActivityAt DESC` : `CASE label WHEN 'STRONG' THEN 0 WHEN 'NO_WEBSITE' THEN 1 ELSE 2 END, attempts ASC, city, name`;
  const result = await db.prepare(`SELECT * FROM (${LATEST}) WHERE ${where[view]} ORDER BY ${order} LIMIT ${Math.max(1, Math.min(limit, 1000))}`)
    .bind(...Array.from({ length: (where[view].match(/\?/g) ?? []).length }, () => today)).all<Record<string, unknown>>();
  return result.results.map(parseRow);
}

/** All list counts in one pass. */
export async function prospectCounts(db: ProspectDb, today: string) {
  const row = await db.prepare(`SELECT
      SUM(stopped = 0 AND label IN ('STRONG','NO_WEBSITE') AND (lastOutcome IS NULL OR lastOutcome NOT IN ${CLOSED}) AND (followUpAt IS NULL OR followUpAt <= ?)) AS call,
      SUM(stopped = 0 AND label IN ('STRONG','NO_WEBSITE') AND address IS NOT NULL AND (lastOutcome IS NULL OR lastOutcome NOT IN ${CLOSED})) AS visit,
      SUM(stopped = 0 AND followUpAt IS NOT NULL AND followUpAt <= ? AND (lastOutcome IS NULL OR lastOutcome NOT IN ${CLOSED})) AS followups,
      SUM(attempts > 0) AS contacted,
      COUNT(*) AS total
    FROM (${LATEST})`).bind(today, today).first<Record<string, number | null>>();
  const n = (key: string) => Number(row?.[key] ?? 0);
  return { call: n("call"), visit: n("visit"), followups: n("followups"), contacted: n("contacted"), all: n("total") };
}

/**
 * The next business for the calling queue: callable, has a phone, not touched
 * since `dayStart`, follow-ups due first, then weakest websites and fewest tries.
 */
export async function nextInQueue(db: ProspectDb, today: string, dayStart: string, skip: readonly string[] = [], limit = 1, offset = 0): Promise<{ row: ProspectRow | null; rows: ProspectRow[]; remaining: number }> {
  const skipList = skip.slice(0, 200);
  const where = `stopped = 0 AND phone IS NOT NULL AND label IN ('STRONG','NO_WEBSITE')
    AND (lastOutcome IS NULL OR lastOutcome NOT IN ${CLOSED}) AND (followUpAt IS NULL OR followUpAt <= ?)
    AND (lastActivityAt IS NULL OR lastActivityAt < ?)${skipList.length ? ` AND prospectId NOT IN (${skipList.map(() => "?").join(",")})` : ""}`;
  const binds = [today, dayStart, ...skipList];
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT * FROM (${LATEST}) WHERE ${where} ORDER BY (followUpAt IS NULL), CASE label WHEN 'STRONG' THEN 0 ELSE 1 END, attempts ASC, city, name, prospectId LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))} OFFSET ${Math.max(0, Math.min(99999, Math.floor(offset)))}`).bind(...binds).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) AS n FROM (${LATEST}) WHERE ${where}`).bind(...binds).first<{ n: number }>(),
  ]);
  const parsed = rows.results.map(parseRow);
  return { row: parsed[0] ?? null, rows: parsed, remaining: Number(count?.n ?? 0) };
}

/** History for many businesses in one query (newest first per business). */
export async function listActivityFor(db: ProspectDb, prospectIds: readonly string[]): Promise<Map<string, ProspectActivity[]>> {
  const map = new Map<string, ProspectActivity[]>();
  for (let i = 0; i < prospectIds.length; i += 90) {
    const chunk = prospectIds.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await db.prepare(`SELECT "prospectId","activityId","channel","outcome","callerOutcome","note","followUpAt","actor",effectiveAt AS "createdAt" FROM "EngineProspectActivityCurrent"
      WHERE "prospectId" IN (${chunk.map(() => "?").join(",")}) ORDER BY effectiveAt DESC, activityRowId DESC`).bind(...chunk).all<ProspectActivity & { prospectId: string }>();
    for (const item of results) {
      const list = map.get(item.prospectId) ?? [];
      if (list.length < 20) list.push(item);
      map.set(item.prospectId, list);
    }
  }
  return map;
}

export async function listProspectActivity(db: ProspectDb, prospectId: string): Promise<ProspectActivity[]> {
  const result = await db.prepare(`SELECT "activityId","channel","outcome","callerOutcome","note","followUpAt","actor",effectiveAt AS "createdAt" FROM "EngineProspectActivityCurrent" WHERE "prospectId"=? ORDER BY effectiveAt DESC, activityRowId DESC LIMIT 50`)
    .bind(prospectId).all<ProspectActivity>();
  return result.results;
}

export class ProspectActivityError extends Error {
  constructor(readonly code: "NOT_FOUND" | "STOPPED" | "CONFLICT" | "CLAIM_REQUIRED") { super(code); }
}

/** Append one call/visit/note. Idempotent per key; a stopped business accepts notes only. */
export async function recordProspectActivity(db: ProspectDb, input: unknown, actor: "RILEY" | "AIDAN", actorUserId: string) {
  const command = ProspectActivityCommandSchema.parse(input);
  const existing = await db.prepare(`SELECT "activityId","prospectId","outcome","actor" FROM "EngineProspectActivity" WHERE "idempotencyKey"=?`).bind(command.idempotencyKey).first<Record<string, unknown>>();
  if (existing) {
    if (existing.prospectId !== command.prospectId || existing.outcome !== command.outcome || existing.actor !== actor) throw new ProspectActivityError("CONFLICT");
    return { status: "ALREADY_SAVED" as const, activityId: String(existing.activityId) };
  }
  const prospect = await db.prepare(`SELECT "prospectId" FROM "EngineProspect" WHERE "prospectId"=?`).bind(command.prospectId).first();
  if (!prospect) throw new ProspectActivityError("NOT_FOUND");
  const stopped = await db.prepare(`SELECT 1 AS s FROM "EngineProspectActivity" WHERE "prospectId"=? AND "outcome"='DO_NOT_CONTACT' LIMIT 1`).bind(command.prospectId).first();
  if (stopped && command.channel !== "NOTE") throw new ProspectActivityError("STOPPED");
  const activityId = `activity:${command.idempotencyKey}`;
  try {
    await db.prepare(`INSERT INTO "EngineProspectActivity" ("activityId","idempotencyKey","prospectId","channel","outcome","note","followUpAt","actor","actorUserId") VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(activityId, command.idempotencyKey, command.prospectId, command.channel, command.outcome, command.note.trim(), command.followUpAt, actor, actorUserId).run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('CALLER_STOPPED')) throw new ProspectActivityError('STOPPED');
    if (error instanceof Error && error.message.includes('CALLER_CLAIM_REQUIRED')) throw new ProspectActivityError('CLAIM_REQUIRED');
    throw error;
  }
  return { status: "SAVED" as const, activityId };
}

export type ProspectActivityStats = {
  byActor: Record<string, { calls: number; visits: number; conversations: number }>;
  interested: number; meetings: number; won: number; total: number;
};

/** Counts owner activity since a timestamp: calls, visits, real conversations and outcomes. */
export async function prospectActivityStats(db: ProspectDb, since: string): Promise<ProspectActivityStats> {
  const rows = (await db.prepare(`SELECT "actor","channel","outcome","callerConnected",COUNT(*) AS n FROM "EngineProspectActivityCurrent" WHERE effectiveAt >= ? GROUP BY "actor","channel","outcome","callerConnected"`)
    .bind(since).all<{ actor: string; channel: string; outcome: string; callerConnected: number | null; n: number }>()).results;
  const stats: ProspectActivityStats = { byActor: {}, interested: 0, meetings: 0, won: 0, total: 0 };
  const talked = new Set(["GATEKEEPER", "CALL_BACK", "NOT_INTERESTED", "INTERESTED", "MEETING_BOOKED", "WON", "DO_NOT_CONTACT"]);
  for (const row of rows) {
    const actor = (stats.byActor[row.actor] ??= { calls: 0, visits: 0, conversations: 0 });
    const n = Number(row.n);
    if (row.channel === "CALL") actor.calls += n;
    if (row.channel === "VISIT") actor.visits += n;
    if (row.callerConnected === 1 || (row.callerConnected === null && talked.has(row.outcome))) actor.conversations += n;
    if (row.outcome === "INTERESTED") stats.interested += n;
    if (row.outcome === "MEETING_BOOKED") stats.meetings += n;
    if (row.outcome === "WON") stats.won += n;
    if (row.channel !== "NOTE") stats.total += n;
  }
  return stats;
}
