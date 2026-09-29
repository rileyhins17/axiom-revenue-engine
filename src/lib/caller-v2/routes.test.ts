import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb, engineResultFixture, AIDAN } from './test-database';
import { createCallerToken, revokeCallerToken } from '../revenue-engine/caller-integration';
import { handleEngineCallerRequest } from './http';
import { parseReceipt } from './protocol';

test('result and receipt routes authenticate the current owner, keep no-store, and reject revoked or disabled credentials', async () => {
  const t = openCallerTestDb();
  try {
    const token = await createCallerToken(t.db, AIDAN, 'Fixture Caller');
    const input = await engineResultFixture(t.db);
    const request = (body: unknown = input) => new Request('https://operations.getaxiom.ca/api/caller/v2/results', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    const saved = await handleEngineCallerRequest(t.db, request(), 'results');
    assert.equal(saved.status, 201); assert.equal(saved.headers.get('Cache-Control'), 'no-store');
    const receipt = parseReceipt(await saved.json()); assert.equal(receipt.eventId, input.eventId);
    const status=await handleEngineCallerRequest(t.db,new Request('https://operations.getaxiom.ca/api/caller/v2/deliveries/'+input.eventId,{headers:{Authorization:'Bearer '+token}}),'deliveries/'+input.eventId);
    assert.equal(status.status,200);assert.deepEqual((await status.json() as {projections:unknown[]}).projections,[]);
    const response = await handleEngineCallerRequest(t.db, new Request('https://operations.getaxiom.ca/api/caller/v2/receipts/' + input.eventId, { headers: { Authorization: 'Bearer ' + token } }), 'receipts/' + input.eventId);
    assert.equal(response.status, 200); assert.equal(parseReceipt(await response.json()).payloadHash, receipt.payloadHash);
    assert.equal((await handleEngineCallerRequest(t.db, request({ ...input, actorId: 'other' }), 'results')).status, 400);
    t.raw.prepare('UPDATE User SET banned=1 WHERE id=?').run(AIDAN.actorUserId);
    assert.equal((await handleEngineCallerRequest(t.db, request(), 'results')).status, 401);
    t.raw.prepare('UPDATE User SET banned=0 WHERE id=?').run(AIDAN.actorUserId);
    const id = t.raw.prepare<[], {id: string}>('SELECT substr(tokenHash,1,8) id FROM CallerToken').get()!.id;
    await revokeCallerToken(t.db, 'AIDAN', id);
    assert.equal((await handleEngineCallerRequest(t.db, request(), 'results')).status, 401);
  } finally { t.close(); }
});
test('byte limits, contradictory fields, identity and request methods fail explicitly', async () => {
  const t = openCallerTestDb();
  try {
    const token = await createCallerToken(t.db, AIDAN, 'Fixture Caller'), input = await engineResultFixture(t.db);
    const send = (value: unknown) => handleEngineCallerRequest(t.db, new Request('https://operations.getaxiom.ca/api/caller/v2/results', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(value) }), 'results');
    assert.equal((await send({ ...input, summary: '😀'.repeat(9000) })).status, 413);
    assert.equal((await send({ ...input, outcome: 'no_answer' })).status, 422);
    assert.equal((await send({ ...input, source: { ...input.source, workspaceId: 'another' } })).status, 404);
    assert.equal((await handleEngineCallerRequest(t.db, new Request('https://operations.getaxiom.ca/api/caller/v2/results', { headers: { Authorization: 'Bearer ' + token } }), 'results')).status, 405);
  } finally { t.close(); }
});
