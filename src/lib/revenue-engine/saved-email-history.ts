import { z } from "zod";
import type { D1DatabaseLike } from "../cloudflare";
import { policyPlaceholders, readOperatorOwnerPolicy } from "../operator-owner-policy";
import { createManualReplyHistory } from "./manual-reply-history";
import type { ManualReplyActor } from "./manual-reply";

const id = z.string().regex(/^[\x21-\x7e]{1,256}(?![\s\S])/);
const scopeSchema = z.object({ userId: id, sessionId: id, leadId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const candidateSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/),
  createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
const PAGE_SIZE = 5;
export type SavedEmailRecord = Readonly<{
  intentId: string; mailboxId: string; state: "SENT" | "UNKNOWN" | "DISPATCHING" | "REJECTED";
  from: string; to: string; subject: string; bodyPlain: string; recordedAt: number;
}>;
export type SavedEmailHistoryPage = Readonly<{
  source: "SAVED_OUTBOUND_ONLY"; records: readonly SavedEmailRecord[]; nextCursor: string | null;
}>;

/** Cursors only select a position in this owner's client history. They never grant
 * authority. Immutable createdAt + id ordering avoids mutable-outcome pagination. */
export function parseSavedHistoryCursor(cursor: string | null) {
  if (cursor === null) return null;
  const match = /^(0|[1-9][0-9]{0,15})\.([a-f0-9]{64})(?![\s\S])/.exec(cursor);
  if (!match) throw new Error("INVALID_HISTORY_CURSOR");
  return candidateSchema.parse({ createdAt: Number(match[1]), id: match[2] });
}

/** Local SELECT-only activity, not inbox sync or legacy message import. Plain text
 * only; five bounded envelopes per page. No credentials, transport or send runtime. */
export function createSavedEmailHistoryReader(database: Pick<D1DatabaseLike, "prepare">) {
  const history = createManualReplyHistory(database);
  return async (actor: ManualReplyActor, leadId: number, cursor: string | null): Promise<SavedEmailHistoryPage | null> => {
    const scope = scopeSchema.parse({ userId: actor.userId, sessionId: actor.sessionId, leadId });
    const after = parseSavedHistoryCursor(cursor);
    const policy = readOperatorOwnerPolicy();
    const admitted = () => database.prepare(`SELECT lead."id" FROM "Lead" lead WHERE lead."id"=? AND EXISTS (
      SELECT 1 FROM "Session" s JOIN "User" u ON u."id"=s."userId"
      WHERE s."id"=? AND s."userId"=? AND s."impersonatedBy" IS NULL
      AND julianday(s."createdAt")<=julianday('now') AND julianday(s."expiresAt")>julianday('now')
      AND u."role"='admin' AND u."emailVerified"=1 AND COALESCE(u."banned",0)=0
      AND lower(u."email") IN (${policyPlaceholders(policy.adminEmails)}))`)
      .bind(scope.leadId, scope.sessionId, scope.userId, ...policy.adminEmails).first();
    if (!await admitted()) return null;
    const result = await database.prepare(`SELECT i."id", i."createdAt" FROM "OutboundSendIntent" i
      JOIN "OutboundEnvelopeApproval" a ON a."intentId"=i."id"
      WHERE i."ownerId"=? AND i."mode"='MANUAL_REPLY' AND json_extract(a."envelopeJson",'$.leadId')=?
      ${after ? 'AND (i."createdAt"<? OR (i."createdAt"=? AND i."id"<?))' : ""}
      ORDER BY i."createdAt" DESC, i."id" DESC LIMIT ${PAGE_SIZE + 1}`)
      .bind(scope.userId, scope.leadId, ...(after ? [after.createdAt, after.createdAt, after.id] : [])).all();
    // Missing/invalid results are not an empty inbox. Every returned record is
    // revalidated against current owner/session/client and its exact saved digest.
    const candidates = z.array(candidateSchema).max(PAGE_SIZE + 1).parse(result.results);
    const records: SavedEmailRecord[] = [];
    for (const candidate of candidates.slice(0, PAGE_SIZE)) {
      const receipt = await history.readReceipt(candidate.id, scope, scope.leadId);
      if (!receipt || receipt.row.createdAt !== candidate.createdAt) throw new Error("SAVED_HISTORY_UNAVAILABLE");
      records.push(Object.freeze({ intentId: receipt.intent.id, mailboxId: receipt.intent.mailboxId,
        state: receipt.row.state, from: receipt.envelope.from, to: receipt.envelope.to,
        subject: receipt.envelope.subject, bodyPlain: receipt.envelope.bodyPlain, recordedAt: receipt.row.updatedAt }));
    }
    if (JSON.stringify(readOperatorOwnerPolicy()) !== JSON.stringify(policy) || !await admitted()) {
      throw new Error("SAVED_HISTORY_UNAVAILABLE");
    }
    const last = candidates[PAGE_SIZE - 1];
    return Object.freeze({ source: "SAVED_OUTBOUND_ONLY" as const, records: Object.freeze(records),
      nextCursor: candidates.length > PAGE_SIZE ? `${last.createdAt}.${last.id}` : null });
  };
}

/** Called only after actual route authentication. Invalid inputs cannot open DB. */
export async function handleSavedEmailHistory(request: Request, leadPath: string, actor: ManualReplyActor,
  database: () => Pick<D1DatabaseLike, "prepare">): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
  const failure = (status: number, error: string) => Response.json({ error }, { status, headers });
  if (!/^[1-9][0-9]*(?![\s\S])/.test(leadPath) || !Number.isSafeInteger(Number(leadPath))) return failure(400, "Invalid client id");
  let cursor: string | null;
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== "cursor") || params.getAll("cursor").length > 1) throw new Error("Invalid query");
    cursor = params.get("cursor");
    parseSavedHistoryCursor(cursor);
  } catch { return failure(400, "Invalid history page"); }
  try {
    const page = await createSavedEmailHistoryReader(database())(actor, Number(leadPath), cursor);
    return page ? Response.json(page, { headers }) : failure(404, "Saved history unavailable for this client and owner");
  } catch { return failure(503, "Saved email history is unavailable. No mailbox was contacted. Try reading it again later."); }
}
