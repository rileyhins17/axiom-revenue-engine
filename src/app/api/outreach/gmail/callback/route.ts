import { NextRequest, NextResponse } from "next/server";

import {
  ensureMailboxForConnection,
} from "@/lib/outreach-automation";
import {
  encryptToken,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  normalizeGmailAddress,
  getOAuthRedirectUri,
} from "@/lib/gmail";
import { consumeGmailOAuthTransaction } from "@/lib/gmail-oauth-transaction";
import { getDatabase } from "@/lib/cloudflare";
import { getServerEnv } from "@/lib/env";
import { getPrisma } from "@/lib/prisma";
import { requireAdminApiSession } from "@/lib/session";

async function handleCallback(request: NextRequest) {
  try {
    const auth = await requireAdminApiSession(request);
    if ("response" in auth) return auth.response;
    const session = auth.session;
    const env = getServerEnv();
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const callback = new URL(getOAuthRedirectUri());
    if ((request.headers.get("host") ?? url.host) !== callback.host || url.protocol !== callback.protocol || url.pathname !== callback.pathname
      || url.searchParams.getAll("state").length !== 1 || url.searchParams.getAll("code").length > 1
      || url.searchParams.getAll("error").length > 1) {
      return NextResponse.redirect(`${env.APP_BASE_URL.replace(/\/$/, "")}/settings?gmail_error=invalid_state`);
    }
    const parsedState = await consumeGmailOAuthTransaction(getDatabase(), env.BETTER_AUTH_SECRET, state, {
      userId: session.user.id, sessionId: session.session.id, redirectUri: getOAuthRedirectUri(),
    });

    const baseUrl = env.APP_BASE_URL.replace(/\/$/, "");

    if (!parsedState) {
      return NextResponse.redirect(
        `${baseUrl}/settings?gmail_error=invalid_state`,
      );
    }

    if (error) {
      return NextResponse.redirect(
        `${baseUrl}/settings?gmail_error=authorization_declined`,
      );
    }

    if (!code) {
      return NextResponse.redirect(
        `${baseUrl}/settings?gmail_error=missing_code`,
      );
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        `${baseUrl}/settings?gmail_error=no_refresh_token`,
      );
    }

    // Get user's Gmail address
    const userInfo = await fetchGoogleUserInfo(tokens.access_token);
    const gmailAddress = normalizeGmailAddress(userInfo.email);

    if (!gmailAddress) {
      return NextResponse.redirect(
        `${baseUrl}/settings?gmail_error=no_email`,
      );
    }

    if (gmailAddress !== parsedState.targetEmail) {
      return NextResponse.redirect(
        `${baseUrl}/settings?gmail_error=wrong_account`,
      );
    }

    // Provider round trips are not authority to retain an obsolete session.
    const current = await requireAdminApiSession(request);
    if ("response" in current) return current.response;
    if (current.session.user.id !== session.user.id || current.session.session.id !== session.session.id) {
      return NextResponse.redirect(`${baseUrl}/settings?gmail_error=invalid_state`);
    }
    // Encrypt tokens before storage
    const encryptedAccess = await encryptToken(tokens.access_token);
    const encryptedRefresh = await encryptToken(tokens.refresh_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const prisma = getPrisma();

    const existing = await prisma.gmailConnection.findFirst({
      where: {
        userId: session.user.id,
        gmailAddress,
      },
    });

    const connectionId = existing?.id || crypto.randomUUID();
    if (existing) {
      await prisma.gmailConnection.update({
        where: { id: existing.id },
        data: {
          gmailAddress,
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiresAt: expiresAt,
          scopes: tokens.scope,
        },
      });
    } else {
      await prisma.gmailConnection.create({
        data: {
          id: connectionId,
          userId: session.user.id,
          gmailAddress,
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          tokenExpiresAt: expiresAt,
          scopes: tokens.scope,
          updatedAt: new Date(),
        },
      });
    }

    const connection = await prisma.gmailConnection.findUnique({
      where: { id: connectionId },
    });

    if (connection) {
      await ensureMailboxForConnection(connection, {
        label: userInfo.name || gmailAddress.split("@")[0],
        status: "ACTIVE",
        forceStatus: true,
      });
    }

    return NextResponse.redirect(`${baseUrl}/settings?gmail_connected=true`);
  } catch {
    return NextResponse.json({ error: "gmail_callback_failed" }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
}

export async function GET(request: NextRequest) {
  if (request.method !== "GET") return NextResponse.json({ error: "Method not allowed" }, {
    status: 405, headers: { Allow: "GET", "Cache-Control": "private, no-store" },
  });
  const response = await handleCallback(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
