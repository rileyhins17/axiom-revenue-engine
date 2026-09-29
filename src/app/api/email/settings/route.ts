import { NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase } from "@/lib/cloudflare";
import { updateEmailSetting } from "@/lib/revenue-engine/engine-email";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";
import { getM2OwnerIdentityActor } from "@/lib/revenue-engine/m2-owner-identity-actor";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const Command = z.object({ enabled: z.boolean(), approveTemplate: z.boolean() }).strict();

/** Riley or Aidan turns automatic first emails on or off. On requires approving the template. */
export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if ("response" in auth) return auth.response;
  if (!getM2OwnerIdentityActor(auth.session.user.email)) return json({ error: "Only Riley or Aidan can change email sending." }, 403);
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host) return json({ error: "Open this from the Axiom workspace." }, 403);
  const parsed = Command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request." }, 400);
  try {
    return json(await updateEmailSetting(getDatabase() as unknown as ProspectDb, parsed.data, auth.session.user.email ?? "owner"));
  } catch (error) {
    if (error instanceof Error && error.message === "TEMPLATE_NOT_APPROVED") return json({ error: "Approve the email first." }, 409);
    return json({ error: "Could not save. Try again." }, 503);
  }
}
