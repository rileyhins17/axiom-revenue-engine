import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";
import { postOwnerSignIn } from "./owner-auth-request";

// The caller supplies only the disposable owner acceptance DB and loopback app.
export async function verifyOwnerAdmission(input: {
  context: BrowserContext; baseUrl: string; database: Database.Database;
  credentials: { email: string; password: string };
}) {
  const { context, baseUrl, database, credentials } = input;
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1");
  const current = await (await context.request.get(`${baseUrl}/api/auth/get-session`)).json();
  assert.equal(current.user.email, credentials.email);
  const cookies = await context.cookies(baseUrl);
  const headers = { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "), origin: baseUrl };
  const sessionCount = () => (database.prepare('SELECT COUNT(*) n FROM "Session" WHERE userId = ?')
    .get(current.user.id) as { n: number }).n;
  const removedEmail = "removed-owner@example.invalid";
  database.prepare('UPDATE "User" SET email = ? WHERE id = ?').run(removedEmail, current.user.id);
  try {
    assert.equal((await context.request.get(`${baseUrl}/api/v1/leads`, { headers })).status(), 401,
      "A stored account outside the approved owner list must not authorize an existing login.");
    assert.equal(sessionCount(), 0, "Rejected owner identity must revoke existing sessions.");
    assert.equal(await (await context.request.get(`${baseUrl}/api/auth/get-session`, { headers })).json(), null,
      "The raw auth endpoint must reject the same saved identity.");
    assert.equal((await postOwnerSignIn(context.request, baseUrl, {
      headers: { origin: baseUrl }, data: { ...credentials, email: removedEmail },
    })).status(), 403, "An unapproved account cannot obtain a fresh session.");
  } finally {
    database.prepare('UPDATE "User" SET email = ? WHERE id = ?').run(credentials.email, current.user.id);
  }
  assert.equal((await context.request.get(`${baseUrl}/api/v1/leads`, { headers })).status(), 401,
    "Restoring the approved address cannot restore a revoked old session.");
  await context.clearCookies();
  assert.equal((await postOwnerSignIn(context.request, baseUrl, {
    headers: { origin: baseUrl }, data: credentials,
  })).status(), 200, "The approved verified owner can sign in again.");
  database.prepare('UPDATE "User" SET emailVerified = 0 WHERE id = ?').run(current.user.id);
  try {
    assert.equal((await context.request.get(`${baseUrl}/api/v1/leads`)).status(), 401,
      "A stored but unverified owner must not retain console access.");
    assert.equal((await postOwnerSignIn(context.request, baseUrl, {
      headers: { origin: baseUrl }, data: credentials,
    })).status(), 403, "Correct credentials are not proof of mailbox ownership.");
  } finally {
    database.prepare('UPDATE "User" SET emailVerified = 1 WHERE id = ?').run(current.user.id);
  }
  await context.clearCookies();
  assert.equal((await postOwnerSignIn(context.request, baseUrl, {
    headers: { origin: baseUrl }, data: credentials,
  })).status(), 200, "A verified, approved owner can still obtain a fresh login.");
}
