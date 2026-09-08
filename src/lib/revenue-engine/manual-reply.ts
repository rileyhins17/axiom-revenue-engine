import { z } from "zod";
import type { OutboundDispatchResult } from "./outbound-dispatch";
import { outboundEnvelopeDigest, parseOutboundEnvelope, type OutboundEnvelope } from "./outbound-envelope";
import { parseOutboundSendIntent, type OutboundSendIntent } from "./outbound-send-intent-store";

export type ManualReplyActor = Readonly<{ userId: string; sessionId: string }>;
export type ManualReplyContext = Readonly<{
  actor: ManualReplyActor; leadId: number;
  intent: Readonly<OutboundSendIntent>; envelope: Readonly<OutboundEnvelope>;
}>;
export type ManualReplyRuntime = {
  loadApprovedReply(intentId: string): Promise<{ intent: unknown; envelope: unknown }>;
  /** Read-only historical status, with current owner/session/client scope. */
  recover(intentId: string, actor: ManualReplyActor, leadId: number): Promise<OutboundDispatchResult | null>;
  /** Owned by createManualReplyRuntime; no raw claim dependencies at this boundary. */
  dispatch(context: ManualReplyContext): Promise<OutboundDispatchResult>;
};
const requestSchema = z.object({ intentId: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/) }).strict();
const actorSchema = z.object({ userId: z.string().min(1).max(256), sessionId: z.string().min(1).max(256) }).strict();
const headers = { "Cache-Control": "private, no-store" };
const failure = (error: string, status: number, code?: string) => Response.json({ success: false, error,
  ...(code ? { code } : {}) }, { status, headers });
const statusUnavailable = (intentId: string) => Response.json({ success: false, state: "STATUS_UNAVAILABLE", intentId,
  error: "Reply status could not be confirmed. Keep this reply ID; do not create another attempt." }, { status: 503, headers });
function dispatchResponse(result: OutboundDispatchResult) {
  const success = result.state === "SENT" || result.state === "SENT_HISTORY_PENDING";
  return Response.json({ success, ...result }, {
    status: success ? 200 : result.state === "DELIVERY_UNCERTAIN" ? 202 : 409, headers,
  });
}

async function readReference(request: Request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new Error("INVALID_REQUEST");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Count actual streamed bytes; Content-Length can be absent or dishonest.
    const read = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1024) throw new Error("INVALID_REQUEST");
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return requestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    };
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("INVALID_REQUEST")), 5000);
    })]);
  } finally {
    clearTimeout(timer);
    // An uncooperative stream cannot hold the error response open.
    void reader.cancel().catch(() => undefined);
  }
}

/** Called after the route's current administrator + mutation-origin fence.
 * Runtime injection is server composition, not request-selected authority.
 * This module selects no provider, credentials or live database. */
export async function handleApprovedManualReply(request: Request, leadPath: string,
  inputActor: ManualReplyActor, runtime: ManualReplyRuntime | null): Promise<Response> {
  if (!runtime) return failure("Email sending is unavailable while the non-Google mail service and safety checks are being completed.", 503, "MAIL_RUNTIME_UNAVAILABLE");
  const actor = actorSchema.safeParse(inputActor);
  if (!actor.success) return failure("Reply authorization unavailable", 403);
  if (!/^[1-9][0-9]*(?![\s\S])/.test(leadPath) || !Number.isSafeInteger(Number(leadPath))) return failure("Invalid client id", 400);
  let reference: z.infer<typeof requestSchema>;
  try { reference = await readReference(request); }
  catch { return failure("Submit only a valid approved reply reference as JSON", 400); }

  try {
    const recorded = await runtime.recover(reference.intentId, Object.freeze(actor.data), Number(leadPath));
    if (recorded) return dispatchResponse(recorded);
  } catch { return statusUnavailable(reference.intentId); }

  let context: ManualReplyContext;
  try {
    const approved = await runtime.loadApprovedReply(reference.intentId);
    const intent = parseOutboundSendIntent(approved.intent);
    const envelope = parseOutboundEnvelope(approved.envelope);
    if (intent.id !== reference.intentId || intent.ownerId !== actor.data.userId
      || envelope.ownerId !== actor.data.userId || envelope.leadId !== Number(leadPath)
      || intent.mode !== "MANUAL_REPLY" || envelope.mode !== "MANUAL_REPLY"
      || intent.mailboxId !== envelope.mailboxId || intent.rfcMessageId !== envelope.rfcMessageId
      || intent.payloadDigest !== await outboundEnvelopeDigest(envelope)) throw new Error("Mismatch");
    context = Object.freeze({ actor: Object.freeze(actor.data), leadId: Number(leadPath), intent, envelope });
  } catch { return failure("Approved reply unavailable for this client and owner", 409); }

  try {
    const result = await runtime.dispatch(context);
    // A 2xx alone is not a send receipt. Consumers must inspect success and state.
    return dispatchResponse(result);
  } catch {
    // Claim acknowledgement may be lost: never leak an error or invent a new key.
    return statusUnavailable(context.intent.id);
  }
}
