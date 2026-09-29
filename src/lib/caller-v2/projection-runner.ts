import { parseStopProjection,stopProjectionHash,stopReceiptSchema,type StopReceipt } from './stop-contract';
import { PeerError,type CallerBridge } from './peer-contract';
import { parseProjection,projectionHash,projectionReceiptSchema,type ProjectionReceipt } from './projection-contract';

export type ProjectionJob={id:string;grantId:string;payloadJson:string;payloadHash:string;attempts:number};
export type ProjectionFailure={status:'retry'|'review'|'auth_required';code:string;nextAttemptAt:string};
export interface ProjectionStore {
  due(now:string,limit:number):Promise<{id:string}[]>;
  claim(id:string,owner:string,now:string,leaseUntil:string):Promise<ProjectionJob|null>;
  complete(id:string,owner:string,receipt:ProjectionReceipt|StopReceipt):Promise<boolean>;
  fail(id:string,owner:string,failure:ProjectionFailure):Promise<void>;
}
const retryCodes=new Set(['PEER_UNAVAILABLE','PEER_NOT_CONFIGURED','MISSING_ORIGIN','LINK_CHECK_REQUIRED']);
const authCodes=new Set(['PEER_AUTH_REQUIRED','PEER_SCOPE','GRANT_CHANGED']);
const safeCodes=new Set([...retryCodes,...authCodes,'NOT_FOUND','REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','INVALID_PROJECTION','INVALID_RECEIPT']);
/** Shared bounded worker; both sources retain their own authoritative outbox. */
export async function flushProjectionOutbox(store:ProjectionStore,bridge:CallerBridge,clock=Date.now) {
  const started=clock(),owner=crypto.randomUUID(),jobs=await store.due(new Date(started).toISOString(),10);
  const report={attempted:0,synced:0,pending:0,needsReview:0};let index=0;
  const worker=async()=>{
    for(;;){
      if(clock()-started>=25_000)return;
      const candidate=jobs[index++];if(!candidate)return;
      const now=clock(),job=await store.claim(candidate.id,owner,new Date(now).toISOString(),new Date(now+35_000).toISOString());
      if(!job)continue;
      report.attempted++;
      try {
        if(job.grantId!==bridge.grant.grantId)throw new PeerError('GRANT_CHANGED',401);
        let payload;
        try{payload=job.id.startsWith('stop:')?parseStopProjection(JSON.parse(job.payloadJson)):parseProjection(JSON.parse(job.payloadJson));}catch{throw new PeerError('INVALID_PROJECTION',422);}
        if(payload.grantId!==job.grantId||(payload.protocol==='axiom-caller-stop/1'?'stop:'+payload.projectionId:payload.projectionId)!==job.id||(await (payload.protocol==='axiom-caller-stop/1'?stopProjectionHash(payload):projectionHash(payload)))!==job.payloadHash)throw new PeerError('INVALID_PROJECTION',422);
        let timer:ReturnType<typeof setTimeout>|undefined;
        const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new PeerError('PEER_UNAVAILABLE',503)),Math.min(5000,Math.max(1,30_000-(clock()-started))));});
        let response:unknown;
        try{response=await Promise.race([bridge.send(payload.protocol==='axiom-caller-stop/1'?'stop':'projections',payload),timeout]);}finally{if(timer!==undefined)clearTimeout(timer);}
        const receipt=(payload.protocol==='axiom-caller-stop/1'?stopReceiptSchema:projectionReceiptSchema).safeParse(response);
        if(!receipt.success||receipt.data.projectionId!==payload.projectionId||receipt.data.originEventId!==payload.originEventId||receipt.data.attemptId!==payload.attemptId||receipt.data.payloadHash!==job.payloadHash)throw new PeerError('INVALID_RECEIPT',422);
        if(await store.complete(job.id,owner,receipt.data))report.synced++;else report.pending++;
      }catch(error){
        const code=error instanceof PeerError&&safeCodes.has(error.code)?error.code:'PEER_UNAVAILABLE';
        const status=authCodes.has(code)?'auth_required':retryCodes.has(code)?'retry':'review';
        const delay=Math.min(3_600_000,2000*2**Math.min(job.attempts,10));
        await store.fail(job.id,owner,{status,code,nextAttemptAt:new Date(clock()+delay).toISOString()});
        if(status==='retry')report.pending++;else report.needsReview++;
      }
    }
  };
  await Promise.all([worker(),worker()]);
  return report;
}
