/**
 * The Replies screen: every message the hourly inbox check recorded (OutreachReply), newest first, with who
 * should answer it and from which inbox, and the two marks a founder can put on a reply (migration 0091):
 *
 * - answered: someone wrote back to them, so it leaves "To answer";
 * - success: this reply counts toward the campaign's success number (cities: they asked for the report or a
 *   price), which the founders judge each campaign by.
 *
 * Reading changes nothing. The marks touch only OutreachReply's four mark columns: nothing about sending,
 * follow-ups, the do-not-email list or anyone's mail reads them. The engine never changes mail.
 *
 * A reply the sender's own check found before a follow-up has no message row (only the contact says "replied").
 * It is listed with the id "contact:<contact id>"; marking it stores a row under that id, so the mark has a home.
 */
import { FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY } from "@/lib/fcc-campaign";
import { firstNameOf } from "@/lib/outreach/outreach-inbox-health";
import { readCampaigns, readInboxes, successLabelOf, type Inbox } from "@/lib/outreach/outreach-model";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export type ReplyKind = "reply" | "automatic" | "no_thanks";
export type ReplyFilter = "to-answer" | "answered" | "automatic" | "no-thanks" | "all";
export const REPLY_FILTERS: ReplyFilter[] = ["to-answer", "answered", "automatic", "no-thanks", "all"];
/** The campaign filter value that lists FCC's replies (read-only: FCC ended Nov 12, 2026). */
export const FCC_FILTER = "fcc";

export type ReplyRow = {
  id: string;
  source: "campaign" | "fcc";
  campaignKey: string; campaign: string;
  kind: ReplyKind;
  /** The person we emailed (their name when the list had one) and their organisation. */
  person: string | null; organisation: string;
  /** The address we emailed, and who wrote back (a colleague may answer for them). */
  email: string; from: string;
  at: string | null;
  /** What they wrote: the first lines the reply check stored (up to 600 characters). */
  text: string | null;
  /** Where the reply landed, and the inbox that sent them the email: answer from that one, so the thread holds. */
  landedIn: string | null; answerFrom: string | null; answerFromName: string | null;
  /** A link that searches the inbox where it landed for their message. A link only. Null when it isn't Gmail. */
  gmailUrl: string | null;
  answeredAt: string | null; answeredBy: string | null;
  success: boolean; successBy: string | null; successLabel: string;
  /** False for FCC's replies: they can't be marked. */
  canMark: boolean;
};

export type ReplyQuery = { filter?: ReplyFilter; campaign?: string | null; since?: string | null; limit?: number };
export type ReplyList = {
  rows: ReplyRow[];
  /** How many replies each filter holds, for the chosen campaign (or all campaigns). */
  counts: Record<ReplyFilter, number>;
  campaigns: Array<{ key: string; name: string; replies: number }>;
  fccReplies: number;
};

type Fields = Record<string, string>;
const ORGANISATION_COLUMNS = ["organisation", "organization", "company", "agency", "city", "county", "district", "school_district", "school", "business"];
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function parseFields(json: string | null | undefined): Fields {
  try {
    const value = JSON.parse(json ?? "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};
  } catch { return {}; }
}

/** The organisation a row is about: the first list column that names one, else the address's domain. */
export function organisationOf(fields: Fields, email: string) {
  for (const column of ORGANISATION_COLUMNS) if (text(fields[column])) return text(fields[column]);
  return email.slice(email.lastIndexOf("@") + 1) || email;
}

/** The person's name and title, when the list had them. */
export function personOf(fields: Fields) {
  const name = text(fields.name) || text(fields.full_name) || text(fields.contact_name) || [text(fields.first_name), text(fields.last_name)].filter(Boolean).join(" ");
  const title = text(fields.title) || text(fields.role);
  return name ? (title ? `${name}, ${title}` : name) : title || null;
}

export function gmailSearchUrl(inbox: string, from: string) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(inbox)}#search/${encodeURIComponent(`from:${from}`)}`;
}

const isGmail = (inbox: Inbox | undefined) => Boolean(inbox && /(^|\.)gmail\.com$/i.test(inbox.imapHost.trim()));
const AUTOMATIC = /automatic reply/i;
const SAID_NO = /said no thanks|no thank|not interested|unsubscribe|remove (me|us)|\bstop\b/i;

type RawRow = {
  id: string; campaignKey: string; contactId: string; inbox: string | null; fromAddress: string | null; receivedAt: string | null; foundAt: string | null; quote: string | null; kind: string;
  answeredAt: string | null; answeredBy: string | null; successAt: string | null; successBy: string | null;
  email: string; fieldsJson: string; senderAddress: string | null; stoppedReason: string | null;
};

const RECORDED = `SELECT r."id", r."campaignKey", r."contactId", r."inbox", r."fromAddress", r."receivedAt", r."foundAt", r."quote", r."kind",
    r."answeredAt", r."answeredBy", r."successAt", r."successBy", c."email", c."fieldsJson", c."senderAddress", c."stoppedReason"
  FROM "OutreachReply" r JOIN "OutreachContact" c ON c."id" = r."contactId"`;
// A contact the sender's own check stopped as replied, with no message row at all.
const UNRECORDED = `SELECT 'contact:' || c."id" AS "id", c."campaignKey", c."id" AS "contactId", NULL AS "inbox", NULL AS "fromAddress", c."updatedAt" AS "receivedAt", c."updatedAt" AS "foundAt",
    NULL AS "quote", CASE WHEN lower(COALESCE(c."stoppedReason",'')) LIKE '%automatic reply%' THEN 'automatic' ELSE 'reply' END AS "kind",
    NULL AS "answeredAt", NULL AS "answeredBy", NULL AS "successAt", NULL AS "successBy", c."email", c."fieldsJson", c."senderAddress", c."stoppedReason"
  FROM "OutreachContact" c WHERE c."status" = 'replied' AND NOT EXISTS (SELECT 1 FROM "OutreachReply" r WHERE r."contactId" = c."id")`;
const ALL = `(${RECORDED} UNION ALL ${UNRECORDED})`;
const WHEN = `COALESCE(x."receivedAt", x."foundAt")`;

const FILTER_SQL: Record<ReplyFilter, string> = {
  "to-answer": `x."kind" = 'reply' AND x."answeredAt" IS NULL`,
  answered: `x."kind" = 'reply' AND x."answeredAt" IS NOT NULL`,
  automatic: `x."kind" = 'automatic'`,
  "no-thanks": `x."kind" = 'no_thanks'`,
  all: "1 = 1",
};

function shape(row: RawRow, names: Map<string, string>, labels: Map<string, string>, inboxes: Inbox[]): ReplyRow {
  const fields = parseFields(row.fieldsJson);
  const landed = row.inbox ?? row.senderAddress;
  const answerFrom = row.senderAddress ?? row.inbox;
  const answerInbox = inboxes.find((inbox) => inbox.address === answerFrom);
  const from = row.fromAddress ?? row.email;
  return {
    id: row.id, source: "campaign", campaignKey: row.campaignKey, campaign: names.get(row.campaignKey) ?? row.campaignKey,
    kind: row.kind === "automatic" ? "automatic" : row.kind === "no_thanks" ? "no_thanks" : "reply",
    person: personOf(fields), organisation: organisationOf(fields, row.email), email: row.email, from,
    at: row.receivedAt ?? row.foundAt, text: row.quote ?? row.stoppedReason,
    landedIn: landed, answerFrom, answerFromName: answerFrom ? firstNameOf(answerInbox?.name ?? "", answerFrom) : null,
    gmailUrl: landed && isGmail(inboxes.find((inbox) => inbox.address === landed)) ? gmailSearchUrl(landed, from) : null,
    answeredAt: row.answeredAt, answeredBy: row.answeredBy, success: Boolean(row.successAt), successBy: row.successBy,
    successLabel: labels.get(row.campaignKey) ?? "Interested replies", canMark: true,
  };
}

async function context(db: ProspectDb) {
  const [campaigns, inboxes] = await Promise.all([readCampaigns(db), readInboxes(db)]);
  return {
    campaigns, inboxes,
    names: new Map(campaigns.map((campaign) => [campaign.key, campaign.name])),
    labels: new Map(campaigns.map((campaign) => [campaign.key, successLabelOf(campaign)])),
  };
}

/** FCC's replies, straight from its contact rows (it has no message table). Read-only. */
async function fccReplies(db: ProspectDb, filter: ReplyFilter, limit: number): Promise<ReplyRow[]> {
  const { results } = await db.prepare(`SELECT "company","email",MAX("updatedAt") AS at,"stoppedReason" AS note FROM "FccCampaignContact"
    WHERE "campaignKey" IN (?, ?) AND "status" = 'replied' GROUP BY "email" ORDER BY at DESC LIMIT 200`).bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY)
    .all<{ company: string; email: string; at: string; note: string | null }>();
  const rows = results.map((row): ReplyRow => {
    const kind: ReplyKind = AUTOMATIC.test(row.note ?? "") ? "automatic" : SAID_NO.test(row.note ?? "") ? "no_thanks" : "reply";
    return {
      id: `fcc:${row.email}`, source: "fcc", campaignKey: FCC_FILTER, campaign: "FCC (ended)", kind, person: null, organisation: row.company, email: row.email, from: row.email,
      at: row.at, text: row.note, landedIn: null, answerFrom: null, answerFromName: null, gmailUrl: null,
      answeredAt: null, answeredBy: null, success: false, successBy: null, successLabel: "", canMark: false,
    };
  });
  const keep = (row: ReplyRow) => filter === "all" ? true : filter === "automatic" ? row.kind === "automatic" : filter === "no-thanks" ? row.kind === "no_thanks"
    : filter === "to-answer" ? row.kind === "reply" : false;
  return rows.filter(keep).slice(0, limit);
}

/** The replies for one filter and (optionally) one campaign, newest first, with the count each filter holds. */
export async function listReplies(db: ProspectDb, query: ReplyQuery = {}): Promise<ReplyList> {
  const filter = query.filter ?? "to-answer";
  const limit = Math.max(1, Math.min(200, query.limit ?? 100));
  const fcc = query.campaign === FCC_FILTER;
  const campaignKey = fcc ? null : query.campaign || null;
  const where = [FILTER_SQL[filter], campaignKey ? `x."campaignKey" = ?` : null, query.since ? `${WHEN} >= ?` : null].filter(Boolean).join(" AND ");
  const binds = [...(campaignKey ? [campaignKey] : []), ...(query.since ? [query.since] : [])];
  const [{ campaigns, inboxes, names, labels }, list, counts, perCampaign, fccCount] = await Promise.all([
    context(db),
    fcc ? Promise.resolve({ results: [] as RawRow[] }) : db.prepare(`SELECT x.* FROM ${ALL} x WHERE ${where} ORDER BY ${WHEN} DESC LIMIT ?`).bind(...binds, limit).all<RawRow>(),
    db.prepare(`SELECT ${REPLY_FILTERS.map((name) => `SUM(${FILTER_SQL[name]}) AS "${name}"`).join(", ")} FROM ${ALL} x ${campaignKey ? `WHERE x."campaignKey" = ?` : ""}`)
      .bind(...(campaignKey ? [campaignKey] : [])).first<Record<string, number | null>>(),
    db.prepare(`SELECT x."campaignKey" AS key, COUNT(*) AS n FROM ${ALL} x GROUP BY 1`).bind().all<{ key: string; n: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT "email") AS n FROM "FccCampaignContact" WHERE "campaignKey" IN (?, ?) AND "status" = 'replied'`).bind(FCC_CAMPAIGN_KEY, FCC_NOV6_CAMPAIGN_KEY)
      .first<{ n: number }>().catch(() => null),
  ]);
  const rows = fcc ? await fccReplies(db, filter, limit) : list.results.map((row) => shape(row, names, labels, inboxes));
  const count = (name: ReplyFilter) => Number(counts?.[name] ?? 0);
  return {
    rows,
    counts: { "to-answer": count("to-answer"), answered: count("answered"), automatic: count("automatic"), "no-thanks": count("no-thanks"), all: count("all") },
    campaigns: campaigns.map((campaign) => ({ key: campaign.key, name: campaign.name, replies: Number(perCampaign.results.find((row) => row.key === campaign.key)?.n ?? 0) })),
    fccReplies: Number(fccCount?.n ?? 0),
  };
}

/** One reply with everything stored about it, or null. */
export async function getReply(db: ProspectDb, id: string): Promise<ReplyRow | null> {
  if (id.startsWith("fcc:")) return (await fccReplies(db, "all", 200)).find((row) => row.id === id) ?? null;
  const row = await db.prepare(`SELECT x.* FROM ${ALL} x WHERE x."id" = ?`).bind(id).first<RawRow>();
  if (!row) return null;
  const { inboxes, names, labels } = await context(db);
  return shape(row, names, labels, inboxes);
}

export type RepliesToAnswer = {
  count: number;
  /** How many wait at each inbox (the one that sent the email: its owner answers), most first. */
  byInbox: Array<{ address: string | null; name: string | null; count: number }>;
  newest: ReplyRow[];
};

/** The real replies nobody has answered yet: how many, whose inbox they are answered from, and the newest few. */
export async function repliesToAnswer(db: ProspectDb, newest = 2): Promise<RepliesToAnswer> {
  const [{ inboxes, names, labels }, groups, list] = await Promise.all([
    context(db),
    db.prepare(`SELECT COALESCE(x."senderAddress", x."inbox") AS address, COUNT(*) AS n FROM ${ALL} x WHERE ${FILTER_SQL["to-answer"]} GROUP BY 1 ORDER BY n DESC`).bind()
      .all<{ address: string | null; n: number }>(),
    db.prepare(`SELECT x.* FROM ${ALL} x WHERE ${FILTER_SQL["to-answer"]} ORDER BY ${WHEN} DESC LIMIT ?`).bind(newest).all<RawRow>(),
  ]);
  const byInbox = groups.results.map((row) => ({
    address: row.address, count: Number(row.n),
    name: row.address ? firstNameOf(inboxes.find((inbox) => inbox.address === row.address)?.name ?? "", row.address) : null,
  }));
  return { count: byInbox.reduce((sum, row) => sum + row.count, 0), byInbox, newest: list.results.map((row) => shape(row, names, labels, inboxes)) };
}

export type ReplyMark = { answered?: boolean; success?: boolean };
export type MarkResult = { ok: true; reply: ReplyRow } | { ok: false; why: string };

/**
 * A founder marks a reply answered (or not after all), or as one that counts toward the campaign's success number.
 * Marking a reply answered also marks that person's earlier unanswered replies: one answer covers them.
 */
export async function markReply(db: ProspectDb, id: string, mark: ReplyMark, by: string, now = new Date()): Promise<MarkResult> {
  if (mark.answered === undefined && mark.success === undefined) return { ok: false, why: "Say what to mark: answered, or counts as a success." };
  if (id.startsWith("fcc:")) return { ok: false, why: "FCC ended on Nov 12, 2026. Its replies are kept to read and can't be marked." };
  const at = now.toISOString();
  const who = by.slice(0, 120);
  if (id.startsWith("contact:")) {
    // The sender's check found this reply and recorded no message: give the mark a row to live on. It is already told
    // (the founders see it on the screen), so the hourly check never emails them about it.
    const contact = await db.prepare(`SELECT "id","campaignKey","email","senderAddress","stoppedReason","updatedAt" FROM "OutreachContact" WHERE "id" = ? AND "status" = 'replied'`)
      .bind(id.slice("contact:".length)).first<{ id: string; campaignKey: string; email: string; senderAddress: string | null; stoppedReason: string | null; updatedAt: string }>();
    if (!contact) return { ok: false, why: "There's no such reply." };
    await db.prepare(`INSERT OR IGNORE INTO "OutreachReply" ("id","campaignKey","contactId","inbox","fromAddress","receivedAt","subject","quote","kind","foundAt","toldFoundersAt")
      VALUES (?,?,?,?,?,?,NULL,?,?,?,?)`).bind(id, contact.campaignKey, contact.id, contact.senderAddress ?? "", contact.email, contact.updatedAt,
      contact.stoppedReason?.slice(0, 600) ?? null, AUTOMATIC.test(contact.stoppedReason ?? "") ? "automatic" : "reply", at, at).run();
  }
  const row = await db.prepare(`SELECT "id","contactId","kind","receivedAt","foundAt" FROM "OutreachReply" WHERE "id" = ?`).bind(id)
    .first<{ id: string; contactId: string; kind: string; receivedAt: string | null; foundAt: string }>();
  if (!row) return { ok: false, why: "There's no such reply." };
  if (mark.answered === true) {
    if (row.kind !== "reply") return { ok: false, why: "Only a person's reply can be marked answered. Automatic replies and no-thanks need no answer." };
    await db.prepare(`UPDATE "OutreachReply" SET "answeredAt" = ?, "answeredBy" = ? WHERE "contactId" = ? AND "kind" = 'reply' AND "answeredAt" IS NULL
      AND ("id" = ? OR COALESCE("receivedAt","foundAt") <= ?)`).bind(at, who, row.contactId, id, row.receivedAt ?? row.foundAt).run();
  } else if (mark.answered === false) {
    await db.prepare(`UPDATE "OutreachReply" SET "answeredAt" = NULL, "answeredBy" = NULL WHERE "id" = ?`).bind(id).run();
  }
  if (mark.success === true) {
    if (row.kind !== "reply") return { ok: false, why: "Only a person's reply can count toward the success number." };
    await db.prepare(`UPDATE "OutreachReply" SET "successAt" = COALESCE("successAt", ?), "successBy" = COALESCE("successBy", ?) WHERE "id" = ?`).bind(at, who, id).run();
  } else if (mark.success === false) {
    await db.prepare(`UPDATE "OutreachReply" SET "successAt" = NULL, "successBy" = NULL WHERE "id" = ?`).bind(id).run();
  }
  const reply = await getReply(db, id);
  return reply ? { ok: true, reply } : { ok: false, why: "There's no such reply." };
}
