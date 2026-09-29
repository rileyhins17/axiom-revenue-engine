import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb,AIDAN } from './test-database';
import { handleLinkManagement } from './link-management';
import { linkIdentitySchema } from './peer-contract';

test('owner previews require an exact current identity; partial setup remains resumable without exposing grant secrets',async()=>{
  const t=openCallerTestDb();try{
    const env={CALLER_PEER_GRANT_ID:crypto.randomUUID(),CALLER_PEER_SECRET:'ab'.repeat(32),CALLER_ORBIT_WORKSPACE_ID:'ws_a',CALLER_ORBIT_CONNECTION_ID:'orbit-fixture'};
    const orbitRef={system:'orbit',connectionId:env.CALLER_ORBIT_CONNECTION_ID,workspaceId:'ws_a',entityType:'prospect',entityId:'p_a'};
    const contactId=crypto.randomUUID();let revision='a'.repeat(64),offline=false;
    const fetcher:typeof fetch=async(_url,init)=>{
      const command=JSON.parse(String(init?.body));
      if(offline)throw new Error('Offline');
      if(command.operation==='links/preview')return Response.json({source:orbitRef,contactId,businessName:'Orbit fixture',contactName:'Alex',phone:'+15195550101',stopped:false,revision});
      const link=linkIdentitySchema.parse(command.payload.link??command.payload);
      return Response.json({...link,state:command.operation==='links/stage'?'pending':'active',revision:command.operation==='links/stage'?1:2});
    };
    const run=(body:unknown,origin='https://operations.getaxiom.ca')=>handleLinkManagement(t.db,new Request('https://operations.getaxiom.ca/api/caller/links',{method:'POST',headers:{Origin:origin},body:JSON.stringify(body)}),AIDAN,env,fetcher);
    const get=()=>handleLinkManagement(t.db,new Request('https://operations.getaxiom.ca/api/caller/links'),AIDAN,env,fetcher);
    assert.equal((await run({action:'preview'},'https://attacker.example')).status,403);
    const previewResponse=await run({action:'preview',engineEntityId:'fixture.example',orbitRef,orbitContactId:contactId});assert.equal(previewResponse.status,200);
    const preview=await previewResponse.json() as {link:unknown;previewRevision:string};
    revision='b'.repeat(64);
    assert.equal((await run({action:'confirm',link:preview.link,previewRevision:preview.previewRevision})).status,409);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerSourceLink').get()?.n,0);
    revision='a'.repeat(64);
    // Fail after the local stage has committed, not during the required fresh preview.
    const stagedFetcher:typeof fetch=async(url,init)=>{const cmd=JSON.parse(String(init?.body));if(cmd.operation==='links/stage')offline=true;return fetcher(url,init);};
    const pending=await handleLinkManagement(t.db,new Request('https://operations.getaxiom.ca/api/caller/links',{method:'POST',headers:{Origin:'https://operations.getaxiom.ca'},body:JSON.stringify({action:'confirm',link:preview.link,previewRevision:preview.previewRevision})}),AIDAN,env,stagedFetcher);
    assert.equal(pending.status,503);
    const settings=await (await get()).text();assert.ok(settings.includes('pending'));assert.ok(!settings.includes(env.CALLER_PEER_SECRET));
    offline=false;const link=linkIdentitySchema.parse(preview.link);
    assert.equal((await run({action:'resume',linkId:link.linkId})).status,200);
    assert.equal(t.raw.prepare<[],{state:string}>('SELECT state FROM CallerSourceLink').get()?.state,'active');
    t.raw.prepare('UPDATE User SET banned=1 WHERE id=?').run(AIDAN.actorUserId);
    assert.equal((await get()).status,403);
  }finally{t.close();}
});
