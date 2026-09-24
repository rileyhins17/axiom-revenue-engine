import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/cloudflare";
import { ProspectActivityError, recordProspectActivity, type ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const MAX_BODY_BYTES = 4096;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host || new URL(origin).host === request.headers.get("host"); } catch { return false; }
}

/** Riley or Aidan logs one call, visit or note on an engine prospect. Append-only. */
export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return auth.response;
  const actor = getM2OwnerIdentityActor(auth.session.user.email);
  if (!actor) return json({ error: "Only Riley or Aidan can log calls." }, 403);
  if (!sameOrigin(request)) return json({ error: "Open the call list from the Axiom workspace." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "Send JSON." }, 415);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "Too long." }, 413);
  let input: unknown;
  try { input = JSON.parse(text); } catch { return json({ error: "Invalid request." }, 400); }
  try {
    const saved = await recordProspectActivity(getDatabase() as unknown as ProspectDb, input, actor, auth.session.user.id);
    return json(saved, saved.status === "SAVED" ? 201 : 200);
  } catch (error) {
    if (error instanceof ProspectActivityError) {
      const message = { NOT_FOUND: "That business is no longer on the list.", STOPPED: "This business asked not to be contacted.", CONFLICT: "This was already saved differently. Reload." }[error.code];
      return json({ error: message }, error.code === "NOT_FOUND" ? 404 : 409);
    }
    if (error instanceof Error && error.name === "ZodError") return json({ error: "Check the outcome and follow-up date." }, 400);
    return json({ error: "Could not save. Try again." }, 503);
  }
}
