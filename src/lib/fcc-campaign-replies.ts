/**
 * The daily FCC reply check (Riley, Nov 1). Once a day from 9:00 Toronto, weekends
 * included, it reads the sending inbox (read-only), finds anything an emailed
 * contact or a colleague at their company wrote back, emails both founders who
 * replied and what they said, and stops that person's follow-ups.
 *
 * Before this, a reply was only noticed right before that person's follow-up,
 * and never after the follow-up went out.
 *
 * - Every sending inbox is read; each remembers when it was last read, so an inbox
 *   that couldn't be opened one day is read from where it left off the next.
 * - At most one attempt an hour until the day's check succeeds.
 * - The founders' email goes before anything is marked, so a failed email is
 *   retried next hour with the same replies, and nobody is reported twice.
 * - Replies the follow-up check found since the last run are reported too, and
 *   so is new mail from someone a founder already stopped (status unchanged).
 * - Automatic replies (out of office) stop follow-ups, as they always have,
 *   and are labelled as automatic.
 */
import { FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { claimFccReplyCheckTry, readFccReplyCheck, saveFccReplyCheck } from "@/lib/fcc-campaign-control";
import { SHARED_MAIL_DOMAINS, domainOf, sharedCampaignDomains, torontoDay } from "@/lib/fcc-campaign-sender";
import { torontoMinute } from "@/lib/fcc-campaign-tick";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { imapDate, imapQuote, type ImapSession } from "@/lib/revenue-engine/imap-client";

/** Minutes after midnight, Toronto time, from which the day's check runs. */
export const FCC_REPLY_CHECK_FROM_MINUTE = 9 * 60;
const DAY_MS = 86_400_000;

/** One message as an inbox reports it; the check adds which inbox it came to. */
export type FccInboxMessage = { folder: string; uid: number; from: string; date: string | null; automatic: boolean; inbox?: string };

/** What the reply check needs from the sending inbox. */
export type FccReplyInbox = {
  /** Messages that arrived from `sinceIso`'s day on, except bounces and mail from `notFrom`. */
  messagesSince(sinceIso: string, notFrom: string[]): Promise<FccInboxMessage[]>;
  /** The start of what the message says, without the quoted email under it. */
  replyText(message: FccInboxMessage): Promise<string>;
  close(): Promise<void>;
};

export type FccOwnerMail = { subject: string; text: string; html: string };

export type FccReplyCheckConfig = {
  screenUrl: string;
  /** Every sending inbox that can be read, the first inbox first. */
  inboxes: Array<{ address: string; open: () => Promise<FccReplyInbox> }>;
  /** Emails both founders. Throws when it could not. */
  tellFounders: (mail: FccOwnerMail) => Promise<void>;
};

export type FccReplyCheckResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "RAN"; since: string | null; messages: number; found: number; unreadInboxes: string[] };

type ContactRow = {
  id: string; email: string; firstName: string; company: string; status: string; step1SentAt: string; stoppedReason: string | null; updatedAt: string;
};
type Reply = { contacts: ContactRow[]; message: FccInboxMessage | null; quote: string };

const skip = (reason: string): FccReplyCheckResult => ({ status: "SKIPPED", reason });
const shortDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric" }).format(new Date(iso));
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);

export async function runFccReplyCheck(db: ProspectDb, config: FccReplyCheckConfig, now = new Date()): Promise<FccReplyCheckResult> {
  if (config.inboxes.length === 0) return skip("inbox not configured");
  const minute = torontoMinute(now);
  if (minute < FCC_REPLY_CHECK_FROM_MINUTE) return skip("before 9:00");
  const day = torontoDay(now);
  const last = await readFccReplyCheck(db);
  if (last?.day === day) return skip("already checked today");
  if (!(await claimFccReplyCheckTry(db, `${day} ${Math.floor(minute / 60)}`, now))) return skip("already tried this hour");

  // Everyone still being emailed, anyone the follow-up check stopped since the last run, and anyone a founder stopped.
  const { results: contacts } = await db.prepare(`SELECT "id","email","firstName","company","status","step1SentAt","stoppedReason","updatedAt"
    FROM "FccCampaignContact" WHERE "campaignKey" IN (?, ?) AND "step1SentAt" IS NOT NULL
      AND ("status" IN ('step1_sent','step2_sent','suppressed') OR ("status" = 'replied' AND "updatedAt" > ?))`)
    .bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY, last?.at ?? now.toISOString()).all<ContactRow>();
  if (contacts.length === 0) {
    await saveFccReplyCheck(db, { day, at: now.toISOString(), found: 0, inboxes: last?.inboxes }, now);
    return { status: "RAN", since: null, messages: 0, found: 0, unreadInboxes: [] };
  }
  // Each inbox is read from a day before it was last read, so every message is seen by some run.
  const earliest = contacts.reduce((min, contact) => (contact.step1SentAt < min ? contact.step1SentAt : min), contacts[0]!.step1SentAt);
  const sinceFor = (address: string) => {
    const lastRead = last?.inboxes?.[address] ?? (address === config.inboxes[0]!.address ? last?.at : undefined);
    const overlap = lastRead ? new Date(Date.parse(lastRead) - DAY_MS).toISOString() : earliest;
    return overlap > earliest ? overlap : earliest;
  };

  const opened = new Map<string, FccReplyInbox>();
  const unreadInboxes: string[] = [];
  let firstError: unknown = null;
  for (const { address, open } of config.inboxes) {
    try { opened.set(address, await open()); } catch (error) { unreadInboxes.push(address); firstError ??= error; }
  }
  if (opened.size === 0) throw firstError;
  try {
    const notFrom = config.inboxes.map((inbox) => inbox.address);
    const messages: FccInboxMessage[] = [];
    for (const [address, inbox] of opened) {
      messages.push(...(await inbox.messagesSince(sinceFor(address), notFrom)).map((message) => ({ ...message, inbox: address })));
    }
    const since = [...opened.keys()].map(sinceFor).sort()[0]!;
    const shared = await sharedCampaignDomains(db);
    const byEmail = new Map<string, ContactRow[]>();
    const byDomain = new Map<string, ContactRow[]>();
    const add = (map: Map<string, ContactRow[]>, key: string, contact: ContactRow) => map.set(key, [...(map.get(key) ?? []), contact]);
    for (const contact of contacts) {
      add(byEmail, contact.email.toLowerCase(), contact);
      const domain = domainOf(contact.email);
      if (!SHARED_MAIL_DOMAINS.has(domain) && !shared.has(domain)) add(byDomain, domain, contact);
    }

    // Each contact's first message after their first email; a person's reply wins over an automatic one.
    const firstMessage = new Map<string, FccInboxMessage>();
    const time = (message: FccInboxMessage) => (message.date ? Date.parse(message.date) : 0);
    for (const message of [...messages].sort((a, b) => time(a) - time(b))) {
      const from = message.from.toLowerCase();
      for (const contact of new Set([...(byEmail.get(from) ?? []), ...(byDomain.get(domainOf(from)) ?? [])])) {
        if (message.date && time(message) < Date.parse(contact.step1SentAt) - DAY_MS) continue;
        // Someone already stopped: only mail that is new since they were stopped and since the last run.
        if (contact.status === "suppressed" && (!message.date || time(message) <= Math.max(Date.parse(contact.updatedAt), last ? Date.parse(last.at) : 0))) continue;
        const seen = firstMessage.get(contact.id);
        if (!seen || (seen.automatic && !message.automatic)) firstMessage.set(contact.id, message);
      }
    }

    // One entry per message, so two people at one company who wrote once are reported once.
    const replies = new Map<string, Reply>();
    for (const contact of contacts) {
      const message = firstMessage.get(contact.id) ?? null;
      if (!message && contact.status !== "replied") continue;
      const key = message ? `${message.inbox}:${message.folder}:${message.uid}` : `contact:${contact.id}`;
      const reply = replies.get(key) ?? { contacts: [], message, quote: "" };
      reply.contacts.push(contact);
      replies.set(key, reply);
    }
    for (const reply of replies.values()) {
      const inbox = reply.message ? opened.get(reply.message.inbox ?? "") : undefined;
      if (reply.message && inbox) reply.quote = await inbox.replyText(reply.message).catch(() => "");
    }

    const found = [...replies.values()];
    if (found.length > 0) await config.tellFounders(founderMail(found, config));
    const at = now.toISOString();
    for (const reply of found) {
      if (!reply.message) continue;
      const reason = stoppedReason(reply);
      for (const contact of reply.contacts.filter((row) => row.status === "step1_sent" || row.status === "step2_sent")) {
        await db.prepare(`UPDATE "FccCampaignContact" SET "status" = 'replied', "stoppedReason" = ?, "updatedAt" = ?
          WHERE "id" = ? AND "status" IN ('step1_sent','step2_sent')`).bind(reason, at, contact.id).run();
      }
    }
    const inboxes = { ...(last?.inboxes ?? {}), ...Object.fromEntries([...opened.keys()].map((address) => [address, at])) };
    await saveFccReplyCheck(db, { day, at, found: found.length, inboxes }, now);
    return { status: "RAN", since, messages: messages.length, found: found.length, unreadInboxes };
  } finally {
    for (const inbox of opened.values()) await inbox.close().catch(() => undefined);
  }
}

function stoppedReason(reply: Reply) {
  const message = reply.message!;
  const who = reply.contacts.some((contact) => contact.email.toLowerCase() === message.from.toLowerCase()) ? "They" : `A colleague (${message.from})`;
  const what = message.automatic ? `${who} sent an automatic reply` : `${who} wrote back`;
  const when = message.date ? ` ${shortDay(message.date)}` : "";
  return `${what}${when}, so no more emails${reply.quote ? `: "${reply.quote}"` : ""}`.slice(0, 300);
}

function founderMail(replies: Reply[], config: FccReplyCheckConfig): FccOwnerMail {
  const count = replies.length === 1 ? "1 new reply" : `${replies.length} new replies`;
  const entries = replies.map((reply, index) => {
    const contact = reply.contacts[0]!;
    const message = reply.message;
    const from = message?.from ?? contact.email;
    const when = message?.date ? `, ${shortDay(message.date)}` : "";
    const kind = `${message?.automatic ? " (automatic reply)" : ""}${reply.contacts.every((row) => row.status === "suppressed") ? " (we had already stopped emailing them)" : ""}`;
    const quote = reply.quote || (message ? "(Open the email in Gmail to read it.)" : "(Found before a follow-up. Open Gmail to read it.)");
    const where = message?.inbox ? ` · came to ${message.inbox}` : "";
    return { title: `${index + 1}. ${contact.company} (${from})${when}${kind}${where}`, quote };
  });
  const text = [
    `The daily inbox check found ${count} to the FCC emails.`,
    "",
    ...entries.flatMap((entry) => [entry.title, `   ${entry.quote.startsWith("(") ? entry.quote : `"${entry.quote}"`}`, ""]),
    `No more emails go to ${replies.length === 1 ? "this person" : "these people"}. Answer each one from the inbox it came to.`,
    `Every reply is on the FCC screen: ${config.screenUrl}`,
  ].join("\n");
  const html = [
    `<p>The daily inbox check found <strong>${count}</strong> to the FCC emails.</p>`,
    ...entries.map((entry) => `<p><strong>${escapeHtml(entry.title)}</strong><br>${escapeHtml(entry.quote)}</p>`),
    `<p>No more emails go to ${replies.length === 1 ? "this person" : "these people"}. Answer each one from the inbox it came to.</p>`,
    `<p><a href="${escapeHtml(config.screenUrl)}">Every reply is on the FCC screen</a></p>`,
  ].join("\n");
  return { subject: `FCC: ${count}`, text, html };
}

/** A header's value from a raw header block (folded lines joined), or "". */
export function headerValue(headers: string, name: string) {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const line = unfolded.split(/\r?\n/).find((row) => row.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(name.length + 1).trim() : "";
}

/** The email address in a From header. */
export function senderAddress(from: string) {
  const match = /<([^<>\s]+@[^<>\s]+)>/.exec(from) ?? /([^\s<>"',;]+@[^\s<>"',;]+)/.exec(from);
  return match ? match[1]!.toLowerCase() : "";
}

/** Out-of-office and other machine replies. */
export function isAutomaticReply(headers: string) {
  const autoSubmitted = headerValue(headers, "auto-submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (headerValue(headers, "x-autoreply")) return true;
  return /^(automatic reply|auto(matic)?[- ]?reply|autoreply|out of (the )?office|auto:)/i.test(headerValue(headers, "subject"));
}

function bytesToText(bytes: number[]) {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function decodeTransfer(encoding: string, body: string) {
  if (/quoted-printable/i.test(encoding)) {
    const flat = body.replace(/=\r?\n/g, "");
    const bytes: number[] = [];
    for (let index = 0; index < flat.length; index += 1) {
      const hex = flat[index] === "=" ? /^[0-9A-Fa-f]{2}/.exec(flat.slice(index + 1, index + 3)) : null;
      if (hex) { bytes.push(parseInt(hex[0], 16)); index += 2; } else bytes.push(flat.charCodeAt(index) & 0xff);
    }
    return bytesToText(bytes);
  }
  if (/base64/i.test(encoding)) {
    const clean = body.replace(/[^A-Za-z0-9+/]/g, "");
    try {
      return bytesToText([...atob(clean.slice(0, clean.length - (clean.length % 4)))].map((char) => char.charCodeAt(0)));
    } catch {
      return "";
    }
  }
  return body;
}

function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&amp;/gi, "&");
}

/** The readable text of a (possibly cut-off) message body, preferring its plain-text part. */
function plainText(contentType: string, encoding: string, body: string, depth = 0): string {
  const boundary = /boundary="?([^";\s]+)"?/i.exec(contentType)?.[1];
  if (/^multipart\//i.test(contentType) && boundary && depth < 3) {
    const parts = body.split(`--${boundary}`).slice(1).filter((part) => !part.startsWith("--")).map((part) => {
      const text = part.replace(/^\r?\n/, "");
      const split = /\r?\n\r?\n/.exec(text);
      const headers = split ? text.slice(0, split.index) : "";
      return { headers, body: split ? text.slice(split.index + split[0].length) : text, type: headerValue(headers, "content-type") || "text/plain" };
    });
    const pick = parts.find((part) => /^text\/plain/i.test(part.type))
      ?? parts.find((part) => /^multipart\//i.test(part.type))
      ?? parts.find((part) => /^text\/html/i.test(part.type));
    return pick ? plainText(pick.type, headerValue(pick.headers, "content-transfer-encoding"), pick.body, depth + 1) : "";
  }
  const text = decodeTransfer(encoding, body);
  return /^text\/html/i.test(contentType) ? htmlToText(text) : text;
}

/** What someone wrote, without their quote of our email: about two lines, for the founders' email and the FCC screen. */
export function replyQuote(headers: string, body: string, max = 240) {
  const text = plainText(headerValue(headers, "content-type") || "text/plain", headerValue(headers, "content-transfer-encoding"), body);
  const kept: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith(">")) continue;
    if (/^(-{2,}\s*(original message|forwarded message)|_{8,}|-- ?$|from: |sent from my )/i.test(line)) break;
    kept.push(line);
  }
  const joined = kept.join(" ").replace(/\s+/g, " ")
    .replace(/\s*\bOn (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d)[\s\S]{0,200}?wrote:[\s\S]*$/, "")
    .trim();
  return joined.length > max ? `${joined.slice(0, max - 1).trimEnd()}…` : joined;
}

/** The reply check's view of a logged-in IMAP session: All Mail and Spam, read-only. */
export async function fccReplyInboxFromImap(session: ImapSession): Promise<FccReplyInbox> {
  const boxes = await session.listMailboxes();
  const withFlag = (flag: string) => boxes.find((box) => box.flags.some((value) => value.toLowerCase() === flag))?.name;
  const folders = [withFlag("\\all") ?? "INBOX", withFlag("\\junk")].filter((name): name is string => Boolean(name));
  let open = "";
  const examine = async (folder: string) => {
    if (open === folder) return;
    await session.examine(folder);
    open = folder;
  };
  return {
    async messagesSince(sinceIso, notFrom) {
      const exclude = [...notFrom, "mailer-daemon", "postmaster"].map((from) => `NOT FROM ${imapQuote(from)}`).join(" ");
      const found: FccInboxMessage[] = [];
      for (const folder of folders) {
        await examine(folder);
        const uids = await session.uidSearch(`SINCE ${imapDate(sinceIso)} ${exclude}`);
        for (const item of await session.uidFetch(uids, "BODY.PEEK[HEADER.FIELDS (FROM DATE SUBJECT AUTO-SUBMITTED X-AUTOREPLY)]")) {
          const headers = item.sections.HEADER ?? "";
          const from = senderAddress(headerValue(headers, "from"));
          const date = Date.parse(headerValue(headers, "date"));
          if (from) found.push({ folder, uid: item.uid, from, date: Number.isNaN(date) ? null : new Date(date).toISOString(), automatic: isAutomaticReply(headers) });
        }
      }
      return found;
    },
    async replyText(message) {
      await examine(message.folder);
      const [item] = await session.uidFetch([message.uid], "BODY.PEEK[HEADER.FIELDS (CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.4000>");
      return item ? replyQuote(item.sections.HEADER ?? "", item.sections.TEXT ?? "") : "";
    },
    close: () => session.close(),
  };
}
