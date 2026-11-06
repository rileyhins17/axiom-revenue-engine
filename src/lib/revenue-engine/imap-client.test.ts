import assert from "node:assert/strict";
import test from "node:test";

import { fccMailboxFromImap, FCC_BOUNCE_SEARCH } from "@/lib/fcc-campaign-sender";
import { imapDate, imapQuote, openImap, type ImapStream } from "./imap-client";

/** A scripted IMAP server: each client line gets the replies `respond` returns. */
function fakeServer(respond: (tag: string, command: string) => string[]) {
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

function gmail(searchResults: Record<string, string>) {
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

test("quotes values safely and formats search dates", () => {
  assert.equal(imapQuote('pa"ss\\word'), '"pa\\"ss\\\\word"');
  assert.throws(() => imapQuote("evil\r\nA2 DELETE INBOX"), /line break/);
  assert.equal(imapDate("2026-10-26T14:00:03.000Z"), "26-Oct-2026");
  assert.equal(imapDate("2026-11-02T00:30:00.000Z"), "2-Nov-2026");
});

test("logs in, finds All Mail read-only, searches, and logs out", async () => {
  const server = fakeServer(gmail({ 'FROM "jane@alpha.example"': "4 9" }));
  const session = await openImap(server.stream, { username: "aidan@mail.example", password: 'abcd efgh"' });
  const boxes = await session.listMailboxes();
  assert.deepEqual(boxes.find((box) => box.flags.includes("\\All")), { flags: ["\\All", "\\HasNoChildren"], name: "[Gmail]/All Mail" });
  await session.examine("[Gmail]/All Mail");
  assert.deepEqual(await session.search('SINCE 25-Oct-2026 FROM "jane@alpha.example"'), [4, 9]);
  assert.deepEqual(await session.search('SINCE 25-Oct-2026 FROM "nobody@x.example"'), []);
  await session.close();
  assert.equal(server.closed(), true);
  assert.deepEqual(server.lines, [
    'A001 LOGIN "aidan@mail.example" "abcd efgh\\""',
    'A002 LIST "" "*"',
    'A003 EXAMINE "[Gmail]/All Mail"',
    'A004 SEARCH SINCE 25-Oct-2026 FROM "jane@alpha.example"',
    'A005 SEARCH SINCE 25-Oct-2026 FROM "nobody@x.example"',
    "A006 LOGOUT",
  ]);
  assert.ok(!server.lines.some((line) => /\b(SELECT|STORE|EXPUNGE|DELETE|COPY|MOVE)\b/.test(line)), "the inbox is only ever read");
});

test("a refused login fails without echoing the password", async () => {
  const server = fakeServer((tag) => [`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)`]);
  await assert.rejects(openImap(server.stream, { username: "aidan@mail.example", password: "secretapppassword" }), (error: Error) => {
    assert.match(error.message, /AUTHENTICATIONFAILED/);
    assert.doesNotMatch(error.message, /secretapppassword/);
    return true;
  });
});

/** A fake Gmail that really evaluates SEARCH criteria (SINCE, FROM, SUBJECT, BODY, NOT, OR) against stored messages. */
function gmailHolding(messages: Array<{ from: string; subject: string; body: string }>) {
  const plain = gmail({});
  return (tag: string, command: string) => {
    if (!command.startsWith("SEARCH ")) return plain(tag, command);
    const tokens = command.slice(7).match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
    const unquote = (token: string) => token.replace(/^"|"$/g, "").replace(/\\(.)/g, "$1").toLowerCase();
    const matches = (message: { from: string; subject: string; body: string }) => {
      const key = (): boolean => {
        const token = tokens.shift();
        if (token === "SINCE") { tokens.shift(); return true; }
        if (token === "NOT") return !key();
        if (token === "OR") { const left = key(); const right = key(); return left || right; }
        const value = unquote(tokens.shift() ?? "");
        if (token === "FROM") return message.from.toLowerCase().includes(value);
        if (token === "SUBJECT") return message.subject.toLowerCase().includes(value);
        if (token === "BODY") return message.body.toLowerCase().includes(value);
        throw new Error(`unexpected search key ${token}`);
      };
      let hit = true;
      while (tokens.length) hit = key() && hit;
      return hit;
    };
    const hits = messages.map((message, index) => ({ message, index })).filter(({ message }) => { tokens.splice(0, tokens.length, ...(command.slice(7).match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [])); return matches(message); }).map(({ index }) => index + 1);
    return [`* SEARCH${hits.length ? ` ${hits.join(" ")}` : ""}`, `${tag} OK SEARCH completed (Success)`];
  };
}

const remoteBlock = {
  from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)",
  body: "Message blocked. Your message to pat@bluepeak.example has been blocked. See technical details below for more information. The response from the remote server was: 550 5.7.1 Message rejected by the recipient's spam filter",
};
const googleBlock = {
  from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)",
  body: "Message blocked. Your message to sam@omega.example has been blocked. See technical details below for more information. The response was: 552-5.7.0 This message was blocked because its content presents a potential security issue.",
};
const googleSpamVerdict = {
  from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)",
  body: "Message blocked. Your message to kim@gamma.example has been blocked. The response from the remote server was: 550-5.7.1 Our system has detected that this message is likely unsolicited mail. To reduce the amount of spam sent to Gmail, this message has been blocked.",
};
const limitReached = {
  from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)",
  body: "Message not delivered. You have reached a limit for sending mail. Your message was not sent.",
};

test("a recipient's own spam filter bouncing one email is a bounce, not a Google warning", async () => {
  const server = fakeServer(gmailHolding([remoteBlock]));
  const mailbox = await fccMailboxFromImap(await openImap(server.stream, { username: "aidan@mail.example", password: "pw" }));
  assert.equal(await mailbox.googleWarning("2026-10-29T12:00:00.000Z"), null);
  assert.equal(await mailbox.bounceCount("2026-10-29T12:00:00.000Z"), 1);
  assert.deepEqual(await mailbox.bouncedAmong(["pat@bluepeak.example", "lee@fine.example"], "2026-10-29T12:00:00.000Z"), ["pat@bluepeak.example"]);
  await mailbox.close();
});

test("Google's own blocks, spam verdicts and sending limits still pause the campaign", async () => {
  for (const [message, reason] of [
    [googleBlock, "Gmail says a message was blocked"],
    [googleSpamVerdict, "Gmail says a message looked like spam"],
    [limitReached, "Gmail says the sending limit was reached"],
  ] as const) {
    const server = fakeServer(gmailHolding([remoteBlock, message]));
    const mailbox = await fccMailboxFromImap(await openImap(server.stream, { username: "aidan@mail.example", password: "pw" }));
    assert.equal(await mailbox.googleWarning("2026-10-29T12:00:00.000Z"), reason);
    await mailbox.close();
  }
});

test("the FCC inbox check searches All Mail from a day before the first email, for replies and for bounces", async () => {
  const server = fakeServer(gmail({ 'FROM "@beta.example"': "12", 'BODY "gone@x.example"': "30" }));
  const mailbox = await fccMailboxFromImap(await openImap(server.stream, { username: "aidan@mail.example", password: "pw" }));
  assert.equal(await mailbox.hasMessagesFrom(["sam@beta.example", "@beta.example"], "2026-10-26T14:00:03.000Z"), true);
  assert.equal(await mailbox.hasMessagesFrom(["kim@gamma.example"], "2026-10-26T14:00:03.000Z"), false);
  assert.equal(await mailbox.hasBounceFor("gone@x.example", "2026-10-26T14:00:03.000Z"), true);
  await mailbox.close();
  assert.deepEqual(server.lines.slice(2), [
    'A003 EXAMINE "[Gmail]/All Mail"',
    'A004 SEARCH SINCE 25-Oct-2026 FROM "sam@beta.example"',
    'A005 SEARCH SINCE 25-Oct-2026 FROM "@beta.example"',
    'A006 SEARCH SINCE 25-Oct-2026 FROM "kim@gamma.example"',
    `A007 SEARCH SINCE 25-Oct-2026 ${FCC_BOUNCE_SEARCH} BODY "gone@x.example"`,
    "A008 LOGOUT",
  ]);
});

// Nov 3: a Purelymail server returned a Nov 6 email from noreply@purelymail.com, not mailer-daemon, and it went unrecorded.
const purelymailBounce = {
  from: "noreply@purelymail.com", subject: "Your message was not accepted",
  body: "Delivery to jay@onechoice.example failed permanently. 550 5.1.1 The mailbox does not exist.",
};
const exchangeBounce = {
  from: "MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@zeta.example", subject: "Undeliverable: Question about Zeta's RMD listing",
  body: "Your message to kim@zeta.example couldn't be delivered. kim wasn't found at zeta.example.",
};
const colleagueForward = {
  from: "lee@fine.example", subject: "Re: Question about Fine's RMD listing",
  body: "Looping in pat@bluepeak.example, who handles our FCC filings.",
};
const newsletter = { from: "noreply@news.example", subject: "This week in telecom", body: "Nothing about anyone we emailed." };

test("a bounce from another mail server counts: a no-reply sender or a bounce subject, naming the address", async () => {
  const server = fakeServer(gmailHolding([purelymailBounce, exchangeBounce, colleagueForward, newsletter]));
  const mailbox = await fccMailboxFromImap(await openImap(server.stream, { username: "aidan@mail.example", password: "pw" }));
  const since = "2026-11-03T12:00:00.000Z";
  assert.equal(await mailbox.hasBounceFor("jay@onechoice.example", since), true);
  assert.equal(await mailbox.hasBounceFor("kim@zeta.example", since), true);
  assert.equal(await mailbox.hasBounceFor("pat@bluepeak.example", since), false, "a colleague's forward names the address but is no bounce");
  assert.deepEqual(await mailbox.bouncedAmong(["jay@onechoice.example", "kim@zeta.example", "pat@bluepeak.example", "lee@fine.example"], since),
    ["jay@onechoice.example", "kim@zeta.example"]);
  // The cheap count may include a no-reply newsletter: it only decides whether today's contacts are looked at again.
  assert.equal(await mailbox.bounceCount(since), 3);
  assert.equal(await mailbox.googleWarning(since), null);
  await mailbox.close();
});

// Nov 4: the morning sweep marked two contacts bounced on Gmail's delay notices, with about a day of retries left.
const gmailDelay = {
  from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Delay)",
  body: "Delivery incomplete. There was a temporary problem delivering your message to seth@retrying.example. Gmail will retry for 46 more hours. You'll be notified if the delivery fails permanently.",
};
const exchangeDelay = {
  from: "postmaster@zeta.example", subject: "Delivery delayed: Question about Zeta's RMD listing",
  body: "Delivery to these recipients has been delayed: kim@slow.example",
};
const gmailFailure = {
  from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)",
  body: "Address not found. Your message wasn't delivered to dan@failed.example because the address couldn't be found. 550 5.1.1",
};

test("a delay notice isn't a bounce, and the final failure still is", async () => {
  const server = fakeServer(gmailHolding([gmailDelay, exchangeDelay, gmailFailure]));
  const mailbox = await fccMailboxFromImap(await openImap(server.stream, { username: "aidan@mail.example", password: "pw" }));
  const since = "2026-11-03T12:00:00.000Z";
  assert.equal(await mailbox.hasBounceFor("seth@retrying.example", since), false);
  assert.equal(await mailbox.hasBounceFor("kim@slow.example", since), false);
  assert.equal(await mailbox.hasBounceFor("dan@failed.example", since), true);
  assert.deepEqual(await mailbox.bouncedAmong(["seth@retrying.example", "kim@slow.example", "dan@failed.example"], since), ["dan@failed.example"]);
  assert.equal(await mailbox.bounceCount(since), 1);
  await mailbox.close();
});

test("if Gmail refused the wider bounce search, the Google-only search takes over and sending goes on", async () => {
  const plain = gmail({ 'OR FROM "mailer-daemon" FROM "postmaster" BODY "gone@x.example"': "30" });
  const server = fakeServer((tag, command) => (command.startsWith("SEARCH") && command.includes("SUBJECT") ? [`${tag} BAD Could not parse command`] : plain(tag, command)));
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (text: string) => { warnings.push(text); };
  try {
    const mailbox = await fccMailboxFromImap(await openImap(server.stream, { username: "aidan@mail.example", password: "pw" }));
    assert.equal(await mailbox.hasBounceFor("gone@x.example", "2026-10-26T14:00:03.000Z"), true);
    assert.equal(await mailbox.bounceCount("2026-10-26T14:00:03.000Z"), 0);
    await mailbox.close();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(server.lines.filter((line) => line.includes("SEARCH")), [
    `A004 SEARCH SINCE 25-Oct-2026 ${FCC_BOUNCE_SEARCH} BODY "gone@x.example"`,
    'A005 SEARCH SINCE 25-Oct-2026 OR FROM "mailer-daemon" FROM "postmaster" BODY "gone@x.example"',
    'A006 SEARCH SINCE 26-Oct-2026 OR FROM "mailer-daemon" FROM "postmaster"',
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /fcc_bounce_search_fallback/);
});

test("UID FETCH reads accented text by its byte length and never marks mail read", async () => {
  const body = "Oui, appelez-moi. Merci — Zoé";
  const size = new TextEncoder().encode(body).length;
  const server = fakeServer((tag, command) => {
    if (command.startsWith("LOGIN")) return [`${tag} OK authenticated`];
    if (command.startsWith("UID SEARCH")) return ["* SEARCH 41 42", `${tag} OK SEARCH completed`];
    if (command.startsWith("UID FETCH")) {
      return [
        `* 7 FETCH (UID 41 BODY[TEXT]<0> {${size}}`, `${body})`,
        `* 8 FETCH (BODY[HEADER.FIELDS ("FROM")] {21}`, `From: a@b.example\r\n\r\n UID 42)`,
        `${tag} OK Success`,
      ];
    }
    if (command === "LOGOUT") return ["* BYE", `${tag} OK bye`];
    return [`${tag} BAD unknown command`];
  });
  const session = await openImap(server.stream, { username: "aidan@example.com", password: "app-password" });
  assert.deepEqual(await session.uidSearch('SINCE 1-Nov-2026 NOT FROM "aidan@example.com"'), [41, 42]);
  const fetched = await session.uidFetch([41, 42], "BODY.PEEK[TEXT]<0.4000>");
  assert.deepEqual(fetched, [
    { uid: 41, sections: { TEXT: body } },
    { uid: 42, sections: { HEADER: "From: a@b.example\r\n\r\n" } },
  ]);
  assert.ok(server.lines.includes("A003 UID FETCH 41,42 (UID BODY.PEEK[TEXT]<0.4000>)"));
  await assert.rejects(session.uidFetch([41], "BODY[TEXT]"), /BODY\.PEEK/);
  await assert.rejects(session.uidFetch([41], "BODY.PEEK[TEXT] RFC822"), /BODY\.PEEK/);
  await session.close();
});
