import type { CallerActor } from '../revenue-engine/caller-integration';
import type { CallerDb } from './database';
import { parseResultEvent, type ResultEvent, type Receipt } from './protocol';
import { canonicalJson, resultPayloadHash } from './canonical-json';
import { CallerError, ENGINE_WORKSPACE, assertEngineSource, engineContactId } from './identity';
import { engineActivity } from './outcomes';

type Stored = { eventId: string; attemptId: string; actorUserId: string; payloadHash: string; recordId: string; receivedAt: string; payloadJson: string };
const receipt = (row: Stored, status: Receipt['status']): Receipt => ({ protocol: 'axiom-caller/2', eventId: row.eventId, attemptId: row.attemptId, payloadHash: row.payloadHash, recordId: row.recordId, receivedAt: row.receivedAt, status });
const read = (db: CallerDb, eventId: string) => db.prepare('SELECT * FROM CallerResult WHERE workspaceId=? AND eventId=?').bind(ENGINE_WORKSPACE, eventId).first<Stored>();

export async function getEngineReceipt(db: CallerDb, actor: CallerActor, eventId: string): Promise<Receipt | null> {
  const row = await read(db, eventId);
  return row?.actorUserId === actor.actorUserId ? receipt(row, 'already_saved') : null;
}

export async function recordEngineResult(db: CallerDb, actor: CallerActor, input: ResultEvent): Promise<Receipt> {
  const event = parseResultEvent(input); assertEngineSource(event.source);
  if (event.purpose === 'client_opportunity' || event.contactId !== await engineContactId(event.source.entityId)) throw new CallerError('NOT_FOUND', 404);
  const hash = await resultPayloadHash(actor.actorUserId, ENGINE_WORKSPACE, event);
  const replay = (row: Stored) => {
    if (row.actorUserId !== actor.actorUserId || row.payloadHash !== hash) throw new CallerError('IDEMPOTENCY_CONFLICT');
    return receipt(row, 'already_saved');
  };
  const previous = await read(db, event.eventId); if (previous) return replay(previous);
  const prospect = await db.prepare('SELECT prospectId FROM EngineProspect WHERE prospectId=?').bind(event.source.entityId).first();
  if (!prospect) throw new CallerError('NOT_FOUND', 404);
  const attempt = await db.prepare('SELECT * FROM CallerAttempt WHERE workspaceId=? AND attemptId=?').bind(ENGINE_WORKSPACE, event.attemptId).first<{ ownerId: string; sourceEntityId: string; sourceRevision: string; contactKey: string }>();
  if (!attempt || attempt.ownerId !== actor.actorUserId || attempt.sourceEntityId !== event.source.entityId || attempt.sourceRevision !== event.sourceRevision) throw new CallerError('CLAIM_REQUIRED');
  if (event.correctionOf) {
    const parent = await read(db, event.correctionOf);
    if (!parent || parent.actorUserId !== actor.actorUserId || parent.attemptId !== event.attemptId) throw new CallerError('REVISION_CONFLICT');
    const original = parseResultEvent(JSON.parse(parent.payloadJson));
    if (original.contactId !== event.contactId || canonicalJson(original.source) !== canonicalJson(event.source) || original.purpose !== event.purpose || original.occurredAt !== event.occurredAt) throw new CallerError('REVISION_CONFLICT');
    const child = await db.prepare('SELECT eventId FROM CallerResult WHERE workspaceId=? AND correctionOf=?').bind(ENGINE_WORKSPACE, event.correctionOf).first();
    if (child) throw new CallerError('REVISION_CONFLICT');
  }
  const now = new Date().toISOString(), recordId = 'caller-' + event.eventId, activity = engineActivity(event);
  const statements = [
    db.prepare(`INSERT INTO CallerResult(workspaceId,eventId,attemptId,actorUserId,actor,sourceEntityId,contactId,payloadHash,payloadJson,recordId,occurredAt,receivedAt,outcome,attempted,connectedAt,correctionOf) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(ENGINE_WORKSPACE, event.eventId, event.attemptId, actor.actorUserId, actor.actor, event.source.entityId, event.contactId, hash, canonicalJson(event), recordId, event.occurredAt, now, event.outcome, event.attempted === null ? null : Number(event.attempted), event.connectedAt, event.correctionOf),
    db.prepare(`INSERT INTO EngineProspectActivity(activityId,idempotencyKey,prospectId,channel,outcome,note,followUpAt,actor,actorUserId,createdAt,callerEventId,callerAttemptId,occurredAt,callerOutcome,callerAttempted,callerConnected) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(recordId, event.eventId, event.source.entityId, activity.channel, activity.outcome, activity.note, activity.followUpAt, actor.actor, actor.actorUserId, now, event.eventId, event.attemptId, event.occurredAt, event.outcome, event.attempted === null ? null : Number(event.attempted), Number(event.connectedAt !== null)),
  ];
  if (event.stopScope === 'contact') statements.push(db.prepare(`INSERT INTO CallerContactControl(workspaceId,contactKey,sourceEntityId,stopped,stopRevision,stopReason,stoppedAt,stoppedBy,revision) VALUES(?,?,?,1,1,?,?,?,1) ON CONFLICT(workspaceId,contactKey) DO UPDATE SET sourceEntityId=COALESCE(CallerContactControl.sourceEntityId,excluded.sourceEntityId),stopped=1,stopRevision=stopRevision+1,stopReason=excluded.stopReason,stoppedAt=excluded.stoppedAt,stoppedBy=excluded.stoppedBy,revision=revision+1`)
    .bind(ENGINE_WORKSPACE, attempt.contactKey, event.source.entityId, 'operator_do_not_contact', now, actor.actorUserId));
  if (!event.correctionOf) statements.push(
    db.prepare(`UPDATE CallerAttempt SET phase='closed',closedAt=?,resolution='result_saved' WHERE workspaceId=? AND attemptId=?`).bind(now, ENGINE_WORKSPACE, event.attemptId),
    db.prepare(`UPDATE CallerContactControl SET phase='closed',leaseUntil=?,revision=revision+1 WHERE workspaceId=? AND contactKey=? AND attemptId=? AND ownerId=?`).bind(now, ENGINE_WORKSPACE, attempt.contactKey, event.attemptId, actor.actorUserId),
  );
  try { await db.batch(statements); }
  catch (error) {
    const existing = await read(db, event.eventId); if (existing) return replay(existing);
    if (event.correctionOf && await db.prepare('SELECT eventId FROM CallerResult WHERE workspaceId=? AND correctionOf=?').bind(ENGINE_WORKSPACE, event.correctionOf).first()) throw new CallerError('REVISION_CONFLICT');
    if (!event.correctionOf && await db.prepare('SELECT eventId FROM CallerResult WHERE workspaceId=? AND attemptId=? AND correctionOf IS NULL').bind(ENGINE_WORKSPACE, event.attemptId).first()) throw new CallerError('IDEMPOTENCY_CONFLICT');
    throw error;
  }
  return receipt({ eventId: event.eventId, attemptId: event.attemptId, actorUserId: actor.actorUserId, payloadHash: hash, recordId, receivedAt: now, payloadJson: canonicalJson(event) }, 'saved');
}

export async function callerResultStats(db: CallerDb, since: string) {
  const row = await db.prepare(`SELECT SUM(attempted=1) attempts,SUM(connectedAt IS NOT NULL) conversations,SUM(outcome='meeting_requested') meetingRequested,SUM(outcome='meeting_booked') meetingBooked FROM CallerResult r WHERE workspaceId=? AND occurredAt>=? AND NOT EXISTS(SELECT 1 FROM CallerResult c WHERE c.workspaceId=r.workspaceId AND c.correctionOf=r.eventId)`)
    .bind(ENGINE_WORKSPACE, since).first<Record<string, number | null>>();
  return { attempts: Number(row?.attempts ?? 0), conversations: Number(row?.conversations ?? 0), meetingRequested: Number(row?.meetingRequested ?? 0), meetingBooked: Number(row?.meetingBooked ?? 0) };
}
