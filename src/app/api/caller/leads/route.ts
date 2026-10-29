import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/cloudflare";
import { torontoMidnight, torontoToday } from "@/lib/prospect-format";
import { authenticateCaller, callerLeads } from "@/lib/revenue-engine/caller-integration";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store" };

/** Axiom Caller extension: the next callable businesses, in its lead format. Bearer caller token. */
export async function GET(request: Request) {
  const db = getDatabase() as unknown as ProspectDb;
  const caller = await authenticateCaller(db, request.headers.get("authorization"));
  if (!caller) return NextResponse.json({ error: "Connect the extension with a caller token from Settings." }, { status: 401, headers: HEADERS });
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25) || 25;
  const leads = await callerLeads(db, torontoToday(), torontoMidnight(), limit);
  return NextResponse.json({ caller: caller.actor, leads }, { headers: HEADERS });
}
