import type { CallerDb } from './database';
import { authenticateEngineCaller } from './auth';
import { CallerError } from './identity';
import { getEngineReceipt, recordEngineResult } from './repository';
import { parseResultEvent } from './protocol';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization' } });
export async function readCallerJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new CallerError('INVALID_JSON', 400);
  const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 32768) { void reader.cancel().catch(() => undefined); throw new CallerError('BODY_TOO_LARGE', 413); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) { if (error instanceof CallerError) throw error; throw new CallerError('INVALID_JSON', 400); }
  finally { reader.releaseLock(); }
}
export async function handleEngineCallerRequest(db: CallerDb, request: Request, route: string): Promise<Response> {
  try {
    const actor = await authenticateEngineCaller(db, request.headers.get('Authorization'));
    if (!actor) return json({ code: 'AUTH_REQUIRED', retryable: false, message: 'Connect Caller with a token from your active owner account.' }, 401);
    if (route === 'results') {
      if (request.method !== 'POST') throw new CallerError('METHOD_NOT_ALLOWED', 405);
      const body = await readCallerJson(request);
      let event;
      try { event = parseResultEvent(body); } catch (error) { throw new CallerError('INVALID_RESULT', error instanceof Error && error.name === 'ZodError' ? 400 : 422); }
      const receipt = await recordEngineResult(db, actor, event);
      return json(receipt, receipt.status === 'saved' ? 201 : 200);
    }
    if (route.startsWith('receipts/')) {
      if (request.method !== 'GET') throw new CallerError('METHOD_NOT_ALLOWED', 405);
      const eventId = route.slice('receipts/'.length);
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(eventId)) throw new CallerError('NOT_FOUND', 404);
      const receipt = await getEngineReceipt(db, actor, eventId);
      if (!receipt) throw new CallerError('NOT_FOUND', 404);
      return json(receipt);
    }
    throw new CallerError('NOT_FOUND', 404);
  } catch (error) {
    const known = error instanceof CallerError;
    return json({ code: known ? error.code : 'TEMPORARY_FAILURE', retryable: !known, message: known ? error.code.replaceAll('_', ' ').toLowerCase() : 'The result remains saved in Caller. Retry shortly.' }, known ? error.status : 503);
  }
}
