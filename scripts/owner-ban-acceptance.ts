import assert from "node:assert/strict";

import type Database from "better-sqlite3";
import type { BrowserContext } from "playwright";
import { postOwnerSignIn } from "./owner-auth-request";

export async function verifyOwnerBanLifecycle(input: {
  context: BrowserContext;
  baseUrl: string;
  database: Database.Database;
  owner: { email: string; password: string };
  administrator: { email: string; password: string };
}) {
  const { context, baseUrl, database } = input;
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1");
  const login = async (credentials: { email: string; password: string }) => {
    await context.clearCookies();
    const response = await postOwnerSignIn(context.request, baseUrl, {
      data: credentials, headers: { origin: baseUrl },
    });
    assert.equal(response.status(), 200, "The synthetic account must be able to sign in.");
    const cookies = await context.cookies(baseUrl);
    const cookie = cookies.map((item) => `${item.name}=${item.value}`).join("; ");
    const session = await (await context.request.get(`${baseUrl}/api/auth/get-session`)).json();
    return { headers: { cookie, origin: baseUrl }, cookies, userId: String(session.user.id) };
  };
  const owner = await login(input.owner);
  const administrator = await login(input.administrator);
  const action = (value: string, userId = owner.userId) => context.request.patch(`${baseUrl}/api/admin/users`, {
    data: { userId, action: value }, headers: administrator.headers,
  });
  const sessions = () => (database.prepare('SELECT COUNT(*) AS count FROM "Session" WHERE userId = ?')
    .get(owner.userId) as { count: number }).count;
  // Even an authenticated administrator cannot use the unfenced plugin
  // mutation shortcuts. Read-only plugin inspection remains available.
  for (const path of ["ban-user", "unban-user", "update-user", "set-role", "create-user", "remove-user",
    "set-user-password", "impersonate-user", "stop-impersonating", "revoke-user-session", "revoke-user-sessions"]) {
    const response = await context.request.post(`${baseUrl}/api/auth/admin/${path}`, {
      headers: administrator.headers,
      data: { userId: owner.userId, role: "admin", data: { banned: false }, email: "denied@example.invalid",
        name: "Denied", password: "synthetic-denied-password-123", newPassword: "synthetic-denied-password-123", sessionToken: "synthetic" },
    });
    assert.equal(response.status(), 403, `The unfenced ${path} shortcut must be disabled.`);
  }
  assert.equal((await context.request.get(`${baseUrl}/api/auth/admin/list-users`, { headers: administrator.headers })).status(), 200);

  // A paired-release instruction alone is not a runtime gate. Simulate the
  // schema missing in this disposable database and restore the exact trigger.
  const guard = database.prepare("SELECT sql FROM sqlite_master WHERE name = 'operator_ban_revoke_sessions'").get() as { sql: string };
  database.exec("DROP TRIGGER operator_ban_revoke_sessions");
  try {
    assert.equal((await context.request.get(`${baseUrl}/api/auth/get-session`, { headers: owner.headers })).status(), 503);
    const denied = await context.request.get(`${baseUrl}/api/v1/leads`, { headers: owner.headers });
    assert.notEqual(denied.status(), 200, "Missing guards must not authorize owner reads.");
    assert.notEqual((await action("ban")).status(), 200, "Missing guards must not claim a successful ban.");
    assert.equal((database.prepare('SELECT banned FROM "User" WHERE id = ?').get(owner.userId) as { banned: number }).banned, 0);
  } finally { database.exec(guard.sql); }
  const assertOldCookieRejected = async () => {
    assert.equal((await context.request.get(`${baseUrl}/api/v1/leads`, { headers: owner.headers })).status(), 401,
      "The banned account's previous cookie must no longer authorize reads.");
    const session = await context.request.get(`${baseUrl}/api/auth/get-session`, { headers: owner.headers });
    assert.equal(await session.json(), null, "Auth must not restore a banned account's old session.");
    const mutation = await context.request.patch(`${baseUrl}/api/user/profile`, {
      headers: owner.headers, data: { name: "Rejected mutation" },
    });
    assert.equal(mutation.status(), 401, "A banned session must not authorize mutations.");
    await context.clearCookies();
    await context.addCookies(owner.cookies);
    const page = await context.newPage();
    try {
      const response = await page.goto(`${baseUrl}/leads`, { waitUntil: "domcontentloaded" });
      assert(response && response.status() < 500, "The ban page check must not pass on a server error.");
      await page.waitForURL(`${baseUrl}/sign-in`);
      await page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
      assert.equal(await page.locator("[data-owner-content]").count(), 0,
        "A saved banned-session cookie must not render protected owner content.");
    } finally { await page.close(); }
  };

  // A prior expired temporary ban must not undo the permanent ban from the UI.
  database.prepare('UPDATE "User" SET banExpires = ? WHERE id = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), owner.userId);
  assert.equal((await action("ban", administrator.userId)).status(), 400, "Self-ban remains prohibited.");
  assert(sessions() > 0);
  assert.equal((await action("ban")).status(), 200);
  assert.equal(sessions(), 0, "Ban must revoke all existing sessions in the same database change.");
  await assertOldCookieRejected();
  await context.clearCookies();
  const deniedLogin = await postOwnerSignIn(context.request, baseUrl, {
    data: input.owner, headers: { origin: baseUrl },
  });
  assert.equal(deniedLogin.status(), 403, "A permanent ban must not inherit an old expired ban deadline.");
  assert.equal(sessions(), 0);
  assert.equal((await action("ban")).status(), 200, "Repeating a ban is safe.");
  assert.equal((await action("unban")).status(), 200);
  await assertOldCookieRejected();
  assert.equal(sessions(), 0, "Unban must not resurrect old sessions.");
  const restored = await login(input.owner);
  assert.equal((await context.request.get(`${baseUrl}/api/v1/leads`, { headers: restored.headers })).status(), 200,
    "An explicitly unbanned operator can start a new session.");
  assert.equal((database.prepare('SELECT name FROM "User" WHERE id = ?').get(owner.userId) as { name: string }).name,
    "Owner Acceptance", "A rejected profile mutation must leave the owner unchanged.");
}
