import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/cloudflare";

export const dynamic = "force-dynamic";

/** Public liveness probe for the outside watchdog. Reports only ok / not ok. */
export async function GET() {
  try {
    await getDatabase().prepare("SELECT 1 AS n").first();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
