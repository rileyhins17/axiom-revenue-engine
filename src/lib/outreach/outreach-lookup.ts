/**
 * Looking someone up, read-only: is an address or a whole domain blocked from every campaign and why
 * (the Do-not-email screen), and where a person or organisation stands in every campaign (a campaign's
 * People search, and the Claude connector's find_contact).
 *
 * "Blocked" is exactly the sender's own rule (outreach-blocked.ts): the address or its whole domain is on
 * the do-not-email list, or it bounced or said "no thanks" in any campaign or in FCC.
 */
import { FCC_SAID_NO_SQL, addressBlocked } from "@/lib/outreach/outreach-blocked";
import { readCampaigns } from "@/lib/outreach/outreach-model";
import { organisationOf, parseFields, personOf } from "@/lib/outreach/outreach-reply-list";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export type BlockReason = {
  address: string;
  /** In plain words: "The email bounced", "They said no thanks", ... */
  why: string;
  kind: "bounced" | "no_thanks" | "do_not_contact" | "founder";
  at: string | null;
  /** The campaign it happened in, when known ("FCC (ended)" for FCC). */
  campaign: string | null;
  /** What they wrote or what the bounce said, when stored. */
  detail: string | null;
};
export type DoNotEmailCheck = {
  query: string;
  kind: "address" | "domain" | "unreadable";
  /** Whether a campaign may email it. For a domain: true only when the whole domain is blocked. */
  blocked: boolean;
  /** One plain sentence. */
  summary: string;
  reasons: BlockReason[];
  /** For an address that is not blocked: someone else at the same organisation who replied or was stopped, which holds new emails there. */
  organisation: Array<{ email: string; campaign: string; status: string; at: string | null }>;
};

const LIST_REASON: Record<string, { kind: BlockReason["kind"]; why: string }> = {
  BOUNCED: { kind: "bounced", why: "An email to it bounced" },
  UNSUBSCRIBED: { kind: "no_thanks", why: "They said no thanks" },
  DO_NOT_CONTACT: { kind: "do_not_contact", why: "Marked do not contact" },
  OWNER: { kind: "founder", why: "Blocked by a founder" },
};
const like = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

/** "City.gov", "@city.gov", "Clerk@City.gov" → what was asked about. */
export function readQuery(input: string): { kind: "address" | "domain"; value: string } | null {
  const value = input.trim().toLowerCase().replace(/^mailto:/, "");
  if (!value || value.length > 254 || /\s/.test(value)) return null;
  if (/^[^@]+@[^@]+\.[^@]+$/.test(value)) return { kind: "address", value };
  const domain = value.replace(/^@/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? { kind: "domain", value: domain } : null;
}

async function reasonsFor(db: ProspectDb, where: { address?: string; domain?: string }, names: Map<string, string>): Promise<BlockReason[]> {
  const match = where.address ? `= ?` : `LIKE ? ESCAPE '\\'`;
  const bind = where.address ?? `%@${like(where.domain!)}`;
  const [list, fcc, bounced, saidNo] = await Promise.all([
    db.prepare(`SELECT s."email", s."reason", s."createdAt",
        (SELECT c."campaignKey" FROM "OutreachContact" c WHERE c."email" = s."email" ORDER BY c."updatedAt" DESC LIMIT 1) AS campaign,
        (SELECT 1 FROM "FccCampaignContact" f WHERE lower(f."email") = s."email" LIMIT 1) AS inFcc
      FROM "EngineEmailSuppression" s WHERE s."email" ${match} ${where.domain ? `OR s."email" = ?` : ""} ORDER BY s."createdAt" DESC LIMIT 100`)
      .bind(...(where.domain ? [bind, `@${where.domain}`] : [bind])).all<{ email: string; reason: string; createdAt: string | null; campaign: string | null; inFcc: number | null }>(),
    db.prepare(`SELECT lower(f."email") AS email, f."status", f."stoppedReason" AS detail, f."updatedAt" AS at FROM "FccCampaignContact" f
      WHERE lower(f."email") ${match} AND (f."status" = 'bounced' OR ${FCC_SAID_NO_SQL}) ORDER BY f."updatedAt" DESC LIMIT 100`).bind(bind)
      .all<{ email: string; status: string; detail: string | null; at: string | null }>(),
    db.prepare(`SELECT "email", "campaignKey", "stoppedReason" AS detail, "updatedAt" AS at FROM "OutreachContact" WHERE "email" ${match} AND "status" = 'bounced' ORDER BY "updatedAt" DESC LIMIT 100`)
      .bind(bind).all<{ email: string; campaignKey: string; detail: string | null; at: string | null }>(),
    db.prepare(`SELECT o."email", o."campaignKey", r."fromAddress", r."quote" AS detail, COALESCE(r."receivedAt", r."foundAt") AS at
      FROM "OutreachReply" r JOIN "OutreachContact" o ON o."id" = r."contactId" WHERE o."email" ${match} AND r."kind" = 'no_thanks' ORDER BY at DESC LIMIT 100`)
      .bind(bind).all<{ email: string; campaignKey: string; fromAddress: string; detail: string | null; at: string | null }>(),
  ]);
  const reasons: BlockReason[] = [];
  const seen = new Set<string>();
  const add = (reason: BlockReason) => {
    const key = `${reason.address}|${reason.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    reasons.push(reason);
  };
  // The most specific first: what happened in a campaign, then FCC, then the bare list row.
  for (const row of saidNo.results) {
    add({ address: row.email, kind: "no_thanks", why: row.fromAddress && row.fromAddress !== row.email ? `A colleague (${row.fromAddress}) said no thanks` : "They said no thanks",
      at: row.at, campaign: names.get(row.campaignKey) ?? row.campaignKey, detail: row.detail });
  }
  for (const row of bounced.results) add({ address: row.email, kind: "bounced", why: "An email to it bounced", at: row.at, campaign: names.get(row.campaignKey) ?? row.campaignKey, detail: row.detail });
  for (const row of fcc.results) {
    add({ address: row.email, kind: row.status === "bounced" ? "bounced" : "no_thanks", why: row.status === "bounced" ? "An email to it bounced" : "They said no thanks",
      at: row.at, campaign: "FCC (ended)", detail: row.detail });
  }
  for (const row of list.results) {
    const reason = LIST_REASON[row.reason] ?? { kind: "do_not_contact" as const, why: "On the do-not-email list" };
    const wholeDomain = row.email.startsWith("@");
    add({ address: row.email, kind: reason.kind, why: wholeDomain ? `The whole domain is blocked (${reason.why.toLowerCase()})` : reason.why, at: row.createdAt,
      campaign: row.campaign ? names.get(row.campaign) ?? row.campaign : row.inFcc ? "FCC (ended)" : null, detail: null });
  }
  return reasons.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/** Is this address (or domain) blocked from every campaign, and why. */
export async function checkDoNotEmail(db: ProspectDb, input: string): Promise<DoNotEmailCheck> {
  const query = readQuery(input);
  if (!query) return { query: input.trim().slice(0, 254), kind: "unreadable", blocked: false, summary: "Type a full email address or a domain, like clerk@example.gov or example.gov.", reasons: [], organisation: [] };
  const names = new Map((await readCampaigns(db)).map((campaign) => [campaign.key, campaign.name]));
  if (query.kind === "domain") {
    const reasons = await reasonsFor(db, { domain: query.value }, names);
    const whole = reasons.some((reason) => reason.address === `@${query.value}`);
    const addresses = new Set(reasons.filter((reason) => !reason.address.startsWith("@")).map((reason) => reason.address)).size;
    return {
      query: query.value, kind: "domain", blocked: whole, reasons, organisation: [],
      summary: whole ? `Every address at ${query.value} is blocked. No campaign emails it.`
        : addresses ? `${query.value} is not blocked as a whole, but ${addresses} address${addresses === 1 ? "" : "es"} at it ${addresses === 1 ? "is" : "are"}.`
          : `Nothing at ${query.value} is blocked.`,
    };
  }
  const [blocked, reasons, organisation] = await Promise.all([
    addressBlocked(db, query.value),
    reasonsFor(db, { address: query.value }, names),
    db.prepare(`SELECT "email", "campaignKey", "status", "updatedAt" AS at FROM "OutreachContact" WHERE "email" LIKE ? ESCAPE '\\' AND "email" <> ? AND "status" IN ('replied','suppressed')
      ORDER BY "updatedAt" DESC LIMIT 10`).bind(`%@${like(domainOf(query.value))}`, query.value).all<{ email: string; campaignKey: string; status: string; at: string | null }>(),
  ]);
  // The whole-domain rows live under "@domain": fetch them when the address itself has no row but is blocked.
  const all = blocked && reasons.length === 0 ? (await reasonsFor(db, { domain: domainOf(query.value) }, names)).filter((reason) => reason.address.startsWith("@")) : reasons;
  return {
    query: query.value, kind: "address", blocked, reasons: all,
    organisation: organisation.results.map((row) => ({ email: row.email, campaign: names.get(row.campaignKey) ?? row.campaignKey, status: row.status === "replied" ? "replied" : "said no thanks or was stopped", at: row.at })),
    summary: blocked ? `${query.value} is blocked. No campaign will email it.` : `${query.value} is not blocked.`,
  };
}

export type RecentBlock = { address: string; why: string; at: string | null };

/** The newest rows on the do-not-email list, and how long the list is. */
export async function recentBlocks(db: ProspectDb, limit = 30): Promise<{ total: number; bounced: number; noThanks: number; rows: RecentBlock[] }> {
  const [count, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total, SUM("reason" = 'BOUNCED') AS bounced, SUM("reason" = 'UNSUBSCRIBED') AS noThanks FROM "EngineEmailSuppression"`).bind()
      .first<{ total: number; bounced: number | null; noThanks: number | null }>(),
    db.prepare(`SELECT "email", "reason", "createdAt" FROM "EngineEmailSuppression" ORDER BY "createdAt" DESC LIMIT ?`).bind(limit).all<{ email: string; reason: string; createdAt: string | null }>(),
  ]);
  return {
    total: Number(count?.total ?? 0), bounced: Number(count?.bounced ?? 0), noThanks: Number(count?.noThanks ?? 0),
    rows: rows.results.map((row) => ({ address: row.email, why: (LIST_REASON[row.reason] ?? { why: "On the do-not-email list" }).why, at: row.createdAt })),
  };
}

export type ContactHit = {
  id: string; campaignKey: string; campaign: string; batchId: string; batch: string;
  email: string; person: string | null; organisation: string;
  status: string;
  /** The status in plain words: "Waiting for its first email", "Emailed, follow-up Nov 17", ... */
  statusText: string;
  emailsSent: number; firstSentAt: string | null; sentFrom: string | null; nextDueDay: string | null;
  /** Why it is held or stopped, when it is. */
  reason: string | null;
  replies: number;
};

const dayText = (day: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));

export function contactStatusText(row: { status: string; stepsSent: number; nextDueDay: string | null; batchStatus: string }) {
  switch (row.status) {
    case "ready": return row.batchStatus === "approved" ? "Waiting for its first email" : row.batchStatus === "stopped" ? "Never emailed: its batch was stopped" : "Waiting for its batch to be approved";
    case "held": return "Held: never emailed";
    case "sent": return row.nextDueDay ? `Emailed, follow-up due ${dayText(row.nextDueDay)}` : "Emailed, follow-up on hold";
    case "done": return `Every email sent (${row.stepsSent})`;
    case "replied": return "Replied: no more emails";
    case "bounced": return "Bounced: never emailed again";
    case "suppressed": return "Stopped: said no thanks or is on the do-not-email list";
    case "failed": return "A send failed: waits for a person";
    default: return row.status;
  }
}

/** Everyone whose address or list row matches `query`, in one campaign or all of them, newest first. */
export async function findContacts(db: ProspectDb, input: string, options: { campaign?: string | null; limit?: number } = {}): Promise<ContactHit[]> {
  const query = input.trim().toLowerCase().slice(0, 120);
  if (query.length < 2) return [];
  const limit = Math.max(1, Math.min(100, options.limit ?? 25));
  const pattern = `%${like(query)}%`;
  const [campaigns, { results }] = await Promise.all([
    readCampaigns(db),
    db.prepare(`SELECT c."id", c."campaignKey", c."batchId", b."name" AS batch, b."status" AS batchStatus, c."email", c."fieldsJson", c."status", c."stepsSent", c."firstSentAt", c."senderAddress",
        c."nextDueDay", c."holdReason", c."stoppedReason", (SELECT COUNT(*) FROM "OutreachReply" r WHERE r."contactId" = c."id") AS replies
      FROM "OutreachContact" c JOIN "OutreachBatch" b ON b."id" = c."batchId"
      WHERE (c."email" LIKE ? ESCAPE '\\' OR lower(c."fieldsJson") LIKE ? ESCAPE '\\') ${options.campaign ? `AND c."campaignKey" = ?` : ""}
      ORDER BY c."updatedAt" DESC LIMIT ?`).bind(pattern, pattern, ...(options.campaign ? [options.campaign] : []), limit)
      .all<{ id: string; campaignKey: string; batchId: string; batch: string; batchStatus: string; email: string; fieldsJson: string; status: string; stepsSent: number; firstSentAt: string | null;
        senderAddress: string | null; nextDueDay: string | null; holdReason: string | null; stoppedReason: string | null; replies: number }>(),
  ]);
  const names = new Map(campaigns.map((campaign) => [campaign.key, campaign.name]));
  return results.map((row) => {
    const fields = parseFields(row.fieldsJson);
    return {
      id: row.id, campaignKey: row.campaignKey, campaign: names.get(row.campaignKey) ?? row.campaignKey, batchId: row.batchId, batch: row.batch,
      email: row.email, person: personOf(fields), organisation: organisationOf(fields, row.email), status: row.status,
      statusText: contactStatusText({ status: row.status, stepsSent: Number(row.stepsSent), nextDueDay: row.nextDueDay, batchStatus: row.batchStatus }),
      emailsSent: Number(row.stepsSent), firstSentAt: row.firstSentAt, sentFrom: row.senderAddress, nextDueDay: row.nextDueDay,
      reason: row.status === "held" ? row.holdReason : row.stoppedReason, replies: Number(row.replies),
    };
  });
}
