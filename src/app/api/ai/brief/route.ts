import { NextResponse } from "next/server";
import { z } from "zod";

import { getCallBrief } from "@/lib/ai/call-brief";
import { AiError } from "@/lib/ai/gemini";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import { historyView } from "@/lib/prospect-format";
import { listActivityFor, type ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const Command = z.object({ prospectId: z.string().min(1).max(300) }).strict();

/** Returns (or generates, within the monthly AI budget) a call brief for one business. */
export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return auth.response;
  const actor = getM2OwnerIdentityActor(auth.session.user.email);
  if (!actor) return json({ error: "Only Riley or Aidan can use AI briefs." }, 403);
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) return json({ error: "Open this from the Axiom workspace." }, 403);
  const parsed = Command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request." }, 400);

  const db = getDatabase() as unknown as ProspectDb;
  const row = await db.prepare(`SELECT "prospectId","name","city","niche","label","websiteUrl","reasons" FROM "EngineProspect" WHERE "prospectId" = ?`)
    .bind(parsed.data.prospectId).first<Record<string, string | null>>();
  if (!row) return json({ error: "That business is no longer on the list." }, 404);
  let reasons: string[] = [];
  try { reasons = JSON.parse(row.reasons ?? "[]") as string[]; } catch { reasons = []; }
  const history = historyView((await listActivityFor(db, [parsed.data.prospectId])).get(parsed.data.prospectId) ?? []);
  const env = (getCloudflareBindings() ?? {}) as Record<string, unknown>;
  try {
    const result = await getCallBrief(db, {
      prospectId: row.prospectId!, name: row.name!, city: row.city!, niche: row.niche!, label: row.label!, websiteUrl: row.websiteUrl, reasons, history,
    }, {
      apiKey: typeof env.GEMINI_API_KEY === "string" ? env.GEMINI_API_KEY.trim() || undefined : undefined,
      caller: actor, monthlyBudgetUsd: Number(env.AI_MONTHLY_BUDGET_USD ?? 5) || 5,
    });
    return json(result);
  } catch (error) {
    if (error instanceof AiError) return json({ error: error.message, code: error.code }, error.code === "NOT_CONFIGURED" ? 503 : error.code === "BUDGET" ? 402 : 502);
    return json({ error: "Could not make a brief. Try again." }, 503);
  }
}
