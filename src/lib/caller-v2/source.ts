import type { CallerActor } from '../revenue-engine/caller-integration';
import { nextInQueue } from '../revenue-engine/engine-prospects-d1';
import { torontoToday, torontoMidnight } from '../prospect-format';
import type { CallerDb } from './database';
import { assertEngineSource, CallerError, ENGINE_CONNECTION, ENGINE_WORKSPACE, engineContactId } from './identity';
import { sourceRefSchema, type SourceRef } from './protocol';
import { readEngineCallSource } from './source-state';

const sourceRef = (entityId: string): SourceRef => ({ system: 'revenue-engine', workspaceId: ENGINE_WORKSPACE, connectionId: ENGINE_CONNECTION, entityType: 'prospect', entityId });
async function taskFor(db: CallerDb, entityId: string, now: number) {
  const state = await readEngineCallSource(db, entityId, now);
  return { ...state, task: {
    source: sourceRef(entityId), purpose: state.source.followUpAt ? 'prospect_follow_up' as const : 'acquisition' as const,
    title: state.source.name.slice(0, 500), contactId: await engineContactId(entityId), revision: state.revision,
    priorityReason: state.source.followUpAt ? `Follow-up due ${state.source.followUpAt}.` : 'Existing Engine queue order: stored website findings and fewest attempts.',
  } };
}

export async function listEngineCallTasks(db: CallerDb, cursor: string | null, limit = 10, now = Date.now()) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25 || (cursor !== null && !/^page-(0|[1-9]\d{0,4})$/.test(cursor))) throw new CallerError('INVALID_REQUEST', 400);
  const offset = cursor === null ? 0 : Number(cursor.slice(5));
  const queue = await nextInQueue(db, torontoToday(new Date(now)), torontoMidnight(new Date(now)), [], limit, offset);
  const candidates = await Promise.all(queue.rows.map(row => taskFor(db, row.prospectId, now)));
  return { tasks: candidates.filter(item => item.callable).map(item => item.task), cursor: offset + queue.rows.length < queue.remaining ? `page-${offset + queue.rows.length}` : null };
}

export async function prepareEngineCall(db: CallerDb, actor: CallerActor, input: SourceRef, now = Date.now()) {
  const ref = sourceRefSchema.parse(input); assertEngineSource(ref);
  const { task, source, callable } = await taskFor(db, ref.entityId, now);
  const control = await db.prepare('SELECT stopped,phase FROM CallerContactControl WHERE workspaceId=? AND contactKey=?').bind(ENGINE_WORKSPACE, task.contactId).first<{ stopped: number; phase: string }>();
  if (!callable || control?.stopped) throw new CallerError('STOPPED');
  if (control?.phase === 'uncertain') throw new CallerError('CLAIM_UNCERTAIN');
  let facts: string[] = [];
  try { const values: unknown = JSON.parse(source.reasons); if (Array.isArray(values)) facts = values.filter((item): item is string => typeof item === 'string').slice(0, 30).map(item => item.slice(0, 2000)); } catch { /* Missing evidence stays visibly missing. */ }
  let url: string | null = null;
  try { const parsed = new URL(source.websiteUrl ?? ''); if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href; } catch { /* Unknown website is not proof of absence. */ }
  if (!Number.isFinite(Date.parse(source.lastSeenAt))) throw new CallerError('REVISION_CONFLICT');
  const capturedAt = new Date(source.lastSeenAt).toISOString();
  return {
    task, contact: { id: task.contactId, name: null, phone: source.phone!, confirmedAt: capturedAt },
    brief: {
      goal: 'Ask who handles the website and whether a short follow-up would be useful. Do not promise results.',
      opening: `Hi, this is ${actor.actor === 'AIDAN' ? 'Aidan' : 'Riley'} from Axiom Web. Who looks after the website for ${source.name.slice(0, 500)}?`,
      facts,
      limitations: [`Stored source last observed ${capturedAt}; no live research was performed.`, 'The listed business phone has not been verified by a call.', ...(url ? [] : ['No verified website URL is stored. This does not establish that the business has no website.']), ...(facts.length ? [] : ['No stored website findings are available.'])],
    },
    evidence: url ? facts.map((observation, index) => ({ id: `finding-${index}`, url, capturedAt, observation })) : [],
    evidenceRevision: task.revision, allowedDecisionIds: [], coordinator: { kind: 'engine' as const, linkedContactId: null },
  };
}
