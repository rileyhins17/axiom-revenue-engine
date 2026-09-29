import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb, engineResultFixture, AIDAN } from './test-database';
import { recordEngineResult } from './repository';
import { engineContactId } from './identity';
import { stageEngineLink, activateEngineLink, getEngineContactLink } from './links';
import { signPeerCommand, verifyPeerCommand, peerGrant, type LinkIdentity } from './peer-contract';
import { claimContact, setContactStop } from './claims';
import { readEngineCallSource } from './source-state';

const NOW=Date.parse('2026-09-25T16:00:00Z');
const ENV={CALLER_PEER_GRANT_ID:'11111111-1111-4111-8111-111111111111',CALLER_PEER_SECRET:'ab'.repeat(32),CALLER_ORBIT_WORKSPACE_ID:'ws_a',CALLER_ORBIT_CONNECTION_ID:'orbit-fixture'};
const grant=()=>peerGrant(ENV);
async function link():Promise<LinkIdentity>{return {linkId:crypto.randomUUID(),grantId:ENV.CALLER_PEER_GRANT_ID,
  engineRef:{system:'revenue-engine',connectionId:'axiom-engine',workspaceId:'axiom',entityType:'prospect',entityId:'fixture.example'},
  orbitRef:{system:'orbit',connectionId:'orbit-fixture',workspaceId:'ws_a',entityType:'prospect',entityId:'prospect-fixture'},
  engineContactKey:await engineContactId('fixture.example'),orbitContactId:'22222222-2222-4222-8222-222222222222',confirmed:true};}

test('peer commands bind operation, exact workspaces, grant and payload; revocation fails closed',async()=>{
  const g=grant(),signed=await signPeerCommand(g,'links/stage',await link(),NOW);
  assert.deepEqual(await verifyPeerCommand(g,'links/stage',signed,NOW),signed.payload);
  await assert.rejects(verifyPeerCommand(g,'links/activate',signed,NOW),/PEER_AUTH_REQUIRED/);
  await assert.rejects(verifyPeerCommand(g,'links/stage',{...signed,payload:{...signed.payload,confirmed:false}},NOW),/PEER_AUTH_REQUIRED/);
  await assert.rejects(verifyPeerCommand({...g,orbitWorkspaceId:'ws_b'},'links/stage',signed,NOW),/PEER_AUTH_REQUIRED/);
  await assert.rejects(verifyPeerCommand({...g,engineConnectionId:'other-engine'},'links/stage',signed,NOW),/PEER_AUTH_REQUIRED/);
  await assert.rejects(verifyPeerCommand({...g,secret:'cd'.repeat(32)},'links/stage',signed,NOW),/PEER_AUTH_REQUIRED/);
  await assert.rejects(verifyPeerCommand(g,'links/stage',signed,NOW+61_000),/PEER_AUTH_REQUIRED/);
  assert.throws(()=>peerGrant({...ENV,CALLER_PEER_SECRET:''}),/PEER_NOT_CONFIGURED/);
});

test('linking is explicit, idempotent and cannot silently choose another business or contact',async()=>{
  const t=openCallerTestDb();try{
    const l=await link();assert.equal(await getEngineContactLink(t.db,l.engineContactKey),null);
    await assert.rejects(stageEngineLink(t.db,AIDAN,grant(),{...l,confirmed:false} as never,NOW));
    const first=await stageEngineLink(t.db,AIDAN,grant(),l,NOW);
    assert.equal(first.state,'pending');assert.deepEqual(await stageEngineLink(t.db,AIDAN,grant(),l,NOW),first);
    await assert.rejects(stageEngineLink(t.db,AIDAN,grant(),{...l,orbitContactId:crypto.randomUUID()},NOW),/LINK_CONFLICT/);
    await assert.rejects(stageEngineLink(t.db,AIDAN,grant(),{...l,linkId:crypto.randomUUID()},NOW),/LINK_CONFLICT/);
    await assert.rejects(stageEngineLink(t.db,AIDAN,grant(),{...l,orbitRef:{...l.orbitRef,workspaceId:'ws_b'}},NOW),/PEER_SCOPE/);
    const active=await activateEngineLink(t.db,AIDAN,grant(),l,{...first,state:'active',revision:2});
    assert.equal(active.state,'active');assert.deepEqual(await activateEngineLink(t.db,AIDAN,grant(),l,{...first,state:'active',revision:2}),active);
  }finally{t.close();}
});

test('pending or active links cannot bypass peer checks through ordinary claims or manual calls',async()=>{
  const t=openCallerTestDb();try{
    const l=await link();await stageEngineLink(t.db,AIDAN,grant(),l,NOW);
    const source=await readEngineCallSource(t.db,'fixture.example',NOW);
    await assert.rejects(claimContact(t.db,AIDAN,{entityId:'fixture.example',contactKey:l.engineContactKey,sourceRevision:source.revision,attemptId:crypto.randomUUID()},NOW),/LINK_CHECK_REQUIRED/);
    assert.throws(()=>t.raw.prepare("INSERT INTO EngineProspectActivity(activityId,prospectId,channel,outcome,note,actor,actorUserId,createdAt) VALUES('manual','fixture.example','CALL','NO_ANSWER','','AIDAN','user-aidan','2026-09-25')").run(),/CALLER_LINK_REQUIRED/);
  }finally{t.close();}
});

test('a contact cannot be linked while another call may be active; missing sources never acquire a mapping',async()=>{
  const t=openCallerTestDb();try{
    const l=await link(),source=await readEngineCallSource(t.db,'fixture.example',NOW);
    await claimContact(t.db,AIDAN,{entityId:'fixture.example',contactKey:l.engineContactKey,sourceRevision:source.revision,attemptId:crypto.randomUUID()},NOW);
    await assert.rejects(stageEngineLink(t.db,AIDAN,grant(),l,NOW),/CLAIM_HELD/);
    assert.equal(await getEngineContactLink(t.db,l.engineContactKey),null);
    await assert.rejects(stageEngineLink(t.db,AIDAN,grant(),{...l,engineRef:{...l.engineRef,entityId:'missing.example'},engineContactKey:await engineContactId('missing.example')},NOW),/NOT_FOUND/);
  }finally{t.close();}
});

test('a link committed between preparation and reservation wins atomically over the standalone claim',async()=>{
  const t=openCallerTestDb();try{
    const l=await link(),source=await readEngineCallSource(t.db,'fixture.example',NOW);
    let injected=false;
    const db={...t.db,batch:async(statements:Parameters<typeof t.db.batch>[0])=>{
      if(!injected&&statements.length===4){injected=true;await stageEngineLink(t.db,AIDAN,grant(),l,NOW);}
      return t.db.batch(statements);
    }};
    await assert.rejects(claimContact(db,AIDAN,{entityId:'fixture.example',contactKey:l.engineContactKey,sourceRevision:source.revision,attemptId:crypto.randomUUID()},NOW),/REVISION_CONFLICT|LINK_CHECK_REQUIRED/);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerAttempt').get()?.n,0);
  }finally{t.close();}
});

test('a stop and new link racing in either order retain a durable stop delivery',async()=>{
  for(const order of ['stop-before-link','link-before-stop']){
    const t=openCallerTestDb();try{
      const l=await link();let injected=false;
      const db={...t.db,batch:async(statements:Parameters<typeof t.db.batch>[0])=>{
        if(!injected){injected=true;
          if(order==='stop-before-link')await setContactStop(t.db,AIDAN,l.engineContactKey,'Stop',NOW,l.engineRef.entityId);
          else await stageEngineLink(t.db,AIDAN,grant(),l,NOW);
        }
        return t.db.batch(statements);
      }};
      if(order==='stop-before-link')await stageEngineLink(db,AIDAN,grant(),l,NOW);
      else await setContactStop(db,AIDAN,l.engineContactKey,'Stop',NOW,l.engineRef.entityId);
      assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerStopDelivery').get()?.n,1,order);
      assert.equal(t.raw.prepare<[],{stopped:number}>('SELECT stopped FROM CallerContactControl').get()?.stopped,1);
      assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerResult').get()?.n,0);
    }finally{t.close();}
  }
});

test('a DNC correction racing with link creation retries its atomic result and stop together',async()=>{
  const t=openCallerTestDb();try{
    const original=await engineResultFixture(t.db,{outcome:'connected',nextAction:null});await recordEngineResult(t.db,AIDAN,original);
    const l=await link();let injected=false;
    const db={...t.db,batch:async(statements:Parameters<typeof t.db.batch>[0])=>{
      if(!injected){injected=true;await stageEngineLink(t.db,AIDAN,grant(),l,NOW);}return t.db.batch(statements);
    }};
    const correction={...original,eventId:crypto.randomUUID(),correctionOf:original.eventId,outcome:'do_not_contact' as const,stopScope:'contact' as const};
    await recordEngineResult(db,AIDAN,correction);await recordEngineResult(db,AIDAN,correction);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerStopDelivery').get()?.n,1);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerResult').get()?.n,2);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerProjection').get()?.n,2,'The newly linked peer also needs the correction parent');
    assert.equal(t.raw.prepare<[],{stopRevision:number}>('SELECT stopRevision FROM CallerContactControl').get()?.stopRevision,1);
  }finally{t.close();}
});

test('an ordinary correction racing with link creation retries its atomic result and stop together',async()=>{
  const t=openCallerTestDb();try{
    const original=await engineResultFixture(t.db,{outcome:'connected',nextAction:null});await recordEngineResult(t.db,AIDAN,original);
    const l=await link();let injected=false;
    const db={...t.db,batch:async(statements:Parameters<typeof t.db.batch>[0])=>{
      if(!injected){injected=true;await stageEngineLink(t.db,AIDAN,grant(),l,NOW);}return t.db.batch(statements);
    }};
    const correction={...original,eventId:crypto.randomUUID(),correctionOf:original.eventId,outcome:'connected' as const,stopScope:'none' as const};
    await recordEngineResult(db,AIDAN,correction);await recordEngineResult(db,AIDAN,correction);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerStopDelivery').get()?.n,0);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerResult').get()?.n,2);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerProjection').get()?.n,2,'The newly linked peer also needs the correction parent');
    assert.equal(t.raw.prepare<[],{stopRevision:number}>('SELECT stopRevision FROM CallerContactControl').get()?.stopRevision??0,0);
  }finally{t.close();}
});
