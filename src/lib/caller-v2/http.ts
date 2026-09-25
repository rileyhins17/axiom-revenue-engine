import type { CallerDb } from './database';
import { z } from 'zod';
import { authenticateEngineCaller } from './auth';
import { assertEngineSource, CallerError, engineContactId, engineIdentity } from './identity';
import { getEngineReceipt, recordEngineResult } from './repository';
import { parseResultEvent, sourceRefSchema } from './protocol';
import { listEngineCallTasks, prepareEngineCall } from './source';
import { claimContact, renewContactClaim, releaseContactClaim, reconcileClaim, setContactStop } from './claims';

const claimSchema = z.object({ attemptId: z.uuid(), ownerId: z.string().min(1).max(128), contactKey: z.string().max(2048), revision: z.number().int().nonnegative(), expiresAt: z.iso.datetime(), state: z.enum(['reserved','armed','active','uncertain','closed']) }).strict();
const parseSource = (input: unknown) => { try { const source = sourceRefSchema.parse(input); assertEngineSource(source); return source; } catch (error) { if (error instanceof CallerError) throw error; throw new CallerError('INVALID_REQUEST', 400); } };

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
    if (route === 'connection' || route === 'tasks') {
      if (request.method !== 'GET') throw new CallerError('METHOD_NOT_ALLOWED', 405);
      if (route === 'connection') return json(engineIdentity(actor));
      const query = new URL(request.url).searchParams;
      return json(await listEngineCallTasks(db, query.get('cursor'), query.has('limit') ? Number(query.get('limit')) : 10));
    }
    if (['prepare','claims','claims/renew','claims/release','claims/reconcile','stop'].includes(route)) {
      if (request.method !== 'POST') throw new CallerError('METHOD_NOT_ALLOWED', 405);
      const body = await readCallerJson(request);
      if (route === 'prepare') {
        const command = z.object({ source: z.unknown() }).strict().parse(body);
        return json(await prepareEngineCall(db, actor, parseSource(command.source)));
      }
      if (route === 'claims') {
        const command = z.object({ source: z.unknown(), attemptId: z.uuid(), sourceRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(body);
        const source = parseSource(command.source);
        return json(await claimContact(db, actor, { entityId: source.entityId, contactKey: await engineContactId(source.entityId), attemptId: command.attemptId, sourceRevision: command.sourceRevision }));
      }
      if (route === 'claims/renew') {
        const command = z.object({ claim: claimSchema, state: z.enum(['reserved','armed','active']) }).strict().parse(body);
        return json(await renewContactClaim(db, actor, command.claim, command.state));
      }
      if (route === 'claims/release') {
        const command = z.object({ claim: claimSchema, reason: z.enum(['completed','cancelled','uncertain']) }).strict().parse(body);
        await releaseContactClaim(db, actor, command.claim, command.reason);
        return json({ released: true });
      }
      if (route === 'claims/reconcile') {
        const command = z.object({ attemptId: z.uuid(), resolution: z.enum(['not_dialed','call_finished']) }).strict().parse(body);
        await reconcileClaim(db, actor, command.attemptId, command.resolution);
        return json({ released: true });
      }
      const command = z.object({ source: z.unknown(), reason: z.string().min(1).max(2000) }).strict().parse(body);
      const source = parseSource(command.source);
      // Require a real source; a stop remains valid even if it is no longer callable.
      const exists = await db.prepare('SELECT 1 FROM EngineProspect WHERE prospectId=?').bind(source.entityId).first();
      if (!exists) throw new CallerError('NOT_FOUND', 404);
      await setContactStop(db, actor, await engineContactId(source.entityId), command.reason, Date.now(), source.entityId);
      return json({ stopped: true });
    }
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
    if (error instanceof z.ZodError) return json({ code: 'INVALID_REQUEST', retryable: false, message: 'Check the request fields.' }, 400);
    const known = error instanceof CallerError;
    return json({ code: known ? error.code : 'TEMPORARY_FAILURE', retryable: !known, message: known ? error.code.replaceAll('_', ' ').toLowerCase() : 'The result remains saved in Caller. Retry shortly.' }, known ? error.status : 503);
  }
}
