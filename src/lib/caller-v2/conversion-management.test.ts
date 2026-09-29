import test from 'node:test';
import assert from 'node:assert/strict';
import {openCallerTestDb,AIDAN} from './test-database';
import {handleConversionManagement} from './conversion-management';
import {resultPayloadHash} from './canonical-json';

test('the owner handoff surface previews only the selected source and requires current owner and origin',async()=>{
  const t=openCallerTestDb();try{
    const env={CALLER_PEER_GRANT_ID:crypto.randomUUID(),CALLER_PEER_SECRET:'ab'.repeat(32),CALLER_ORBIT_WORKSPACE_ID:'ws_a',CALLER_ORBIT_CONNECTION_ID:'orbit-fixture'};
    const fetcher:typeof fetch=async(_url,init)=>{
      const body=JSON.parse(String(init?.body));assert.equal(body.operation,'conversion/request');
      return Response.json({conversionId:body.payload.conversionId,payloadHash:await resultPayloadHash('conversion-handoff','ws_a',body.payload),status:'pending',receivedAt:'2026-09-25T00:00:00.000Z'});
    };
    const run=(body:unknown,origin='https://operations.getaxiom.ca')=>handleConversionManagement(t.db,new Request('https://operations.getaxiom.ca/api/caller/conversions',{method:'POST',headers:{Origin:origin},body:JSON.stringify(body)}),AIDAN,env,fetcher);
    assert.equal((await run({action:'preview',entityId:'fixture.example'},'https://attacker.example')).status,403);
    const response=await run({action:'preview',entityId:'fixture.example'});assert.equal(response.status,200);
    const preview=await response.json() as {source:unknown;revision:string;name:string;phone:string;history:unknown[]};assert.equal(preview.name,'Synthetic roofing fixture');
    const saved=await run({action:'request',command:{conversionId:crypto.randomUUID(),engineSource:preview.source,expectedRevision:preview.revision,confirmedRelationship:true,
      reviewedFields:{name:preview.name,domain:null,contact:{name:'Owner',phone:preview.phone},agreedWork:'',historyEventIds:[]}}});
    assert.equal(saved.status,200);assert.match(await saved.text(),/pending_review/);
    const listed=await handleConversionManagement(t.db,new Request('https://operations.getaxiom.ca/api/caller/conversions'),AIDAN,env,fetcher);
    const text=await listed.text();assert.equal(listed.status,200);assert.ok(!text.includes(env.CALLER_PEER_SECRET));assert.match(text,/reviewUrl/);
    t.raw.prepare('UPDATE User SET emailVerified=0 WHERE id=?').run(AIDAN.actorUserId);
    assert.equal((await run({action:'preview',entityId:'fixture.example'})).status,403);
  }finally{t.close();}
});
