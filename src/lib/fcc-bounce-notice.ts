/**
 * Reads one failure notice that a mail server sent back to the sending inbox and says whether it is a
 * permanent bounce, and which sent email it is about. Pure text in, plain data out: no inbox, no database.
 *
 * Why this exists (Nov 4): the inbox check used to decide "bounce" from who wrote the message (mailer-daemon,
 * postmaster, a no-reply address) and whether the contact's address appeared in it. That missed a notice from
 * an ordinary-looking sender, counted a delay or an automatic reply as a bounce when it came from a system
 * address, and could not follow a recipient the server had rewritten. Reading the notice itself fixes all three:
 *
 * - A standard delivery report (multipart/report; report-type=delivery-status) is a bounce when a recipient's
 *   Action is "failed" (or its Status starts with 5), whoever sent it and whatever its subject says.
 *   "delayed", "delivered", "relayed" and "expanded" are not bounces.
 * - A plain-text notice has no machine-readable part, so it needs a system-looking sender or a failure subject,
 *   and then a 5.x.x status or failure wording. A 4.x.x status, "will retry" and the like mean it is only a delay.
 *   An out-of-office or other automatic reply is never a bounce.
 * - The Message-ID of the original email, quoted in the notice, says which send it is about. The address is
 *   only the fallback for a notice that quotes none of ours (see noticeIsFor).
 *
 * Notices are data, not instructions: nothing here follows a link or acts on what a notice says.
 */

export type FccBounceNotice = {
  /** Message-IDs the notice quotes from the original email, lowercase, without the angle brackets. */
  messageIds: string[];
  /** Every email address the notice names (failed recipient, quoted To, anything in the text), lowercase. */
  addresses: string[];
  /** The failure status the notice gives, such as "5.1.1", or null when it gives none. */
  status: string | null;
};

/** What the inbox check asks the server for on each candidate notice: the few headers that matter, and the start of the body. */
export const FCC_NOTICE_FETCH =
  "BODY.PEEK[HEADER.FIELDS (FROM SUBJECT CONTENT-TYPE CONTENT-TRANSFER-ENCODING X-AUTOREPLY)] BODY.PEEK[TEXT]<0.24000>";

/** Our own Message-IDs all start with this (`<fcc-<contact>-<step>@domain>`). */
const OUR_MESSAGE_ID = /^fcc-/i;

type Headers = Map<string, string>;

function parseHeaders(block: string): Headers {
  const headers: Headers = new Map();
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}

/** A message or MIME part split into its header block and its body at the first blank line. */
function splitHead(raw: string): { head: string; body: string } {
  if (/^\r?\n/.test(raw)) return { head: "", body: raw.replace(/^\r?\n/, "") };
  const blank = /\r?\n\r?\n/.exec(raw);
  return blank ? { head: raw.slice(0, blank.index), body: raw.slice(blank.index + blank[0].length) } : { head: raw, body: "" };
}

function param(value: string | undefined, name: string) {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(value ?? "");
  return match ? (match[1] ?? match[2] ?? "") : "";
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function decodeBody(encoding: string, body: string): string {
  const kind = encoding.trim().toLowerCase();
  if (kind === "base64") {
    const clean = body.replace(/[^A-Za-z0-9+/=]/g, "");
    // The body read may stop mid-way, so keep whole groups of four only.
    const whole = clean.slice(0, clean.length - (clean.length % 4));
    try {
      return new TextDecoder().decode(Uint8Array.from(atob(whole), (char) => char.charCodeAt(0)));
    } catch {
      return "";
    }
  }
  if (kind === "quoted-printable") {
    const flat = body.replace(/=\r?\n/g, "");
    const encoder = new TextEncoder();
    const bytes: number[] = [];
    for (let index = 0; index < flat.length; index += 1) {
      const hex = flat[index] === "=" ? /^[0-9A-Fa-f]{2}/.exec(flat.slice(index + 1, index + 3)) : null;
      if (hex) {
        bytes.push(parseInt(hex[0], 16));
        index += 2;
      } else {
        bytes.push(...encoder.encode(flat[index]!));
      }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
  return body;
}

function htmlText(html: string) {
  return html.replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&");
}

type Walked = {
  /** The readable text of every text or message part. */
  texts: string[];
  /** One entry per recipient in a message/delivery-status part. */
  blocks: Headers[];
};

/** Per-recipient field groups of a message/delivery-status part (Final-Recipient, Action, Status, ...). */
function recipientBlocks(text: string): Headers[] {
  return text.split(/\r?\n[ \t]*\r?\n/).map(parseHeaders).filter((block) => block.has("final-recipient") || block.has("action"));
}

function walk(headers: Headers, body: string, depth: number, out: Walked) {
  const contentType = headers.get("content-type") ?? "text/plain";
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  const boundary = type.startsWith("multipart/") && depth < 4 ? param(contentType, "boundary") : "";
  if (boundary) {
    const marker = new RegExp(`^--${escapeRegex(boundary)}(?:--)?[ \\t]*\\r?$`, "m");
    // The first chunk is the preamble; the closing marker leaves an empty chunk after it.
    for (const chunk of body.split(marker).slice(1)) {
      if (!chunk.trim()) continue;
      const part = splitHead(chunk.replace(/^\r?\n/, ""));
      walk(parseHeaders(part.head), part.body, depth + 1, out);
    }
    return;
  }
  if (!type.startsWith("text/") && !type.startsWith("message/")) return;
  const text = decodeBody(headers.get("content-transfer-encoding") ?? "", body);
  if (type === "message/delivery-status") out.blocks.push(...recipientBlocks(text));
  else out.texts.push(type === "text/html" ? htmlText(text) : text);
}

const ADDRESS = /[a-z0-9][a-z0-9._%+'-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const QUOTED_MESSAGE_ID = /^message-id:\s*<([^>\s]+)>/gim;

const unique = (values: string[]) => [...new Set(values)];

/** The first status of the form 5.1.1 (or 4.x.x), not part of a longer dotted number such as an IP address. */
const statusPattern = (digit: "4" | "5") => new RegExp(`(?<![\\d.])${digit}\\.\\d{1,3}\\.\\d{1,3}(?![\\d]|\\.\\d)`);

const SYSTEM_SENDER = /^(?:mailer-?daemon|mail-?daemon|postmaster|mail-?delivery|no[-_]?reply|do[-_]?not[-_]?reply|bounces?)\b/i;
const SYSTEM_NAME = /mail delivery|mailer-daemon|postmaster|mail administrator|mail system|delivery (?:status|system)|undeliverable/i;
const FAILURE_SUBJECT = /undeliver|delivery status notification \(failure\)|delivery (?:failure|has failed|failed)|mail delivery failed|returned (?:mail|to sender)|failure notice|not delivered|could not be delivered|mail system error|not accepted/i;
const DELAY_SUBJECT = /\(delay\)|^\s*(?:warning\b|delayed\b|delivery (?:is )?delay|mail delivery delay)|being retried|could not send message for/i;
const AUTO_REPLY_SUBJECT = /^\s*(?:re:\s*)?(?:automatic reply|auto(?:matic)?[- ]?reply|autoreply|out of (?:the )?office|auto:|vacation)/i;
const DELAY_WORDS = /will retry|retry(?:ing)? (?:for|until|delivery)|has not (?:yet )?been delivered|hasn'?t been delivered yet|temporary (?:problem|failure|error)|still trying|delivery (?:is )?(?:incomplete|delayed)|being retried/i;
const FAILURE_WORDS = /undeliverable|undelivered|delivery (?:has )?failed|failed permanently|could not be delivered|couldn'?t be delivered|wasn'?t delivered|was not delivered|not delivered|returned to sender|returned mail|no such (?:user|mailbox|recipient)|user unknown|(?:mailbox|address|recipient) (?:does not exist|doesn'?t exist|not found|couldn'?t be found|was not found|unavailable|rejected)|not accepted|message (?:was )?rejected|permanent (?:error|failure)/i;

function senderAddress(from: string) {
  const match = /<([^<>\s]+@[^<>\s]+)>/.exec(from) ?? /([^\s<>"',;]+@[^\s<>"',;]+)/.exec(from);
  return match ? match[1]!.toLowerCase() : "";
}

/** A delivery report's verdict for one recipient: true for a permanent failure, false for anything else. */
function recipientFailed(block: Headers) {
  const action = (block.get("action") ?? "").trim().toLowerCase();
  if (action) return action === "failed";
  return /^\s*5\./.test(block.get("status") ?? "");
}

/**
 * `headers` is the raw FROM/SUBJECT/CONTENT-TYPE/... block and `body` the start of the message text, as
 * the inbox check fetches them (FCC_NOTICE_FETCH). Returns null for anything that is not a permanent bounce:
 * a delay, a successful delivery report, an automatic reply, or ordinary mail.
 */
export function readBounceNotice(headers: string, body: string): FccBounceNotice | null {
  const top = parseHeaders(headers);
  const subject = top.get("subject") ?? "";
  const from = top.get("from") ?? "";
  const contentType = top.get("content-type") ?? "";
  const walked: Walked = { texts: [], blocks: [] };
  walk(top, body, 0, walked);
  const text = walked.texts.join("\n");

  let status: string | null = null;
  const failed = walked.blocks.filter(recipientFailed);
  if (walked.blocks.length > 0) {
    // A machine-readable report decides on its own.
    if (failed.length === 0) return null;
    status = /\d\.\d{1,3}\.\d{1,3}/.exec(failed.map((block) => block.get("status") ?? "").join(" "))?.[0] ?? null;
  } else {
    // Plain words only: read them with care.
    if (top.has("x-autoreply") || AUTO_REPLY_SUBJECT.test(subject)) return null;
    const isReport = /multipart\/report/i.test(contentType) && /report-type\s*=\s*"?delivery-status/i.test(contentType);
    const local = senderAddress(from).split("@")[0] ?? "";
    const systemLike = isReport || SYSTEM_SENDER.test(local) || SYSTEM_NAME.test(from.replace(/<[^>]*>/g, "")) || FAILURE_SUBJECT.test(subject);
    if (!systemLike || DELAY_SUBJECT.test(subject)) return null;
    const permanent = statusPattern("5").exec(text);
    if (!permanent) {
      if (statusPattern("4").test(text) || DELAY_WORDS.test(text)) return null;
      if (!FAILURE_WORDS.test(`${subject}\n${text}`)) return null;
    }
    status = permanent?.[0] ?? null;
  }

  const recipients = failed.flatMap((block) => [block.get("final-recipient"), block.get("original-recipient")]).filter((value): value is string => Boolean(value));
  // A Message-ID looks like an address (`fcc-v8-c1-1@axiom.example`), so the ID lines are left out of the address search.
  const addressText = text.replace(/^(?:message-id|in-reply-to|references):.*$/gim, "");
  return {
    messageIds: unique([...text.matchAll(QUOTED_MESSAGE_ID)].map((match) => match[1]!.toLowerCase())),
    addresses: unique([...recipients, addressText].flatMap((chunk) => chunk.match(ADDRESS) ?? []).map((address) => address.toLowerCase())),
    status,
  };
}

/** A Message-ID the way notices quote it and the send table stores it, compared without brackets or case. */
export const messageKey = (id: string) => id.trim().replace(/^<|>$/g, "").toLowerCase();

/**
 * Whether `notice` is about the email sent to `email`. A notice that quotes one of our own Message-IDs is matched
 * by that ID alone, so a server that rewrote the recipient is still matched, and a bounce of some other email to
 * the same address is not. `sentMessageIds` are the IDs of the emails sent to `email`; without them, or when the
 * notice quotes none of ours (a plain-text notice, a notice about a founder's own email), the address decides.
 */
export function noticeIsFor(notice: FccBounceNotice, email: string, sentMessageIds?: readonly string[]): boolean {
  const ours = notice.messageIds.filter((id) => OUR_MESSAGE_ID.test(id));
  if (sentMessageIds && ours.length > 0) {
    const sent = new Set(sentMessageIds.map(messageKey));
    return ours.some((id) => sent.has(id));
  }
  return notice.addresses.includes(email.trim().toLowerCase());
}
