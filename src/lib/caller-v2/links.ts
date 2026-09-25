import { planEngineStopDelivery } from './stop-projection';
import { readEngineCallSource } from './source-state';
import type { CallerActor } from '../revenue-engine/caller-integration';
import type { CallerDb } from './database';
import { canonicalJson } from './canonical-json';
import { engineContactId, ENGINE_WORKSPACE } from './identity';
import { assertPeerLink, linkReceiptSchema, PeerError, type LinkIdentity, type LinkReceipt, type PeerGrant } from './peer-contract';

type StoredLink = { identityJson: string; state: 'pending' | 'active'; revision: number };
const view = (row: StoredLink): LinkReceipt => linkReceiptSchema.parse({ ...JSON.parse(row.identityJson), state: row.state, revision: row.revision });
export async function getEngineContactLink(db: CallerDb, contactKey: string): Promise<LinkReceipt | null> {
  const row = await db.prepare('SELECT * FROM CallerSourceLink WHERE workspaceId=? AND engineContactKey=?').bind(ENGINE_WORKSPACE, contactKey).first<StoredLink>();
  return row ? view(row) : null;
}
export async function getEngineLink(db: CallerDb, linkId: string): Promise<LinkReceipt | null> {
  const row = await db.prepare('SELECT * FROM CallerSourceLink WHERE workspaceId=? AND linkId=?').bind(ENGINE_WORKSPACE, linkId).first<StoredLink>();
  return row ? view(row) : null;
}
function sameIdentity(link: LinkReceipt, expected: LinkIdentity) {
  return canonicalJson(link) === canonicalJson({ ...expected, state: link.state, revision: link.revision });
}
export async function stageEngineLink(db: CallerDb, actor: CallerActor, grant: PeerGrant, input: LinkIdentity, now = Date.now()): Promise<LinkReceipt> {
  const link = assertPeerLink(grant, input);
  if (link.engineContactKey !== await engineContactId(link.engineRef.entityId)) throw new PeerError('NOT_FOUND', 404);
  if (!await db.prepare('SELECT 1 FROM EngineProspect WHERE prospectId=?').bind(link.engineRef.entityId).first()) throw new PeerError('NOT_FOUND', 404);
  const previous = await getEngineLink(db, link.linkId);
  if (previous) { if (!sameIdentity(previous, link)) throw new PeerError('LINK_CONFLICT'); return previous; }
  try {
    // The insert trigger checks contact ownership in the same database statement.
    const source=await readEngineCallSource(db,link.engineRef.entityId,now);
    const stopped=source.source.stopped||await db.prepare('SELECT 1 FROM CallerContactControl WHERE workspaceId=? AND contactKey=? AND stopped=1').bind(ENGINE_WORKSPACE,link.engineContactKey).first();
    await db.batch([db.prepare(`INSERT INTO CallerSourceLink(workspaceId,linkId,grantId,sourceEntityId,engineContactKey,orbitWorkspaceId,orbitContactId,identityJson,state,revision,confirmedBy,createdAt)
      VALUES(?,?,?,?,?,?,?,?,'pending',1,?,?)`).bind(ENGINE_WORKSPACE, link.linkId, link.grantId, link.engineRef.entityId, link.engineContactKey,
      link.orbitRef.workspaceId, link.orbitContactId, canonicalJson(link), actor.actorUserId, new Date(now).toISOString()),
      ...stopped?await planEngineStopDelivery(db,link.engineContactKey,actor.actorUserId,new Date(now).toISOString(),link):[],
    ]);
  } catch (error) {
    const winner = await getEngineLink(db, link.linkId);
    if (winner && sameIdentity(winner, link)) return winner;
    if (error instanceof Error && /CALLER_LINK_CLAIM_HELD/.test(error.message)) throw new PeerError('CLAIM_HELD');
    if (error instanceof Error && /UNIQUE constraint/.test(error.message)) throw new PeerError('LINK_CONFLICT');
    throw error;
  }
  return { ...link, state: 'pending', revision: 1 };
}
export async function activateEngineLink(db: CallerDb, _actor: CallerActor, grant: PeerGrant, input: LinkIdentity, peerInput: LinkReceipt): Promise<LinkReceipt> {
  const link = assertPeerLink(grant, input), peer = linkReceiptSchema.parse(peerInput), local = await getEngineLink(db, link.linkId);
  if (!local || !sameIdentity(local, link) || !sameIdentity(peer, link) || peer.state !== 'active' || peer.revision !== 2) throw new PeerError('LINK_CONFLICT');
  await db.prepare("UPDATE CallerSourceLink SET state='active',revision=2 WHERE workspaceId=? AND linkId=? AND identityJson=?")
    .bind(ENGINE_WORKSPACE, link.linkId, canonicalJson(link)).run();
  return { ...link, state: 'active', revision: 2 };
}
