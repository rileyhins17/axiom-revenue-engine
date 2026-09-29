import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/cloudflare";
import { authenticateCaller, recordCallerResult } from "@/lib/revenue-engine/caller-integration";
import { ProspectActivityError, type ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

/** Axiom Caller extension: one saved call, recorded in the shared call log. Idempotent. */
export async function POST(request: Request) {
  const db = getDatabase() as unknown as ProspectDb;
  const caller = await authenticateCaller(db, request.headers.get("authorization"));
  if (!caller) return json({ error: "Connect the extension with a caller token from Settings." }, 401);
  const text = await request.text();
  if (text.length > 16_000) return json({ error: "Too long." }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON." }, 400); }
  try {
    const saved = await recordCallerResult(db, body, caller);
    return json(saved, saved.status === "SAVED" ? 201 : 200);
  } catch (error) {
    if (error instanceof ProspectActivityError) return json({ error: error.code }, error.code === "NOT_FOUND" ? 404 : 409);
    if (error instanceof Error && error.name === "ZodError") return json({ error: "Invalid call result." }, 400);
    return json({ error: "Could not save." }, 503);
  }
}
