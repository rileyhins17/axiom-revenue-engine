import { NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/lib/cloudflare";
import { InvalidMailboxSettings, updateMailboxSettings } from "@/lib/mailbox-settings";
import { requireAdminApiSession } from "@/lib/session";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAdminApiSession(request);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const body: unknown = await request.json();
    const { id } = await params;
    const mailbox = await updateMailboxSettings(getDatabase(), {
      userId: authResult.session.user.id,
      sessionId: authResult.session.session.id,
    }, id, body);
    return NextResponse.json(mailbox ? { mailbox } : { error: "Mailbox unavailable" }, {
      status: mailbox ? 200 : 404, headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error: unknown) {
    const invalid = error instanceof InvalidMailboxSettings || error instanceof SyntaxError;
    return NextResponse.json(
      { error: invalid ? "Invalid mailbox settings" : "Mailbox settings unavailable" },
      { status: invalid ? 400 : 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
