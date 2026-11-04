import assert from "node:assert/strict";
import test from "node:test";

import { noticeIsFor, readBounceNotice, type FccBounceNotice } from "@/lib/fcc-bounce-notice";
import { deliveryReport, type HeldMessage } from "@/lib/revenue-engine/test-support/fake-gmail";

// Every address and Message-ID in this file is made up.
const ID = "fcc-v8-c1-1@axiom.example";

/** The way the inbox check hands a message over: the header block it asked for, and the start of the body. */
const read = (message: HeldMessage, extraHeaders = "") =>
  readBounceNotice(`From: ${message.from}\r\nSubject: ${message.subject}\r\n${message.contentType ? `Content-Type: ${message.contentType}\r\n` : ""}${extraHeaders}`, message.body);

const failure = (overrides: Partial<Parameters<typeof deliveryReport>[0]> = {}) => deliveryReport({
  from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)",
  explanation: "Address not found. Your message wasn't delivered to dan@failed.example.",
  recipient: "dan@failed.example", action: "failed", status: "5.1.1", diagnostic: "550 5.1.1 The email account that you tried to reach does not exist.",
  originalId: ID, ...overrides,
});

test("a delivery report with a failed recipient is a bounce: its status, the recipient and the quoted Message-ID come out", () => {
  const notice = read(failure());
  assert.deepEqual(notice, { messageIds: [ID], addresses: ["dan@failed.example", "aidan@mail.example"], status: "5.1.1" });
});

test("a delivery report counts whoever sent it and whatever its subject says; 'delayed', 'delivered' and 'relayed' do not", () => {
  assert.ok(read(failure({ from: "robot <x7@odd-relay.example>", subject: "hello" })));
  for (const action of ["delayed", "delivered", "relayed"] as const) {
    assert.equal(read(failure({ action, status: action === "delayed" ? "4.4.1" : "2.0.0" })), null, action);
  }
  assert.equal(read(failure({ subject: "Delivery Status Notification (Delay)", action: "delayed", status: "4.0.0" })), null);
});

test("with no Action, a 5.x.x status decides and a 4.x.x one does not", () => {
  const withoutAction = (status: string) => {
    const message = failure({ status });
    return { ...message, body: message.body.replace(/^Action: .*\r\n/m, "") };
  };
  assert.ok(read(withoutAction("5.7.1")));
  assert.equal(read(withoutAction("4.7.1")), null);
});

test("a report with one delivered and one failed recipient is a bounce with the failed one's status", () => {
  const message = failure();
  const two = {
    ...message,
    body: message.body.replace("Final-Recipient: rfc822; dan@failed.example", "Final-Recipient: rfc822; ok@fine.example\r\nAction: delivered\r\nStatus: 2.0.0\r\n\r\nFinal-Recipient: rfc822; dan@failed.example"),
  };
  const notice = read(two);
  assert.ok(notice);
  assert.equal(notice.status, "5.1.1");
  assert.ok(notice.addresses.includes("dan@failed.example"));
});

test("encoded parts are read: base64 and quoted-printable, nested inside a mixed message, with a soft line break inside the Message-ID", () => {
  const base64 = (text: string) => Buffer.from(text).toString("base64").replace(/(.{60})/g, "$1\r\n");
  const body = [
    "--outer", "Content-Type: multipart/report; report-type=delivery-status; boundary=inner", "",
    "--inner", "Content-Type: text/plain", "Content-Transfer-Encoding: base64", "", base64("Delivery has failed to kim@zeta.example"), "",
    "--inner", "Content-Type: message/delivery-status", "", "Final-Recipient: rfc822; kim@zeta.example", "Action: failed", "Status: 5.1.10", "",
    "--inner", "Content-Type: text/rfc822-headers", "Content-Transfer-Encoding: quoted-printable", "",
    "Message-ID: <fcc-v8-c2-1@axiom=\r\n.example>", "To: kim@zeta.example", "",
    "--inner--", "", "--outer--", "",
  ].join("\r\n");
  const notice = readBounceNotice("From: Microsoft Outlook <postmaster@zeta.onmicrosoft.example>\r\nSubject: Undeliverable: hello\r\nContent-Type: multipart/mixed; boundary=outer\r\n", body);
  assert.deepEqual(notice, { messageIds: ["fcc-v8-c2-1@axiom.example"], addresses: ["kim@zeta.example"], status: "5.1.10" });
});

test("a body cut off in the middle of a report still gives the bounce", () => {
  const message = failure();
  const cut = message.body.slice(0, message.body.indexOf("Hello, a short question"));
  assert.ok(readBounceNotice(`From: ${message.from}\r\nSubject: ${message.subject}\r\nContent-Type: ${message.contentType}\r\n`, cut));
});

const plain = (from: string, subject: string, body: string) => readBounceNotice(`From: ${from}\r\nSubject: ${subject}\r\n`, body);

test("plain-text failure notices from different servers are bounces", () => {
  assert.equal(plain("noreply@purelymail.com", "Your message was not accepted", "Delivery to jay@onechoice.example failed permanently. 550 5.1.1 The mailbox does not exist.")?.status, "5.1.1");
  assert.ok(plain("Mail Delivery System <MAILER-DAEMON@mx.exim.example>", "Mail delivery failed: returning message to sender",
    "This message was created automatically by mail delivery software.\r\nA message that you sent could not be delivered to one or more of its recipients. This is a permanent error. The following address(es) failed:\r\n\r\n  gone@x.example\r\n    Unrouteable address"));
  const qmail = plain("MAILER-DAEMON@mx.qmail.example", "failure notice", "Hi. This is the qmail-send program. I'm afraid I wasn't able to deliver your message.\r\n<gone@x.example>:\r\nSorry, no mailbox here by that name. (#5.1.1)");
  assert.equal(qmail?.status, "5.1.1");
  assert.ok(plain("MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@zeta.example", "Undeliverable: Question", "Your message to kim@zeta.example couldn't be delivered."));
  assert.ok(plain("Mail Delivery Subsystem <mailer-daemon@googlemail.com>", "Delivery Status Notification (Failure)", "Your message wasn't delivered to dan@failed.example because the address couldn't be found. 550 5.1.1"));
});

test("plain-text delay notices are not bounces: a Delay subject, 'will retry', 'has not yet been delivered', a 4.x.x status", () => {
  assert.equal(plain("Mail Delivery Subsystem <mailer-daemon@googlemail.com>", "Delivery Status Notification (Delay)", "There was a temporary problem delivering your message to seth@retrying.example. Gmail will retry for 46 more hours."), null);
  assert.equal(plain("postmaster@zeta.example", "Delivery delayed: hello", "Delivery to these recipients has been delayed: kim@slow.example"), null);
  assert.equal(plain("Mail Delivery System <Mailer-Daemon@mx.exim.example>", "Warning: could not send message for past 4 hours", "A message that you sent has not yet been delivered to seth@retrying.example."), null);
  assert.equal(plain("MAILER-DAEMON@mx.postfix.example", "Delayed Mail (still being retried)", "The following recipient could not be reached yet: seth@retrying.example"), null);
  assert.equal(plain("postmaster@mx.example", "Mail status", "Your message to seth@retrying.example has not yet been delivered. We will retry. 451 4.7.1 Greylisted, try again later"), null);
  assert.equal(plain("postmaster@mx.example", "Mail status", "Your message to seth@retrying.example has not been delivered: temporary failure 4.2.2 mailbox full"), null);
});

test("automatic replies are not bounces, even from a system address that names the contact and says 'not delivered'", () => {
  assert.equal(plain("Pat <noreply@bluepeak.example>", "Automatic reply: hello", "I am out of the office. Mail to pat@bluepeak.example is not delivered until Monday."), null);
  assert.equal(plain("postmaster@omega.example", "Auto: Out of office", "Your message to sam@omega.example was not delivered to my inbox."), null);
  assert.equal(readBounceNotice("From: noreply@omega.example\r\nSubject: Re: hello\r\nX-Autoreply: yes\r\n", "Your message to sam@omega.example was not delivered."), null);
});

test("ordinary mail is not a bounce: a colleague's reply, a newsletter, and a number that looks like a status", () => {
  assert.equal(plain("lee@fine.example", "Re: hello", "Looping in pat@bluepeak.example. Your last email was undeliverable to Pat, 5.1.1 is the code."), null);
  assert.equal(plain("noreply@news.example", "This week in telecom", "Nothing about anyone we emailed."), null);
  assert.equal(plain("postmaster@mx.example", "Connection report", "Connection from 5.100.20.7 was refused by pat@bluepeak.example's server."), null);
  assert.equal(plain("noreply@news.example", "Release notes", "Version 4.5.6 and 5.1.1.9 are out."), null);
});

test("noticeIsFor: a notice that quotes one of our Message-IDs is matched by the ID alone; otherwise by the address", () => {
  const quotesOurs: FccBounceNotice = { messageIds: [ID], addresses: ["alias@host.example", "pat@bluepeak.example"], status: "5.1.1" };
  assert.equal(noticeIsFor(quotesOurs, "jay@onechoice.example", [`<${ID.toUpperCase()}>`]), true, "the ID wins, whatever its case and brackets");
  assert.equal(noticeIsFor(quotesOurs, "pat@bluepeak.example", ["<fcc-v8-c9-1@axiom.example>"]), false, "named in the notice, but it quotes another email");
  assert.equal(noticeIsFor(quotesOurs, "pat@bluepeak.example"), true, "no IDs given: the address decides");
  const foreign: FccBounceNotice = { messageIds: ["CAF123@mail.gmail.example"], addresses: ["pat@bluepeak.example"], status: "5.1.1" };
  assert.equal(noticeIsFor(foreign, "Pat@Bluepeak.example", ["<fcc-v8-c9-1@axiom.example>"]), true, "quotes none of ours: the address decides, in any case");
  assert.equal(noticeIsFor(foreign, "lee@fine.example", ["<fcc-v8-c9-1@axiom.example>"]), false);
  assert.equal(noticeIsFor({ messageIds: [], addresses: ["pat@bluepeak.example"], status: null }, "pat@bluepeak.example", []), true, "no Message-ID at all: the address decides");
});
