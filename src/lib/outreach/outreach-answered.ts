/**
 * A reply is marked answered when one of us has answered it, without anyone pressing a button (Riley, Nov 18:
 * the founders answer in Gmail, nobody marked it, and "To answer" ran days behind).
 *
 * The hourly reply check already has every sending inbox open, read-only. For each real reply still waiting it
 * looks for a message of ours that answers it:
 *
 * - its From is one of our sending inboxes, and it was not sent by the engine (the engine's own emails carry
 *   `<ax-…>` Message-IDs, so a follow-up never counts);
 * - it is dated after the reply (and after a founder last said "not answered after all");
 * - and either its In-Reply-To or References names the reply's own Message-ID, or it is addressed to the person
 *   who wrote (or the person we emailed) and its In-Reply-To or References names an email the engine sent them.
 *
 * Never the subject alone. The mark is the time our message was sent and "<first name> (seen in Sent)", so it
 * reads differently from a mark a founder made. Only the two answered columns of OutreachReply change. No mail
 * is changed: the inbox is opened with EXAMINE and read with BODY.PEEK, as the rest of the check is.
 *
 * "Not answered after all" keeps answeredAt empty and stores when it was said in answeredBy (no new column), so
 * the same sent message can't mark the reply again an hour later. A message we send after that still can.
 */
import type { FccReplyInbox, FccSentMessage } from "@/lib/fcc-campaign-replies";
import { readInboxes } from "@/lib/outreach/outreach-model";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

/** The note after the name on a mark the reply check made. */
export const SEEN_IN_SENT = "seen in Sent";
const NOT_ANSWERED = "not answered after all ";
/** At most this many waiting replies are looked up per run (the newest), so the check stays quick. */
const MOST = 60;
/** Message-IDs the engine gives its own emails (campaigns, tests and FCC). */
const ENGINE_ID = /^<(ax|fcc)-/i;

/** What answeredBy holds once a founder says a reply is not answered after all. */
export const notAnsweredMark = (now: Date) => `${NOT_ANSWERED}${now.toISOString()}`;

/** When a founder last said "not answered after all", or null. */
export function notAnsweredSince(answeredBy: string | null): string | null {
  if (!answeredBy?.startsWith(NOT_ANSWERED)) return null;
  const at = Date.parse(answeredBy.slice(NOT_ANSWERED.length));
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** Who marked a reply answered, for a screen: nobody while it is not answered. */
export const answeredByShown = (answeredAt: string | null, answeredBy: string | null) => (answeredAt ? answeredBy : null);

export type WaitingReply = {
  id: string; contactId: string; inbox: string; fromAddress: string;
  /** When they wrote. */
  at: string;
  answeredBy: string | null;
  /** The person we emailed, and the Message-IDs of the engine's emails to them. */
  email: string; firstMessageId: string | null; lastMessageId: string | null;
};

/** The newest real replies nobody has answered. */
export async function repliesWaiting(db: ProspectDb): Promise<WaitingReply[]> {
  const { results } = await db.prepare(`SELECT r."id", r."contactId", r."inbox", r."fromAddress", COALESCE(r."receivedAt", r."foundAt") AS at, r."answeredBy",
      c."email", c."firstMessageId", c."lastMessageId"
    FROM "OutreachReply" r JOIN "OutreachContact" c ON c."id" = r."contactId"
    WHERE r."kind" = 'reply' AND r."answeredAt" IS NULL ORDER BY at DESC LIMIT ?`).bind(MOST).all<WaitingReply>();
  return results;
}

/** The folder and UID a recorded reply was found at: its id is `inbox:folder:uid:contact`. */
export function whereReplyIs(row: Pick<WaitingReply, "id" | "inbox" | "contactId">): { folder: string; uid: number } | null {
  const start = `${row.inbox}:`;
  const end = `:${row.contactId}`;
  if (!row.id.startsWith(start) || !row.id.endsWith(end) || row.id.length <= start.length + end.length) return null;
  const middle = row.id.slice(start.length, -end.length);
  const cut = middle.lastIndexOf(":");
  const uid = Number(middle.slice(cut + 1));
  return cut > 0 && Number.isInteger(uid) && uid > 0 ? { folder: middle.slice(0, cut), uid } : null;
}

export type AnswersRead = {
  /** Reply id -> that reply's Message-ID. */
  replyIds: Map<string, string>;
  /** Mail addressed to the people who wrote. */
  sent: FccSentMessage[];
};

/**
 * Reads, from one open inbox, what answering needs: the Message-ID of each waiting reply that landed here, and the
 * mail in this mailbox addressed to anyone who is waiting (the answer may go from another of our inboxes than the
 * one the reply landed in). At most a handful of read-only commands, and none when nothing waits.
 */
export async function readAnswers(inbox: FccReplyInbox, address: string, waiting: WaitingReply[]): Promise<AnswersRead> {
  const read: AnswersRead = { replyIds: new Map(), sent: [] };
  if (waiting.length === 0 || !inbox.mailTo) return read;
  const here = waiting.flatMap((row) => {
    const where = row.inbox === address ? whereReplyIs(row) : null;
    return where ? [{ row, ...where }] : [];
  });
  if (here.length && inbox.messageIds) {
    const ids = await inbox.messageIds(here.map(({ folder, uid }) => ({ folder, uid })));
    for (const { row, folder, uid } of here) {
      const id = ids.get(`${folder}:${uid}`);
      if (id) read.replyIds.set(row.id, id);
    }
  }
  const people = [...new Set(waiting.flatMap((row) => [row.fromAddress.toLowerCase(), row.email.toLowerCase()]))].filter((value) => value.includes("@"));
  const since = waiting.reduce((min, row) => (row.at < min ? row.at : min), waiting[0]!.at);
  read.sent = await inbox.mailTo(since, people);
  return read;
}

/** Our earliest message that answers this reply, or null. `own`: our sending addresses, lower case. */
export function answerTo(row: WaitingReply, replyMessageId: string | undefined, sent: FccSentMessage[], own: Set<string>): FccSentMessage | null {
  const after = Math.max(Date.parse(row.at), Date.parse(notAnsweredSince(row.answeredBy) ?? row.at));
  if (Number.isNaN(after)) return null;
  const engineSent = new Set([row.firstMessageId, row.lastMessageId].filter((id): id is string => Boolean(id)));
  const people = new Set([row.fromAddress.toLowerCase(), row.email.toLowerCase()]);
  let answer: FccSentMessage | null = null;
  for (const message of sent) {
    if (!message.date || !own.has(message.from.toLowerCase())) continue;
    if (ENGINE_ID.test(message.messageId) || engineSent.has(message.messageId)) continue;
    if (!(Date.parse(message.date) > after)) continue;
    const toTheirMessage = replyMessageId !== undefined && message.references.includes(replyMessageId);
    const inTheirThread = message.to.some((address) => people.has(address)) && message.references.some((id) => engineSent.has(id));
    if ((toTheirMessage || inTheirThread) && (!answer || message.date < answer.date!)) answer = message;
  }
  return answer;
}

/** Marks every waiting reply one of us has answered. Returns how many. A mark a person made is never touched. */
export async function markAnswered(db: ProspectDb, waiting: WaitingReply[], read: AnswersRead, ownAddresses: string[]): Promise<number> {
  if (waiting.length === 0 || read.sent.length === 0) return 0;
  const inboxes = await readInboxes(db);
  const names = new Map(inboxes.map((inbox) => [inbox.address.toLowerCase(), inbox.name]));
  const own = new Set([...names.keys(), ...ownAddresses.map((address) => address.toLowerCase())]);
  let marked = 0;
  for (const row of waiting) {
    const answer = answerTo(row, read.replyIds.get(row.id), read.sent, own);
    if (!answer) continue;
    const from = answer.from.toLowerCase();
    const by = `${(names.get(from) ?? "").trim().split(/\s+/)[0] || from} (${SEEN_IN_SENT})`.slice(0, 120);
    // Only while it is exactly as it was read: a mark or an un-mark a person made in the meantime wins.
    const done = await db.prepare(`UPDATE "OutreachReply" SET "answeredAt" = ?, "answeredBy" = ? WHERE "id" = ? AND "kind" = 'reply' AND "answeredAt" IS NULL AND "answeredBy" IS ?`)
      .bind(answer.date, by, row.id, row.answeredBy).run() as { meta?: { changes?: number }; changes?: number };
    marked += done.meta?.changes ?? done.changes ?? 0;
  }
  return marked;
}
