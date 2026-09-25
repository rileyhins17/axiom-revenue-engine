import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { CallerDb } from './database';
import { runCallerSyncTick } from './sync-tick';

test('the sync watchdog is strictly off by default and performs no database reads or writes',async()=>{
  const db={prepare(){throw new Error('Disabled tick accessed database');},batch(){throw new Error('Disabled tick wrote database');}} as unknown as CallerDb;
  for(const env of [{},{CALLER_SYNC_ENABLED:'false'},{CALLER_SYNC_ENABLED:'1'},{CALLER_SYNC_ENABLED:true}]){
    assert.deepEqual(await runCallerSyncTick(db,env),{enabled:false,attempted:0,synced:0,pending:0,needsReview:0});
  }
  await assert.rejects(runCallerSyncTick(db,{CALLER_SYNC_ENABLED:'true'}),/PEER_NOT_CONFIGURED/);
});

test('the actual worker routes a Caller minute tick only to sync and never into discovery or email',async()=>{
  const source=readFileSync(new URL('../../../worker.mjs',import.meta.url),'utf8')
    .replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm,'')
    .replace(/^export \{[^}]+\};\s*/gm,'')
    .replace('export default exportedWorker;','return exportedWorker;');
  let sync=0;const tasks:Promise<unknown>[]=[];
  const worker=new Function('deps',`const {openNextWorkerModule,setCloudflareBindings,clearServerEnvCache,runEngineEmailCron,getCronTimeoutBudgets,runCallerSyncTick}=deps;\n${source}`)({
    openNextWorkerModule:{},setCloudflareBindings:()=>{},clearServerEnvCache:()=>{},
    runEngineEmailCron:()=>{throw new Error('Email must not run');},getCronTimeoutBudgets:()=>{throw new Error('Discovery must not run');},
    runCallerSyncTick:async()=>{sync++;return {enabled:false,attempted:0,synced:0,pending:0,needsReview:0};},
  });
  await worker.scheduled({cron:'* * * * *'},{},{waitUntil:(p:Promise<unknown>)=>tasks.push(p)});
  await Promise.all(tasks);assert.equal(sync,1);
});
