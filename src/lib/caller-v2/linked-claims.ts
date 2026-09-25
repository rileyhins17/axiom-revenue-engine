import { z } from 'zod';
import type { CallerActor } from '../revenue-engine/caller-integration';
import type { CallerDb } from './database';
import { canonicalJson } from './canonical-json';
import { ENGINE_WORKSPACE, CallerError } from './identity';
import { sourceRefSchema, type SourceRef } from './protocol';
import { assertPeerLink, PeerError, peerActorKey, type LinkReceipt, type CallerBridge } from './peer-contract';
import { getEngineLink, getEngineContactLink } from './links';
import { claimContact, renewContactClaim, type Claim, type LinkedAuthorization } from './claims';

export type { CallerBridge } from './peer-contract';
const sourceCheckSchema = z.object({ linkId: z.string().uuid(), contactId: z.string().uuid(), source: sourceRefSchema, revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const peerClaimSchema = z.object({ linkId: z.string().uuid(), source: sourceRefSchema, actorId: z.string().min(1).max(128), attemptId: z.string().uuid(), sourceRevision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type PeerClaimCommand = z.infer<typeof peerClaimSchema>;
function activeLink(link: LinkReceipt | null, bridge: CallerBridge) {
  if (!link || link.state !== 'active' || link.revision !== 2) throw new PeerError('LINK_CHECK_REQUIRED');
  assertPeerLink(bridge.grant, { linkId: link.linkId, grantId: link.grantId, engineRef: link.engineRef, orbitRef: link.orbitRef,
    engineContactKey: link.engineContactKey, orbitContactId: link.orbitContactId, confirmed: true });
  return link;
}
async function checkOrbit(bridge: CallerBridge, link: LinkReceipt, source: SourceRef, actorId: string | null) {
  if (source.system !== 'orbit' || source.workspaceId !== bridge.grant.orbitWorkspaceId || source.connectionId !== bridge.grant.orbitConnectionId) throw new PeerError('PEER_SCOPE', 403);
  let raw: unknown;
  try { raw = await bridge.send('source/check', { linkId: link.linkId, source, actorId }); }
  catch (error) { if (error instanceof PeerError) throw error; throw new PeerError('PEER_UNAVAILABLE', 503); }
  const checked = sourceCheckSchema.safeParse(raw);
  if (!checked.success || checked.data.linkId !== link.linkId || checked.data.contactId !== link.orbitContactId || canonicalJson(checked.data.source) !== canonicalJson(source)) throw new PeerError('PEER_UNAVAILABLE', 503);
  return checked.data.revision;
}
export async function claimEngineLinkedContact(db: CallerDb, actor: CallerActor, input: Parameters<typeof claimContact>[2], bridge: CallerBridge, now = Date.now()): Promise<Claim> {
  const link = activeLink(await getEngineContactLink(db, input.contactKey), bridge);
  await checkOrbit(bridge, link, link.orbitRef, null);
  return claimContact(db, actor, input, now, { linkId: link.linkId, linkRevision: link.revision, originSourceJson: null, originActorId: null, sourceRevision: input.sourceRevision });
}
export async function claimPeerLinkedContact(db: CallerDb, raw: PeerClaimCommand, bridge: CallerBridge, now = Date.now()): Promise<Claim> {
  const input = peerClaimSchema.parse(raw), link = activeLink(await getEngineLink(db, input.linkId), bridge);
  const revision = await checkOrbit(bridge, link, input.source, input.actorId);
  if (revision !== input.sourceRevision) throw new PeerError('REVISION_CONFLICT');
  return claimContact(db, { actorUserId: await peerActorKey(bridge.grant, input.actorId) }, { entityId: link.engineRef.entityId, contactKey: link.engineContactKey, attemptId: input.attemptId, sourceRevision: revision }, now,
    { linkId: link.linkId, linkRevision: link.revision, originSourceJson: canonicalJson(input.source), originActorId: input.actorId, sourceRevision: revision });
}
async function renewalAuthorization(db: CallerDb, actorId: string, claim: Claim, state: 'reserved' | 'armed' | 'active', bridge: CallerBridge): Promise<LinkedAuthorization> {
  const attempt = await db.prepare('SELECT linkId,sourceRevision,originSourceJson,originActorId,ownerId FROM CallerAttempt WHERE workspaceId=? AND attemptId=?').bind(ENGINE_WORKSPACE, claim.attemptId)
    .first<{linkId:string;sourceRevision:string;originSourceJson:string|null;originActorId:string|null;ownerId:string}>();
  if (!attempt || attempt.ownerId !== actorId || claim.ownerId !== actorId) throw new CallerError('NOT_FOUND', 404);
  const link = activeLink(await getEngineLink(db, attempt.linkId), bridge);
  if (state !== 'active') {
    const revision = await checkOrbit(bridge, link, attempt.originSourceJson ? sourceRefSchema.parse(JSON.parse(attempt.originSourceJson)) : link.orbitRef, attempt.originActorId);
    if (attempt.originSourceJson && revision !== attempt.sourceRevision) throw new PeerError('REVISION_CONFLICT');
  }
  return { linkId: link.linkId, linkRevision: link.revision, originSourceJson: attempt.originSourceJson, originActorId: attempt.originActorId, sourceRevision: attempt.sourceRevision };
}
export async function renewEngineLinkedClaim(db: CallerDb, actor: CallerActor, claim: Claim, state: 'reserved' | 'armed' | 'active', bridge: CallerBridge, now = Date.now()): Promise<Claim> {
  const auth = await renewalAuthorization(db, actor.actorUserId, claim, state, bridge);
  if (auth.originSourceJson) throw new CallerError('NOT_FOUND', 404);
  return renewContactClaim(db, actor, claim, state, now, auth);
}
export async function renewPeerLinkedClaim(db: CallerDb, input: { actorId: string; claim: Claim; state: 'reserved' | 'armed' | 'active' }, bridge: CallerBridge, now = Date.now()): Promise<Claim> {
  const ownerId = await peerActorKey(bridge.grant, input.actorId), auth = await renewalAuthorization(db, ownerId, input.claim, input.state, bridge);
  if (!auth.originSourceJson || auth.originActorId !== input.actorId) throw new CallerError('NOT_FOUND', 404);
  return renewContactClaim(db, { actorUserId: ownerId }, input.claim, input.state, now, auth);
}
