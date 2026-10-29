import type { CallerDb } from './database';
import { peerGrant,requestPeer } from './peer-contract';
import { flushEngineProjectionOutbox } from './projection-outbox';

export async function runCallerSyncTick(db:CallerDb,env:unknown,fetcher=fetch) {
  if(!env||typeof env!=='object'||!('CALLER_SYNC_ENABLED' in env)||env.CALLER_SYNC_ENABLED!=='true')
    return {enabled:false,attempted:0,synced:0,pending:0,needsReview:0};
  const grant=peerGrant(env);
  return {enabled:true,...await flushEngineProjectionOutbox(db,{grant,send:(op,payload)=>requestPeer(grant,'orbit',op,payload,fetcher)})};
}
