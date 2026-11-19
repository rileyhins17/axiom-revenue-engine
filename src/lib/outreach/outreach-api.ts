/** Shared checks for the Campaigns screen's actions: a signed-in founder, from this site, with a valid body. */
import { NextResponse } from "next/server";
import type { z } from "zod";

import { getDatabase } from "@/lib/cloudflare";
import { ownerForAccount } from "@/lib/owner-login";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { requireApiSession } from "@/lib/session";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

export type FounderRequest<T> = { owner: { name: string; account: string; inbox: string }; body: T; db: ProspectDb };

/** The founder and the parsed body, or the response to send back. */
export async function founderRequest<T>(request: Request, schema: z.ZodType<T>, what: string): Promise<FounderRequest<T> | { response: NextResponse }> {
  const auth = await requireApiSession(request);
  if ("response" in auth) return { response: auth.response };
  const owner = ownerForAccount(auth.session.user.email ?? "");
  if (!owner) return { response: json({ error: `Only Riley or Aidan can ${what}.` }, 403) };
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) return { response: json({ error: "Open this from the Axiom workspace." }, 403) };
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return { response: json({ error: "Invalid request." }, 400) };
  return { owner: { name: owner.name, account: owner.account, inbox: owner.inbox }, body: parsed.data, db: getDatabase() as unknown as ProspectDb };
}
