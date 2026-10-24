import type { SmtpStream } from "./smtp-client";

/**
 * Minimal read-only IMAP client over implicit TLS (port 993): log in, find the
 * "all mail" folder, open it with EXAMINE (never SELECT, so no flags change) and
 * run SEARCH. Used to notice replies and bounces before a follow-up is sent.
 */
export type ImapStream = SmtpStream;
export type ImapAuth = { username: string; password: string };
export type ImapMailbox = { name: string; flags: string[] };
export type ImapSession = {
  listMailboxes(): Promise<ImapMailbox[]>;
  examine(mailbox: string): Promise<void>;
  search(criteria: string): Promise<number[]>;
  close(): Promise<void>;
};

const encoder = new TextEncoder();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** IMAP quoted string. Refuses line breaks so a value can never start a new command. */
export function imapQuote(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("IMAP value contains a line break");
  return `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

/** IMAP SEARCH date for the UTC day of `iso`, e.g. 24-Oct-2026. */
export function imapDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error("IMAP date is invalid");
  return `${date.getUTCDate()}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function unquote(value: string): string {
  const text = value.trim();
  if (text === "NIL") return "";
  if (!text.startsWith('"')) return text;
  return text.slice(1, -1).replace(/\\(["\\])/g, "$1");
}

export async function openImap(stream: ImapStream, auth: ImapAuth): Promise<ImapSession> {
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  const decoder = new TextDecoder();
  let buffer = "";
  let tags = 0;

  async function fill() {
    const { value, done } = await reader.read();
    if (done) throw new Error("IMAP connection closed");
    buffer += decoder.decode(value, { stream: true });
  }

  /** One response line. A {n} literal is folded back into the line as a quoted string. */
  async function readLine(): Promise<string> {
    for (;;) {
      const newline = buffer.indexOf("\r\n");
      if (newline < 0) { await fill(); continue; }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 2);
      const literal = /\{(\d+)\}$/.exec(line);
      if (!literal) return line;
      const size = Number(literal[1]);
      while (buffer.length < size) await fill();
      const content = buffer.slice(0, size);
      buffer = buffer.slice(size);
      return `${line.slice(0, literal.index)}"${content.replace(/[\\"]/g, (char) => `\\${char}`)}"${await readLine()}`;
    }
  }

  async function command(text: string, allowBye = false): Promise<string[]> {
    const tag = `A${String(++tags).padStart(3, "0")}`;
    await writer.write(encoder.encode(`${tag} ${text}\r\n`));
    const untagged: string[] = [];
    for (;;) {
      const line = await readLine();
      if (line.startsWith(`${tag} `)) {
        const status = line.slice(tag.length + 1);
        if (!status.startsWith("OK")) throw new Error(`IMAP ${status.slice(0, 200)}`);
        return untagged;
      }
      if (line.startsWith("* BYE") && !allowBye) throw new Error(`IMAP ${line.slice(0, 200)}`);
      untagged.push(line);
    }
  }

  try {
    const greeting = await readLine();
    if (!greeting.startsWith("* OK")) throw new Error(`IMAP ${greeting.slice(0, 200)}`);
    await command(`LOGIN ${imapQuote(auth.username)} ${imapQuote(auth.password)}`);
  } catch (error) {
    await stream.close().catch(() => undefined);
    throw error;
  }

  return {
    async listMailboxes() {
      const lines = await command(`LIST "" "*"`);
      return lines.flatMap((line) => {
        const match = /^\* LIST \(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.+)$/.exec(line);
        return match ? [{ flags: match[1]!.split(/\s+/).filter(Boolean), name: unquote(match[2]!) }] : [];
      });
    },
    async examine(mailbox) {
      await command(`EXAMINE ${imapQuote(mailbox)}`);
    },
    async search(criteria) {
      if (/[\r\n]/.test(criteria)) throw new Error("IMAP search contains a line break");
      const lines = await command(`SEARCH ${criteria}`);
      return lines.flatMap((line) => line.startsWith("* SEARCH")
        ? line.slice("* SEARCH".length).trim().split(/\s+/).filter(Boolean).map(Number)
        : []);
    },
    async close() {
      try { await command("LOGOUT", true); } catch { /* closing anyway */ }
      await stream.close().catch(() => undefined);
    },
  };
}
