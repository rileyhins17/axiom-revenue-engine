import test from 'node:test';
import assert from 'node:assert/strict';
import { openCallerTestDb, engineResultFixture, AIDAN } from './test-database';
import { engineContactId } from './identity';
import { claimContact, renewContactClaim, releaseContactClaim, setContactStop, reconcileClaim } from './claims';
import { readEngineCallSource } from './source-state';
import { recordProspectActivity, nextInQueue } from '../revenue-engine/engine-prospects-d1';
import { recordEngineResult } from './repository';

const NOW = Date.parse('2026-09-25T16:00:00.000Z');
const RILEY = { actor: 'RILEY' as const, actorUserId: 'user-riley' };
async function command(t: ReturnType<typeof openCallerTestDb>, entityId = 'fixture.example') {
  const source = await readEngineCallSource(t.db, entityId, NOW);
  return { contactKey: await engineContactId(entityId), entityId, attemptId: crypto.randomUUID(), sourceRevision: source.revision };
}

test('competing operators get one reservation; same-owner replay preserves the attempt and phase', async () => {
  const t = openCallerTestDb();
  try {
    const input = await command(t);
    const results = await Promise.allSettled([claimContact(t.db, AIDAN, input, NOW), claimContact(t.db, RILEY, { ...input, attemptId: crypto.randomUUID() }, NOW)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const first = await claimContact(t.db, AIDAN, input, NOW);
    assert.equal(first.expiresAt, '2026-09-25T16:02:00.000Z');
    const armed = await renewContactClaim(t.db, AIDAN, first, 'armed', NOW + 1000);
    assert.equal((await claimContact(t.db, AIDAN, input, NOW + 2000)).state, 'armed');
    assert.equal(t.raw.prepare<[], { n: number }>('SELECT COUNT(*) n FROM CallerAttempt').get()?.n, 1);
    await assert.rejects(renewContactClaim(t.db, RILEY, armed, 'active', NOW + 3000), /NOT_FOUND/);
    await assert.rejects(renewContactClaim(t.db, AIDAN, armed, 'reserved', NOW + 3000), /REVISION_CONFLICT/);
  } finally { t.close(); }
});

test('only never-armed expired reservations can be reassigned and old attempts cannot be revived', async () => {
  const t = openCallerTestDb();
  try {
    const input = await command(t);
    await claimContact(t.db, AIDAN, input, NOW);
    const replacement = await claimContact(t.db, RILEY, { ...input, attemptId: crypto.randomUUID() }, NOW + 120000);
    assert.equal(replacement.ownerId, RILEY.actorUserId);
    await assert.rejects(claimContact(t.db, AIDAN, input, NOW + 240000), /CLAIM_HELD|REVISION_CONFLICT/);
  } finally { t.close(); }
});

for (const phase of ['armed', 'active'] as const) test(`expired ${phase} attempt stays uncertain until its owner reconciles it`, async () => {
  const t = openCallerTestDb();
  try {
    const input = await command(t);
    let current = await claimContact(t.db, AIDAN, input, NOW);
    current = await renewContactClaim(t.db, AIDAN, current, 'armed', NOW + 1000);
    if (phase === 'active') current = await renewContactClaim(t.db, AIDAN, current, 'active', NOW + 2000);
    await assert.rejects(claimContact(t.db, RILEY, { ...input, attemptId: crypto.randomUUID() }, NOW + 130000), /CLAIM_UNCERTAIN/);
    assert.equal(t.raw.prepare<[], { phase: string }>('SELECT phase FROM CallerAttempt').get()?.phase, 'uncertain');
    await assert.rejects(renewContactClaim(t.db, AIDAN, current, 'armed', NOW + 130000), /CLAIM_UNCERTAIN/);
    await assert.rejects(reconcileClaim(t.db, RILEY, input.attemptId, 'call_finished', NOW + 131000), /NOT_FOUND/);
    await reconcileClaim(t.db, AIDAN, input.attemptId, 'call_finished', NOW + 131000);
    assert.equal((await claimContact(t.db, RILEY, { ...input, attemptId: crypto.randomUUID() }, NOW + 132000)).state, 'reserved');
  } finally { t.close(); }
});

test('stops and changed source data invalidate arming without erasing the reserved attempt', async () => {
  const t = openCallerTestDb();
  try {
    const input = await command(t), current = await claimContact(t.db, AIDAN, input, NOW);
    t.raw.prepare('UPDATE EngineProspect SET phone=? WHERE prospectId=?').run('+15195550102', input.entityId);
    await assert.rejects(renewContactClaim(t.db, AIDAN, current, 'armed', NOW + 1000), /REVISION_CONFLICT/);
    await setContactStop(t.db, RILEY, input.contactKey, 'Explicit contact stop', NOW + 2000);
    await assert.rejects(claimContact(t.db, AIDAN, input, NOW + 3000), /STOPPED/);
    assert.equal(t.raw.prepare<[], { n: number }>('SELECT COUNT(*) n FROM CallerAttempt').get()?.n, 1);
  } finally { t.close(); }
});

test('stale renewal cannot overwrite a newer claim and potentially dialed release requires reconciliation', async () => {
  const t = openCallerTestDb();
  try {
    const input = await command(t), reserved = await claimContact(t.db, AIDAN, input, NOW);
    const armed = await renewContactClaim(t.db, AIDAN, reserved, 'armed', NOW + 1000);
    await assert.rejects(renewContactClaim(t.db, AIDAN, reserved, 'armed', NOW + 2000), /REVISION_CONFLICT/);
    await assert.rejects(releaseContactClaim(t.db, AIDAN, armed, 'cancelled', NOW + 2000), /CLAIM_UNCERTAIN/);
    await assert.rejects(releaseContactClaim(t.db, AIDAN, armed, 'completed', NOW + 2000), /CLAIM_UNCERTAIN/);
    await reconcileClaim(t.db, AIDAN, input.attemptId, 'not_dialed', NOW + 3000);
    assert.equal(t.raw.prepare<[], { phase: string }>('SELECT phase FROM CallerContactControl').get()?.phase, 'closed');
  } finally { t.close(); }
});

test('shared phone numbers do not share ownership and a missing or ineligible source never gets a permit', async () => {
  const t = openCallerTestDb();
  try {
    t.raw.exec("INSERT INTO EngineProspect SELECT 'other.example',placeId,'Other fixture',city,niche,websiteUrl,phone,address,label,reasons,runId,firstSeenAt,lastSeenAt FROM EngineProspect");
    const one = await command(t), two = await command(t, 'other.example');
    assert.notEqual(one.contactKey, two.contactKey);
    await claimContact(t.db, AIDAN, one, NOW);
    assert.equal((await claimContact(t.db, RILEY, two, NOW)).state, 'reserved');
    await assert.rejects(claimContact(t.db, AIDAN, { ...one, contactKey: two.contactKey }, NOW), /NOT_FOUND/);
    t.raw.prepare("UPDATE EngineProspect SET label='WEAK' WHERE prospectId=?").run(two.entityId);
    await assert.rejects(claimContact(t.db, AIDAN, { ...two, attemptId: crypto.randomUUID() }, NOW), /STOPPED|REVISION_CONFLICT/);
  } finally { t.close(); }
});

test('failed attempt insert rolls back the contact reservation', async () => {
  const t = openCallerTestDb();
  try {
    const input = await command(t);
    t.raw.exec("CREATE TRIGGER fixture_fail BEFORE INSERT ON CallerAttempt BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
    await assert.rejects(claimContact(t.db, AIDAN, input, NOW));
    assert.equal(t.raw.prepare<[], { n: number }>('SELECT COUNT(*) n FROM CallerContactControl').get()?.n, 0);
  } finally { t.close(); }
});

test('a source change or stop between validation and the transaction cannot arm the call', async () => {
  for (const mutation of ['source', 'stop']) {
    const t = openCallerTestDb();
    try {
      const input = await command(t), reserved = await claimContact(t.db, AIDAN, input, NOW);
      const batch = t.db.batch.bind(t.db);
      t.db.batch = async statements => {
        if (statements.length === 3) {
          if (mutation === 'source') t.raw.prepare('UPDATE EngineProspect SET phone=?').run('+15195550102');
          else await setContactStop(t.db, RILEY, input.contactKey, 'Racing stop', NOW);
        }
        return batch(statements);
      };
      await assert.rejects(renewContactClaim(t.db, AIDAN, reserved, 'armed', NOW + 1000), /REVISION_CONFLICT|STOPPED/);
      assert.equal(t.raw.prepare<[], { phase: string }>('SELECT phase FROM CallerAttempt').get()?.phase, 'reserved');
    } finally { t.close(); }
  }
});

test('simultaneous same-attempt retries share one claim and stale release cannot close its replacement', async () => {
  const t = openCallerTestDb();
  try {
    const input = await command(t);
    const [one, two] = await Promise.all([claimContact(t.db, AIDAN, input, NOW), claimContact(t.db, AIDAN, input, NOW)]);
    assert.deepEqual(one, two);
    const next = await claimContact(t.db, RILEY, { ...input, attemptId: crypto.randomUUID() }, NOW + 120000);
    await assert.rejects(releaseContactClaim(t.db, AIDAN, one, 'cancelled', NOW + 120001), /NOT_FOUND|REVISION_CONFLICT/);
    assert.equal(t.raw.prepare<[], { attemptId: string }>('SELECT attemptId FROM CallerContactControl').get()?.attemptId, next.attemptId);
  } finally { t.close(); }
});

test('legacy/manual calls cannot bypass an open claim; notes remain possible and explicit stops hide every queue', async () => {
  const t = openCallerTestDb();
  try {
    const input = await command(t);
    await claimContact(t.db, AIDAN, input, NOW);
    const legacy = { idempotencyKey: crypto.randomUUID(), prospectId: input.entityId, channel: 'CALL', outcome: 'NO_ANSWER', note: 'Historical manual entry', followUpAt: null };
    await assert.rejects(recordProspectActivity(t.db, legacy, 'RILEY', RILEY.actorUserId), /CLAIM_REQUIRED/);
    await recordProspectActivity(t.db, { ...legacy, channel: 'NOTE', outcome: 'NOTE' }, 'RILEY', RILEY.actorUserId);
    await setContactStop(t.db, RILEY, input.contactKey, 'Explicit stop', NOW);
    assert.equal((await nextInQueue(t.db, '2026-09-26', '2026-09-26T04:00:00.000Z')).remaining, 0);
    await assert.rejects(recordProspectActivity(t.db, { ...legacy, idempotencyKey: crypto.randomUUID(), channel: 'VISIT' }, 'RILEY', RILEY.actorUserId), /STOPPED/);
  } finally { t.close(); }
});

test('saving a result closes its own attempt and release retries acknowledge without changing newer ownership', async () => {
  const t = openCallerTestDb();
  try {
    const input = await command(t);
    const reserved = await claimContact(t.db, AIDAN, input, NOW);
    const armed = await renewContactClaim(t.db, AIDAN, reserved, 'armed', NOW + 1000);
    const result = await engineResultFixture(t.db, { attemptId: input.attemptId, sourceRevision: input.sourceRevision });
    await recordEngineResult(t.db, AIDAN, result);
    assert.equal(t.raw.prepare<[], { phase: string }>('SELECT phase FROM CallerContactControl').get()?.phase, 'closed');
    await releaseContactClaim(t.db, AIDAN, armed, 'completed', NOW + 2000);
    const next = await command(t);
    const replacement = await claimContact(t.db, RILEY, next, NOW + 3000);
    await releaseContactClaim(t.db, AIDAN, armed, 'completed', NOW + 4000);
    assert.equal(t.raw.prepare<[], { attemptId: string }>('SELECT attemptId FROM CallerContactControl').get()?.attemptId, replacement.attemptId);
  } finally { t.close(); }
});
