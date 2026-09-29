import { PermanentEmailError, type EmailTransport, type OutgoingEmail } from "./engine-email";

/** A duplex byte stream (cloudflare:sockets in the Worker, a fake in tests). */
export type SmtpStream = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; close(): Promise<void> };
export type SmtpAuth = { host: string; username: string; password: string; fromName: string; fromAddress: string };

const encoder = new TextEncoder();
const b64 = (value: string) => btoa(String.fromCharCode(...encoder.encode(value)));
const headerText = (value: string) => /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
const clean = (value: string) => value.replace(/[\r\n]/g, " ");

/** Builds an RFC 5322 message with a base64 text body (no dot-stuffing needed). */
export function buildMessage(auth: SmtpAuth, message: OutgoingEmail, messageId: string, date = new Date()): string {
  const body = b64(message.text).replace(/.{1,76}/g, "$&\r\n");
  const headers = {
    From: `${headerText(auth.fromName)} <${auth.fromAddress}>`,
    To: clean(message.to),
    Subject: headerText(clean(message.subject)),
    Date: date.toUTCString().replace("GMT", "+0000"),
    "Message-ID": `<${messageId}@${auth.fromAddress.split("@")[1]}>`,
    "MIME-Version": "1.0",
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Transfer-Encoding": "base64",
    ...Object.fromEntries(Object.entries(message.headers).map(([k, v]) => [k, clean(v)])),
  };
  return `${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n${body}`;
}

/** Minimal SMTP client over implicit TLS (port 465). One session, many messages. */
export async function openSmtp(stream: SmtpStream, auth: SmtpAuth, newId: () => string): Promise<EmailTransport> {
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  const decoder = new TextDecoder();
  let buffer = "";

  async function reply(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      const newline = buffer.indexOf("\r\n");
      if (newline >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 2);
        lines.push(line);
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) return { code: Number(line.slice(0, 3)), text: lines.join(" ") };
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP connection closed");
      buffer += decoder.decode(value, { stream: true });
    }
  }
  async function command(line: string | null, expect: number[]) {
    if (line !== null) await writer.write(encoder.encode(`${line}\r\n`));
    const response = await reply();
    if (!expect.includes(response.code)) {
      const safe = response.text.slice(0, 200);
      if (response.code >= 550 && response.code <= 553) throw new PermanentEmailError(`SMTP ${safe}`);
      throw new Error(`SMTP ${safe}`);
    }
    return response;
  }

  await command(null, [220]);
  await command(`EHLO ${auth.fromAddress.split("@")[1]}`, [250]);
  await command("AUTH LOGIN", [334]);
  await command(b64(auth.username), [334]);
  await command(b64(auth.password), [235]);

  return {
    async send(message) {
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(message.to)) throw new PermanentEmailError("invalid recipient");
      await command(`MAIL FROM:<${auth.fromAddress}>`, [250]);
      await command(`RCPT TO:<${message.to}>`, [250, 251]);
      await command("DATA", [354]);
      await command(`${buildMessage(auth, message, newId())}\r\n.`, [250]);
    },
    async close() {
      try { await command("QUIT", [221]); } catch { /* closing anyway */ }
      await stream.close().catch(() => undefined);
    },
  };
}
