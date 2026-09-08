import { z } from "zod";
import type { sendGmailEmail } from "../gmail";
import type { OutboundSendIntent } from "./outbound-send-intent-store";

const identifier = z.string().regex(/^[\x21-\x7e]{1,256}(?![\s\S])/);
const email = z.email().max(254).regex(/^[\x21-\x7e]+(?![\s\S])/);
const unicode = (value: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;
// Reject changes the Gmail builder would otherwise silently make after approval.
const header = z.string().min(1).max(200).refine((value) => value === value.trim()
  && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && unicode(value));
const messageId = z.string().max(254).regex(/^<[\x21-\x3b\x3d\x3f-\x7e]+>(?![\s\S])/);
const body = z.string().max(131072).refine(unicode);

const legacyEnvelopeSchema = z.object({
  version: z.literal("outbound-envelope-v1"),
  ownerId: identifier,
  mailboxId: identifier,
  connectionId: identifier,
  leadId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  policyVersion: identifier,
  mode: z.enum(["MANUAL_REPLY", "AUTOMATED"]),
  from: email,
  fromName: header.nullable(),
  to: email,
  subject: header,
  bodyPlain: body.refine((value) => value.trim().length > 0),
  bodyHtml: body,
  threadId: identifier.nullable(),
  inReplyTo: messageId.nullable(),
  references: z.array(messageId).max(20),
  rfcMessageId: z.string().max(254).regex(/^<[A-Za-z0-9._-]+@[A-Za-z0-9.-]+>(?![\s\S])/),
}).strict();
// v1 remains readable for legacy characterization. New manual admissions require
// v2's immutable reply target; never upgrade an old approval by inference.
const envelopeSchema = z.union([legacyEnvelopeSchema, legacyEnvelopeSchema.extend({
  version: z.literal("outbound-envelope-v2"), mode: z.literal("MANUAL_REPLY"),
  replyTargetId: identifier, threadId: identifier, inReplyTo: messageId,
})]).refine((value) => (value.mode !== "MANUAL_REPLY" || value.threadId !== null)
  && (value.threadId !== null || (value.inReplyTo === null && value.references.length === 0))
  && value.references.join(" ").length <= 900);

export type OutboundEnvelope = z.infer<typeof envelopeSchema>;

export function parseOutboundEnvelope(input: unknown): Readonly<OutboundEnvelope> {
  const result = envelopeSchema.safeParse(input);
  // Never return parser diagnostics containing message or identity values.
  if (!result.success) throw new Error("OUTBOUND_ENVELOPE_INVALID");
  Object.freeze(result.data.references);
  return Object.freeze(result.data);
}

export async function outboundEnvelopeDigest(input: unknown): Promise<string> {
  const envelope = parseOutboundEnvelope(input);
  // Schema emits fixed key order. Do not trim, lowercase or normalize body bytes.
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(envelope)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const mailboxSchema = z.object({
  ownerId: identifier, mailboxId: identifier, connectionId: identifier, address: email,
  accessToken: z.string().min(1).max(16384).regex(/^[\x21-\x7e]+(?![\s\S])/),
}).strict();

/** Dispatcher transport only, NOT an authorization entry point. The real loaders
 * must use authoritative stored approval and exact connection/token provenance.
 * No runtime loaders are supplied here; never bind these callbacks to request JSON.
 * The dispatcher must have already atomically authorized and claimed the intent. */
export function createExactEnvelopeTransport(dependencies: {
  loadEnvelope(intent: Readonly<OutboundSendIntent>): Promise<unknown>;
  resolveMailbox(identity: Readonly<{ ownerId: string; mailboxId: string; connectionId: string; address: string }>): Promise<unknown>;
  send: typeof sendGmailEmail;
}) {
  return async (input: Readonly<OutboundSendIntent>) => {
    const intent = Object.freeze({ ...input });
    const envelope = parseOutboundEnvelope(await dependencies.loadEnvelope(intent));
    if (envelope.ownerId !== intent.ownerId || envelope.mailboxId !== intent.mailboxId
      || envelope.mode !== intent.mode || envelope.rfcMessageId !== intent.rfcMessageId
      || await outboundEnvelopeDigest(envelope) !== intent.payloadDigest) {
      throw new Error("OUTBOUND_ENVELOPE_CONFLICT");
    }
    const identity = Object.freeze({ ownerId: envelope.ownerId, mailboxId: envelope.mailboxId,
      connectionId: envelope.connectionId, address: envelope.from });
    const parsedMailbox = mailboxSchema.safeParse(await dependencies.resolveMailbox(identity));
    if (!parsedMailbox.success) throw new Error("OUTBOUND_MAILBOX_INVALID");
    const mailbox = parsedMailbox.data;
    if (Object.entries(identity).some(([key, value]) => mailbox[key as keyof typeof identity] !== value)) {
      throw new Error("OUTBOUND_MAILBOX_CONFLICT");
    }
    // Explicit allowlist; no spread of stored/request fields into the transport.
    // Reply subject and references are final before approval, not rewritten here.
    const accepted = await dependencies.send({ accessToken: mailbox.accessToken, from: envelope.from,
      fromName: envelope.fromName ?? undefined, to: envelope.to, subject: envelope.subject,
      bodyPlain: envelope.bodyPlain, bodyHtml: envelope.bodyHtml,
      threadId: envelope.threadId ?? undefined, inReplyTo: envelope.inReplyTo ?? undefined,
      references: envelope.references.length ? envelope.references.join(" ") : undefined,
      rfcMessageId: envelope.rfcMessageId });
    if (envelope.threadId !== null && accepted.threadId !== envelope.threadId) {
      throw new Error("OUTBOUND_THREAD_RESULT_UNCERTAIN");
    }
    return accepted;
  };
}
