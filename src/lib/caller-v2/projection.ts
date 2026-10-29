import { guardNoEngineLink } from './stop-projection';
import { canonicalJson } from './canonical-json';
import type { CallerDb,CallerStatement } from './database';
import { ENGINE_WORKSPACE } from './identity';
import { getEngineContactLink,getEngineLink } from './links';
import { assertPeerLink,PeerError,type PeerGrant } from './peer-contract';
import { makeCallProjection,parseProjection,projectionHash,type CallProjection,type ProjectionReceipt } from './projection-contract';
import { parseResultEvent, type ResultEvent } from './protocol';

export async function planEngineProjection(db:CallerDb,actorId:string,event:ResultEvent,hash:string,now:string):Promise<CallerStatement[]> {
  const link=await getEngineContactLink(db,event.contactId);
  if(!link)return guardNoEngineLink(db,event.contactId);
  const chain:{event:ResultEvent;actorId:string;hash:string}[]=[];
  let current={event,actorId,hash};
  for(;;){
    if(await db.prepare('SELECT 1 FROM CallerProjection WHERE workspaceId=? AND originEventId=? AND grantId=?').bind(ENGINE_WORKSPACE,current.event.eventId,link.grantId).first())break;
    chain.unshift(current);
    if(!current.event.correctionOf)break;
    const parent=await db.prepare('SELECT payloadJson,payloadHash,actorUserId FROM CallerResult WHERE workspaceId=? AND eventId=?').bind(ENGINE_WORKSPACE,current.event.correctionOf).first<{payloadJson:string;payloadHash:string;actorUserId:string}>();
    if(!parent)throw new PeerError('MISSING_ORIGIN');
    current={event:parseResultEvent(JSON.parse(parent.payloadJson)),actorId:parent.actorUserId,hash:parent.payloadHash};
  }
  // A correction after linking must include any pre-link ancestors so the peer
  // can validate its immutable chain. Existing deliveries retain their IDs.
  return Promise.all(chain.map(async row=>{
    const payload=await makeCallProjection(link,row.actorId,row.event,row.hash);
    return db.prepare(`INSERT INTO CallerProjection(deliveryKey,workspaceId,originEventId,attemptId,targetSystem,grantId,payloadJson,payloadHash,nextAttemptAt)
      SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM CallerProjection WHERE workspaceId=? AND originEventId=? AND grantId=?)`).bind(payload.projectionId,ENGINE_WORKSPACE,row.event.eventId,row.event.attemptId,'orbit',link.grantId,canonicalJson(payload),await projectionHash(payload),now,ENGINE_WORKSPACE,row.event.eventId,link.grantId);
  }));
}
type Stored={projectionId:string;originEventId:string;attemptId:string;payloadHash:string;payloadJson:string;receivedAt:string};
const read=(db:CallerDb,originEventId:string)=>db.prepare("SELECT * FROM CallerMirror WHERE workspaceId=? AND originSystem='orbit' AND originEventId=?").bind(ENGINE_WORKSPACE,originEventId).first<Stored>();
const receipt=(r:Stored,status:ProjectionReceipt['status']):ProjectionReceipt=>({protocol:'axiom-caller-projection/1',projectionId:r.projectionId,originEventId:r.originEventId,attemptId:r.attemptId,payloadHash:r.payloadHash,receivedAt:r.receivedAt,status});
export async function acceptEngineProjection(db:CallerDb,grant:PeerGrant,input:CallProjection,now=Date.now()):Promise<ProjectionReceipt> {
  const p=parseProjection(input);
  if(p.targetSystem!=='revenue-engine'||p.originSystem!=='orbit'||p.grantId!==grant.grantId)throw new PeerError('PEER_SCOPE',403);
  const link=await getEngineLink(db,p.linkId);
  if(!link||link.state!=='active')throw new PeerError('LINK_CHECK_REQUIRED');
  assertPeerLink(grant,{linkId:link.linkId,grantId:link.grantId,engineRef:link.engineRef,orbitRef:link.orbitRef,engineContactKey:link.engineContactKey,orbitContactId:link.orbitContactId,confirmed:true});
  const hash=await projectionHash(p),previous=await read(db,p.originEventId);
  const replay=(r:Stored)=>{if(r.payloadHash!==hash||r.projectionId!==p.projectionId)throw new PeerError('IDEMPOTENCY_CONFLICT');return receipt(r,'already_saved');};
  if(previous)return replay(previous);
  if(!await db.prepare('SELECT 1 FROM EngineProspect WHERE prospectId=?').bind(link.engineRef.entityId).first())throw new PeerError('NOT_FOUND',404);
  if(p.correctionOf){
    const parent=await read(db,p.correctionOf);if(!parent)throw new PeerError('MISSING_ORIGIN');
    const original=parseProjection(JSON.parse(parent.payloadJson));
    if(original.linkId!==p.linkId||original.attemptId!==p.attemptId||original.originActorKey!==p.originActorKey||original.occurredAt!==p.occurredAt)throw new PeerError('REVISION_CONFLICT');
  }
  const receivedAt=new Date(now).toISOString(),guardId='projection:'+p.projectionId,statements=[
    db.prepare(`INSERT INTO CallerCommandGuard(id,passed) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM CallerSourceLink l JOIN EngineProspect p ON p.prospectId=l.sourceEntityId
      WHERE l.workspaceId=? AND l.linkId=? AND l.grantId=? AND l.state='active' AND l.revision=?) THEN 1 ELSE 0 END)`).bind(guardId,ENGINE_WORKSPACE,p.linkId,grant.grantId,link.revision),
    db.prepare(`INSERT INTO CallerMirror(workspaceId,projectionId,linkId,originSystem,originEventId,attemptId,originActorKey,payloadHash,payloadJson,occurredAt,receivedAt,correctionOf)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(ENGINE_WORKSPACE,p.projectionId,p.linkId,p.originSystem,p.originEventId,p.attemptId,p.originActorKey,hash,canonicalJson(p),p.occurredAt,receivedAt,p.correctionOf)];
  if(p.stopScope==='contact')statements.push(db.prepare(`INSERT INTO CallerContactControl(workspaceId,contactKey,sourceEntityId,stopped,stopRevision,stopReason,stoppedAt,stoppedBy,revision)
    VALUES(?,?,?,1,1,'linked_contact_stop',?,?,1) ON CONFLICT(workspaceId,contactKey) DO UPDATE SET stopped=1,stopRevision=stopRevision+1,revision=revision+1,stopReason=excluded.stopReason,stoppedAt=excluded.stoppedAt,stoppedBy=excluded.stoppedBy`)
    .bind(ENGINE_WORKSPACE,link.engineContactKey,link.engineRef.entityId,receivedAt,p.originActorKey));
  if(!p.correctionOf)statements.push(
    db.prepare("UPDATE CallerAttempt SET phase='closed',resolution='result_saved',closedAt=? WHERE workspaceId=? AND attemptId=? AND ownerId=? AND linkId=? AND originSourceJson IS NOT NULL").bind(receivedAt,ENGINE_WORKSPACE,p.attemptId,p.originActorKey,p.linkId),
    db.prepare("UPDATE CallerContactControl SET phase='closed',leaseUntil=?,revision=revision+1 WHERE workspaceId=? AND contactKey=? AND attemptId=? AND ownerId=? AND EXISTS(SELECT 1 FROM CallerAttempt WHERE workspaceId=? AND attemptId=? AND linkId=? AND resolution='result_saved')")
      .bind(receivedAt,ENGINE_WORKSPACE,link.engineContactKey,p.attemptId,p.originActorKey,ENGINE_WORKSPACE,p.attemptId,p.linkId),
  );
  statements.push(db.prepare('DELETE FROM CallerCommandGuard WHERE id=?').bind(guardId));
  try{await db.batch(statements);}catch(error){
    const winner=await read(db,p.originEventId);if(winner)return replay(winner);
    if(error instanceof Error&&/caller_command_guard/.test(error.message))throw new PeerError('LINK_CHECK_REQUIRED');
    if(error instanceof Error&&/UNIQUE constraint/.test(error.message))throw new PeerError('REVISION_CONFLICT');
    throw error;
  }
  return receipt({projectionId:p.projectionId,originEventId:p.originEventId,attemptId:p.attemptId,payloadHash:hash,payloadJson:canonicalJson(p),receivedAt},'saved');
}
