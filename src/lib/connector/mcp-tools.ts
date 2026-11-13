/**
 * The Claude connector's tools: what a founder's Claude can read from the engine, and the few safe things it
 * can do. Every tool is built on the same functions the screens use, so the connector shows and does exactly
 * what the screen would for that founder.
 *
 * On purpose there is no tool, and no code path from here, that approves a batch, starts a paused campaign
 * again, stops a batch, changes limits, inboxes, schedules or the do-not-email list, or touches FCC. Those
 * stay on the screen with the right founder signed in (connector.test.ts proves it).
 *
 * Adding a tool is one entry in TOOLS: a name, a title, a plain description, its arguments twice (zod to
 * check them, JSON Schema for Claude; a test keeps the two in step) and a `run`.
 */
import { z } from "zod";

import type { Founder } from "@/lib/connector/connector-keys";
import { blockedAmong } from "@/lib/outreach/outreach-blocked";
import { pauseCampaign } from "@/lib/outreach/outreach-control";
import { clockText, type InboxHealth } from "@/lib/outreach/outreach-inbox-health";
import { SCREEN_MAX_CSV_CHARS, SCREEN_MAX_ROWS, loadList } from "@/lib/outreach/outreach-load";
import { checkDoNotEmail, findContacts } from "@/lib/outreach/outreach-lookup";
import type { MailServerCheck } from "@/lib/outreach/outreach-mail-servers";
import { readCampaign, readCampaigns, successLabelOf, type Campaign } from "@/lib/outreach/outreach-model";
import { FCC_FILTER, REPLY_FILTERS, getReply, listReplies, markReply, type ReplyRow } from "@/lib/outreach/outreach-reply-list";
import { batchPhase, batchReview, campaignDetail, campaignSummaries, type BatchPhase, type CampaignCounts } from "@/lib/outreach/outreach-status";
import { requestTestSend } from "@/lib/outreach/outreach-tests";
import { needsYou, todayData } from "@/lib/outreach/outreach-today";
import { lastWeek, thisWeek, weekNumbers } from "@/lib/outreach/outreach-week";
import { OWNER_LOGINS } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

/** A refusal Claude should read and explain ("there's no such batch"): the tool's answer, marked as an error. */
export class ToolError extends Error {}

export type ToolSettings = {
  /** FCC_SENDER_ADDRESS: FCC's first inbox, whose older rows carry no address. */
  fccFirstInbox: string;
  /** FCC_CAMPAIGN_MAILING_ADDRESS: the postal address under every campaign email. */
  mailingAddress: string;
};
export type ToolContext = {
  db: ProspectDb; founder: Founder; now: Date; settings: ToolSettings;
  /** Seams for tests: the mail-server lookup a list check makes, and the id maker. */
  checkMail?: (domains: string[]) => Promise<MailServerCheck>;
  newId?: () => string;
};
export type ToolTarget = { kind: "campaign" | "batch" | "reply"; id: string };
export type Tool = {
  name: string; title: string; description: string;
  inputSchema: { type: "object"; properties: Record<string, object>; required: string[]; additionalProperties: false };
  annotations: Record<string, boolean>;
  /** True when the tool saves something in the engine. */
  saves: boolean;
  args: z.ZodType;
  /** What the call is about, for the audit log: a campaign key, a batch id or a reply id. Never an address. */
  target?: (args: never) => ToolTarget | null;
  run: (args: never, t: ToolContext) => Promise<unknown>;
};

/** A list through the connector has the screen's own limits (rows and email domains per load). */
export const CONNECTOR_MAX_LIST_ROWS = SCREEN_MAX_ROWS;

// ---------- Toronto time ----------
const TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** "Fri Nov 13, 1:01 p.m." in Toronto, or null when the text isn't a time. */
export function torontoText(time: string): string | null {
  if (!TIME.test(time)) return null;
  // The database's own timestamps have a space and no zone: they are UTC.
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(time) ? time : `${time.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.weekday} ${parts.month} ${parts.day}, ${parts.hour}:${parts.minute} ${parts.dayPeriod === "AM" ? "a.m." : "p.m."}`;
}

/** Every time in a result gets a twin in Toronto time beside it: "at" and "atToronto". */
export function withTorontoTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withTorontoTimes);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = withTorontoTimes(item);
    const text = typeof item === "string" && !(`${key}Toronto` in value) ? torontoText(item) : null;
    if (text) out[`${key}Toronto`] = text;
  }
  return out;
}

// ---------- arguments ----------
const CAMPAIGN_KEY = /^[a-z0-9-]{2,40}$/;
const BATCH_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
// The three shapes list_replies returns: a recorded message, a reply only the contact row knows, and FCC's.
const REPLY_ID = /^(?:contact:[\w.-]{1,80}|fcc:[^\s:]{3,254}|[^\s:@]+@[^\s:@]+:[^:]{1,80}:\d{1,12}:[\w.-]{1,80})$/;
const DAY_OR_TIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

const campaignArg = z.string().regex(CAMPAIGN_KEY, "Use a campaign key from list_campaigns, like us-cities.");
const batchArg = z.string().regex(BATCH_ID, "Use a batch id from list_batches or get_campaign.");
const replyArg = z.string().max(400).regex(REPLY_ID, "Use a reply id from list_replies.");
const BATCH_STATES = ["waiting", "sending", "done", "stopped", "all"] as const;

const obj = (properties: Record<string, object> = {}, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false as const });
const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const campaignProperty = { type: "string", description: "The campaign's key from list_campaigns, like us-cities" };
const batchProperty = { type: "string", description: "The batch id from list_batches or get_campaign" };

function tool<S extends z.ZodType>(definition: Omit<Tool, "args" | "run" | "target"> & {
  args: S; target?: (args: z.infer<S>) => ToolTarget | null; run: (args: z.infer<S>, t: ToolContext) => Promise<unknown>;
}): Tool {
  return definition as unknown as Tool;
}

/** A plain sentence for arguments that don't fit, for Claude to read and fix. */
export function argumentProblem(error: z.ZodError, given: unknown, properties: string[]): string {
  const issue = error.issues.find((item) => item.code === "unrecognized_keys") ?? error.issues[0];
  if (!issue) return "The arguments can't be read.";
  const takes = properties.length ? `It takes: ${properties.join(", ")}.` : "It takes no arguments.";
  if (issue.code === "unrecognized_keys") return `This tool doesn't take ${issue.keys.map((key) => `"${key}"`).join(" or ")}. ${takes}`;
  const name = String(issue.path[0] ?? "");
  if (!name) return `The arguments must be an object. ${takes}`;
  const missing = given === null || typeof given !== "object" || (given as Record<string, unknown>)[name] === undefined || (given as Record<string, unknown>)[name] === null;
  if (issue.code === "invalid_type") {
    if (missing) return `"${name}" is needed.`;
    const kind = issue.expected === "string" ? "text" : issue.expected === "boolean" ? "true or false" : issue.expected === "int" ? "a whole number" : `a ${issue.expected}`;
    return `"${name}" must be ${kind}.`;
  }
  if (issue.code === "too_small") {
    if (issue.origin !== "string") return `"${name}" must be at least ${issue.minimum}.`;
    return Number(issue.minimum) <= 1 ? `"${name}" can't be empty.` : `"${name}" is too short: at least ${issue.minimum} characters.`;
  }
  if (issue.code === "too_big") return issue.origin === "string" ? `"${name}" is too long: the most is ${issue.maximum} characters.` : `"${name}" must be at most ${issue.maximum}.`;
  if (issue.code === "invalid_value") return `"${name}" must be one of: ${issue.values.map(String).join(", ")}.`;
  return /^Invalid|^Too /.test(issue.message) ? `"${name}" can't be used as given.` : `"${name}": ${issue.message}`;
}

// ---------- shapes ----------
const via = (founder: Founder) => `${founder} (via Claude connector)`;
const hours = (campaign: Campaign) => `${clockText(campaign.windowStart)} to ${clockText(campaign.windowEnd)} Toronto time`;
const APPROVE_ON_SCREEN = "Approving is done by the campaign's approver on the screen; this connector can't approve.";
const RESUME_ON_SCREEN = "Resuming is done by a founder on the campaign's screen; this connector can't resume.";

function ownInbox(founder: Founder) {
  const owner = Object.values(OWNER_LOGINS).find((login) => login.name === founder);
  if (!owner) throw new ToolError("This founder has no inbox of their own on file, so no test can be sent.");
  return owner.inbox;
}

const campaignLine = (campaign: Campaign) => ({
  key: campaign.key, name: campaign.name, state: campaign.state,
  pausedBecause: campaign.state === "paused" ? campaign.stateReason : null, stateBy: campaign.stateBy, stateAt: campaign.stateAt,
  problem: campaign.problem ? `Its settings can't be used: ${campaign.problem}.` : null,
});
const totals = (counts: CampaignCounts) => ({
  emailed: counts.emailed, followUpsSent: counts.followUpsSent, replies: counts.replies, automaticReplies: counts.automatic, noThanks: counts.noThanks, bounced: counts.bounced,
  stoppedForGood: counts.stopped, failedToSend: counts.failed, waitingToSend: counts.ready, waitingForApproval: counts.waiting, held: counts.held,
});
const inboxLine = (inbox: InboxHealth) => ({
  address: inbox.address, name: inbox.name, owner: inbox.firstName, switchedOn: inbox.enabled,
  sentToday: inbox.sentToday, limitToday: inbox.dayMax, limitRightNow: inbox.capNow, fullLimit: inbox.fullMax, ramp: inbox.ramp,
  bouncesToday: inbox.bouncesToday, resting: inbox.resting, nextSend: inbox.nextText,
  lastReplyCheckAt: inbox.replyCheck.lastReadAt, replyCheckCouldOpenIt: inbox.replyCheck.couldOpen, repliesReadIn: inbox.readsVia,
  campaigns: inbox.campaigns.map((use) => ({ key: use.key, name: use.name, state: use.state, mostPerDay: use.perDay, sentToday: use.sentToday })),
});
const replyLine = (reply: ReplyRow) => ({ ...reply, successLabel: reply.successLabel || null });

type BatchListRow = {
  id: string; campaignKey: string; name: string; loadedBy: string; loadedAt: string; status: string; approvedBy: string | null; approvedAt: string | null;
  approvedWords: string | null; wordsVersion: string | null; rows: number | null; ready: number | null; held: number | null; emailed: number | null; followUpsLeft: number | null; stopped: number | null;
};
const PHASE_TEXT: Record<BatchPhase, string> = {
  waiting: "Waiting for its approver", sending: "Approved: its emails go at the campaign's send times", done: "Done: everyone in it has had every email", stopped: "Stopped by a founder",
};

/** The Monday-to-Sunday week asked for, never running past today: "this", "last", or the week holding a day. */
function weekRange(week: string, now: Date) {
  const current = thisWeek(now);
  if (week === "this") return current;
  if (week === "last") return lastWeek(now);
  if (Number.isNaN(Date.parse(`${week}T17:00:00Z`))) throw new ToolError("That isn't a day. Use this, last, or a day like 2026-11-09.");
  const monday = thisWeek(new Date(`${week}T17:00:00Z`)).from;
  if (monday > current.to) throw new ToolError("That week hasn't started yet.");
  if (monday === current.from) return current;
  const sunday = new Date(Date.parse(`${monday}T17:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  return { from: monday, to: sunday };
}

async function listCheck(a: { campaign: string; name: string; csv: string; first?: string; followUp?: string }, t: ToolContext, save: boolean) {
  const result = await loadList(t.db, { campaign: a.campaign, name: a.name, csv: a.csv, ...(a.first ? { first: a.first } : {}), ...(a.followUp ? { followUp: a.followUp } : {}), save }, {
    loadedBy: via(t.founder), now: t.now, newId: t.newId ?? (() => crypto.randomUUID()), mailingAddress: t.settings.mailingAddress || null, ...(t.checkMail ? { checkMail: t.checkMail } : {}),
  });
  if (!result.ok) throw new ToolError(result.error);
  const campaign = await readCampaign(t.db, a.campaign);
  const approvers = campaign?.approvers.join(" or ") || "the campaign's approver";
  return {
    saved: result.saved, batch: result.batchId, campaign: a.campaign, name: a.name.trim(),
    rows: result.rows, ready: result.ready, held: result.held, alreadyInCampaign: result.skipped,
    heldRows: result.holds, samples: result.samples, emailDomainsChecked: result.domains, newWords: result.wordsChanged,
    note: result.saved
      ? `Saved. The batch waits for ${approvers} to read its samples and press Approve on the screen: /campaigns/${a.campaign}/batches/${result.batchId}. Nothing in it sends before that. ${APPROVE_ON_SCREEN}`
      : `Nothing was saved. To load exactly this, call load_list with the same arguments.${result.wordsChanged ? " These words are new: loading saves them as the campaign's latest words." : ""}`,
  };
}

const listArgs = z.object({
  campaign: campaignArg, name: z.string().trim().min(1).max(120), csv: z.string().min(1).max(SCREEN_MAX_CSV_CHARS),
  first: z.string().max(8000).optional(), followUp: z.string().max(8000).optional(),
}).strict();
const listSchema = obj({
  campaign: campaignProperty,
  name: { type: "string", maxLength: 120, description: "A name for the batch, like Cities batch 2" },
  csv: { type: "string", description: `The list as CSV text with a header row and an email column. Up to ${CONNECTOR_MAX_LIST_ROWS} rows` },
  first: { type: "string", maxLength: 8000, description: "New words for the first email, starting with a line like Subject: ... Leave out to use the campaign's own words" },
  followUp: { type: "string", maxLength: 8000, description: "New words for the follow-up. Give it whenever you give first, if the campaign sends a follow-up" },
}, ["campaign", "name", "csv"]);

// ---------- the tools ----------
export const TOOLS: Tool[] = [
  tool({
    name: "engine_today", title: "Today", annotations: READ, saves: false, inputSchema: obj(), args: z.object({}).strict(),
    description: "Start here. The Today screen as data, for the founder this key belongs to: what needs them (most urgent first), how many emails each inbox has sent today, which campaigns are paused and why, each campaign's row, batches waiting for approval and replies waiting for an answer.",
    run: async (_a, t) => {
      const data = await todayData(t.db, t.settings.fccFirstInbox || null, t.now);
      const needs = needsYou(data, t.founder);
      return {
        founder: t.founder, day: data.day, at: t.now.toISOString(),
        summary: needs.cards.length ? `${needs.cards.length} ${needs.cards.length === 1 ? "thing needs" : "things need"} ${t.founder}.` : needs.calm,
        needsYou: needs.cards.map((card) => ({ title: card.title, detail: card.detail ?? null, tone: card.tone, rows: (card.rows ?? []).map((row) => ({ text: row.text, meta: row.meta ?? null })),
          onScreen: `${card.action.label}: ${card.action.href}` })),
        alsoToKnow: needs.quiet,
        sendingToday: { emails: data.sentToday, inboxes: data.inboxes.map(inboxLine) },
        pauses: data.campaigns.filter((row) => row.campaign.state === "paused").map((row) => ({
          campaign: row.campaign.key, name: row.campaign.name, reason: row.campaign.stateReason, by: row.campaign.stateBy, at: row.campaign.stateAt, pausedItself: row.autoPaused,
        })),
        campaigns: data.campaigns.map((row) => ({
          ...campaignLine(row.campaign), sentToday: row.counts.sentToday, dailyLimit: row.campaign.dailyLimit, waitingToSend: row.counts.ready, followUpsDue: row.counts.followUpsDue,
          batchesWaitingForApproval: row.waitingBatches, replies: row.counts.replies, bounced: row.counts.bounced, failedToSend: row.counts.failed,
        })),
        batchesWaitingForApproval: data.waitingBatches.map((batch) => ({
          id: batch.id, campaign: batch.campaignKey, campaignName: batch.campaign, name: batch.name, ready: batch.ready, held: batch.held, loadedBy: batch.loadedBy, loadedAt: batch.loadedAt,
          approvers: batch.approvers, why: batch.why === "waiting" ? "Never approved" : "Approved before its campaign's words changed, so it needs another look",
        })),
        repliesToAnswer: { count: data.toAnswer.count, byInbox: data.toAnswer.byInbox.map((group) => ({ inbox: group.address, owner: group.name, count: group.count })), newest: data.toAnswer.newest.map(replyLine) },
        replyCheck: { lastFinishedAt: data.replyCheck.at, couldNotOpen: data.replyCheck.unread, stopped: data.replyCheck.stale },
      };
    },
  }),
  tool({
    name: "list_campaigns", title: "Campaigns", annotations: READ, saves: false, inputSchema: obj(), args: z.object({}).strict(),
    description: "Every campaign: live or paused (and why), when its next email goes, today's count against its daily limit, its totals, and its success number with what that number is called.",
    run: async (_a, t) => {
      const [summaries, marked] = await Promise.all([
        campaignSummaries(t.db, t.now),
        t.db.prepare(`SELECT "campaignKey" AS key, COUNT(DISTINCT "contactId") AS n FROM "OutreachReply" WHERE "successAt" IS NOT NULL GROUP BY 1`).bind().all<{ key: string; n: number }>(),
      ]);
      return {
        campaigns: summaries.map(({ campaign, counts, lastRun, nextSend }) => ({
          ...campaignLine(campaign), nextSend, approvers: campaign.approvers,
          today: { sent: counts.sentToday, dailyLimit: campaign.dailyLimit, followUpsDue: counts.followUpsDue },
          totals: totals(counts),
          success: { label: successLabelOf(campaign), count: Number(marked.results.find((row) => row.key === campaign.key)?.n ?? 0) },
          lastSendCheck: lastRun ? { note: lastRun.note, at: lastRun.at } : null,
        })),
      };
    },
  }),
  tool({
    name: "get_campaign", title: "One campaign", annotations: READ, saves: false, inputSchema: obj({ campaign: campaignProperty }, ["campaign"]), args: z.object({ campaign: campaignArg }).strict(),
    target: (a) => ({ kind: "campaign", id: a.campaign }),
    description: `One campaign in full: its batches (waiting, sending, done or stopped, with counts, why rows are held and each batch's results), its numbers, schedule, limits, the email words, and follow-ups coming and on hold. Limits, inboxes, the schedule and the words can't be changed here. ${RESUME_ON_SCREEN}`,
    run: async (a, t) => {
      const detail = await campaignDetail(t.db, a.campaign, t.settings.fccFirstInbox || null, t.now);
      if (!detail) throw new ToolError("There's no such campaign. Use a key from list_campaigns.");
      const { campaign, counts } = detail;
      const [first, ...followUps] = campaign.words.steps;
      return {
        ...campaignLine(campaign), nextSend: detail.nextSend, note: campaign.note, approvers: campaign.approvers,
        numbers: { sentToday: counts.sentToday, followUpsDue: counts.followUpsDue, ...totals(counts), success: { label: successLabelOf(campaign), count: detail.success } },
        schedule: { sendDays: campaign.sendDays, sendHours: hours(campaign), startDay: campaign.startDay, endDay: campaign.endDay, goesBeforeCampaignsWithAHigherNumber: campaign.priority },
        limits: {
          dailyLimit: campaign.dailyLimit, followUps: campaign.followUps, businessDaysBeforeAFollowUp: campaign.followUpBusinessDays,
          inboxes: detail.inboxes.map((inbox) => ({ address: inbox.address, name: inbox.name, mostPerDayForThisCampaign: inbox.perDay, sentTodayForThisCampaign: inbox.sentByCampaign,
            inboxSentTodayInAll: inbox.inboxSent, inboxLimitToday: inbox.inboxDayMax, inboxLimitRightNow: inbox.inboxCapNow })),
        },
        words: {
          version: campaign.wordsVersion, firstEmail: first ? { subject: first.subject ?? null, body: first.body } : null, followUps: followUps.map((step) => step.body),
          note: "These are the campaign's latest words. Each batch keeps the words it was loaded with (get_batch shows them filled in). The engine adds the footer with the mailing address itself.",
        },
        holdRules: campaign.rules,
        batches: detail.batches.map((batch) => ({ ...batch, phaseText: PHASE_TEXT[batch.phase] })),
        followUps: { coming: detail.followUps.coming, onHold: detail.followUps.onHold },
        sentByDay: detail.days.slice(0, 14),
        bounces: detail.bounces.slice(0, 10), failedToSend: detail.problems.slice(0, 10),
        lastSendCheck: detail.lastRun ? { note: detail.lastRun.note, at: detail.lastRun.at } : null,
      };
    },
  }),
  tool({
    name: "list_batches", title: "Batches", annotations: READ, saves: false,
    inputSchema: obj({ campaign: { ...campaignProperty, description: "Only this campaign's batches" }, state: { type: "string", enum: [...BATCH_STATES], description: "waiting (for approval), sending, done, stopped, or all (default)" } }),
    args: z.object({ campaign: campaignArg.optional(), state: z.enum(BATCH_STATES).optional() }).strict(),
    target: (a) => (a.campaign ? { kind: "campaign", id: a.campaign } : null),
    description: `Batches in any campaign, newest first: waiting for approval, sending, done or stopped, with how many rows are ready, held and emailed. ${APPROVE_ON_SCREEN}`,
    run: async (a, t) => {
      const [campaigns, { results }] = await Promise.all([
        readCampaigns(t.db),
        t.db.prepare(`SELECT b."id", b."campaignKey", b."name", b."loadedBy", b."loadedAt", b."status", b."approvedBy", b."approvedAt", b."approvedWords", b."wordsVersion",
            COUNT(c."id") AS rows, SUM(c."status" = 'ready') AS ready, SUM(c."status" = 'held') AS held, SUM(c."stepsSent" > 0) AS emailed, SUM(c."status" = 'sent') AS followUpsLeft,
            SUM(c."status" NOT IN ('ready','held','sent','done')) AS stopped
          FROM "OutreachBatch" b LEFT JOIN "OutreachContact" c ON c."batchId" = b."id" ${a.campaign ? `WHERE b."campaignKey" = ?` : ""} GROUP BY b."id" ORDER BY b."loadedAt" DESC LIMIT 200`)
          .bind(...(a.campaign ? [a.campaign] : [])).all<BatchListRow>(),
      ]);
      const byKey = new Map(campaigns.map((campaign) => [campaign.key, campaign]));
      if (a.campaign && !byKey.has(a.campaign)) throw new ToolError("There's no such campaign. Use a key from list_campaigns.");
      const batches = results.map((row) => {
        const campaign = byKey.get(row.campaignKey);
        // Approved on the words it sends with: its own, or the campaign's for an older batch.
        const wordsCurrent = row.approvedWords !== null && row.approvedWords === (row.wordsVersion ?? campaign?.wordsVersion ?? null);
        const ready = Number(row.ready ?? 0);
        const followUpsLeft = Number(row.followUpsLeft ?? 0);
        const phase = batchPhase({ status: row.status, wordsCurrent, ready }, followUpsLeft);
        return {
          id: row.id, campaign: row.campaignKey, campaignName: campaign?.name ?? row.campaignKey, name: row.name, state: phase, stateText: PHASE_TEXT[phase],
          rows: Number(row.rows ?? 0), ready, held: Number(row.held ?? 0), emailed: Number(row.emailed ?? 0), followUpsLeft, stoppedForGood: Number(row.stopped ?? 0),
          loadedBy: row.loadedBy, loadedAt: row.loadedAt, approvedBy: row.approvedBy, approvedAt: row.approvedAt, approvers: campaign?.approvers ?? [],
        };
      }).filter((batch) => !a.state || a.state === "all" || batch.state === a.state);
      return { count: batches.length, batches };
    },
  }),
  tool({
    name: "get_batch", title: "One batch", annotations: READ, saves: false, inputSchema: obj({ batch: batchProperty }, ["batch"]), args: z.object({ batch: batchArg }).strict(),
    target: (a) => ({ kind: "batch", id: a.batch }),
    description: `One batch as its approver sees it: up to 10 sample emails exactly as they go out (first email and follow-up), and every held row with its reason. ${APPROVE_ON_SCREEN} Stopping a batch is also done on the screen.`,
    run: async (a, t) => {
      const review = await batchReview(t.db, a.batch, t.settings.mailingAddress || null, 10);
      if (!review) throw new ToolError("There's no such batch. Use an id from list_batches.");
      const { batch, campaign } = review;
      const phase = "phase" in batch ? (batch as { phase: BatchPhase }).phase : null;
      return {
        batch: { ...batch, campaign: campaign.key, campaignName: campaign.name, approvers: campaign.approvers, ...(phase ? { phaseText: PHASE_TEXT[phase] } : {}) },
        samples: review.samples, heldRows: review.held.slice(0, 200), heldRowsInAll: review.held.length,
        onScreen: `/campaigns/${campaign.key}/batches/${batch.id}`,
        note: `${APPROVE_ON_SCREEN} Only ${campaign.approvers.join(" or ") || "a named founder"} can approve this campaign's batches.`,
      };
    },
  }),
  tool({
    name: "list_replies", title: "Replies", annotations: READ, saves: false,
    inputSchema: obj({
      filter: { type: "string", enum: [...REPLY_FILTERS], description: "to-answer (default): real replies nobody has answered. answered, automatic (out of office and the like), no-thanks, or all" },
      campaign: { type: "string", description: `Only this campaign's replies: a key from list_campaigns, or "${FCC_FILTER}" for the ended FCC campaign's replies (read only)` },
      since: { type: "string", description: "Only replies from this day or time on: 2026-11-09 or 2026-11-09T14:00:00Z" },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "How many (default 25)" },
    }),
    args: z.object({
      filter: z.enum(REPLY_FILTERS as [string, ...string[]]).optional(), campaign: campaignArg.optional(),
      since: z.string().regex(DAY_OR_TIME, "Give a day or time like 2026-11-09 or 2026-11-09T14:00:00Z.").optional(), limit: z.number().int().min(1).max(100).optional(),
    }).strict(),
    target: (a) => (a.campaign ? { kind: "campaign", id: a.campaign } : null),
    description: "Replies the hourly inbox check recorded, newest first: who wrote, what they wrote, which campaign, which inbox to answer from, and whether it is answered or counts as a success. Also how many replies each filter holds.",
    run: async (a, t) => {
      const list = await listReplies(t.db, { filter: (a.filter ?? "to-answer") as (typeof REPLY_FILTERS)[number], campaign: a.campaign ?? null, since: a.since ?? null, limit: a.limit ?? 25 });
      return { filter: a.filter ?? "to-answer", replies: list.rows.map(replyLine), howManyByFilter: list.counts, byCampaign: list.campaigns, fccReplies: list.fccReplies };
    },
  }),
  tool({
    name: "get_reply", title: "One reply", annotations: READ, saves: false, inputSchema: obj({ id: { type: "string", description: "The reply id from list_replies" } }, ["id"]), args: z.object({ id: replyArg }).strict(),
    target: (a) => ({ kind: "reply", id: a.id }),
    description: "One reply: the words the engine stored (the first lines, up to 600 characters), who wrote it, and which founder answers it from which inbox. The engine never sends an answer; a founder writes back from that inbox.",
    run: async (a, t) => {
      const reply = await getReply(t.db, a.id);
      if (!reply) throw new ToolError("There's no such reply. Use an id from list_replies.");
      return {
        reply: replyLine(reply),
        howToAnswer: reply.answerFrom
          ? `${reply.answerFromName ?? "The inbox's owner"} answers from ${reply.answerFrom}, the inbox that sent the email, so the thread holds. Then mark it answered with mark_reply_answered.`
          : "This reply is kept to read. It has no inbox on file to answer from.",
      };
    },
  }),
  tool({
    name: "find_contact", title: "Find a contact", annotations: READ, saves: false,
    inputSchema: obj({
      query: { type: "string", minLength: 2, maxLength: 120, description: "An email address, part of one, or an organisation or person's name" },
      campaign: { ...campaignProperty, description: "Only look in this campaign" },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "How many (default 25)" },
    }, ["query"]),
    args: z.object({ query: z.string().trim().min(2).max(120), campaign: campaignArg.optional(), limit: z.number().int().min(1).max(50).optional() }).strict(),
    description: `Look someone up by email address or organisation: every campaign row they are in, where each stands, emails sent, replies, and whether the address is blocked from every campaign.`,
    run: async (a, t) => {
      const hits = await findContacts(t.db, a.query, { campaign: a.campaign ?? null, limit: a.limit ?? 25 });
      const blocked = await blockedAmong(t.db, hits.map((hit) => hit.email));
      return {
        query: a.query, found: hits.length,
        contacts: hits.map((hit) => ({ ...hit, blocked: blocked.has(hit.email) })),
        note: hits.length === 0 ? "Nobody in any campaign matches. check_do_not_email says whether an address is blocked." : null,
      };
    },
  }),
  tool({
    name: "inbox_health", title: "Inboxes", annotations: READ, saves: false, inputSchema: obj(), args: z.object({}).strict(),
    description: "Each sending inbox today: emails sent of its limit, bounces, whether it is resting for the day, when its next email can go, when the reply check last read it, and which campaigns use it. Inboxes and limits can't be changed here.",
    run: async (_a, t) => {
      const data = await todayData(t.db, t.settings.fccFirstInbox || null, t.now);
      return { day: data.day, at: t.now.toISOString(), emailsSentToday: data.sentToday, inboxes: data.inboxes.map(inboxLine), replyCheckLastFinishedAt: data.replyCheck.at };
    },
  }),
  tool({
    name: "check_do_not_email", title: "Do-not-email check", annotations: READ, saves: false,
    inputSchema: obj({ address: { type: "string", maxLength: 254, description: "A full email address, or a domain like example.gov" } }, ["address"]),
    args: z.object({ address: z.string().trim().min(3).max(254) }).strict(),
    description: "Is an address or a whole domain blocked from every campaign, and why (it bounced, they said no thanks, a founder blocked it). The do-not-email list can't be changed here.",
    run: async (a, t) => {
      const check = await checkDoNotEmail(t.db, a.address);
      if (check.kind === "unreadable") throw new ToolError(check.summary);
      return check;
    },
  }),

  tool({
    name: "week_numbers", title: "A week's numbers", annotations: READ, saves: false,
    inputSchema: obj({ week: { type: "string", description: "this (default: Monday to today), last (last Monday to Sunday), or any day of the week you want, like 2026-11-09" } }),
    args: z.object({ week: z.string().regex(/^(this|last|\d{4}-\d{2}-\d{2})$/, "Use this, last, or a day like 2026-11-09.").optional() }).strict(),
    description: "The numbers the founders judge each campaign by, for one Monday-to-Sunday week (Toronto days): emails sent as first emails and follow-ups, real replies, no thanks, automatic replies, bounces and the campaign's success number, per campaign and in total, with all-time totals, what is left to send, emails per inbox, and who wrote back. The Monday 8 a.m. email is last week's.",
    run: async (a, t) => {
      const range = weekRange(a.week ?? "this", t.now);
      const week = await weekNumbers(t.db, range.from, range.to, t.now);
      return { week: `${range.from} to ${range.to}`, ...week };
    },
  }),

  // Writes: each is something the screen already lets a founder do, and none of them can make an email go out.
  tool({
    name: "pause_campaign", title: "Pause a campaign", annotations: { ...WRITE, idempotentHint: true }, saves: true,
    inputSchema: obj({ campaign: campaignProperty, reason: { type: "string", maxLength: 300, description: "Why, in plain words. The founders see it on the screen" } }, ["campaign", "reason"]),
    args: z.object({ campaign: campaignArg, reason: z.string().trim().min(1).max(300) }).strict(),
    target: (a) => ({ kind: "campaign", id: a.campaign }),
    description: `Pause one campaign, with a reason: nothing in it sends until a founder starts it again. Pausing is always allowed and touches only that campaign. ${RESUME_ON_SCREEN}`,
    run: async (a, t) => {
      const campaign = await readCampaign(t.db, a.campaign);
      if (!campaign) throw new ToolError("There's no such campaign. Use a key from list_campaigns.");
      const changed = await pauseCampaign(t.db, a.campaign, a.reason, via(t.founder), t.now);
      return changed
        ? { campaign: campaign.key, name: campaign.name, state: "paused", changed: true, reason: a.reason, by: via(t.founder), at: t.now.toISOString(),
          note: `Paused. Nothing in it sends until a founder presses Resume on /campaigns/${campaign.key}. ${RESUME_ON_SCREEN}` }
        : { campaign: campaign.key, name: campaign.name, state: "paused", changed: false, reason: campaign.stateReason, by: campaign.stateBy, at: campaign.stateAt,
          note: `It was already paused, so the first reason is kept. ${RESUME_ON_SCREEN}` };
    },
  }),
  tool({
    name: "check_list", title: "Check a list", annotations: { ...WRITE, idempotentHint: true }, saves: false, inputSchema: listSchema, args: listArgs,
    target: (a) => ({ kind: "campaign", id: a.campaign }),
    description: `The screen's "Check the list". Saves nothing. Checks a CSV against a campaign's words and rules, looks up each email domain's mail server and the do-not-email list, and returns how many rows are ready and held (with each reason) and the first 3 emails exactly as they would go. Up to ${CONNECTOR_MAX_LIST_ROWS} rows and 40 different email domains at a time, as on the screen.`,
    run: (a, t) => listCheck(a, t, false),
  }),
  tool({
    name: "load_list", title: "Load a batch", annotations: WRITE, saves: true, inputSchema: listSchema, args: listArgs,
    target: (a) => ({ kind: "campaign", id: a.campaign }),
    description: `The screen's "Load this batch": saves the list as a batch that waits for the campaign's approver. Nothing in it sends until they approve it on the screen. Run check_list first and read its samples. New words given here become the campaign's latest words. Up to ${CONNECTOR_MAX_LIST_ROWS} rows and 40 different email domains at a time, as on the screen. ${APPROVE_ON_SCREEN}`,
    run: (a, t) => listCheck(a, t, true),
  }),
  tool({
    name: "send_test", title: "Send me a test", annotations: WRITE, saves: true,
    inputSchema: obj({ batch: batchProperty, count: { type: "integer", minimum: 1, maximum: 3, description: "How many samples (default 3)" } }, ["batch"]),
    args: z.object({ batch: batchArg, count: z.number().int().min(1).max(3).optional() }).strict(),
    target: (a) => ({ kind: "batch", id: a.batch }),
    description: "Queue a batch's sample emails (each first email, then its follow-up) to the own inbox of the founder this key belongs to, and nowhere else. They arrive within 15 minutes. There is no way to name another address.",
    run: async (a, t) => {
      const batch = await t.db.prepare(`SELECT "id","campaignKey","name","status" FROM "OutreachBatch" WHERE "id" = ?`).bind(a.batch).first<{ id: string; campaignKey: string; name: string; status: string }>();
      if (!batch) throw new ToolError("There's no such batch. Use an id from list_batches.");
      if (batch.status === "stopped") throw new ToolError("This batch was stopped, so there is nothing to test.");
      const to = ownInbox(t.founder);
      const count = a.count ?? 3;
      try {
        await requestTestSend(t.db, { id: (t.newId ?? (() => crypto.randomUUID()))(), batchId: batch.id, to, by: via(t.founder), count }, t.now);
      } catch (error) {
        // The queue's own refusals are plain sentences; anything else is a real failure.
        if (error instanceof Error && /^(Test emails only|Five tests)/.test(error.message)) throw new ToolError(error.message);
        throw error;
      }
      return { queued: true, batch: batch.id, name: batch.name, campaign: batch.campaignKey, samples: count, to,
        note: `Up to ${count} sample emails and their follow-ups go to ${t.founder}'s own inbox within 15 minutes. Test emails can go nowhere else.` };
    },
  }),
  tool({
    name: "mark_reply_answered", title: "Mark a reply", annotations: { ...WRITE, idempotentHint: true }, saves: true,
    inputSchema: obj({
      id: { type: "string", description: "The reply id from list_replies" },
      answered: { type: "boolean", description: "true: a founder has written back, so it leaves To answer (the default when success is not given). false: not answered after all" },
      success: { type: "boolean", description: "true: this reply counts toward the campaign's success number (given alone, it leaves answered as it is). false: it doesn't after all" },
    }, ["id"]),
    args: z.object({ id: replyArg, answered: z.boolean().optional(), success: z.boolean().optional() }).strict(),
    target: (a) => ({ kind: "reply", id: a.id }),
    description: "The Replies screen's marks: mark a reply answered once a founder has written back from their inbox, and optionally mark it as one that counts toward the campaign's success number. It changes only those marks: no email is sent and nobody's mail is touched. Mark a reply answered only when the founder says they answered it.",
    run: async (a, t) => {
      const result = await markReply(t.db, a.id, { ...(a.answered !== undefined ? { answered: a.answered } : a.success === undefined ? { answered: true } : {}), ...(a.success === undefined ? {} : { success: a.success }) }, t.founder, t.now);
      if (!result.ok) throw new ToolError(result.why);
      return { reply: replyLine(result.reply) };
    },
  }),
];
