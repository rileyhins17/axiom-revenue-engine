import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import type { CallerDb, CallerStatement } from './database';
import { ENGINE_CONNECTION, ENGINE_WORKSPACE, engineContactId } from './identity';
import { parseResultEvent, type ResultEvent } from './protocol';

export const AIDAN = { actor: 'AIDAN' as const, actorUserId: 'user-aidan' };
export function openCallerTestDb() {
  const raw = new Database(':memory:'); raw.pragma('foreign_keys = ON');
  for (const name of ['0001_cloudflare_auth_security.sql', '0075_engine_prospects_and_call_log.sql', '0078_caller_tokens.sql', '0079_connected_caller.sql']) raw.exec(readFileSync(new URL('../../../migrations/' + name, import.meta.url), 'utf8'));
  raw.prepare('INSERT INTO User(id,name,email,emailVerified,updatedAt) VALUES(?,?,?,1,?)').run(AIDAN.actorUserId, 'Fixture owner', 'aidan@getaxiom.ca', '2026-09-25T00:00:00.000Z');
  raw.prepare(`INSERT INTO EngineProspect VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('fixture.example', 'fixture-place', 'Synthetic roofing fixture', 'KITCHENER', 'ROOFING', 'https://fixture.example', '+15195550101', null, 'STRONG', '["Stored fixture observation"]', 'fixture-run', '2026-09-24', '2026-09-24');
  const pending = new WeakMap<CallerStatement, { sql: string; values: unknown[] }>();
  const db: CallerDb = {
    prepare(sql) {
      const make = (values: unknown[]): CallerStatement => {
        const statement: CallerStatement = { bind: (...next) => make(next), all: async <T>() => ({ results: raw.prepare(sql).all(...values) as T[] }), first: async <T>() => (raw.prepare(sql).get(...values) as T | undefined) ?? null, run: async () => raw.prepare(sql).run(...values) };
        pending.set(statement, { sql, values }); return statement;
      };
      return make([]);
    },
    async batch(statements) {
      return raw.transaction(() => statements.map(statement => { const query = pending.get(statement); if (!query) throw new Error('Foreign statement'); return raw.prepare(query.sql).run(...query.values); }))();
    },
  };
  return { raw, db, close: () => raw.close() };
}
export async function engineResultFixture(db: CallerDb, changes: Partial<ResultEvent> = {}): Promise<ResultEvent> {
  const shared = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
  const result = parseResultEvent({ ...shared, eventId: crypto.randomUUID(), attemptId: crypto.randomUUID(), source: { system: 'revenue-engine', workspaceId: ENGINE_WORKSPACE, connectionId: ENGINE_CONNECTION, entityType: 'prospect', entityId: 'fixture.example' }, contactId: await engineContactId('fixture.example'), ...changes });
  await db.prepare(`INSERT OR IGNORE INTO CallerAttempt(workspaceId,attemptId,contactKey,sourceEntityId,sourceRevision,ownerId,phase,createdAt) VALUES(?,?,?,?,?,?,'active',?)`).bind(ENGINE_WORKSPACE, result.attemptId, result.contactId, result.source.entityId, result.sourceRevision, AIDAN.actorUserId, result.occurredAt).run();
  return result;
}
