import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseResultEvent, parseReceipt, validateCallback } from './protocol';
import { canonicalJson } from './canonical-json';
const valid = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));

test('strict contract preserves agreed callback, identity and wording', () => {
  assert.deepEqual(parseResultEvent(valid), valid);
  for (const change of [{ actorId: 'other' }, { protocol: 'axiom-caller/1' }, { outcome: 'sold' }, { summary: 'x'.repeat(8001) }, { connectedAt: '2026-09-24T17:00:00.000Z' }]) {
    assert.throws(() => parseResultEvent({ ...valid, ...change }));
  }
  assert.throws(() => parseResultEvent({ ...valid, source: { ...valid.source, actorId: 'other' } }));
});
test('unknown, no answer and meeting request preserve their actual meaning', () => {
  for (const outcome of ['unknown', 'no_answer', 'meeting_requested']) {
    const result = parseResultEvent({ ...valid, outcome, connectedAt: null, nextAction: null });
    assert.equal(result.outcome, outcome);
  }
  assert.throws(() => parseResultEvent({ ...valid, outcome: 'meeting_booked', nextAction: null }));
  assert.throws(() => parseResultEvent({ ...valid, outcome: 'do_not_contact' }));
  assert.throws(() => parseResultEvent({ ...valid, attempted: false }));
});
test('calendar validation preserves date-only and unscheduled callbacks', () => {
  const date = { ...valid.nextAction, precision: 'date', localTime: null, utcOffset: null, scheduledAt: null, timeStatus: 'date_only' };
  assert.deepEqual(validateCallback(date), date);
  assert.throws(() => validateCallback({ ...date, localDate: '2026-02-30' }));
  assert.throws(() => validateCallback({ ...valid.nextAction, timeZone: 'not/a-zone' }));
  assert.throws(() => validateCallback({ ...valid.nextAction, utcOffset: '-05:00' }));
});
test('Toronto daylight-saving overlap needs an explicit valid offset', () => {
  const action = { ...valid.nextAction, localDate: '2026-11-01', localTime: '01:30', utcOffset: null, scheduledAt: null, timeStatus: 'needs_review' };
  assert.equal(validateCallback(action).scheduledAt, null);
  assert.equal(validateCallback(action).timeStatus, 'needs_review');
  assert.equal(validateCallback({ ...action, utcOffset: '-04:00' }).scheduledAt, '2026-11-01T05:30:00.000Z');
  assert.equal(validateCallback({ ...action, utcOffset: '-05:00' }).scheduledAt, '2026-11-01T06:30:00.000Z');
});
test('a skipped clock time and ambiguous window remain reviewable without inventing time', () => {
  const gap = { ...valid.nextAction, localDate: '2026-03-08', localTime: '02:30', utcOffset: null, scheduledAt: null, timeStatus: 'needs_review' };
  assert.equal(validateCallback(gap).scheduledAt, null);
  assert.equal(validateCallback(gap).originalWords, valid.nextAction.originalWords);
  assert.throws(() => validateCallback({ ...gap, scheduledAt: '2026-03-08T07:30:00.000Z' }));
  assert.throws(() => validateCallback({ ...valid.nextAction, precision: 'window', windowEndLocalTime: '12:00' }));
});
test('sales require reviewed integer amounts and cannot masquerade as dispositions', () => {
  const sale = { opportunityId: 'o1', expectedRevision: 'r1', kind: 'sold', soldAmountMinor: 120000, currency: 'CAD', confirmedByOperator: true };
  const input = { ...valid, source: { ...valid.source, entityType: 'client' }, purpose: 'client_opportunity', decisions: [sale] };
  assert.equal(parseResultEvent(input).decisions[0].soldAmountMinor, 120000);
  for (const value of [1.5, -1, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => parseResultEvent({ ...input, decisions: [{ ...sale, soldAmountMinor: value }] }));
  assert.throws(() => parseResultEvent({ ...valid, decisions: [sale] }));
  assert.throws(() => parseResultEvent({ ...input, decisions: [sale, sale] }));
});
test('canonical identity sorts objects, retains array order, rejects unsupported values', () => {
  assert.equal(canonicalJson({ b: 2, a: [3, 1] }), '{"a":[3,1],"b":2}');
  assert.equal(canonicalJson({ a: { y: 2, x: 1 } }), canonicalJson({ a: { x: 1, y: 2 } }));
  for (const value of [undefined, NaN, Infinity, new Date(), { x: undefined }, Array(2)]) assert.throws(() => canonicalJson(value));
});
test('receipt accepts only durable exact result identities', () => {
  const receipt = { protocol: 'axiom-caller/2', eventId: valid.eventId, attemptId: valid.attemptId, status: 'saved', recordId: 'record1', payloadHash: 'a'.repeat(64), receivedAt: valid.endedAt };
  assert.deepEqual(parseReceipt(receipt), receipt);
  assert.throws(() => parseReceipt({ ...receipt, status: 'pending' }));
  assert.throws(() => parseReceipt({ ...receipt, payloadHash: 'bad' }));
});
test('source record IDs preserve existing domain and place identities', () => {
  for (const entityId of ['fixture.example', 'place:fixture_123']) assert.equal(parseResultEvent({ ...valid, source: { ...valid.source, entityId } }).source.entityId, entityId);
  for (const entityId of ['a/b', 'a?token=secret', 'a\nother']) assert.throws(() => parseResultEvent({ ...valid, source: { ...valid.source, entityId } }));
});
