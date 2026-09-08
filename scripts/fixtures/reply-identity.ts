import { parseOutboundEnvelope } from "../../src/lib/revenue-engine/outbound-envelope";

/** Synthetic provider records only. Approval tests MUST call the real approval
 * writer after these prerequisites; these rows do not prove real ingestion. */
export function syntheticReplyIdentity(input: unknown) {
  const e = parseOutboundEnvelope(input);
  if (e.version !== "outbound-envelope-v2") throw new Error("Expected v2 test envelope");
  const conversationId = e.mailboxId + ":conversation";
  return [
    { sql: `INSERT INTO "RevenueMailboxIdentity" (id,ownerId,providerKey,providerAccountId,connectionId,address,state)
      VALUES (?,?,'synthetic-nongoogle',?,?,?,'READY')`,
      args: [e.mailboxId, e.ownerId, e.mailboxId + ":account", e.connectionId, e.from] },
    { sql: `INSERT INTO "RevenueMailConversation" (id,mailboxId,leadId,providerThreadId) VALUES (?,?,?,?)`,
      args: [conversationId, e.mailboxId, e.leadId, e.threadId] },
    { sql: `INSERT INTO "RevenueMailReplyTarget" (id,conversationId,providerMessageId,recipientAddress,inReplyTo,referencesJson)
      VALUES (?,?,'synthetic-parent',?,?,?)`,
      args: [e.replyTargetId, conversationId, e.to, e.inReplyTo, JSON.stringify(e.references)] },
  ];
}
