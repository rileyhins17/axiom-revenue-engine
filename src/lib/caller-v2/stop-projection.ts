import type { CallerDb,CallerStatement } from './database';
import { canonicalJson } from './canonical-json';
import { ENGINE_WORKSPACE } from './identity';
import { getEngineContactLink,getEngineLink } from './links';
import { assertPeerLink,linkIdentitySchema,PeerError,type LinkIdentity,type PeerGrant } from './peer-contract';
import { makeStopProjection,parseStopProjection,stopProjectionHash,type StopProjection,type StopReceipt } from './stop-contract';

export async function planEngineStopDelivery(db:CallerDb,contactKey:string,actorId:string,now:string,confirmedLink?:LinkIdentity):Promise<CallerStatement[]>{
  const link=confirmedLink??await getEngineContactLink(db,contactKey);
  if(!link)return guardNoEngineLink(db,contactKey);
  const p=await makeStopProjection(link,'revenue-engine',actorId,now);
  const condition=confirmedLink?` WHERE EXISTS(SELECT 1 FROM CallerContactControl WHERE workspaceId=? AND contactKey=? AND stopped=1) OR EXISTS(SELECT 1 FROM EngineProspectActivity WHERE prospectId=? AND outcome='DO_NOT_CONTACT')`:'';
  return [db.prepare('INSERT INTO CallerStopDelivery(deliveryKey,workspaceId,grantId,payloadJson,payloadHash,nextAttemptAt) SELECT ?,?,?,?,?,?'+condition)
    .bind('stop:'+p.projectionId,ENGINE_WORKSPACE,link.grantId,canonicalJson(p),await stopProjectionHash(p),now,...confirmedLink?[ENGINE_WORKSPACE,contactKey,link.engineRef.entityId]:[])];
}
/** A new immutable link can win once between planning and commit. Replan the entire command. */
export async function retryEngineStopLinkRace<T>(work:()=>Promise<T>):Promise<T>{
  try{return await work();}catch(error){if(!(error instanceof Error)||!error.message.includes('CALLER_STOP_LINK_CHANGED'))throw error;return work();}
}
export async function acceptEngineStop(db:CallerDb,grant:PeerGrant,input:StopProjection,now=Date.now()):Promise<StopReceipt>{
  const p=parseStopProjection(input),link=await getEngineLink(db,p.linkId);
  if(p.targetSystem!=='revenue-engine'||p.originSystem!=='orbit'||p.grantId!==grant.grantId)throw new PeerError('PEER_SCOPE',403);
  if(!link)throw new PeerError('LINK_CHECK_REQUIRED');
  assertPeerLink(grant,linkIdentitySchema.parse({linkId:link.linkId,grantId:link.grantId,engineRef:link.engineRef,orbitRef:link.orbitRef,engineContactKey:link.engineContactKey,orbitContactId:link.orbitContactId,confirmed:true}));
  const hash=await stopProjectionHash(p),receivedAt=new Date(now).toISOString();
  const read=()=>db.prepare('SELECT payloadHash,receivedAt FROM CallerStopReceipt WHERE workspaceId=? AND projectionId=?').bind(ENGINE_WORKSPACE,p.projectionId).first<{payloadHash:string;receivedAt:string}>();
  const receipt=(r:{payloadHash:string;receivedAt:string},status:StopReceipt['status']):StopReceipt=>{if(r.payloadHash!==hash)throw new PeerError('IDEMPOTENCY_CONFLICT');return {protocol:'axiom-caller-stop/1',projectionId:p.projectionId,originEventId:p.originEventId,attemptId:null,payloadHash:hash,receivedAt:r.receivedAt,status};};
  const previous=await read();if(previous)return receipt(previous,'already_saved');
  const guard='stop:'+p.projectionId;
  try{await db.batch([
    db.prepare('INSERT INTO CallerCommandGuard(id,passed) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM CallerSourceLink WHERE workspaceId=? AND linkId=? AND grantId=?) THEN 1 ELSE 0 END)').bind(guard,ENGINE_WORKSPACE,p.linkId,grant.grantId),
    db.prepare('INSERT INTO CallerStopReceipt(workspaceId,projectionId,payloadHash,receivedAt) VALUES(?,?,?,?)').bind(ENGINE_WORKSPACE,p.projectionId,hash,receivedAt),
    db.prepare(`INSERT INTO CallerContactControl(workspaceId,contactKey,sourceEntityId,stopped,stopRevision,stopReason,stoppedAt,stoppedBy,revision)
      VALUES(?,?,?,1,1,'linked_contact_stop',?,?,1) ON CONFLICT(workspaceId,contactKey) DO UPDATE SET stopped=1,stopRevision=stopRevision+1,revision=revision+1,stopReason=excluded.stopReason,stoppedAt=excluded.stoppedAt,stoppedBy=excluded.stoppedBy`)
      .bind(ENGINE_WORKSPACE,link.engineContactKey,link.engineRef.entityId,p.occurredAt,p.originActorKey),
    db.prepare('DELETE FROM CallerCommandGuard WHERE id=?').bind(guard),
  ]);}catch(error){const winner=await read();if(winner)return receipt(winner,'already_saved');throw error;}
  return receipt({payloadHash:hash,receivedAt},'saved');
}

export function guardNoEngineLink(db:CallerDb,contactKey:string):CallerStatement[]{
    const id='stop-link:'+crypto.randomUUID();
    return [db.prepare('INSERT INTO CallerCommandGuard(id,passed) SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM CallerSourceLink WHERE workspaceId=? AND engineContactKey=?) THEN 1 ELSE 0 END').bind(id,ENGINE_WORKSPACE,contactKey),db.prepare('DELETE FROM CallerCommandGuard WHERE id=?').bind(id)];
}
