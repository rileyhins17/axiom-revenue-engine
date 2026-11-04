import assert from "node:assert/strict";
import test from "node:test";

import { fccMailboxFromImap, FCC_BOUNCE_SEARCH, FCC_NO_REPLY_BOUNCE_SEARCH } from "@/lib/fcc-campaign-sender";
import { imapDate, imapQuote, openImap } from "./imap-client";
import { deliveryReport, fakeServer, gmail, gmailHolding } from "./test-support/fake-gmail";

type Server = ReturnType<typeof fakeServer>;

const openMailbox = async (server: Server) => fccMailboxFromImap(await openImap(server.stream, { username: "aidan@mail.example", password: "pw" }));

/** Runs `run` and returns what it logged through console.warn (each line is a JSON event). */
async function withWarnings<T>(run: () => Promise<T>) {
  const warnings: Array<Record<string, unknown>> = [];
  const warn = console.warn;
  console.warn = (text: string) => { warnings.push(JSON.parse(text) as Record<string, unknown>); };
  try {
    return { result: await run(), warnings };
  } finally {
    console.warn = warn;
  }
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
  const mailbox = await openMailbox(fakeServer(gmailHolding([remoteBlock])));
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
    const mailbox = await openMailbox(fakeServer(gmailHolding([remoteBlock, message])));
    assert.equal(await mailbox.googleWarning("2026-10-29T12:00:00.000Z"), reason);
    await mailbox.close();
  }
});

test("a Gmail block that quotes the recipient's remote server, as a standard delivery report, is a bounce and does not pause", async () => {
  // Oct 29: a Microsoft 365 recipient's spam filter refused one email and the campaign paused after 53 sends.
  const oct29 = deliveryReport({
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)",
    explanation: "Message blocked. Your message to pat@bluepeak.example has been blocked. The response from the remote server was: 550 5.7.1 Message rejected by the recipient's spam filter",
    recipient: "pat@bluepeak.example", action: "failed", status: "5.7.1", diagnostic: "550 5.7.1 Message rejected by the recipient's spam filter",
    originalId: "fcc-v8-c4-1@axiom.example",
  });
  const mailbox = await openMailbox(fakeServer(gmailHolding([oct29])));
  const since = "2026-10-29T12:00:00.000Z";
  assert.equal(await mailbox.googleWarning(since), null, "no pause");
  assert.deepEqual(await mailbox.bouncedAmong(["pat@bluepeak.example"], since, { "pat@bluepeak.example": ["<fcc-v8-c4-1@axiom.example>"] }), ["pat@bluepeak.example"]);
  await mailbox.close();
});

test("the FCC inbox check searches All Mail from a day before the first email, for replies and for bounces", async () => {
  const server = fakeServer(gmail({ 'FROM "@beta.example"': "12", 'BODY "gone@x.example"': "30" }));
  const mailbox = await openMailbox(server);
  assert.equal(await mailbox.hasMessagesFrom(["sam@beta.example", "@beta.example"], "2026-10-26T14:00:03.000Z"), true);
  assert.equal(await mailbox.hasMessagesFrom(["kim@gamma.example"], "2026-10-26T14:00:03.000Z"), false);
  await mailbox.close();
  assert.deepEqual(server.lines.slice(2), [
    'A003 EXAMINE "[Gmail]/All Mail"',
    'A004 SEARCH SINCE 25-Oct-2026 FROM "sam@beta.example"',
    'A005 SEARCH SINCE 25-Oct-2026 FROM "@beta.example"',
    'A006 SEARCH SINCE 25-Oct-2026 FROM "kim@gamma.example"',
    "A007 LOGOUT",
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
  const mailbox = await openMailbox(fakeServer(gmailHolding([purelymailBounce, exchangeBounce, colleagueForward, newsletter])));
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
  const mailbox = await openMailbox(fakeServer(gmailHolding([gmailDelay, exchangeDelay, gmailFailure])));
  const since = "2026-11-03T12:00:00.000Z";
  assert.equal(await mailbox.hasBounceFor("seth@retrying.example", since), false);
  assert.equal(await mailbox.hasBounceFor("kim@slow.example", since), false);
  assert.equal(await mailbox.hasBounceFor("dan@failed.example", since), true);
  assert.deepEqual(await mailbox.bouncedAmong(["seth@retrying.example", "kim@slow.example", "dan@failed.example"], since), ["dan@failed.example"]);
  assert.equal(await mailbox.bounceCount(since), 1);
  await mailbox.close();
});

// Nov 4: notices from any mail provider. Every address and Message-ID here is made up.
const OUR_ID = (contact: string) => `fcc-v8-${contact}-1@axiom.example`;
const SINCE = "2026-11-03T12:00:00.000Z";

test("a standard delivery report from any sender counts, and the Message-ID it quotes finds the right email even when the server rewrote the recipient", async () => {
  // Neither its sender nor its subject is on any list: only the report structure gives it away.
  const relayReport = deliveryReport({
    from: "Mail Administrator <admin@mx.relay.example>", subject: "Message could not be sent",
    explanation: "Your message could not be passed on to the mailbox you wrote to.",
    recipient: "front-desk@alias-host.example", action: "failed", status: "5.1.1", diagnostic: "550 5.1.1 No such mailbox",
    originalId: OUR_ID("c1"), originalTo: "front-desk@alias-host.example",
  });
  const mailbox = await openMailbox(fakeServer(gmailHolding([relayReport])));
  assert.equal(await mailbox.bounceCount(SINCE), 1, "found by its structure alone");
  const ids = { "jay@onechoice.example": [`<${OUR_ID("c1")}>`], "lee@fine.example": [`<${OUR_ID("c9")}>`] };
  assert.deepEqual(await mailbox.bouncedAmong(["jay@onechoice.example", "lee@fine.example"], SINCE, ids), ["jay@onechoice.example"]);
  assert.deepEqual(await mailbox.bouncedAmong(["jay@onechoice.example"], SINCE), [], "without the ID only the address is left, and the notice names the alias");
  assert.equal(await mailbox.hasBounceFor("front-desk@alias-host.example", SINCE), true);
  await mailbox.close();
});

test("a Microsoft 365 'Undeliverable' report counts for the email it quotes and for no other", async () => {
  const ndr = deliveryReport({
    from: "Microsoft Outlook <postmaster@zeta.onmicrosoft.example>", subject: "Undeliverable: Question about Zeta's RMD listing",
    explanation: "Delivery has failed to these recipients or groups: kim@zeta.example. The email address you entered couldn't be found.",
    html: true, recipient: "kim@zeta.example", action: "failed", status: "5.1.10",
    diagnostic: "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup", originalId: OUR_ID("c2"),
  });
  const mailbox = await openMailbox(fakeServer(gmailHolding([ndr])));
  assert.deepEqual(await mailbox.bouncedAmong(["kim@zeta.example"], SINCE, { "kim@zeta.example": [`<${OUR_ID("c2")}>`] }), ["kim@zeta.example"]);
  assert.deepEqual(await mailbox.bouncedAmong(["kim@zeta.example"], SINCE, { "kim@zeta.example": [`<${OUR_ID("c7")}>`] }), [],
    "the notice quotes one of our emails, and it is not the one sent to this address");
  assert.equal(await mailbox.hasBounceFor("kim@zeta.example", SINCE), true);
  await mailbox.close();
});

test("a notice that quotes a founder's own email, not ours, is matched by the address", async () => {
  const manual = deliveryReport({
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)",
    explanation: "Address not found. Your message wasn't delivered to pat@bluepeak.example.",
    recipient: "pat@bluepeak.example", action: "failed", status: "5.1.1", diagnostic: "550 5.1.1 User unknown",
    originalId: "CAFexample123@mail.gmail.example",
  });
  const mailbox = await openMailbox(fakeServer(gmailHolding([manual])));
  assert.deepEqual(await mailbox.bouncedAmong(["pat@bluepeak.example", "dan@c4.example"], SINCE,
    { "pat@bluepeak.example": [`<${OUR_ID("c5")}>`], "dan@c4.example": [`<${OUR_ID("c4")}>`] }), ["pat@bluepeak.example"]);
  await mailbox.close();
});

test("a notice that names one contact but quotes another's email counts for the one it quotes", async () => {
  const report = deliveryReport({
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)",
    explanation: "Your message to dan@c4.example was returned. A copy went to pat@bluepeak.example.",
    recipient: "dan@c4.example", action: "failed", status: "5.1.1", diagnostic: "550 5.1.1 User unknown", originalId: OUR_ID("c4"),
  });
  const mailbox = await openMailbox(fakeServer(gmailHolding([report])));
  assert.deepEqual(await mailbox.bouncedAmong(["dan@c4.example", "pat@bluepeak.example"], SINCE,
    { "dan@c4.example": [`<${OUR_ID("c4")}>`], "pat@bluepeak.example": [`<${OUR_ID("c5")}>`] }), ["dan@c4.example"]);
  await mailbox.close();
});

test("delays, successful delivery reports and automatic replies are never bounces, even from a system address that names the contact", async () => {
  const eximWarning = {
    from: "Mail Delivery System <Mailer-Daemon@mx.slow.example>", subject: "Warning: could not send message for past 4 hours",
    body: "A message that you sent has not yet been delivered to one or more of its recipients after more than 4 hours on the queue.\r\nThe address to which the message has not yet been delivered is:\r\n\r\n  seth@retrying.example\r\n\r\nNo action is required. Delivery will continue to be attempted, and you will be notified if delivery fails permanently.",
  };
  const delayedReport = deliveryReport({
    from: "postmaster@mx.slow.example", subject: "Mail delivery status", explanation: "Still trying.",
    recipient: "kim@slow.example", action: "delayed", status: "4.4.1", diagnostic: "451 4.4.1 Connection timed out", originalId: OUR_ID("c3"),
  });
  const successReport = deliveryReport({
    from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Success)", explanation: "Your message was delivered.",
    recipient: "ana@arrived.example", action: "delivered", status: "2.0.0", diagnostic: "250 2.0.0 OK", originalId: OUR_ID("c6"),
  });
  const outOfOffice = {
    from: "Pat Example <noreply@bluepeak.example>", subject: "Automatic reply: Question about Bluepeak's RMD listing",
    body: "I am out of the office until Monday, Nov 9. Your message to pat@bluepeak.example was received but I cannot answer it yet.",
  };
  const postmasterAuto = {
    from: "postmaster@omega.example", subject: "Auto: Out of office",
    body: "Thank you for writing to sam@omega.example. This mailbox is not monitored until Nov 9.",
  };
  const mailbox = await openMailbox(fakeServer(gmailHolding([eximWarning, delayedReport, successReport, outOfOffice, postmasterAuto])));
  const emails = ["seth@retrying.example", "kim@slow.example", "ana@arrived.example", "pat@bluepeak.example", "sam@omega.example"];
  assert.ok(await mailbox.bounceCount(SINCE) >= 5, "every one of them is found as a candidate; reading them is what drops them");
  assert.deepEqual(await mailbox.bouncedAmong(emails, SINCE), []);
  assert.deepEqual(await mailbox.bouncedAmong(emails, SINCE, Object.fromEntries(emails.map((email, index) => [email, [`<${OUR_ID(`c${index}`)}>`]]))), []);
  for (const email of emails) assert.equal(await mailbox.hasBounceFor(email, SINCE), false, email);
  await mailbox.close();
});

test("a delay followed by the final failure counts once the failure arrives", async () => {
  const delay = deliveryReport({
    from: "postmaster@mx.slow.example", subject: "Mail delivery status", explanation: "Still trying.",
    recipient: "seth@retrying.example", action: "delayed", status: "4.4.1", diagnostic: "451 4.4.1 Connection timed out", originalId: OUR_ID("c8"),
  });
  const failure = deliveryReport({
    from: "postmaster@mx.slow.example", subject: "Mail delivery status", explanation: "Giving up.",
    recipient: "seth@retrying.example", action: "failed", status: "5.4.7", diagnostic: "554 5.4.7 Delivery expired", originalId: OUR_ID("c8"),
  });
  const ids = { "seth@retrying.example": [`<${OUR_ID("c8")}>`] };
  const before = await openMailbox(fakeServer(gmailHolding([delay])));
  assert.deepEqual(await before.bouncedAmong(["seth@retrying.example"], SINCE, ids), []);
  await before.close();
  const after = await openMailbox(fakeServer(gmailHolding([delay, failure])));
  assert.deepEqual(await after.bouncedAmong(["seth@retrying.example"], SINCE, ids), ["seth@retrying.example"]);
  await after.close();
});

test("if Gmail refuses the delivery-report search, the earlier no-reply search takes over and bounces still count", async () => {
  const holding = gmailHolding([purelymailBounce]);
  const server = fakeServer((tag, command) => (/SEARCH/.test(command) && command.includes("HEADER") ? [`${tag} BAD Could not parse command`] : holding(tag, command)));
  const { result, warnings } = await withWarnings(async () => {
    const mailbox = await openMailbox(server);
    const outcome = { count: await mailbox.bounceCount(SINCE), among: await mailbox.bouncedAmong(["jay@onechoice.example"], SINCE) };
    await mailbox.close();
    return outcome;
  });
  assert.deepEqual(result, { count: 1, among: ["jay@onechoice.example"] });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]!.event, "fcc_bounce_search_fallback");
  assert.equal(warnings[0]!.level, 1);
  assert.deepEqual(server.lines.filter((line) => line.includes("SEARCH")), [
    `A004 SEARCH SINCE 3-Nov-2026 ${FCC_BOUNCE_SEARCH}`,
    `A005 SEARCH SINCE 3-Nov-2026 ${FCC_NO_REPLY_BOUNCE_SEARCH}`,
    `A006 UID SEARCH SINCE 3-Nov-2026 ${FCC_NO_REPLY_BOUNCE_SEARCH}`,
  ]);
});

test("if the notices cannot be read, the address search that ran before Nov 4 takes over and sending goes on", async () => {
  // A server that does not know UID SEARCH: the notice scan fails, the address search answers.
  const server = fakeServer(gmail({ 'BODY "gone@x.example"': "30" }));
  const { result, warnings } = await withWarnings(async () => {
    const mailbox = await openMailbox(server);
    const outcome = { yes: await mailbox.hasBounceFor("gone@x.example", "2026-10-26T14:00:03.000Z"), no: await mailbox.hasBounceFor("kept@x.example", "2026-10-26T14:00:03.000Z") };
    await mailbox.close();
    return outcome;
  });
  assert.deepEqual(result, { yes: true, no: false });
  assert.deepEqual(warnings.map((warning) => warning.event), ["fcc_bounce_notice_scan_failed"], "one warning, and the failed scan is not retried");
  assert.deepEqual(server.lines.slice(2), [
    'A003 EXAMINE "[Gmail]/All Mail"',
    `A004 UID SEARCH SINCE 25-Oct-2026 ${FCC_BOUNCE_SEARCH}`,
    `A005 SEARCH SINCE 25-Oct-2026 ${FCC_BOUNCE_SEARCH} BODY "gone@x.example"`,
    `A006 SEARCH SINCE 25-Oct-2026 ${FCC_BOUNCE_SEARCH} BODY "kept@x.example"`,
    "A007 LOGOUT",
  ]);
});

test("if Gmail refused the wider bounce search, the Google-only search takes over and sending goes on", async () => {
  const plain = gmail({ 'OR FROM "mailer-daemon" FROM "postmaster" BODY "gone@x.example"': "30" });
  const server = fakeServer((tag, command) => (command.startsWith("SEARCH") && command.includes("SUBJECT") ? [`${tag} BAD Could not parse command`] : plain(tag, command)));
  const { result, warnings } = await withWarnings(async () => {
    const mailbox = await openMailbox(server);
    const outcome = { yes: await mailbox.hasBounceFor("gone@x.example", "2026-10-26T14:00:03.000Z"), count: await mailbox.bounceCount("2026-10-26T14:00:03.000Z") };
    await mailbox.close();
    return outcome;
  });
  assert.deepEqual(result, { yes: true, count: 0 });
  assert.deepEqual(server.lines.filter((line) => line.includes("SEARCH")), [
    `A004 UID SEARCH SINCE 25-Oct-2026 ${FCC_BOUNCE_SEARCH}`,
    `A005 SEARCH SINCE 25-Oct-2026 ${FCC_BOUNCE_SEARCH} BODY "gone@x.example"`,
    `A006 SEARCH SINCE 25-Oct-2026 ${FCC_NO_REPLY_BOUNCE_SEARCH} BODY "gone@x.example"`,
    'A007 SEARCH SINCE 25-Oct-2026 OR FROM "mailer-daemon" FROM "postmaster" BODY "gone@x.example"',
    'A008 SEARCH SINCE 26-Oct-2026 OR FROM "mailer-daemon" FROM "postmaster"',
  ]);
  assert.deepEqual(warnings.map((warning) => warning.event), ["fcc_bounce_notice_scan_failed", "fcc_bounce_search_fallback", "fcc_bounce_search_fallback"]);
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
