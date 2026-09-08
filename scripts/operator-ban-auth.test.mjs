import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";

const schema = readFileSync("migrations/0001_cloudflare_auth_security.sql", "utf8");
const guards = readFileSync("migrations/0071_operator_ban_session_guards.sql", "utf8");

async function fixture() {
  const database = new Database(":memory:");
  database.exec(schema);
  database.exec(guards);
  const plugin = admin();
  const auth = betterAuth({
    database, baseURL: "http://127.0.0.1:3000", secret: "synthetic-ban-test-secret-not-a-real-key-123456",
    plugins: [plugin],
  });
  const context = await auth.$context;
  const expired = new Date(Date.now() - 60_000);
  await context.adapter.create({ model: "user", data: {
    id: "target", name: "Synthetic", email: "synthetic@example.invalid", emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(), banned: true, banExpires: expired, banReason: "Temporary",
  }, forceAllowId: true });
  const before = plugin.init().options.databaseHooks.session.create.before;
  return { database, context, before };
}

test("expired temporary bans still clear and allow a fresh session through the real adapter", async () => {
  const { database, context, before } = await fixture();
  try {
    await before({ userId: "target" }, { context });
    const user = await context.internalAdapter.findUserById("target");
    assert.equal(user.banned, false);
    assert.equal(user.banExpires, null);
    assert.equal(user.banReason, null);
    const session = await context.internalAdapter.createSession("target");
    assert.equal(session.userId, "target");
  } finally { database.close(); }
});

test("an expired-ban login cannot overwrite a newer permanent, temporary or same-deadline edited ban", async () => {
  for (const deadline of [null, new Date(Date.now() + 600_000), "same"]) {
    const { database, context, before } = await fixture();
    try {
      const original = context.internalAdapter.findUserById.bind(context.internalAdapter);
      let first = true;
      let expectedDeadline;
      const raceContext = { ...context, internalAdapter: { ...context.internalAdapter,
        async findUserById(id) {
          const snapshot = await original(id);
          if (first) {
            first = false;
            const banExpires = deadline === "same" ? snapshot.banExpires : deadline;
            expectedDeadline = banExpires;
            await context.internalAdapter.updateUser(id, { banned: true, banExpires, banReason: "New ban" });
          }
          return snapshot;
        },
      } };
      await assert.rejects(before({ userId: "target" }, { context: raceContext }),
        (error) => error.status === "FORBIDDEN" && error.body.code === "BANNED_USER");
      const user = await original("target");
      assert.equal(user.banned, true);
      assert.equal(user.banReason, "New ban");
      assert.equal(user.banExpires?.getTime() ?? null, expectedDeadline?.getTime() ?? null);
      assert.equal(database.prepare("SELECT COUNT(*) n FROM Session").get().n, 0);
    } finally { database.close(); }
  }
});

test("a ban between auth precheck and session insertion still prevents the session", async () => {
  const { database, context, before } = await fixture();
  try {
    await before({ userId: "target" }, { context });
    await context.internalAdapter.updateUser("target", { banned: true, banExpires: null });
    await assert.rejects(context.internalAdapter.createSession("target"), /Banned operator/);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM Session").get().n, 0);
  } finally { database.close(); }
});
