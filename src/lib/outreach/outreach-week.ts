/**
 * The numbers for any Toronto week, for every campaign. Read-only: nothing here changes a campaign, a
 * contact, a send or a switch. Monday's email to both founders, "This week" on the Today screen and the
 * week_numbers tool all read this, so they can never disagree. FCC (ended Nov 12, 2026) is not in it.
 *
 * How things are counted:
 * - Sent: real emails (never tests) that left in the week, by the Toronto day they went. An email that was
 *   claimed but never confirmed counts as sent, as it does for the day's limits. All-time "emailed" counts
 *   confirmed emails only, so it matches the campaign's own screen.
 * - Replies, no thanks, automatic and success count people, not messages: someone who writes twice in a week
 *   is one reply. A message belongs to the week it was received in (or found in, when it carried no date).
 * - A contact can be marked replied with no stored message: the sender's own inbox look found the reply just
 *   before a follow-up. Such a contact counts as one reply in the week it was marked (its updatedAt), or as
 *   one automatic reply when its note says "automatic reply". Once the hourly reply check stores the message,
 *   the message counts instead, in the week it was received. These contacts are counted but not in `people`.
 * - Bounces: contacts marked bounced in the week (by updatedAt).
 */
import { torontoDay, torontoWeekday } from "@/lib/fcc-campaign-sender";
import { readCampaigns, readInboxes, successLabelOf } from "@/lib/outreach/outreach-model";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export type CampaignWeek = {
  key: string; name: string; state: "live" | "paused";
  /** Why it is paused, as saved with the pause. Null when live or when no reason was saved. */
  stateReason: string | null;
  /** Real emails that left in the week (OutreachSend kind 'real', status SENT or CLAIMED, sendDay within from..to), by step. */
  sent: { first: number; followUps: number };
  /** People who wrote back in the week: by receivedAt, or foundAt when the message carried no date. */
  replies: number;
  noThanks: number;
  automatic: number;
  /** Contacts marked bounced in the week (OutreachContact status 'bounced', by updatedAt). */
  bounced: number;
  /** People whose reply a founder marked as counting toward the success number, by successAt in the week. */
  success: number;
  successLabel: string;
  allTime: { emailed: number; followUps: number; replies: number; noThanks: number; automatic: number; bounced: number; success: number };
  /** What is left right now: ready in approved batches, ready in batches still waiting for approval, follow-ups due on or before today. */
  left: { ready: number; waitingApproval: number; followUpsDue: number };
};
export type WeekReply = {
  id: string; campaignKey: string; campaign: string; contactId: string;
  /** The organisation or person, as the reply check labels it: fieldsJson city, else company, else agency, else the contact's email. */
  label: string;
  from: string; kind: "reply" | "no_thanks";
  /** When it was received, or found when the message carried no date. */
  at: string | null;
  quote: string | null;
  /** The inbox that sent them the email (contact.senderAddress): answer from there. Null if unknown. */
  answerFrom: string | null;
  /** That inbox's name (the OutreachInbox row's name, else the address). Null if unknown. */
  answerFromName: string | null;
  /** Where the reply landed, and that inbox's name (else the address). */
  inbox: string; inboxName: string;
  answeredAt: string | null; answeredBy: string | null; success: boolean;
};
export type WeekNumbers = {
  /** Toronto days (YYYY-MM-DD), inclusive. */
  from: string; to: string;
  /** Every campaign, in priority order, even with nothing sent. */
  campaigns: CampaignWeek[];
  totals: { sent: number; first: number; followUps: number; replies: number; noThanks: number; automatic: number; bounced: number; success: number };
  /** Each inbox that sent a campaign email in the week. name = the OutreachInbox row's name, else the address. */
  byInbox: Array<{ address: string; name: string; sent: number }>;
  /** Real replies and no-thanks received in the week (not automatic ones), newest first, at most 50. */
  people: WeekReply[];
};

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const n = (value: unknown) => Number(value ?? 0);
const noon = (day: string) => Date.parse(`${day}T12:00:00Z`);
/** A Toronto day some days before (negative) or after another. */
const shiftDay = (day: string, days: number) => torontoDay(new Date(noon(day) + days * DAY_MS));

/** Midnight at the start of a Toronto day, as an ISO instant (right through the clock change). */
export function torontoMidnightIso(day: string) {
  let guess = Date.parse(`${day}T05:00:00Z`);
  for (let tries = 0; tries < 3; tries += 1) {
    const [hour, minute] = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Toronto" })
      .format(new Date(guess)).split(":").map(Number);
    const off = (torontoDay(new Date(guess)) < day ? -1 : 0) * 1440 + hour! * 60 + minute!;
    if (off === 0) break;
    guess -= off * 60_000;
  }
  return new Date(guess).toISOString();
}

/** The current Toronto week so far: its Monday to today. */
export function thisWeek(now: Date) {
  const to = torontoDay(now);
  return { from: shiftDay(to, -WEEKDAYS.indexOf(torontoWeekday(now))), to };
}

/** The Monday to Sunday before `now`'s Toronto week. */
export function lastWeek(now: Date) {
  const from = shiftDay(thisWeek(now).from, -7);
  return { from, to: shiftDay(from, 6) };
}

const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(noon(day));
const LABEL = (c: string) => `COALESCE(NULLIF(json_extract(${c}."fieldsJson", '$.city'), ''), NULLIF(json_extract(${c}."fieldsJson", '$.company'), ''), NULLIF(json_extract(${c}."fieldsJson", '$.agency'), ''), ${c}."email")`;

/** The numbers for the Toronto days `from` to `to` (inclusive), every campaign. `now` only decides which follow-ups are due today. */
export async function weekNumbers(db: ProspectDb, from: string, to: string, now = new Date()): Promise<WeekNumbers> {
  if (!isDay(from) || !isDay(to) || to < from) throw new Error("The week needs a first and a last day, written like 2026-11-09, in that order.");
  const start = torontoMidnightIso(from);
  const end = torontoMidnightIso(shiftDay(to, 1));
  const today = torontoDay(now);
  const received = `COALESCE(r."receivedAt", r."foundAt")`;
  const inWeek = (column: string) => `${column} >= ? AND ${column} < ?`;
  // A handful of grouped reads for all campaigns together, however many campaigns there are: Today loads this every time.
  const [campaigns, inboxes, sends, contacts, replies, people] = await Promise.all([
    readCampaigns(db),
    readInboxes(db),
    db.prepare(`SELECT "campaignKey" AS key, "senderAddress" AS inbox,
        SUM("step" = 1 AND "sendDay" BETWEEN ? AND ?) AS first, SUM("step" > 1 AND "sendDay" BETWEEN ? AND ?) AS followUps,
        SUM("step" = 1 AND "status" = 'SENT') AS emailedAll, SUM("step" > 1 AND "status" = 'SENT') AS followUpsAll
      FROM "OutreachSend" WHERE "kind" = 'real' AND "status" IN ('CLAIMED','SENT') GROUP BY 1, 2`)
      .bind(from, to, from, to).all<{ key: string; inbox: string; first: number; followUps: number; emailedAll: number; followUpsAll: number }>(),
    // "quiet": marked replied with no stored message (see the top of this file). 1 a person's reply, 2 an automatic one, 0 everyone else.
    db.prepare(`SELECT c."campaignKey" AS key,
        SUM(c."status" = 'ready' AND b."status" = 'approved') AS ready, SUM(c."status" = 'ready' AND b."status" = 'waiting') AS waiting,
        SUM(c."status" = 'sent' AND c."nextDueDay" <= ?) AS followUpsDue,
        SUM(c."status" = 'bounced') AS bouncedAll, SUM(c."status" = 'bounced' AND ${inWeek(`c."updatedAt"`)}) AS bounced,
        SUM(c."quiet" = 1) AS repliedAll, SUM(c."quiet" = 1 AND ${inWeek(`c."updatedAt"`)}) AS replied,
        SUM(c."quiet" = 2) AS automaticAll, SUM(c."quiet" = 2 AND ${inWeek(`c."updatedAt"`)}) AS automatic
      FROM (SELECT o."campaignKey", o."batchId", o."status", o."nextDueDay", o."updatedAt",
          CASE WHEN o."status" <> 'replied' OR EXISTS (SELECT 1 FROM "OutreachReply" r WHERE r."contactId" = o."id") THEN 0
            WHEN lower(COALESCE(o."stoppedReason", '')) LIKE '%automatic reply%' THEN 2 ELSE 1 END AS quiet
        FROM "OutreachContact" o) c JOIN "OutreachBatch" b ON b."id" = c."batchId" GROUP BY c."campaignKey"`)
      .bind(today, start, end, start, end, start, end).all<Record<string, string | number | null>>(),
    db.prepare(`SELECT r."campaignKey" AS key,
        COUNT(DISTINCT CASE WHEN r."kind" = 'reply' THEN r."contactId" END) AS repliesAll,
        COUNT(DISTINCT CASE WHEN r."kind" = 'reply' AND ${inWeek(received)} THEN r."contactId" END) AS replies,
        COUNT(DISTINCT CASE WHEN r."kind" = 'no_thanks' THEN r."contactId" END) AS noThanksAll,
        COUNT(DISTINCT CASE WHEN r."kind" = 'no_thanks' AND ${inWeek(received)} THEN r."contactId" END) AS noThanks,
        COUNT(DISTINCT CASE WHEN r."kind" = 'automatic' THEN r."contactId" END) AS automaticAll,
        COUNT(DISTINCT CASE WHEN r."kind" = 'automatic' AND ${inWeek(received)} THEN r."contactId" END) AS automatic,
        COUNT(DISTINCT CASE WHEN r."successAt" IS NOT NULL THEN r."contactId" END) AS successAll,
        COUNT(DISTINCT CASE WHEN ${inWeek(`r."successAt"`)} THEN r."contactId" END) AS success
      FROM "OutreachReply" r GROUP BY r."campaignKey"`)
      .bind(start, end, start, end, start, end, start, end).all<Record<string, string | number | null>>(),
    db.prepare(`SELECT r."id", r."campaignKey", r."contactId", r."inbox", r."fromAddress", r."kind", r."quote", r."answeredAt", r."answeredBy", r."successAt",
        ${received} AS at, ${LABEL("c")} AS label, c."senderAddress" AS sender
      FROM "OutreachReply" r JOIN "OutreachContact" c ON c."id" = r."contactId"
      WHERE r."kind" <> 'automatic' AND ${inWeek(received)} ORDER BY at DESC, r."id" LIMIT 50`)
      .bind(start, end).all<{
        id: string; campaignKey: string; contactId: string; inbox: string; fromAddress: string; kind: "reply" | "no_thanks"; quote: string | null;
        answeredAt: string | null; answeredBy: string | null; successAt: string | null; at: string | null; label: string | number | null; sender: string | null;
      }>(),
  ]);

  const contactRow = new Map(contacts.results.map((row) => [String(row.key), row]));
  const replyRow = new Map(replies.results.map((row) => [String(row.key), row]));
  const inboxName = (address: string) => inboxes.find((inbox) => inbox.address === address.toLowerCase())?.name || address;
  const sentByInbox = new Map<string, number>();
  for (const row of sends.results) {
    const sent = n(row.first) + n(row.followUps);
    if (sent > 0) sentByInbox.set(row.inbox, (sentByInbox.get(row.inbox) ?? 0) + sent);
  }
  // The sending inboxes in their own order, then any address that is no longer one.
  const order = (address: string) => { const at = inboxes.findIndex((inbox) => inbox.address === address.toLowerCase()); return at < 0 ? inboxes.length : at; };
  const byInbox = [...sentByInbox].map(([address, sent]) => ({ address, name: inboxName(address), sent }))
    .sort((a, b) => order(a.address) - order(b.address) || a.address.localeCompare(b.address));

  const weeks = campaigns.map((campaign): CampaignWeek => {
    const mine = sends.results.filter((row) => row.key === campaign.key);
    const sum = (pick: (row: (typeof mine)[number]) => number) => mine.reduce((total, row) => total + n(pick(row)), 0);
    const contact = contactRow.get(campaign.key);
    const reply = replyRow.get(campaign.key);
    return {
      key: campaign.key, name: campaign.name, state: campaign.state, stateReason: campaign.state === "paused" ? campaign.stateReason : null,
      sent: { first: sum((row) => row.first), followUps: sum((row) => row.followUps) },
      replies: n(reply?.replies) + n(contact?.replied), noThanks: n(reply?.noThanks), automatic: n(reply?.automatic) + n(contact?.automatic),
      bounced: n(contact?.bounced), success: n(reply?.success), successLabel: successLabelOf(campaign),
      allTime: {
        emailed: sum((row) => row.emailedAll), followUps: sum((row) => row.followUpsAll),
        replies: n(reply?.repliesAll) + n(contact?.repliedAll), noThanks: n(reply?.noThanksAll), automatic: n(reply?.automaticAll) + n(contact?.automaticAll),
        bounced: n(contact?.bouncedAll), success: n(reply?.successAll),
      },
      left: { ready: n(contact?.ready), waitingApproval: n(contact?.waiting), followUpsDue: n(contact?.followUpsDue) },
    };
  });
  const total = (pick: (week: CampaignWeek) => number) => weeks.reduce((sum, week) => sum + pick(week), 0);
  const first = total((week) => week.sent.first);
  const followUps = total((week) => week.sent.followUps);
  const names = new Map(campaigns.map((campaign) => [campaign.key, campaign.name]));

  return {
    from, to, campaigns: weeks,
    totals: {
      sent: first + followUps, first, followUps, replies: total((week) => week.replies), noThanks: total((week) => week.noThanks),
      automatic: total((week) => week.automatic), bounced: total((week) => week.bounced), success: total((week) => week.success),
    },
    byInbox,
    people: people.results.map((row): WeekReply => ({
      id: row.id, campaignKey: row.campaignKey, campaign: names.get(row.campaignKey) ?? row.campaignKey, contactId: row.contactId,
      label: String(row.label ?? row.fromAddress), from: row.fromAddress, kind: row.kind, at: row.at, quote: row.quote,
      answerFrom: row.sender, answerFromName: row.sender ? inboxName(row.sender) : null, inbox: row.inbox, inboxName: inboxName(row.inbox),
      answeredAt: row.answeredAt, answeredBy: row.answeredBy, success: row.successAt !== null,
    })),
  };
}
