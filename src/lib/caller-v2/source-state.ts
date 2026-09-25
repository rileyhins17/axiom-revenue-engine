import type { NextAction } from './protocol';
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
  'link',(SELECT json_object('id',linkId,'revision',revision,'state',state) FROM CallerSourceLink WHERE workspaceId='axiom' AND sourceEntityId=source.prospectId),
  'conversion',(SELECT json_object('id',conversionId,'status',status) FROM CallerConversionJob WHERE workspaceId='axiom' AND sourceEntityId=source.prospectId),
  'nextAction',json((SELECT a.nextActionJson FROM EngineProspectActivityCurrent a WHERE a.prospectId=source.prospectId ORDER BY a.effectiveAt DESC,a.activityRowId DESC LIMIT 1)),
  'activityRevision',(SELECT COALESCE(MAX(rowid),0) FROM EngineProspectActivity WHERE prospectId=source.prospectId)
) AS snapshot FROM (${PROSPECT_LATEST_SQL}) source WHERE prospectId=?`;

export type EngineCallSource = {
  entityId: string; name: string; phone: string | null; websiteUrl: string | null;
  city: string; niche: string; label: string; reasons: string; lastSeenAt: string;
  lastOutcome: string | null; lastActivityAt: string | null; followUpAt: string | null;
  nextAction:NextAction|null;stopped: number; attempts: number; activityRevision: number;
  conversion:{id:string;status:string}|null;
};

export async function readEngineCallSource(db: CallerDb, entityId: string, now = Date.now()) {
  const row = await db.prepare(SOURCE_SNAPSHOT_SQL).bind(entityId).first<{ snapshot: string }>();
  if (!row) throw new CallerError('NOT_FOUND', 404);
  const source = JSON.parse(row.snapshot) as EngineCallSource;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(row.snapshot));
  const revision = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const closed = ['NOT_INTERESTED', 'WON', 'WRONG_NUMBER', 'DO_NOT_CONTACT', 'MEETING_BOOKED'];
  const callable = !source.conversion && !source.stopped && Boolean(source.phone?.trim()) && ['STRONG', 'NO_WEBSITE'].includes(source.label)
    && !closed.includes(source.lastOutcome ?? '')
    && (source.nextAction?!futureCallback(source.nextAction,now):(!source.followUpAt || source.followUpAt <= torontoToday(new Date(now))))
    && (!source.lastActivityAt || source.lastActivityAt < torontoMidnight(new Date(now)));
  return { source, revision, snapshot: row.snapshot, callable };
}

function futureCallback(action:NextAction,now:number){
  if(action.precision==='unscheduled')return false;
  if(action.scheduledAt)return Date.parse(action.scheduledAt)>now;
  if(!action.localDate)return false;
  if(!action.timeZone)return true;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:action.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const part=(key:string)=>parts.find(p=>p.type===key)!.value;
  return action.localDate>`${part('year')}-${part('month')}-${part('day')}`;
}
