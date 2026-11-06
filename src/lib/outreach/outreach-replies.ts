/**
 * The campaigns' reply check (Riley, Nov 5: "A city reply is never missed, whichever inbox it lands in").
 * Every hour from 7:00 to 21:00 Toronto, every day, it reads every sending inbox (All Mail and Spam,
 * read-only) from where it last left off, and finds any message from a person a campaign emailed, or
 * from anyone at their organisation (shared mail services excepted), sent after their first email.
 *
 * - Each message is recorded once (OutreachReply). A person's reply stops their follow-ups; an automatic
 *   reply does too unless the campaign says otherwise. A "no thanks" also puts the address on the
 *   do-not-email list, so no campaign and not FCC ever emails it again.
 * - Both founders get one email per run listing the new replies, what they said and which inbox to answer
 *   from. It goes before anything is marked as told, so a failed email is retried next hour.
 * - An inbox that can't be opened is read from where it left off next time; the run says so.
 */
import { SHARED_MAIL_DOMAINS, domainOf, torontoDay } from "@/lib/fcc-campaign-sender";
import type { FccInboxMessage, FccOwnerMail, FccReplyInbox } from "@/lib/fcc-campaign-replies";
import { torontoMinute } from "@/lib/fcc-campaign-tick";
import { suppress } from "@/lib/outreach/outreach-blocked";
import { readKv, writeKv } from "@/lib/outreach/outreach-control";
import { readCampaigns } from "@/lib/outreach/outreach-model";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export const OUTREACH_REPLY_HOURS = { from: 7 * 60, to: 21 * 60 } as const;
const STATE = "outreach.replyCheck";
const TRY = "outreach.replyCheckTry";
const DAY_MS = 86_400_000;

/** A reply that asks us to stop. */
export const NO_THANKS = /\b(no,? thanks?|no thank you|not interested|unsubscribe|remove (me|us)|take (me|us) off|stop (emailing|contacting|sending)|please stop|do not (contact|email)|don'?t (contact|email)|opt(ed)? out)\b/i;

export type OutreachReplyConfig = {
  screenUrl: string;
  inboxes: Array<{ address: string; open: () => Promise<FccReplyInbox> }>;
  tellFounders: (mail: FccOwnerMail) => Promise<void>;
};
export type OutreachReplyResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "RAN"; messages: number; found: number; told: number; unreadInboxes: string[] };

type Contact = { id: string; campaignKey: string; email: string; status: string; firstSentAt: string; label: string };
type Found = { id: string; contact: Contact; message: FccInboxMessage; kind: "reply" | "automatic" | "no_thanks"; quote: string; subject: string | null };

const shortDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);

export async function runOutreachReplyCheck(db: ProspectDb, config: OutreachReplyConfig, now = new Date()): Promise<OutreachReplyResult> {
  if (config.inboxes.length === 0) return { status: "SKIPPED", reason: "no inbox can be read" };
  const minute = torontoMinute(now);
  if (minute < OUTREACH_REPLY_HOURS.from || minute >= OUTREACH_REPLY_HOURS.to) return { status: "SKIPPED", reason: "outside the reply-check hours" };
  const slot = `${torontoDay(now)} ${Math.floor(minute / 60)}`;
  const claimed = await db.prepare(`INSERT INTO "KvStore" ("key","value","updatedAt") VALUES (?,?,?)
    ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt" WHERE "KvStore"."value" <> excluded."value"`)
    .bind(TRY, JSON.stringify(slot), now.toISOString()).run() as { meta?: { changes?: number }; changes?: number };
  if ((claimed.meta?.changes ?? claimed.changes ?? 0) !== 1) return { status: "SKIPPED", reason: "already checked this hour" };

  const { results: contacts } = await db.prepare(`SELECT "id","campaignKey","email","status","firstSentAt",
      COALESCE(json_extract("fieldsJson", '$.city'), json_extract("fieldsJson", '$.company'), json_extract("fieldsJson", '$.agency'), "email") AS label
    FROM "OutreachContact" WHERE "firstSentAt" IS NOT NULL`).bind().all<Contact>();
  // Untold replies from an earlier run whose email failed are told again.
  const { results: untold } = await db.prepare(`SELECT r."id", r."inbox", r."fromAddress", r."receivedAt", r."subject", r."quote", r."kind", c."id" AS contactId
    FROM "OutreachReply" r JOIN "OutreachContact" c ON c."id" = r."contactId" WHERE r."toldFoundersAt" IS NULL`).bind()
    .all<{ id: string; inbox: string; fromAddress: string; receivedAt: string | null; subject: string | null; quote: string | null; kind: Found["kind"]; contactId: string }>();
  if (contacts.length === 0 && untold.length === 0) return { status: "RAN", messages: 0, found: 0, told: 0, unreadInboxes: [] };

  const state = (await readKv<{ inboxes: Record<string, string> }>(db, STATE)) ?? { inboxes: {} };
  const earliest = contacts.reduce((min, contact) => (contact.firstSentAt < min ? contact.firstSentAt : min), contacts[0]?.firstSentAt ?? now.toISOString());
  const sinceFor = (address: string) => {
    const last = state.inboxes[address];
    const overlap = last ? new Date(Date.parse(last) - DAY_MS).toISOString() : earliest;
    return overlap > earliest ? overlap : earliest;
  };
  const byEmail = new Map<string, Contact[]>();
  const byDomain = new Map<string, Contact[]>();
  const add = (map: Map<string, Contact[]>, key: string, contact: Contact) => map.set(key, [...(map.get(key) ?? []), contact]);
  for (const contact of contacts) {
    add(byEmail, contact.email, contact);
    const domain = domainOf(contact.email);
    if (!SHARED_MAIL_DOMAINS.has(domain)) add(byDomain, domain, contact);
  }
  const campaigns = new Map((await readCampaigns(db)).map((campaign) => [campaign.key, campaign]));

  const unreadInboxes: string[] = [];
  const found: Found[] = [];
  let messages = 0;
  const readAt: Record<string, string> = {};
  for (const { address, open } of config.inboxes) {
    let inbox: FccReplyInbox;
    try { inbox = await open(); } catch { unreadInboxes.push(address); continue; }
    try {
      const notFrom = config.inboxes.map((entry) => entry.address);
      const seen = contacts.length ? await inbox.messagesSince(sinceFor(address), notFrom) : [];
      messages += seen.length;
      for (const message of seen) {
        const from = message.from.toLowerCase();
        for (const contact of new Set([...(byEmail.get(from) ?? []), ...(byDomain.get(domainOf(from)) ?? [])])) {
          if (message.date && Date.parse(message.date) < Date.parse(contact.firstSentAt) - 60_000) continue;
          const id = `${address}:${message.folder}:${message.uid}:${contact.id}`;
          if (await db.prepare(`SELECT 1 AS hit FROM "OutreachReply" WHERE "id" = ?`).bind(id).first()) continue;
          const quote = await inbox.replyText(message).catch(() => "");
          const kind: Found["kind"] = message.automatic ? "automatic" : NO_THANKS.test(quote) ? "no_thanks" : "reply";
          found.push({ id, contact, message: { ...message, inbox: address }, kind, quote, subject: null });
        }
      }
      readAt[address] = now.toISOString();
    } catch {
      unreadInboxes.push(address);
    } finally {
      await inbox.close().catch(() => undefined);
    }
  }

  // Record each new message, then stop the people it came from.
  for (const item of found) {
    await db.prepare(`INSERT OR IGNORE INTO "OutreachReply" ("id","campaignKey","contactId","inbox","fromAddress","receivedAt","subject","quote","kind","foundAt")
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(item.id, item.contact.campaignKey, item.contact.id, item.message.inbox, item.message.from.toLowerCase(), item.message.date,
      item.subject, item.quote.slice(0, 600) || null, item.kind, now.toISOString()).run();
    const campaign = campaigns.get(item.contact.campaignKey);
    const who = item.message.from.toLowerCase() === item.contact.email ? "They" : `A colleague (${item.message.from})`;
    const when = item.message.date ? ` ${shortDay(item.message.date)}` : "";
    if (item.kind === "no_thanks") {
      await db.prepare(`UPDATE "OutreachContact" SET "status" = 'suppressed', "stoppedReason" = ?, "nextDueDay" = NULL, "updatedAt" = ? WHERE "id" = ? AND "status" IN ('ready','sent','done','replied')`)
        .bind(`${who} said no thanks${when}: "${item.quote.slice(0, 200)}"`.slice(0, 300), now.toISOString(), item.contact.id).run();
      // A colleague's "no thanks" speaks for the organisation: neither address is emailed again.
      await suppress(db, item.contact.email, "UNSUBSCRIBED");
      if (who !== "They") await suppress(db, item.message.from, "UNSUBSCRIBED");
    } else if (item.kind === "reply" || campaign?.rules.stopOnAutoReply !== false) {
      await db.prepare(`UPDATE "OutreachContact" SET "status" = 'replied', "stoppedReason" = ?, "nextDueDay" = NULL, "updatedAt" = ? WHERE "id" = ? AND "status" IN ('sent','done')`)
        .bind(`${who} ${item.kind === "automatic" ? "sent an automatic reply" : "wrote back"}${when}, so no more emails${item.quote ? `: "${item.quote.slice(0, 200)}"` : ""}`.slice(0, 300),
          now.toISOString(), item.contact.id).run();
    }
  }

  // Tell both founders about every real reply not told yet (this run's and any an earlier failed email missed).
  const { results: toTell } = await db.prepare(`SELECT r."id", r."campaignKey", r."inbox", r."fromAddress", r."receivedAt", r."quote", r."kind",
      COALESCE(json_extract(c."fieldsJson", '$.city'), json_extract(c."fieldsJson", '$.company'), c."email") AS label
    FROM "OutreachReply" r JOIN "OutreachContact" c ON c."id" = r."contactId" WHERE r."toldFoundersAt" IS NULL AND r."kind" <> 'automatic' ORDER BY r."receivedAt"`)
    .bind().all<{ id: string; campaignKey: string; inbox: string; fromAddress: string; receivedAt: string | null; quote: string | null; kind: string; label: string }>();
  let told = 0;
  if (toTell.length) {
    await config.tellFounders(foundersMail(toTell.map((row) => ({ ...row, campaign: campaigns.get(row.campaignKey)?.name ?? row.campaignKey })), config.screenUrl));
    told = toTell.length;
  }
  // Automatic replies are recorded but never emailed about; mark everything up to now as handled.
  await db.prepare(`UPDATE "OutreachReply" SET "toldFoundersAt" = ? WHERE "toldFoundersAt" IS NULL`).bind(now.toISOString()).run();
  await writeKv(db, STATE, { inboxes: { ...state.inboxes, ...readAt }, at: now.toISOString() }, now);
  return { status: "RAN", messages, found: found.length, told, unreadInboxes };
}

function foundersMail(rows: Array<{ campaign: string; label: string; fromAddress: string; inbox: string; receivedAt: string | null; quote: string | null; kind: string }>, screenUrl: string): FccOwnerMail {
  const count = rows.length === 1 ? "1 new reply" : `${rows.length} new replies`;
  const entries = rows.map((row, index) => ({
    title: `${index + 1}. ${row.campaign}: ${row.label} (${row.fromAddress})${row.receivedAt ? `, ${shortDay(row.receivedAt)}` : ""}${row.kind === "no_thanks" ? " (said no thanks: never emailed again)" : ""}`,
    quote: row.quote ? `"${row.quote}"` : "(Open the email to read it.)",
    where: `Answer from ${row.inbox}.`,
  }));
  const text = [
    `The hourly inbox check found ${count} to our campaigns.`, "",
    ...entries.flatMap((entry) => [entry.title, `   ${entry.quote}`, `   ${entry.where}`, ""]),
    "Their follow-ups are stopped. Every reply is on the Campaigns screen:", screenUrl,
  ].join("\n");
  const html = [
    `<p>The hourly inbox check found <strong>${count}</strong> to our campaigns.</p>`,
    ...entries.map((entry) => `<p><strong>${escapeHtml(entry.title)}</strong><br>${escapeHtml(entry.quote)}<br>${escapeHtml(entry.where)}</p>`),
    `<p>Their follow-ups are stopped. <a href="${escapeHtml(screenUrl)}">Every reply is on the Campaigns screen</a>.</p>`,
  ].join("\n");
  return { subject: `Campaigns: ${count}`, text, html };
}
