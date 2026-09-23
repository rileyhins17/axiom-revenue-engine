import { NextResponse } from "next/server";

import { getCloudflareBindings } from "@/lib/cloudflare";
import { readLatestEngineRun } from "@/lib/revenue-engine/engine-run-review";
import { ProspectDecisionCommandSchema, saveProspectDecision, websiteKey } from "@/lib/revenue-engine/engine-prospect-decisions";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireAdminApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 2_048;

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin || new URL(origin).host === request.headers.get("host"); }
  catch { return false; }
}

/** Records Riley's or Aidan's call on one engine prospect. Local workspace only. */
export async function POST(request: Request) {
  const auth = await requireAdminApiSession(request);
  if ("response" in auth) return auth.response;
  const actor = getM2OwnerIdentityActor(auth.session.user.email);
  if (!actor) return json({ error: "Only Riley or Aidan can decide on prospects." }, 403);
  if (getCloudflareBindings() !== null) return json({ error: "Prospect decisions are available only in the local workspace." }, 503);
  if (!sameOrigin(request)) return json({ error: "Open the prospect list from the same Axiom workspace." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "Send the decision as JSON." }, 415);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "The decision is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(text); } catch { return json({ error: "The decision must be valid JSON." }, 400); }
  const command = ProspectDecisionCommandSchema.safeParse(input);
  if (!command.success) return json({ error: "Choose Worth a call, or Not a fit with a reason." }, 400);
  const run = await readLatestEngineRun();
  if (run.status !== "READY" || !run.prospects.some((prospect) => websiteKey(prospect.websiteUrl) === websiteKey(command.data.websiteUrl))) {
    return json({ error: "This business is not on the current prospect list." }, 409);
  }
  try {
    const saved = await saveProspectDecision(command.data, actor);
    return json(saved, saved.status === "SAVED" ? 201 : 200);
  } catch {
    return json({ error: "The decision could not be saved. Reload and try again." }, 409);
  }
}
