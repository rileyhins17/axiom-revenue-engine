import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb,AIDAN,engineResultFixture } from './test-database';
import { engineContactId } from './identity';
import { stageEngineLink,activateEngineLink } from './links';
import { peerGrant,type LinkIdentity } from './peer-contract';
import { recordEngineResult } from './repository';
import { makeCallProjection,parseProjection,projectionHash } from './projection-contract';
import { acceptEngineProjection } from './projection';
import { setContactStop } from './claims';
import { listProspectActivity } from '../revenue-engine/engine-prospects-d1';
import { callerResultStats } from './repository';
import { readEngineCallSource } from './source-state';

test('mirrored physical history affects existing history, totals and callback eligibility without disclosing Orbit notes',async()=>{
  const t=await fixture();try{
    const event=await engineResultFixture(t.db,{source:t.link.orbitRef,contactId:t.link.orbitContactId,summary:'Private Orbit information'});
    const p=await makeCallProjection(t.link,'orbit-owner',event,'a'.repeat(64));
    await acceptEngineProjection(t.db,t.grant,p);
    const history=await listProspectActivity(t.db,'fixture.example');assert.equal(history.length,1);assert.ok(!JSON.stringify(history).includes('Private Orbit'));
    assert.equal(history[0].createdAt,event.occurredAt);
    assert.equal((await callerResultStats(t.db,'2000-01-01')).attempts,1);
    assert.equal((await readEngineCallSource(t.db,'fixture.example',Date.parse(event.occurredAt))).callable,false);
    assert.equal((await readEngineCallSource(t.db,'fixture.example',Date.parse('2026-09-25T17:14:00Z'))).callable,false);
    assert.equal((await readEngineCallSource(t.db,'fixture.example',Date.parse('2026-09-25T17:16:00Z'))).callable,true);
    const correction=await makeCallProjection(t.link,'orbit-owner',{...event,eventId:crypto.randomUUID(),correctionOf:event.eventId,summary:'Corrected private text'},'b'.repeat(64));
    await acceptEngineProjection(t.db,t.grant,correction);
    assert.equal((await listProspectActivity(t.db,'fixture.example')).length,1);
    assert.equal((await callerResultStats(t.db,'2000-01-01')).attempts,1);
  }finally{t.close();}
});

test('a standalone contact stop commits a priority delivery without inventing a call',async()=>{
  const t=await fixture();try{
    await setContactStop(t.db,AIDAN,t.link.engineContactKey,'Requested no further calls',Date.now(),'fixture.example');
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerStopDelivery').get()?.n,1);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerResult').get()?.n,0);
    t.raw.exec("CREATE TRIGGER stop_disk_error BEFORE INSERT ON CallerStopDelivery BEGIN SELECT RAISE(ABORT,'DISK_ERROR'); END;");
    const before=t.raw.prepare<[],{revision:number}>('SELECT revision FROM CallerContactControl').get()!.revision;
    await assert.rejects(setContactStop(t.db,AIDAN,t.link.engineContactKey,'Second request'),/DISK_ERROR/);
    assert.equal(t.raw.prepare<[],{revision:number}>('SELECT revision FROM CallerContactControl').get()!.revision,before);
  }finally{t.close();}
});

async function fixture(){
  const t=openCallerTestDb();
  const grant=peerGrant({CALLER_PEER_GRANT_ID:crypto.randomUUID(),CALLER_PEER_SECRET:'ab'.repeat(32),CALLER_ORBIT_WORKSPACE_ID:'ws_a',CALLER_ORBIT_CONNECTION_ID:'orbit-fixture'});
  const link:LinkIdentity={linkId:crypto.randomUUID(),grantId:grant.grantId,engineRef:{system:'revenue-engine',connectionId:'axiom-engine',workspaceId:'axiom',entityType:'prospect',entityId:'fixture.example'},
    orbitRef:{system:'orbit',connectionId:'orbit-fixture',workspaceId:'ws_a',entityType:'prospect',entityId:'p_a'},engineContactKey:await engineContactId('fixture.example'),orbitContactId:crypto.randomUUID(),confirmed:true};
  const pending=await stageEngineLink(t.db,AIDAN,grant,link);
  await activateEngineLink(t.db,AIDAN,grant,link,{...pending,state:'active',revision:2});
  return {...t,grant,link};
}
test('source result, activity and linked projection commit once as one atomic command',async()=>{
  const t=await fixture();try{
    const event=await engineResultFixture(t.db);
    const first=await recordEngineResult(t.db,AIDAN,event);await recordEngineResult(t.db,AIDAN,event);
    const jobs=t.raw.prepare<[],{payloadJson:string;payloadHash:string}>('SELECT * FROM CallerProjection').all();
    assert.equal(jobs.length,1);
    const payload=parseProjection(JSON.parse(jobs[0].payloadJson));
    assert.equal(payload.originEventId,event.eventId);assert.equal(payload.originPayloadHash,first.payloadHash);assert.equal(payload.summary,event.summary);
    assert.equal(jobs[0].payloadHash,await projectionHash(payload));
    const next=await engineResultFixture(t.db);
    t.raw.exec("CREATE TRIGGER projection_disk_error BEFORE INSERT ON CallerProjection BEGIN SELECT RAISE(ABORT,'DISK_ERROR'); END;");
    await assert.rejects(recordEngineResult(t.db,AIDAN,next),/DISK_ERROR/);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerResult').get()?.n,1);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM EngineProspectActivity').get()?.n,1);
  }finally{t.close();}
});
test('Orbit projection excludes private notes and commercial decisions, preserves exact callback, and rejects loops',async()=>{
  const t=await fixture();try{
    const event=await engineResultFixture(t.db,{source:t.link.orbitRef,contactId:t.link.orbitContactId,summary:'Private client notes and proposal details'});
    const projection=await makeCallProjection(t.link,'orbit-owner',event,'a'.repeat(64));
    assert.equal(projection.summary,'');assert.deepEqual(projection.nextAction,event.nextAction);
    assert.equal(JSON.stringify(projection).includes('Private client'),false);
    assert.throws(()=>parseProjection({...projection,decisions:[]}));
    assert.throws(()=>parseProjection({...projection,targetSystem:'orbit'}),/PROJECTION_LOOP/);
  }finally{t.close();}
});
test('peer receipts are independent of source receipts; duplicate delivery never repeats domain actions and corrections require their original',async()=>{
  const t=await fixture();try{
    const event=await engineResultFixture(t.db,{source:t.link.orbitRef,contactId:t.link.orbitContactId,outcome:'do_not_contact',stopScope:'contact'});
    const payload=await makeCallProjection(t.link,'orbit-owner',event,'a'.repeat(64));
    const first=await acceptEngineProjection(t.db,t.grant,payload);
    assert.equal(first.payloadHash,await projectionHash(payload));assert.notEqual(first.payloadHash,'a'.repeat(64));
    assert.equal((await acceptEngineProjection(t.db,t.grant,payload)).status,'already_saved');
    await assert.rejects(acceptEngineProjection(t.db,t.grant,{...payload,originPayloadHash:'b'.repeat(64)}),/IDEMPOTENCY_CONFLICT/);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerMirror').get()?.n,1);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerProjection').get()?.n,0);
    assert.equal(t.raw.prepare<[],{stopped:number}>('SELECT stopped FROM CallerContactControl').get()?.stopped,1);
    const correction=await makeCallProjection(t.link,'orbit-owner',{...event,eventId:crypto.randomUUID(),correctionOf:crypto.randomUUID()},'b'.repeat(64));
    await assert.rejects(acceptEngineProjection(t.db,t.grant,correction),/MISSING_ORIGIN/);
    await assert.rejects(acceptEngineProjection(t.db,{...t.grant,grantId:crypto.randomUUID()},payload),/PEER_SCOPE/);
  }finally{t.close();}
});
test('a link changed between projection validation and commit cannot receive a success receipt',async()=>{
  const t=await fixture();try{
    const event=await engineResultFixture(t.db,{source:t.link.orbitRef,contactId:t.link.orbitContactId});
    const payload=await makeCallProjection(t.link,'orbit-owner',event,'a'.repeat(64));
    const db={...t.db,batch:async(statements:Parameters<typeof t.db.batch>[0])=>{t.raw.exec("UPDATE CallerSourceLink SET state='pending',revision=1");return t.db.batch(statements);}};
    await assert.rejects(acceptEngineProjection(db,t.grant,payload),/LINK_CHECK_REQUIRED/);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerMirror').get()?.n,0);
  }finally{t.close();}
});


test('unresolved precise callbacks remain blocked after the agreed date begins',async()=>{
  for(const [localDate,localTime] of [['2026-11-01','01:30'],['2027-03-14','02:30']]){
    const f=openCallerTestDb();try{
      const event=await engineResultFixture(f.db,{outcome:'callback',nextAction:{kind:'agreed_callback',description:'Original agreed clock',originalWords:'The agreed local clock time',localDate,localTime,timeZone:'America/Toronto',utcOffset:null,precision:'time',windowEndLocalTime:null,scheduledAt:null,timeStatus:'needs_review',provenance:'operator'}});
      await recordEngineResult(f.db,AIDAN,event);
      assert.equal((await readEngineCallSource(f.db,'fixture.example',Date.parse(localDate+'T05:00:00Z'))).callable,false);
    }finally{f.close();}
  }
});
