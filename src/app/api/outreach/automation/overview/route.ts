import { NextResponse } from "next/server";

import { ownerSummaryHeaders } from "@/lib/revenue-engine/owner-summary-scope";
import { listAutomationOverview } from "@/lib/outreach-automation";
import { requireAdminApiSession } from "@/lib/session";

export async function GET(request: Request) {
  const authResult = await requireAdminApiSession(request);
  if ("response" in authResult) {
    for (const [name, value] of Object.entries(ownerSummaryHeaders)) authResult.response.headers.set(name, value);
    return authResult.response;
  }

  try {
    const overview = await listAutomationOverview({ userId: authResult.session.user.id, sessionId: authResult.session.session.id });
    return NextResponse.json(overview, { headers: ownerSummaryHeaders });
  } catch {
    return NextResponse.json(
      { error: "Automation summary unavailable. No settings were changed." },
      { status: 503, headers: ownerSummaryHeaders },
    );
  }
}
