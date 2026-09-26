import { NextResponse } from "next/server";

import { getCloudflareBindings, getDatabase } from "@/lib/cloudflare";
import { OWNER_REQUESTS_PER_RUN, runDiscovery } from "@/lib/revenue-engine/cloud-discovery";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

/** "Find new leads now": one small server-side Google Places batch, owner only. */
export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return auth.response;
  const actor = getM2OwnerIdentityActor(auth.session.user.email);
  if (!actor) return json({ error: "Only Riley or Aidan can do this." }, 403);
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) return json({ error: "Open this from the Axiom workspace." }, 403);
  const env = (getCloudflareBindings() ?? {}) as Record<string, unknown>;
  const apiKey = typeof env.ENGINE_PLACES_KEY === "string" ? env.ENGINE_PLACES_KEY.trim() || undefined : undefined;
  const result = await runDiscovery(getDatabase() as unknown as ProspectDb, { apiKey, trigger: "OWNER", actor, maxRequests: OWNER_REQUESTS_PER_RUN });
  return json(result, result.stopReason && result.requests === 0 ? 503 : 200);
}
