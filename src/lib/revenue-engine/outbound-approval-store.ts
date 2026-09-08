import { z } from "zod";
import type { D1DatabaseLike } from "../cloudflare";
import { policyPlaceholders, readOperatorOwnerPolicy } from "../operator-owner-policy";
import { outboundEnvelopeDigest, parseOutboundEnvelope } from "./outbound-envelope";
import { parseOutboundSendIntent, type OutboundSendIntent } from "./outbound-send-intent-store";
import { manualReplyIdentitySql } from "./manual-reply-identity";

const identity = z.string().regex(/^[\x21-\x7e]{1,256}(?![\s\S])/);
const actorSchema = z.object({ actorUserId: identity, actorSessionId: identity }).strict();
const expirySchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const approvalRowSchema = z.object({ intentJson: z.string().max(8192), envelopeJson: z.string().max(600000),
  approvedByUserId: identity,
  expiresAt: expirySchema, approvedAt: z.number().int().nonnegative(), now: z.number().int().nonnegative(),
});

function actorGuard(adminEmails: readonly string[]) {
  return `EXISTS (SELECT 1 FROM "Session" s JOIN "User" u ON u."id" = s."userId"
    WHERE s."id" = ? AND u."id" = ? AND u."role" = 'admin' AND u."emailVerified" = 1
      AND COALESCE(u."banned",0) = 0 AND lower(u."email") IN (${policyPlaceholders(adminEmails)})
      AND s."impersonatedBy" IS NULL AND julianday(s."createdAt") <= julianday('now')
      AND julianday(s."expiresAt") > julianday('now'))`;
}

/** Persisted approval is one gate, never consent or permission to send by itself.
 * Actor IDs must come from the authenticated server session, not request JSON.
 * SQL rechecks that actor inside each mutation. No route/binding or provider
 * integration exists yet; MFA and the full dispatch policy remain release gates. */
export function createOutboundApprovalStore(database: Pick<D1DatabaseLike, "prepare">) {
  const loadEnvelope = async (input: Readonly<OutboundSendIntent>) => {
    const intent = parseOutboundSendIntent(input);
    const policy = readOperatorOwnerPolicy();
    const read = () => database.prepare(`SELECT a."intentJson", a."envelopeJson", a."approvedByUserId", a."approvedAt", a."expiresAt", unixepoch() AS "now"
      FROM "OutboundEnvelopeApproval" a JOIN "User" reviewer ON reviewer."id" = a."approvedByUserId"
      JOIN "User" owner ON owner."id" = ?
      JOIN "Lead" lead ON lead."id"=json_extract(a."envelopeJson", '$.leadId') AND lead."isArchived"=0
      WHERE a."intentId" = ? AND a."revokedAt" IS NULL AND a."expiresAt" > unixepoch()
        AND reviewer."role" = 'admin' AND reviewer."emailVerified" = 1 AND COALESCE(reviewer."banned",0) = 0
        AND lower(reviewer."email") IN (${policyPlaceholders(policy.adminEmails)})
        AND owner."emailVerified" = 1 AND COALESCE(owner."banned",0) = 0
        AND lower(owner."email") IN (${policyPlaceholders(policy.allowedEmails)})
        AND ${manualReplyIdentitySql('a."envelopeJson"')}`)
      .bind(intent.ownerId, intent.id, ...policy.adminEmails, ...policy.allowedEmails).first();
    const raw = await read();
    const row = approvalRowSchema.safeParse(raw);
    if (!row.success || row.data.approvedAt > row.data.now || row.data.expiresAt <= row.data.approvedAt) {
      throw new Error("OUTBOUND_APPROVAL_UNAVAILABLE");
    }
    try {
      const storedIntent = parseOutboundSendIntent(JSON.parse(row.data.intentJson));
      const envelope = parseOutboundEnvelope(JSON.parse(row.data.envelopeJson));
      if (JSON.stringify(storedIntent) !== JSON.stringify(intent)
        || envelope.ownerId !== intent.ownerId || envelope.mailboxId !== intent.mailboxId
        || envelope.mode !== intent.mode || envelope.rfcMessageId !== intent.rfcMessageId
        || await outboundEnvelopeDigest(envelope) !== intent.payloadDigest) {
        throw new Error("Mismatch");
      }
      // Digesting is asynchronous. A revocation, expiry, role change or policy
      // edit during that interval must not be hidden by the first snapshot.
      if (JSON.stringify(readOperatorOwnerPolicy()) !== JSON.stringify(policy)) throw new Error("Policy changed");
      const current = approvalRowSchema.safeParse(await read());
      if (!current.success || current.data.now < row.data.now
        || Object.keys(row.data).some((key) => key !== "now"
          && current.data[key as keyof typeof current.data] !== row.data[key as keyof typeof row.data])) {
        throw new Error("Approval changed");
      }
      return envelope;
    } catch { throw new Error("OUTBOUND_APPROVAL_CONTENT_CONFLICT"); }
  };

  return {
    loadEnvelope,
    /** Reference-only current approval read; NOT dispatch permission. The route
     * must bind actor and lead, then atomically authorize the send claim. */
    async loadApprovedReply(intentId: string) {
      if (!/^[a-f0-9]{64}(?![\s\S])/.test(intentId)) throw new Error("OUTBOUND_APPROVAL_INPUT_INVALID");
      const row = await database.prepare(`SELECT "intentJson" FROM "OutboundEnvelopeApproval" WHERE "intentId"=?`)
        .bind(intentId).first<{ intentJson: string }>();
      try {
        if (!row || typeof row.intentJson !== "string" || row.intentJson.length > 8192) throw new Error("Missing");
        const intent = parseOutboundSendIntent(JSON.parse(row.intentJson));
        if (intent.id !== intentId || intent.mode !== "MANUAL_REPLY") throw new Error("Mismatch");
        const envelope = await loadEnvelope(intent);
        return Object.freeze({ intent, envelope });
      } catch { throw new Error("OUTBOUND_APPROVAL_UNAVAILABLE"); }
    },
    async approve(input: { intent: OutboundSendIntent; envelope: unknown; expiresAt: number;
      actor: { actorUserId: string; actorSessionId: string } }) {
      const intent = parseOutboundSendIntent(input.intent);
      const envelope = parseOutboundEnvelope(input.envelope);
      const actor = actorSchema.safeParse(input.actor);
      const expiry = expirySchema.safeParse(input.expiresAt);
      if (!actor.success || !expiry.success) throw new Error("OUTBOUND_APPROVAL_INPUT_INVALID");
      if (envelope.ownerId !== intent.ownerId || envelope.mailboxId !== intent.mailboxId
        || envelope.mode !== intent.mode || envelope.rfcMessageId !== intent.rfcMessageId
        || await outboundEnvelopeDigest(envelope) !== intent.payloadDigest) throw new Error("OUTBOUND_APPROVAL_CONTENT_CONFLICT");
      const policy = readOperatorOwnerPolicy();
      const guard = actorGuard(policy.adminEmails);
      const actorArgs = [actor.data.actorSessionId, actor.data.actorUserId, ...policy.adminEmails];
      const intentJson = JSON.stringify(intent), envelopeJson = JSON.stringify(envelope);
      const inserted = await database.prepare(`INSERT INTO "OutboundEnvelopeApproval"
        ("intentId","intentJson","envelopeJson","approvedByUserId","expiresAt")
        SELECT ?,?,?,?,? WHERE ? > unixepoch() AND ${guard}
          AND EXISTS (SELECT 1 FROM "Lead" WHERE "id"=? AND "isArchived"=0)
          AND EXISTS (SELECT 1 FROM "User" owner WHERE owner."id"=? AND owner."emailVerified"=1
              AND COALESCE(owner."banned",0)=0 AND lower(owner."email") IN (${policyPlaceholders(policy.allowedEmails)}))
          AND ${manualReplyIdentitySql("?")}
          AND NOT EXISTS (SELECT 1 FROM "OutboundEnvelopeApproval" WHERE "intentId"=?)
        RETURNING "intentId"`).bind(intent.id, intentJson, envelopeJson, actor.data.actorUserId,
        expiry.data, expiry.data, ...actorArgs, envelope.leadId, envelope.ownerId,
        ...policy.allowedEmails, envelopeJson, intent.id).first<{ intentId: string }>();
      if (inserted !== null && inserted?.intentId !== intent.id) throw new Error("OUTBOUND_APPROVAL_WRITE_UNCERTAIN");
      if (!inserted) {
        // Repeat approval is read-only, but still requires the CURRENT actor and
        // exact original content/expiry. No renewal, replacement or un-revocation.
        const existing = await database.prepare(`SELECT "intentId" FROM "OutboundEnvelopeApproval"
          WHERE "intentId"=? AND "intentJson"=? AND "envelopeJson"=? AND "expiresAt"=?
            AND "revokedAt" IS NULL AND "expiresAt">unixepoch() AND ${guard}
            AND ${manualReplyIdentitySql("?")}`)
          .bind(intent.id, intentJson, envelopeJson, expiry.data, ...actorArgs, envelopeJson).first<{ intentId: string }>();
        if (existing?.intentId !== intent.id) throw new Error("OUTBOUND_APPROVAL_DENIED_OR_CONFLICT");
      }
      return loadEnvelope(intent);
    },
    async revoke(intentId: string, inputActor: { actorUserId: string; actorSessionId: string }) {
      if (!/^[a-f0-9]{64}(?![\s\S])/.test(intentId)) throw new Error("OUTBOUND_APPROVAL_INPUT_INVALID");
      const actor = actorSchema.safeParse(inputActor);
      if (!actor.success) throw new Error("OUTBOUND_APPROVAL_INPUT_INVALID");
      const policy = readOperatorOwnerPolicy();
      const args = [intentId, actor.data.actorSessionId, actor.data.actorUserId, ...policy.adminEmails];
      const updated = await database.prepare(`UPDATE "OutboundEnvelopeApproval" SET "revokedAt"=unixepoch()
        WHERE "intentId"=? AND "revokedAt" IS NULL AND ${actorGuard(policy.adminEmails)} RETURNING "intentId"`)
        .bind(...args).first<{ intentId: string }>();
      if (updated?.intentId === intentId) return;
      const replay = await database.prepare(`SELECT "intentId" FROM "OutboundEnvelopeApproval"
        WHERE "intentId"=? AND "revokedAt" IS NOT NULL AND ${actorGuard(policy.adminEmails)}`)
        .bind(...args).first<{ intentId: string }>();
      if (replay?.intentId !== intentId) throw new Error("OUTBOUND_APPROVAL_DENIED_OR_CONFLICT");
    },
  };
}
