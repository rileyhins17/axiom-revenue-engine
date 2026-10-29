import { z } from "zod";

import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

import { AI_MODEL, AiError, costMicroUsd, generateJson } from "./gemini";

/**
 * AI call brief: turns the engine's observed website problems and the team's own
 * call notes into an opener, talking points and objection replies. Grounded only
 * in those inputs, schema-validated, cached per input, and cost-capped per month.
 */
export const CALL_BRIEF_PROMPT_VERSION = "call-brief-v1";
export const DEFAULT_MONTHLY_BUDGET_USD = 5;
const MAX_INPUT_TOKENS = 2_000;
const MAX_OUTPUT_TOKENS = 700;
const RESERVE_MICRO_USD = costMicroUsd(MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS * 2);

export const CallBriefSchema = z.object({
  opener: z.string().min(20).max(420),
  talkingPoints: z.array(z.string().min(5).max(220)).min(1).max(3),
  objections: z.array(z.object({ objection: z.string().min(3).max(160), reply: z.string().min(5).max(300) })).min(1).max(3),
  nextStep: z.string().min(5).max(200),
}).strict();
export type CallBrief = z.infer<typeof CallBriefSchema>;

export type BriefInput = {
  prospectId: string; name: string; city: string; niche: string; label: string; websiteUrl: string | null;
  reasons: string[]; history: { when: string; who: string; what: string; note: string }[];
};

/** Claims the model must never make: results, prices, urgency, fake familiarity or clients. */
const FORBIDDEN = /\b(guarantee[sd]?|\d+\s?%|percent|double|triple|roi|revenue|\$\s?\d|price|cost you|our clients|clients like|case stud|we worked with|last week i|limited time|act now|rank (?:you )?(?:#?1|first)|first page)\b/i;

export function briefViolations(brief: CallBrief): string[] {
  const text = [brief.opener, ...brief.talkingPoints, ...brief.objections.flatMap((o) => [o.objection, o.reply]), brief.nextStep].join("\n");
  const hit = text.match(FORBIDDEN);
  return hit ? [`unsupported claim: "${hit[0]}"`] : [];
}

const SYSTEM = `You help a two-person Kitchener-Waterloo web design studio (Axiom Web) prepare short cold calls to local trades businesses.
Rules:
- Use ONLY the facts given: business name, trade, city, observed website problems, and the team's own call notes. Do not invent anything else.
- Never promise or estimate results, rankings, revenue, percentages or prices. Never mention other clients, case studies or past work.
- Plain, friendly, Canadian English. No hype. Keep the opener under 60 words and ask one easy question.
- If notes show a previous conversation, the opener must pick up from it naturally.
- The goal of the call is to offer a free mock-up of a phone-friendly site and book a 15-minute look.
Reply with JSON only: {"opener": string, "talkingPoints": string[1-3], "objections": [{"objection": string, "reply": string}] (1-3), "nextStep": string}.`;

export function briefPrompt(input: BriefInput, caller: string) {
  const facts = {
    caller, business: input.name, trade: input.niche.toLowerCase(), city: input.city.toLowerCase(),
    website: input.label === "NO_WEBSITE" ? "none listed on Google" : input.websiteUrl,
    observedProblems: input.label === "NO_WEBSITE" ? ["No website listed on Google Maps."] : input.reasons.slice(0, 4),
    previousContact: input.history.slice(0, 5).map((item) => `${item.when} ${item.who}: ${item.what}${item.note ? ` - ${item.note.slice(0, 240)}` : ""}`),
  };
  return JSON.stringify(facts);
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const monthOf = (now: Date) => now.toISOString().slice(0, 7);

export async function aiSpend(db: ProspectDb, now = new Date()) {
  const row = await db.prepare(`SELECT COALESCE(SUM("costMicroUsd"),0) AS spent, COUNT(*) AS calls FROM "AiUsage" WHERE "month" = ?`).bind(monthOf(now)).first<{ spent: number; calls: number }>();
  return { spentUsd: Number(row?.spent ?? 0) / 1_000_000, calls: Number(row?.calls ?? 0) };
}

export async function cachedBrief(db: ProspectDb, input: BriefInput, caller: string): Promise<CallBrief | null> {
  const hash = await sha256(`${CALL_BRIEF_PROMPT_VERSION}|${AI_MODEL}|${briefPrompt(input, caller)}`);
  const row = await db.prepare(`SELECT "brief" FROM "AiCallBrief" WHERE "prospectId" = ? AND "inputHash" = ?`).bind(input.prospectId, hash).first<{ brief: string }>();
  if (!row) return null;
  const parsed = CallBriefSchema.safeParse(JSON.parse(row.brief));
  return parsed.success ? parsed.data : null;
}

/** Returns a cached brief, or generates one within the monthly budget. */
export async function getCallBrief(db: ProspectDb, input: BriefInput, options: {
  apiKey: string | undefined; caller: "RILEY" | "AIDAN"; monthlyBudgetUsd?: number; now?: Date; fetchImpl?: typeof fetch; newId?: () => string;
}): Promise<{ brief: CallBrief; cached: boolean }> {
  const callerName = options.caller === "AIDAN" ? "Aidan" : "Riley";
  const prompt = briefPrompt(input, callerName);
  const hash = await sha256(`${CALL_BRIEF_PROMPT_VERSION}|${AI_MODEL}|${prompt}`);
  const cached = await db.prepare(`SELECT "brief" FROM "AiCallBrief" WHERE "prospectId" = ? AND "inputHash" = ?`).bind(input.prospectId, hash).first<{ brief: string }>();
  if (cached) {
    const parsed = CallBriefSchema.safeParse(JSON.parse(cached.brief));
    if (parsed.success) return { brief: parsed.data, cached: true };
  }
  if (!options.apiKey) throw new AiError("NOT_CONFIGURED", "Add the Gemini API key to turn on AI briefs.");
  if (prompt.length > MAX_INPUT_TOKENS * 3) throw new AiError("INVALID_OUTPUT", "Too much history for a brief.");

  const now = options.now ?? new Date();
  const budgetMicro = Math.round(Math.min(options.monthlyBudgetUsd ?? DEFAULT_MONTHLY_BUDGET_USD, 20) * 1_000_000);
  const usageId = options.newId?.() ?? crypto.randomUUID();
  // Atomic reservation: only inserts while this month's spend plus the worst case stays under budget.
  const reserved = await db.prepare(`INSERT INTO "AiUsage" ("usageId","month","feature","model","promptVersion","status","costMicroUsd","actor")
    SELECT ?, ?, 'CALL_BRIEF', ?, ?, 'RESERVED', ?, ?
    WHERE (SELECT COALESCE(SUM("costMicroUsd"),0) FROM "AiUsage" WHERE "month" = ?) + ? <= ?`)
    .bind(usageId, monthOf(now), AI_MODEL, CALL_BRIEF_PROMPT_VERSION, RESERVE_MICRO_USD, options.caller, monthOf(now), RESERVE_MICRO_USD, budgetMicro).run() as { changes?: number; meta?: { changes?: number } };
  if ((reserved.meta?.changes ?? reserved.changes ?? 0) !== 1) throw new AiError("BUDGET", "This month's AI budget is used up. Briefs come back on the 1st.");

  let completion;
  try {
    completion = await generateJson({ apiKey: options.apiKey, system: SYSTEM, user: prompt, maxOutputTokens: MAX_OUTPUT_TOKENS, fetchImpl: options.fetchImpl });
  } catch (error) {
    await db.prepare(`UPDATE "AiUsage" SET "status"='FAILED', "costMicroUsd"=0 WHERE "usageId"=?`).bind(usageId).run();
    throw error;
  }
  const cost = Math.min(100_000, costMicroUsd(completion.inputTokens, completion.outputTokens));
  await db.prepare(`UPDATE "AiUsage" SET "status"='SETTLED', "inputTokens"=?, "outputTokens"=?, "costMicroUsd"=? WHERE "usageId"=?`)
    .bind(completion.inputTokens, completion.outputTokens, cost, usageId).run();

  let parsed;
  try { parsed = CallBriefSchema.safeParse(JSON.parse(completion.text)); } catch { parsed = null; }
  if (!parsed?.success) throw new AiError("INVALID_OUTPUT", "The AI reply was unusable. Try again.");
  if (briefViolations(parsed.data).length) throw new AiError("INVALID_OUTPUT", "The AI made a claim we can't back up, so it was discarded. Try again.");
  await db.prepare(`INSERT INTO "AiCallBrief" ("prospectId","inputHash","model","promptVersion","brief","usageId") VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
    .bind(input.prospectId, hash, AI_MODEL, CALL_BRIEF_PROMPT_VERSION, JSON.stringify(parsed.data), usageId).run();
  return { brief: parsed.data, cached: false };
}
