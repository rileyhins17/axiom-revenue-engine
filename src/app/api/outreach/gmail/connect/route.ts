import { NextResponse } from "next/server";

import { buildOAuthUrl, getOAuthRedirectUri, normalizeGmailAddress } from "@/lib/gmail";
import { issueGmailOAuthTransaction } from "@/lib/gmail-oauth-transaction";
import { getDatabase } from "@/lib/cloudflare";
import { getServerEnv } from "@/lib/env";
import { cookieMutationOriginStatus } from "@/lib/cookie-mutation-origin";
import { requireAdminApiSession } from "@/lib/session";

export async function GET(request: Request) {
  if (request.method !== "GET") return NextResponse.json({ error: "Method not allowed" }, {
    status: 405, headers: { Allow: "GET", "Cache-Control": "private, no-store" },
  });
  const authResult = await requireAdminApiSession(request);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    // This GET now creates server state. Only an in-console navigation may
    // initiate it; SameSite=Lax alone permits foreign top-level navigations.
    if (request.headers.get("sec-fetch-site") !== "same-origin") {
      return NextResponse.json({ error: "Start the connection from console Settings" }, {
        status: 403, headers: { "Cache-Control": "private, no-store" },
      });
    }
    const initiationHeaders = new Headers(request.headers);
    // Normal same-origin anchor navigations omit Origin. Fetch Metadata must
    // already prove same-origin before supplying the configured origin below.
    if (!initiationHeaders.has("origin")) initiationHeaders.set("origin", new URL(getOAuthRedirectUri()).origin);
    const denied = cookieMutationOriginStatus(new Request(request.url, { method: "POST", headers: initiationHeaders }));
    if (denied) return NextResponse.json({ error: "Connection request denied" }, {
      status: denied, headers: { "Cache-Control": "private, no-store" },
    });
    const requestUrl = new URL(request.url);
    const targetEmail = normalizeGmailAddress(requestUrl.searchParams.get("email"));
    // Check provider configuration before creating a transaction. No provider call.
    buildOAuthUrl("configuration-check");
    const state = await issueGmailOAuthTransaction(getDatabase(), getServerEnv().BETTER_AUTH_SECRET, {
      userId: authResult.session.user.id,
      sessionId: authResult.session.session.id,
      redirectUri: getOAuthRedirectUri(),
      targetEmail,
    });
    const url = buildOAuthUrl(state, { loginHint: targetEmail });

    return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "gmail_connection_unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
