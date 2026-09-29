import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb, AIDAN } from './test-database';
import { engineContactId } from './identity';
import { stageEngineLink, activateEngineLink } from './links';
import { peerGrant, type LinkIdentity } from './peer-contract';
import { claimEngineLinkedContact, claimPeerLinkedContact, renewEngineLinkedClaim, renewPeerLinkedClaim } from './linked-claims';
import { readEngineCallSource } from './source-state';
import { reconcileClaim } from './claims';

const NOW=Date.parse('2026-09-25T16:00:00Z');
async function fixture(){
  const t=openCallerTestDb();
  const grant=peerGrant({CALLER_PEER_GRANT_ID:crypto.randomUUID(),CALLER_PEER_SECRET:'ab'.repeat(32),CALLER_ORBIT_WORKSPACE_ID:'ws_a',CALLER_ORBIT_CONNECTION_ID:'orbit-fixture'});
  const link:LinkIdentity={linkId:crypto.randomUUID(),grantId:grant.grantId,engineContactKey:await engineContactId('fixture.example'),orbitContactId:crypto.randomUUID(),confirmed:true,
    engineRef:{system:'revenue-engine',workspaceId:'axiom',connectionId:'axiom-engine',entityType:'prospect',entityId:'fixture.example'},
    orbitRef:{system:'orbit',workspaceId:'ws_a',connectionId:'orbit-fixture',entityType:'prospect',entityId:'p_a'}};
  const pending=await stageEngineLink(t.db,AIDAN,grant,link,NOW);
  await activateEngineLink(t.db,AIDAN,grant,link,{...pending,state:'active',revision:2});
  let peerAvailable=true;
  const bridge={grant,send:async(operation:string,input:unknown)=>{
    assert.equal(operation,'source/check');assert.equal((input as {linkId:string}).linkId,link.linkId);
    if(!peerAvailable)throw new Error('offline');
    return {linkId:link.linkId,contactId:link.orbitContactId,source:link.orbitRef,revision:'a'.repeat(64)};
  }};
  const engine={entityId:'fixture.example',contactKey:link.engineContactKey,sourceRevision:(await readEngineCallSource(t.db,'fixture.example',NOW)).revision,attemptId:crypto.randomUUID()};
  const peer={linkId:link.linkId,source:link.orbitRef,actorId:'orbit-owner',sourceRevision:'a'.repeat(64),attemptId:crypto.randomUUID()};
  return {...t,bridge,link,engine,peer,offline:()=>{peerAvailable=false;}};
}

test('Engine and Orbit calls to an explicitly linked contact compete for one reservation',async()=>{
  const t=await fixture();try{
    const results=await Promise.allSettled([claimEngineLinkedContact(t.db,AIDAN,t.engine,t.bridge,NOW),claimPeerLinkedContact(t.db,t.peer,t.bridge,NOW)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerAttempt').get()?.n,1);
  }finally{t.close();}
});

test('Orbit-owned attempts retain source identity, cannot impersonate an Engine owner, and stay uncertain after heartbeat loss',async()=>{
  const t=await fixture();try{
    const reserved=await claimPeerLinkedContact(t.db,t.peer,t.bridge,NOW);
    assert.notEqual(reserved.ownerId,t.peer.actorId);assert.notEqual(reserved.ownerId,AIDAN.actorUserId);
    const armed=await renewPeerLinkedClaim(t.db,{actorId:t.peer.actorId,claim:reserved,state:'armed'},t.bridge,NOW+1000);
    await assert.rejects(renewEngineLinkedClaim(t.db,AIDAN,armed,'active',t.bridge,NOW+2000),/NOT_FOUND/);
    await assert.rejects(renewPeerLinkedClaim(t.db,{actorId:'other-user',claim:armed,state:'active'},t.bridge,NOW+2000),/NOT_FOUND/);
    await assert.rejects(claimEngineLinkedContact(t.db,AIDAN,t.engine,t.bridge,NOW+130000),/CLAIM_UNCERTAIN/);
    await reconcileClaim(t.db,{actorUserId:reserved.ownerId},reserved.attemptId,'call_finished',NOW+131000);
    assert.equal((await claimEngineLinkedContact(t.db,AIDAN,t.engine,t.bridge,NOW+132000)).state,'reserved');
  }finally{t.close();}
});

test('new linked permits fail closed if either source is stale, stopped, unavailable or outside the configured grant',async()=>{
  const t=await fixture();try{
    await assert.rejects(claimPeerLinkedContact(t.db,{...t.peer,sourceRevision:'b'.repeat(64)},t.bridge,NOW),/REVISION_CONFLICT/);
    await assert.rejects(claimPeerLinkedContact(t.db,{...t.peer,source:{...t.peer.source,workspaceId:'ws_b'}},t.bridge,NOW),/PEER_SCOPE|NOT_FOUND/);
    const reserved=await claimEngineLinkedContact(t.db,AIDAN,t.engine,t.bridge,NOW);
    t.offline();
    await assert.rejects(renewEngineLinkedClaim(t.db,AIDAN,reserved,'armed',t.bridge,NOW+1000),/PEER_UNAVAILABLE/);
    assert.equal(t.raw.prepare<[],{phase:string}>('SELECT phase FROM CallerAttempt').get()?.phase,'reserved');
  }finally{t.close();}
});
