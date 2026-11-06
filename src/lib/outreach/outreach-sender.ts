/**
 * The campaign sender: one tick a minute per sending inbox, run just before FCC's tick for that inbox
 * (src/lib/send-cron.ts), so a campaign goes first whenever it has an email due. Each tick sends at
 * most one email. Same rules as FCC's sender (docs/runbooks/FCC_CAMPAIGN.md), shared per inbox:
 *
 * - Gates: the campaign is live and its settings usable; today is one of its send days, inside its
 *   start and end days and its time window; the contact's batch is approved by a named approver for
 *   the campaign's current words; a mailing address is set; the inbox has its password.
 * - Limits: the campaign's daily limit and its share of each inbox; the inbox's own day (all campaigns
 *   and FCC together; half before 12:30, the rest after only if it had at most 1 bounce);
 *   1 to 3 minutes between any two emails from the inbox.
 * - Order: due follow-ups first (oldest first), then first emails (batch order, then CSV row order).
 * - Checks before every email: the do-not-email list (and anyone who bounced or said "no thanks" in
 *   any campaign); someone else at the same organisation already replied; before a follow-up, the
 *   inbox is read for a reply from the person or their organisation, or a bounce, since the first email.
 * - Pauses (the campaign stays paused until a founder presses Resume): 3 of the campaign's own emails
 *   bounced today; and, for every campaign on the inbox, a Google warning in it, a login Gmail refuses, an
 *   email Gmail refuses. An inbox with 3 bounces today (all campaigns and FCC together) sends nothing
 *   more that day without pausing anyone (Aidan, Nov 5: "a city bounce never pauses FCC or agency sending").
 * - Every email is claimed before it is sent, so a crash can never send it twice.
 */
import { SHARED_MAIL_DOMAINS, addDays, domainOf, torontoDay, torontoWeekday, type FccMailbox } from "@/lib/fcc-campaign-sender";
import { torontoMinute } from "@/lib/fcc-campaign-tick";
import { addressBlocked, suppress } from "@/lib/outreach/outreach-blocked";
import { noteCampaignRun, pauseCampaign, readKv, writeKv } from "@/lib/outreach/outreach-control";
import {
  AFTERNOON_FROM, AFTERNOON_MAX_BOUNCES, GAP_MIN_MS, PAUSE_BOUNCES, gapAfter, inboxBouncesToday, inboxCapNow, inboxClaimedSinceSql, inboxDayMax, inboxLastSend,
  inboxSentSql, inboxSentToday, type InboxRef,
} from "@/lib/outreach/outreach-inboxes";
import { readCampaigns, type Campaign, type Inbox } from "@/lib/outreach/outreach-model";
import { renderEmail, type Sender } from "@/lib/outreach/outreach-words";
import { PermanentEmailError, type EmailTransport } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export const OUTREACH_AUTO_PAUSE_BY = "the automatic safety check";
/** How far back the day's first bounce look reaches (a weekend fits), as FCC's. */
export const OUTREACH_LATE_BOUNCE_DAYS = 5;
const TICK_MS = 60_000;
const JITTER_MS = 15_000;
const LOGIN_REFUSED = /\b53[45]\b|5\.7\.(?:8|9|14)\b|AUTHENTICATIONFAILED|password|log ?in|auth/i;
/** A 5xx about Gmail or the sender (a limit, a block, a login), not about the one recipient. */
const SENDER_PROBLEM = /\b5\.4\.5\b|\b5\.7\.\d+|limit|quota|blocked|spam|policy|auth|password|log ?in/i;

export type OutreachInboxConfig = {
  inbox: Inbox;
  ref: InboxRef;
  sender: Sender;
  mailingAddress: string | null | undefined;
  transport: (() => Promise<EmailTransport>) | null;
  mailbox: (() => Promise<FccMailbox>) | null;
  newId: () => string;
};

export type OutreachTickResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "PAUSED"; campaigns: string[]; reason: string }
  | { status: "CHECKED"; campaign: string; note: string }
  | { status: "SENT"; campaign: string; step: number };

export type OutreachTickOptions = { wait?: (ms: number) => Promise<void>; random?: () => number };

type ContactRow = {
  id: string; campaignKey: string; email: string; fieldsJson: string; status: string; stepsSent: number;
  firstSentAt: string | null; firstMessageId: string | null; firstSubject: string | null; lastMessageId: string | null;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);
const changes = (result: unknown) => {
  const r = result as { changes?: number; meta?: { changes?: number } };
  return r.meta?.changes ?? r.changes ?? 0;
};

/** `day` plus `count` weekdays (Mon-Fri), as a Toronto day. */
export function addBusinessDays(day: string, count: number) {
  let current = day;
  let left = count;
  while (left > 0) {
    current = addDays(current, 1);
    const weekday = new Date(`${current}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return current;
}

/** Why the campaign can't send from this inbox at this moment, or null. */
export function campaignClosed(campaign: Campaign, inbox: string, now: Date, mailingAddress: string | null | undefined): string | null {
  if (campaign.problem) return `settings can't be used: ${campaign.problem}`;
  if (campaign.state !== "live") return "paused";
  if (!campaign.wordsVersion || !campaign.words.steps[0]?.subject) return "no email words";
  if ((mailingAddress ?? "").trim().length < 10) return "no mailing address";
  const share = campaign.inboxes.find((entry) => entry.address === inbox);
  if (!share || share.perDay <= 0 || campaign.dailyLimit <= 0) return "doesn't send from this inbox";
  const day = torontoDay(now);
  if (campaign.startDay && day < campaign.startDay) return `starts ${campaign.startDay}`;
  if (campaign.endDay && day > campaign.endDay) return `ended ${campaign.endDay}`;
  if (!campaign.sendDays.includes(torontoWeekday(now))) return "not a send day";
  const minute = torontoMinute(now);
  if (minute < campaign.windowStart || minute >= campaign.windowEnd) return "outside its send hours";
  return null;
}

/** The contacts with an email due: follow-ups from this inbox first, then first emails. Approved batches on the current words only. */
async function dueContacts(db: ProspectDb, campaign: Campaign, inbox: string, day: string) {
  const columns = `c."id", c."campaignKey", c."email", c."fieldsJson", c."status", c."stepsSent", c."firstSentAt", c."firstMessageId", c."firstSubject", c."lastMessageId"`;
  const approved = `JOIN "OutreachBatch" b ON b."id" = c."batchId" AND b."status" = 'approved' AND b."approvedWords" = ?`;
  const { results: followUps } = campaign.followUps > 0 ? await db.prepare(`SELECT ${columns} FROM "OutreachContact" c ${approved}
      WHERE c."campaignKey" = ? AND c."status" = 'sent' AND c."senderAddress" = ? AND c."nextDueDay" <= ? AND c."stepsSent" BETWEEN 1 AND ?
        AND c."firstMessageId" IS NOT NULL
      ORDER BY c."nextDueDay", b."sendOrder", c."rowNumber" LIMIT 25`).bind(campaign.wordsVersion, campaign.key, inbox, day, campaign.followUps).all<ContactRow>()
    : { results: [] as ContactRow[] };
  const { results: firsts } = await db.prepare(`SELECT ${columns} FROM "OutreachContact" c ${approved}
      WHERE c."campaignKey" = ? AND c."status" = 'ready' AND c."stepsSent" = 0
      ORDER BY b."sendOrder", c."rowNumber" LIMIT 25`).bind(campaign.wordsVersion, campaign.key).all<ContactRow>();
  return { followUps, firsts };
}

/** People a campaign emailed today, from any inbox, whose email has since bounced. */
async function bouncesTodayBy(db: ProspectDb, campaign: string, day: string) {
  return Number((await db.prepare(`SELECT COUNT(DISTINCT c."id") AS n FROM "OutreachContact" c JOIN "OutreachSend" s ON s."contactId" = c."id"
    WHERE s."campaignKey" = ? AND s."sendDay" = ? AND s."kind" = 'real' AND c."status" = 'bounced'`).bind(campaign, day).first<{ n: number }>())?.n ?? 0);
}

async function sentTodayBy(db: ProspectDb, campaign: string, day: string, inbox?: string) {
  const mine = inbox ? ` AND "senderAddress" = ?` : "";
  return Number((await db.prepare(`SELECT COUNT(*) AS n FROM "OutreachSend" WHERE "campaignKey" = ? AND "sendDay" = ? AND "kind" = 'real' AND "status" IN ('CLAIMED','SENT')${mine}`)
    .bind(...(inbox ? [campaign, day, inbox] : [campaign, day])).first<{ n: number }>())?.n ?? 0);
}

async function stopContact(db: ProspectDb, id: string, status: "replied" | "bounced" | "suppressed" | "failed" | "held", reason: string) {
  const column = status === "held" ? "holdReason" : "stoppedReason";
  await db.prepare(`UPDATE "OutreachContact" SET "status" = ?, "${column}" = ?, "nextDueDay" = NULL, "updatedAt" = ? WHERE "id" = ?`)
    .bind(status, reason.slice(0, 300), new Date().toISOString(), id).run();
}

const bounceScanKey = (inbox: string) => `outreach.bounceScan:${inbox}`;

/** One send tick for one inbox. */
export async function runOutreachTick(db: ProspectDb, config: OutreachInboxConfig, now = new Date(), options: OutreachTickOptions = {}): Promise<OutreachTickResult> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const inbox = config.ref.address;
  if (!config.transport || !config.mailbox) return { status: "SKIPPED", reason: "inbox has no password" };
  const campaigns = (await readCampaigns(db)).filter((campaign) => campaignClosed(campaign, inbox, now, config.mailingAddress) === null);
  if (campaigns.length === 0) return { status: "SKIPPED", reason: "no campaign sends from this inbox now" };

  const day = torontoDay(now);
  const minute = torontoMinute(now);
  const firstName = config.sender.name.trim().split(/\s+/)[0] || inbox;
  const label = `${firstName}'s inbox: `;
  const dayMax = inboxDayMax(config.inbox, day);
  const capNow = inboxCapNow(dayMax, minute);
  const sent = await inboxSentToday(db, day, config.ref);
  if (sent >= capNow) return { status: "SKIPPED", reason: minute < AFTERNOON_FROM ? "the inbox's morning half is used" : "the inbox's day is full" };

  const pauseAll = async (cause: string): Promise<OutreachTickResult> => {
    const reason = `${label}${cause}`;
    const paused: string[] = [];
    for (const campaign of campaigns) {
      if (await pauseCampaign(db, campaign.key, reason, OUTREACH_AUTO_PAUSE_BY, now)) {
        paused.push(campaign.key);
        await noteCampaignRun(db, campaign.key, `Paused: ${reason}`, now);
      }
    }
    return { status: "PAUSED", campaigns: paused, reason };
  };
  const secondHalf = sent >= Math.ceil(dayMax / 2);
  // Bounces (Aidan, Nov 5: "a city bounce never pauses FCC or agency sending"). A campaign with PAUSE_BOUNCES of its own
  // today is paused until a founder resumes it; FCC and the other campaigns keep their own counts. The inbox itself sends
  // nothing more today once PAUSE_BOUNCES of its emails bounced, from anyone (Google judges the inbox, not the campaign),
  // and its second half still needs AFTERNOON_MAX_BOUNCES or fewer. Nothing else is paused; it starts again tomorrow.
  const bounceRules = async (): Promise<OutreachTickResult | null> => {
    const paused: string[] = [];
    for (const campaign of campaigns) {
      const own = await bouncesTodayBy(db, campaign.key, day);
      if (own < PAUSE_BOUNCES) continue;
      const reason = `${own} of its emails bounced today`;
      if (await pauseCampaign(db, campaign.key, reason, OUTREACH_AUTO_PAUSE_BY, now)) {
        paused.push(campaign.key);
        await noteCampaignRun(db, campaign.key, `Paused: ${reason}`, now);
      }
    }
    if (paused.length) return { status: "PAUSED", campaigns: paused, reason: `${PAUSE_BOUNCES} or more of its emails bounced today` };
    const total = await inboxBouncesToday(db, day, config.ref);
    if (total >= PAUSE_BOUNCES) {
      for (const campaign of campaigns) {
        await noteCampaignRun(db, campaign.key, `${label}nothing more from it today: ${total} of its emails bounced today (all campaigns and FCC). Nothing is paused; it starts again tomorrow.`, now);
      }
      return { status: "SKIPPED", reason: `the inbox rests for the rest of today: ${total} bounced` };
    }
    if (secondHalf && total > AFTERNOON_MAX_BOUNCES) return { status: "SKIPPED", reason: `no second half today: ${total} bounced` };
    return null;
  };
  const known = await bounceRules();
  if (known) return known;

  const last = await inboxLastSend(db, day, config.ref);
  const dueAt = last ? Date.parse(last.createdAt) + gapAfter(last.sendId) : now.getTime();
  if (dueAt - now.getTime() >= TICK_MS) return { status: "SKIPPED", reason: "waiting between emails" };

  // Pick the first campaign (lowest priority number) with room today and someone due, before logging in to Gmail.
  let chosen: { campaign: Campaign; followUps: ContactRow[]; firsts: ContactRow[] } | null = null;
  for (const campaign of campaigns) {
    const share = campaign.inboxes.find((entry) => entry.address === inbox)!;
    if (await sentTodayBy(db, campaign.key, day) >= campaign.dailyLimit) continue;
    if (await sentTodayBy(db, campaign.key, day, inbox) >= share.perDay) continue;
    const due = await dueContacts(db, campaign, inbox, day);
    if (due.followUps.length || due.firsts.length) { chosen = { campaign, ...due }; break; }
  }
  if (!chosen) return { status: "SKIPPED", reason: "nothing due" };
  const { campaign } = chosen;

  let mailbox: FccMailbox;
  try {
    mailbox = await config.mailbox();
  } catch (error) {
    const detail = message(error);
    if (LOGIN_REFUSED.test(detail)) return pauseAll(`Gmail refused the inbox login (${detail})`);
    await noteCampaignRun(db, campaign.key, `${label}Couldn't check the inbox, so nothing was sent. Trying again next minute. (${detail})`, now);
    return { status: "SKIPPED", reason: `inbox check failed: ${detail}` };
  }
  let transport: EmailTransport | null = null;
  try {
    const sinceIso = `${day}T12:00:00.000Z`;
    const warning = await mailbox.googleWarning(sinceIso);
    if (warning) return await pauseAll(warning);

    // Bounces: on the day's first look reach back OUTREACH_LATE_BOUNCE_DAYS over everyone this inbox emailed for a campaign;
    // later looks only when a new bounce message has arrived, over today's. Every bounce goes on the do-not-email list.
    const bounceMessages = await mailbox.bounceCount(sinceIso);
    const scanned = await readKv<{ day: string; count: number }>(db, bounceScanKey(inbox));
    const firstLookToday = scanned?.day !== day;
    if (firstLookToday || bounceMessages > (scanned?.count ?? 0)) {
      const from = firstLookToday ? addDays(day, -OUTREACH_LATE_BOUNCE_DAYS) : day;
      const { results: recent } = await db.prepare(`SELECT DISTINCT c."id", c."email" FROM "OutreachContact" c JOIN "OutreachSend" s ON s."contactId" = c."id"
        WHERE s."kind" = 'real' AND s."status" = 'SENT' AND s."senderAddress" = ? AND s."sendDay" BETWEEN ? AND ? AND c."status" IN ('sent','done')`)
        .bind(inbox, from, day).all<{ id: string; email: string }>();
      const bounced = new Set(recent.length ? await mailbox.bouncedAmong(recent.map((row) => row.email), `${from}T12:00:00.000Z`) : []);
      for (const row of recent.filter((contact) => bounced.has(contact.email))) {
        await stopContact(db, row.id, "bounced", "The email bounced");
        await suppress(db, row.email, "BOUNCED");
      }
      await writeKv(db, bounceScanKey(inbox), { day, count: bounceMessages }, now);
    }
    const found = await bounceRules();
    if (found) return found;

    const delay = Math.max(0, dueAt - now.getTime()) + Math.floor(random() * JITTER_MS);
    if (delay > 0) await wait(delay);
    const sendAt = new Date(now.getTime() + delay);
    const share = campaign.inboxes.find((entry) => entry.address === inbox)!;
    let inboxDown = false;
    let checked = 0;

    const sameOrgReplied = async (contact: ContactRow) => {
      const domain = domainOf(contact.email);
      if (SHARED_MAIL_DOMAINS.has(domain)) return false;
      return Boolean(await db.prepare(`SELECT 1 AS hit FROM "OutreachContact" WHERE "campaignKey" = ? AND "email" LIKE ? AND "id" <> ? AND "status" IN ('replied','suppressed') LIMIT 1`)
        .bind(contact.campaignKey, `%@${domain}`, contact.id).first<{ hit: number }>());
    };

    /** Claims, sends and records one email. Returns "sent", "next" (try the next contact) or "stop" (nothing more this minute). */
    const send = async (contact: ContactRow, step: number): Promise<"sent" | "next" | "stop"> => {
      let fields: Record<string, string> = {};
      try { fields = JSON.parse(contact.fieldsJson) as Record<string, string>; } catch { fields = {}; }
      const rendered = renderEmail(campaign.words, step, fields, config.sender, config.mailingAddress,
        { noLinksInFirst: campaign.rules.noLinksInFirst, firstSubject: step === 1 ? null : contact.firstSubject });
      if (!rendered.ok) {
        // Can't be written as approved (a blank, a link): held for a person, and it takes no slot today.
        await stopContact(db, contact.id, step === 1 ? "held" : "failed", step === 1 ? rendered.reason : `Follow-up ${step - 1} couldn't be written: ${rendered.reason}`);
        return "next";
      }
      transport ??= await config.transport!();
      const sendId = config.newId();
      const messageId = `<ax-${campaign.key}-${contact.id}-${step}@${domainOf(inbox)}>`;
      const claimedAt = sendAt.toISOString();
      const inboxSent = inboxSentSql(day, config.ref);
      const recent = inboxClaimedSinceSql(day, new Date(sendAt.getTime() - (GAP_MIN_MS - 10_000)).toISOString(), config.ref);
      // One statement, so two runs at once can never both pass a limit or the gap between emails.
      const claim = await db.prepare(`INSERT INTO "OutreachSend" ("sendId","campaignKey","contactId","kind","step","email","senderAddress","sendDay","messageId","subject","status","createdAt")
        SELECT ?,?,?,'real',?,?,?,?,?,?,'CLAIMED',?
        WHERE ${inboxSent.sql} < ?
          AND (SELECT COUNT(*) FROM "OutreachSend" WHERE "campaignKey" = ? AND "sendDay" = ? AND "kind" = 'real' AND "status" IN ('CLAIMED','SENT')) < ?
          AND (SELECT COUNT(*) FROM "OutreachSend" WHERE "campaignKey" = ? AND "sendDay" = ? AND "kind" = 'real' AND "senderAddress" = ? AND "status" IN ('CLAIMED','SENT')) < ?
          AND NOT ${recent.sql}
          AND EXISTS (SELECT 1 FROM "OutreachCampaign" WHERE "key" = ? AND "state" = 'live')
          AND EXISTS (SELECT 1 FROM "OutreachContact" WHERE "id" = ? AND "status" = ? AND "stepsSent" = ?)
        ON CONFLICT DO NOTHING`).bind(
        sendId, campaign.key, contact.id, step, contact.email, inbox, day, messageId, rendered.email.subject, claimedAt,
        ...inboxSent.binds, capNow,
        campaign.key, day, campaign.dailyLimit,
        campaign.key, day, inbox, share.perDay,
        ...recent.binds,
        campaign.key,
        contact.id, step === 1 ? "ready" : "sent", step - 1,
      ).run();
      if (changes(claim) !== 1) {
        const taken = await db.prepare(`SELECT 1 AS hit FROM "OutreachSend" WHERE "contactId" = ? AND "step" = ? AND "status" <> 'FAILED' AND "kind" = 'real'`)
          .bind(contact.id, step).first<{ hit: number }>();
        return taken ? "next" : "stop";
      }
      const thread: Record<string, string> = step === 1 || !contact.firstMessageId ? {}
        : { "In-Reply-To": contact.lastMessageId ?? contact.firstMessageId, References: [...new Set([contact.firstMessageId, contact.lastMessageId].filter(Boolean))].join(" ") };
      try {
        await transport.send({
          to: contact.email, subject: rendered.email.subject, text: rendered.email.text,
          headers: { "Message-ID": messageId, "List-Unsubscribe": `<mailto:${inbox}?subject=no%20thanks>`, ...thread },
        });
        const at = new Date().toISOString();
        await db.prepare(`UPDATE "OutreachSend" SET "status" = 'SENT', "finishedAt" = ? WHERE "sendId" = ?`).bind(at, sendId).run();
        const last = step > campaign.followUps;
        const next = last ? null : addBusinessDays(day, campaign.followUpBusinessDays);
        if (step === 1) {
          await db.prepare(`UPDATE "OutreachContact" SET "status" = ?, "stepsSent" = 1, "senderAddress" = ?, "firstSentAt" = ?, "firstSentDay" = ?, "firstMessageId" = ?,
              "firstSubject" = ?, "lastMessageId" = ?, "nextDueDay" = ?, "updatedAt" = ? WHERE "id" = ?`)
            .bind(last ? "done" : "sent", inbox, at, day, messageId, rendered.email.subject, messageId, next, at, contact.id).run();
        } else {
          await db.prepare(`UPDATE "OutreachContact" SET "status" = ?, "stepsSent" = ?, "lastMessageId" = ?, "nextDueDay" = ?, "updatedAt" = ? WHERE "id" = ?`)
            .bind(last ? "done" : "sent", step, messageId, next, at, contact.id).run();
        }
        return "sent";
      } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        await db.prepare(`UPDATE "OutreachSend" SET "status" = 'FAILED', "detail" = ?, "finishedAt" = ? WHERE "sendId" = ?`).bind(detail, new Date().toISOString(), sendId).run();
        if (error instanceof PermanentEmailError && !SENDER_PROBLEM.test(detail)) {
          await stopContact(db, contact.id, "bounced", detail);
          await suppress(db, contact.email, "BOUNCED");
          return "stop";
        }
        await stopContact(db, contact.id, "failed", detail);
        throw new Error(`Gmail refused an email (${detail})`);
      }
    };

    let outcome: "sent" | "next" | "stop" = "next";
    let sentStep = 0;
    // Follow-ups first: read the inbox for a reply or a bounce since the first email.
    for (const contact of chosen.followUps) {
      if (inboxDown) break;
      checked += 1;
      if (await addressBlocked(db, contact.email)) { await stopContact(db, contact.id, "suppressed", "On the do-not-email list"); continue; }
      if (await sameOrgReplied(contact)) { await stopContact(db, contact.id, "suppressed", "Someone else at this organisation replied or was stopped"); continue; }
      const domain = domainOf(contact.email);
      const patterns = SHARED_MAIL_DOMAINS.has(domain) ? [contact.email] : [contact.email, `@${domain}`];
      let replied = false;
      let bounced = false;
      try {
        replied = await mailbox.hasMessagesFrom(patterns, contact.firstSentAt!);
        bounced = !replied && await mailbox.hasBounceFor(contact.email, contact.firstSentAt!);
      } catch {
        inboxDown = true; // without a working inbox check nobody gets a follow-up this minute; first emails still can
        break;
      }
      if (replied) { await stopContact(db, contact.id, "replied", "They wrote back, so no follow-up"); continue; }
      if (bounced) { await stopContact(db, contact.id, "bounced", "An earlier email bounced"); await suppress(db, contact.email, "BOUNCED"); continue; }
      outcome = await send(contact, contact.stepsSent + 1);
      if (outcome !== "next") { sentStep = contact.stepsSent + 1; break; }
    }
    if (outcome === "next") {
      for (const contact of chosen.firsts) {
        checked += 1;
        if (await addressBlocked(db, contact.email)) { await stopContact(db, contact.id, "held", "On the do-not-email list (bounced, said no thanks or asked not to be contacted)"); continue; }
        if (await sameOrgReplied(contact)) { await stopContact(db, contact.id, "held", "Someone else at this organisation already replied or was stopped"); continue; }
        outcome = await send(contact, 1);
        if (outcome !== "next") { sentStep = 1; break; }
      }
    }
    if (outcome === "sent") {
      const total = await sentTodayBy(db, campaign.key, day);
      await noteCampaignRun(db, campaign.key, `${label}Sent ${sentStep === 1 ? "a first email" : `follow-up ${sentStep - 1}`} (${total} of today's ${campaign.dailyLimit}).`, sendAt);
      return { status: "SENT", campaign: campaign.key, step: sentStep };
    }
    const note = inboxDown ? "Couldn't read the inbox for replies, so no follow-up went this minute." : `Checked ${checked} ${checked === 1 ? "person" : "people"}; nothing sent this minute.`;
    await noteCampaignRun(db, campaign.key, `${label}${note}`, sendAt);
    return { status: "CHECKED", campaign: campaign.key, note };
  } catch (error) {
    const detail = message(error);
    if (/^Gmail refused an email/.test(detail)) return pauseAll(detail);
    if (LOGIN_REFUSED.test(detail)) return pauseAll(`Gmail refused the sending login (${detail})`);
    await noteCampaignRun(db, campaign.key, `${label}Couldn't send. Trying again next minute. (${detail})`, now);
    return { status: "SKIPPED", reason: `could not send: ${detail}` };
  } finally {
    await (transport as EmailTransport | null)?.close().catch(() => undefined);
    await mailbox.close().catch(() => undefined);
  }
}

/** Latest sends, for the screens: nothing here sends. */
export const OUTREACH_SENT_STATUSES = ["sent", "done", "replied", "bounced"] as const;
export { inboxSentToday };
