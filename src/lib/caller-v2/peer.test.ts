import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb,AIDAN } from './test-database';
import { engineContactId } from './identity';
import { createSourceLink } from './link-workflow';
import { handleEnginePeerRequest } from './peer';
import { peerGrant,signPeerCommand,type LinkIdentity,type PeerOperation } from './peer-contract';

const NOW=Date.now();
const env={CALLER_PEER_GRANT_ID:'11111111-1111-4111-8111-111111111111',CALLER_PEER_SECRET:'ab'.repeat(32),CALLER_ORBIT_WORKSPACE_ID:'ws_a',CALLER_ORBIT_CONNECTION_ID:'orbit-fixture'};
const grant=peerGrant(env);
async function link():Promise<LinkIdentity>{return {linkId:crypto.randomUUID(),grantId:grant.grantId,engineContactKey:await engineContactId('fixture.example'),orbitContactId:crypto.randomUUID(),confirmed:true,
  engineRef:{system:'revenue-engine',connectionId:'axiom-engine',workspaceId:'axiom',entityType:'prospect',entityId:'fixture.example'},
  orbitRef:{system:'orbit',connectionId:'orbit-fixture',workspaceId:'ws_a',entityType:'prospect',entityId:'p_a'}};}

test('one-sided handshake failure remains pending and the same link resumes without another mapping',async()=>{
  const t=openCallerTestDb();try{
    const identity=await link();let fail=true;const calls:PeerOperation[]=[];
    const bridge={grant,send:async(operation:PeerOperation)=>{calls.push(operation);if(operation==='links/activate'&&fail)throw new Error('offline');return {...identity,state:operation==='links/activate'?'active':'pending',revision:operation==='links/activate'?2:1};}};
    await assert.rejects(createSourceLink(t.db,AIDAN,identity,bridge,NOW),/PEER_UNAVAILABLE/);
    assert.equal(t.raw.prepare<[],{state:string}>('SELECT state FROM CallerSourceLink').get()?.state,'pending');
    fail=false;assert.equal((await createSourceLink(t.db,AIDAN,identity,bridge,NOW)).state,'active');
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerSourceLink').get()?.n,1);
    assert.deepEqual(calls,['links/stage','links/activate','links/stage','links/activate']);
  }finally{t.close();}
});

test('peer route accepts only signed scoped requests, never an ordinary Caller bearer or arbitrary operation',async()=>{
  const t=openCallerTestDb();try{
    const body={actorId:'orbit-owner',attemptId:crypto.randomUUID(),resolution:'call_finished'};
    const req=(value:unknown)=>new Request('https://operations.getaxiom.ca/api/caller/v2/peer/claims/reconcile',{method:'POST',headers:{Authorization:'Bearer ordinary-caller-key'},body:JSON.stringify(value)});
    assert.equal((await handleEnginePeerRequest(t.db,req(body),'claims/reconcile',env)).status,401);
    const signed=await signPeerCommand(grant,'claims/reconcile',body,NOW);
    const response=await handleEnginePeerRequest(t.db,req(signed),'claims/reconcile',env);
    assert.equal(response.status,404);assert.match(response.headers.get('cache-control')!,/no-store/);
    assert.equal((await handleEnginePeerRequest(t.db,req(signed),'claims/reconcile',{...env,CALLER_ORBIT_WORKSPACE_ID:'ws_b'})).status,401);
    assert.equal((await handleEnginePeerRequest(t.db,req(signed),'unknown',env)).status,404);
    assert.equal((await handleEnginePeerRequest(t.db,req(signed),'claims/reconcile',{})).status,503);
  }finally{t.close();}
});
