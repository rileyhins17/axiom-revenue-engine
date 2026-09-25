import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb, AIDAN } from './test-database';
import { listEngineCallTasks, prepareEngineCall } from './source';
import { createCallerToken } from '../revenue-engine/caller-integration';
import { handleEngineCallerRequest } from './http';
import type { Claim } from './claims';

test('tasks and preparation use stored evidence, preserve eligibility and never invent a website', async () => {
  const t = openCallerTestDb();
  try {
    const page = await listEngineCallTasks(t.db, null);
    assert.equal(page.tasks.length, 1);
    const prepared = await prepareEngineCall(t.db, AIDAN, page.tasks[0].source);
    assert.equal(prepared.task.revision, page.tasks[0].revision);
    assert.match(prepared.brief.facts.join(' '), /Stored fixture observation/);
    t.raw.exec("UPDATE EngineProspect SET websiteUrl=NULL,reasons='[]',label='NO_WEBSITE'");
    const unknown = await prepareEngineCall(t.db, AIDAN, page.tasks[0].source);
    assert.equal(unknown.evidence.length, 0);
    assert.match(unknown.brief.limitations.join(' '), /website/i);
    assert.doesNotMatch(unknown.brief.opening, /doesn.t have a website|can.t find/);
    t.raw.exec('UPDATE EngineProspect SET phone=NULL');
    await assert.rejects(prepareEngineCall(t.db, AIDAN, page.tasks[0].source), /STOPPED/);
    assert.equal((await listEngineCallTasks(t.db, null)).tasks.length, 0);
  } finally { t.close(); }
});

test('authenticated source routes bind claim to prepared revision and reconcile explicitly', async () => {
  const t = openCallerTestDb();
  try {
    const token = await createCallerToken(t.db, AIDAN, 'Fixture caller');
    const send = (route: string, body?: unknown) => handleEngineCallerRequest(t.db, new Request('https://operations.getaxiom.ca/api/caller/v2/' + route, {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), route.split('?')[0],{CALLER_V2_ENABLED:'true',CALLER_V2_WORKSPACE_ID:'axiom'});
    const connection = await send('connection');
    assert.equal(connection.status, 200); assert.equal(((await connection.json()) as { actorId: string }).actorId, AIDAN.actorUserId);
    const page = await (await send('tasks')).json() as Awaited<ReturnType<typeof listEngineCallTasks>>;
    const source = page.tasks[0].source;
    const prepared = await (await send('prepare', { source })).json() as Awaited<ReturnType<typeof prepareEngineCall>>;
    assert.equal((await send('prepare', { source: { ...source, entityType: 'client' } })).status, 404);
    assert.equal((await send('prepare', { source: { ...source, entityId: 'missing.example' } })).status, 404);
    const command = { source, attemptId: crypto.randomUUID(), sourceRevision: prepared.task.revision };
    assert.equal((await send('claims', { ...command, sourceRevision: '0'.repeat(64) })).status, 409);
    assert.equal((await send('claims', { ...command, actorId: 'other' })).status, 400);
    assert.equal((await send('claims', { source, attemptId: command.attemptId })).status, 400);
    const reserved = await (await send('claims', command)).json() as Claim;
    assert.equal(reserved.state, 'reserved');
    const armed = await (await send('claims/renew', { claim: reserved, state: 'armed' })).json() as Claim;
    assert.equal(armed.state, 'armed');
    assert.equal((await send('claims/release', { claim: armed, reason: 'reconciled' })).status, 400);
    assert.equal((await send('claims/reconcile', { attemptId: command.attemptId, resolution: 'not_dialed' })).status, 200);
    assert.equal((await send('tasks?limit=26')).status, 400);
    assert.equal((await send('tasks?cursor=untrusted')).status, 400);
    t.raw.prepare('UPDATE User SET emailVerified=0 WHERE id=?').run(AIDAN.actorUserId);
    assert.equal((await send('prepare', { source })).status, 401);
  } finally { t.close(); }
});


test('new calling defaults off for existing tokens while recovery remains available',async()=>{
  const f=openCallerTestDb();try{
    const token=await createCallerToken(f.db,AIDAN,'Activation fixture');
    const source=(await listEngineCallTasks(f.db,null)).tasks[0].source;
    const send=(route:string,body?:unknown,env?:unknown)=>handleEngineCallerRequest(f.db,new Request('https://operations.getaxiom.ca/api/caller/v2/'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})}),route,env);
    for(const env of [undefined,{}, {CALLER_V2_ENABLED:'true',CALLER_V2_WORKSPACE_ID:'other'}, {CALLER_V2_ENABLED:true,CALLER_V2_WORKSPACE_ID:'axiom'}]){
      assert.equal((await send('prepare',{source},env)).status,503);
      assert.equal((await send('tasks',undefined,env)).status,503);
    }
    const active={CALLER_V2_ENABLED:'true',CALLER_V2_WORKSPACE_ID:'axiom'};
    const prepared=await (await send('prepare',{source},active)).json() as {task:{revision:string}};
    const claim=await (await send('claims',{source,sourceRevision:prepared.task.revision,attemptId:crypto.randomUUID()},active)).json() as Claim;
    assert.equal((await send('claims/renew',{claim,state:'armed'})).status,503);
    assert.equal((await send('claims/reconcile',{attemptId:claim.attemptId,resolution:'not_dialed'})).status,200);
    assert.equal((await send('stop',{source,reason:'Recovery remains enabled'})).status,200);
    assert.equal((await send('connection')).status,200);
  }finally{f.close();}
});
