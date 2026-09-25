import { NextResponse } from "next/server";

import { askAssistant, ChatSchema } from "@/lib/ai/assistant";
import { AiError } from "@/lib/ai/gemini";
import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

/** Ask AI: one chat turn answered from live engine data through read-only tools. */
export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return auth.response;
  const actor = getM2OwnerIdentityActor(auth.session.user.email);
  if (!actor) return json({ error: "Only Riley or Aidan can use Ask AI." }, 403);
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) return json({ error: "Open this from the Axiom workspace." }, 403);
  const text = await request.text();
  if (text.length > 48_000) return json({ error: "That conversation is too long. Start a new one." }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: "Invalid request." }, 400); }
  const parsed = ChatSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid request." }, 400);
  const env = (getCloudflareBindings() ?? {}) as Record<string, unknown>;
  try {
    const reply = await askAssistant(getDatabase() as unknown as ProspectDb, parsed.data, {
      apiKey: typeof env.GEMINI_API_KEY === "string" ? env.GEMINI_API_KEY.trim() || undefined : undefined,
      actor, monthlyBudgetUsd: Number(env.AI_MONTHLY_BUDGET_USD ?? 5) || 5,
    });
    return json(reply);
  } catch (error) {
    if (error instanceof AiError) return json({ error: error.message, code: error.code }, error.code === "NOT_CONFIGURED" ? 503 : error.code === "BUDGET" ? 402 : 502);
    return json({ error: "Something went wrong. Try again." }, 503);
  }
}
