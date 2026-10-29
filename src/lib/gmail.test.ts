import { strict as assert } from "node:assert";
import test from "node:test";

import { buildRfc2822Message, sendGmailEmail, sendGmailReply } from "./gmail";

test("gmail cold emails keep mailto unsubscribe without invalid one-click header", async () => {
  const raw = buildRfc2822Message({
    from: "sender@example.com",
    to: "lead@example.com",
    subject: "Hello",
    bodyHtml: "<p>Hello</p>",
    bodyPlain: "Hello",
  });
  assert.match(raw, /^List-Unsubscribe: <mailto:sender@example\.com\?subject=unsubscribe>/m);
  assert.doesNotMatch(raw, /^List-Unsubscribe-Post:/m);
});

test("gmail replies include message reference headers for cross-client threading", async () => {
  const raw = buildRfc2822Message({
    from: "sender@example.com",
    to: "lead@example.com",
    subject: "Original subject",
    bodyHtml: "<p>Reply</p>",
    bodyPlain: "Reply",
    inReplyTo: "<original-message@example.com>",
    references: "<original-message@example.com>",
  });
  assert.match(raw, /^In-Reply-To: <original-message@example\.com>/m);
  assert.match(raw, /^References: <original-message@example\.com>/m);
});

test("legacy Gmail cold emails and replies cannot reach the provider", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    throw new Error("Unexpected external request");
  }) as typeof fetch;

  try {
    const message = {
      accessToken: "synthetic-token",
      from: "sender@example.com",
      to: "lead@example.com",
      subject: "Hello",
      bodyHtml: "<p>Hello</p>",
      bodyPlain: "Hello",
    };
    await assert.rejects(sendGmailEmail(message), /Legacy Gmail sending is disabled/);
    await assert.rejects(sendGmailReply({ ...message, threadId: "synthetic-thread" }), /Legacy Gmail sending is disabled/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
