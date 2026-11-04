import type { ImapStream } from "../imap-client";

/** A scripted IMAP server: each client line gets the replies `respond` returns. */
export function fakeServer(respond: (tag: string, command: string) => string[]) {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let push: (text: string) => void = () => {};
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (text) => controller.enqueue(encoder.encode(text));
      push("* OK Gimap ready\r\n");
    },
  });
  let partial = "";
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      partial += new TextDecoder().decode(chunk);
      for (let index = partial.indexOf("\r\n"); index >= 0; index = partial.indexOf("\r\n")) {
        const line = partial.slice(0, index);
        partial = partial.slice(index + 2);
        lines.push(line);
        const space = line.indexOf(" ");
        for (const reply of respond(line.slice(0, space), line.slice(space + 1))) push(`${reply}\r\n`);
      }
    },
  });
  let closed = false;
  const stream: ImapStream = { readable, writable, close: async () => { closed = true; } };
  return { stream, lines, closed: () => closed };
}

export function gmail(searchResults: Record<string, string>) {
  return (tag: string, command: string) => {
    if (command.startsWith("LOGIN")) return [`${tag} OK aidan authenticated (Success)`];
    if (command.startsWith("LIST")) {
      return [
        '* LIST (\\HasNoChildren) "/" "INBOX"',
        '* LIST (\\HasChildren \\Noselect) "/" "[Gmail]"',
        '* LIST (\\All \\HasNoChildren) "/" {16}',
        "[Gmail]/All Mail",
        '* LIST (\\HasNoChildren \\Sent) "/" "[Gmail]/Sent Mail"',
        `${tag} OK Success`,
      ];
    }
    if (command.startsWith("EXAMINE")) return ["* 120 EXISTS", "* OK [READ-ONLY] opened", `${tag} OK [READ-ONLY] [Gmail]/All Mail selected. (Success)`];
    if (command.startsWith("SEARCH")) {
      const hit = Object.entries(searchResults).find(([needle]) => command.includes(needle));
      return [`* SEARCH${hit ? ` ${hit[1]}` : ""}`, `${tag} OK SEARCH completed (Success)`];
    }
    if (command === "LOGOUT") return ["* BYE LOGOUT Requested", `${tag} OK 73 good day (Success)`];
    return [`${tag} BAD unknown command`];
  };
}

/** A message in the fake inbox. `body` is everything after the header block; `contentType` is the top-level Content-Type. */
export type HeldMessage = { from: string; subject: string; body: string; contentType?: string };

/** UIDs in the fake inbox start here, so a test that mixes them up with sequence numbers (1, 2, 3...) fails. */
export const FIRST_UID = 100;

function evaluate(criteria: string, message: HeldMessage): boolean {
  const tokens = criteria.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
  const unquote = (token: string) => token.replace(/^"|"$/g, "").replace(/\\(.)/g, "$1").toLowerCase();
  const key = (): boolean => {
    const token = tokens.shift();
    if (token === "SINCE") { tokens.shift(); return true; }
    if (token === "NOT") return !key();
    if (token === "OR") { const left = key(); const right = key(); return left || right; }
    if (token === "HEADER") {
      const field = unquote(tokens.shift() ?? "");
      const value = unquote(tokens.shift() ?? "");
      if (field !== "content-type") throw new Error(`unexpected header search ${field}`);
      return (message.contentType ?? "text/plain").toLowerCase().includes(value);
    }
    const value = unquote(tokens.shift() ?? "");
    if (token === "FROM") return message.from.toLowerCase().includes(value);
    if (token === "SUBJECT") return message.subject.toLowerCase().includes(value);
    if (token === "BODY") return message.body.toLowerCase().includes(value);
    throw new Error(`unexpected search key ${token}`);
  };
  let hit = true;
  while (tokens.length) hit = key() && hit;
  return hit;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * A fake Gmail that really evaluates SEARCH and UID SEARCH criteria (SINCE, FROM, SUBJECT, BODY, HEADER Content-Type,
 * NOT, OR) against stored messages, and answers UID FETCH with the header block and the start of the body.
 */
export function gmailHolding(messages: HeldMessage[]) {
  const plain = gmail({});
  const hits = (criteria: string) => messages.flatMap((message, index) => (evaluate(criteria, message) ? [index] : []));
  return (tag: string, command: string) => {
    if (command.startsWith("SEARCH ")) {
      const found = hits(command.slice(7)).map((index) => index + 1);
      return [`* SEARCH${found.length ? ` ${found.join(" ")}` : ""}`, `${tag} OK SEARCH completed (Success)`];
    }
    if (command.startsWith("UID SEARCH ")) {
      const found = hits(command.slice(11)).map((index) => index + FIRST_UID);
      return [`* SEARCH${found.length ? ` ${found.join(" ")}` : ""}`, `${tag} OK SEARCH completed (Success)`];
    }
    const fetch = /^UID FETCH (\S+) \(UID (.+)\)$/.exec(command);
    if (fetch) {
      const replies: string[] = [];
      for (const uid of fetch[1]!.split(",").map(Number)) {
        const message = messages[uid - FIRST_UID];
        if (!message) continue;
        const head = `From: ${message.from}\r\nSubject: ${message.subject}\r\n${message.contentType ? `Content-Type: ${message.contentType}\r\n` : ""}\r\n`;
        const text = message.body.slice(0, 24_000);
        replies.push(
          `* ${uid - FIRST_UID + 1} FETCH (UID ${uid} BODY[HEADER.FIELDS (FROM SUBJECT CONTENT-TYPE CONTENT-TRANSFER-ENCODING X-AUTOREPLY)] {${byteLength(head)}}`,
          `${head} BODY[TEXT]<0> {${byteLength(text)}}`,
          `${text})`,
        );
      }
      return [...replies, `${tag} OK Success`];
    }
    return plain(tag, command);
  };
}

/**
 * A standard delivery report (RFC 3464): a readable part, the machine-readable delivery-status part, and the quoted
 * original. Everything is made up: the sender, the recipients and the Message-ID are not real.
 */
export function deliveryReport(options: {
  from: string;
  subject: string;
  /** The readable explanation, as plain text (or as quoted-printable HTML when `html` is set). */
  explanation: string;
  html?: boolean;
  recipient: string;
  action: "failed" | "delayed" | "delivered" | "relayed";
  status: string;
  diagnostic: string;
  /** The Message-ID of the email this report is about, without angle brackets. Leave out for a report that quotes none. */
  originalId?: string;
  /** The To header of the quoted original. Defaults to `recipient`. */
  originalTo?: string;
}): HeldMessage {
  const boundary = "report-boundary-1";
  const human = options.html
    ? `Content-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<html><body><p>${options.explanation}</p></body></html>`
    : `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${options.explanation}`;
  const quoted = options.originalId
    ? `Content-Type: message/rfc822\r\n\r\nMessage-ID: <${options.originalId}>\r\nFrom: Aidan Magee <aidan@mail.example>\r\nTo: ${options.originalTo ?? options.recipient}\r\nSubject: Question about a listing\r\n\r\nHello, a short question about your filing.`
    : "Content-Type: text/rfc822-headers\r\n\r\nFrom: Aidan Magee <aidan@mail.example>\r\nSubject: Question about a listing";
  return {
    from: options.from,
    subject: options.subject,
    contentType: `multipart/report; report-type=delivery-status; boundary="${boundary}"`,
    body: [
      "This is a MIME-encapsulated message.", "",
      `--${boundary}`, human, "",
      `--${boundary}`, "Content-Type: message/delivery-status", "",
      "Reporting-MTA: dns; mx.relay.example", "",
      `Final-Recipient: rfc822; ${options.recipient}`, `Action: ${options.action}`, `Status: ${options.status}`, `Diagnostic-Code: smtp; ${options.diagnostic}`, "",
      `--${boundary}`, quoted, "",
      `--${boundary}--`, "",
    ].join("\r\n"),
  };
}
