import { z } from 'zod';
import type { CallerActor } from '../revenue-engine/caller-integration';
import type { CallerDb } from './database';
import { CallerError, ENGINE_WORKSPACE } from './identity';
import { readEngineCallSource } from './source-state';

/**
 * A phone fix and/or note sent from Caller before a call. Saved append-only with the
 * number it replaced; the prospect's phone is the only engine field it changes.
 * Notes never touch the call log, so the call queue (fresh/retry/review) is unaffected.
 */
const phoneSchema = z.string().trim().min(7).max(40)
  .regex(/^[0-9+().\-\s]+(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i)
  .refine((value) => (value.match(/\d/g) ?? []).length >= 7);
export const contactEditSchema = z.object({
  editId: z.uuid(),
  source: z.unknown(),
  phone: phoneSchema.nullable(),
  note: z.string().trim().min(1).max(1000).nullable(),
  occurredAt: z.iso.datetime().optional(),
}).strict().refine((edit) => edit.phone !== null || edit.note !== null, { message: 'phone or note required' });
export type ContactEditCommand = z.infer<typeof contactEditSchema>;

export type ContactEditReceipt = {
  status: 'saved' | 'duplicate'; editId: string; entityId: string;
  phone: string | null; previousPhone: string | null; phoneChanged: boolean; note: string | null;
  sourceRevision: string; savedAt: string;
};

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type EditRow = { editId: string; prospectId: string; actorUserId: string; previousPhone: string | null; newPhone: string | null; note: string | null; payloadHash: string; createdAt: string };

export async function recordContactEdit(db: CallerDb, actor: CallerActor, entityId: string, command: Omit<ContactEditCommand, 'source'>, now = new Date()): Promise<ContactEditReceipt> {
  const phone = command.phone ?? null, note = command.note ?? null;
  const payloadHash = await sha256(JSON.stringify([entityId, phone, note]));
  const receipt = async (row: EditRow, status: ContactEditReceipt['status']): Promise<ContactEditReceipt> => {
    const current = await readEngineCallSource(db, row.prospectId);
    return { status, editId: row.editId, entityId: row.prospectId, phone: current.source.phone, previousPhone: row.previousPhone,
      phoneChanged: row.newPhone !== null, note: row.note, sourceRevision: current.revision, savedAt: row.createdAt };
  };
  const existingEdit = () => db.prepare('SELECT editId,prospectId,actorUserId,previousPhone,newPhone,note,payloadHash,createdAt FROM CallerContactEdit WHERE editId=?').bind(command.editId).first<EditRow>();
  const replay = async (row: EditRow) => {
    // The same edit sent twice is acknowledged; a different edit reusing the ID is refused.
    if (row.payloadHash !== payloadHash || row.actorUserId !== actor.actorUserId) throw new CallerError('EDIT_CONFLICT', 409);
    return receipt(row, 'duplicate');
  };

  const earlier = await existingEdit();
  if (earlier) return replay(earlier);
  const prospect = await db.prepare('SELECT phone FROM EngineProspect WHERE prospectId=?').bind(entityId).first<{ phone: string | null }>();
  if (!prospect) throw new CallerError('NOT_FOUND', 404);
  const newPhone = phone !== null && phone !== prospect.phone ? phone : null;
  if (newPhone === null && note === null) throw new CallerError('NO_CHANGE', 422);

  const createdAt = now.toISOString();
  const insert = db.prepare(`INSERT INTO CallerContactEdit (editId,workspaceId,prospectId,actor,actorUserId,previousPhone,newPhone,note,payloadHash,occurredAt,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(command.editId, ENGINE_WORKSPACE, entityId, actor.actor, actor.actorUserId, prospect.phone, newPhone, note, payloadHash, command.occurredAt ?? createdAt, createdAt);
  // Only replace the number that was read, so two edits can't silently overwrite each other.
  const statements = newPhone === null ? [insert] : [insert, db.prepare('UPDATE EngineProspect SET phone=? WHERE prospectId=? AND phone IS ?').bind(newPhone, entityId, prospect.phone)];
  try { await db.batch(statements); }
  catch (error) {
    const raced = await existingEdit();
    if (raced) return replay(raced);
    throw error;
  }
  const saved = await existingEdit();
  if (!saved) throw new CallerError('TEMPORARY_FAILURE', 503);
  return receipt(saved, 'saved');
}

export type ContactEditView = { prospectId: string; previousPhone: string | null; newPhone: string | null; note: string | null; actor: string; createdAt: string };

/** Latest Caller edits per prospect, newest first (for the call list). */
export async function listContactEditsFor(db: { prepare: CallerDb['prepare'] }, prospectIds: readonly string[]): Promise<Map<string, ContactEditView[]>> {
  const map = new Map<string, ContactEditView[]>();
  for (let i = 0; i < prospectIds.length; i += 90) {
    const chunk = prospectIds.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await db.prepare(`SELECT prospectId,previousPhone,newPhone,note,actor,createdAt FROM CallerContactEdit WHERE prospectId IN (${chunk.map(() => '?').join(',')}) ORDER BY createdAt DESC, rowid DESC`)
      .bind(...chunk).all<ContactEditView>();
    for (const item of results) {
      const list = map.get(item.prospectId) ?? [];
      if (list.length < 10) list.push(item);
      map.set(item.prospectId, list);
    }
  }
  return map;
}
