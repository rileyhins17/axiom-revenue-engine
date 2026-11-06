/**
 * Campaign and inbox settings as stored in D1 (migration 0089), read into checked shapes. A
 * setting that can't be read makes the campaign unable to send (never a guess), and the screen
 * says why.
 */
import type { CampaignWords } from "@/lib/outreach/outreach-words";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export type CampaignInbox = { address: string; perDay: number };
export type CampaignRules = {
  /** Hold a row unless its column holds one of these values (case-insensitive), e.g. verified: yes/true. */
  holdUnless?: Record<string, string[]>;
  /** The first email may carry no link or web address. */
  noLinksInFirst?: boolean;
  /** An automatic reply (out of office) stops the follow-ups, as a person's reply does. Default true. */
  stopOnAutoReply?: boolean;
};

export type Campaign = {
  key: string; name: string; state: "live" | "paused"; stateReason: string | null; stateBy: string | null; stateAt: string | null;
  priority: number; startDay: string | null; endDay: string | null; sendDays: string[]; windowStart: number; windowEnd: number;
  dailyLimit: number; inboxes: CampaignInbox[]; followUps: number; followUpBusinessDays: number;
  words: CampaignWords; wordsVersion: string | null; rules: CampaignRules; approvers: string[]; note: string | null;
  /** Why the stored settings can't be used, or null. */
  problem: string | null;
};

export type Inbox = {
  address: string; name: string; passwordSecret: string; smtpHost: string; imapHost: string;
  dailyMax: number; ramp: number[]; rampFrom: string | null; enabled: boolean;
};

type CampaignRow = {
  key: string; name: string; state: string; stateReason: string | null; stateBy: string | null; stateAt: string | null; priority: number;
  startDay: string | null; endDay: string | null; sendDays: string; windowStart: number; windowEnd: number; dailyLimit: number;
  inboxesJson: string; followUps: number; followUpBusinessDays: number; wordsJson: string; wordsVersion: string | null;
  rulesJson: string; approversJson: string; note: string | null;
};

const DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

function json<T>(text: string, check: (value: unknown) => value is T): T | null {
  try {
    const value = JSON.parse(text) as unknown;
    return check(value) ? value : null;
  } catch {
    return null;
  }
}

const isInboxes = (value: unknown): value is CampaignInbox[] => Array.isArray(value) && value.every((item) =>
  typeof item === "object" && item !== null && typeof (item as CampaignInbox).address === "string" && Number.isInteger((item as CampaignInbox).perDay) && (item as CampaignInbox).perDay >= 0);
const isWords = (value: unknown): value is CampaignWords => typeof value === "object" && value !== null && Array.isArray((value as CampaignWords).steps)
  && (value as CampaignWords).steps.every((step) => typeof step === "object" && step !== null && typeof step.body === "string" && (step.subject === undefined || typeof step.subject === "string"));
const isRules = (value: unknown): value is CampaignRules => typeof value === "object" && value !== null && !Array.isArray(value);
const isNames = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isNumbers = (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0);

export function campaignFromRow(row: CampaignRow): Campaign {
  const inboxes = json(row.inboxesJson, isInboxes);
  const words = json(row.wordsJson, isWords);
  const rules = json(row.rulesJson, isRules);
  const approvers = json(row.approversJson, isNames);
  const sendDays = row.sendDays.split(",").map((day) => day.trim()).filter(Boolean);
  const problem = !inboxes ? "its inbox setting can't be read"
    : !words ? "its email words can't be read"
      : !rules ? "its hold rules can't be read"
        : !approvers ? "its approver list can't be read"
          : sendDays.some((day) => !DAYS.has(day)) ? "its send days can't be read"
            : row.windowEnd <= row.windowStart ? "its send window ends before it starts"
              : null;
  return {
    key: row.key, name: row.name, state: row.state === "live" ? "live" : "paused", stateReason: row.stateReason, stateBy: row.stateBy, stateAt: row.stateAt,
    priority: row.priority, startDay: row.startDay, endDay: row.endDay, sendDays, windowStart: row.windowStart, windowEnd: row.windowEnd,
    dailyLimit: row.dailyLimit, inboxes: (inboxes ?? []).map((inbox) => ({ address: inbox.address.trim().toLowerCase(), perDay: inbox.perDay })),
    followUps: row.followUps, followUpBusinessDays: row.followUpBusinessDays, words: words ?? { steps: [] }, wordsVersion: row.wordsVersion,
    rules: rules ?? {}, approvers: approvers ?? [], note: row.note, problem,
  };
}

const CAMPAIGN_COLUMNS = `"key","name","state","stateReason","stateBy","stateAt","priority","startDay","endDay","sendDays","windowStart","windowEnd","dailyLimit",
  "inboxesJson","followUps","followUpBusinessDays","wordsJson","wordsVersion","rulesJson","approversJson","note"`;

export async function readCampaigns(db: ProspectDb): Promise<Campaign[]> {
  const { results } = await db.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM "OutreachCampaign" ORDER BY "priority", "key"`).bind().all<CampaignRow>();
  return results.map(campaignFromRow);
}

export async function readCampaign(db: ProspectDb, key: string): Promise<Campaign | null> {
  const row = await db.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM "OutreachCampaign" WHERE "key" = ?`).bind(key).first<CampaignRow>();
  return row ? campaignFromRow(row) : null;
}

type InboxRow = { address: string; name: string; passwordSecret: string; smtpHost: string; imapHost: string; dailyMax: number; rampJson: string; rampFrom: string | null; enabled: number };

export async function readInboxes(db: ProspectDb): Promise<Inbox[]> {
  const { results } = await db.prepare(`SELECT "address","name","passwordSecret","smtpHost","imapHost","dailyMax","rampJson","rampFrom","enabled" FROM "OutreachInbox" ORDER BY "createdAt", "address"`)
    .bind().all<InboxRow>();
  return results.map((row) => {
    // A ramp that can't be read switches the inbox off rather than guess its limit.
    const ramp = json(row.rampJson, isNumbers);
    return {
      address: row.address.toLowerCase(), name: row.name, passwordSecret: row.passwordSecret, smtpHost: row.smtpHost, imapHost: row.imapHost,
      dailyMax: row.dailyMax, ramp: ramp ?? [], rampFrom: row.rampFrom, enabled: row.enabled === 1 && ramp !== null,
    };
  });
}

/** The approved founder names, as the sign-in knows them ("Riley", "Aidan"). */
export const FOUNDERS = ["Riley", "Aidan"] as const;
