import type {CallerDb} from './database';
import type {CallerActor} from '../revenue-engine/caller-integration';
import {z} from 'zod';
import {PeerError,peerActorKey,linkIdentitySchema,linkReceiptSchema,assertPeerLink,type CallerBridge} from './peer-contract';
import {conversionHandoffSchema,conversionHandoffReceiptSchema,type ConversionHandoffReceipt} from './conversion-contract';
import {canonicalJson,resultPayloadHash} from './canonical-json';
import {sourceRefSchema,parseResultEvent} from './protocol';
import {assertEngineSource,engineContactId,ENGINE_WORKSPACE,ENGINE_CONNECTION} from './identity';
import {readEngineCallSource,SOURCE_SNAPSHOT_SQL} from './source-state';
import {getM2OwnerIdentityActor} from '../revenue-engine/m2-owner-identity-actor';
import {getEngineContactLink,stageEngineLink} from './links';
export type ConversionScope={db:CallerDb;actor:CallerActor;bridge:CallerBridge};
export const conversionRequestSchema=z.object({conversionId:z.string().uuid(),engineSource:sourceRefSchema,expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),confirmedRelationship:z.literal(true),
  reviewedFields:z.object({name:z.string().trim().min(1).max(160),domain:z.string().trim().min(1).max(300).nullable(),
    contact:z.object({name:z.string().trim().min(1).max(160),phone:z.string().regex(/^\+[1-9][0-9]{7,14}$/)}).strict(),agreedWork:z.string().trim().max(2000),historyEventIds:z.array(z.string().uuid()).max(10)}).strict()}).strict();
export type ConversionJob={conversionId:string;sourceEntityId:string;contactKey:string;grantId:string;actorId:string;requestHash:string;payloadHash:string;payloadJson:string;sourceSnapshot:string;status:'pending'|'retry'|'pending_review'|'link_pending'|'completed'|'review';attempts:number;lastError:string|null;receiptJson:string|null};
export const getEngineConversion=(db:CallerDb,id:string)=>db.prepare('SELECT * FROM CallerConversionJob WHERE workspaceId=? AND conversionId=?').bind(ENGINE_WORKSPACE,id).first<ConversionJob>();
export async function requireConversionActor(db:CallerDb,actor:CallerActor):Promise<string>{
  const user=await db.prepare('SELECT email,emailVerified,banned FROM User WHERE id=?').bind(actor.actorUserId).first<{email:string;emailVerified:number;banned:number|null}>();
  if(!user?.emailVerified||user.banned||getM2OwnerIdentityActor(user.email)!==actor.actor)throw new PeerError('PEER_SCOPE',403);return user.email;
}
function normalizedPhone(raw:string|null){
  if(!raw||!/^\+?[0-9 ()\-.]+$/.test(raw))throw new PeerError('REVISION_CONFLICT');
  const compact=raw.replace(/[ ()\-.]/g,'');return compact.startsWith('+')?compact:/^[2-9][0-9]{9}$/.test(compact)?'+1'+compact:/^1[2-9][0-9]{9}$/.test(compact)?'+'+compact:compact;
}
export async function previewEngineConversion(db:CallerDb,entityId:string){
  const state=await readEngineCallSource(db,entityId),key=await engineContactId(entityId);
  const control=await db.prepare('SELECT stopped,phase FROM CallerContactControl WHERE workspaceId=? AND contactKey=?').bind(ENGINE_WORKSPACE,key).first<{stopped:number;phase:string}>();
  if(state.source.stopped||control?.stopped)throw new PeerError('STOPPED');
  if(control&&control.phase!=='closed')throw new PeerError('CLAIM_HELD');
  const rows=await db.prepare(`SELECT payloadJson FROM CallerResult r WHERE workspaceId=? AND sourceEntityId=? AND NOT EXISTS(SELECT 1 FROM CallerResult c WHERE c.workspaceId=r.workspaceId AND c.correctionOf=r.eventId) ORDER BY occurredAt DESC LIMIT 10`).bind(ENGINE_WORKSPACE,entityId).all<{payloadJson:string}>();
  let domain:string|null=null;try{const url=new URL(state.source.websiteUrl??'');if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)domain=url.hostname;}catch{/* Missing remains missing. */}
  return {source:{system:'revenue-engine' as const,workspaceId:ENGINE_WORKSPACE,connectionId:ENGINE_CONNECTION,entityType:'prospect' as const,entityId},revision:state.revision,name:state.source.name,phone:normalizedPhone(state.source.phone),domain,
    history:rows.results.map(row=>{const e=parseResultEvent(JSON.parse(row.payloadJson));return {eventId:e.eventId,occurredAt:e.occurredAt,summary:e.summary.slice(0,1000)};}),existingConversionId:state.source.conversion?.id??null};
}
export async function requestOrbitConversion(scope:ConversionScope,input:unknown):Promise<ConversionJob>{
  const {db,actor,bridge}=scope,email=await requireConversionActor(db,actor),command=conversionRequestSchema.parse(input);
  assertEngineSource(command.engineSource);
  const requestHash=await resultPayloadHash(actor.actorUserId,ENGINE_WORKSPACE,command),prior=await getEngineConversion(db,command.conversionId);
  if(prior){if(prior.actorId!==actor.actorUserId||prior.grantId!==bridge.grant.grantId||prior.requestHash!==requestHash)throw new PeerError('IDEMPOTENCY_CONFLICT');return resumeOrbitConversion(scope,command.conversionId);}
  const state=await readEngineCallSource(db,command.engineSource.entityId),contactKey=await engineContactId(command.engineSource.entityId);
  if(state.revision!==command.expectedRevision||state.source.name!==command.reviewedFields.name||normalizedPhone(state.source.phone)!==command.reviewedFields.contact.phone)throw new PeerError('REVISION_CONFLICT');
  if(state.source.stopped)throw new PeerError('STOPPED');
  if(new Set(command.reviewedFields.historyEventIds).size!==command.reviewedFields.historyEventIds.length)throw new PeerError('INVALID_REQUEST',400);
  const history=[];
  for(const eventId of command.reviewedFields.historyEventIds){
    const row=await db.prepare(`SELECT payloadJson FROM CallerResult r WHERE workspaceId=? AND sourceEntityId=? AND eventId=? AND NOT EXISTS(SELECT 1 FROM CallerResult c WHERE c.workspaceId=r.workspaceId AND c.correctionOf=r.eventId)`)
      .bind(ENGINE_WORKSPACE,command.engineSource.entityId,eventId).first<{payloadJson:string}>();
    if(!row)throw new PeerError('REVISION_CONFLICT');const event=parseResultEvent(JSON.parse(row.payloadJson));
    history.push({eventId:event.eventId,occurredAt:event.occurredAt,summary:event.summary.slice(0,1000)});
  }
  const fields={name:command.reviewedFields.name,domain:command.reviewedFields.domain,contact:command.reviewedFields.contact,agreedWork:command.reviewedFields.agreedWork};
  const packet=conversionHandoffSchema.parse({protocol:'axiom-caller-conversion/1',conversionId:command.conversionId,grantId:bridge.grant.grantId,engineSource:command.engineSource,engineContactKey:contactKey,
    orbitWorkspaceId:bridge.grant.orbitWorkspaceId,orbitConnectionId:bridge.grant.orbitConnectionId,operatorKey:await peerActorKey(bridge.grant,actor.actorUserId),sourceRevision:command.expectedRevision,confirmedRelationship:true,reviewedFields:{...fields,history}});
  const hash=await resultPayloadHash('conversion-handoff',bridge.grant.orbitWorkspaceId,packet);
  try{await db.batch([db.prepare(`INSERT INTO CallerConversionJob(workspaceId,conversionId,sourceEntityId,contactKey,grantId,actorId,requestHash,payloadHash,payloadJson,sourceSnapshot,status,createdAt)
    SELECT ?,?,?,?,?,?,?,?,?,?,'pending',? WHERE (${SOURCE_SNAPSHOT_SQL})=?
    AND NOT EXISTS(SELECT 1 FROM CallerContactControl WHERE workspaceId=? AND contactKey=? AND (stopped=1 OR phase<>'closed'))
    AND EXISTS(SELECT 1 FROM User WHERE id=? AND email=? AND emailVerified=1 AND COALESCE(banned,0)=0)`)
    .bind(ENGINE_WORKSPACE,command.conversionId,command.engineSource.entityId,contactKey,bridge.grant.grantId,actor.actorUserId,requestHash,hash,canonicalJson(packet),state.snapshot,new Date().toISOString(),command.engineSource.entityId,state.snapshot,ENGINE_WORKSPACE,contactKey,actor.actorUserId,email)]);
  }catch(error){const winner=await getEngineConversion(db,command.conversionId);if(winner?.requestHash===requestHash&&winner.actorId===actor.actorUserId)return resumeOrbitConversion(scope,command.conversionId);if(error instanceof Error&&/UNIQUE constraint/.test(error.message))throw new PeerError('IDEMPOTENCY_CONFLICT');throw error;}
  if(!await getEngineConversion(db,command.conversionId))throw new PeerError('REVISION_CONFLICT');
  return resumeOrbitConversion(scope,command.conversionId);
}
export async function resumeOrbitConversion(scope:ConversionScope,conversionId:string):Promise<ConversionJob>{
  const {db,actor,bridge}=scope,email=await requireConversionActor(db,actor),job=await getEngineConversion(db,z.string().uuid().parse(conversionId));
  if(!job||job.actorId!==actor.actorUserId)throw new PeerError('NOT_FOUND',404);
  if(job.grantId!==bridge.grant.grantId)throw new PeerError('PEER_SCOPE',403);
  if(job.status==='completed')return job;
  const owner=crypto.randomUUID(),now=new Date().toISOString();
  const leased=await db.prepare(`UPDATE CallerConversionJob SET leaseOwner=?,leaseUntil=?,attempts=attempts+1 WHERE workspaceId=? AND conversionId=? AND status<>'completed'
    AND (leaseUntil IS NULL OR leaseUntil<=?) AND EXISTS(SELECT 1 FROM User WHERE id=? AND email=? AND emailVerified=1 AND COALESCE(banned,0)=0) RETURNING conversionId`)
    .bind(owner,new Date(Date.now()+30000).toISOString(),ENGINE_WORKSPACE,conversionId,now,actor.actorUserId,email).first();
  if(!leased)throw new PeerError('CLAIM_HELD');
  let receipt:ConversionHandoffReceipt|null=null,errorCode:string|null=null,status:ConversionJob['status']='retry';
  try{
    if(!await db.prepare('SELECT 1 FROM EngineProspect WHERE prospectId=?').bind(job.sourceEntityId).first())throw new PeerError('NOT_FOUND',404);
    receipt=conversionHandoffReceiptSchema.parse(await bridge.send('conversion/request',JSON.parse(job.payloadJson)));
    if(receipt.conversionId!==job.conversionId||receipt.payloadHash!==job.payloadHash)throw new PeerError('IDEMPOTENCY_CONFLICT');
    status=receipt.status==='pending'?'pending_review':'link_pending';
    if(receipt.status==='completed'){
      let a=await conversionAuthority(db,bridge.grant,conversionId),local=await getEngineContactLink(db,job.contactKey);
      if(!local){
        if((JSON.parse(job.sourceSnapshot) as {link:unknown}).link)throw new PeerError('NOT_FOUND',404);
        const link=assertPeerLink(bridge.grant,{linkId:receipt.linkId,grantId:job.grantId,engineRef:a.packet.engineSource,engineContactKey:job.contactKey,orbitContactId:receipt.orbitContactId,confirmed:true,
          orbitRef:{system:'orbit',workspaceId:bridge.grant.orbitWorkspaceId,connectionId:bridge.grant.orbitConnectionId,entityType:receipt.prospectId?'prospect':'client',entityId:receipt.prospectId??receipt.clientId}});
        const scoped:CallerDb={...db,batch:statements=>guardConversionBatch(db,a,statements)};
        local=await stageEngineLink(scoped,actor,bridge.grant,link);
        a=await conversionAuthority(db,bridge.grant,conversionId);
      }
      if(!local||local.linkId!==receipt.linkId||local.orbitContactId!==receipt.orbitContactId||local.grantId!==job.grantId||
        local.orbitRef.entityType==='prospect'&&local.orbitRef.entityId!==receipt.prospectId||local.orbitRef.entityType==='client'&&local.orbitRef.entityId!==receipt.clientId)throw new PeerError('LINK_CONFLICT');
      const {state:_state,revision:_revision,...link}=local;
      assertPeerLink(bridge.grant,link);
      const activated=linkReceiptSchema.parse(await bridge.send('links/activate',{link,peerReceipt:local}));
      if(canonicalJson(activated)!==canonicalJson({...link,state:'active',revision:2}))throw new PeerError('LINK_CONFLICT');
      const guard='conversion-complete:'+conversionId;
      await db.batch([
        db.prepare(`INSERT INTO CallerConversionGuard(id,passed) VALUES(?,CASE WHEN (${SOURCE_SNAPSHOT_SQL})=?
          AND EXISTS(SELECT 1 FROM User WHERE id=? AND email=? AND emailVerified=1 AND COALESCE(banned,0)=0)
          AND NOT EXISTS(SELECT 1 FROM CallerContactControl WHERE workspaceId=? AND contactKey=? AND (stopped=1 OR phase<>'closed'))
          AND EXISTS(SELECT 1 FROM CallerConversionJob WHERE workspaceId=? AND conversionId=? AND leaseOwner=?) THEN 1 ELSE 0 END)`)
          .bind(guard,job.sourceEntityId,a.state.snapshot,actor.actorUserId,a.email,ENGINE_WORKSPACE,job.contactKey,ENGINE_WORKSPACE,conversionId,owner),
        db.prepare("UPDATE CallerSourceLink SET state='active',revision=2 WHERE workspaceId=? AND linkId=? AND identityJson=?").bind(ENGINE_WORKSPACE,link.linkId,canonicalJson(link)),
        db.prepare("UPDATE CallerConversionJob SET status='completed',receiptJson=?,lastError=NULL,leaseOwner=NULL,leaseUntil=NULL WHERE workspaceId=? AND conversionId=? AND leaseOwner=?").bind(canonicalJson(receipt),ENGINE_WORKSPACE,conversionId,owner),
        db.prepare('DELETE FROM CallerConversionGuard WHERE id=?').bind(guard),
      ]);
      return (await getEngineConversion(db,conversionId))!;
    }
  }catch(error){errorCode=error instanceof PeerError?error.code:'PEER_UNAVAILABLE';status=error instanceof PeerError&&error.status<500?'review':'retry';}
  await db.prepare('UPDATE CallerConversionJob SET status=?,receiptJson=COALESCE(?,receiptJson),lastError=?,leaseOwner=NULL,leaseUntil=NULL WHERE workspaceId=? AND conversionId=? AND leaseOwner=?')
    .bind(status,receipt?canonicalJson(receipt):null,errorCode,ENGINE_WORKSPACE,conversionId,owner).run();
  return (await getEngineConversion(db,conversionId))!;
}
async function conversionAuthority(db:CallerDb,grant:CallerBridge['grant'],conversionId:string){
  const job=await getEngineConversion(db,z.string().uuid().parse(conversionId));
  if(!job||job.grantId!==grant.grantId)throw new PeerError('NOT_FOUND',404);
  const packet=conversionHandoffSchema.parse(JSON.parse(job.payloadJson));
  if(packet.orbitWorkspaceId!==grant.orbitWorkspaceId||packet.orbitConnectionId!==grant.orbitConnectionId)throw new PeerError('PEER_SCOPE',403);
  const user=await db.prepare('SELECT email FROM User WHERE id=?').bind(job.actorId).first<{email:string}>(),kind=user&&getM2OwnerIdentityActor(user.email);
  if(!kind)throw new PeerError('PEER_SCOPE',403);
  const actor:CallerActor={actor:kind,actorUserId:job.actorId},email=await requireConversionActor(db,actor),state=await readEngineCallSource(db,job.sourceEntityId);
  const control=await db.prepare('SELECT stopped,phase FROM CallerContactControl WHERE workspaceId=? AND contactKey=?').bind(ENGINE_WORKSPACE,job.contactKey).first<{stopped:number;phase:string}>();
  if(state.source.stopped||control?.stopped)throw new PeerError('STOPPED');
  if(control&&control.phase!=='closed')throw new PeerError('CLAIM_HELD');
  return {job,packet,actor,email,state};
}
export async function engineConversionContext(db:CallerDb,grant:CallerBridge['grant'],conversionId:string){
  const a=await conversionAuthority(db,grant,conversionId);
  return {conversionId,engineSource:a.packet.engineSource,engineContactKey:a.job.contactKey,revision:a.state.revision,name:a.state.source.name,phone:normalizedPhone(a.state.source.phone),link:await getEngineContactLink(db,a.job.contactKey)};
}
export async function reserveEngineConversionLink(db:CallerDb,grant:CallerBridge['grant'],input:unknown){
  const command=z.object({conversionId:z.string().uuid(),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),link:linkIdentitySchema}).strict().parse(input);
  const a=await conversionAuthority(db,grant,command.conversionId),link=assertPeerLink(grant,command.link);
  if(a.state.revision!==command.expectedRevision||link.engineContactKey!==a.job.contactKey||canonicalJson(link.engineRef)!==canonicalJson(a.packet.engineSource))throw new PeerError('REVISION_CONFLICT');
  const previous=await getEngineContactLink(db,a.job.contactKey);
  if(previous){const {state:_state,revision:_revision,...identity}=previous;if(canonicalJson(identity)!==canonicalJson(link))throw new PeerError('LINK_CONFLICT');}
  // The immutable conversion job already holds acquisition and linked claims.
  // Validate that hold atomically; Orbit will commit its selected mapping with the
  // business receipt before Engine creates a mapping to a new Orbit identity.
  try{await guardConversionBatch(db,a,[]);}
  catch(error){if(error instanceof Error&&/caller_conversion_guard/.test(error.message))throw new PeerError('REVISION_CONFLICT');throw error;}
  return previous??{...link,state:'pending' as const,revision:1};
}
async function guardConversionBatch(db:CallerDb,a:Awaited<ReturnType<typeof conversionAuthority>>,statements:Parameters<CallerDb['batch']>[0]){
  const guard='conversion:'+a.job.conversionId;
  return db.batch([
    db.prepare(`INSERT INTO CallerConversionGuard(id,passed) VALUES(?,CASE WHEN (${SOURCE_SNAPSHOT_SQL})=?
      AND EXISTS(SELECT 1 FROM User WHERE id=? AND email=? AND emailVerified=1 AND COALESCE(banned,0)=0)
      AND NOT EXISTS(SELECT 1 FROM CallerContactControl WHERE workspaceId=? AND contactKey=? AND (stopped=1 OR phase<>'closed')) THEN 1 ELSE 0 END)`)
      .bind(guard,a.job.sourceEntityId,a.state.snapshot,a.actor.actorUserId,a.email,ENGINE_WORKSPACE,a.job.contactKey),
    ...statements,db.prepare('DELETE FROM CallerConversionGuard WHERE id=?').bind(guard),
  ]);
}

/** An authenticated peer may finish the original owner's durable job, never choose a new owner. */
export async function finalizeEngineConversion(db:CallerDb,bridge:CallerBridge,conversionId:string){
  const a=await conversionAuthority(db,bridge.grant,conversionId);
  const job=await resumeOrbitConversion({db,actor:a.actor,bridge},conversionId);
  return {conversionId:job.conversionId,status:job.status};
}
