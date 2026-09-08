import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";

type SessionSnapshot = {
  session: { id: string; [key: string]: unknown };
  user: { id: string; role: string; [key: string]: unknown };
};

// Reproduce the compact cookie issued by the installed Better Auth 1.6.29
// before the lockdown. Only the isolated fixture's fake key is supplied here.
// A new login not issuing caches is insufficient proof about old signed caches.
function legacyCache(snapshot: SessionSnapshot, fixtureSecret: string) {
  const session = { ...snapshot, updatedAt: Date.now(), version: "1" };
  const expiresAt = Date.now() + 300_000;
  const signature = createHmac("sha256", fixtureSecret)
    .update(JSON.stringify({ ...session, expiresAt })).digest("base64url");
  return Buffer.from(JSON.stringify({ session, expiresAt, signature })).toString("base64url");
}

export async function verifyOwnerSessionRevocation(input: {
  context: BrowserContext;
  baseUrl: string;
  database: Database.Database;
  fixtureSecret: string;
  credentials: { email: string; password: string };
}) {
  const { context, baseUrl, database, fixtureSecret } = input;
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1", "Auth acceptance must remain loopback-only.");
  const current = await context.request.get(`${baseUrl}/api/auth/get-session?disableCookieCache=true`);
  assert.equal(current.status(), 200);
  const initial = await current.json() as SessionSnapshot;
  assert.equal(typeof initial?.user?.id, "string");
  assert.equal(initial.user.role, "user");

  // Only this disposable account is changed, then restored before the caller's
  // unchanged-user/credential post-check. No provider or new operator is used.
  database.prepare('UPDATE "User" SET role = ? WHERE id = ?').run("admin", initial.user.id);
  try {
    const promoted = await context.request.get(`${baseUrl}/api/auth/get-session?disableCookieCache=true`);
    const snapshot = await promoted.json() as SessionSnapshot;
    assert.equal(snapshot.user.role, "admin");
    const token = (await context.cookies(baseUrl)).find((cookie) => cookie.name.endsWith("session_token"));
    assert(token, "The legitimate login must have a signed session token.");
    const savedCookie = `${token.name}=${token.value}; better-auth.session_data=${legacyCache(snapshot, fixtureSecret)}`;
    const headers = { cookie: savedCookie, origin: baseUrl };

    // Legitimate controls, including the separate Better Auth admin surface.
    assert.equal((await context.request.get(`${baseUrl}/api/admin/users`, { headers })).status(), 200);
    assert.equal((await context.request.get(`${baseUrl}/api/auth/admin/list-users`, { headers })).status(), 200);
    database.prepare('UPDATE "User" SET role = ? WHERE id = ?').run("user", initial.user.id);
    assert.equal((await context.request.get(`${baseUrl}/api/admin/users`, { headers })).status(), 403,
      "A saved admin cookie must not survive a database role demotion.");
    assert.equal((await context.request.get(`${baseUrl}/api/auth/admin/list-users`, { headers })).status(), 403,
      "The Better Auth admin API must also use the current stored role.");
    assert.equal((await context.request.get(`${baseUrl}/api/v1/leads`, { headers })).status(), 200,
      "Demotion must preserve ordinary operator access.");

    const revoke = await context.request.post(`${baseUrl}/api/auth/revoke-sessions`, { headers, data: {} });
    assert.equal(revoke.status(), 200, "The existing revoke-all-sessions API must remain usable.");
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM "Session" WHERE userId = ?')
      .get(initial.user.id) as { count: number }).count, 0, "Revocation must remove stored sessions.");

    for (const suffix of ["", "?disableCookieCache=false"]) {
      assert.equal((await context.request.get(`${baseUrl}/api/v1/leads${suffix}`, { headers })).status(), 401,
        "A replayed cookie must not restore a revoked session.");
      const session = await context.request.get(`${baseUrl}/api/auth/get-session${suffix}`, { headers });
      assert.equal(session.status(), 200);
      assert.equal(await session.json(), null, "The auth endpoint must not revive revoked cached identity.");
    }
    assert.equal((await context.request.get(`${baseUrl}/api/auth/admin/list-users`, { headers })).status(), 401);
    // Next can stream a redirect in HTTP 200. Verify the rendered outcome,
    // not an assumed status code, while replaying both original cookie values.
    await context.clearCookies();
    await context.addCookies([
      { name: token.name, value: token.value, url: baseUrl },
      { name: "better-auth.session_data", value: legacyCache(snapshot, fixtureSecret), url: baseUrl },
    ]);
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/leads`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(`${baseUrl}/sign-in`);
      await page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
      assert.equal(await page.locator("[data-owner-content]").count(), 0,
        "A revoked session must not render protected owner content.");
    } finally {
      await page.close();
    }

    // Revoking sessions does not revoke the account. A new legitimate login
    // must work, but a server-expired session must not be extended by old cache.
    await context.clearCookies();
    const login = await context.request.post(`${baseUrl}/api/auth/sign-in/email`, {
      headers: { origin: baseUrl }, data: input.credentials,
    });
    assert.equal(login.status(), 200, "Revocation must preserve a fresh password login.");
    const fresh = await (await context.request.get(`${baseUrl}/api/auth/get-session`)).json() as SessionSnapshot;
    const freshToken = (await context.cookies(baseUrl)).find((cookie) => cookie.name.endsWith("session_token"));
    assert(freshToken);
    const expiredHeaders = {
      cookie: `${freshToken.name}=${freshToken.value}; better-auth.session_data=${legacyCache(fresh, fixtureSecret)}`,
    };
    database.prepare('UPDATE "Session" SET expiresAt = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), fresh.session.id);
    assert.equal((await context.request.get(`${baseUrl}/api/v1/leads`, { headers: expiredHeaders })).status(), 401,
      "A valid cache must not override the stored session expiry.");
    const expired = await context.request.get(`${baseUrl}/api/auth/get-session`, { headers: expiredHeaders });
    assert.equal(expired.status(), 200);
    assert.equal(await expired.json(), null);
  } finally {
    database.prepare('UPDATE "User" SET role = ? WHERE id = ?').run(initial.user.role, initial.user.id);
  }
}
