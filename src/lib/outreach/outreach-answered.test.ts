import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { fccReplyInboxFromImap, type FccReplyInbox, type FccSentMessage } from "@/lib/fcc-campaign-replies";
import { answerTo, notAnsweredSince, whereReplyIs, type WaitingReply } from "@/lib/outreach/outreach-answered";
import { runOutreachReplyCheck } from "@/lib/outreach/outreach-replies";
import { getReply, listReplies, markReply } from "@/lib/outreach/outreach-reply-list";
import { weekNumbers } from "@/lib/outreach/outreach-week";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { openImap, type ImapStream } from "@/lib/revenue-engine/imap-client";
import { applyEngineSchema } from "@/lib/revenue-engine/test-support/engine-schema";

// Every clock here is pinned: the reply check and the marks are given their "now". Toronto is UTC-5 in November.
const FIRST = "first-inbox@axiom.example";   // "Aidan Example"
const SECOND = "second-inbox@axiom.example"; // "Riley Example"
const ALL = "[Gmail]/All Mail";
const SENT_MONDAY = "2026-11-09T14:10:00.000Z";
const REPLIED = "2026-11-16T18:00:00.000Z";
const ANSWERED = "2026-11-16T19:30:00.000Z";
const HOUR = (hour: number) => new Date(`2026-11-17T${String(hour).padStart(2, "0")}:05:00.000Z`);

function database() {
  const raw = new Database(":memory:");
  applyEngineSchema(raw);
  raw.exec(readFileSync(new URL("../../../migrations/0037_kv_store.sql", import.meta.url), "utf8"));
  const db: ProspectDb = {
    prepare(sql) {
      const statement = raw.prepare(sql);
      return { bind: (...values: unknown[]) => ({
        all: async <T,>() => ({ results: statement.all(...values) as T[] }),
        first: async <T,>() => (statement.get(...values) as T | undefined) ?? null,
        run: async () => statement.run(...values),
      }) };
    },
  };
  raw.prepare(`DELETE FROM "OutreachInbox"`).run();
  raw.prepare(`INSERT INTO "OutreachInbox" ("address","name","passwordSecret","dailyMax") VALUES (?,?,?,60), (?,?,?,60)`).run(FIRST, "Aidan Example", "P1", SECOND, "Riley Example", "P2");
  raw.prepare(`INSERT INTO "OutreachBatch" ("id","campaignKey","name","loadedBy","loadedAt","status","approvedBy","approvedAt","approvedWords","sendOrder","wordsJson","wordsVersion")
    VALUES ('b1','us-cities','b1','Riley','2026-11-08T21:00:00.000Z','approved','Aidan','2026-11-08T22:00:00.000Z','w1',1,'{"steps":[]}','w1')`).run();
  let seq = 0;
  /** A person the engine emailed on Monday Nov 9 from `from`. Their first email's Message-ID is `<ax-us-cities-ID-1@axiom.example>`. */
  const person = (place: string, from: string) => {
    const id = `c${++seq}`;
    const email = `clerk@${place.toLowerCase()}.example`;
    const first = `<ax-us-cities-${id}-1@axiom.example>`;
    raw.prepare(`INSERT INTO "OutreachContact" ("id","campaignKey","batchId","rowNumber","email","fieldsJson","status","stepsSent","senderAddress","firstSentAt","firstSentDay",
      "firstMessageId","lastMessageId","nextDueDay","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, "us-cities", "b1", seq, email,
      JSON.stringify({ email, first_name: "Pat", city: place }), "sent", 1, from, SENT_MONDAY, "2026-11-09", first, first, "2026-11-16", SENT_MONDAY, SENT_MONDAY);
    return { id, email, first };
  };
  /** A reply the hourly check already recorded (and told the founders about). Returns its row id and its own Message-ID. */
  const reply = (contact: { id: string; email: string }, kind: "reply" | "automatic" | "no_thanks", landedIn: string, at: string, from?: string) => {
    const uid = ++seq;
    const id = `${landedIn}:${ALL}:${uid}:${contact.id}`;
    raw.prepare(`INSERT INTO "OutreachReply" ("id","campaignKey","contactId","inbox","fromAddress","receivedAt","quote","kind","foundAt","toldFoundersAt") VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, "us-cities", contact.id, landedIn, from ?? contact.email, at, "Could you send the report?", kind, at, at);
    raw.prepare(`UPDATE "OutreachContact" SET "status" = ?, "nextDueDay" = NULL, "updatedAt" = ? WHERE "id" = ?`).run(kind === "no_thanks" ? "suppressed" : "replied", at, contact.id);
    return { id, uid, messageId: `<their-${uid}@mail.${contact.email.split("@")[1]}>`, key: `${ALL}:${uid}` };
  };
  const marks = (id: string) => raw.prepare(`SELECT "answeredAt","answeredBy" FROM "OutreachReply" WHERE "id" = ?`).get(id) as { answeredAt: string | null; answeredBy: string | null };
  return { raw, db, person, reply, marks };
}

type Box = { ids?: Record<string, string>; sent?: FccSentMessage[]; fail?: boolean };
/** Fake mailboxes: what each holds, and every read the check made of them. Nothing can be written: there is no method for it. */
function mailboxes(boxes: Record<string, Box>) {
  const reads: string[] = [];
  const told: string[] = [];
  const config = {
    screenUrl: "https://engine.example/campaigns",
    inboxes: Object.entries(boxes).map(([address, box]) => ({ address, open: async (): Promise<FccReplyInbox> => ({
      async messagesSince() { return []; },
      async replyText() { return ""; },
      async messageIds(messages) {
        reads.push(`${address} messageIds ${messages.map((message) => message.uid).join(",")}`);
        return new Map(messages.flatMap((message) => { const key = `${message.folder}:${message.uid}`; return box.ids?.[key] ? [[key, box.ids[key]] as [string, string]] : []; }));
      },
      async mailTo(_since, to) {
        reads.push(`${address} mailTo ${[...to].sort().join(",")}`);
        if (box.fail) throw new Error("IMAP NO search failed");
        return (box.sent ?? []).filter((message) => message.to.some((one) => to.includes(one)));
      },
      async close() {},
    }) })),
    tellFounders: async (mail: { subject: string }) => { told.push(mail.subject); },
  };
  return { config, reads, told };
}

const ours = (from: string, to: string, date: string, messageId: string, references: string[]): FccSentMessage => ({ from, to: [to], date, messageId, references });

test("a reply one of us answered from Gmail is marked answered with the time our answer was sent; one nobody answered stays to answer", async () => {
  const { db, person, reply, marks } = database();
  const alder = person("Alder", SECOND);
  const birch = person("Birch", SECOND);
  const asked = reply(alder, "reply", SECOND, REPLIED);
  const waiting = reply(birch, "reply", SECOND, REPLIED);
  const { config, reads, told } = mailboxes({
    [FIRST]: {},
    [SECOND]: {
      ids: { [asked.key]: asked.messageId, [waiting.key]: waiting.messageId },
      // Riley hit Reply in Gmail: In-Reply-To is their message, References the whole thread.
      sent: [ours(SECOND, alder.email, ANSWERED, "<CAgmail-1@mail.gmail.com>", [alder.first, asked.messageId])],
    },
  });
  assert.equal((await listReplies(db)).counts["to-answer"], 2);

  const result = await runOutreachReplyCheck(db, config, HOUR(15));
  assert.deepEqual(result, { status: "RAN", messages: 0, found: 0, told: 0, unreadInboxes: [], answered: 1 });
  assert.deepEqual(marks(asked.id), { answeredAt: ANSWERED, answeredBy: "Riley (seen in Sent)" });
  assert.deepEqual(marks(waiting.id), { answeredAt: null, answeredBy: null });
  const list = await listReplies(db);
  assert.equal(list.counts["to-answer"], 1);
  assert.equal(list.counts.answered, 1);
  assert.deepEqual(list.rows.map((row) => row.organisation), ["Birch"]);
  assert.equal((await getReply(db, asked.id))!.answeredBy, "Riley (seen in Sent)");
  assert.deepEqual(told, [], "an answered reply is nothing to email the founders about");
  // Per inbox: one read of the waiting replies' Message-IDs where they landed, and one search for mail to those people.
  assert.deepEqual(reads, [
    `${FIRST} mailTo ${alder.email},${birch.email}`,
    `${SECOND} messageIds ${asked.uid},${waiting.uid}`,
    `${SECOND} mailTo ${alder.email},${birch.email}`,
  ]);

  // The next hour changes nothing, and reads only for the one still waiting.
  reads.length = 0;
  assert.equal((await runOutreachReplyCheck(db, config, HOUR(16)) as { answered: number }).answered, 0);
  assert.deepEqual(marks(asked.id), { answeredAt: ANSWERED, answeredBy: "Riley (seen in Sent)" });
  assert.deepEqual(reads, [`${FIRST} mailTo ${birch.email}`, `${SECOND} messageIds ${waiting.uid}`, `${SECOND} mailTo ${birch.email}`]);
});

test("the engine's own emails and anything of ours from before the reply are not an answer", async () => {
  const { db, person, reply, marks } = database();
  const alder = person("Alder", SECOND);
  const asked = reply(alder, "reply", SECOND, REPLIED);
  const { config } = mailboxes({
    [SECOND]: {
      ids: { [asked.key]: asked.messageId },
      sent: [
        // The first email the engine sent them, a week before they wrote.
        ours(SECOND, alder.email, SENT_MONDAY, alder.first, []),
        // An engine follow-up in the same thread, even one dated after the reply: it answers nothing.
        ours(SECOND, alder.email, ANSWERED, "<ax-us-cities-c1-2@axiom.example>", [alder.first]),
        // Something a founder wrote them in that thread before they replied.
        ours(SECOND, alder.email, "2026-11-16T17:00:00.000Z", "<CAgmail-early@mail.gmail.com>", [alder.first]),
        // A new email to them with the same subject but outside the thread: the subject alone is never enough.
        ours(SECOND, alder.email, ANSWERED, "<CAgmail-new@mail.gmail.com>", []),
        // Their own colleague replying in the thread is not us.
        ours("it@alder.example", alder.email, ANSWERED, "<colleague@mail.alder.example>", [alder.first, asked.messageId]),
      ],
    },
  });
  assert.equal((await runOutreachReplyCheck(db, config, HOUR(15)) as { answered: number }).answered, 0);
  assert.deepEqual(marks(asked.id), { answeredAt: null, answeredBy: null });
  assert.equal((await listReplies(db)).counts["to-answer"], 1);
});

test("a mark a founder made is left alone, and a reply set back to not answered is not marked again by the same sent message", async () => {
  const { db, person, reply, marks } = database();
  const alder = person("Alder", SECOND);
  const birch = person("Birch", FIRST);
  const byHand = reply(alder, "reply", SECOND, REPLIED);
  const undone = reply(birch, "reply", FIRST, REPLIED);
  const answer = (to: { email: string; first: string }, from: string, date: string, id: string, theirs: string) => ours(from, to.email, date, id, [to.first, theirs]);
  const second: Box = { ids: { [byHand.key]: byHand.messageId }, sent: [answer(alder, SECOND, ANSWERED, "<CAgmail-a@mail.gmail.com>", byHand.messageId)] };
  const first: Box = { ids: { [undone.key]: undone.messageId }, sent: [answer(birch, FIRST, ANSWERED, "<CAgmail-b@mail.gmail.com>", undone.messageId)] };
  const { config } = mailboxes({ [FIRST]: first, [SECOND]: second });

  // Aidan marked the first one by hand before the check ran: his mark and its time stay.
  const handAt = new Date("2026-11-16T21:00:00.000Z");
  assert.ok((await markReply(db, byHand.id, { answered: true }, "Aidan", handAt)).ok);
  assert.equal((await runOutreachReplyCheck(db, config, HOUR(15)) as { answered: number }).answered, 1);
  assert.deepEqual(marks(byHand.id), { answeredAt: handAt.toISOString(), answeredBy: "Aidan" });
  assert.deepEqual(marks(undone.id), { answeredAt: ANSWERED, answeredBy: "Aidan (seen in Sent)" });

  // Riley says the second one is not answered after all (the message in Sent was not really an answer).
  const unmarked = await markReply(db, undone.id, { answered: false }, "Riley", new Date("2026-11-17T15:30:00.000Z"));
  assert.ok(unmarked.ok && unmarked.reply.answeredAt === null && unmarked.reply.answeredBy === null, "the screen shows it as plainly not answered");
  assert.equal(notAnsweredSince(marks(undone.id).answeredBy), "2026-11-17T15:30:00.000Z");
  const week = await weekNumbers(db, "2026-11-16", "2026-11-22", new Date("2026-11-17T15:31:00.000Z"));
  assert.equal(week.people.find((row) => row.id === undone.id)!.answeredBy, null);
  for (const hour of [16, 17]) {
    assert.equal((await runOutreachReplyCheck(db, config, HOUR(hour)) as { answered: number }).answered, 0);
    assert.equal(marks(undone.id).answeredAt, null, "the same sent message does not mark it again");
  }
  assert.equal((await listReplies(db)).counts["to-answer"], 1);

  // A real answer sent after that does count.
  const later = "2026-11-17T17:40:00.000Z";
  first.sent!.push(answer(birch, FIRST, later, "<CAgmail-c@mail.gmail.com>", undone.messageId));
  assert.equal((await runOutreachReplyCheck(db, config, HOUR(18)) as { answered: number }).answered, 1);
  assert.deepEqual(marks(undone.id), { answeredAt: later, answeredBy: "Aidan (seen in Sent)" });
  // And a founder can still mark by hand a reply that was set back.
  assert.ok((await markReply(db, undone.id, { answered: false }, "Riley", new Date("2026-11-17T18:30:00.000Z"))).ok);
  const again = await markReply(db, undone.id, { answered: true }, "Riley", new Date("2026-11-17T18:31:00.000Z"));
  assert.ok(again.ok && again.reply.answeredBy === "Riley");
});

test("automatic replies and no-thanks are never marked, whatever we sent them", async () => {
  const { raw, db, person, reply, marks } = database();
  const alder = person("Alder", SECOND);
  const birch = person("Birch", SECOND);
  const auto = reply(alder, "automatic", SECOND, REPLIED);
  const no = reply(birch, "no_thanks", SECOND, REPLIED);
  const { config, reads } = mailboxes({
    [SECOND]: {
      ids: { [auto.key]: auto.messageId, [no.key]: no.messageId },
      sent: [
        ours(SECOND, alder.email, ANSWERED, "<CAgmail-a@mail.gmail.com>", [alder.first, auto.messageId]),
        ours(SECOND, birch.email, ANSWERED, "<CAgmail-b@mail.gmail.com>", [birch.first, no.messageId]),
      ],
    },
  });
  const before = JSON.stringify(raw.prepare(`SELECT * FROM "OutreachReply" ORDER BY "id"`).all());
  assert.equal((await runOutreachReplyCheck(db, config, HOUR(15)) as { answered: number }).answered, 0);
  assert.equal(JSON.stringify(raw.prepare(`SELECT * FROM "OutreachReply" ORDER BY "id"`).all()), before);
  assert.deepEqual([marks(auto.id).answeredAt, marks(no.id).answeredAt], [null, null]);
  assert.deepEqual(reads, [], "with no real reply waiting, the inbox is not read for answers at all");
});

test("an answer from the inbox that sent the email counts when the reply landed in the other inbox, and a failed search only waits an hour", async () => {
  const { raw, db, person, reply, marks } = database();
  const alder = person("Alder", FIRST);
  // Their colleague wrote back, and it landed in Riley's inbox; Aidan's inbox sent the email, so Aidan answers from his.
  const asked = reply(alder, "reply", SECOND, REPLIED, "manager@alder.example");
  const first: Box = { fail: true, sent: [ours(FIRST, "manager@alder.example", ANSWERED, "<CAgmail-a@mail.gmail.com>", [alder.first])] };
  const { config } = mailboxes({ [FIRST]: first, [SECOND]: { ids: { [asked.key]: asked.messageId } } });

  const failed = await runOutreachReplyCheck(db, config, HOUR(15));
  assert.deepEqual(failed, { status: "RAN", messages: 0, found: 0, told: 0, unreadInboxes: [], answered: 0 }, "the reply check itself still ran and read both inboxes");
  const state = JSON.parse((raw.prepare(`SELECT "value" FROM "KvStore" WHERE "key" = 'outreach.replyCheck'`).get() as { value: string }).value) as { inboxes: Record<string, string>; unread: string[] };
  assert.deepEqual([Object.keys(state.inboxes).sort(), state.unread], [[FIRST, SECOND], []]);
  assert.equal(marks(asked.id).answeredAt, null);

  first.fail = false;
  assert.equal((await runOutreachReplyCheck(db, config, HOUR(16)) as { answered: number }).answered, 1);
  assert.deepEqual(marks(asked.id), { answeredAt: ANSWERED, answeredBy: "Aidan (seen in Sent)" });
});

test("what counts as an answer: header by header", () => {
  const row: WaitingReply = {
    id: `${SECOND}:${ALL}:41:c1`, contactId: "c1", inbox: SECOND, fromAddress: "clerk@alder.example", at: REPLIED, answeredBy: null,
    email: "clerk@alder.example", firstMessageId: "<ax-us-cities-c1-1@axiom.example>", lastMessageId: "<ax-us-cities-c1-2@axiom.example>",
  };
  const own = new Set([FIRST, SECOND]);
  const theirs = "<their-41@mail.alder.example>";
  const hit = (message: FccSentMessage, replyId: string | undefined = theirs) => answerTo(row, replyId, [message], own)?.messageId ?? null;
  assert.deepEqual(whereReplyIs(row), { folder: ALL, uid: 41 });
  assert.equal(whereReplyIs({ id: "contact:c1", inbox: SECOND, contactId: "c1" }), null, "a reply with no stored message has no place to read");
  // In-Reply-To or References names their message: an answer, whoever it is addressed to.
  assert.equal(hit(ours(SECOND, "someone-else@alder.example", ANSWERED, "<a@mail.gmail.com>", [theirs])), "<a@mail.gmail.com>");
  // Their Message-ID could not be read (the message was moved): to them, in the thread of an email the engine sent them.
  assert.equal(hit(ours(SECOND, "clerk@alder.example", ANSWERED, "<b@mail.gmail.com>", [row.lastMessageId!]), undefined), "<b@mail.gmail.com>");
  assert.equal(hit(ours(SECOND, "other@elsewhere.example", ANSWERED, "<c@mail.gmail.com>", [row.firstMessageId!]), undefined), null, "in the thread but to someone else");
  assert.equal(hit(ours(SECOND, "clerk@alder.example", ANSWERED, "<d@mail.gmail.com>", ["<unrelated@mail.gmail.com>"])), null, "to them but in another thread");
  assert.equal(hit(ours(SECOND, "clerk@alder.example", REPLIED, "<e@mail.gmail.com>", [theirs])), null, "the same second is not after");
  assert.equal(hit({ ...ours(SECOND, "clerk@alder.example", ANSWERED, "<f@mail.gmail.com>", [theirs]), date: null }), null, "no date, no mark");
  assert.equal(hit(ours("stranger@elsewhere.example", "clerk@alder.example", ANSWERED, "<g@mail.gmail.com>", [theirs])), null);
  assert.equal(hit(ours(SECOND, "clerk@alder.example", ANSWERED, "<fcc-nov6-x-2@axiom.example>", [theirs])), null, "an engine Message-ID never counts");
  // The earliest of several answers is the one whose time is kept.
  const two = [ours(SECOND, "clerk@alder.example", "2026-11-17T12:00:00.000Z", "<late@mail.gmail.com>", [theirs]), ours(FIRST, "clerk@alder.example", ANSWERED, "<early@mail.gmail.com>", [theirs])];
  assert.equal(answerTo(row, theirs, two, own)!.messageId, "<early@mail.gmail.com>");
});

/** A scripted IMAP server: each client line gets the replies `respond` returns. */
function fakeServer(respond: (tag: string, command: string) => string[]) {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let push: (text: string) => void = () => {};
  const readable = new ReadableStream<Uint8Array>({ start(controller) { push = (text) => controller.enqueue(encoder.encode(text)); push("* OK Gimap ready\r\n"); } });
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
  const stream: ImapStream = { readable, writable, close: async () => undefined };
  return { stream, lines };
}

test("over IMAP the answer lookup only reads: EXAMINE, UID SEARCH and BODY.PEEK header fetches, a handful of commands", async () => {
  const literal = (text: string) => `{${new TextEncoder().encode(text).length}}\r\n${text}`;
  const sentHeaders = [
    "From: Riley Example <second-inbox@axiom.example>", "To: \"Clerk, Alder\" <Clerk@Alder.example>", "Cc: manager@alder.example",
    "Date: Mon, 16 Nov 2026 14:30:00 -0500", "Message-ID: <CAgmail-1@mail.gmail.com>", "In-Reply-To: <their-41@mail.alder.example>",
    "References: <ax-us-cities-c1-1@axiom.example>", " <their-41@mail.alder.example>", "", "",
  ].join("\r\n");
  const server = fakeServer((tag, command) => {
    if (command.startsWith("LOGIN")) return [`${tag} OK authenticated`];
    if (command.startsWith("LIST")) return ['* LIST (\\HasNoChildren) "/" "INBOX"', '* LIST (\\All \\HasNoChildren) "/" "[Gmail]/All Mail"', '* LIST (\\HasNoChildren \\Junk) "/" "[Gmail]/Spam"', `${tag} OK Success`];
    if (command.startsWith("EXAMINE")) return ["* 120 EXISTS", `${tag} OK [READ-ONLY] selected. (Success)`];
    if (command.startsWith("UID SEARCH")) return ["* SEARCH 77", `${tag} OK SEARCH completed (Success)`];
    if (command.startsWith("UID FETCH 41 ")) return [`* 9 FETCH (UID 41 BODY[HEADER.FIELDS (MESSAGE-ID)] ${literal("Message-ID: <their-41@mail.alder.example>\r\n\r\n")})`, `${tag} OK Success`];
    if (command.startsWith("UID FETCH 77 ")) return [`* 12 FETCH (UID 77 BODY[HEADER.FIELDS (FROM TO CC DATE MESSAGE-ID IN-REPLY-TO REFERENCES)] ${literal(sentHeaders)})`, `${tag} OK Success`];
    if (command === "LOGOUT") return ["* BYE LOGOUT Requested", `${tag} OK good day`];
    return [`${tag} BAD unknown command`];
  });
  const inbox = await fccReplyInboxFromImap(await openImap(server.stream, { username: "second-inbox@axiom.example", password: "pw" }));
  assert.deepEqual([...(await inbox.messageIds!([{ folder: ALL, uid: 41 }, { folder: "Some Other Folder", uid: 5 }]))], [[`${ALL}:41`, "<their-41@mail.alder.example>"]]);
  assert.deepEqual(await inbox.mailTo!(REPLIED, ["clerk@alder.example", "clerk@birch.example", "it@birch.example"]), [{
    from: "second-inbox@axiom.example", messageId: "<CAgmail-1@mail.gmail.com>", date: ANSWERED,
    to: ["clerk@alder.example", "manager@alder.example"], references: ["<their-41@mail.alder.example>", "<ax-us-cities-c1-1@axiom.example>"],
  }]);
  await inbox.close();
  assert.deepEqual(server.lines.slice(2), [
    'A003 EXAMINE "[Gmail]/All Mail"',
    "A004 UID FETCH 41 (UID BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])",
    'A005 UID SEARCH SINCE 16-Nov-2026 OR TO "clerk@alder.example" OR TO "clerk@birch.example" TO "it@birch.example"',
    "A006 UID FETCH 77 (UID BODY.PEEK[HEADER.FIELDS (FROM TO CC DATE MESSAGE-ID IN-REPLY-TO REFERENCES)])",
    "A007 LOGOUT",
  ]);
  assert.ok(!server.lines.some((line) => /\b(SELECT|STORE|EXPUNGE|DELETE|COPY|MOVE|APPEND)\b/.test(line)), "the inbox is only ever read");
});
