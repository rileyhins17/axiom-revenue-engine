import { v, identifier, calendarDate, clockTime, type Infer } from './validation';
import { canonicalJson } from './canonical-json';

export const PROTOCOL = 'axiom-caller/2' as const;
const isoTime = v.refine(v.text(24, 24), x => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x, 'expected canonical UTC timestamp');
const uuid = v.refine(identifier, x => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x), 'expected UUID');
const offset = v.refine(v.text(6, 6), x => /^[+-](0\d|1[0-4]):[0-5]\d$/.test(x) && (x.slice(1, 3) !== '14' || x.endsWith(':00')), 'expected UTC offset');
const zone = v.refine(v.text(100, 1), x => { try { new Intl.DateTimeFormat('en', { timeZone: x }); return true; } catch { return false; } }, 'expected IANA time zone');
export const sourceRefSchema = v.object({
    system: v.enum(['revenue-engine', 'orbit']), connectionId: identifier, workspaceId: identifier,
    entityType: v.enum(['prospect', 'client', 'opportunity']), entityId: v.refine(v.text(300, 1), x => /^[A-Za-z0-9._:-]+$/.test(x), 'expected a stable source record ID'),
});
export type SourceRef = Infer<typeof sourceRefSchema>;
export type System = SourceRef['system'];
export const purposeSchema = v.enum(['acquisition', 'prospect_follow_up', 'client_opportunity']);
export type Purpose = Infer<typeof purposeSchema>;
export const outcomeSchema = v.enum(['unknown', 'no_answer', 'voicemail', 'left_message', 'wrong_number', 'gatekeeper', 'connected', 'callback', 'interested', 'meeting_requested', 'meeting_booked', 'not_interested', 'do_not_contact']);
export type Outcome = Infer<typeof outcomeSchema>;
const provenance = v.enum(['operator', 'transcript_reviewed']);
export const nextActionSchema = v.object({
    kind: v.enum(['agreed_callback', 'operator_reminder', 'meeting', 'send_details']),
    description: v.text(2000, 1), originalWords: v.nullable(v.text(2000)),
    localDate: v.nullable(calendarDate), localTime: v.nullable(clockTime), timeZone: v.nullable(zone),
    utcOffset: v.nullable(offset), precision: v.enum(['unscheduled', 'date', 'time', 'window']),
    windowEndLocalTime: v.nullable(clockTime), scheduledAt: v.nullable(isoTime),
    timeStatus: v.enum(['unscheduled', 'date_only', 'resolved', 'needs_review']), provenance,
});
export type NextAction = Infer<typeof nextActionSchema>;
const decisionSchema = v.object({
    opportunityId: identifier, expectedRevision: identifier, kind: v.enum(['pitch', 'lost', 'sold']),
    soldAmountMinor: v.nullable(v.refine(v.number(0, Number.MAX_SAFE_INTEGER), Number.isSafeInteger, 'expected integer minor units')),
    currency: v.nullable(v.refine(v.text(3, 3), x => /^[A-Z]{3}$/.test(x), 'expected currency code')),
    confirmedByOperator: v.refine(v.boolean, x => x, 'operator confirmation required'),
});
export type OpportunityDecision = Infer<typeof decisionSchema>;
const resultSchema = v.object({
    protocol: v.enum([PROTOCOL]), eventId: uuid, attemptId: uuid, source: sourceRefSchema,
    purpose: purposeSchema, contactId: identifier, sourceRevision: identifier, evidenceRevision: v.nullable(identifier),
    occurredAt: isoTime, dialRequestedAt: v.nullable(isoTime), connectedAt: v.nullable(isoTime), endedAt: v.nullable(isoTime),
    outcome: outcomeSchema, attempted: v.nullable(v.boolean), summary: v.text(8000, 1), nextAction: v.nullable(nextActionSchema),
    stopScope: v.enum(['none', 'contact']), provenance, decisions: v.array(decisionSchema, 20), correctionOf: v.nullable(uuid),
});
export type ResultEvent = Infer<typeof resultSchema>;
const receiptSchema = v.object({
    protocol: v.enum([PROTOCOL]), eventId: uuid, attemptId: uuid, status: v.enum(['saved', 'already_saved']), recordId: identifier,
    payloadHash: v.refine(v.text(64, 64), x => /^[a-f0-9]{64}$/.test(x), 'expected SHA-256 hex digest'), receivedAt: isoTime,
});
export type Receipt = Infer<typeof receiptSchema>;
export function parseReceipt(value: unknown): Receipt { return receiptSchema.parse(value); }
export type ApiError = { code: 'AUTH_REQUIRED' | 'UPGRADE_REQUIRED' | 'INVALID_RESULT' | 'NOT_FOUND' | 'STOPPED' | 'CLAIM_HELD' | 'CLAIM_UNCERTAIN' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'TEMPORARY_FAILURE'; retryable: boolean; message: string };
function ensure(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }

/** Candidate instants are round-tripped through the requested zone, including DST. */
function localCandidates(date: string, time: string, timeZone: string): { at: string; offset: string }[] {
    const naive = Date.parse(date + 'T' + time + ':00.000Z');
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const parts = (at: number) => Object.fromEntries(formatter.formatToParts(at).map(p => [p.type, p.value]));
    const offsets = new Set<number>();
    for (let hour = -36; hour <= 36; hour += 3) {
        const at = naive + hour * 3600000, p = parts(at);
        offsets.add((Date.parse(`${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}:${p['second']}.000Z`) - at) / 60000);
    }
    const candidates: { at: string; offset: string }[] = [];
    for (const minutes of offsets) {
        const at = naive - minutes * 60000, p = parts(at);
        if (`${p['year']}-${p['month']}-${p['day']}` === date && `${p['hour']}:${p['minute']}` === time) {
            candidates.push({ at: new Date(at).toISOString(), offset: (minutes < 0 ? '-' : '+') + String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0') + ':' + String(Math.abs(minutes) % 60).padStart(2, '0') });
        }
    }
    return candidates;
}

export function validateCallback(input: unknown): NextAction {
    const action = nextActionSchema.parse(input);
    if (action.precision === 'unscheduled') {
        ensure(action.localTime === null && action.utcOffset === null && action.scheduledAt === null && action.windowEndLocalTime === null, 'Unscheduled action cannot assert a clock time');
        return { ...action, timeStatus: 'unscheduled' };
    }
    ensure(action.localDate !== null, 'Scheduled action requires a real date');
    if (action.precision === 'date') {
        ensure(action.localTime === null && action.utcOffset === null && action.scheduledAt === null && action.windowEndLocalTime === null, 'Date-only action cannot assert an instant');
        return { ...action, timeStatus: 'date_only' };
    }
    ensure(action.localTime !== null && action.timeZone !== null, 'Clock time requires an IANA zone');
    if (action.precision === 'window') ensure(action.windowEndLocalTime !== null && action.windowEndLocalTime > action.localTime, 'Window must end later on the same local date');
    else ensure(action.windowEndLocalTime === null, 'Only a window can have an end time');
    const candidates = localCandidates(action.localDate, action.localTime, action.timeZone);
    const chosen = action.utcOffset !== null ? candidates.find(c => c.offset === action.utcOffset) : candidates.length === 1 ? candidates[0] : undefined;
    if (action.utcOffset !== null) ensure(chosen !== undefined, 'Offset does not match the local time and zone');
    const end = action.windowEndLocalTime === null ? null : localCandidates(action.localDate, action.windowEndLocalTime, action.timeZone);
    if (!chosen || (end !== null && end.length !== 1)) {
        ensure(action.scheduledAt === null, 'Ambiguous or skipped clock time cannot assert an instant');
        return { ...action, scheduledAt: null, timeStatus: 'needs_review' };
    }
    ensure(action.scheduledAt === null || action.scheduledAt === chosen.at, 'Scheduled instant conflicts with agreed local time');
    return { ...action, utcOffset: chosen.offset, scheduledAt: chosen.at, timeStatus: 'resolved' };
}

export function parseResultEvent(input: unknown): ResultEvent {
    ensure(new TextEncoder().encode(canonicalJson(input)).byteLength <= 32768, 'Result exceeds 32 KiB');
    const parsed = resultSchema.parse(input);
    const event = { ...parsed, nextAction: parsed.nextAction ? validateCallback(parsed.nextAction) : null };
    let previous = event.occurredAt;
    for (const at of [event.dialRequestedAt, event.connectedAt, event.endedAt]) {
        if (at !== null) { ensure(at >= previous, 'Call timestamps are out of order'); previous = at; }
    }
    ensure(event.correctionOf !== event.eventId, 'A result cannot correct itself');
    ensure(event.attempted !== false || (event.connectedAt === null && event.outcome === 'unknown'), 'A non-attempt cannot assert connection or a call outcome');
    ensure(event.outcome !== 'no_answer' || event.connectedAt === null, 'No answer cannot assert a connection');
    ensure((event.outcome === 'do_not_contact') === (event.stopScope === 'contact'), 'Contact stop must be explicit');
    ensure(event.outcome !== 'callback' || event.nextAction?.kind === 'agreed_callback', 'Callback needs the agreed next action');
    ensure(event.outcome !== 'meeting_booked' || (event.nextAction?.kind === 'meeting' && (event.nextAction.timeStatus === 'resolved' || event.nextAction.description.trim().length >= 10)), 'A booking requires reviewed meeting details');
    ensure(event.purpose !== 'client_opportunity' || (event.source.system === 'orbit' && event.source.entityType !== 'prospect'), 'Client purpose requires an Orbit client or opportunity');
    ensure(event.decisions.length === 0 || event.purpose === 'client_opportunity', 'Sales decisions require a client/opportunity call');
    ensure(new Set(event.decisions.map(d => d.opportunityId)).size === event.decisions.length, 'Duplicate opportunity decisions');
    for (const d of event.decisions) ensure(d.kind === 'sold' ? d.soldAmountMinor !== null && d.currency !== null : d.soldAmountMinor === null && d.currency === null, 'Money belongs only to a reviewed sale');
    return event;
}

export function sourceKey(source: SourceRef): string { return canonicalJson(sourceRefSchema.parse(source)); }
