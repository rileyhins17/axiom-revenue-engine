import { acceptEngineStop } from './stop-projection';
import { parseStopProjection } from './stop-contract';
import { z } from 'zod';
import type { CallerDb } from './database';
import { CallerError } from './identity';
import { readCallerJson } from './http';
import { PeerError, peerGrant, peerOperationSchema, verifyPeerCommand, requestPeer, peerActorKey, type CallerBridge } from './peer-contract';
import { claimPeerLinkedContact, peerClaimSchema, renewPeerLinkedClaim } from './linked-claims';
import { reconcileClaim, releaseContactClaim } from './claims';
import { acceptEngineProjection } from './projection';
import { parseProjection } from './projection-contract';

export const coordinatorClaimSchema = z.object({ attemptId:z.string().uuid(),ownerId:z.string().regex(/^op-[a-f0-9]{64}$/),contactKey:z.string().regex(/^ec-[a-f0-9]{64}$/),revision:z.number().int().nonnegative(),expiresAt:z.string().datetime(),state:z.enum(['reserved','armed','active','uncertain','closed']) }).strict();
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function handleEnginePeerRequest(db:CallerDb,request:Request,route:string,env:unknown,fetcher=fetch):Promise<Response> {
  try {
    const operation=peerOperationSchema.safeParse(route);
    if(!operation.success)throw new PeerError('NOT_FOUND',404);
    if(request.method!=='POST')throw new PeerError('METHOD_NOT_ALLOWED',405);
    const grant=peerGrant(env),input=await verifyPeerCommand(grant,operation.data,await readCallerJson(request));
    const bridge:CallerBridge={grant,send:(op,payload)=>requestPeer(grant,'orbit',op,payload,fetcher)};
    if(operation.data==='stop')return json(await acceptEngineStop(db,grant,parseStopProjection(input)));
    if(operation.data==='projections')return json(await acceptEngineProjection(db,grant,parseProjection(input)));
    if(operation.data==='claims')return json(await claimPeerLinkedContact(db,peerClaimSchema.parse(input),bridge));
    if(operation.data==='claims/renew'){
      const body=z.object({actorId:z.string().min(1).max(128),claim:coordinatorClaimSchema,state:z.enum(['reserved','armed','active'])}).strict().parse(input);
      return json(await renewPeerLinkedClaim(db,body,bridge));
    }
    if(operation.data==='claims/release'){
      const body=z.object({actorId:z.string().min(1).max(128),claim:coordinatorClaimSchema,reason:z.enum(['cancelled','completed','uncertain'])}).strict().parse(input);
      await releaseContactClaim(db,{actorUserId:await peerActorKey(grant,body.actorId)},body.claim,body.reason);
      return json({released:true});
    }
    if(operation.data==='claims/reconcile'){
      const body=z.object({actorId:z.string().min(1).max(128),attemptId:z.string().uuid(),resolution:z.enum(['not_dialed','call_finished'])}).strict().parse(input);
      await reconcileClaim(db,{actorUserId:await peerActorKey(grant,body.actorId)},body.attemptId,body.resolution);
      return json({released:true});
    }
    throw new PeerError('NOT_FOUND',404);
  }catch(error){
    if(error instanceof z.ZodError)return json({code:'INVALID_REQUEST',retryable:false},400);
    const known=error instanceof PeerError||error instanceof CallerError;
    return json({code:known?error.code:'PEER_UNAVAILABLE',retryable:!known||error.status>=500},known?error.status:503);
  }
}
