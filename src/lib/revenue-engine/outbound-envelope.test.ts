import assert from "node:assert/strict";
import test from "node:test";
import { sendGmailEmail } from "../gmail";
import { createExactEnvelopeTransport, outboundEnvelopeDigest, parseOutboundEnvelope, type OutboundEnvelope } from "./outbound-envelope";
import type { OutboundSendIntent } from "./outbound-send-intent-store";

const envelope: OutboundEnvelope = {
  version: "outbound-envelope-v1", ownerId: "owner", mailboxId: "mailbox", connectionId: "connection",
  leadId: 7, policyVersion: "policy-v1", mode: "MANUAL_REPLY",
  from: "sender@example.invalid", fromName: "Axiom", to: "recipient@example.invalid",
  subject: "Your website question", bodyPlain: "  Thanks for asking.\r\nCafé.  ",
  bodyHtml: "<p>Thanks for asking. Café.</p>", threadId: "thread-1",
  inReplyTo: "<original@example.invalid>", references: ["<original@example.invalid>"],
  rfcMessageId: "<intent@example.invalid>",
};
async function makeIntent(): Promise<OutboundSendIntent> {
  return { id: "a".repeat(64), ownerId: envelope.ownerId, mailboxId: envelope.mailboxId,
    operationKey: "operation", payloadDigest: await outboundEnvelopeDigest(envelope),
    mode: envelope.mode, rfcMessageId: envelope.rfcMessageId,
    budgetMonth: "2026-09", reservedCostCents: 1 };
}
const mailbox = { ownerId: envelope.ownerId, mailboxId: envelope.mailboxId,
  connectionId: envelope.connectionId, address: envelope.from, accessToken: "synthetic-token" };

test("v2 binds the immutable reply target and requires recorded parent identity", async () => {
  const v2 = { ...envelope, version: "outbound-envelope-v2", replyTargetId: "target" };
  assert.equal(parseOutboundEnvelope(v2).version, "outbound-envelope-v2");
  assert(Object.isFrozen(parseOutboundEnvelope(v2).references));
  for (const change of [{ replyTargetId: undefined }, { replyTargetId: "target\n" },
    { inReplyTo: null }, { threadId: null }, { mode: "AUTOMATED" }, { version: "outbound-envelope-v1" }]) {
    assert.throws(() => parseOutboundEnvelope({ ...v2, ...change }), /OUTBOUND_ENVELOPE_INVALID/);
  }
  assert.notEqual(await outboundEnvelopeDigest(v2), await outboundEnvelopeDigest({ ...v2, replyTargetId: "replacement" }));
  assert.notEqual(await outboundEnvelopeDigest(v2), await outboundEnvelopeDigest(envelope));
});

test("exact envelope travels through real Gmail formatting without subject/body mutation", async () => {
  const originalFetch = globalThis.fetch;
  const captures: Array<{ raw: string; threadId: string }> = [];
  globalThis.fetch = async (_url, init) => {
    captures.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "accepted", threadId: "thread-1" }), { status: 200 });
  };
  try {
    const send = createExactEnvelopeTransport({
      async loadEnvelope() { return envelope; },
      async resolveMailbox(identity) {
        assert.deepEqual(identity, { ownerId: mailbox.ownerId, mailboxId: mailbox.mailboxId,
          connectionId: mailbox.connectionId, address: mailbox.address });
        return mailbox;
      },
      send: sendGmailEmail,
    });
    assert.deepEqual(await send(await makeIntent()), { messageId: "accepted", threadId: "thread-1" });
    assert.equal(captures.length, 1);
    assert.equal(captures[0].threadId, envelope.threadId);
    const wire = Buffer.from(captures[0].raw, "base64url").toString("utf8");
    assert.ok(wire.includes(`Subject: ${envelope.subject}\r\n`));
    assert.ok(wire.includes(`To: ${envelope.to}\r\n`));
    assert.ok(wire.includes(`From: "Axiom" <${envelope.from}>\r\n`));
    assert.ok(wire.includes(`Message-ID: ${envelope.rfcMessageId}\r\n`));
    assert.ok(wire.includes(`References: ${envelope.references.join(" ")}\r\n`));
    assert.ok(wire.includes(Buffer.from(envelope.bodyPlain).toString("base64")));
    assert.ok(wire.includes(Buffer.from(envelope.bodyHtml).toString("base64")));
    assert.ok(!wire.includes("Subject: Re:"));
  } finally { globalThis.fetch = originalFetch; }
});

test("changing any approval field blocks before credential resolution or send", async () => {
  const mutations: Partial<OutboundEnvelope>[] = [
    { ownerId: "other" }, { mailboxId: "other" }, { connectionId: "other" },
    { leadId: 8 }, { policyVersion: "policy-v2" }, { mode: "AUTOMATED" },
    { from: "other@example.invalid" }, { fromName: "Other" }, { to: "other@example.invalid" },
    { subject: "Re: Your website question" }, { bodyPlain: envelope.bodyPlain.trim() },
    { bodyPlain: envelope.bodyPlain.replaceAll("\r\n", "\n") }, { bodyHtml: "<p>Changed</p>" },
    { threadId: "other" }, { inReplyTo: "<other@example.invalid>" },
    { references: ["<other@example.invalid>"] }, { rfcMessageId: "<other@example.invalid>" },
  ];
  const intent = await makeIntent();
  for (const mutation of mutations) {
    const send = createExactEnvelopeTransport({
      async loadEnvelope() { return { ...envelope, ...mutation }; },
      async resolveMailbox() { assert.fail("Must not resolve credentials for altered content"); },
      async send() { assert.fail("Must not send altered content"); },
    });
    await assert.rejects(send(intent), /OUTBOUND_ENVELOPE_CONFLICT/);
  }
});

test("header injection, unknown fields and malformed Unicode cannot be approved", async () => {
  for (const change of [
    { subject: "Subject\r\nBcc: other@example.invalid" }, { subject: "Trailing " },
    { fromName: " Axiom" }, { from: "sender@example.invalid\n" },
    { to: "recipient@example.invalid,other@example.invalid" }, { references: ["<original@example.invalid>\n"] },
    { subject: "broken\ud800" }, { bodyPlain: "broken\udfff" },
    { cc: "other@example.invalid" }, { accessToken: "must-not-accept" },
    { mode: "MANUAL_REPLY", threadId: null },
  ]) await assert.rejects(outboundEnvelopeDigest({ ...envelope, ...change }), /OUTBOUND_ENVELOPE_INVALID/);
  const reversed = Object.fromEntries(Object.entries(envelope).reverse());
  assert.equal(await outboundEnvelopeDigest(reversed), await outboundEnvelopeDigest(envelope));
});

test("mailbox lookup must return the exact owner, mailbox, connection and address", async () => {
  for (const change of [{ ownerId: "other" }, { mailboxId: "other" }, { connectionId: "other" },
    { address: "other@example.invalid" }, { accessToken: "" }, { accessToken: "bad\r\ntoken" }]) {
    const send = createExactEnvelopeTransport({
      async loadEnvelope() { return envelope; },
      async resolveMailbox() { return { ...mailbox, ...change }; },
      async send() { assert.fail("Mismatched or invalid mailbox must not send"); },
    });
    await assert.rejects(send(await makeIntent()), /OUTBOUND_MAILBOX_(CONFLICT|INVALID)/);
  }
});

test("stored input mutation during mailbox resolution cannot alter the approved snapshot", async () => {
  const stored = { ...envelope, references: [...envelope.references] };
  const send = createExactEnvelopeTransport({
    async loadEnvelope() { return stored; },
    async resolveMailbox() {
      stored.to = "other@example.invalid";
      stored.references.push("<other@example.invalid>");
      return mailbox;
    },
    async send(options) {
      assert.equal(options.to, envelope.to);
      assert.equal(options.references, envelope.references.join(" "));
      return { messageId: "accepted", threadId: "thread-1" };
    },
  });
  await send(await makeIntent());
});

test("a provider result for a different reply thread is uncertain, not confirmed success", async () => {
  let sends = 0;
  const send = createExactEnvelopeTransport({
    async loadEnvelope() { return envelope; },
    async resolveMailbox() { return mailbox; },
    async send() { sends++; return { messageId: "accepted", threadId: "wrong-thread" }; },
  });
  await assert.rejects(send(await makeIntent()), /OUTBOUND_THREAD_RESULT_UNCERTAIN/);
  assert.equal(sends, 1); // It may have sent: the dispatcher must not automatically retry.
  await outboundEnvelopeDigest({ ...envelope, bodyPlain: "\ufeffBody with a UTF-8 BOM" });
});
