import assert from "node:assert/strict";
import test from "node:test";

import { buildMessage } from "./smtp-client";

const auth = { host: "smtp.example", username: "riley@mail.example", password: "unused", fromName: "Riley Hinsperger", fromAddress: "riley@mail.example" };
const decode = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64.replace(/\s+/g, "")), (char) => char.charCodeAt(0)));

test("a plain email stays one base64 text part", () => {
  const raw = buildMessage(auth, { to: "jane@talktone.example", subject: "Hi", text: "Hello – Jane", headers: {} }, "m1", new Date("2026-11-02T15:00:00Z"));
  assert.match(raw, /\r\nContent-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n/);
  assert.doesNotMatch(raw, /multipart/);
  assert.equal(decode(raw.split("\r\n\r\n")[1]!), "Hello – Jane");
});

test("an email with HTML carries the plain text and the HTML side by side", () => {
  const raw = buildMessage(auth, {
    to: "jane@talktone.example", subject: "Question", text: "Plain – copy", html: "<p>HTML – copy</p>",
    headers: { "Message-ID": "<fcc-v5-c1-1@mail.example>" },
  }, "m2", new Date("2026-11-02T15:00:00Z"));
  const boundary = /Content-Type: multipart\/alternative; boundary="([^"]+)"/.exec(raw)?.[1];
  assert.ok(boundary, "a multipart/alternative message");
  assert.match(raw, /\r\nMessage-ID: <fcc-v5-c1-1@mail\.example>\r\n/, "the caller's Message-ID wins");
  const parts = raw.split(`--${boundary}`).slice(1, -1);
  assert.equal(parts.length, 2);
  assert.match(parts[0]!, /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64/);
  assert.match(parts[1]!, /Content-Type: text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64/);
  assert.equal(decode(parts[0]!.split("\r\n\r\n")[1]!), "Plain – copy");
  assert.equal(decode(parts[1]!.split("\r\n\r\n")[1]!), "<p>HTML – copy</p>");
  assert.ok(raw.trimEnd().endsWith(`--${boundary}--`));
  assert.ok(!raw.split("\r\n").some((line) => line === "."), "no line is a lone dot (it would end the SMTP message early)");
});
