/** One fixed, parameterized predicate shared by approval INSERT/reload, manual
 * claim and final check. Metadata comes from reviewed provider ingestion (not
 * implemented yet), NEVER browser assertions or legacy Gmail inference. READY
 * is a local stop control, not proof of provider health, consent or deliverability.
 * The argument is a closed set of internal SQL expressions, not caller text. */
export function manualReplyIdentitySql(envelopeExpression: "?" | 'a."envelopeJson"') {
  return `EXISTS (SELECT 1 FROM (SELECT ${envelopeExpression} AS body) e
    JOIN "RevenueMailReplyTarget" target ON target."id"=json_extract(e.body,'$.replyTargetId')
    JOIN "RevenueMailConversation" conversation ON conversation."id"=target."conversationId"
    JOIN "RevenueMailboxIdentity" mailbox ON mailbox."id"=conversation."mailboxId"
    WHERE json_extract(e.body,'$.version')='outbound-envelope-v2'
      AND json_extract(e.body,'$.mode')='MANUAL_REPLY'
      AND mailbox."id"=json_extract(e.body,'$.mailboxId')
      AND mailbox."ownerId"=json_extract(e.body,'$.ownerId')
      AND mailbox."connectionId"=json_extract(e.body,'$.connectionId')
      AND mailbox."address"=json_extract(e.body,'$.from')
      AND mailbox."state"='READY' AND mailbox."retiredAt" IS NULL
      AND conversation."retiredAt" IS NULL AND target."retiredAt" IS NULL
      AND mailbox."createdAt"<=unixepoch() AND conversation."createdAt"<=unixepoch() AND target."createdAt"<=unixepoch()
      AND conversation."leadId"=json_extract(e.body,'$.leadId')
      AND conversation."providerThreadId"=json_extract(e.body,'$.threadId')
      AND target."recipientAddress"=json_extract(e.body,'$.to')
      AND target."inReplyTo"=json_extract(e.body,'$.inReplyTo')
      AND target."referencesJson"=json_extract(e.body,'$.references'))`;
}
