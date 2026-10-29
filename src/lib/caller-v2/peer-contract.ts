import { z } from 'zod';
import { sourceRefSchema } from './protocol';
import { canonicalJson } from './canonical-json';

// Kept identical in both servers. This is a server-only capability, never a
// Caller credential or a destination supplied by a source page.
export class PeerError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export type PeerGrant = {
  grantId: string; secret: string; engineWorkspaceId: string; engineConnectionId: string;
  orbitWorkspaceId: string; orbitConnectionId: string;
};
const envSchema = z.object({
  CALLER_PEER_GRANT_ID: z.string().uuid(), CALLER_PEER_SECRET: z.string().regex(/^[a-f0-9]{64}$/),
  CALLER_ORBIT_WORKSPACE_ID: z.string().min(1).max(128), CALLER_ORBIT_CONNECTION_ID: z.string().min(1).max(128),
});
export function peerGrant(env: unknown): PeerGrant {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new PeerError('PEER_NOT_CONFIGURED', 503);
  const e = parsed.data;
  return { grantId: e.CALLER_PEER_GRANT_ID, secret: e.CALLER_PEER_SECRET,
    engineWorkspaceId: 'axiom', engineConnectionId: 'axiom-engine',
    orbitWorkspaceId: e.CALLER_ORBIT_WORKSPACE_ID, orbitConnectionId: e.CALLER_ORBIT_CONNECTION_ID };
}
export const linkIdentitySchema = z.object({
  linkId: z.string().uuid(), grantId: z.string().uuid(), engineRef: sourceRefSchema, orbitRef: sourceRefSchema,
  engineContactKey: z.string().regex(/^ec-[a-f0-9]{64}$/), orbitContactId: z.string().uuid(), confirmed: z.literal(true),
}).strict();
export type LinkIdentity = z.infer<typeof linkIdentitySchema>;
export const linkReceiptSchema = linkIdentitySchema.extend({ state: z.enum(['pending', 'active']), revision: z.number().int().min(1).max(2) }).strict();
export type LinkReceipt = z.infer<typeof linkReceiptSchema>;
export function assertPeerLink(grant: PeerGrant, input: unknown): LinkIdentity {
  const link = linkIdentitySchema.parse(input);
  if (link.grantId !== grant.grantId || link.engineRef.system !== 'revenue-engine' || link.engineRef.entityType !== 'prospect' ||
    link.engineRef.workspaceId !== grant.engineWorkspaceId || link.engineRef.connectionId !== grant.engineConnectionId ||
    link.orbitRef.system !== 'orbit' || link.orbitRef.workspaceId !== grant.orbitWorkspaceId || link.orbitRef.connectionId !== grant.orbitConnectionId)
    throw new PeerError('PEER_SCOPE', 403);
  return link;
}
export const peerOperationSchema = z.enum(['links/preview', 'links/stage', 'links/activate', 'source/check', 'claims', 'claims/renew', 'claims/release', 'claims/reconcile', 'projections', 'stop', 'conversion/request', 'conversion/receipt', 'conversion/context', 'conversion/reserve', 'conversion/finalize']);
export type PeerOperation = z.infer<typeof peerOperationSchema>;
export type CallerBridge = { grant: PeerGrant; send(operation: PeerOperation, payload: unknown): Promise<unknown> };
export async function peerActorKey(grant: Pick<PeerGrant,'grantId'|'orbitWorkspaceId'>, actorId: string) {
  const bytes = new TextEncoder().encode(canonicalJson([grant.grantId, grant.orbitWorkspaceId, actorId]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return 'op-' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const commandSchema = z.object({
  protocol: z.literal('axiom-caller-peer/1'), grantId: z.string().uuid(),
  engineWorkspaceId: z.string(), engineConnectionId: z.string(), orbitWorkspaceId: z.string(), orbitConnectionId: z.string(),
  operation: peerOperationSchema, sentAt: z.string().datetime(), payload: z.unknown(), signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signPeerCommand<T>(grant: PeerGrant, operation: PeerOperation, payload: T, now = Date.now()) {
  const { secret, ...scope } = grant;
  const body = { protocol: 'axiom-caller-peer/1' as const, ...scope, operation, sentAt: new Date(now).toISOString(), payload };
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(canonicalJson(body)));
  return { ...body, signature: [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, '0')).join('') };
}
export async function verifyPeerCommand(grant: PeerGrant, operation: PeerOperation, input: unknown, now = Date.now()): Promise<unknown> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new PeerError('PEER_AUTH_REQUIRED', 401);
  const { signature, ...body } = parsed.data;
  if (body.operation !== operation || body.grantId !== grant.grantId || body.engineWorkspaceId !== grant.engineWorkspaceId ||
    body.engineConnectionId !== grant.engineConnectionId || body.orbitWorkspaceId !== grant.orbitWorkspaceId ||
    body.orbitConnectionId !== grant.orbitConnectionId || Math.abs(now - Date.parse(body.sentAt)) > 60_000)
    throw new PeerError('PEER_AUTH_REQUIRED', 401);
  const bytes = Uint8Array.from(signature.match(/../g)!, byte => Number.parseInt(byte, 16));
  if (!await crypto.subtle.verify('HMAC', await hmacKey(grant.secret), bytes, new TextEncoder().encode(canonicalJson(body))))
    throw new PeerError('PEER_AUTH_REQUIRED', 401);
  return body.payload;
}
export async function requestPeer(grant: PeerGrant, target: 'orbit' | 'revenue-engine', operation: PeerOperation, payload: unknown, fetcher = fetch): Promise<unknown> {
  const origin = target === 'orbit' ? 'https://orbit.getaxiom.ca' : 'https://operations.getaxiom.ca';
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
  try {
    const response = await fetcher(origin + '/api/caller/v2/peer/' + operation, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', cache: 'no-store',
      signal: abort.signal, body: JSON.stringify(await signPeerCommand(grant, operation, payload)),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new PeerError('PEER_UNAVAILABLE', 503);
    let size = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 32768) { void reader.cancel().catch(() => undefined); throw new PeerError('PEER_UNAVAILABLE', 503); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    const result: unknown = JSON.parse(text);
    if (!response.ok) {
      // Peer errors are deliberately bounded; never surface response bodies or credentials.
      const code = z.object({ code: z.enum(['STOPPED', 'CLAIM_HELD', 'CLAIM_UNCERTAIN', 'REVISION_CONFLICT', 'NOT_FOUND', 'LINK_CONFLICT', 'LINK_CHECK_REQUIRED', 'MISSING_ORIGIN', 'IDEMPOTENCY_CONFLICT', 'INVALID_PROJECTION', 'PEER_SCOPE', 'PEER_AUTH_REQUIRED']) }).safeParse(result);
      throw new PeerError(code.success ? code.data.code : 'PEER_UNAVAILABLE', response.status === 404 ? 404 : response.status < 500 ? 409 : 503);
    }
    return result;
  } catch (error) {
    if (error instanceof PeerError) throw error;
    throw new PeerError('PEER_UNAVAILABLE', 503);
  } finally { clearTimeout(timer); }
}
