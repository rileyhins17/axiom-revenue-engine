import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/cloudflare";
import {
  readOwnerLeadDetail,
} from "@/lib/revenue-engine/owner-lead-detail-read-model";
import { parseOwnerLeadBusinessIdRouteParam } from "@/lib/revenue-engine/owner-lead-identity";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const authResult = await requireApiSession(request);
  if ("response" in authResult) return authResult.response;

  const routeParams = await params;
  const identity = parseOwnerLeadBusinessIdRouteParam(routeParams.businessId);
  if (!identity) {
    return NextResponse.json(
      { code: "INVALID_BUSINESS_ID", error: "The lead identity is invalid." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  try {
    const result = await readOwnerLeadDetail(getDatabase(), identity, new Date().toISOString());
    if (!result) {
      return NextResponse.json(
        { code: "OWNER_LEAD_NOT_FOUND", error: "No current v2 lead dossier was found." },
        { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(result, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { code: "OWNER_LEAD_DETAIL_READ_FAILED", error: "The current lead dossier could not be verified." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
