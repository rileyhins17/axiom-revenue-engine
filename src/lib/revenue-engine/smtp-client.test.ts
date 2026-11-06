import assert from "node:assert/strict";
import test from "node:test";

import { buildMessage, openSmtp, type SmtpStream } from "./smtp-client";

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

/** A scripted SMTP server: each client line (and each message after DATA, as "<message>") gets the replies `respond` returns. */
function fakeSmtp(greeting: string | null, respond: (line: string) => string[]) {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let push: (text: string) => void = () => {};
  const readable = new ReadableStream<Uint8Array>({
    start(controller) { push = (text) => controller.enqueue(encoder.encode(text)); if (greeting) push(`${greeting}\r\n`); },
  });
  let partial = "";
  let inData = false;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      partial += new TextDecoder().decode(chunk);
      for (let index = partial.indexOf("\r\n"); index >= 0; index = partial.indexOf("\r\n")) {
        const line = partial.slice(0, index);
        partial = partial.slice(index + 2);
        if (inData) {
          if (line === ".") { inData = false; lines.push("<message>"); for (const reply of respond("<message>")) push(`${reply}\r\n`); }
          continue;
        }
        lines.push(line);
        if (line === "DATA") inData = true;
        for (const reply of respond(line)) push(`${reply}\r\n`);
      }
    },
  });
  let closed = false;
  const stream: SmtpStream = { readable, writable, close: async () => { closed = true; } };
  return { stream, lines, closed: () => closed };
}

const proton = { host: "smtp.protonmail.ch", username: "aidan@getaxiom.ca", password: "token-123", fromName: "Aidan Magee", fromAddress: "aidan@getaxiom.ca" };

test("STARTTLS (port 587, as Proton uses): the login and the email go only over the encrypted stream", async () => {
  const plain = fakeSmtp("220 smtp.protonmail.ch ESMTP", (line) => line.startsWith("EHLO") ? ["250-smtp.protonmail.ch", "250-STARTTLS", "250 AUTH PLAIN LOGIN"]
    : line === "STARTTLS" ? ["220 2.0.0 Ready to start TLS"] : ["500 unexpected"]);
  const secure = fakeSmtp(null, (line) => line.startsWith("EHLO") ? ["250-smtp.protonmail.ch", "250 AUTH PLAIN LOGIN"]
    : line === "AUTH LOGIN" ? ["334 VXNlcm5hbWU6"] : line === btoa("aidan@getaxiom.ca") ? ["334 UGFzc3dvcmQ6"] : line === btoa("token-123") ? ["235 2.7.0 Authentication successful"]
      : line.startsWith("MAIL FROM") || line.startsWith("RCPT TO") ? ["250 OK"] : line === "DATA" ? ["354 Go ahead"] : line === "<message>" ? ["250 OK queued"]
        : line === "QUIT" ? ["221 Bye"] : ["500 unexpected"]);
  let upgrades = 0;
  const transport = await openSmtp(plain.stream, proton, () => "m1", { startTls: async () => { upgrades += 1; return secure.stream; } });
  await transport.send({ to: "owner@agency.example", subject: "Hi", text: "Hello", headers: {} });
  await transport.close();
  assert.equal(upgrades, 1);
  assert.deepEqual(plain.lines, ["EHLO getaxiom.ca", "STARTTLS"], "nothing private before the upgrade");
  assert.deepEqual(secure.lines.slice(0, 4), ["EHLO getaxiom.ca", "AUTH LOGIN", btoa("aidan@getaxiom.ca"), btoa("token-123")]);
  assert.deepEqual(secure.lines.slice(4), ["MAIL FROM:<aidan@getaxiom.ca>", "RCPT TO:<owner@agency.example>", "DATA", "<message>", "QUIT"]);
  assert.ok(secure.closed());
});

test("a server that doesn't offer STARTTLS never gets the login", async () => {
  const plain = fakeSmtp("220 old.example ESMTP", (line) => line.startsWith("EHLO") ? ["250 AUTH LOGIN"] : ["500 unexpected"]);
  await assert.rejects(openSmtp(plain.stream, proton, () => "m1", { startTls: async () => plain.stream }), /does not offer STARTTLS/);
  assert.deepEqual(plain.lines, ["EHLO getaxiom.ca"]);
});
