import { z } from 'zod';
import type { CallerDb } from './database';
import type { CallerActor } from '../revenue-engine/caller-integration';
import { getM2OwnerIdentityActor } from '../revenue-engine/m2-owner-identity-actor';
import { sourceRefSchema } from './protocol';
import { ENGINE_WORKSPACE,CallerError } from './identity';
import { peerGrant,requestPeer,linkIdentitySchema,PeerError,type CallerBridge } from './peer-contract';
import { getEngineLink } from './links';
import { createSourceLink } from './link-workflow';
import { searchLinkCandidates,previewSourceLink,confirmSourceLink } from './link-preview';
import { readCallerJson } from './http';
import { flushEngineProjectionOutbox } from './projection-outbox';

const commandSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('search'),engineQuery:z.string().min(1).max(160),orbitQuery:z.string().min(1).max(160)}).strict(),
  z.object({action:z.literal('preview'),engineEntityId:z.string().min(1).max(2048),orbitRef:sourceRefSchema,orbitContactId:z.string().uuid()}).strict(),
  z.object({action:z.literal('confirm'),link:linkIdentitySchema,previewRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({action:z.literal('resume'),linkId:z.string().uuid()}).strict(),
  z.object({action:z.literal('retry'),deliveryKey:z.string().regex(/^(stop:)?[a-f0-9-]{36}$/)}).strict(),
]);
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
/** Session-only owner surface. Extension credentials cannot establish a peer grant or link. */
export async function handleLinkManagement(db:CallerDb,request:Request,actor:CallerActor,env:unknown,fetcher=fetch,schedule?:(work:()=>Promise<unknown>)=>void){
  try{
    const user=await db.prepare('SELECT email,emailVerified,banned FROM User WHERE id=?').bind(actor.actorUserId).first<{email:string;emailVerified:number;banned:number|null}>();
    if(!user?.emailVerified||user.banned||getM2OwnerIdentityActor(user.email)!==actor.actor)throw new PeerError('PEER_SCOPE',403);
    if(request.method==='GET'){
      let configured=false;try{peerGrant(env);configured=true;}catch{/* Settings remains useful before secrets are configured. */}
      const links=(await db.prepare('SELECT l.linkId,l.identityJson,l.state,p.name FROM CallerSourceLink l LEFT JOIN EngineProspect p ON p.prospectId=l.sourceEntityId WHERE l.workspaceId=? ORDER BY l.createdAt DESC LIMIT 100').bind(ENGINE_WORKSPACE).all<{linkId:string;identityJson:string;state:string;name:string|null}>()).results;
      const deliveries=(await db.prepare(`SELECT deliveryKey,status,lastError,attempts,nextAttemptAt FROM CallerStopDelivery WHERE workspaceId=? AND status<>'synced' UNION ALL SELECT deliveryKey,status,lastError,attempts,nextAttemptAt FROM CallerProjection WHERE workspaceId=? AND status<>'synced' ORDER BY nextAttemptAt LIMIT 100`).bind(ENGINE_WORKSPACE,ENGINE_WORKSPACE).all()).results;
      return json({configured,links:links.map(l=>({linkId:l.linkId,state:l.state,name:l.name,orbitRef:JSON.parse(l.identityJson).orbitRef})),deliveries});
    }
    if(request.method!=='POST')throw new PeerError('METHOD_NOT_ALLOWED',405);
    if(request.headers.get('Origin')!==new URL(request.url).origin)throw new PeerError('PEER_SCOPE',403);
    const grant=peerGrant(env),bridge:CallerBridge={grant,send:(op,payload)=>requestPeer(grant,'orbit',op,payload,fetcher)};
    const c=commandSchema.parse(await readCallerJson(request));
    if(c.action==='search')return json(await searchLinkCandidates(db,bridge,c.engineQuery,c.orbitQuery));
    if(c.action==='preview')return json(await previewSourceLink(db,bridge,c));
    const flush=()=>schedule?.(async()=>{try{return await flushEngineProjectionOutbox(db,bridge);}catch{return undefined;}});
    if(c.action==='confirm'){const receipt=await confirmSourceLink(db,actor,bridge,c.link,c.previewRevision);flush();return json({receipt});}
    if(c.action==='resume'){
      const existing=await getEngineLink(db,c.linkId);if(!existing)throw new PeerError('NOT_FOUND',404);
      const identity=linkIdentitySchema.parse({linkId:existing.linkId,grantId:existing.grantId,engineRef:existing.engineRef,orbitRef:existing.orbitRef,engineContactKey:existing.engineContactKey,orbitContactId:existing.orbitContactId,confirmed:true});
      const receipt=await createSourceLink(db,actor,identity,bridge);flush();return json({receipt});
    }
    const table=c.deliveryKey.startsWith('stop:')?'CallerStopDelivery':'CallerProjection';
    const now=new Date().toISOString();
    const retried=await db.prepare(`UPDATE ${table} SET status='pending',nextAttemptAt=?,lastError=NULL WHERE workspaceId=? AND deliveryKey=? AND grantId=? AND status IN ('retry','review','auth_required','pending') AND (leaseUntil IS NULL OR leaseUntil<=?) RETURNING deliveryKey`)
      .bind(now,ENGINE_WORKSPACE,c.deliveryKey,grant.grantId,now).first();
    if(!retried)throw new PeerError('GRANT_CHANGED');flush();return json({queued:true});
  }catch(error){const known=error instanceof PeerError||error instanceof CallerError;return json({error:known?error.code:error instanceof z.ZodError?'INVALID_REQUEST':'PEER_UNAVAILABLE'},known?error.status:error instanceof z.ZodError?400:503);}
}
