import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb, engineResultFixture, AIDAN } from './test-database';
import { recordEngineResult, getEngineReceipt, callerResultStats } from './repository';
import { prospectActivityStats, listProspectActivity } from '../revenue-engine/engine-prospects-d1';
import { historyView } from '../prospect-format';

test('an attempt reconciled as not dialed cannot later accept call evidence, even across a concurrent reconciliation',async()=>{
  const t=openCallerTestDb();try{
    const input=await engineResultFixture(t.db);
    t.raw.prepare("UPDATE CallerAttempt SET phase='closed',resolution='not_dialed' WHERE attemptId=?").run(input.attemptId);
    await assert.rejects(recordEngineResult(t.db,AIDAN,input),/CLAIM_REQUIRED/);
    t.raw.prepare("UPDATE CallerAttempt SET phase='active',resolution=NULL WHERE attemptId=?").run(input.attemptId);
    const db={...t.db,batch:async(statements:Parameters<typeof t.db.batch>[0])=>{t.raw.prepare("UPDATE CallerAttempt SET phase='closed',resolution='not_dialed' WHERE attemptId=?").run(input.attemptId);return t.db.batch(statements);}};
    await assert.rejects(recordEngineResult(db,AIDAN,input),/CLAIM_REQUIRED/);
    assert.equal(t.raw.prepare<[],{n:number}>('SELECT COUNT(*) n FROM CallerResult').get()?.n,0);
  }finally{t.close();}
});

test('identical and concurrent retries produce one result and one activity; changed data conflicts', async () => {
  const t = openCallerTestDb();
  try {
    const input = await engineResultFixture(t.db);
    const replies = await Promise.all([recordEngineResult(t.db, AIDAN, input), recordEngineResult(t.db, AIDAN, input)]);
    assert.equal(replies[0].recordId, replies[1].recordId);
    assert.deepEqual(replies.map(r => r.status).sort(), ['already_saved', 'saved']);
    const again = await recordEngineResult(t.db, AIDAN, input);
    assert.equal(again.status, 'already_saved');
    assert.equal(t.raw.prepare<[], {n: number}>('SELECT count(*) n FROM CallerResult').get()?.n, 1);
    assert.equal(t.raw.prepare<[], {n: number}>('SELECT count(*) n FROM EngineProspectActivity').get()?.n, 1);
    await assert.rejects(recordEngineResult(t.db, AIDAN, { ...input, summary: 'Changed later' }), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(recordEngineResult(t.db, AIDAN, { ...input, nextAction: { ...input.nextAction!, description: 'Changed callback' } }), /IDEMPOTENCY_CONFLICT/);
    assert.equal((await getEngineReceipt(t.db, AIDAN, input.eventId))?.payloadHash, again.payloadHash);
    assert.equal(await getEngineReceipt(t.db, { actor: 'RILEY', actorUserId: 'other' }, input.eventId), null);
  } finally { t.close(); }
});
test('an activity failure rolls back the reservation, result and stop together', async () => {
  const t = openCallerTestDb();
  try {
    const input = await engineResultFixture(t.db);
    t.raw.exec("CREATE TRIGGER fixture_fail BEFORE INSERT ON EngineProspectActivity BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
    await assert.rejects(recordEngineResult(t.db, AIDAN, { ...input, outcome: 'do_not_contact', stopScope: 'contact', nextAction: null }));
    assert.equal(t.raw.prepare<[], {n: number}>('SELECT count(*) n FROM CallerResult').get()?.n, 0);
    assert.equal(t.raw.prepare<[], {n: number}>('SELECT count(*) n FROM CallerContactControl WHERE stopped=1').get()?.n, 0);
  } finally { t.close(); }
});
test('unknown and meeting requests keep their exact meaning and original occurrence date', async () => {
  const t = openCallerTestDb();
  try {
    for (const outcome of ['unknown', 'meeting_requested'] as const) {
      const input = await engineResultFixture(t.db, { outcome, nextAction: null, connectedAt: null, attempted: outcome === 'unknown' ? null : true });
      await recordEngineResult(t.db, AIDAN, input);
    }
    const rows = t.raw.prepare<[], {outcome: string; callerOutcome: string; occurredAt: string; note: string}>('SELECT outcome,callerOutcome,occurredAt,note FROM EngineProspectActivity ORDER BY rowid').all();
    assert.deepEqual(rows.map((r: { outcome: string }) => r.outcome), ['NOTE', 'NOTE']);
    assert.deepEqual(rows.map((r: { callerOutcome: string }) => r.callerOutcome), ['unknown', 'meeting_requested']);
    assert.equal(rows[0].occurredAt, '2026-09-24T18:00:00.000Z');
    const history = historyView(await listProspectActivity(t.db, 'fixture.example'));
    assert.ok(history.some(row => row.what.toLowerCase().includes('meeting requested')));
    const stats = await callerResultStats(t.db, '2026-09-24T00:00:00.000Z');
    assert.equal(stats.attempts, 1); assert.equal(stats.meetingRequested, 1); assert.equal(stats.meetingBooked, 0);
    assert.equal((await callerResultStats(t.db, '2026-09-25T00:00:00.000Z')).attempts, 0);
  } finally { t.close(); }
});
test('DNC and history commit together and later historical evidence never clears the stop', async () => {
  const t = openCallerTestDb();
  try {
    const input = await engineResultFixture(t.db, { outcome: 'do_not_contact', stopScope: 'contact', nextAction: null });
    await recordEngineResult(t.db, AIDAN, input);
    const stop = t.raw.prepare<[], {stopped: number}>('SELECT * FROM CallerContactControl').get();
    assert.equal(stop?.stopped, 1);
    const later = await engineResultFixture(t.db, { outcome: 'unknown', nextAction: null, connectedAt: null });
    await recordEngineResult(t.db, AIDAN, later);
    assert.equal(t.raw.prepare<[], {stopped: number}>('SELECT stopped FROM CallerContactControl').get()?.stopped, 1);
  } finally { t.close(); }
});
test('corrections retain the original, cannot fork or change attempt identity, and count once', async () => {
  const t = openCallerTestDb();
  try {
    const input = await engineResultFixture(t.db); await recordEngineResult(t.db, AIDAN, input);
    const correction = { ...input, eventId: crypto.randomUUID(), correctionOf: input.eventId, summary: 'Reviewed correction' };
    await recordEngineResult(t.db, AIDAN, correction);
    assert.equal((await callerResultStats(t.db, '2026-09-24T00:00:00.000Z')).attempts, 1);
    assert.equal((await prospectActivityStats(t.db, '2026-09-24T00:00:00.000Z')).byActor.AIDAN.calls, 1);
    assert.equal((await prospectActivityStats(t.db, '2026-09-25T00:00:00.000Z')).total, 0);
    const history = await listProspectActivity(t.db, input.source.entityId);
    assert.equal(history.length, 1); assert.equal(history[0].note, 'Reviewed correction');
    assert.equal(JSON.parse(t.raw.prepare<[string], {payloadJson: string}>('SELECT payloadJson FROM CallerResult WHERE eventId=?').get(input.eventId)!.payloadJson).summary, input.summary);
    await assert.rejects(recordEngineResult(t.db, AIDAN, { ...correction, eventId: crypto.randomUUID() }), /REVISION_CONFLICT/);
    await assert.rejects(recordEngineResult(t.db, AIDAN, { ...input, eventId: crypto.randomUUID() }), /IDEMPOTENCY_CONFLICT/);
  } finally { t.close(); }
});
