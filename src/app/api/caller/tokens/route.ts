import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/lib/cloudflare";
import { createCallerToken, listCallerTokens, revokeCallerToken } from "@/lib/revenue-engine/caller-integration";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), label: z.string().max(80) }).strict(),
  z.object({ action: z.literal("revoke"), id: z.string().regex(/^[0-9a-f]{8}$/) }).strict(),
]);

async function owner(request: Request) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return { response: auth.response };
  const actor = getM2OwnerIdentityActor(auth.session.user.email);
  if (!actor) return { response: json({ error: "Only Riley or Aidan." }, 403) };
  return { actor, userId: String(auth.session.user.id) };
}

/** The signed-in owner's caller tokens (hash prefix only). */
export async function GET(request: Request) {
  const who = await owner(request);
  if ("response" in who) return who.response;
  return json({ tokens: await listCallerTokens(getDatabase() as unknown as ProspectDb, who.actor) });
}

/** Create (token shown once) or revoke a caller token. */
export async function POST(request: Request) {
  const who = await owner(request);
  if ("response" in who) return who.response;
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) return json({ error: "Open this from the Axiom workspace." }, 403);
  const parsed = Command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request." }, 400);
  const db = getDatabase() as unknown as ProspectDb;
  if (parsed.data.action === "create") {
    return json({ token: await createCallerToken(db, { actor: who.actor, actorUserId: who.userId }, parsed.data.label) }, 201);
  }
  await revokeCallerToken(db, who.actor, parsed.data.id);
  return json({ revoked: true });
}
