import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/lib/cloudflare";
import { pauseFcc, resumeFcc } from "@/lib/fcc-campaign-control";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const Command = z.object({ action: z.enum(["pause", "resume"]) }).strict();

/** Riley or Aidan pauses or resumes FCC emails. Touches only the FCC switch, never the old outreach stops. */
export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return auth.response;
  const actor = auth.session.user.email ?? "";
  if (!getM2OwnerIdentityActor(actor)) return json({ error: "Only Riley or Aidan can pause or resume FCC emails." }, 403);
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) return json({ error: "Open this from the Axiom workspace." }, 403);
  const parsed = Command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request." }, 400);
  const db = getDatabase() as unknown as ProspectDb;
  try {
    if (parsed.data.action === "pause") {
      await pauseFcc(db, "Paused from the FCC screen", actor);
      return json({ state: "paused" });
    }
    const result = await resumeFcc(db, actor);
    if (result === "LOCKED") return json({ error: "Locked: a founder has to give the go on this email first." }, 409);
    return json({ state: "live" });
  } catch {
    return json({ error: "Could not save. Try again." }, 503);
  }
}
