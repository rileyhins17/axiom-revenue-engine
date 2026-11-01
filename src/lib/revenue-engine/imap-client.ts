import type { SmtpStream } from "./smtp-client";

/**
 * Minimal read-only IMAP client over implicit TLS (port 993): log in, find the
 * "all mail" folder, open it with EXAMINE (never SELECT, so no flags change) and
 * run SEARCH, or read parts of messages with BODY.PEEK (which never marks them
 * read). Used to notice replies and bounces, and to quote a reply to the founders.
 */
export type ImapStream = SmtpStream;
export type ImapAuth = { username: string; password: string };
export type ImapMailbox = { name: string; flags: string[] };
/** One FETCH result: the message UID and each returned section, e.g. "HEADER" or "TEXT". */
export type ImapFetched = { uid: number; sections: Record<string, string> };
export type ImapSession = {
  listMailboxes(): Promise<ImapMailbox[]>;
  examine(mailbox: string): Promise<void>;
  search(criteria: string): Promise<number[]>;
  /** SEARCH that returns UIDs, which stay valid for the whole session. */
  uidSearch(criteria: string): Promise<number[]>;
  /** UID FETCH of `items` (BODY.PEEK sections only, so nothing is marked read). */
  uidFetch(uids: number[], items: string): Promise<ImapFetched[]>;
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

function searchHits(lines: string[]): number[] {
  return lines.flatMap((line) => line.startsWith("* SEARCH")
    ? line.slice("* SEARCH".length).trim().split(/\s+/).filter(Boolean).map(Number)
    : []);
}

/** `* 12 FETCH (UID 345 BODY[HEADER.FIELDS (FROM)] "From: ...")` -> { uid: 345, sections: { HEADER: "From: ..." } }. */
function fetchResult(line: string): ImapFetched[] {
  if (!/^\* \d+ FETCH \(/.test(line)) return [];
  const sections: Record<string, string> = {};
  const rest = line.replace(/BODY\[([^\]]*)\](?:<\d+>)? ("(?:[^"\\]|\\.)*"|NIL)/g, (_match, name: string, value: string) => {
    sections[name.toUpperCase().startsWith("HEADER") ? "HEADER" : name.toUpperCase()] = unquote(value);
    return "";
  });
  const uid = /\bUID (\d+)/.exec(rest);
  return uid ? [{ uid: Number(uid[1]), sections }] : [];
}

export async function openImap(stream: ImapStream, auth: ImapAuth): Promise<ImapSession> {
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  const decoder = new TextDecoder();
  // Raw bytes: a {n} literal counts bytes, so accented text in a message must not shift it.
  let buffer = new Uint8Array(0);
  let tags = 0;

  async function fill() {
    const { value, done } = await reader.read();
    if (done) throw new Error("IMAP connection closed");
    const next = new Uint8Array(buffer.length + value.length);
    next.set(buffer);
    next.set(value, buffer.length);
    buffer = next;
  }

  function lineEnd() {
    for (let index = 0; index + 1 < buffer.length; index += 1) {
      if (buffer[index] === 13 && buffer[index + 1] === 10) return index;
    }
    return -1;
  }

  /** One response line. A {n} literal is folded back into the line as a quoted string. */
  async function readLine(): Promise<string> {
    for (;;) {
      const newline = lineEnd();
      if (newline < 0) { await fill(); continue; }
      const line = decoder.decode(buffer.subarray(0, newline));
      buffer = buffer.subarray(newline + 2);
      const literal = /\{(\d+)\}$/.exec(line);
      if (!literal) return line;
      const size = Number(literal[1]);
      while (buffer.length < size) await fill();
      const content = decoder.decode(buffer.subarray(0, size));
      buffer = buffer.subarray(size);
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
      return searchHits(await command(`SEARCH ${criteria}`));
    },
    async uidSearch(criteria) {
      if (/[\r\n]/.test(criteria)) throw new Error("IMAP search contains a line break");
      return searchHits(await command(`UID SEARCH ${criteria}`));
    },
    async uidFetch(uids, items) {
      const tokens = items.replace(/\[[^\]]*\](?:<[\d.]+>)?/g, "").trim().split(/\s+/);
      if (/[\r\n]/.test(items) || !tokens.every((token) => token === "BODY.PEEK")) throw new Error("IMAP fetch must read with BODY.PEEK");
      const fetched: ImapFetched[] = [];
      for (let start = 0; start < uids.length; start += 200) {
        const set = uids.slice(start, start + 200).filter((uid) => Number.isInteger(uid) && uid > 0).join(",");
        if (set) fetched.push(...(await command(`UID FETCH ${set} (UID ${items})`)).flatMap(fetchResult));
      }
      return fetched;
    },
    async close() {
      try { await command("LOGOUT", true); } catch { /* closing anyway */ }
      await stream.close().catch(() => undefined);
    },
  };
}
