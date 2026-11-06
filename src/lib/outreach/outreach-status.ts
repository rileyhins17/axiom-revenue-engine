/**
 * What the Campaigns screens show. Read-only: nothing here changes a campaign. Every number comes
 * straight from the campaign tables (and FCC's, for the shared inbox counts).
 */
import { torontoDay, torontoWeekday } from "@/lib/fcc-campaign-sender";
import { torontoMinute } from "@/lib/fcc-campaign-tick";
import { readCampaignRun, type RunNote } from "@/lib/outreach/outreach-control";
import { inboxCapNow, inboxDayMax, inboxRef, inboxSentToday } from "@/lib/outreach/outreach-inboxes";
import { readCampaign, readCampaigns, readInboxes, type Campaign, type Inbox } from "@/lib/outreach/outreach-model";
import { renderEmail, type CampaignWords, type RenderedEmail } from "@/lib/outreach/outreach-words";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export type CampaignCounts = {
  ready: number; waiting: number; held: number; emailed: number; followUpsSent: number; sentToday: number; followUpsDue: number;
  replies: number; automatic: number; noThanks: number; bounced: number; stopped: number; failed: number;
};
export type BatchRow = {
  id: string; name: string; source: string | null; loadedBy: string; loadedAt: string; status: string; approvedBy: string | null; approvedAt: string | null;
  wordsCurrent: boolean; rows: number; ready: number; held: number; emailed: number; stopped: number;
};
export type PersonRow = { email: string; label: string; at: string | null; note: string | null; inbox?: string | null };
export type InboxToday = { address: string; name: string; perDay: number; sentByCampaign: number; inboxSent: number; inboxDayMax: number; inboxCapNow: number };

export type CampaignSummary = { campaign: Campaign; counts: CampaignCounts; lastRun: RunNote | null; nextSend: string };
export type CampaignDetail = CampaignSummary & {
  inboxes: InboxToday[]; batches: BatchRow[]; replies: PersonRow[]; bounces: PersonRow[]; problems: PersonRow[];
  days: Array<{ day: string; first: number; followUps: number }>;
};

const n = (value: unknown) => Number(value ?? 0);
const toronto = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", ...options }).format(date);
const clock = (minute: number) => {
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  return `${hour % 12 || 12}:${String(rest).padStart(2, "0")} ${hour < 12 ? "a.m." : "p.m."}`;
};
const longDay = (day: string) => toronto(new Date(`${day}T17:00:00Z`), { weekday: "long", month: "long", day: "numeric" });

export async function campaignCounts(db: ProspectDb, key: string, now = new Date()): Promise<CampaignCounts> {
  const day = torontoDay(now);
  const row = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM "OutreachContact" c JOIN "OutreachBatch" b ON b."id" = c."batchId" WHERE c."campaignKey" = ? AND c."status" = 'ready' AND b."status" = 'approved') AS ready,
      (SELECT COUNT(*) FROM "OutreachContact" c JOIN "OutreachBatch" b ON b."id" = c."batchId" WHERE c."campaignKey" = ? AND c."status" = 'ready' AND b."status" = 'waiting') AS waiting,
      (SELECT COUNT(*) FROM "OutreachContact" WHERE "campaignKey" = ? AND "status" = 'held') AS held,
      (SELECT COUNT(*) FROM "OutreachSend" WHERE "campaignKey" = ? AND "kind" = 'real' AND "step" = 1 AND "status" = 'SENT') AS emailed,
      (SELECT COUNT(*) FROM "OutreachSend" WHERE "campaignKey" = ? AND "kind" = 'real' AND "step" > 1 AND "status" = 'SENT') AS followUpsSent,
      (SELECT COUNT(*) FROM "OutreachSend" WHERE "campaignKey" = ? AND "kind" = 'real' AND "sendDay" = ? AND "status" IN ('CLAIMED','SENT')) AS sentToday,
      (SELECT COUNT(*) FROM "OutreachContact" WHERE "campaignKey" = ? AND "status" = 'sent' AND "nextDueDay" <= ?) AS followUpsDue,
      (SELECT COUNT(DISTINCT "contactId") FROM "OutreachReply" WHERE "campaignKey" = ? AND "kind" = 'reply') AS replies,
      (SELECT COUNT(DISTINCT "contactId") FROM "OutreachReply" WHERE "campaignKey" = ? AND "kind" = 'automatic') AS automatic,
      (SELECT COUNT(DISTINCT "contactId") FROM "OutreachReply" WHERE "campaignKey" = ? AND "kind" = 'no_thanks') AS noThanks,
      (SELECT COUNT(*) FROM "OutreachContact" WHERE "campaignKey" = ? AND "status" = 'replied') AS repliedContacts,
      (SELECT COUNT(*) FROM "OutreachContact" WHERE "campaignKey" = ? AND "status" = 'bounced') AS bounced,
      (SELECT COUNT(*) FROM "OutreachContact" WHERE "campaignKey" = ? AND "status" = 'suppressed') AS stopped,
      (SELECT COUNT(*) FROM "OutreachContact" WHERE "campaignKey" = ? AND "status" = 'failed') AS failed`)
    .bind(key, key, key, key, key, key, day, key, day, key, key, key, key, key, key, key).first<Record<string, number>>();
  // A reply found by the check before a follow-up has no message row yet; it still counts as a reply.
  const replies = Math.max(n(row?.replies) + n(row?.noThanks), n(row?.repliedContacts));
  return {
    ready: n(row?.ready), waiting: n(row?.waiting), held: n(row?.held), emailed: n(row?.emailed), followUpsSent: n(row?.followUpsSent), sentToday: n(row?.sentToday),
    followUpsDue: n(row?.followUpsDue), replies, automatic: n(row?.automatic), noThanks: n(row?.noThanks), bounced: n(row?.bounced), stopped: n(row?.stopped), failed: n(row?.failed),
  };
}

/** When the campaign's next email goes, in plain English. */
export function campaignNextSend(campaign: Campaign, counts: CampaignCounts, now: Date) {
  if (campaign.problem) return `Can't send: ${campaign.problem}.`;
  if (!campaign.wordsVersion) return "Nothing can send yet: the email words aren't loaded.";
  if (campaign.state === "paused") return "Paused. Nothing sends until a founder presses Resume.";
  if (counts.ready + counts.followUpsDue === 0) {
    return counts.waiting > 0 ? `Waiting for ${campaign.approvers.join(" or ")} to approve a batch (${counts.waiting} ready in it).` : "Nobody is waiting for an email. Load a list.";
  }
  const day = torontoDay(now);
  const minute = torontoMinute(now);
  const startsLater = campaign.startDay && day < campaign.startDay;
  const at = clock(campaign.windowStart);
  if (startsLater) return `Starts ${longDay(campaign.startDay!)} at ${at}: up to ${campaign.dailyLimit} a day, one every 1 to 3 minutes.`;
  const sendDay = campaign.sendDays.includes(torontoWeekday(now));
  if (sendDay && minute < campaign.windowStart) return `Today at ${at}: up to ${campaign.dailyLimit}, one every 1 to 3 minutes.`;
  if (sendDay && minute < campaign.windowEnd && counts.sentToday < campaign.dailyLimit) return `Sending now: one email every 1 to 3 minutes, ${counts.sentToday} of today's ${campaign.dailyLimit} so far.`;
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const next = new Date(now.getTime() + ahead * 86_400_000);
    if (campaign.sendDays.includes(torontoWeekday(next)) && (!campaign.endDay || torontoDay(next) <= campaign.endDay)) return `${longDay(torontoDay(next))} at ${at}.`;
  }
  return "No send day is coming up.";
}

export async function campaignSummaries(db: ProspectDb, now = new Date()): Promise<CampaignSummary[]> {
  const campaigns = await readCampaigns(db);
  return Promise.all(campaigns.map(async (campaign) => {
    const counts = await campaignCounts(db, campaign.key, now);
    return { campaign, counts, lastRun: await readCampaignRun(db, campaign.key), nextSend: campaignNextSend(campaign, counts, now) };
  }));
}

export async function campaignDetail(db: ProspectDb, key: string, fccFirstInbox: string | null | undefined, now = new Date()): Promise<CampaignDetail | null> {
  const campaign = await readCampaign(db, key);
  if (!campaign) return null;
  const counts = await campaignCounts(db, key, now);
  const day = torontoDay(now);
  const minute = torontoMinute(now);
  const settings = await readInboxes(db);
  const inboxes = await Promise.all(campaign.inboxes.map(async (share): Promise<InboxToday> => {
    const inbox = settings.find((row) => row.address === share.address);
    const dayMax = inbox ? inboxDayMax(inbox, day) : 0;
    return {
      address: share.address, name: inbox?.name ?? share.address, perDay: share.perDay,
      sentByCampaign: n((await db.prepare(`SELECT COUNT(*) AS n FROM "OutreachSend" WHERE "campaignKey" = ? AND "sendDay" = ? AND "senderAddress" = ? AND "kind" = 'real' AND "status" IN ('CLAIMED','SENT')`)
        .bind(key, day, share.address).first<{ n: number }>())?.n),
      inboxSent: await inboxSentToday(db, day, inboxRef(share.address, fccFirstInbox)), inboxDayMax: dayMax, inboxCapNow: inboxCapNow(dayMax, minute),
    };
  }));
  const { results: batches } = await db.prepare(`SELECT b."id", b."name", b."source", b."loadedBy", b."loadedAt", b."status", b."approvedBy", b."approvedAt", b."approvedWords", b."wordsVersion",
      COUNT(c."id") AS rows, SUM(c."status" = 'ready') AS ready, SUM(c."status" = 'held') AS held, SUM(c."stepsSent" > 0) AS emailed,
      SUM(c."status" IN ('replied','bounced','suppressed','failed')) AS stopped
    FROM "OutreachBatch" b LEFT JOIN "OutreachContact" c ON c."batchId" = b."id" WHERE b."campaignKey" = ? GROUP BY b."id" ORDER BY b."sendOrder" DESC`)
    .bind(key).all<Record<string, string | number | null>>();
  const people = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all<PersonRow>()).results;
  const replies = await people(`SELECT o."email", COALESCE(json_extract(o."fieldsJson", '$.city'), json_extract(o."fieldsJson", '$.company'), o."email") AS label,
      COALESCE(r."receivedAt", o."updatedAt") AS at, COALESCE(r."quote", o."stoppedReason") AS note, r."inbox" AS inbox
    FROM "OutreachContact" o LEFT JOIN "OutreachReply" r ON r."contactId" = o."id"
    WHERE o."campaignKey" = ? AND (o."status" = 'replied' OR r."id" IS NOT NULL) ORDER BY at DESC LIMIT 50`, key);
  const bounces = await people(`SELECT "email", COALESCE(json_extract("fieldsJson", '$.city'), "email") AS label, "updatedAt" AS at, "stoppedReason" AS note
    FROM "OutreachContact" WHERE "campaignKey" = ? AND "status" = 'bounced' ORDER BY "updatedAt" DESC LIMIT 50`, key);
  const problems = await people(`SELECT "email", COALESCE(json_extract("fieldsJson", '$.city'), "email") AS label, "updatedAt" AS at, "stoppedReason" AS note
    FROM "OutreachContact" WHERE "campaignKey" = ? AND "status" = 'failed' ORDER BY "updatedAt" DESC LIMIT 50`, key);
  const { results: days } = await db.prepare(`SELECT "sendDay" AS day, SUM("step" = 1) AS first, SUM("step" > 1) AS followUps FROM "OutreachSend"
    WHERE "campaignKey" = ? AND "kind" = 'real' AND "status" = 'SENT' GROUP BY "sendDay" ORDER BY "sendDay" DESC LIMIT 30`).bind(key).all<{ day: string; first: number; followUps: number }>();
  return {
    campaign, counts, lastRun: await readCampaignRun(db, key), nextSend: campaignNextSend(campaign, counts, now), inboxes,
    batches: batches.map((row) => ({
      id: String(row.id), name: String(row.name), source: row.source === null ? null : String(row.source), loadedBy: String(row.loadedBy), loadedAt: String(row.loadedAt),
      status: String(row.status), approvedBy: row.approvedBy === null ? null : String(row.approvedBy), approvedAt: row.approvedAt === null ? null : String(row.approvedAt),
      // Approved on the words it sends with: its own, or the campaign's for an older batch.
      wordsCurrent: row.approvedWords !== null && row.approvedWords === (row.wordsVersion ?? campaign.wordsVersion),
      rows: n(row.rows), ready: n(row.ready), held: n(row.held), emailed: n(row.emailed), stopped: n(row.stopped),
    })),
    replies, bounces, problems, days: days.map((row) => ({ day: row.day, first: n(row.first), followUps: n(row.followUps) })),
  };
}

export type SampleEmail = { row: number; to: string; from: string; first: RenderedEmail | null; followUp: RenderedEmail | null; problem: string | null };
export type BatchReview = {
  campaign: Campaign; batch: BatchRow & { columns: string[]; approvalNote: string | null };
  samples: SampleEmail[]; held: Array<{ row: number; email: string; reason: string }>;
};

/** A batch as its approver sees it: up to `size` emails exactly as they would go out, and every held row with its reason. */
export async function batchReview(db: ProspectDb, batchId: string, mailingAddress: string | null | undefined, size = 10): Promise<BatchReview | null> {
  const row = await db.prepare(`SELECT * FROM "OutreachBatch" WHERE "id" = ?`).bind(batchId).first<Record<string, string | number | null>>();
  if (!row) return null;
  const campaign = await readCampaign(db, String(row.campaignKey));
  if (!campaign) return null;
  const detail = (await campaignDetail(db, campaign.key, null))?.batches.find((batch) => batch.id === batchId);
  // The batch's own words (every batch since Nov 5), or the campaign's for an older batch.
  let words: CampaignWords = campaign.words;
  if (row.wordsJson !== null && row.wordsJson !== undefined) {
    try { words = JSON.parse(String(row.wordsJson)) as CampaignWords; } catch { words = { steps: [] }; }
  }
  const inboxes = await readInboxes(db);
  const senders = campaign.inboxes.map((share) => inboxes.find((inbox) => inbox.address === share.address)).filter((inbox): inbox is Inbox => Boolean(inbox));
  const { results: ready } = await db.prepare(`SELECT "rowNumber","email","fieldsJson" FROM "OutreachContact" WHERE "batchId" = ? AND "status" IN ('ready','sent','done') ORDER BY "rowNumber" LIMIT ?`)
    .bind(batchId, size).all<{ rowNumber: number; email: string; fieldsJson: string }>();
  const samples = ready.map((contact, index): SampleEmail => {
    const inbox = senders[index % Math.max(1, senders.length)];
    let fields: Record<string, string> = {};
    try { fields = JSON.parse(contact.fieldsJson) as Record<string, string>; } catch { fields = {}; }
    if (!inbox) return { row: contact.rowNumber, to: contact.email, from: "(no inbox set)", first: null, followUp: null, problem: "The campaign has no sending inbox." };
    const sender = { name: inbox.name, address: inbox.address };
    const first = renderEmail(words, 1, fields, sender, mailingAddress, { noLinksInFirst: campaign.rules.noLinksInFirst });
    const followUp = campaign.followUps > 0 && first.ok ? renderEmail(words, 2, fields, sender, mailingAddress, { firstSubject: first.email.subject }) : null;
    return {
      row: contact.rowNumber, to: contact.email, from: `${inbox.name} <${inbox.address}>`,
      first: first.ok ? first.email : null, followUp: followUp?.ok ? followUp.email : null,
      problem: !first.ok ? first.reason : followUp && !followUp.ok ? `Follow-up: ${followUp.reason}` : null,
    };
  });
  const { results: held } = await db.prepare(`SELECT "rowNumber" AS row, json_extract("fieldsJson", '$.email') AS email, "holdReason" AS reason FROM "OutreachContact"
    WHERE "batchId" = ? AND "status" = 'held' ORDER BY "rowNumber" LIMIT 1000`).bind(batchId).all<{ row: number; email: string | null; reason: string | null }>();
  let columns: string[] = [];
  try { columns = JSON.parse(String(row.columnsJson ?? "[]")) as string[]; } catch { columns = []; }
  return {
    campaign,
    batch: { ...(detail ?? {
      id: batchId, name: String(row.name), source: null, loadedBy: String(row.loadedBy), loadedAt: String(row.loadedAt), status: String(row.status), approvedBy: null, approvedAt: null,
      wordsCurrent: false, rows: 0, ready: 0, held: 0, emailed: 0, stopped: 0,
    }), columns, approvalNote: row.approvalNote === null ? null : String(row.approvalNote) },
    samples, held: held.map((item) => ({ row: item.row, email: item.email ?? "", reason: item.reason ?? "" })),
  };
}
