import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";
import { setCloudflareBindings, type D1DatabaseLike, type D1PreparedStatementLike } from "../src/lib/cloudflare";
import { issueGmailOAuthTransaction } from "../src/lib/gmail-oauth-transaction";
import { postOwnerSignIn } from "./owner-auth-request";

export async function verifyOwnerOAuth(input: {
  context: BrowserContext; baseUrl: string; database: Database.Database; secret: string;
  ownerEmail: string; adminEmail: string; password: string;
}) {
  const { context, baseUrl, database, secret } = input;
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1");
  const callback = `${baseUrl}/api/outreach/gmail/callback`;
  assert.equal((await context.request.get(`${callback}?state=legacy`, { maxRedirects: 0, timeout: 10_000 })).status(), 403);
  const signIn = async (email: string) => {
    await context.clearCookies();
    assert.equal((await postOwnerSignIn(context.request, baseUrl, {
      headers: { origin: baseUrl }, data: { email, password: input.password },
      timeout: 10_000,
    })).status(), 200);
  };
  await signIn(input.adminEmail);
  const sessionResponse = await context.request.get(`${baseUrl}/api/auth/get-session`, { timeout: 10_000 });
  const session = await sessionResponse.json() as { user: { id: string }; session: { id: string } };
  const db: D1DatabaseLike = { prepare(sql) {
    let values: unknown[] = [];
    const statement: D1PreparedStatementLike = {
      bind(...bound) { values = bound; return statement; },
      async first<T>() { return (database.prepare(sql).get(...values) ?? null) as T | null; },
      async all<T>() { return { results: database.prepare(sql).all(...values) as T[] }; },
      async run() { return { meta: database.prepare(sql).run(...values) }; },
    }; return statement;
  } };
  const issue = () => issueGmailOAuthTransaction(db, secret, {
    userId: session.user.id, sessionId: session.session.id, redirectUri: callback, targetEmail: "synthetic@example.invalid",
  });
  const request = async (query: string, expected: string) => {
    const response = await context.request.get(`${callback}?${query}`, { maxRedirects: 0, timeout: 10_000 });
    assert.equal(response.status(), 307);
    assert.equal(response.headers()["location"], `${baseUrl}/settings?gmail_error=${expected}`);
    assert.equal(response.headers()["cache-control"], "private, no-store");
  };
  try {
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: `${input.ownerEmail},${input.adminEmail}`, AUTH_ADMIN_EMAILS: input.adminEmail });
    const state = await issue();
    await request(`state=${state}&error=synthetic-private-provider-detail`, "authorization_declined");
    await request(`state=${state}`, "invalid_state");
    const fresh = await issue();
    assert.equal((await context.request.head(`${callback}?state=${fresh}`, { maxRedirects: 0, timeout: 10_000 })).status(), 405);
    await request(`state=${fresh}&state=${fresh}`, "invalid_state");
    await request(`state=${fresh}`, "missing_code");
    await request(`state=${fresh}`, "invalid_state");
    await request(`state=${encodeURIComponent(session.session.id)}`, "invalid_state");
    const connectUrl = `${baseUrl}/api/outreach/gmail/connect?email=synthetic@example.invalid`;
    console.log("OAuth fixture: callback checks passed; checking initiation requests.");
    assert.equal((await context.request.head(connectUrl, { maxRedirects: 0, timeout: 10_000, headers: { "sec-fetch-site": "same-origin" } })).status(), 405);
    const deniedHeaders: Record<string, string>[] = [{}, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "none" }, { "sec-fetch-site": "same-origin", origin: "https://foreign.example.invalid" }];
    for (const headers of deniedHeaders) {
      assert.equal((await context.request.get(connectUrl, { maxRedirects: 0, timeout: 10_000, headers })).status(), 403);
    }
    const unavailable = await context.request.get(connectUrl, { maxRedirects: 0, timeout: 10_000,
      headers: { "sec-fetch-site": "same-origin" } });
    assert.equal(unavailable.status(), 503, "The fixture has no provider credentials and must not redirect to Google.");
    assert.deepEqual(await unavailable.json(), { error: "gmail_connection_unavailable" });
    console.log("OAuth fixture: initiation requests passed; checking browser navigation.");
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(10_000);
    const pageDeadline = setTimeout(() => { void page.close(); }, 30_000);
    try {
      assert.equal((await page.goto(connectUrl, { waitUntil: "commit" }))?.status(), 403, "A direct navigation must not create a transaction.");
      await page.goto(`${baseUrl}/settings`, { waitUntil: "domcontentloaded" });
      const link = page.getByRole("link", { name: /^Connect .* via Google OAuth$/ }).first();
      const href = await link.getAttribute("href");
      assert(href);
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === "/api/outreach/gmail/connect", { timeout: 10_000 }),
        link.click({ noWaitAfter: true }),
      ]);
      assert.equal(new URL(response.url()).searchParams.get("email"), new URL(href, baseUrl).searchParams.get("email"));
      assert.equal(response.status(), 503, "An actual in-console navigation reaches the disconnected-provider gate.");
      await page.waitForURL(url => url.pathname === "/api/outreach/gmail/connect", { waitUntil: "domcontentloaded", timeout: 10_000 });
      console.log("OAuth fixture: Settings link passed.");
    } finally {
      clearTimeout(pageDeadline);
      // Closing directly after the intercepted JSON navigation can leave
      // Chromium's close acknowledgement pending. Settle/clear this test page.
      try { await page.goto("about:blank", { waitUntil: "commit", timeout: 10_000 }); }
      finally { await page.close(); }
    }
  } finally { setCloudflareBindings(null); await signIn(input.ownerEmail); }
}
