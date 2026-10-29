import { z } from 'zod';
import { canonicalJson } from './canonical-json';
import { peerActorKey,PeerError,type LinkIdentity } from './peer-contract';

export const stopProjectionSchema=z.object({
  protocol:z.literal('axiom-caller-stop/1'),projectionId:z.string().uuid(),originEventId:z.string().uuid(),attemptId:z.null(),
  linkId:z.string().uuid(),grantId:z.string().uuid(),originSystem:z.enum(['revenue-engine','orbit']),targetSystem:z.enum(['revenue-engine','orbit']),
  originActorKey:z.string().regex(/^op-[a-f0-9]{64}$/),occurredAt:z.string().datetime(),stopScope:z.literal('contact'),
}).strict();
export type StopProjection=z.infer<typeof stopProjectionSchema>;
export function parseStopProjection(input:unknown):StopProjection {
  const p=stopProjectionSchema.parse(input);
  if(p.originSystem===p.targetSystem||p.originEventId!==p.projectionId)throw new PeerError('INVALID_PROJECTION',422);
  return p;
}
export async function makeStopProjection(link:LinkIdentity,originSystem:StopProjection['originSystem'],actorId:string,now:string):Promise<StopProjection>{
  const id=crypto.randomUUID();
  return {protocol:'axiom-caller-stop/1',projectionId:id,originEventId:id,attemptId:null,linkId:link.linkId,grantId:link.grantId,originSystem,
    targetSystem:originSystem==='orbit'?'revenue-engine':'orbit',originActorKey:await peerActorKey({grantId:link.grantId,orbitWorkspaceId:link.orbitRef.workspaceId},actorId),occurredAt:now,stopScope:'contact'};
}
export async function stopProjectionHash(input:StopProjection){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(parseStopProjection(input))));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export const stopReceiptSchema=z.object({protocol:z.literal('axiom-caller-stop/1'),projectionId:z.string().uuid(),originEventId:z.string().uuid(),attemptId:z.null(),
  payloadHash:z.string().regex(/^[a-f0-9]{64}$/),receivedAt:z.string().datetime(),status:z.enum(['saved','already_saved'])}).strict();
export type StopReceipt=z.infer<typeof stopReceiptSchema>;
