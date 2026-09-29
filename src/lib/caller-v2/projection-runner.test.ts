import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb,AIDAN,engineResultFixture } from './test-database';
import { recordEngineResult } from './repository';
import { stageEngineLink,activateEngineLink } from './links';
import { engineContactId } from './identity';
import { peerGrant,PeerError,type CallerBridge,type LinkIdentity } from './peer-contract';
import { projectionHash,type CallProjection } from './projection-contract';
import { flushEngineProjectionOutbox,engineProjectionStore } from './projection-outbox';
import { setContactStop } from './claims';
import { stopProjectionHash,type StopProjection } from './stop-contract';

test('overlapping workers keep leases exclusive, stops go first, and an interrupted lease can recover',async()=>{
  const t=openCallerTestDb();try{
    const grant=peerGrant({CALLER_PEER_GRANT_ID:crypto.randomUUID(),CALLER_PEER_SECRET:'ab'.repeat(32),CALLER_ORBIT_WORKSPACE_ID:'ws_a',CALLER_ORBIT_CONNECTION_ID:'orbit-fixture'});
    const link:LinkIdentity={linkId:crypto.randomUUID(),grantId:grant.grantId,engineContactKey:await engineContactId('fixture.example'),orbitContactId:crypto.randomUUID(),confirmed:true,
      engineRef:{system:'revenue-engine',workspaceId:'axiom',connectionId:'axiom-engine',entityType:'prospect',entityId:'fixture.example'},orbitRef:{system:'orbit',workspaceId:'ws_a',connectionId:'orbit-fixture',entityType:'prospect',entityId:'p_a'}};
    const pending=await stageEngineLink(t.db,AIDAN,grant,link);await activateEngineLink(t.db,AIDAN,grant,link,{...pending,state:'active',revision:2});
    for(let i=0;i<12;i++)await recordEngineResult(t.db,AIDAN,await engineResultFixture(t.db));
    await setContactStop(t.db,AIDAN,link.engineContactKey,'Synthetic stop');
    let clock=Date.now()+1000;const store=engineProjectionStore(t.db);
    const first=(await store.due(new Date(clock).toISOString(),10))[0];assert.ok(first.id.startsWith('stop:'));
    await store.claim(first.id,'terminated-worker',new Date(clock).toISOString(),new Date(clock+35000).toISOString());
    const seen=new Set<string>();
    const bridge:CallerBridge={grant,send:async(_operation,input)=>{
      const p=input as CallProjection|StopProjection;assert.equal(seen.has(p.projectionId),false);seen.add(p.projectionId);
      await new Promise(resolve=>setTimeout(resolve,2));
      return {protocol:p.protocol,projectionId:p.projectionId,originEventId:p.originEventId,attemptId:p.attemptId,payloadHash:await (p.protocol==='axiom-caller-stop/1'?stopProjectionHash(p):projectionHash(p)),receivedAt:new Date(clock).toISOString(),status:'saved'};
    }};
    await Promise.all([flushEngineProjectionOutbox(t.db,bridge,()=>clock),flushEngineProjectionOutbox(t.db,bridge,()=>clock)]);
    assert.equal(seen.has(first.id.slice(5)),false);
    clock+=35001;await flushEngineProjectionOutbox(t.db,bridge,()=>clock);assert.equal(seen.has(first.id.slice(5)),true);
    await flushEngineProjectionOutbox(t.db,bridge,()=>clock);assert.equal(seen.size,13);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT MAX(attempts) n FROM CallerProjection').get()?.n,1);
    assert.equal(t.raw.prepare<[],{attempts:number}>('SELECT attempts FROM CallerStopDelivery').get()?.attempts,2);
  }finally{t.close();}
});

test('outbox leases at most ten jobs with concurrency two; exact receipts complete individual jobs without truncating the queue',async()=>{
  const t=openCallerTestDb();try{
    const grant=peerGrant({CALLER_PEER_GRANT_ID:crypto.randomUUID(),CALLER_PEER_SECRET:'ab'.repeat(32),CALLER_ORBIT_WORKSPACE_ID:'ws_a',CALLER_ORBIT_CONNECTION_ID:'orbit-fixture'});
    const link:LinkIdentity={linkId:crypto.randomUUID(),grantId:grant.grantId,engineContactKey:await engineContactId('fixture.example'),orbitContactId:crypto.randomUUID(),confirmed:true,
      engineRef:{system:'revenue-engine',workspaceId:'axiom',connectionId:'axiom-engine',entityType:'prospect',entityId:'fixture.example'},
      orbitRef:{system:'orbit',workspaceId:'ws_a',connectionId:'orbit-fixture',entityType:'prospect',entityId:'p_a'}};
    const pending=await stageEngineLink(t.db,AIDAN,grant,link);await activateEngineLink(t.db,AIDAN,grant,link,{...pending,state:'active',revision:2});
    for(let n=0;n<12;n++)await recordEngineResult(t.db,AIDAN,await engineResultFixture(t.db));
    let concurrent=0,peak=0;const seen=new Set<string>();
    const bridge:CallerBridge={grant,send:async(operation,input)=>{
      assert.equal(operation,'projections');const p=input as CallProjection;
      concurrent++;peak=Math.max(peak,concurrent);await new Promise(resolve=>setTimeout(resolve,5));concurrent--;
      const status=seen.has(p.projectionId)?'already_saved':'saved';seen.add(p.projectionId);
      return {protocol:'axiom-caller-projection/1',projectionId:p.projectionId,originEventId:p.originEventId,attemptId:p.attemptId,payloadHash:await projectionHash(p),receivedAt:new Date().toISOString(),status};
    }};
    const result=await flushEngineProjectionOutbox(t.db,bridge);
    assert.equal(result.synced,10);assert.equal(peak,2);
    assert.equal(t.raw.prepare<[],{n:number}>("SELECT COUNT(*) n FROM CallerProjection WHERE status='pending'").get()?.n,2);
    const rest=await flushEngineProjectionOutbox(t.db,bridge);assert.equal(rest.synced,2);assert.equal(seen.size,12);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerProjection').get()?.n,12);
  }finally{t.close();}
});

test('wrong receipts and revoked grants remain reviewable; transient lost responses retry the exact projection',async()=>{
  const t=openCallerTestDb();try{
    const grant=peerGrant({CALLER_PEER_GRANT_ID:crypto.randomUUID(),CALLER_PEER_SECRET:'ab'.repeat(32),CALLER_ORBIT_WORKSPACE_ID:'ws_a',CALLER_ORBIT_CONNECTION_ID:'orbit-fixture'});
    const link:LinkIdentity={linkId:crypto.randomUUID(),grantId:grant.grantId,engineContactKey:await engineContactId('fixture.example'),orbitContactId:crypto.randomUUID(),confirmed:true,
      engineRef:{system:'revenue-engine',workspaceId:'axiom',connectionId:'axiom-engine',entityType:'prospect',entityId:'fixture.example'},orbitRef:{system:'orbit',workspaceId:'ws_a',connectionId:'orbit-fixture',entityType:'prospect',entityId:'p_a'}};
    const pending=await stageEngineLink(t.db,AIDAN,grant,link);await activateEngineLink(t.db,AIDAN,grant,link,{...pending,state:'active',revision:2});
    await recordEngineResult(t.db,AIDAN,await engineResultFixture(t.db));
    let original='';
    await flushEngineProjectionOutbox(t.db,{grant,send:async(_op,payload)=>{original=JSON.stringify(payload);throw new PeerError('PEER_UNAVAILABLE',503);}});
    assert.equal(t.raw.prepare<[],{status:string}>('SELECT status FROM CallerProjection').get()?.status,'retry');
    t.raw.exec("UPDATE CallerProjection SET nextAttemptAt='2000-01-01T00:00:00.000Z'");
    await flushEngineProjectionOutbox(t.db,{grant,send:async(_op,payload)=>{assert.equal(JSON.stringify(payload),original);return {saved:true};}});
    assert.equal(t.raw.prepare<[],{status:string}>('SELECT status FROM CallerProjection').get()?.status,'review');
    t.raw.exec("UPDATE CallerProjection SET status='pending',nextAttemptAt='2000-01-01T00:00:00.000Z'");
    await flushEngineProjectionOutbox(t.db,{grant:{...grant,grantId:crypto.randomUUID()},send:async()=>{throw new Error('Must not send under another grant');}});
    assert.equal(t.raw.prepare<[],{status:string}>('SELECT status FROM CallerProjection').get()?.status,'auth_required');
  }finally{t.close();}
});
