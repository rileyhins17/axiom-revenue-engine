import type { CallerActor } from '../revenue-engine/caller-integration';
import type { CallerDb } from './database';
import { canonicalJson } from './canonical-json';
import { assertPeerLink, linkReceiptSchema, PeerError, type CallerBridge, type LinkIdentity, type LinkReceipt } from './peer-contract';
import { stageEngineLink, activateEngineLink } from './links';

/** Idempotent, fail-closed handshake. Pending mappings are retained on failure. */
export async function createSourceLink(db: CallerDb, actor: CallerActor, input: LinkIdentity, bridge: CallerBridge, now = Date.now()): Promise<LinkReceipt> {
  const link = assertPeerLink(bridge.grant, input);
  try {
    // Retain the initiating side first so every partial handshake is resumable in Settings.
    const local = await stageEngineLink(db, actor, bridge.grant, link, now);
    const peerPending = linkReceiptSchema.parse(await bridge.send('links/stage', link));
    // Validate the exact identity before changing the local coordination path.
    const { state, revision, ...peerIdentity } = peerPending;
    if (state !== 'pending' && state !== 'active' || revision < 1 || canonicalJson(peerIdentity) !== canonicalJson(link)) throw new PeerError('LINK_CONFLICT');
    const peerActive = linkReceiptSchema.parse(await bridge.send('links/activate', { link, peerReceipt: local }));
    return activateEngineLink(db, actor, bridge.grant, link, peerActive);
  } catch (error) {
    if (error instanceof PeerError) throw error;
    throw new PeerError('PEER_UNAVAILABLE', 503);
  }
}
