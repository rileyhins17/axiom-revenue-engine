import type { D1DatabaseLike } from "../cloudflare";
import type { ManualReplyContext, ManualReplyRuntime } from "./manual-reply";
import { createOutboundApprovalStore } from "./outbound-approval-store";
import { createOutboundDispatcher, type OutboundDispatchDependencies } from "./outbound-dispatch";
import { parseOutboundEnvelope, type OutboundEnvelope } from "./outbound-envelope";
import { createOutboundSendIntentStore, parseOutboundSendIntent } from "./outbound-send-intent-store";
import { createManualReplyHistory } from "./manual-reply-history";

/** Server composition only. No claim, outcome-writer, history-writer or runtime
 * override callback is accepted. This owns the minimum mandatory manual gates.
 * Additional provider/consent/capacity policy is still unfinished; a callback is
 * NOT proof those facts are atomic. getManualReplyRuntime stays null until the
 * complete policy and reviewed non-Google adapter are implemented and approved. */
export function createManualReplyRuntime(options: {
  database: Pick<D1DatabaseLike, "prepare">;
  transport(envelope: Readonly<OutboundEnvelope>): ReturnType<OutboundDispatchDependencies["sendExactIntent"]>;
  assertAdditionalPolicy(context: ManualReplyContext, phase: "claim" | "transport"): Promise<void>;
}): ManualReplyRuntime {
  if (!options || Object.keys(options).sort().join(",") !== "assertAdditionalPolicy,database,transport"
    || typeof options.database?.prepare !== "function" || typeof options.transport !== "function"
    || typeof options.assertAdditionalPolicy !== "function") throw new Error("MANUAL_REPLY_RUNTIME_INVALID");
  const { database, transport, assertAdditionalPolicy } = options;
  const store = createOutboundSendIntentStore(database);
  const history = createManualReplyHistory(database);
  return Object.freeze({
    loadApprovedReply: createOutboundApprovalStore(database).loadApprovedReply,
    async recover(intentId, actor, leadId) {
      const receipt = await history.readReceipt(intentId, actor, leadId);
      if (!receipt) return null;
      if (receipt.row.state === "DISPATCHING" || receipt.row.state === "UNKNOWN") {
        return { state: "DELIVERY_UNCERTAIN" as const, intentId };
      }
      if (receipt.row.state === "REJECTED") return { state: "REJECTED" as const, intentId };
      return { state: "SENT" as const, intentId, messageId: receipt.row.providerMessageId!, threadId: receipt.row.providerThreadId! };
    },
    async dispatch(input) {
      const context: ManualReplyContext = Object.freeze({ actor: Object.freeze({ ...input.actor }), leadId: input.leadId,
        intent: parseOutboundSendIntent(input.intent), envelope: parseOutboundEnvelope(input.envelope) });
      if (context.leadId !== context.envelope.leadId) throw new Error("MANUAL_REPLY_RUNTIME_CONTEXT_INVALID");
      // Gate construction is private to this factory, not supplied by a caller.
      const dispatch = createOutboundDispatcher({
        async authorizeAndClaim(intent) {
          await assertAdditionalPolicy(context, "claim");
          return store.claimManualReply(intent, context);
        },
        recordOutcome: store.recordOutcome,
        async sendExactIntent(intent) {
          await assertAdditionalPolicy(context, "transport");
          await store.assertManualReplyCurrent(intent, context);
          const result = await transport(context.envelope);
          if (result && !("rejected" in result) && result.threadId !== context.envelope.threadId) {
            throw new Error("MANUAL_REPLY_PROVIDER_THREAD_MISMATCH");
          }
          return result;
        },
        async projectAccepted(intent, accepted) {
          const record = await history.readAccepted(intent.id, context.actor, context.leadId);
          if (record.messageId !== accepted.messageId || record.threadId !== accepted.threadId) {
            throw new Error("MANUAL_REPLY_HISTORY_UNAVAILABLE");
          }
        },
      });
      return dispatch(context.intent);
    },
  });
}

/** No environment switch, credential lookup or legacy fallback. A real runtime
 * requires approved non-Google transport, complete atomic policy and release
 * gates. Synthetic tests inject dependencies into the same route handler;
 * production cannot select those test dependencies. */
export function getManualReplyRuntime(): ManualReplyRuntime | null {
  return null;
}
