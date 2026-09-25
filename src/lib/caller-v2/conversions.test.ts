import test from 'node:test';
import assert from 'node:assert/strict';
import {openCallerTestDb,AIDAN} from './test-database';
import {peerGrant,type CallerBridge} from './peer-contract';
import {readEngineCallSource} from './source-state';
import {engineContactId} from './identity';
import {prepareEngineCall} from './source';
import {requestOrbitConversion,resumeOrbitConversion,engineConversionContext,reserveEngineConversionLink} from './conversions';
import {resultPayloadHash} from './canonical-json';
import {nextInQueue} from '../revenue-engine/engine-prospects-d1';

function grant(){return peerGrant({CALLER_PEER_GRANT_ID:crypto.randomUUID(),CALLER_PEER_SECRET:'ab'.repeat(32),CALLER_ORBIT_WORKSPACE_ID:'ws_a',CALLER_ORBIT_CONNECTION_ID:'orbit-fixture'});}
async function command(db:ReturnType<typeof openCallerTestDb>['db']){
  return {conversionId:crypto.randomUUID(),engineSource:{system:'revenue-engine',workspaceId:'axiom',connectionId:'axiom-engine',entityType:'prospect',entityId:'fixture.example'},
    expectedRevision:(await readEngineCallSource(db,'fixture.example')).revision,confirmedRelationship:true,
    reviewedFields:{name:'Synthetic roofing fixture',domain:null,contact:{name:'Owner',phone:'+15195550101'},agreedWork:'Confirmed synthetic work',historyEventIds:[]}};
}

test('a lost handoff response retains the original job and retries the exact payload without opening acquisition calling',async()=>{
  const t=openCallerTestDb();try{
    const g=grant(),packets:unknown[]=[];let offline=true;
    const bridge:CallerBridge={grant:g,send:async(operation,payload)=>{
      assert.equal(operation,'conversion/request');packets.push(payload);
      if(offline){offline=false;throw new Error('Response lost');}
      return {conversionId:(payload as {conversionId:string}).conversionId,payloadHash:await resultPayloadHash('conversion-handoff','ws_a',payload),status:'pending',receivedAt:'2026-09-25T00:00:00.000Z'};
    }};
    const c=await command(t.db),scope={db:t.db,actor:AIDAN,bridge};
    await requestOrbitConversion(scope,c);
    assert.equal(t.raw.prepare<[],{status:string}>('SELECT status FROM CallerConversionJob').get()?.status,'retry');
    await assert.rejects(prepareEngineCall(t.db,AIDAN,c.engineSource as never),/STOPPED/);
    assert.equal((await nextInQueue(t.db,'2026-09-25','2026-09-25T04:00:00.000Z')).remaining,0);
    await resumeOrbitConversion(scope,c.conversionId);
    assert.deepEqual(packets[0],packets[1]);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerConversionJob').get()?.n,1);
    assert.equal(t.raw.prepare<[],{status:string}>('SELECT status FROM CallerConversionJob').get()?.status,'pending_review');
    await assert.rejects(requestOrbitConversion(scope,{...c,reviewedFields:{...c.reviewedFields,agreedWork:'Changed'}}),/CONFLICT/);
  }finally{t.close();}
});

test('stale review, a racing stop or revoked owner leaves no conversion job',async()=>{
  const t=openCallerTestDb();try{
    const bridge:CallerBridge={grant:grant(),send:async()=>{throw new Error('Must not send');}},c=await command(t.db);
    const key=await engineContactId('fixture.example');
    const db={...t.db,batch:async(statements:Parameters<typeof t.db.batch>[0])=>{
      t.raw.prepare("INSERT INTO CallerContactControl(workspaceId,contactKey,sourceEntityId,stopped,phase,revision) VALUES('axiom',?,'fixture.example',1,'closed',0)").run(key);
      return t.db.batch(statements);
    }};
    await assert.rejects(requestOrbitConversion({db,actor:AIDAN,bridge},c));
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerConversionJob').get()?.n,0);
    t.raw.prepare('UPDATE User SET banned=1 WHERE id=?').run(AIDAN.actorUserId);
    await assert.rejects(requestOrbitConversion({db:t.db,actor:AIDAN,bridge},c));
  }finally{t.close();}
});

test('Orbit can reserve only the reviewed handoff identity, with source and stop checks inside the mapping transaction',async()=>{
  const t=openCallerTestDb();try{
    const g=grant(),bridge:CallerBridge={grant:g,send:async(_operation,payload)=>({conversionId:(payload as {conversionId:string}).conversionId,payloadHash:await resultPayloadHash('conversion-handoff','ws_a',payload),status:'pending',receivedAt:'2026-09-25T00:00:00.000Z'})};
    const c=await command(t.db);await requestOrbitConversion({db:t.db,actor:AIDAN,bridge},c);
    const context=await engineConversionContext(t.db,g,c.conversionId) as {revision:string;link:null};assert.equal(context.link,null);
    const link={linkId:c.conversionId,grantId:g.grantId,engineRef:c.engineSource,engineContactKey:await engineContactId('fixture.example'),
      orbitRef:{system:'orbit',connectionId:g.orbitConnectionId,workspaceId:'ws_a',entityType:'prospect',entityId:'handoff-'+c.conversionId},orbitContactId:crypto.randomUUID(),confirmed:true};
    await assert.rejects(reserveEngineConversionLink(t.db,g,{conversionId:c.conversionId,expectedRevision:context.revision,link:{...link,engineRef:{...link.engineRef,entityId:'another.example'}}}));
    const db={...t.db,batch:async(statements:Parameters<typeof t.db.batch>[0])=>{
      t.raw.prepare("INSERT INTO CallerContactControl(workspaceId,contactKey,sourceEntityId,stopped,phase,revision) VALUES('axiom',?,'fixture.example',1,'closed',0)").run(link.engineContactKey);
      return t.db.batch(statements);
    }};
    await assert.rejects(reserveEngineConversionLink(db,g,{conversionId:c.conversionId,expectedRevision:context.revision,link}));
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerSourceLink').get()?.n,0);
  }finally{t.close();}
});

test('completed Orbit receipts activate both sides and survive a lost activation response',async()=>{
  const t=openCallerTestDb();try{
    const g=grant(),c=await command(t.db);let completed=false,loseActivation=true;
    const contactId=crypto.randomUUID();
    const bridge:CallerBridge={grant:g,send:async(op,payload)=>{
      if(op==='links/activate'){
        const {link}=payload as {link:Record<string,unknown>};
        if(loseActivation){loseActivation=false;throw new Error('Response lost after Orbit activation');}
        return {...link,state:'active',revision:2};
      }
      assert.equal(op,'conversion/request');
      const base={conversionId:c.conversionId,payloadHash:await resultPayloadHash('conversion-handoff','ws_a',payload),receivedAt:'2026-09-25T00:00:00.000Z'};
      return completed?{...base,status:'completed',prospectId:'handoff-'+c.conversionId,clientId:'caller-'+c.conversionId,orbitContactId:contactId,linkId:c.conversionId,linkedExisting:false}:{...base,status:'pending'};
    }};
    const scope={db:t.db,actor:AIDAN,bridge};await requestOrbitConversion(scope,c);
    const context=await engineConversionContext(t.db,g,c.conversionId);
    await reserveEngineConversionLink(t.db,g,{conversionId:c.conversionId,expectedRevision:context.revision,link:{linkId:c.conversionId,grantId:g.grantId,engineRef:c.engineSource,engineContactKey:await engineContactId('fixture.example'),orbitContactId:contactId,confirmed:true,
      orbitRef:{system:'orbit',workspaceId:'ws_a',connectionId:g.orbitConnectionId,entityType:'prospect',entityId:'handoff-'+c.conversionId}}});
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerSourceLink').get()?.n,0,'The durable conversion hold must not leave a mapping to an uncommitted Orbit record');
    completed=true;
    assert.equal((await resumeOrbitConversion(scope,c.conversionId)).status,'retry');
    assert.equal((await resumeOrbitConversion(scope,c.conversionId)).status,'completed');
    assert.equal(t.raw.prepare<[],{state:string}>('SELECT state FROM CallerSourceLink').get()?.state,'active');
    assert.equal((await resumeOrbitConversion(scope,c.conversionId)).status,'completed');
    await assert.rejects(prepareEngineCall(t.db,AIDAN,c.engineSource as never),/STOPPED/);
  }finally{t.close();}
});
