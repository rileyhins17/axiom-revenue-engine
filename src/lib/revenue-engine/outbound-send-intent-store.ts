import { z } from "zod";
import type { D1DatabaseLike } from "@/lib/cloudflare";
import { manualReplyClaimFence, type ManualReplyClaimContext } from "./manual-reply-claim-fence";

// Opaque internal/provider identifiers, not display names: printable ASCII only.
// Keep equivalent checks in migration 0073, including embedded-NUL rejection.
const identifier = z.string().min(1).max(256).regex(/^[\x21-\x7e]+(?![\s\S])/);
const digest = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/);
const attemptTokenSchema = z.string().regex(/^[a-f0-9]{32}(?![\s\S])/);
const publicColumns = `"id", "ownerId", "mailboxId", "operationKey", "payloadDigest",
  "mode", "rfcMessageId", "budgetMonth", "reservedCostCents", "state", "providerMessageId", "providerThreadId", "createdAt", "updatedAt"`;
const intentSchema = z.object({
  id: digest,
  ownerId: identifier,
  mailboxId: identifier,
  operationKey: identifier,
  payloadDigest: digest,
  mode: z.enum(["MANUAL_REPLY", "AUTOMATED"]),
  rfcMessageId: z.string().max(254).regex(/^<[A-Za-z0-9._-]+@[A-Za-z0-9.-]+>(?![\s\S])/),
  budgetMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(?![\s\S])/),
  reservedCostCents: z.number().int().min(0).max(5000),
}).strict();
const outcomeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("UNKNOWN") }).strict(),
  z.object({ state: z.literal("REJECTED") }).strict(),
  z.object({ state: z.literal("SENT"), providerMessageId: identifier, providerThreadId: identifier }).strict(),
]);
const rowSchema = intentSchema.extend({
  state: z.enum(["DISPATCHING", "UNKNOWN", "SENT", "REJECTED"]),
  providerMessageId: identifier.nullable(),
  providerThreadId: identifier.nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).refine((row) => row.updatedAt >= row.createdAt && (row.state === "SENT"
  ? row.providerMessageId !== null && row.providerThreadId !== null
  : row.providerMessageId === null && row.providerThreadId === null));

export type OutboundSendIntent = z.infer<typeof intentSchema>;
export type OutboundSendOutcome = z.infer<typeof outcomeSchema>;
export type OutboundSendIntentRow = z.infer<typeof rowSchema>;

export function parseOutboundSendIntent(input: unknown): Readonly<OutboundSendIntent> {
  const parsed = intentSchema.safeParse(input);
  if (!parsed.success) throw new Error("OUTBOUND_INTENT_INVALID");
  return Object.freeze(parsed.data);
}

export function parseOutboundSendIntentRow(input: unknown): Readonly<OutboundSendIntentRow> {
  const parsed = rowSchema.safeParse(input);
  if (!parsed.success) throw new Error("OUTBOUND_INTENT_ROW_INVALID");
  return Object.freeze(parsed.data);
}

/** Persistence primitive only, not send permission. No runtime binding/provider.
 * SQL reserves budget with the claim; the dispatcher must still establish current
 * policy and an authoritative cost quote, never a request-supplied estimate.
 * A claimed row is never leased/reclaimed; an interrupted attempt is uncertain.
 */
export function createOutboundSendIntentStore(database: Pick<D1DatabaseLike, "prepare">) {
  const readRow = parseOutboundSendIntentRow;
  const claim = async (input: OutboundSendIntent, fence?: Awaited<ReturnType<typeof manualReplyClaimFence>>): Promise<
      { kind: "CLAIMED"; attemptToken: string; row: Readonly<OutboundSendIntentRow> }
      | { kind: "EXISTING"; row: Readonly<OutboundSendIntentRow> }
    > => {
      const intent = intentSchema.parse(input);
      const attemptToken = crypto.randomUUID().replaceAll("-", "");
      // RETURNING proves this statement inserted the row; a later read cannot
      // distinguish the winner of concurrent requests and must never grant a claim.
      const inserted = await database.prepare(`INSERT INTO "OutboundSendIntent"
        ("id", "ownerId", "mailboxId", "operationKey", "payloadDigest", "mode", "rfcMessageId", "attemptToken", "budgetMonth", "reservedCostCents")
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ${fence ? `(${fence.sql}) AND` : ""}
          NOT EXISTS (SELECT 1 FROM "OutboundSendIntent" WHERE "ownerId" = ? AND "operationKey" = ?)
        ON CONFLICT ("ownerId", "operationKey") DO NOTHING RETURNING ${publicColumns}`)
        .bind(intent.id, intent.ownerId, intent.mailboxId, intent.operationKey,
          intent.payloadDigest, intent.mode, intent.rfcMessageId, attemptToken, intent.budgetMonth,
          intent.reservedCostCents, ...(fence?.bindings ?? []), intent.ownerId, intent.operationKey).first();
      if (inserted === undefined) throw new Error("OUTBOUND_CLAIM_INVALID");
      const stored = inserted ?? await database.prepare(
        `SELECT ${publicColumns} FROM "OutboundSendIntent" WHERE "ownerId" = ? AND "operationKey" = ?
          ${fence ? `AND (${fence.sql})` : ""}`,
      ).bind(intent.ownerId, intent.operationKey, ...(fence?.bindings ?? [])).first();
      if (stored === null && fence) throw new Error("OUTBOUND_MANUAL_POLICY_UNAVAILABLE");
      const row = readRow(stored);
      for (const key of Object.keys(intent) as Array<keyof OutboundSendIntent>) {
        if (row[key] !== intent[key]) throw new Error("OUTBOUND_INTENT_CONFLICT");
      }
      if (inserted !== null && row.state !== "DISPATCHING") throw new Error("OUTBOUND_CLAIM_INVALID");
      return inserted === null ? { kind: "EXISTING", row } : { kind: "CLAIMED", attemptToken, row };
    };
  return {
    // Persistence-only entry point retained for callers that compose their own
    // complete policy. It is not a manual-reply authorizer.
    claim: (input: OutboundSendIntent) => claim(input),
    /** Partial policy integration: same-statement current approval/account,
     * stops and suppression plus the existing atomic budget reservation. This
     * still lacks mailbox/consent/capacity gates; never activate it as-is. */
    async claimManualReply(input: OutboundSendIntent, context: ManualReplyClaimContext) {
      const intent = parseOutboundSendIntent(input);
      return claim(intent, await manualReplyClaimFence(database, intent, context));
    },
    /** Recheck immediately before transport. A failed check after claiming keeps
     * the reservation; it does not grant a new attempt. Not an in-flight recall. */
    async assertManualReplyCurrent(input: OutboundSendIntent, context: ManualReplyClaimContext) {
      const intent = parseOutboundSendIntent(input);
      const fence = await manualReplyClaimFence(database, intent, context);
      const row = await database.prepare(`SELECT 1 AS "allowed" WHERE ${fence.sql}
        AND EXISTS (SELECT 1 FROM "RuntimeBudgetMonth" WHERE "month"=?
          AND "month"=strftime('%Y-%m','now') AND "paused"=0 AND "currency"='CAD'
          AND "ceilingCents">0 AND "committedCents"<="ceilingCents")`)
        .bind(...fence.bindings, intent.budgetMonth).first<{ allowed: number }>();
      if (row?.allowed !== 1) throw new Error("OUTBOUND_MANUAL_POLICY_UNAVAILABLE");
    },

    async recordOutcome(input: OutboundSendIntent, token: string, result: OutboundSendOutcome) {
      const intent = intentSchema.parse(input);
      const checkedToken = attemptTokenSchema.safeParse(token);
      if (!checkedToken.success) throw new Error("OUTBOUND_OUTCOME_CONFLICT");
      const attemptToken = checkedToken.data;
      const outcome = outcomeSchema.parse(result);
      const messageId = outcome.state === "SENT" ? outcome.providerMessageId : null;
      const threadId = outcome.state === "SENT" ? outcome.providerThreadId : null;
      const row = await database.prepare(`UPDATE "OutboundSendIntent"
        SET "state" = ?, "providerMessageId" = ?, "providerThreadId" = ?, "updatedAt" = unixepoch()
        WHERE "id" = ? AND "ownerId" = ? AND "mailboxId" = ? AND "operationKey" = ?
          AND "payloadDigest" = ? AND "mode" = ? AND "rfcMessageId" = ? AND "attemptToken" = ?
          AND "budgetMonth" = ? AND "reservedCostCents" = ?
          AND ("state" = 'DISPATCHING' OR ("state" = 'UNKNOWN' AND ? = 'SENT'))
        RETURNING ${publicColumns}`).bind(outcome.state, messageId, threadId, intent.id, intent.ownerId,
        intent.mailboxId, intent.operationKey, intent.payloadDigest, intent.mode,
        intent.rfcMessageId, attemptToken, intent.budgetMonth, intent.reservedCostCents, outcome.state).first();
      if (row !== null) return readRow(row);
      const current = await database.prepare(
        `SELECT ${publicColumns} FROM "OutboundSendIntent" WHERE "id" = ? AND "attemptToken" = ?`,
      ).bind(intent.id, attemptToken).first();
      if (current === null) throw new Error("OUTBOUND_OUTCOME_CONFLICT");
      const existing = readRow(current);
      if ((Object.keys(intent) as Array<keyof OutboundSendIntent>).some((key) => existing[key] !== intent[key])
        || existing.state !== outcome.state || existing.providerMessageId !== messageId
        || existing.providerThreadId !== threadId) throw new Error("OUTBOUND_OUTCOME_CONFLICT");
      return existing;
    },
  };
}
