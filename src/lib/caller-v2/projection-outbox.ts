import type { CallerDb } from './database';
import { ENGINE_WORKSPACE } from './identity';
import { canonicalJson } from './canonical-json';
import type { CallerBridge } from './peer-contract';
import { flushProjectionOutbox,type ProjectionJob,type ProjectionStore } from './projection-runner';

export function engineProjectionStore(db:CallerDb):ProjectionStore {
  return {
    async due(now,limit){return (await db.prepare(`SELECT id FROM (SELECT deliveryKey AS id,nextAttemptAt AS due,0 AS priority FROM CallerStopDelivery WHERE workspaceId=? AND status IN ('pending','retry') AND nextAttemptAt<=? AND (leaseUntil IS NULL OR leaseUntil<=?) UNION ALL SELECT deliveryKey AS id,nextAttemptAt AS due,CASE WHEN json_extract(payloadJson,'$.stopScope')='contact' THEN 1 ELSE 2 END AS priority FROM CallerProjection WHERE workspaceId=? AND status IN ('pending','retry') AND nextAttemptAt<=? AND (leaseUntil IS NULL OR leaseUntil<=?)) ORDER BY priority,due,id LIMIT ?`)
      .bind(ENGINE_WORKSPACE,now,now,ENGINE_WORKSPACE,now,now,limit).all<{id:string}>()).results;},
    async claim(id,owner,now,leaseUntil){return db.prepare(`UPDATE ${id.startsWith('stop:')?'CallerStopDelivery':'CallerProjection'} SET leaseOwner=?,leaseUntil=?,attempts=attempts+1 WHERE workspaceId=? AND deliveryKey=?
      AND status IN ('pending','retry') AND nextAttemptAt<=? AND (leaseUntil IS NULL OR leaseUntil<=?)
      RETURNING deliveryKey AS id,grantId,payloadJson,payloadHash,attempts`).bind(owner,leaseUntil,ENGINE_WORKSPACE,id,now,now).first<ProjectionJob>();},
    async complete(id,owner,receipt){return Boolean(await db.prepare(`UPDATE ${id.startsWith('stop:')?'CallerStopDelivery':'CallerProjection'} SET status='synced',receiptJson=?,leaseOwner=NULL,leaseUntil=NULL,lastError=NULL WHERE workspaceId=? AND deliveryKey=? AND leaseOwner=? RETURNING deliveryKey`)
      .bind(canonicalJson(receipt),ENGINE_WORKSPACE,id,owner).first());},
    async fail(id,owner,failure){await db.prepare(`UPDATE ${id.startsWith('stop:')?'CallerStopDelivery':'CallerProjection'} SET status=?,nextAttemptAt=?,lastError=?,leaseOwner=NULL,leaseUntil=NULL WHERE workspaceId=? AND deliveryKey=? AND leaseOwner=?`)
      .bind(failure.status,failure.nextAttemptAt,failure.code,ENGINE_WORKSPACE,id,owner).run();},
  };
}
export const flushEngineProjectionOutbox=(db:CallerDb,bridge:CallerBridge,clock=Date.now)=>flushProjectionOutbox(engineProjectionStore(db),bridge,clock);
