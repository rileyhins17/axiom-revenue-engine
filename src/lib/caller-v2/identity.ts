import type { CallerActor } from '../revenue-engine/caller-integration';
import type { SourceRef } from './protocol';

// Revenue Engine currently has one owner workspace. Never accept these from a request.
export const ENGINE_WORKSPACE = 'axiom';
export const ENGINE_CONNECTION = 'axiom-engine';
export class CallerError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export function engineIdentity(actor: CallerActor) {
  return { system: 'revenue-engine' as const, connectionId: ENGINE_CONNECTION, workspaceId: ENGINE_WORKSPACE, actorId: actor.actorUserId, protocol: 'axiom-caller/2' as const, capabilities: ['results', 'tasks', 'prepare', 'claims'] };
}
export function assertEngineSource(source: SourceRef): void {
  if (source.system !== 'revenue-engine' || source.connectionId !== ENGINE_CONNECTION || source.workspaceId !== ENGINE_WORKSPACE || source.entityType !== 'prospect') throw new CallerError('NOT_FOUND', 404);
}
export async function engineContactId(entityId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('engine-prospect:' + entityId));
  return 'ec-' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
