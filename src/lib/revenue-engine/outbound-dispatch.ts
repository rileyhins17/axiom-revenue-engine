import type { createOutboundSendIntentStore, OutboundSendIntent } from "./outbound-send-intent-store";

type IntentStore = ReturnType<typeof createOutboundSendIntentStore>;
type AcceptedMessage = { messageId: string; threadId: string };
/** Only the trusted adapter may assert confirmed non-delivery. Never derive this
 * from arbitrary thrown text, a timeout, or an unsuccessful HTTP status alone. */
type TransportResult = AcceptedMessage | { rejected: true };

export type OutboundDispatchDependencies = {
  /** Must atomically establish current policy AND claim/reserve budget. The
   * standalone intent store is not sufficient authorization for this callback. */
  authorizeAndClaim: IntentStore["claim"];
  recordOutcome: IntentStore["recordOutcome"];
  /** Trusted adapter must load the exact approved envelope and verify its digest
   * and mailbox against this immutable intent. Never accept browser send options. */
  sendExactIntent(intent: Readonly<OutboundSendIntent>): Promise<TransportResult>;
  /** Retry-safe projections only: deterministic CRM/send-history IDs. No sending. */
  projectAccepted(intent: Readonly<OutboundSendIntent>, result: AcceptedMessage): Promise<void>;
};

export type OutboundDispatchResult =
  | { state: "DELIVERY_UNCERTAIN"; intentId: string }
  | { state: "REJECTED"; intentId: string }
  | { state: "SENT" | "SENT_HISTORY_PENDING"; intentId: string; messageId: string; threadId: string };

function isProviderIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{1,256}(?![\s\S])/.test(value);
}

/** Shared dispatch orchestration. The manual-reply handler composes it through
 * injected dependencies; no live bindings, credentials or Gmail import here.
 * An atomic authorizer and exact-envelope adapter are
 * mandatory integration dependencies, not capabilities manufactured here. */
export function createOutboundDispatcher(dependencies: OutboundDispatchDependencies) {
  return async (input: OutboundSendIntent): Promise<OutboundDispatchResult> => {
    const intent = Object.freeze({ ...input });
    const claim = await dependencies.authorizeAndClaim(intent);
    for (const key of Object.keys(intent) as Array<keyof OutboundSendIntent>) {
      if (claim.row[key] !== intent[key]) throw new Error("OUTBOUND_DISPATCH_CLAIM_MISMATCH");
    }
    const project = async (accepted: AcceptedMessage): Promise<OutboundDispatchResult> => {
      if (!isProviderIdentifier(accepted.messageId) || !isProviderIdentifier(accepted.threadId)) {
        throw new Error("OUTBOUND_ACCEPTANCE_INVALID");
      }
      try {
        await dependencies.projectAccepted(intent, Object.freeze({ ...accepted }));
        return { state: "SENT", intentId: intent.id, ...accepted };
      } catch {
        return { state: "SENT_HISTORY_PENDING", intentId: intent.id, ...accepted };
      }
    };
    if (claim.kind === "EXISTING") {
      switch (claim.row.state) {
        case "DISPATCHING":
        case "UNKNOWN": return { state: "DELIVERY_UNCERTAIN", intentId: intent.id };
        case "REJECTED": return { state: "REJECTED", intentId: intent.id };
        case "SENT": return project({ messageId: claim.row.providerMessageId!, threadId: claim.row.providerThreadId! });
        default: throw new Error("OUTBOUND_DISPATCH_STATE_INVALID");
      }
    }
    if (claim.kind !== "CLAIMED" || claim.row.state !== "DISPATCHING"
      || typeof claim.attemptToken !== "string" || !/^[a-f0-9]{32}(?![\s\S])/.test(claim.attemptToken)) {
      throw new Error("OUTBOUND_DISPATCH_CLAIM_INVALID");
    }
    let accepted: AcceptedMessage;
    try {
      const result = await dependencies.sendExactIntent(intent);
      if (result && "rejected" in result) {
        if (result.rejected !== true || Object.keys(result).length !== 1) {
          throw new Error("OUTBOUND_REJECTION_INVALID");
        }
        // Do not advertise definitive rejection unless its receipt is durable.
        // A lost acknowledgement leaves replay to inspect the committed state.
        try {
          await dependencies.recordOutcome(intent, claim.attemptToken, { state: "REJECTED" });
          return { state: "REJECTED", intentId: intent.id };
        } catch {
          return { state: "DELIVERY_UNCERTAIN", intentId: intent.id };
        }
      }
      if (!result || !isProviderIdentifier(result.messageId) || !isProviderIdentifier(result.threadId)) {
        throw new Error("OUTBOUND_ACCEPTANCE_INVALID");
      }
      accepted = { messageId: result.messageId, threadId: result.threadId };
    } catch {
      // A transport error alone never proves non-delivery. A failed UNKNOWN
      // write still leaves the original durable DISPATCHING marker blocking retry.
      try { await dependencies.recordOutcome(intent, claim.attemptToken, { state: "UNKNOWN" }); } catch { /* retain pre-send marker */ }
      return { state: "DELIVERY_UNCERTAIN", intentId: intent.id };
    }
    try {
      await dependencies.recordOutcome(intent, claim.attemptToken, {
        state: "SENT", providerMessageId: accepted.messageId, providerThreadId: accepted.threadId,
      });
    } catch {
      // Do not overwrite an acceptance that may have committed before its
      // acknowledgement was lost, or run projections without a durable receipt.
      return { state: "DELIVERY_UNCERTAIN", intentId: intent.id };
    }
    return project(accepted);
  };
}
