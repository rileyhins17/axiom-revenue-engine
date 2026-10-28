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
 */
import { renderFccEmail, FCC_CAMPAIGN_KEY, FCC_DAILY_SEND_CAP, FCC_FOLLOW_UP_DELAY_DAYS, type FccCampaignContact } from "@/lib/fcc-campaign";
import { PermanentEmailError, type EmailTransport } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { imapDate, imapQuote, type ImapSession } from "@/lib/revenue-engine/imap-client";

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
  mailingAddress: string | null | undefined;
  transport: (() => Promise<EmailTransport>) | null;
  mailbox: (() => Promise<FccMailbox>) | null;
  newId: () => string;
};

export type FccRunResult =
  | { status: "SKIPPED"; reason: string }
  | {
    status: "RAN"; firstEmails: number; followUps: number; replied: number; bounced: number; suppressed: number; failed: number;
    remainingToday: number; followUpsHeldBack: string | null;
  };

type ContactRow = {
  id: string; email: string; firstName: string; company: string; filingsJson: string;
  step1SentAt: string | null; step1MessageId: string | null;
};

/** Mail services many unrelated people share; a reply from one of them says nothing about a company. */
const SHARED_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "hotmail.com", "outlook.com", "live.com",
  "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "bellsouth.net", "cox.net", "charter.net", "earthlink.net",
  "juno.com", "netzero.net",
]);

/**
 * Google notices that put the mailbox at risk. Any one of them pauses the whole
 * campaign until a founder looks (Aidan's send rules, Oct 27). Plain "Security
 * alert" emails (a new sign-in, an app password) are routine and do not count.
 */
const GOOGLE_WARNINGS: Array<[criteria: string, reason: string]> = [
  [`FROM "accounts.google.com" SUBJECT "critical security alert"`, "Google sent a critical security alert"],
  [`FROM "accounts.google.com" SUBJECT "suspicious"`, "Google reported suspicious activity"],
  [`FROM "mailer-daemon" BODY "limit for sending"`, "Gmail says the sending limit was reached"],
  [`FROM "mailer-daemon" BODY "sending limit"`, "Gmail says the sending limit was reached"],
  [`FROM "mailer-daemon" BODY "message blocked"`, "Gmail says a message was blocked"],
  [`FROM "mailer-daemon" BODY "has been blocked"`, "Gmail says a message was blocked"],
];

/** A 5xx that is about Gmail or the sender (a limit, a block, a login), not about the one recipient. */
const SENDER_PROBLEM = /\b5\.4\.5\b|\b5\.7\.\d+|limit|quota|blocked|spam|policy|auth|password|log ?in/i;

export const torontoDay = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
export const torontoWeekday = (now: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Toronto" }).format(now);
const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();
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

export async function fccSentToday(db: ProspectDb, day: string) {
  return Number((await db.prepare(`SELECT COUNT(*) AS n FROM "FccCampaignSend" WHERE "sendDay" = ? AND "status" IN ('CLAIMED','SENT')`)
    .bind(day).first<{ n: number }>())?.n ?? 0);
}

/** Domains used by more than one company in the campaign (e.g. a shared co-op host). */
async function sharedCampaignDomains(db: ProspectDb) {
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
  if (setting.approvedCopy !== FCC_CAMPAIGN_KEY) return "this copy version is not approved";
  if ((config.mailingAddress ?? "").trim().length < 10) return "no mailing address";
  if (!config.transport || !config.mailbox || !config.fromAddress) return "sender not configured";
  if (["Sat", "Sun"].includes(torontoWeekday(now))) return "weekend";
  return null;
}

/** Due follow-ups first, then new first emails, up to the day's cap (or `options.limit`). Safe to re-run. */
export async function runFccDailySend(db: ProspectDb, config: FccSendConfig, now = new Date(), options: FccRunOptions = {}): Promise<FccRunResult> {
  const setting = await fccSetting(db);
  const closed = fccClosedGate(setting, config, now);
  if (closed || !setting) return { status: "SKIPPED", reason: closed ?? "setting row missing" };
  const address = (config.mailingAddress ?? "").trim();

  const day = torontoDay(now);
  const cap = options.cap ?? Math.min(FCC_DAILY_SEND_CAP, Math.max(0, setting.dailyCap));
  let remaining = cap - await fccSentToday(db, day);
  if (remaining <= 0) return { status: "SKIPPED", reason: "daily cap reached" };
  let budget = options.limit ?? Number.POSITIVE_INFINITY;

  const columns = `c."id", c."email", c."firstName", c."company", c."filingsJson", c."step1SentAt", c."step1MessageId"`;
  const { results: followUps } = await db.prepare(`SELECT ${columns} FROM "FccCampaignContact" c
    WHERE c."campaignKey" = ? AND c."status" = 'step1_sent' AND c."step2DueAt" <= ? AND c."step1MessageId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "FccCampaignSend" s WHERE s."contactId" = c."id" AND s."step" = 2 AND s."status" IN ('CLAIMED','SENT'))
    ORDER BY c."step2DueAt", c."id" LIMIT 200`).bind(FCC_CAMPAIGN_KEY, day).all<ContactRow>();
  const { results: firsts } = await db.prepare(`SELECT ${columns} FROM "FccCampaignContact" c
    WHERE c."campaignKey" = ? AND c."status" = 'ready' AND c."sendable" = 1
      AND NOT EXISTS (SELECT 1 FROM "FccCampaignSend" s WHERE s."contactId" = c."id" AND s."step" = 1 AND s."status" IN ('CLAIMED','SENT'))
    ORDER BY CASE c."emailKind" WHEN 'compliance' THEN 0 WHEN 'named' THEN 1 ELSE 2 END, c."createdAt", c."id" LIMIT 200`)
    .bind(FCC_CAMPAIGN_KEY).all<ContactRow>();
  if (followUps.length === 0 && firsts.length === 0) return { status: "SKIPPED", reason: "nothing to send" };

  const counts = { firstEmails: 0, followUps: 0, replied: 0, bounced: 0, suppressed: 0, failed: 0 };
  const shared = await sharedCampaignDomains(db);
  const fromDomain = domainOf(config.fromAddress);
  let transport: EmailTransport | null = null;
  let mailbox: FccMailbox | null = null;

  const stop = async (contact: ContactRow, status: "replied" | "bounced" | "suppressed" | "failed", reason: string) => {
    await db.prepare(`UPDATE "FccCampaignContact" SET "status" = ?, "stoppedReason" = ?, "updatedAt" = ? WHERE "id" = ?`)
      .bind(status, reason.slice(0, 300), new Date().toISOString(), contact.id).run();
  };
  const suppressBounce = async (email: string) => {
    await db.prepare(`INSERT INTO "EngineEmailSuppression" ("email","reason") VALUES (?,'BOUNCED') ON CONFLICT DO NOTHING`).bind(email).run();
  };

  /** Claims, sends and records one email. Returns false when sending should stop for today. */
  const send = async (contact: ContactRow, step: 1 | 2): Promise<boolean> => {
    // Connect before claiming: a mailbox that refuses the login must not mark anyone as failed.
    transport ??= await config.transport!();
    const sendId = config.newId();
    const messageId = `<fcc-${contact.id}-${step}@${fromDomain}>`;
    // One statement, so two runs at once can never both pass the day's cap or the gap between emails.
    const claimedAt = now.toISOString();
    const gapSince = options.minGapMs ? new Date(now.getTime() - options.minGapMs).toISOString() : "9999-12-31";
    const claim = await db.prepare(`INSERT INTO "FccCampaignSend" ("sendId","contactId","step","email","sendDay","messageId","status","createdAt")
      SELECT ?,?,?,?,?,?,'CLAIMED',?
      WHERE (SELECT COUNT(*) FROM "FccCampaignSend" WHERE "sendDay" = ? AND "status" IN ('CLAIMED','SENT')) < ?
        AND NOT EXISTS (SELECT 1 FROM "FccCampaignSend" WHERE "sendDay" = ? AND "createdAt" > ?)
      ON CONFLICT DO NOTHING`).bind(sendId, contact.id, step, contact.email, day, messageId, claimedAt, day, cap, day, gapSince).run();
    if (changes(claim) !== 1) {
      const taken = await db.prepare(`SELECT 1 AS hit FROM "FccCampaignSend" WHERE "contactId" = ? AND "step" = ? AND "status" <> 'FAILED'`)
        .bind(contact.id, step).first<{ hit: number }>();
      return Boolean(taken); // already claimed: try the next one; otherwise too soon or the cap: stop quietly
    }
    remaining -= 1;
    budget -= 1;
    let filings: FccCampaignContact["filings"] = [];
    try { filings = JSON.parse(contact.filingsJson) as FccCampaignContact["filings"]; } catch { filings = []; }
    const email = renderFccEmail({ firstName: contact.firstName, company: contact.company, filings: filings.length ? filings : [{} as never] }, step, address);
    const thread: Record<string, string> = step === 2 && contact.step1MessageId
      ? { "In-Reply-To": contact.step1MessageId, References: contact.step1MessageId }
      : {};
    try {
      await transport.send({
        to: contact.email, subject: email.subject, text: email.bodyPlain,
        headers: { "Message-ID": messageId, "List-Unsubscribe": `<mailto:${config.fromAddress}?subject=stop>`, ...thread },
      });
      const sentAt = new Date().toISOString();
      await db.prepare(`UPDATE "FccCampaignSend" SET "status"='SENT', "finishedAt"=? WHERE "sendId"=?`).bind(sentAt, sendId).run();
      if (step === 1) {
        await db.prepare(`UPDATE "FccCampaignContact" SET "status"='step1_sent', "step1SentAt"=?, "step1MessageId"=?, "step2DueAt"=?, "updatedAt"=? WHERE "id"=?`)
          .bind(sentAt, messageId, addDays(day, FCC_FOLLOW_UP_DELAY_DAYS), sentAt, contact.id).run();
        counts.firstEmails += 1;
      } else {
        await db.prepare(`UPDATE "FccCampaignContact" SET "status"='step2_sent', "step2SentAt"=?, "updatedAt"=? WHERE "id"=?`)
          .bind(sentAt, sentAt, contact.id).run();
        counts.followUps += 1;
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

  let followUpsHeldBack: string | null = null;
  try {
    for (const contact of followUps) {
      if (remaining <= 0 || budget <= 0) break;
      if (await isSuppressed(db, contact.email)) { await stop(contact, "suppressed", "On the do-not-email list"); counts.suppressed += 1; continue; }
      const domain = domainOf(contact.email);
      const patterns = SHARED_MAIL_DOMAINS.has(domain) || shared.has(domain) ? [contact.email] : [contact.email, `@${domain}`];
      let replied = false;
      let bounced = false;
      try {
        mailbox ??= await config.mailbox!();
        replied = await mailbox.hasMessagesFrom(patterns, contact.step1SentAt!);
        bounced = !replied && await mailbox.hasBounceFor(contact.email, contact.step1SentAt!);
      } catch (error) {
        // Without a working inbox check nobody gets a follow-up today; first emails still go out.
        followUpsHeldBack = `inbox check failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`;
        break;
      }
      if (replied) { await stop(contact, "replied", "They wrote back, so no follow-up"); counts.replied += 1; continue; }
      if (bounced) {
        await stop(contact, "bounced", "The first email bounced");
        await suppressBounce(contact.email);
        counts.bounced += 1;
        continue;
      }
      if (!(await send(contact, 2))) return finish();
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
