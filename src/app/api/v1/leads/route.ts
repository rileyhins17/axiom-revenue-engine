import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/cloudflare";
import {
  OWNER_LEAD_DEFAULT_LIMIT,
  OWNER_LEAD_MAX_LIMIT,
  readOwnerLeadList,
} from "@/lib/revenue-engine/owner-lead-read-model";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

function parseLimit(value: string | null) {
  if (value === null) return OWNER_LEAD_DEFAULT_LIMIT;
  if (!/^\d{1,3}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= OWNER_LEAD_MAX_LIMIT ? parsed : null;
}

export async function GET(request: Request) {
  const authResult = await requireApiSession(request);
  if ("response" in authResult) return authResult.response;

  const limit = parseLimit(new URL(request.url).searchParams.get("limit"));
  if (limit === null) {
    return NextResponse.json(
      { code: "INVALID_LIMIT", error: "Lead limit must be a whole number from 1 to 100." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  try {
    const result = await readOwnerLeadList(getDatabase(), new Date().toISOString(), limit);
    return NextResponse.json(result, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { code: "OWNER_LEAD_READ_FAILED", error: "The current lead view could not be verified." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}

