import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hashPassword } from "better-auth/crypto";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import { getAuth } from "../src/lib/auth";
import { setCloudflareBindings } from "../src/lib/cloudflare";
import { getApiSession } from "../src/lib/session";
import { GET, POST } from "../src/app/api/auth/[...all]/route";

test("real cached auth instance enforces current owner admission, verification and admin ceiling", async () => {
  const runtime = new Miniflare(convertV4MiniflareOptions({ cf: false, workers: [{
    name: "owner-admission-fixture", modules: true,
    script: "export default { fetch() { return new Response('synthetic'); } }",
    compatibilityDate: "2026-08-01", d1Databases: ["DB"],
    outboundService: async () => { throw new Error("Owner auth tests cannot contact external services."); },
  }] }));
  try {
    const db = await runtime.getD1Database("DB");
    const schema = readFileSync("migrations/0001_cloudflare_auth_security.sql", "utf8");
    await db.batch(schema.split(";").filter((sql) => sql.trim()).map((sql) => db.prepare(sql)));
    await db.batch(readFileSync("migrations/0071_operator_ban_session_guards.sql", "utf8")
      .split("-- statement-breakpoint").map((sql) => db.prepare(sql)));
    const baseURL = "http://127.0.0.1:3000";
    const email = "owner@example.invalid";
    const backup = "backup@example.invalid";
    const password = "synthetic-owner-test-password";
    const bindings = {
      DB: db, APP_BASE_URL: baseURL, AUTH_ALLOWED_ORIGINS: baseURL,
      AUTH_ALLOWED_EMAILS: `${email},${backup}`, AUTH_ADMIN_EMAILS: `${email},${backup}`,
      BETTER_AUTH_SECRET: "synthetic-owner-admission-not-a-real-secret-12345", RATE_LIMIT_MAX_AUTH: 100,
    };
    setCloudflareBindings(bindings);
    await db.prepare(`INSERT INTO User (id,name,email,emailVerified,role,updatedAt)
      VALUES ('owner','Synthetic',?,1,'admin',CURRENT_TIMESTAMP)`).bind(email).run();
    await db.prepare(`INSERT INTO Account (id,accountId,providerId,userId,password,updatedAt)
      VALUES ('credential','owner','credential','owner',?,CURRENT_TIMESTAMP)`).bind(await hashPassword(password)).run();
    const auth = getAuth();
    const context = await auth.$context;
    const request = (path: string, cookie = "", body?: unknown): Promise<Response> => (body === undefined ? GET : POST)(new Request(`${baseURL}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin: baseURL, cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const login = async () => {
      const response = await request("/sign-in/email", "", { email, password });
      assert.equal(response.status, 200);
      return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    };
    const oldCookie = await login();
    assert.equal(((await (await request("/get-session", oldCookie)).json()) as { user: { role: string } }).user.role, "admin");
    bindings.AUTH_ALLOWED_EMAILS = backup;
    bindings.AUTH_ADMIN_EMAILS = backup;
    assert.equal(getAuth(), auth, "Exercise the same cached singleton, without resetting either cache.");
    assert.equal(await (await request("/get-session?disableCookieCache=false", oldCookie)).json(), null);
    assert.equal(await getApiSession(new Request(`${baseURL}/api/v1/leads`, { headers: { cookie: oldCookie } })), null);
    assert.equal((await request("/sign-in/email", "", { email, password })).status, 403);
    await assert.rejects(context.internalAdapter.createSession("owner"), { status: "FORBIDDEN" });
    assert.deepEqual(await db.prepare("SELECT COUNT(*) n FROM Session").first(), { n: 0 });
    bindings.AUTH_ALLOWED_EMAILS = `${email},${backup}`;
    bindings.AUTH_ADMIN_EMAILS = `${email},${backup}`;
    assert.equal(await (await request("/get-session", oldCookie)).json(), null);
    const freshCookie = await login();
    assert.equal(((await (await request("/get-session", freshCookie)).json()) as { user: { role: string } }).user.role, "user",
      "Re-adding configuration must not silently restore an old administrator grant.");
    await db.prepare("UPDATE User SET role = 'admin,user' WHERE id = 'owner'").run();
    assert.equal((await request("/admin/list-users", freshCookie)).status, 200,
      "A verified configured multi-role admin retains the library's existing inspection permission.");
    assert.deepEqual(await db.prepare("SELECT role FROM User WHERE id = 'owner'").first(), { role: "admin,user" });
    await db.prepare("UPDATE User SET role = 'admin' WHERE id = 'owner'").run();
    bindings.AUTH_ADMIN_EMAILS = backup;
    assert.equal((await request("/admin/list-users", freshCookie)).status, 403);
    const ordinary = await getApiSession(new Request(`${baseURL}/api/v1/leads`, { headers: { cookie: freshCookie } }));
    assert.equal(ordinary?.user.role, "user", "An admin demotion preserves approved ordinary access.");
    await db.prepare("UPDATE User SET emailVerified = 0 WHERE id = 'owner'").run();
    assert.equal(await (await request("/get-session", freshCookie)).json(), null);
    assert.equal((await request("/sign-in/email", "", { email, password })).status, 403);
    await assert.rejects(context.internalAdapter.createSession("owner"), { status: "FORBIDDEN" });
    await db.prepare("UPDATE User SET emailVerified = 1 WHERE id = 'owner'").run();
    const verifiedCookie = await login();
    assert.equal((await request("/change-email", verifiedCookie, { newEmail: backup })).status, 400);
    assert.equal((await request("/update-user", verifiedCookie, { email: backup })).status, 400);
    assert.equal((await request("/update-user", verifiedCookie, { role: "admin", emailVerified: true })).status, 400);
    bindings.AUTH_ALLOWED_EMAILS = "";
    assert.equal((await request("/get-session", verifiedCookie)).status, 503);
    await assert.rejects(context.internalAdapter.createSession("owner"), { status: "SERVICE_UNAVAILABLE" });
    assert.deepEqual(await db.prepare("SELECT COUNT(*) n FROM Session").first(), { n: 1 },
      "Invalid configuration must deny auth without destructively treating an empty list as a removal.");
    bindings.AUTH_ALLOWED_EMAILS = `${email},${backup}`;
    assert.equal((await request("/sign-out", verifiedCookie, {})).status, 200);
    assert.equal(await (await request("/get-session", verifiedCookie)).json(), null);
    await login();
    for (const channel of ["internal", "http"]) for (const transition of ["email", "verification", "policy"]) {
      await db.prepare("DELETE FROM Session").run();
      await db.prepare("UPDATE User SET email = ?, emailVerified = 1 WHERE id = 'owner'").bind(email).run();
      bindings.AUTH_ALLOWED_EMAILS = `${email},${backup}`;
      bindings.AUTH_ADMIN_EMAILS = backup;
      let intercepted = false;
      bindings.DB = new Proxy(db, { get(target, key) {
        if (key !== "prepare") return Reflect.get(target, key);
        return (sql: string) => {
          const intercept = (statement: ReturnType<typeof db.prepare>): ReturnType<typeof db.prepare> => new Proxy(statement, {
            get(stmt, field) {
              if (field === "bind") return (...values: unknown[]) => intercept(stmt.bind(...values));
              if (field === "first") return async () => {
                const snapshot = await stmt.first();
                if (!intercepted && sql.startsWith('SELECT "id" FROM "User"')) {
                  intercepted = true;
                  if (transition === "email") await db.prepare("UPDATE User SET email = ? WHERE id = 'owner'").bind("removed@example.invalid").run();
                  if (transition === "verification") await db.prepare("UPDATE User SET emailVerified = 0 WHERE id = 'owner'").run();
                  if (transition === "policy") bindings.AUTH_ALLOWED_EMAILS = backup;
                }
                return snapshot;
              };
              const value = Reflect.get(stmt, field);
              return typeof value === "function" ? value.bind(stmt) : value;
            },
          });
          return intercept(target.prepare(sql));
        };
      } });
      if (channel === "internal") {
        await assert.rejects(context.internalAdapter.createSession("owner"), { status: "FORBIDDEN" },
          `A ${transition} change between admission and insert must reject the completed session.`);
      } else {
        assert.equal((await request("/sign-in/email", "", { email, password })).status, 403,
          `HTTP login must not return success after the ${transition} change during session creation.`);
      }
      assert.equal(intercepted, true);
      assert.deepEqual(await db.prepare("SELECT COUNT(*) n FROM Session").first(), { n: 0 });
      bindings.DB = db;
    }
  } finally { setCloudflareBindings(null); await runtime.dispose(); }
});
