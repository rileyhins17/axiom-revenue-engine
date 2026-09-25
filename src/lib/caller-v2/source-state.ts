import type { CallerDb } from './database';
import { CallerError } from './identity';
import { PROSPECT_LATEST_SQL } from '../revenue-engine/engine-prospects-d1';
import { torontoToday, torontoMidnight } from '../prospect-format';

// The exact database snapshot is also compared inside the claiming transaction.
// Its hash is a public revision, never a substitute for that atomic comparison.
export const SOURCE_SNAPSHOT_SQL = `SELECT json_object(
  'entityId',prospectId,'name',name,'phone',phone,'websiteUrl',websiteUrl,
  'city',city,'niche',niche,'label',label,'reasons',reasons,'lastSeenAt',lastSeenAt,
  'lastOutcome',lastOutcome,'lastActivityAt',lastActivityAt,'followUpAt',followUpAt,
  'stopped',stopped,'attempts',attempts,
  'activityRevision',(SELECT COALESCE(MAX(rowid),0) FROM EngineProspectActivity WHERE prospectId=source.prospectId)
) AS snapshot FROM (${PROSPECT_LATEST_SQL}) source WHERE prospectId=?`;

export type EngineCallSource = {
  entityId: string; name: string; phone: string | null; websiteUrl: string | null;
  city: string; niche: string; label: string; reasons: string; lastSeenAt: string;
  lastOutcome: string | null; lastActivityAt: string | null; followUpAt: string | null;
  stopped: number; attempts: number; activityRevision: number;
};

export async function readEngineCallSource(db: CallerDb, entityId: string, now = Date.now()) {
  const row = await db.prepare(SOURCE_SNAPSHOT_SQL).bind(entityId).first<{ snapshot: string }>();
  if (!row) throw new CallerError('NOT_FOUND', 404);
  const source = JSON.parse(row.snapshot) as EngineCallSource;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(row.snapshot));
  const revision = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const closed = ['NOT_INTERESTED', 'WON', 'WRONG_NUMBER', 'DO_NOT_CONTACT', 'MEETING_BOOKED'];
  const callable = !source.stopped && Boolean(source.phone?.trim()) && ['STRONG', 'NO_WEBSITE'].includes(source.label)
    && !closed.includes(source.lastOutcome ?? '')
    && (!source.followUpAt || source.followUpAt <= torontoToday(new Date(now)))
    && (!source.lastActivityAt || source.lastActivityAt < torontoMidnight(new Date(now)));
  return { source, revision, snapshot: row.snapshot, callable };
}
