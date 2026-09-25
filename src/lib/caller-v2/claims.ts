import { planEngineStopDelivery } from './stop-projection';
import { z } from 'zod';
import {sourceRefSchema} from './protocol';
import {conversionHandoffReceiptSchema} from './conversion-contract';
import type { CallerActor } from '../revenue-engine/caller-integration';
import type { CallerDb, CallerStatement } from './database';
import { CallerError, ENGINE_WORKSPACE, engineContactId } from './identity';
import { readEngineCallSource, SOURCE_SNAPSHOT_SQL } from './source-state';

type Phase = 'reserved' | 'armed' | 'active' | 'uncertain' | 'closed';
type ClaimActor = Pick<CallerActor, 'actorUserId'>;
export type LinkedAuthorization = { linkId: string; linkRevision: number; originSourceJson: string | null; originActorId: string | null; sourceRevision: string };
export type Claim = { attemptId: string; ownerId: string; contactKey: string; revision: number; expiresAt: string; state: Phase };
type Control = { contactKey: string; stopped: number; ownerId: string | null; attemptId: string | null; phase: Phase; leaseUntil: string | null; revision: number };
type Attempt = { attemptId: string; contactKey: string; sourceEntityId: string; sourceRevision: string; ownerId: string; phase: Phase; firstArmedAt: string | null; resolution: string | null; linkId: string | null; originSourceJson: string | null; originActorId: string | null };
const commandSchema = z.object({ contactKey: z.string().regex(/^ec-[a-f0-9]{64}$/), entityId: z.string().min(1).max(300), attemptId: z.uuid(), sourceRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const iso = (now: number) => new Date(now).toISOString();
const readControl = (db: CallerDb, key: string) => db.prepare('SELECT * FROM CallerContactControl WHERE workspaceId=? AND contactKey=?').bind(ENGINE_WORKSPACE, key).first<Control>();
const readAttempt = (db: CallerDb, id: string) => db.prepare('SELECT * FROM CallerAttempt WHERE workspaceId=? AND attemptId=?').bind(ENGINE_WORKSPACE, id).first<Attempt>();
const view = (row: Control): Claim => ({ attemptId: row.attemptId!, ownerId: row.ownerId!, contactKey: row.contactKey, revision: row.revision, expiresAt: row.leaseUntil!, state: row.phase });

// A failed compare must abort the whole D1 batch, including the attempt write.
// revision is NOT NULL; a failed predicate deliberately violates that constraint.
// On conflict the existing revision is retained until the following mutation.
export function contactGuard(db: CallerDb, key: string, revision: number, source?: { entityId: string; snapshot: string; linked?: LinkedAuthorization }): CallerStatement {
  return db.prepare(`INSERT INTO CallerContactControl(workspaceId,contactKey,revision)
    VALUES(?,?,CASE WHEN COALESCE((SELECT revision FROM CallerContactControl WHERE workspaceId=? AND contactKey=?),-1)=?
      ${source ? `AND (${SOURCE_SNAPSHOT_SQL})=? AND ${source.linked ? "EXISTS(SELECT 1 FROM CallerSourceLink WHERE workspaceId=? AND engineContactKey=? AND linkId=? AND state='active' AND revision=?)" : 'NOT EXISTS(SELECT 1 FROM CallerSourceLink WHERE workspaceId=? AND engineContactKey=?)'}` : ''} THEN 0 ELSE NULL END)
    ON CONFLICT(workspaceId,contactKey) DO UPDATE SET revision=CallerContactControl.revision`)
    .bind(ENGINE_WORKSPACE, key, ENGINE_WORKSPACE, key, revision, ...(source ? [source.entityId, source.snapshot, ENGINE_WORKSPACE, key, ...(source.linked ? [source.linked.linkId, source.linked.linkRevision] : [])] : []));
}
function isGuardFailure(error: unknown) { return error instanceof Error && /NOT NULL constraint failed: CallerContactControl.revision/.test(error.message); }

async function expirePotentialCall(db: CallerDb, key: string, now: number) {
  const selection = `SELECT attemptId FROM CallerContactControl WHERE workspaceId=? AND contactKey=? AND phase IN ('armed','active') AND leaseUntil<=?`;
  await db.batch([
    db.prepare(`UPDATE CallerAttempt SET phase='uncertain' WHERE workspaceId=? AND attemptId IN (${selection})`).bind(ENGINE_WORKSPACE, ENGINE_WORKSPACE, key, iso(now)),
    db.prepare(`UPDATE CallerContactControl SET phase='uncertain',revision=revision+1 WHERE workspaceId=? AND contactKey=? AND phase IN ('armed','active') AND leaseUntil<=?`).bind(ENGINE_WORKSPACE, key, iso(now)),
  ]);
}

/** Conversion closes acquisition. A current Orbit client/opportunity check can authorize its own relationship purpose. */
async function callableForClaim(db:CallerDb,state:Awaited<ReturnType<typeof readEngineCallSource>>,linked?:LinkedAuthorization){
  if(state.callable)return true;
  if(!linked?.originSourceJson||state.source.conversion?.status!=='completed'||state.source.stopped||!state.source.phone?.trim()||state.source.lastOutcome==='WRONG_NUMBER')return false;
  const origin=sourceRefSchema.parse(JSON.parse(linked.originSourceJson));
  if(origin.system!=='orbit'||origin.entityType==='prospect')return false;
  const row=await db.prepare(`SELECT j.receiptJson,l.identityJson FROM CallerConversionJob j JOIN CallerSourceLink l
    ON l.workspaceId=j.workspaceId AND l.engineContactKey=j.contactKey AND l.grantId=j.grantId
    WHERE j.workspaceId=? AND j.conversionId=? AND j.status='completed' AND l.linkId=? AND l.state='active' AND l.revision=?`)
    .bind(ENGINE_WORKSPACE,state.source.conversion.id,linked.linkId,linked.linkRevision).first<{receiptJson:string;identityJson:string}>();
  if(!row)return false;
  const receipt=conversionHandoffReceiptSchema.parse(JSON.parse(row.receiptJson)),identity=JSON.parse(row.identityJson) as {orbitRef:{workspaceId:string;connectionId:string};orbitContactId:string};
  return receipt.status==='completed'&&receipt.linkId===linked.linkId&&receipt.orbitContactId===identity.orbitContactId&&origin.workspaceId===identity.orbitRef.workspaceId&&origin.connectionId===identity.orbitRef.connectionId
    &&(origin.entityType==='opportunity'||origin.entityId===receipt.clientId);
}

export async function claimContact(db: CallerDb, actor: ClaimActor, input: z.input<typeof commandSchema>, now = Date.now(), linked?: LinkedAuthorization): Promise<Claim> {
  const command = commandSchema.parse(input);
  if (command.contactKey !== await engineContactId(command.entityId)) throw new CallerError('NOT_FOUND', 404);
  const link = await db.prepare('SELECT linkId,revision,state FROM CallerSourceLink WHERE workspaceId=? AND engineContactKey=?').bind(ENGINE_WORKSPACE, command.contactKey).first<{linkId:string;revision:number;state:string}>();
  if (link && (!linked || link.linkId !== linked.linkId || link.revision !== linked.linkRevision || link.state !== 'active')) throw new CallerError('LINK_CHECK_REQUIRED');
  if (linked && (!link || linked.sourceRevision !== command.sourceRevision)) throw new CallerError('REVISION_CONFLICT');
  await expirePotentialCall(db, command.contactKey, now);
  const current = await readControl(db, command.contactKey);
  if (current?.stopped) throw new CallerError('STOPPED');
  const source = await readEngineCallSource(db, command.entityId, now);
  if (!linked?.originSourceJson && source.revision !== command.sourceRevision) throw new CallerError('REVISION_CONFLICT');
  if (!await callableForClaim(db,source,linked)) throw new CallerError('STOPPED');
  if (current?.phase === 'uncertain') throw new CallerError('CLAIM_UNCERTAIN');
  const previous = await readAttempt(db, command.attemptId);
  if (previous) {
    if (previous.ownerId !== actor.actorUserId || previous.sourceEntityId !== command.entityId || previous.sourceRevision !== command.sourceRevision || previous.linkId !== (linked?.linkId ?? null) || previous.originSourceJson !== (linked?.originSourceJson ?? null) || previous.originActorId !== (linked?.originActorId ?? null)) throw new CallerError('REVISION_CONFLICT');
    const replay = await readControl(db, command.contactKey);
    if (replay?.stopped) throw new CallerError('STOPPED');
    if (replay?.phase === 'uncertain') throw new CallerError('CLAIM_UNCERTAIN');
    if (replay?.attemptId === command.attemptId && replay.ownerId === actor.actorUserId && replay.phase !== 'closed' && replay.leaseUntil! > iso(now)) return view(replay);
    throw new CallerError('REVISION_CONFLICT');
  }
  if (current && current.phase !== 'closed' && (current.phase !== 'reserved' || current.leaseUntil! > iso(now))) throw new CallerError('CLAIM_HELD');
  if (current?.attemptId && current.phase === 'reserved' && (await readAttempt(db, current.attemptId))?.firstArmedAt) throw new CallerError('CLAIM_UNCERTAIN');
  const expiresAt = iso(now + 120_000);
  try {
    await db.batch([
      contactGuard(db, command.contactKey, current?.revision ?? -1, { entityId: command.entityId, snapshot: source.snapshot, linked }),
      db.prepare(`UPDATE CallerAttempt SET phase='closed',closedAt=? WHERE workspaceId=? AND attemptId=? AND phase='reserved' AND firstArmedAt IS NULL`).bind(iso(now), ENGINE_WORKSPACE, current?.attemptId ?? ''),
      db.prepare(`INSERT INTO CallerAttempt(workspaceId,attemptId,contactKey,sourceEntityId,sourceRevision,ownerId,linkId,originSourceJson,originActorId,phase,createdAt) VALUES(?,?,?,?,?,?,?,?,?,'reserved',?)`).bind(ENGINE_WORKSPACE, command.attemptId, command.contactKey, command.entityId, command.sourceRevision, actor.actorUserId, linked?.linkId ?? null, linked?.originSourceJson ?? null, linked?.originActorId ?? null, iso(now)),
      db.prepare(`UPDATE CallerContactControl SET sourceEntityId=?,ownerId=?,attemptId=?,phase='reserved',leaseUntil=?,revision=revision+1 WHERE workspaceId=? AND contactKey=?`).bind(command.entityId, actor.actorUserId, command.attemptId, expiresAt, ENGINE_WORKSPACE, command.contactKey),
    ]);
  } catch (error) {
    if (!isGuardFailure(error)) throw error;
    const winner = await readControl(db, command.contactKey);
    if (winner?.stopped) throw new CallerError('STOPPED');
    if (winner?.attemptId === command.attemptId && winner.ownerId === actor.actorUserId && winner.phase !== 'closed' && winner.phase !== 'uncertain' && winner.leaseUntil! > iso(now)) return view(winner);
    throw new CallerError(winner?.phase === 'uncertain' ? 'CLAIM_UNCERTAIN' : winner && winner.phase !== 'closed' ? 'CLAIM_HELD' : 'REVISION_CONFLICT');
  }
  return { attemptId: command.attemptId, ownerId: actor.actorUserId, contactKey: command.contactKey, revision: (current?.revision ?? 0) + 1, expiresAt, state: 'reserved' };
}

async function owned(db: CallerDb, actor: ClaimActor, claim: Claim, now: number) {
  await expirePotentialCall(db, claim.contactKey, now);
  const current = await readControl(db, claim.contactKey), attempt = await readAttempt(db, claim.attemptId);
  if (!current || !attempt || current.attemptId !== claim.attemptId || current.ownerId !== actor.actorUserId || attempt.ownerId !== actor.actorUserId || claim.ownerId !== actor.actorUserId) throw new CallerError('NOT_FOUND', 404);
  if (current.phase === 'uncertain') throw new CallerError('CLAIM_UNCERTAIN');
  if (current.phase === 'closed' || current.revision !== claim.revision || current.leaseUntil! <= iso(now)) throw new CallerError('REVISION_CONFLICT');
  return { current, attempt };
}

export async function renewContactClaim(db: CallerDb, actor: ClaimActor, claim: Claim, state: 'reserved' | 'armed' | 'active', now = Date.now(), linked?: LinkedAuthorization): Promise<Claim> {
  const { current, attempt } = await owned(db, actor, claim, now);
  if (attempt.linkId && (!linked || attempt.linkId !== linked.linkId || attempt.sourceRevision !== linked.sourceRevision || attempt.originSourceJson !== linked.originSourceJson || attempt.originActorId !== linked.originActorId)) throw new CallerError('LINK_CHECK_REQUIRED');
  const transitions: Record<Phase, string[]> = { reserved: ['reserved', 'armed'], armed: ['armed', 'active'], active: ['active'], uncertain: [], closed: [] };
  if (!transitions[current.phase].includes(state)) throw new CallerError('REVISION_CONFLICT');
  let source: Awaited<ReturnType<typeof readEngineCallSource>> | undefined;
  if (state !== 'active') {
    if (current.stopped) throw new CallerError('STOPPED');
    source = await readEngineCallSource(db, attempt.sourceEntityId, now);
    if (!attempt.originSourceJson && source.revision !== attempt.sourceRevision) throw new CallerError('REVISION_CONFLICT');
    if (!await callableForClaim(db,source,linked)) throw new CallerError('STOPPED');
  }
  const expiresAt = iso(now + 120_000);
  try {
    await db.batch([
      contactGuard(db, claim.contactKey, current.revision, source && { entityId: attempt.sourceEntityId, snapshot: source.snapshot, linked }),
      db.prepare(`UPDATE CallerAttempt SET phase=?,firstArmedAt=CASE WHEN ?='armed' THEN COALESCE(firstArmedAt,?) ELSE firstArmedAt END WHERE workspaceId=? AND attemptId=?`).bind(state, state, iso(now), ENGINE_WORKSPACE, claim.attemptId),
      db.prepare(`UPDATE CallerContactControl SET phase=?,leaseUntil=?,revision=revision+1 WHERE workspaceId=? AND contactKey=?`).bind(state, expiresAt, ENGINE_WORKSPACE, claim.contactKey),
    ]);
  } catch (error) { if (isGuardFailure(error)) throw new CallerError('REVISION_CONFLICT'); throw error; }
  return { ...view(current), state, expiresAt, revision: current.revision + 1 };
}

export async function setContactStop(db: CallerDb, actor: ClaimActor, contactKey: string, reason: string, now = Date.now(), entityId?: string): Promise<void> {
  z.string().regex(/^ec-[a-f0-9]{64}$/).parse(contactKey);
  z.string().trim().min(1).max(2000).parse(reason);
  if (entityId && contactKey !== await engineContactId(entityId)) throw new CallerError('NOT_FOUND', 404);
  await db.batch([db.prepare(`INSERT INTO CallerContactControl(workspaceId,contactKey,sourceEntityId,stopped,stopRevision,stopReason,stoppedAt,stoppedBy,revision) VALUES(?,?,?,1,1,?,?,?,1)
    ON CONFLICT(workspaceId,contactKey) DO UPDATE SET sourceEntityId=COALESCE(CallerContactControl.sourceEntityId,excluded.sourceEntityId),stopped=1,stopRevision=stopRevision+1,stopReason=excluded.stopReason,stoppedAt=excluded.stoppedAt,stoppedBy=excluded.stoppedBy,revision=revision+1`).bind(ENGINE_WORKSPACE, contactKey, entityId ?? null, reason, iso(now), actor.actorUserId),...await planEngineStopDelivery(db,contactKey,actor.actorUserId,iso(now))]);
}

async function closeAttempt(db: CallerDb, current: Control, now: number, resolution: 'not_dialed' | 'call_finished' | 'result_saved') {
  try {
    await db.batch([
      contactGuard(db, current.contactKey, current.revision),
      db.prepare(`UPDATE CallerAttempt SET phase='closed',closedAt=?,resolution=? WHERE workspaceId=? AND attemptId=?`).bind(iso(now), resolution, ENGINE_WORKSPACE, current.attemptId),
      db.prepare(`UPDATE CallerContactControl SET phase='closed',leaseUntil=?,revision=revision+1 WHERE workspaceId=? AND contactKey=?`).bind(iso(now), ENGINE_WORKSPACE, current.contactKey),
    ]);
  } catch (error) { if (isGuardFailure(error)) throw new CallerError('REVISION_CONFLICT'); throw error; }
}

export async function releaseContactClaim(db: CallerDb, actor: ClaimActor, claim: Claim, reason: 'cancelled' | 'completed' | 'uncertain', now = Date.now()): Promise<void> {
  const completed = await readAttempt(db, claim.attemptId);
  if (completed?.phase === 'closed' && completed.resolution !== null && completed.ownerId === actor.actorUserId && completed.contactKey === claim.contactKey && claim.ownerId === actor.actorUserId) return;
  const { current, attempt } = await owned(db, actor, claim, now);
  if (reason === 'uncertain') {
    await db.batch([
      contactGuard(db, claim.contactKey, current.revision),
      db.prepare(`UPDATE CallerAttempt SET phase='uncertain' WHERE workspaceId=? AND attemptId=?`).bind(ENGINE_WORKSPACE, claim.attemptId),
      db.prepare(`UPDATE CallerContactControl SET phase='uncertain',revision=revision+1 WHERE workspaceId=? AND contactKey=?`).bind(ENGINE_WORKSPACE, claim.contactKey),
    ]);
    return;
  }
  const saved = await db.prepare('SELECT 1 FROM CallerResult WHERE workspaceId=? AND attemptId=?').bind(ENGINE_WORKSPACE, claim.attemptId).first();
  if (attempt.firstArmedAt && !(reason === 'completed' && saved)) throw new CallerError('CLAIM_UNCERTAIN');
  await closeAttempt(db, current, now, saved ? 'result_saved' : 'not_dialed');
}

export async function reconcileClaim(db: CallerDb, actor: ClaimActor, attemptId: string, resolution: 'not_dialed' | 'call_finished', now = Date.now()): Promise<void> {
  z.enum(['not_dialed', 'call_finished']).parse(resolution);
  const attempt = await readAttempt(db, attemptId);
  if (!attempt || attempt.ownerId !== actor.actorUserId) throw new CallerError('NOT_FOUND', 404);
  if (attempt.phase === 'closed') {
    if (attempt.resolution !== resolution && attempt.resolution !== 'result_saved') throw new CallerError('REVISION_CONFLICT');
    return;
  }
  const current = await readControl(db, attempt.contactKey);
  if (!current || current.attemptId !== attemptId || current.ownerId !== actor.actorUserId) throw new CallerError('REVISION_CONFLICT');
  await closeAttempt(db, current, now, resolution);
}
