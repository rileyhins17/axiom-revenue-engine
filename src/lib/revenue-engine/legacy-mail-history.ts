import { z } from "zod";
import type { D1DatabaseLike } from "../cloudflare";
import { policyPlaceholders, readOperatorOwnerPolicy } from "../operator-owner-policy";
import type { ManualReplyActor } from "./manual-reply";

const id = z.string().min(1).max(256);
import { legacyEmailSchema, legacyTimeSchema as time } from "./legacy-mail-contract";
export type { LegacyEmail } from "./legacy-mail-contract";
const sequenceSchema = z.object({ id, status: z.string().max(64), currentStep: z.string().max(64),
  nextScheduledAt: time.nullable(), lastSentAt: time.nullable(), replyDetectedAt: time.nullable(),
  stopReason: z.literal("Legacy stop recorded").nullable(), createdAt: time }).strict();
const stepSchema = z.object({ id, stepType: z.string().max(64), status: z.string().max(64),
  scheduledFor: time.nullable(), sentAt: time.nullable() }).strict();
export type LegacySequence = z.infer<typeof sequenceSchema>;
export type LegacySequenceStep = z.infer<typeof stepSchema>;
export const legacyMailHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export function parseLegacyLeadId(value: string) {
  return /^[1-9][0-9]*(?![\s\S])/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

/** Historical display only. No credentials, provider calls, ORM schema repair or
 * send authority. Durable sender/queue owner IDs, never current mailbox addresses,
 * determine visibility. Raw HTML and provider errors never leave storage. */
export function createLegacyMailHistory(database: Pick<D1DatabaseLike, "prepare">) {
  return async (actor: ManualReplyActor, options: { leadId?: number; emailId?: string; bodies?: boolean; sequence?: boolean } = {}) => {
    const scope = z.object({ userId: id, sessionId: id }).strict().parse(actor);
    const input = z.object({ leadId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      emailId: id.optional(), bodies: z.boolean().optional(), sequence: z.boolean().optional() }).strict().parse(options);
    if (input.sequence && !input.leadId) throw new Error("LEGACY_HISTORY_INVALID_SCOPE");
    const policy = readOperatorOwnerPolicy();
    const admitted = () => database.prepare(`SELECT s.id FROM "Session" s JOIN "User" u ON u.id=s.userId
      WHERE s.id=? AND s.userId=? AND s.impersonatedBy IS NULL
      AND julianday(s.createdAt)<=julianday('now') AND julianday(s.expiresAt)>julianday('now')
      AND u.role='admin' AND u.emailVerified=1 AND COALESCE(u.banned,0)=0
      AND lower(u.email) IN (${policyPlaceholders(policy.adminEmails)})
      ${input.leadId ? 'AND EXISTS (SELECT 1 FROM "Lead" l WHERE l.id=? AND l.isArchived=0)' : ''}`)
      .bind(scope.sessionId, scope.userId, ...policy.adminEmails, ...(input.leadId ? [input.leadId] : [])).first();
    if (!await admitted()) return null;
    const limit = input.emailId ? 1 : input.leadId ? 50 : 200;
    const body = input.bodies ? "CASE WHEN length(CAST(e.bodyPlain AS BLOB))<=32768 THEN e.bodyPlain ELSE NULL END" : "NULL";
    const rows = await database.prepare(`SELECT 'LEGACY_OUTREACH_EMAIL' AS source, e.id,e.leadId,
      e.senderEmail,e.recipientEmail,e.subject,${body} AS bodyPlain,
      ${input.bodies ? "CASE WHEN length(CAST(e.bodyPlain AS BLOB))>32768 THEN 'TOO_LARGE' WHEN e.bodyPlain IS NULL OR trim(e.bodyPlain)='' THEN 'NO_PLAIN_TEXT' ELSE NULL END" : "'NOT_REQUESTED'"} AS bodyUnavailable,
      e.status,e.sentAt,CASE WHEN e.errorMessage IS NOT NULL THEN 1 ELSE 0 END AS failureRecorded,
      l.businessName,l.city FROM "OutreachEmail" e JOIN "Lead" l ON l.id=e.leadId
      WHERE e.senderUserId=? ${input.leadId ? 'AND e.leadId=?' : ''} ${input.emailId ? 'AND e.id=?' : ''}
      ORDER BY e.sentAt DESC,e.id DESC LIMIT ${limit + 1}`)
      .bind(scope.userId, ...(input.leadId ? [input.leadId] : []), ...(input.emailId ? [input.emailId] : [])).all();
    const emails = z.array(legacyEmailSchema.extend({ failureRecorded: z.union([z.literal(0),z.literal(1)]).transform(Boolean) }))
      .max(limit + 1).parse(rows.results);
    let sequence: LegacySequence | null = null;
    let sequenceSteps: LegacySequenceStep[] = [];
    if (input.sequence) {
      const row = await database.prepare(`SELECT id,status,currentStep,nextScheduledAt,lastSentAt,replyDetectedAt,
        CASE WHEN stopReason IS NOT NULL THEN 'Legacy stop recorded' ELSE NULL END AS stopReason,createdAt
        FROM "OutreachSequence" WHERE leadId=? AND queuedByUserId=? ORDER BY createdAt DESC,id DESC LIMIT 1`)
        .bind(input.leadId,scope.userId).first();
      sequence = row === null ? null : sequenceSchema.parse(row);
      if (sequence) {
        const steps = await database.prepare(`SELECT s.id,s.stepType,s.status,s.scheduledFor,s.sentAt
          FROM "OutreachSequenceStep" s JOIN "OutreachSequence" q ON q.id=s.sequenceId
          WHERE q.id=? AND q.leadId=? AND q.queuedByUserId=? ORDER BY s.stepNumber,s.id LIMIT 101`)
          .bind(sequence.id,input.leadId,scope.userId).all();
        // Invalid/oversized history is unavailable, never silently omitted.
        sequenceSteps = z.array(stepSchema).max(100).parse(steps.results);
      }
    }
    if (JSON.stringify(readOperatorOwnerPolicy()) !== JSON.stringify(policy) || !await admitted()) {
      throw new Error("LEGACY_HISTORY_UNAVAILABLE");
    }
    return { source: "LEGACY_OUTREACH_EMAIL" as const, emails: emails.slice(0,limit), hasMore: emails.length>limit,
      sequence, sequenceSteps };
  };
}
