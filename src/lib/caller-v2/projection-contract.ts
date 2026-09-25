import { z } from 'zod';
import { canonicalJson } from './canonical-json';
import { outcomeSchema, nextActionSchema, purposeSchema, parseResultEvent, type ResultEvent } from './protocol';
import { peerActorKey, PeerError, type LinkIdentity } from './peer-contract';

const hash = z.string().regex(/^[a-f0-9]{64}$/), timestamp = z.string().datetime();
const projectionSchema = z.object({
  protocol:z.literal('axiom-caller-projection/1'),projectionId:z.string().uuid(),linkId:z.string().uuid(),grantId:z.string().uuid(),
  originSystem:z.enum(['revenue-engine','orbit']),targetSystem:z.enum(['revenue-engine','orbit']),originEventId:z.string().uuid(),
  attemptId:z.string().uuid(),originActorKey:z.string().regex(/^op-[a-f0-9]{64}$/),originPayloadHash:hash,
  purpose:purposeSchema,occurredAt:timestamp,dialRequestedAt:timestamp.nullable(),connectedAt:timestamp.nullable(),endedAt:timestamp.nullable(),
  outcome:outcomeSchema,attempted:z.boolean().nullable(),summary:z.string().max(8000),nextAction:nextActionSchema.nullable(),
  stopScope:z.enum(['none','contact']),correctionOf:z.string().uuid().nullable(),
}).strict();
export type CallProjection=z.infer<typeof projectionSchema>;
export function parseProjection(input:unknown):CallProjection {
  const p=projectionSchema.parse(input);
  if(p.originSystem===p.targetSystem)throw new PeerError('PROJECTION_LOOP',422);
  if(p.originSystem==='orbit'&&p.summary!=='')throw new PeerError('PRIVATE_PROJECTION_FIELD',422);
  // Reuse the physical-fact and callback semantics without importing source
  // domain commands. A mirror has no commercial decision or transcript fields.
  const validated=parseResultEvent({protocol:'axiom-caller/2',eventId:p.originEventId,attemptId:p.attemptId,
    source:{system:p.originSystem,workspaceId:'projection',connectionId:'projection',entityType:p.purpose==='client_opportunity'?'client':'prospect',entityId:'projection'},
    purpose:p.purpose,contactId:'projection',sourceRevision:'projection',evidenceRevision:null,
    occurredAt:p.occurredAt,dialRequestedAt:p.dialRequestedAt,connectedAt:p.connectedAt,endedAt:p.endedAt,
    outcome:p.outcome,attempted:p.attempted,summary:p.summary||'Call recorded in Orbit.',nextAction:p.nextAction,
    stopScope:p.stopScope,provenance:'operator',decisions:[],correctionOf:p.correctionOf});
  if(canonicalJson(validated.nextAction)!==canonicalJson(p.nextAction))throw new PeerError('INVALID_PROJECTION',422);
  return p;
}
export async function makeCallProjection(link:LinkIdentity,actorId:string,event:ResultEvent,originPayloadHash:string):Promise<CallProjection> {
  const origin=event.source.system;
  if(origin==='revenue-engine'?(event.source.entityId!==link.engineRef.entityId||event.contactId!==link.engineContactKey):
    (event.source.workspaceId!==link.orbitRef.workspaceId||event.source.connectionId!==link.orbitRef.connectionId||event.contactId!==link.orbitContactId))throw new PeerError('PEER_SCOPE',403);
  return parseProjection({protocol:'axiom-caller-projection/1',projectionId:crypto.randomUUID(),linkId:link.linkId,grantId:link.grantId,
    originSystem:origin,targetSystem:origin==='orbit'?'revenue-engine':'orbit',originEventId:event.eventId,attemptId:event.attemptId,
    originActorKey:await peerActorKey({grantId:link.grantId,orbitWorkspaceId:link.orbitRef.workspaceId},actorId),originPayloadHash,
    purpose:event.purpose,occurredAt:event.occurredAt,dialRequestedAt:event.dialRequestedAt,connectedAt:event.connectedAt,endedAt:event.endedAt,
    outcome:event.outcome,attempted:event.attempted,summary:origin==='orbit'?'':event.summary,nextAction:event.nextAction,
    stopScope:event.stopScope,correctionOf:event.correctionOf});
}
export async function projectionHash(input:CallProjection):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(parseProjection(input))));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export const projectionReceiptSchema=z.object({protocol:z.literal('axiom-caller-projection/1'),projectionId:z.string().uuid(),originEventId:z.string().uuid(),attemptId:z.string().uuid(),payloadHash:hash,receivedAt:timestamp,status:z.enum(['saved','already_saved'])}).strict();
export type ProjectionReceipt=z.infer<typeof projectionReceiptSchema>;
