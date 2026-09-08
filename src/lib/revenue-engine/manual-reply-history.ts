import { z } from "zod";
import type { D1DatabaseLike } from "../cloudflare";
import { policyPlaceholders, readOperatorOwnerPolicy } from "../operator-owner-policy";
import { outboundEnvelopeDigest, parseOutboundEnvelope } from "./outbound-envelope";
import { parseOutboundSendIntent, parseOutboundSendIntentRow } from "./outbound-send-intent-store";
import type { ManualReplyActor } from "./manual-reply";

const identity = z.string().regex(/^[\x21-\x7e]{1,256}(?![\s\S])/);
const scopeSchema = z.object({ intentId: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/),
  userId: identity, sessionId: identity, leadId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const storedSchema = z.object({ intentJson: z.string().max(8192), envelopeJson: z.string().max(600000),
  rowJson: z.string().max(16384), now: z.number().int().nonnegative() }).strict();
// Explicit public columns: the internal attempt token is never even selected.
const fields = ["id", "ownerId", "mailboxId", "operationKey", "payloadDigest", "mode", "rfcMessageId",
  "budgetMonth", "reservedCostCents", "state", "providerMessageId", "providerThreadId", "createdAt", "updatedAt"] as const;

/** SELECT-only historical visibility, NOT send admission or provider reconciliation.
 * Revocation/retirement/expiry cannot erase a past outcome; current authenticated
 * owner/session/client scope still applies on every read. No credentials or writes.
 * Privileged DB maintenance and trusted ingestion remain outside this reader. */
export function createManualReplyHistory(database: Pick<D1DatabaseLike, "prepare">) {
  async function readReceipt(intentId: string, actor: ManualReplyActor, leadId: number) {
    const scope = scopeSchema.parse({ intentId, userId: actor.userId, sessionId: actor.sessionId, leadId });
    const policy = readOperatorOwnerPolicy();
    const read = () => database.prepare(`SELECT a."intentJson", a."envelopeJson",
      json_object(${fields.map(field => `'${field}',i."${field}"`).join(",")}) AS "rowJson", unixepoch() AS "now"
      FROM "OutboundSendIntent" i JOIN "OutboundEnvelopeApproval" a ON a."intentId"=i."id"
      JOIN "Session" s ON s."userId"=i."ownerId" JOIN "User" actor ON actor."id"=s."userId"
      JOIN "Lead" lead ON lead."id"=json_extract(a."envelopeJson",'$.leadId')
      WHERE i."id"=? AND i."ownerId"=? AND i."mode"='MANUAL_REPLY' AND lead."id"=?
        AND s."id"=? AND s."impersonatedBy" IS NULL
        AND julianday(s."createdAt")<=julianday('now') AND julianday(s."expiresAt")>julianday('now')
        AND actor."role"='admin' AND actor."emailVerified"=1 AND COALESCE(actor."banned",0)=0
        AND lower(actor."email") IN (${policyPlaceholders(policy.adminEmails)})`)
      .bind(scope.intentId, scope.userId, scope.leadId, scope.sessionId, ...policy.adminEmails).first();
    const raw = await read();
    if (raw === null) return null;
    try {
      const stored = storedSchema.parse(raw);
      const intent = parseOutboundSendIntent(JSON.parse(stored.intentJson));
      const envelope = parseOutboundEnvelope(JSON.parse(stored.envelopeJson));
      if (intent.id !== scope.intentId || intent.ownerId !== scope.userId || intent.mode !== "MANUAL_REPLY"
        || envelope.version !== "outbound-envelope-v2" || envelope.ownerId !== intent.ownerId
        || envelope.leadId !== scope.leadId || envelope.mailboxId !== intent.mailboxId
        || envelope.rfcMessageId !== intent.rfcMessageId
        || await outboundEnvelopeDigest(envelope) !== intent.payloadDigest) throw new Error("Mismatch");
      // Hashing is asynchronous. Recheck admission and immutable content; read the
      // latest forward-only outcome (UNKNOWN may legitimately have become SENT).
      if (JSON.stringify(readOperatorOwnerPolicy()) !== JSON.stringify(policy)) throw new Error("Policy changed");
      const current = storedSchema.parse(await read());
      if (current.intentJson !== stored.intentJson || current.envelopeJson !== stored.envelopeJson
        || current.now < stored.now) throw new Error("Changed");
      const row = parseOutboundSendIntentRow(JSON.parse(current.rowJson));
      if ((Object.keys(intent) as Array<keyof typeof intent>).some(key => row[key] !== intent[key])
        || row.createdAt > current.now || row.updatedAt > current.now
        || (row.state === "SENT" && row.providerThreadId !== envelope.threadId)) throw new Error("Mismatch");
      return Object.freeze({ intent, envelope, row });
    } catch { throw new Error("MANUAL_REPLY_HISTORY_UNAVAILABLE"); }
  }
  return Object.freeze({
    readReceipt,
    /** Deterministic owner-history projection from durable acceptance. Nothing is
     * appended to a second log. recordedAt is local observation, not delivery time. */
    async readAccepted(intentId: string, actor: ManualReplyActor, leadId: number) {
      const receipt = await readReceipt(intentId, actor, leadId);
      if (!receipt || receipt.row.state !== "SENT") throw new Error("MANUAL_REPLY_HISTORY_UNAVAILABLE");
      return Object.freeze({ id: receipt.intent.id, leadId, mailboxId: receipt.envelope.mailboxId,
        replyTargetId: receipt.envelope.replyTargetId, messageId: receipt.row.providerMessageId!,
        threadId: receipt.row.providerThreadId!, recordedAt: receipt.row.updatedAt,
        from: receipt.envelope.from, to: receipt.envelope.to, subject: receipt.envelope.subject,
        bodyPlain: receipt.envelope.bodyPlain, bodyHtml: receipt.envelope.bodyHtml,
        rfcMessageId: receipt.envelope.rfcMessageId, status: "ACCEPTED" as const });
    },
  });
}
