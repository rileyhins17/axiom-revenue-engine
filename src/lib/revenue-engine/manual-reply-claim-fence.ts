import { z } from "zod";
import type { D1DatabaseLike } from "../cloudflare";
import { normalizePipelineEmail } from "../lead-qualification";
import { normalizeSuppressionDomain } from "../suppression-normalization";
import { policyPlaceholders, readOperatorOwnerPolicy } from "../operator-owner-policy";
import { outboundEnvelopeDigest, parseOutboundEnvelope } from "./outbound-envelope";
import type { OutboundSendIntent } from "./outbound-send-intent-store";
import { manualReplyIdentitySql } from "./manual-reply-identity";

const actorSchema = z.object({
  userId: z.string().regex(/^[\x21-\x7e]{1,256}(?![\s\S])/),
  sessionId: z.string().regex(/^[\x21-\x7e]{1,256}(?![\s\S])/),
}).strict();
export type ManualReplyClaimContext = { actor: { userId: string; sessionId: string }; envelope: unknown };

/** Fixed SQL, consumed inside the intent INSERT, never a boolean preflight.
 * This covers account/approval/stop/suppression and recorded reply identity.
 * Trusted ingestion/health, consent, verification, capacity, current message
 * policy and cost provenance still MUST be added before runtime activation.
 * No credentials, provider choice, schema creation or live runtime here. */
export async function manualReplyClaimFence(database: Pick<D1DatabaseLike, "prepare">,
  intent: Readonly<OutboundSendIntent>, input: ManualReplyClaimContext) {
  const actor = actorSchema.parse(input.actor);
  const envelope = parseOutboundEnvelope(input.envelope);
  if (intent.mode !== "MANUAL_REPLY" || envelope.mode !== "MANUAL_REPLY"
    || actor.userId !== intent.ownerId || envelope.ownerId !== intent.ownerId
    || envelope.mailboxId !== intent.mailboxId || envelope.rfcMessageId !== intent.rfcMessageId
    || await outboundEnvelopeDigest(envelope) !== intent.payloadDigest) {
    throw new Error("OUTBOUND_MANUAL_CLAIM_CONTEXT_INVALID");
  }
  // Normalize legacy wrappers/encoded addresses with the EXISTING parser. D1
  // cannot execute that JS function inside SQL. Bind the exact raw inputs to
  // their normalized interpretation, then verify each CURRENT row against that
  // mapping IN the claim. New/changed rows have no matching mapping and deny.
  // This bounded compatibility read is not authority or a cached suppression bool.
  const raw = await database.prepare('SELECT "id","email","domain","source" FROM "OutreachSuppression" ORDER BY "id" LIMIT 1001')
    .all();
  const rows = z.array(z.object({ id: z.string().min(1).max(256), email: z.string().max(4096).nullable(),
    domain: z.string().max(4096).nullable(), source: z.string().max(256) }).strict()).max(1000).parse(raw.results);
  const mapping = JSON.stringify(rows.map(row => ({ ...row, normalizedEmail: normalizePipelineEmail(row.email),
    normalizedDomain: normalizeSuppressionDomain(row.domain), normalizedSource: row.source.trim().toUpperCase() })));
  if (new TextEncoder().encode(mapping).byteLength > 131072) throw new Error("OUTBOUND_SUPPRESSION_REVIEW_REQUIRED");
  // Sample configured admission after asynchronous work. Database authorization
  // is evaluated by the claim itself, not accepted from these earlier reads.
  const policy = readOperatorOwnerPolicy();
  // Legacy normalized source=REPLY means stop the automated sequence, not suppress an
  // owner's response. It is NOT consent and says nothing about opt-out content:
  // separately reviewed inbound classification/suppression is an activation gate.
  // Delivery-failure/explicit opt-out sources cannot expire themselves back into
  // send permission. Other legacy cooldowns may expire on a valid DB timestamp.
  const sql = `EXISTS (
    SELECT 1 FROM "Session" s JOIN "User" actor ON actor."id"=s."userId"
    JOIN "OutboundEnvelopeApproval" a ON a."intentId"=?
    JOIN "User" reviewer ON reviewer."id"=a."approvedByUserId"
    JOIN "Lead" lead ON lead."id"=? AND lead."isArchived"=0
    JOIN "OutreachAutomationSetting" settings ON settings."id"='global'
    WHERE s."id"=? AND s."userId"=? AND s."impersonatedBy" IS NULL
      AND julianday(s."createdAt") <= julianday('now')
      AND julianday(s."expiresAt") > julianday('now')
      AND actor."role"='admin' AND actor."emailVerified"=1 AND COALESCE(actor."banned",0)=0
      AND lower(actor."email") IN (${policyPlaceholders(policy.adminEmails)})
      AND reviewer."role"='admin' AND reviewer."emailVerified"=1 AND COALESCE(reviewer."banned",0)=0
      AND lower(reviewer."email") IN (${policyPlaceholders(policy.adminEmails)})
      AND a."intentJson"=? AND a."envelopeJson"=? AND a."revokedAt" IS NULL
      AND a."approvedAt" <= unixepoch() AND a."expiresAt" > unixepoch()
      AND a."expiresAt" > a."approvedAt"
      AND settings."globalPaused"=0 AND settings."emergencyPaused"=0
      AND ${manualReplyIdentitySql('a."envelopeJson"')}
      AND NOT EXISTS (SELECT 1 FROM "OutreachSuppression" suppression
        LEFT JOIN json_each(?) normalized ON json_extract(normalized.value,'$.id')=suppression."id"
          AND json_extract(normalized.value,'$.email') IS suppression."email"
          AND json_extract(normalized.value,'$.domain') IS suppression."domain"
          AND json_extract(normalized.value,'$.source') IS suppression."source"
        WHERE normalized.value IS NULL OR (
          (lower(trim(suppression."email"))=? OR json_extract(normalized.value,'$.normalizedEmail')=?
            OR json_extract(normalized.value,'$.normalizedDomain')=? OR suppression."leadId"=?)
          AND json_extract(normalized.value,'$.normalizedSource') <> 'REPLY'
          AND (json_extract(normalized.value,'$.normalizedSource') IN ('BOUNCE','NO_MX','UNSUBSCRIBE','OPT_OUT','COMPLAINT')
            OR suppression."expiresAt" IS NULL OR julianday(suppression."expiresAt") IS NULL
            OR julianday(suppression."expiresAt") > julianday('now'))))
  )`;
  return { sql, bindings: [intent.id, envelope.leadId, actor.sessionId, actor.userId,
    ...policy.adminEmails, ...policy.adminEmails, JSON.stringify(intent), JSON.stringify(envelope), mapping,
    envelope.to.toLowerCase(), normalizePipelineEmail(envelope.to),
    normalizeSuppressionDomain(envelope.to.slice(envelope.to.lastIndexOf("@") + 1)), envelope.leadId] };
}
