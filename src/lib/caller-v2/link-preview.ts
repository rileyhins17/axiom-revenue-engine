import { z } from 'zod';
import type { CallerDb } from './database';
import type { CallerActor } from '../revenue-engine/caller-integration';
import { sourceRefSchema,type SourceRef } from './protocol';
import { canonicalJson } from './canonical-json';
import { engineContactId,ENGINE_CONNECTION,ENGINE_WORKSPACE } from './identity';
import { PeerError,type CallerBridge,type LinkIdentity } from './peer-contract';
import { createSourceLink } from './link-workflow';

export const linkCandidateSchema=z.object({source:sourceRefSchema,contactId:z.string(),businessName:z.string().max(1000),contactName:z.string().nullable(),phone:z.string().nullable(),stopped:z.boolean(),revision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type LinkCandidate=z.infer<typeof linkCandidateSchema>;
const digest=async(value:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
async function engineCandidate(db:CallerDb,id:string):Promise<LinkCandidate>{
  const r=await db.prepare(`SELECT p.prospectId,p.name,p.phone,COALESCE(c.stopped,0) stopped FROM EngineProspect p LEFT JOIN CallerContactControl c ON c.workspaceId=? AND c.sourceEntityId=p.prospectId WHERE p.prospectId=?`).bind(ENGINE_WORKSPACE,id).first<{prospectId:string;name:string;phone:string|null;stopped:number}>();
  if(!r)throw new PeerError('NOT_FOUND',404);
  return {source:{system:'revenue-engine',workspaceId:ENGINE_WORKSPACE,connectionId:ENGINE_CONNECTION,entityType:'prospect',entityId:id},contactId:await engineContactId(id),businessName:r.name,contactName:null,phone:r.phone,stopped:!!r.stopped,revision:await digest(r)};
}
export async function searchLinkCandidates(db:CallerDb,bridge:CallerBridge,engineQuery:string,orbitQuery:string){
  z.string().trim().min(1).max(160).parse(engineQuery);z.string().trim().min(1).max(160).parse(orbitQuery);
  const rows=await db.prepare('SELECT prospectId FROM EngineProspect WHERE instr(lower(name),lower(?))>0 ORDER BY name,prospectId LIMIT 20').bind(engineQuery).all<{prospectId:string}>();
  const peer=z.object({candidates:z.array(linkCandidateSchema).max(20)}).strict().parse(await bridge.send('links/preview',{action:'search',query:orbitQuery}));
  for(const c of peer.candidates)if(c.source.system!=='orbit'||c.source.workspaceId!==bridge.grant.orbitWorkspaceId||c.source.connectionId!==bridge.grant.orbitConnectionId)throw new PeerError('PEER_SCOPE',403);
  return {engine:await Promise.all(rows.results.map(row=>engineCandidate(db,row.prospectId))),orbit:peer.candidates};
}
export async function previewSourceLink(db:CallerDb,bridge:CallerBridge,input:{engineEntityId:string;orbitRef:SourceRef;orbitContactId:string;linkId?:string}){
  const engine=await engineCandidate(db,input.engineEntityId),orbit=linkCandidateSchema.parse(await bridge.send('links/preview',{action:'record',source:input.orbitRef,contactId:input.orbitContactId}));
  if(canonicalJson(orbit.source)!==canonicalJson(input.orbitRef)||orbit.contactId!==input.orbitContactId||orbit.source.workspaceId!==bridge.grant.orbitWorkspaceId||orbit.source.connectionId!==bridge.grant.orbitConnectionId)throw new PeerError('PEER_SCOPE',403);
  const link:LinkIdentity={linkId:input.linkId??crypto.randomUUID(),grantId:bridge.grant.grantId,engineRef:engine.source,orbitRef:orbit.source,engineContactKey:engine.contactId,orbitContactId:orbit.contactId,confirmed:true};
  return {link,engine,orbit,previewRevision:await digest({link,engine,orbit})};
}
export async function confirmSourceLink(db:CallerDb,actor:CallerActor,bridge:CallerBridge,link:LinkIdentity,previewRevision:string){
  const fresh=await previewSourceLink(db,bridge,{engineEntityId:link.engineRef.entityId,orbitRef:link.orbitRef,orbitContactId:link.orbitContactId,linkId:link.linkId});
  if(canonicalJson(fresh.link)!==canonicalJson(link)||fresh.previewRevision!==previewRevision)throw new PeerError('REVISION_CONFLICT');
  return createSourceLink(db,actor,link,bridge);
}
