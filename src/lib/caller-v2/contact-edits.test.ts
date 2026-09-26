import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb, AIDAN } from './test-database';
import { createCallerToken } from '../revenue-engine/caller-integration';
import { handleEngineCallerRequest } from './http';
import { ENGINE_CONNECTION, ENGINE_WORKSPACE } from './identity';
import { listContactEditsFor } from './contact-edits';
import { readEngineCallSource } from './source-state';

const source = { system: 'revenue-engine', workspaceId: ENGINE_WORKSPACE, connectionId: ENGINE_CONNECTION, entityType: 'prospect', entityId: 'fixture.example' };

function setup() {
  const t = openCallerTestDb();
  const send = async (token: string | null, body: unknown, method = 'POST') => handleEngineCallerRequest(t.db,
    new Request('https://operations.getaxiom.ca/api/caller/v2/contact-edits', { method, headers: token ? { Authorization: 'Bearer ' + token } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }), 'contact-edits');
  return { t, send };
}

test('a phone fix updates the business, keeps the old number in history, and returns the new source revision', async () => {
  const { t, send } = setup();
  try {
    const token = await createCallerToken(t.db, AIDAN, 'Fixture Caller');
    const before = await readEngineCallSource(t.db, 'fixture.example');
    const edit = { editId: crypto.randomUUID(), source, phone: '(519) 555-0199', note: 'Ask for Dave, best after 3pm' };
    const saved = await send(token, edit);
    assert.equal(saved.status, 201);
    assert.equal(saved.headers.get('Cache-Control'), 'no-store');
    const receipt = await saved.json() as Record<string, unknown>;
    assert.equal(receipt.status, 'saved');
    assert.equal(receipt.phone, '(519) 555-0199');
    assert.equal(receipt.previousPhone, '+15195550101');
    assert.equal(receipt.phoneChanged, true);
    assert.match(String(receipt.sourceRevision), /^[a-f0-9]{64}$/);
    assert.notEqual(receipt.sourceRevision, before.revision, 'the new number is a new source revision');
    assert.equal(t.raw.prepare('SELECT phone FROM EngineProspect WHERE prospectId=?').pluck().get('fixture.example'), '(519) 555-0199');
    const history = (await listContactEditsFor(t.db, ['fixture.example'])).get('fixture.example')!;
    assert.deepEqual({ ...history[0], createdAt: undefined }, { prospectId: 'fixture.example', previousPhone: '+15195550101', newPhone: '(519) 555-0199', note: 'Ask for Dave, best after 3pm', actor: 'AIDAN', createdAt: undefined });

    // The same edit sent twice is acknowledged once; a different edit under the same ID is refused.
    const again = await send(token, edit);
    assert.equal(again.status, 200);
    assert.equal((await again.json() as { status: string }).status, 'duplicate');
    assert.equal((await send(token, { ...edit, note: 'something else' })).status, 409);
    assert.equal(t.raw.prepare('SELECT COUNT(*) FROM CallerContactEdit').pluck().get(), 1);
    assert.throws(() => t.raw.prepare('DELETE FROM CallerContactEdit').run(), /NO_DELETE/);
    assert.throws(() => t.raw.prepare("UPDATE CallerContactEdit SET note='x'").run(), /IMMUTABLE/);
  } finally { t.close(); }
});

test('a note alone never changes the number or the call log, so the call queue is unaffected', async () => {
  const { t, send } = setup();
  try {
    const token = await createCallerToken(t.db, AIDAN, 'Fixture Caller');
    const before = await readEngineCallSource(t.db, 'fixture.example');
    const saved = await send(token, { editId: crypto.randomUUID(), source, phone: null, note: 'Owner is Maria' });
    assert.equal(saved.status, 201);
    const receipt = await saved.json() as Record<string, unknown>;
    assert.equal(receipt.phoneChanged, false);
    assert.equal(receipt.sourceRevision, before.revision, 'a note does not change what Caller claims against');
    assert.equal(t.raw.prepare('SELECT COUNT(*) FROM EngineProspectActivity').pluck().get(), 0);
    // Sending the number it already has is just a note (or nothing).
    assert.equal((await send(token, { editId: crypto.randomUUID(), source, phone: '+15195550101', note: null })).status, 422);
  } finally { t.close(); }
});

test('contact edits need a valid Caller key, a real business, sensible fields and POST', async () => {
  const { t, send } = setup();
  try {
    const token = await createCallerToken(t.db, AIDAN, 'Fixture Caller');
    const ok = { editId: crypto.randomUUID(), source, phone: '519-555-0142', note: null };
    assert.equal((await send(null, ok)).status, 401);
    assert.equal((await send('not-a-token', ok)).status, 401);
    assert.equal((await send(token, { ...ok, source: { ...source, entityId: 'missing.example' } })).status, 404);
    assert.equal((await send(token, { ...ok, source: { ...source, workspaceId: 'another' } })).status, 404);
    assert.equal((await send(token, { ...ok, phone: 'call me' })).status, 400);
    assert.equal((await send(token, { ...ok, phone: '12' })).status, 400);
    assert.equal((await send(token, { ...ok, phone: null, note: null })).status, 400);
    assert.equal((await send(token, { ...ok, extra: true })).status, 400);
    assert.equal((await send(token, ok, 'GET')).status, 405);
    assert.equal(t.raw.prepare('SELECT phone FROM EngineProspect').pluck().get(), '+15195550101');
  } finally { t.close(); }
});
