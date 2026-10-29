import {z} from 'zod';
import {sourceRefSchema} from './protocol';
import {PeerError,linkReceiptSchema,type PeerGrant} from './peer-contract';

/** A reviewed request is an inbox item, not authorization to create an Orbit client. */
export const conversionHandoffSchema=z.object({
  protocol:z.literal('axiom-caller-conversion/1'),conversionId:z.string().uuid(),grantId:z.string().uuid(),
  engineSource:sourceRefSchema,engineContactKey:z.string().regex(/^ec-[a-f0-9]{64}$/),
  orbitWorkspaceId:z.string().min(1).max(128),orbitConnectionId:z.string().min(1).max(128),
  operatorKey:z.string().regex(/^op-[a-f0-9]{64}$/),sourceRevision:z.string().regex(/^[a-f0-9]{64}$/),confirmedRelationship:z.literal(true),
  reviewedFields:z.object({
    name:z.string().trim().min(1).max(160),domain:z.string().trim().min(1).max(300).nullable(),
    contact:z.object({name:z.string().trim().min(1).max(160),phone:z.string().regex(/^\+[1-9][0-9]{7,14}$/)}).strict(),
    agreedWork:z.string().trim().max(2000),
    history:z.array(z.object({eventId:z.string().uuid(),occurredAt:z.string().datetime(),summary:z.string().min(1).max(1000)}).strict()).max(10),
  }).strict(),
}).strict();
export type ConversionHandoff=z.infer<typeof conversionHandoffSchema>;
const receiptBase=z.object({conversionId:z.string().uuid(),payloadHash:z.string().regex(/^[a-f0-9]{64}$/),receivedAt:z.string().datetime()});
export const conversionHandoffReceiptSchema=z.discriminatedUnion('status',[
  receiptBase.extend({status:z.literal('pending')}).strict(),
  receiptBase.extend({status:z.literal('completed'),prospectId:z.string().min(1).max(160).nullable(),clientId:z.string().min(1).max(160),orbitContactId:z.string().uuid(),linkId:z.string().uuid(),linkedExisting:z.boolean()}).strict(),
]);
export type ConversionHandoffReceipt=z.infer<typeof conversionHandoffReceiptSchema>;
export async function assertConversionHandoff(grant:PeerGrant,input:unknown):Promise<ConversionHandoff>{
  const packet=conversionHandoffSchema.parse(input),source=packet.engineSource;
  if(packet.grantId!==grant.grantId||packet.orbitWorkspaceId!==grant.orbitWorkspaceId||packet.orbitConnectionId!==grant.orbitConnectionId||
    source.system!=='revenue-engine'||source.entityType!=='prospect'||source.workspaceId!==grant.engineWorkspaceId||source.connectionId!==grant.engineConnectionId)throw new PeerError('PEER_SCOPE',403);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('engine-prospect:'+source.entityId));
  if(packet.engineContactKey!=='ec-'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''))throw new PeerError('PEER_SCOPE',403);
  if(new Set(packet.reviewedFields.history.map(x=>x.eventId)).size!==packet.reviewedFields.history.length)throw new PeerError('INVALID_REQUEST',400);
  return packet;
}

export const conversionContextSchema=z.object({
  conversionId:z.string().uuid(),engineSource:sourceRefSchema,engineContactKey:z.string().regex(/^ec-[a-f0-9]{64}$/),
  revision:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().min(1).max(300),phone:z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  link:linkReceiptSchema.nullable(),
}).strict();
