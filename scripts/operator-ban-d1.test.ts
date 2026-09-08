import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
// Miniflare is supplied by the repository's exact pinned Wrangler dependency.
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

import { changeOperatorAccess } from "../src/lib/operator-access";
import { setCloudflareBindings } from "../src/lib/cloudflare";
import { assertOperatorAdmission, reconcileOperatorAdmission } from "../src/lib/operator-owner-policy";

test("ban guards and atomic actor fence execute in local D1, without a live binding", async () => {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    cf: false,
    workers: [{ name: "ban-fixture", modules: true,
      script: "export default { fetch() { return new Response('synthetic'); } }",
      compatibilityDate: "2026-08-01", d1Databases: ["DB"],
      outboundService: async () => { throw new Error("The D1 ban fixture cannot contact external services."); },
    }],
  }));
  try {
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "admin@example.invalid,target@example.invalid",
      AUTH_ADMIN_EMAILS: "admin@example.invalid,target@example.invalid" });
    const db = await runtime.getD1Database("DB");
    const schema = readFileSync("migrations/0001_cloudflare_auth_security.sql", "utf8");
    for (const table of ["User", "Session"]) {
      const ddl = schema.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`));
      assert(ddl, `The real ${table} schema must be available.`);
      await db.prepare(ddl[0]).run();
    }
    for (const id of ["admin", "target"]) {
      await db.prepare(`INSERT INTO User (id,name,email,role,emailVerified,updatedAt) VALUES (?,?,?,'admin',1,CURRENT_TIMESTAMP)`)
        .bind(id, id, `${id}@example.invalid`).run();
      await db.prepare(`INSERT INTO Session (id,userId,token,expiresAt,updatedAt)
        VALUES (?,?,?,datetime('now','+1 day'),CURRENT_TIMESTAMP)`).bind(id, id, id).run();
    }
    const migration = readFileSync("migrations/0071_operator_ban_session_guards.sql", "utf8");
    await db.batch(migration.split("-- statement-breakpoint").map((sql) => db.prepare(sql)));
    const input = { action: "ban" as const, userId: "target", actorUserId: "admin", actorSessionId: "admin" };
    assert.equal(await changeOperatorAccess(db, input), "banned");
    assert.equal(await db.prepare("SELECT id FROM Session WHERE id = 'target'").first(), null);
    const insert = `INSERT INTO Session (id,userId,token,expiresAt,updatedAt)
      VALUES ('late','target','late',datetime('now','+1 day'),CURRENT_TIMESTAMP)`;
    await assert.rejects(db.prepare(insert).run(), /Banned operator/);
    await assert.rejects(db.prepare("UPDATE Session SET userId = 'target' WHERE id = 'admin'").run(), /Banned operator/);
    assert.equal(await changeOperatorAccess(db, { ...input, action: "unban" }), "unbanned");
    await db.prepare(insert).run();
    await db.prepare(`CREATE TRIGGER synthetic_delete_failure BEFORE DELETE ON Session
      BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`).run();
    await assert.rejects(changeOperatorAccess(db, input), /synthetic failure/);
    assert.deepEqual(await db.prepare("SELECT banned FROM User WHERE id = 'target'").first(), { banned: 0 });
    assert(await db.prepare("SELECT id FROM Session WHERE id = 'late'").first());
    await db.prepare("UPDATE User SET role = 'user' WHERE id = 'admin'").run();
    assert.equal(await changeOperatorAccess(db, input), null);
    await db.prepare("DROP TRIGGER synthetic_delete_failure").run();
    const plugin = admin();
    const auth = betterAuth({ database: db, plugins: [plugin], baseURL: "http://127.0.0.1:3000",
      secret: "synthetic-d1-ban-test-not-a-real-key-123456789" });
    const context = await auth.$context;
    const before = plugin.init().options.databaseHooks.session.create.before;
    const expired = new Date(Date.now() - 60_000);
    await context.internalAdapter.updateUser("target", { banned: true, banExpires: expired });
    const sessionInput = { userId: "target" } as Parameters<typeof before>[0];
    const hookContext = { context } as NonNullable<Parameters<typeof before>[1]>;
    await before(sessionInput, hookContext);
    assert.deepEqual(await db.prepare("SELECT banned FROM User WHERE id = 'target'").first(), { banned: 0 });
    await context.internalAdapter.updateUser("target", { banned: true, banExpires: expired });
    const findUser = context.internalAdapter.findUserById.bind(context.internalAdapter);
    let first = true;
    const raceContext = { ...context, internalAdapter: { ...context.internalAdapter,
      async findUserById(id: string) {
        const snapshot = await findUser(id);
        if (first) {
          first = false;
          await context.internalAdapter.updateUser(id, { banned: true, banExpires: null });
        }
        return snapshot;
      },
    } };
    await assert.rejects(before(sessionInput, { context: raceContext } as typeof hookContext),
      (error: unknown) => error instanceof Error && "status" in error && error.status === "FORBIDDEN");
    assert.deepEqual(await db.prepare("SELECT banned FROM User WHERE id = 'target'").first(), { banned: 1 });
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "target@example.invalid", AUTH_ADMIN_EMAILS: "target@example.invalid" });
    await reconcileOperatorAdmission(db);
    assert.equal(await db.prepare("SELECT id FROM Session WHERE id = 'admin'").first(), null);
    await assert.rejects(assertOperatorAdmission(db, "admin"), { status: "FORBIDDEN" });
    assert.deepEqual(await db.prepare("SELECT role FROM User WHERE id = 'admin'").first(), { role: "user" });
  } finally { setCloudflareBindings(null); await runtime.dispose(); }
});
