/**
 * FCC "March 1 pack" sender: the weekday batch for the FCC campaign.
 *
 * Nothing is sent until every gate passes: a founder has recorded the go for
 * this exact copy version (FccCampaignSetting, locked by default), a mailing
 * address is configured, the sending mailbox is configured, and it is a
 * weekday in Toronto. Each day sends at most FCC_DAILY_SEND_CAP emails, counting
 * follow-ups. A follow-up goes in the same thread FCC_FOLLOW_UP_DELAY_DAYS after
 * the first email, and only after the inbox shows no reply and no bounce.
 * Every email is claimed before it is sent, so a crash can never double-send.
 * First emails use the approved copy (FCC_COPY_VERSION); a follow-up uses the copy
 * of the person's own first email, so the 60 sent on the calmer v3 keep its follow-up.
 *
 * More than one inbox can send (Riley's was added Nov 1). Each inbox has its own
 * daily count and gap between emails, and a follow-up always goes from the inbox
 * that sent that person's first email, so it lands in the same thread.
 *
 * The November 6 hot list (FCC_NOV6_CAMPAIGN_KEY) goes first: one first email each, no follow-up.
 * Everything else waits until the hot list has been sent or stopped, and anyone on the hot list
 * is out of the March queue for good: no March first email and no March follow-up.
 * A hold or stop on someone's March row also stops their hot-list email, and a reply, stop or
 * non-generic hold anywhere at a company stops it for that company's other mailboxes. The exception is
 * "Signed a 2026 RMD declaration": that stop is about the March wording, and the hot-list line is written for them.
 * After FCC_NOV6_LAST_SEND_DAY the hot list closes and anyone it never reached rejoins the March queue.
 * Only the first inbox sends it: everyone emailed so far replied to that inbox, so that's where its inbox check must look.
 *
 * The day-7 follow-up (from v7) is the third and last March email: in the same thread, from the same
 * inbox, about 7 days after the first email and at least 4 after the day-3 one. It goes after the
 * day-3 follow-ups and before new first emails, inside the same daily count, with the day-3 checks
 * plus one more: nobody else at the company replied, was stopped, bounced or is held. Never to the
 * hot list. New first emails split between two subjects (fccSubjectTestCopy), and anyone the hot
 * list never held gets the flag-off words under those subjects (fccFlagOffCopy).
 */
import {
  fccCopyOfMessageId, fccFlagOffCopy, fccSubjectTestCopy, renderFccEmail, renderFccEmailDay7, renderFccEmailNov6, renderFccEmailV5, FCC_CAMPAIGN_KEY, FCC_COPY_VERSION,
  FCC_DAILY_SEND_CAP, FCC_DAY7_AFTER_FIRST_DAYS, FCC_DAY7_AFTER_FOLLOW_UP_DAYS, FCC_FOLLOW_UP_DELAY_DAYS, FCC_NOV6_CAMPAIGN_KEY, FCC_NOV6_LAST_SEND_DAY,
  type FccCampaignContact, type FccCopy,
} from "@/lib/fcc-campaign";
import { readFccSignatures } from "@/lib/fcc-campaign-control";
import { PermanentEmailError, type EmailTransport } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { imapDate, imapQuote, type ImapSession } from "@/lib/revenue-engine/imap-client";

/** The day of the first FCC email. A hot-list contact with no March row is checked for replies from here. */
const FCC_FIRST_SEND_DAY = "2026-10-26T00:00:00.000Z";

/** What the sender needs from the sending mailbox's inbox. */
export type FccMailbox = {
  /** True when any message from one of `fromPatterns` arrived on or after `sinceIso`'s day. */
  hasMessagesFrom(fromPatterns: string[], sinceIso: string): Promise<boolean>;
  /** True when a bounce mentioning `email` arrived on or after `sinceIso`'s day. */
  hasBounceFor(email: string, sinceIso: string): Promise<boolean>;
  /** How many bounce messages arrived from `sinceIso`'s day (not earlier). Cheap: one search. */
  bounceCount(sinceIso: string): Promise<number>;
  /** The addresses among `emails` that a bounce from `sinceIso`'s day (not earlier) mentions. */
  bouncedAmong(emails: string[], sinceIso: string): Promise<string[]>;
  /** A Google notice from `sinceIso`'s day (not earlier) that means sending must stop, or null. */
  googleWarning(sinceIso: string): Promise<string | null>;
  close(): Promise<void>;
};

export type FccRunOptions = {
  /** Most emails today, counting earlier runs. Defaults to the daily cap. */
  cap?: number;
  /** Most emails this run. */
  limit?: number;
  /** No email is claimed within this many ms of any other claim that day. */
  minGapMs?: number;
};

export type FccSendConfig = {
  fromAddress: string;
  /** Who signs the email. Defaults to Aidan Magee, whose inbox sent every FCC email before Nov 2. */
  fromName?: string;
  /** False for an added inbox. Rows of the first inbox carry no address (NULL); an added inbox's rows carry its own. */
  primary?: boolean;
  mailingAddress: string | null | undefined;
  transport: (() => Promise<EmailTransport>) | null;
  mailbox: (() => Promise<FccMailbox>) | null;
  newId: () => string;
};

export type FccRunResult =
  | { status: "SKIPPED"; reason: string }
  | {
    /** followUps counts day-3 follow-ups; day7FollowUps the day-7 ones. */
    status: "RAN"; firstEmails: number; followUps: number; day7FollowUps: number; replied: number; bounced: number; suppressed: number; failed: number;
    remainingToday: number; followUpsHeldBack: string | null;
  };

type ContactRow = {
  id: string; email: string; firstName: string; company: string; filingsJson: string;
  step1SentAt: string | null; step1MessageId: string | null;
  /** First-email rows only: 1 if this person has a row on the November 6 list, whose companies had the Recertify flag on. */
  onHotList?: number;
  /** Day-7 rows only: the day-3 follow-up's Message-ID, so the last email threads under both. */
  step2MessageId?: string | null;
};

/**
 * The Toronto day a contact's day-7 follow-up falls due, from their step-1 (`s1`) and step-2 (`s2`)
 * FccCampaignSend rows: 7 days after the first email and at least 4 after the day-3 one.
 */
export const FCC_DAY7_DUE_SQL = `max(date(s1."sendDay", '+${FCC_DAY7_AFTER_FIRST_DAYS} days'), date(s2."sendDay", '+${FCC_DAY7_AFTER_FOLLOW_UP_DAYS} days'))`;
/**
 * Joins a contact `c` to the step-1 and step-2 send rows FCC_DAY7_DUE_SQL reads. Checks on a contact's send rows say
 * `<> 'FAILED'`, never `IN ('CLAIMED','SENT')`: the same rows (the status can only be one of the three), but only this
 * form matches the (contactId, step) index's own condition, so SQLite looks the rows up instead of reading the whole
 * send table once per contact (208 ms against 3 ms for the day-7 list on 2,500 contacts).
 */
export const FCC_DAY7_JOIN_SQL = `JOIN "FccCampaignSend" s1 ON s1."contactId" = c."id" AND s1."step" = 1 AND s1."status" <> 'FAILED'
    JOIN "FccCampaignSend" s2 ON s2."contactId" = c."id" AND s2."step" = 2 AND s2."status" <> 'FAILED'`;

/** Mail services many unrelated people share; a reply from one of them says nothing about a company. */
export const SHARED_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "hotmail.com", "outlook.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "bellsouth.net", "cox.net", "charter.net", "earthlink.net",
  "juno.com", "netzero.net",
]);

/**
 * Google notices that put the mailbox at risk. Any one of them pauses the whole
 * campaign until a founder looks (Aidan's send rules, Oct 27). Plain "Security
 * alert" emails (a new sign-in, an app password) are routine and do not count.
 *
 * A "Message blocked" bounce that quotes the recipient's own server ("The
 * response from the remote server was: 550 5.7.1 ...") is that one company's
 * spam filter refusing one email, not Google acting on the mailbox: it stays an
 * ordinary bounce (the three-bounces-a-day pause still covers it). On Oct 29 a
 * Microsoft 365 rejection of that shape paused the campaign after 53 sends.
 * Google's own blocks never mention a remote server, and its spam filter says
 * "unsolicited mail" even when it answers as the recipient's server.
 */
const GOOGLE_WARNINGS: Array<[criteria: string, reason: string]> = [
  [`FROM "accounts.google.com" SUBJECT "critical security alert"`, "Google sent a critical security alert"],
  [`FROM "accounts.google.com" SUBJECT "suspicious"`, "Google reported suspicious activity"],
  [`FROM "mailer-daemon" BODY "limit for sending"`, "Gmail says the sending limit was reached"],
  [`FROM "mailer-daemon" BODY "sending limit"`, "Gmail says the sending limit was reached"],
  [`FROM "mailer-daemon" BODY "unsolicited mail"`, "Gmail says a message looked like spam"],
  [`FROM "mailer-daemon" NOT BODY "remote server" BODY "message blocked"`, "Gmail says a message was blocked"],
  [`FROM "mailer-daemon" NOT BODY "remote server" BODY "has been blocked"`, "Gmail says a message was blocked"],
];

/** A 5xx that is about Gmail or the sender (a limit, a block, a login), not about the one recipient. */
const SENDER_PROBLEM = /\b5\.4\.5\b|\b5\.7\.\d+|limit|quota|blocked|spam|policy|auth|password|log ?in/i;

/** The inbox a row belongs to: "" for the first inbox, otherwise the added inbox's address. Compare with COALESCE("senderAddress",''). */
export const senderKey = (config: Pick<FccSendConfig, "fromAddress" | "primary">) => (config.primary === false ? config.fromAddress : "");

export const torontoDay = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
export const torontoWeekday = (now: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Toronto" }).format(now);
export const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();
const changes = (result: unknown) => {
  const r = result as { changes?: number; meta?: { changes?: number } };
  return r.meta?.changes ?? r.changes ?? 0;
};

function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Wraps a logged-in IMAP session: opens the all-mail folder read-only (falls back to INBOX). */
export async function fccMailboxFromImap(session: ImapSession): Promise<FccMailbox> {
  const boxes = await session.listMailboxes();
  const allMail = boxes.find((box) => box.flags.some((flag) => flag.toLowerCase() === "\\all"))?.name ?? "INBOX";
  await session.examine(allMail);
  // One day early so a time-zone edge can never hide a same-day reply.
  const since = (iso: string) => imapDate(new Date(Date.parse(iso) - 86_400_000).toISOString());
  return {
    async hasMessagesFrom(fromPatterns, sinceIso) {
      for (const pattern of fromPatterns) {
        if ((await session.search(`SINCE ${since(sinceIso)} FROM ${imapQuote(pattern)}`)).length > 0) return true;
      }
      return false;
    },
    async hasBounceFor(email, sinceIso) {
      return (await session.search(`SINCE ${since(sinceIso)} OR FROM "mailer-daemon" FROM "postmaster" BODY ${imapQuote(email)}`)).length > 0;
    },
    async bounceCount(sinceIso) {
      return (await session.search(`SINCE ${imapDate(sinceIso)} OR FROM "mailer-daemon" FROM "postmaster"`)).length;
    },
    async bouncedAmong(emails, sinceIso) {
      const day = imapDate(sinceIso);
      const hits: string[] = [];
      for (const email of emails) {
        if ((await session.search(`SINCE ${day} OR FROM "mailer-daemon" FROM "postmaster" BODY ${imapQuote(email)}`)).length > 0) hits.push(email);
      }
      return hits;
    },
    async googleWarning(sinceIso) {
      const day = imapDate(sinceIso);
      for (const [criteria, reason] of GOOGLE_WARNINGS) {
        if ((await session.search(`SINCE ${day} ${criteria}`)).length > 0) return reason;
      }
      return null;
    },
    close: () => session.close(),
  };
}

export async function fccSetting(db: ProspectDb) {
  return db.prepare(`SELECT "enabled","dailyCap","approvedCopy","goBy" FROM "FccCampaignSetting" WHERE "id" = 1`).bind()
    .first<{ enabled: number; dailyCap: number; approvedCopy: string | null; goBy: string | null }>();
}

/** Emails claimed or sent on `day`: all inboxes, or only `sender`'s. */
export async function fccSentToday(db: ProspectDb, day: string, sender?: Pick<FccSendConfig, "fromAddress" | "primary">) {
  const mine = sender ? ` AND COALESCE("senderAddress",'') = ?` : "";
  return Number((await db.prepare(`SELECT COUNT(*) AS n FROM "FccCampaignSend" WHERE "sendDay" = ? AND "status" IN ('CLAIMED','SENT')${mine}`)
    .bind(...(sender ? [day, senderKey(sender)] : [day])).first<{ n: number }>())?.n ?? 0);
}

/**
 * Domains used by more than one company in the campaign (e.g. a shared co-op host). The March list
 * only: the November 6 list spells some company names differently, so adding it would make one
 * company look like two and switch off its company-wide stops.
 */
export async function sharedCampaignDomains(db: ProspectDb) {
  const { results } = await db.prepare(`SELECT "email","company" FROM "FccCampaignContact" WHERE "campaignKey" = ?`)
    .bind(FCC_CAMPAIGN_KEY).all<{ email: string; company: string }>();
  const companies = new Map<string, Set<string>>();
  for (const row of results) {
    const domain = domainOf(row.email);
    companies.set(domain, (companies.get(domain) ?? new Set()).add(row.company.toLowerCase()));
  }
  return new Set([...companies].filter(([, names]) => names.size > 1).map(([domain]) => domain));
}

async function isSuppressed(db: ProspectDb, email: string) {
  return Boolean(await db.prepare(`SELECT 1 AS hit FROM "EngineEmailSuppression" WHERE "email" = ? OR "email" = ?`)
    .bind(email, `@${domainOf(email)}`).first<{ hit: number }>());
}

/** Why nothing may be sent right now, or null when every switch and setting allows it. */
export function fccClosedGate(setting: Awaited<ReturnType<typeof fccSetting>>, config: FccSendConfig, now: Date): string | null {
  if (!setting) return "setting row missing";
  if (setting.enabled !== 1 || !setting.goBy) return "locked until a founder records the go";
  if (setting.approvedCopy !== FCC_COPY_VERSION) return "this copy version is not approved";
  if ((config.mailingAddress ?? "").trim().length < 10) return "no mailing address";
  if (!config.transport || !config.mailbox || !config.fromAddress) return "sender not configured";
  if (["Sat", "Sun"].includes(torontoWeekday(now))) return "weekend";
  return null;
}

/** Due follow-ups first (day 3, then day 7), then new first emails, up to the day's cap (or `options.limit`). Safe to re-run. */
export async function runFccDailySend(db: ProspectDb, config: FccSendConfig, now = new Date(), options: FccRunOptions = {}): Promise<FccRunResult> {
  const setting = await fccSetting(db);
  const closed = fccClosedGate(setting, config, now);
  if (closed || !setting) return { status: "SKIPPED", reason: closed ?? "setting row missing" };
  const address = (config.mailingAddress ?? "").trim();

  const day = torontoDay(now);
  const cap = options.cap ?? Math.min(FCC_DAILY_SEND_CAP, Math.max(0, setting.dailyCap));
  let remaining = cap - await fccSentToday(db, day, config);
  const inbox = senderKey(config);
  // Title and cell are optional extras: if they can't be read, the email still goes with name and title only.
  const signatures = await readFccSignatures(db).catch(() => ({} as Awaited<ReturnType<typeof readFccSignatures>>));
  const signer = { name: config.fromName?.trim() || "Aidan Magee", ...(signatures[inbox] ?? {}) };
  if (remaining <= 0) return { status: "SKIPPED", reason: "daily cap reached" };
  let budget = options.limit ?? Number.POSITIVE_INFINITY;

  const columns = `c."id", c."email", c."firstName", c."company", c."filingsJson", c."step1SentAt", c."step1MessageId"`;
  const hotOpen = day <= FCC_NOV6_LAST_SEND_DAY;
  // While the hot list is open it owns its people. Once it closes, only those it reached stay out of the March queue,
  // counting a hot-list email claimed just before a crash: it may have gone out.
  const notOnHotList = `NOT EXISTS (SELECT 1 FROM "FccCampaignContact" h WHERE h."campaignKey" = ? AND h."email" = c."email" AND h."sendable" = 1 AND (? = 1 OR h."status" <> 'ready'
    OR EXISTS (SELECT 1 FROM "FccCampaignSend" hs WHERE hs."contactId" = h."id" AND hs."step" = 1 AND hs."status" <> 'FAILED')))`;
  const { results: followUps } = await db.prepare(`SELECT ${columns} FROM "FccCampaignContact" c
    WHERE c."campaignKey" = ? AND c."status" = 'step1_sent' AND c."step2DueAt" <= ? AND c."step1MessageId" IS NOT NULL
      AND COALESCE(c."senderAddress",'') = ?
      AND NOT EXISTS (SELECT 1 FROM "FccCampaignSend" s WHERE s."contactId" = c."id" AND s."step" = 2 AND s."status" <> 'FAILED')
      AND ${notOnHotList}
    ORDER BY c."step2DueAt", c."id" LIMIT 200`).bind(FCC_CAMPAIGN_KEY, day, inbox, FCC_NOV6_CAMPAIGN_KEY, hotOpen ? 1 : 0).all<ContactRow>();
  // The day-7 follow-up: anyone who got the first email and the day-3 one (any copy) from this inbox, once it's due.
  const { results: day7s } = await db.prepare(`SELECT ${columns}, s2."messageId" AS "step2MessageId" FROM "FccCampaignContact" c
    ${FCC_DAY7_JOIN_SQL}
    WHERE c."campaignKey" = ? AND c."status" = 'step2_sent' AND c."step1MessageId" IS NOT NULL AND c."step1SentAt" IS NOT NULL
      AND COALESCE(c."senderAddress",'') = ? AND ${FCC_DAY7_DUE_SQL} <= ?
      AND NOT EXISTS (SELECT 1 FROM "FccCampaignSend" s WHERE s."contactId" = c."id" AND s."step" = 3 AND s."status" <> 'FAILED')
      AND ${notOnHotList}
    ORDER BY ${FCC_DAY7_DUE_SQL}, c."id" LIMIT 200`).bind(FCC_CAMPAIGN_KEY, inbox, day, FCC_NOV6_CAMPAIGN_KEY, hotOpen ? 1 : 0).all<ContactRow>();
  // The hot list holds the companies whose Recertify flag was on, so onHotList picks which first email a person gets.
  const { results: firsts } = await db.prepare(`SELECT ${columns}, EXISTS (SELECT 1 FROM "FccCampaignContact" fh WHERE fh."campaignKey" = ? AND fh."email" = c."email") AS "onHotList"
    FROM "FccCampaignContact" c
    WHERE c."campaignKey" = ? AND c."status" = 'ready' AND c."sendable" = 1
      AND NOT EXISTS (SELECT 1 FROM "FccCampaignSend" s WHERE s."contactId" = c."id" AND s."step" = 1 AND s."status" <> 'FAILED')
      AND ${notOnHotList}
    ORDER BY CASE c."emailKind" WHEN 'compliance' THEN 0 WHEN 'named' THEN 1 ELSE 2 END, c."createdAt", c."id" LIMIT 200`)
    .bind(FCC_NOV6_CAMPAIGN_KEY, FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY, hotOpen ? 1 : 0).all<ContactRow>();
  const { results: hot } = hotOpen && config.primary !== false ? await db.prepare(`SELECT ${columns} FROM "FccCampaignContact" c
    WHERE c."campaignKey" = ? AND c."status" = 'ready' AND c."sendable" = 1
      AND NOT EXISTS (SELECT 1 FROM "FccCampaignSend" s WHERE s."contactId" = c."id" AND s."step" = 1 AND s."status" <> 'FAILED')
      AND NOT EXISTS (SELECT 1 FROM "FccCampaignContact" m WHERE m."email" = c."email" AND m."campaignKey" = ? AND m."status" IN ('replied','bounced','suppressed','held','failed')
        AND COALESCE(m."holdReason",'') || COALESCE(m."stoppedReason",'') NOT LIKE '%Signed a 2026 RMD declaration%')
    ORDER BY c."createdAt", c."id" LIMIT 1000`).bind(FCC_NOV6_CAMPAIGN_KEY, FCC_CAMPAIGN_KEY).all<ContactRow>() : { results: [] as ContactRow[] };
  if (followUps.length === 0 && day7s.length === 0 && firsts.length === 0 && hot.length === 0) return { status: "SKIPPED", reason: "nothing to send" };

  const counts = { firstEmails: 0, followUps: 0, day7FollowUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 0 };
  const shared = await sharedCampaignDomains(db);
  const fromDomain = domainOf(config.fromAddress);
  let transport: EmailTransport | null = null;
  let mailbox: FccMailbox | null = null;
  let followUpsHeldBack: string | null = null;

  const stop = async (contact: Pick<ContactRow, "id">, status: "replied" | "bounced" | "suppressed" | "failed", reason: string) => {
    await db.prepare(`UPDATE "FccCampaignContact" SET "status" = ?, "stoppedReason" = ?, "updatedAt" = ? WHERE "id" = ?`)
      .bind(status, reason.slice(0, 300), new Date().toISOString(), contact.id).run();
  };
  const suppressBounce = async (email: string) => {
    await db.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES (?,'BOUNCED') ON CONFLICT DO NOTHING`).bind(email).run();
  };

  /** Claims, sends and records one email. Returns false when sending should stop for today. */
  const send = async (contact: ContactRow, step: 1 | 2 | 3, hot = false): Promise<boolean> => {
    // Every email carries its first email's copy in its Message-ID, so results can be split by version and each
    // follow-up answers under the subject its first email used. New first emails split between two subjects, and
    // anyone the hot list never held gets the flag-off words.
    const copy: FccCopy = hot ? "nov6"
      : step !== 1 ? fccCopyOfMessageId(contact.step1MessageId)
      : contact.onHotList ? fccSubjectTestCopy(contact.id) : fccFlagOffCopy(contact.id);
    if (copy === "nov6" && !hot) {
      // Only the November 6 email itself carries this mark, and it has no follow-up.
      await stop(contact, "suppressed", "The November 6 email has no follow-up");
      counts.suppressed += 1;
      return true;
    }
    // Connect before claiming: a mailbox that refuses the login must not mark anyone as failed.
    transport ??= await config.transport!();
    const sendId = config.newId();
    const messageId = copy === "v3" ? `<fcc-${contact.id}-${step}@${fromDomain}>` : `<fcc-${copy}-${contact.id}-${step}@${fromDomain}>`;
    // Render before claiming, so a contact that cannot be rendered never takes a slot in today's cap.
    let filings: FccCampaignContact["filings"] = [];
    try { filings = JSON.parse(contact.filingsJson) as FccCampaignContact["filings"]; } catch { filings = []; }
    const recipient = { firstName: contact.firstName, company: contact.company, filings: filings.length ? filings : [{} as never] };
    // v3 is Aidan's own wording ("I'm Aidan Magee from Axiom"); everything since carries the sending founder's name.
    const email = copy === "nov6" ? renderFccEmailNov6({ firstName: contact.firstName, filings }, address, signer)
      : step === 3 ? renderFccEmailDay7(recipient, copy, address, signer.name)
      : copy === "v3" ? renderFccEmail(recipient, step, address) : renderFccEmailV5(recipient, step, address, signer, copy);
    // One statement, so two runs at once can never both pass the day's cap or the gap between emails.
    const claimedAt = now.toISOString();
    const gapSince = options.minGapMs ? new Date(now.getTime() - options.minGapMs).toISOString() : "9999-12-31";
    const claim = await db.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status","createdAt","senderAddress")
      SELECT ?,?,?,?,?,?,'CLAIMED',?,NULLIF(?,'')
      WHERE (SELECT COUNT(*) FROM "FccCampaignSend" WHERE "sendDay" = ? AND "status" IN ('CLAIMED','SENT') AND COALESCE("senderAddress",'') = ?) < ?
        AND NOT EXISTS (SELECT 1 FROM "FccCampaignSend" WHERE "sendDay" = ? AND "createdAt" > ? AND COALESCE("senderAddress",'') = ?)
      ON CONFLICT DO NOTHING`).bind(sendId, contact.id, step, contact.email, day, messageId, claimedAt, inbox, day, inbox, cap, day, gapSince, inbox).run();
    if (changes(claim) !== 1) {
      const taken = await db.prepare(`SELECT 1 AS hit FROM "FccCampaignSend" WHERE "contactId" = ? AND "step" = ? AND "status" <> 'FAILED'`)
        .bind(contact.id, step).first<{ hit: number }>();
      return Boolean(taken); // already claimed: try the next one; otherwise too soon or the cap: stop quietly
    }
    remaining -= 1;
    budget -= 1;
    // A follow-up answers the first email; the day-7 one answers the day-3 one and names both, so every mail app threads it.
    const thread: Record<string, string> = step === 1 || !contact.step1MessageId ? {}
      : step === 3 && contact.step2MessageId
        ? { "In-Reply-To": contact.step2MessageId, References: `${contact.step1MessageId} ${contact.step2MessageId}` }
        : { "In-Reply-To": contact.step1MessageId, References: contact.step1MessageId };
    try {
      await transport.send({
        to: contact.email, subject: email.subject, text: email.bodyPlain, ...(copy === "v3" ? {} : { html: email.bodyHtml }),
        headers: { "Message-ID": messageId, "List-Unsubscribe": `<mailto:${config.fromAddress}?subject=stop>`, ...thread },
      });
      const sentAt = new Date().toISOString();
      await db.prepare(`UPDATE "FccCampaignSend" SET "status"='SENT', "finishedAt"=? WHERE "sendId"=?`).bind(sentAt, sendId).run();
      if (hot) {
        // The hot list is one first email each: no day-3 follow-up is scheduled (step2DueAt stays NULL).
        await db.prepare(`UPDATE "FccCampaignContact" SET "status"='step1_sent', "step1SentAt"=?, "step1MessageId"=?, "step2DueAt"=NULL, "updatedAt"=?, "senderAddress"=NULLIF(?,'') WHERE "id"=?`)
          .bind(sentAt, messageId, sentAt, inbox, contact.id).run();
        counts.firstEmails += 1;
      } else if (step === 1) {
        await db.prepare(`UPDATE "FccCampaignContact" SET "status"='step1_sent', "step1SentAt"=?, "step1MessageId"=?, "step2DueAt"=?, "updatedAt"=?, "senderAddress"=NULLIF(?,'') WHERE "id"=?`)
          .bind(sentAt, messageId, addDays(day, FCC_FOLLOW_UP_DELAY_DAYS), sentAt, inbox, contact.id).run();
        counts.firstEmails += 1;
      } else if (step === 2) {
        await db.prepare(`UPDATE "FccCampaignContact" SET "status"='step2_sent', "step2SentAt"=?, "updatedAt"=? WHERE "id"=?`)
          .bind(sentAt, sentAt, contact.id).run();
        counts.followUps += 1;
      } else {
        // The day-7 email is the last. Its send row records it; the contact stays step2_sent, so the daily reply check keeps reading for an answer.
        await db.prepare(`UPDATE "FccCampaignContact" SET "updatedAt"=? WHERE "id"=?`).bind(sentAt, contact.id).run();
        counts.day7FollowUps += 1;
      }
      return true;
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      await db.prepare(`UPDATE "FccCampaignSend" SET "status"='FAILED', "detail"=?, "finishedAt"=? WHERE "sendId"=?`)
        .bind(detail, new Date().toISOString(), sendId).run();
      if (error instanceof PermanentEmailError && !SENDER_PROBLEM.test(detail)) {
        await stop(contact, "bounced", detail);
        await suppressBounce(contact.email);
        counts.bounced += 1;
        return true;
      }
      // Provider trouble (including Gmail's own limits and blocks, which also come back as 5xx):
      // stop for today, never hammer. The contact waits for a person to look.
      await stop(contact, "failed", detail);
      counts.failed += 1;
      return false;
    }
  };

  /**
   * The checks before a follow-up: the do-not-email list; for the day-7 one, anyone else at the company who replied,
   * was stopped, bounced or is held; then the inbox, for a reply from the company or a bounce since the first email.
   */
  const followUpCheck = async (contact: ContactRow, step: 2 | 3): Promise<"send" | "stopped" | "inbox down"> => {
    if (await isSuppressed(db, contact.email)) { await stop(contact, "suppressed", "On the do-not-email list"); counts.suppressed += 1; return "stopped"; }
    const domain = domainOf(contact.email);
    const companyDomain = !SHARED_MAIL_DOMAINS.has(domain) && !shared.has(domain);
    if (step === 3 && companyDomain) {
      // A hold for a generic inbox says nothing about the company.
      const colleague = await db.prepare(`SELECT 1 AS hit FROM "FccCampaignContact" WHERE "campaignKey" IN (?, ?) AND "email" LIKE ? AND "email" <> ?
        AND ("status" IN ('replied','suppressed','bounced') OR ("status" = 'held' AND COALESCE("holdReason",'') NOT LIKE '%eneric inbox%')) LIMIT 1`)
        .bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY, `%@${domain}`, contact.email).first<{ hit: number }>();
      if (colleague) {
        await stop(contact, "suppressed", "Someone else at this company replied, was stopped, bounced or is on hold, so no day-7 email");
        counts.suppressed += 1;
        return "stopped";
      }
    }
    const patterns = companyDomain ? [contact.email, `@${domain}`] : [contact.email];
    let replied = false;
    let bounced = false;
    try {
      mailbox ??= await config.mailbox!();
      replied = await mailbox.hasMessagesFrom(patterns, contact.step1SentAt!);
      bounced = !replied && await mailbox.hasBounceFor(contact.email, contact.step1SentAt!);
    } catch (error) {
      // Without a working inbox check nobody gets a follow-up this run; first emails still go out.
      followUpsHeldBack = `inbox check failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`;
      return "inbox down";
    }
    if (replied) {
      await stop(contact, "replied", step === 2 ? "They wrote back, so no follow-up" : "They wrote back, so no day-7 email");
      counts.replied += 1;
      return "stopped";
    }
    if (bounced) {
      await stop(contact, "bounced", step === 2 ? "The first email bounced" : "An earlier email bounced");
      await suppressBounce(contact.email);
      counts.bounced += 1;
      return "stopped";
    }
    return "send";
  };

  try {
    // The hot list goes first. When the cap or the gap runs out, this returns before any follow-up or first email.
    let inboxDown = false;
    for (const contact of hot) {
      if (remaining <= 0 || budget <= 0) return finish();
      if (await isSuppressed(db, contact.email)) { await stop(contact, "suppressed", "On the do-not-email list"); counts.suppressed += 1; continue; }
      // Someone else at this company replied, said stop, or was held for a reason about the company.
      const companyDomain = domainOf(contact.email);
      if (!SHARED_MAIL_DOMAINS.has(companyDomain) && !shared.has(companyDomain)) {
        const stoppedAtCompany = await db.prepare(`SELECT 1 AS hit FROM "FccCampaignContact" WHERE "campaignKey" IN (?, ?) AND "email" LIKE ?
          AND ("status" IN ('replied','suppressed') OR ("status" = 'held' AND COALESCE("holdReason",'') NOT LIKE '%eneric inbox%'))
          AND COALESCE("holdReason",'') || COALESCE("stoppedReason",'') NOT LIKE '%Signed a 2026 RMD declaration%' LIMIT 1`)
          .bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY, `%@${companyDomain}`).first<{ hit: number }>();
        if (stoppedAtCompany) { await stop(contact, "suppressed", "Someone else at this company replied, said stop or is on hold"); counts.suppressed += 1; continue; }
      }
      // Replies to the March email are only recorded when its follow-up comes up, and the hot list goes
      // first, so read the inbox here. If the inbox can't be read, this person waits; nobody else needs it.
      const march = await db.prepare(`SELECT "id","status","step1SentAt","createdAt" FROM "FccCampaignContact" WHERE "campaignKey" = ? AND "email" = ?`)
        .bind(FCC_CAMPAIGN_KEY, contact.email).first<{ id: string; status: string; step1SentAt: string | null; createdAt: string }>();
      {
        if (inboxDown) continue;
        const since = march?.step1SentAt ?? march?.createdAt ?? FCC_FIRST_SEND_DAY;
        const domain = domainOf(contact.email);
        const patterns = SHARED_MAIL_DOMAINS.has(domain) || shared.has(domain) ? [contact.email] : [contact.email, `@${domain}`];
        let replied = false;
        let bounced = false;
        try {
          mailbox ??= await config.mailbox!();
          replied = await mailbox.hasMessagesFrom(patterns, since);
          bounced = !replied && await mailbox.hasBounceFor(contact.email, since);
        } catch (error) {
          inboxDown = true;
          followUpsHeldBack = `inbox check failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`;
          continue;
        }
        if (replied || bounced) {
          // Their March row shows the same reply or bounce.
          const status = replied ? "replied" : "bounced";
          const reason = replied ? (march ? "They wrote back to the March email" : "Someone at this company wrote back") : "The March email bounced";
          await stop(contact, status, reason);
          if (march && (march.status === "ready" || march.status === "step1_sent")) await stop(march, status, reason);
          if (bounced) await suppressBounce(contact.email);
          counts[status] += 1;
          continue;
        }
      }
      if (!(await send(contact, 1, true))) return finish();
    }
    for (const contact of followUps) {
      if (remaining <= 0 || budget <= 0) break;
      const check = await followUpCheck(contact, 2);
      if (check === "inbox down") break;
      if (check === "send" && !(await send(contact, 2))) return finish();
    }
    // Day-7 follow-ups come after the day-3 ones, and only while the inbox can be read.
    for (const contact of followUpsHeldBack ? [] : day7s) {
      if (remaining <= 0 || budget <= 0) break;
      const check = await followUpCheck(contact, 3);
      if (check === "inbox down") break;
      if (check === "send" && !(await send(contact, 3))) return finish();
    }
    for (const contact of firsts) {
      if (remaining <= 0 || budget <= 0) break;
      if (await isSuppressed(db, contact.email)) { await stop(contact, "suppressed", "On the do-not-email list"); counts.suppressed += 1; continue; }
      if (!(await send(contact, 1))) return finish();
    }
    return finish();
  } finally {
    await (transport as EmailTransport | null)?.close().catch(() => undefined);
    await (mailbox as FccMailbox | null)?.close().catch(() => undefined);
  }

  function finish(): FccRunResult {
    return { status: "RAN", ...counts, remainingToday: Math.max(0, remaining), followUpsHeldBack };
  }
}
