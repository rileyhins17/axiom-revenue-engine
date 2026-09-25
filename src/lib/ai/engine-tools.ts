import { z } from "zod";

import { aiSpend } from "@/lib/ai/call-brief";
import { historyView, prospectOutcomeText, torontoMidnight, torontoToday } from "@/lib/prospect-format";
import { emailOverview } from "@/lib/revenue-engine/engine-email";
import { listActivityFor, listProspects, prospectActivityStats, prospectCounts, type ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

/**
 * The engine's tool surface, shared by the in-app assistant (Gemini function
 * calling) and the MCP endpoint (Claude Code). Everything reads, except filing
 * or updating a fix request. Nothing here can send, call, delete or change leads.
 */
export type ToolContext = { db: ProspectDb; actor: "RILEY" | "AIDAN"; source: "OWNER" | "ASSISTANT"; now?: Date; allowFixUpdates?: boolean };
export type EngineTool = {
  name: string; description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(args: unknown, ctx: ToolContext): Promise<unknown>;
};

const LABEL_TEXT = { STRONG: "weak website", WEAK: "website is fine", NO_WEBSITE: "no website" } as const;
const clip = (value: string | null | undefined, max = 300) => value ? value.slice(0, max) : value ?? null;

const Search = z.object({
  text: z.string().max(80).optional(), city: z.enum(["KITCHENER", "WATERLOO", "CAMBRIDGE"]).optional(),
  trade: z.enum(["ROOFING", "HVAC", "LANDSCAPING"]).optional(),
  list: z.enum(["call", "visit", "followups", "contacted", "all"]).optional(), limit: z.number().int().min(1).max(25).optional(),
}).strict();
const Business = z.object({ id: z.string().max(300).optional(), name: z.string().max(120).optional() }).strict();
const Activity = z.object({ days: z.number().int().min(1).max(90).optional(), who: z.enum(["RILEY", "AIDAN"]).optional() }).strict();
const FixCreate = z.object({ summary: z.string().min(3).max(200), details: z.string().max(4000), page: z.string().max(200).optional() }).strict();
const FixList = z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "WONT_FIX"]).optional() }).strict();
const FixUpdate = z.object({ requestId: z.string().max(80), status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "WONT_FIX"]), resolution: z.string().max(2000).optional() }).strict();

async function findBusiness(db: ProspectDb, args: z.infer<typeof Business>) {
  if (args.id) return (await listProspects(db, "all", torontoToday(), 1000)).find((row) => row.prospectId === args.id) ?? null;
  const needle = (args.name ?? "").trim().toLowerCase();
  if (!needle) return null;
  const rows = await listProspects(db, "all", torontoToday(), 1000);
  return rows.find((row) => row.name.toLowerCase() === needle) ?? rows.find((row) => row.name.toLowerCase().includes(needle)) ?? null;
}

export const ENGINE_TOOLS: EngineTool[] = [
  {
    name: "get_overview",
    description: "Headline numbers: how many businesses are ready to call, walk-in addresses, follow-ups due, contacted; this week's calls, conversations, walk-ins, interested, meetings and wins per person; email and AI budget status.",
    parameters: { type: "object", properties: {} },
    async run(_args, { db, now = new Date() }) {
      const today = torontoToday(now);
      const [counts, week, email, spend] = await Promise.all([
        prospectCounts(db, today), prospectActivityStats(db, torontoMidnight(now, { week: true })),
        emailOverview(db, now).catch(() => null), aiSpend(db, now).catch(() => null),
      ]);
      return {
        today, lists: counts, thisWeek: week,
        email: email ? { on: email.enabled, approved: email.templateApproved, sentToday: email.sentToday, sentTotal: email.sentTotal, readyToEmail: email.eligible, unsubscribed: email.suppressed } : null,
        aiSpendThisMonthUsd: spend?.spentUsd ?? null,
      };
    },
  },
  {
    name: "search_businesses",
    description: "Find businesses on the call list. Filter by words in the name or phone, city, trade, and list (call = ready to call, visit = has an address for walk-ins, followups = due now, contacted = anyone we've reached out to, all). Returns up to 25.",
    parameters: { type: "object", properties: {
      text: { type: "string" }, city: { type: "string", enum: ["KITCHENER", "WATERLOO", "CAMBRIDGE"] },
      trade: { type: "string", enum: ["ROOFING", "HVAC", "LANDSCAPING"] }, list: { type: "string", enum: ["call", "visit", "followups", "contacted", "all"] },
      limit: { type: "integer" },
    } },
    async run(raw, { db, now = new Date() }) {
      const args = Search.parse(raw);
      const text = args.text?.toLowerCase();
      const rows = (await listProspects(db, args.list ?? "all", torontoToday(now), 1000))
        .filter((row) => (!args.city || row.city === args.city) && (!args.trade || row.niche === args.trade)
          && (!text || row.name.toLowerCase().includes(text) || (row.phone ?? "").includes(text) || (row.address ?? "").toLowerCase().includes(text)));
      return { total: rows.length, businesses: rows.slice(0, args.limit ?? 10).map((row) => ({
        id: row.prospectId, name: row.name, city: row.city, trade: row.niche, website: LABEL_TEXT[row.label], problems: row.reasons.slice(0, 3),
        phone: row.phone, address: row.address, lastResult: prospectOutcomeText(row.lastOutcome, row.lastCallerOutcome) ?? "not contacted",
        lastBy: row.lastActor, followUp: row.followUpAt, attempts: row.attempts,
      })) };
    },
  },
  {
    name: "get_business",
    description: "Everything about one business: website problems the engine found, phone, address, and the full call/visit/email history with notes. Look up by id or by (part of) the name.",
    parameters: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
    async run(raw, { db }) {
      const row = await findBusiness(db, Business.parse(raw));
      if (!row) return { found: false };
      const history = historyView((await listActivityFor(db, [row.prospectId])).get(row.prospectId) ?? []);
      return { found: true, id: row.prospectId, name: row.name, city: row.city, trade: row.niche, website: row.websiteUrl, websiteVerdict: LABEL_TEXT[row.label],
        problems: row.reasons, phone: row.phone, address: row.address, followUp: row.followUpAt,
        history: history.map((item) => ({ when: item.when, who: item.who, what: item.what, note: clip(item.note), followUp: item.followUpAt })) };
    },
  },
  {
    name: "recent_activity",
    description: "Calls, visits and emails logged in the last N days (default 7), newest first, optionally for one person, with outcomes and notes.",
    parameters: { type: "object", properties: { days: { type: "integer" }, who: { type: "string", enum: ["RILEY", "AIDAN"] } } },
    async run(raw, { db, now = new Date() }) {
      const args = Activity.parse(raw);
      const since = new Date(now.getTime() - (args.days ?? 7) * 86_400_000).toISOString();
      const { results } = await db.prepare(`SELECT a.effectiveAt AS "createdAt", a."actor", a."channel", a."outcome", a."callerOutcome", a."note", a."followUpAt", p."name"
        FROM "EngineProspectActivityCurrent" a JOIN "EngineProspect" p ON p."prospectId" = a."prospectId"
        WHERE a.effectiveAt >= ?${args.who ? ` AND a."actor" = ?` : ""} ORDER BY a.effectiveAt DESC LIMIT 60`)
        .bind(...(args.who ? [since, args.who] : [since])).all<Record<string, string | null>>();
      return { since, entries: results.map((r) => ({ when: r.createdAt, who: r.actor, business: r.name, channel: r.channel, result: prospectOutcomeText(r.outcome, r.callerOutcome), note: clip(r.note, 200), followUp: r.followUpAt })) };
    },
  },
  {
    name: "report_problem",
    description: "File a fix request for the developers when something in the app is broken, confusing or wrong (for example a business marked as a weak website that is actually fine). Only use when the user describes a problem or asks you to report one.",
    parameters: { type: "object", properties: { summary: { type: "string" }, details: { type: "string" }, page: { type: "string" } }, required: ["summary", "details"] },
    async run(raw, { db, actor, source }) {
      const args = FixCreate.parse(raw);
      const requestId = crypto.randomUUID();
      await db.prepare(`INSERT INTO "AppFixRequest" ("requestId","summary","details","page","source","actor") VALUES (?,?,?,?,?,?)`)
        .bind(requestId, args.summary, args.details, args.page ?? null, source, actor).run();
      return { filed: true, requestId };
    },
  },
  {
    name: "list_fix_requests",
    description: "Fix requests reported from the app, newest first (default: open ones).",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "DONE", "WONT_FIX"] } } },
    async run(raw, { db }) {
      const args = FixList.parse(raw);
      const { results } = await db.prepare(`SELECT * FROM "AppFixRequest" WHERE "status" = ? ORDER BY "createdAt" DESC LIMIT 50`).bind(args.status ?? "OPEN").all();
      return { requests: results };
    },
  },
];

/** Only for trusted developer sessions (MCP); the in-app assistant never gets this. */
export const UPDATE_FIX_TOOL: EngineTool = {
  name: "update_fix_request",
  description: "Mark a fix request IN_PROGRESS, DONE or WONT_FIX with a short resolution (commit, deploy, or reason).",
  parameters: { type: "object", properties: { requestId: { type: "string" }, status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "DONE", "WONT_FIX"] }, resolution: { type: "string" } }, required: ["requestId", "status"] },
  async run(raw, { db, allowFixUpdates }) {
    if (!allowFixUpdates) throw new Error("Not allowed here.");
    const args = FixUpdate.parse(raw);
    await db.prepare(`UPDATE "AppFixRequest" SET "status" = ?, "resolution" = COALESCE(?, "resolution"), "updatedAt" = ? WHERE "requestId" = ?`)
      .bind(args.status, args.resolution ?? null, new Date().toISOString(), args.requestId).run();
    return { updated: true };
  },
};

export async function runTool(tools: EngineTool[], name: string, args: unknown, ctx: ToolContext) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool ${name}` };
  try { return await tool.run(args ?? {}, ctx); } catch (error) {
    return { error: error instanceof z.ZodError ? "Invalid arguments." : error instanceof Error ? error.message.slice(0, 200) : "Tool failed." };
  }
}
