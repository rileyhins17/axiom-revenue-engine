import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import Database from "better-sqlite3";

import type { D1DatabaseLike, D1PreparedStatementLike } from "./cloudflare";
import { setCloudflareBindings } from "./cloudflare";
import { assertOperatorAdmission, reconcileOperatorAdmission } from "./operator-owner-policy";
import { changeOperatorAccess, isOperatorAction } from "./operator-access";
import { isBlockedAdminAuthPath, operatorBanSchemaReady } from "./operator-ban-schema";

const migration = readFileSync("migrations/0071_operator_ban_session_guards.sql", "utf8");
const schema = readFileSync("migrations/0001_cloudflare_auth_security.sql", "utf8");
const approved = "admin@example.invalid,target@example.invalid";
beforeEach(() => setCloudflareBindings({ AUTH_ALLOWED_EMAILS: approved, AUTH_ADMIN_EMAILS: approved }));
afterEach(() => setCloudflareBindings(null));
function fixture(applyGuards = true) {
  const db = new Database(":memory:");
  db.exec(schema);
  for (const [id, role] of [["admin", "admin"], ["target", "user"]]) {
    db.prepare('INSERT INTO User (id, name, email, role, emailVerified, updatedAt) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)')
      .run(id, id, `${id}@example.invalid`, role);
    db.prepare(`INSERT INTO Session (id, userId, token, expiresAt, updatedAt)
      VALUES (?, ?, ?, datetime('now', '+1 day'), CURRENT_TIMESTAMP)`).run(id, id, id);
  }
  if (applyGuards) db.exec(migration);
  const adapter: D1DatabaseLike = { prepare(query) {
    let bindings: unknown[] = [];
    const statement: D1PreparedStatementLike = {
      bind(...values) { bindings = values; return statement; },
      async run() { return { meta: db.prepare(query).run(...bindings) }; },
      async all<T>() { return { results: db.prepare(query).all(...bindings) as T[] }; },
      async first<T>() { return (db.prepare(query).get(...bindings) ?? null) as T | null; },
    };
    return statement;
  } };
  const input = { action: "ban" as const, userId: "target", actorUserId: "admin", actorSessionId: "admin" };
  return { db, adapter, input };
}

test("ban clears old deadlines, atomically revokes sessions, and unban does not restore them", async () => {
  const { db, adapter, input } = fixture();
  try {
    db.exec(`UPDATE User SET banReason = 'old', banExpires = datetime('now', '-1 day') WHERE id = 'target'`);
    assert.equal(await changeOperatorAccess(adapter, input), "banned");
    assert.equal((db.prepare("SELECT COUNT(*) n FROM Session WHERE userId = 'target'").get() as { n: number }).n, 0);
    assert.deepEqual(db.prepare("SELECT banned, banReason, banExpires FROM User WHERE id = 'target'").get(),
      { banned: 1, banReason: null, banExpires: null });
    assert.equal(await changeOperatorAccess(adapter, input), "banned");
    assert.equal(await changeOperatorAccess(adapter, { ...input, action: "unban" }), "unbanned");
    assert.equal((db.prepare("SELECT COUNT(*) n FROM Session WHERE userId = 'target'").get() as { n: number }).n, 0);
    db.exec(`INSERT INTO Session (id,userId,token,expiresAt,updatedAt)
      VALUES ('fresh','target','fresh',datetime('now','+1 day'),CURRENT_TIMESTAMP)`);
    assert.equal(await changeOperatorAccess(adapter, { ...input, action: "make_admin" }), "promoted");
    assert.equal(await changeOperatorAccess(adapter, { ...input, action: "remove_admin" }), "demoted");
  } finally { db.close(); }
});

test("ban and session deletion roll back together if deletion fails", async () => {
  const { db, adapter, input } = fixture();
  try {
    db.exec(`CREATE TRIGGER fixture_delete_failure BEFORE DELETE ON Session
      BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    await assert.rejects(changeOperatorAccess(adapter, input), /synthetic failure/);
    assert.equal((db.prepare("SELECT banned FROM User WHERE id = 'target'").get() as { banned: number }).banned, 0);
    assert(db.prepare("SELECT id FROM Session WHERE id = 'target'").get());
  } finally { db.close(); }
});

test("late session insertion, replacement, refresh and reassignment cannot cross a ban", () => {
  const { db } = fixture(false);
  try {
    db.exec("UPDATE User SET banned = 1 WHERE id = 'target'");
    assert(db.prepare("SELECT id FROM Session WHERE id = 'target'").get());
    db.exec(migration);
    assert.equal(db.prepare("SELECT id FROM Session WHERE id = 'target'").get(), undefined);
    const insert = `INTO Session (id,userId,token,expiresAt,updatedAt)
      VALUES ('late','target','late',datetime('now','+1 day'),CURRENT_TIMESTAMP)`;
    for (const prefix of ["INSERT", "INSERT OR IGNORE", "INSERT OR REPLACE"]) {
      assert.throws(() => db.exec(`${prefix} ${insert}`), /Banned operator/);
    }
    assert.throws(() => db.exec("UPDATE Session SET userId = 'target' WHERE id = 'admin'"), /Banned operator/);
    db.exec("UPDATE User SET banned = 0 WHERE id = 'target'");
    db.exec(`INSERT ${insert}`);
    // Simulate a pre-migration stale session to exercise the UPDATE guard.
    db.exec("DROP TRIGGER operator_ban_revoke_sessions; UPDATE User SET banned = 1 WHERE id = 'target'");
    assert.throws(() => db.exec("UPDATE Session SET expiresAt = datetime('now','+2 days') WHERE id = 'late'"), /Banned operator/);
  } finally { db.close(); }
});

for (const [name, change] of [
  ["demoted actor", "UPDATE User SET role = 'user' WHERE id = 'admin'"],
  ["banned actor", "UPDATE User SET banned = 1 WHERE id = 'admin'"],
  ["revoked actor", "DELETE FROM Session WHERE id = 'admin'"],
  ["expired actor", "UPDATE Session SET expiresAt = datetime('now','-1 second') WHERE id = 'admin'"],
  ["invalid expiry", "UPDATE Session SET expiresAt = 'invalid' WHERE id = 'admin'"],
  ["unapproved actor", "UPDATE User SET email = 'removed@example.invalid' WHERE id = 'admin'"],
  ["unverified actor", "UPDATE User SET emailVerified = 0 WHERE id = 'admin'"],
]) {
  test(`the mutation-time fence rejects a ${name}`, async () => {
    const { db, adapter, input } = fixture();
    try {
      db.exec(change);
      assert.equal(await changeOperatorAccess(adapter, input), null);
      assert.equal((db.prepare("SELECT banned FROM User WHERE id = 'target'").get() as { banned: number }).banned, 0);
    } finally { db.close(); }
  });
}

test("self, missing target, mismatched actor/session, and action prototypes are rejected", async () => {
  const { db, adapter, input } = fixture();
  try {
    assert.equal(await changeOperatorAccess(adapter, { ...input, userId: "admin" }), null);
    assert.equal(await changeOperatorAccess(adapter, { ...input, userId: "missing" }), null);
    assert.equal(await changeOperatorAccess(adapter, { ...input, actorSessionId: "target" }), null);
    for (const value of ["__proto__", "constructor", "toString", null, {}, [], 1]) assert.equal(isOperatorAction(value), false);
    assert.equal(isOperatorAction("ban"), true);
  } finally { db.close(); }
});

test("missing or altered ban guards fail closed before any operator mutation", async () => {
  const { db, adapter, input } = fixture(false);
  try {
    assert.equal(await operatorBanSchemaReady(adapter), false);
    await assert.rejects(changeOperatorAccess(adapter, input), /reviewed ban schema/);
    assert.equal((db.prepare("SELECT banned FROM User WHERE id = 'target'").get() as { banned: number }).banned, 0);
    db.exec(migration);
    assert.equal(await operatorBanSchemaReady(adapter), true);
    db.exec(`DROP TRIGGER operator_ban_revoke_sessions;
      CREATE TRIGGER operator_ban_revoke_sessions AFTER UPDATE OF banned ON User BEGIN SELECT 1; END;`);
    assert.equal(await operatorBanSchemaReady(adapter), false);
    await assert.rejects(changeOperatorAccess(adapter, input), /reviewed ban schema/);
    assert.equal(await operatorBanSchemaReady({ prepare() { throw new Error("synthetic DB unavailable"); } }), false);
  } finally { db.close(); }
});

test("admin auth policy permits inspection but denies mutation shortcuts and unknown additions", () => {
  for (const path of ["/admin/get-user", "/admin/list-users", "/admin/list-user-sessions", "/admin/has-permission", "/get-session"])
    assert.equal(isBlockedAdminAuthPath(path), false);
  for (const path of ["/admin/ban-user", "/admin/unban-user", "/admin/set-role", "/admin/update-user", "/admin/create-user",
    "/admin/remove-user", "/admin/set-user-password", "/admin/impersonate-user", "/admin/stop-impersonating",
    "/admin/revoke-user-session", "/admin/revoke-user-sessions", "/admin/new-operation", "/admin/list-users/"])
    assert.equal(isBlockedAdminAuthPath(path), true);
});

test("current owner policy revokes removed identities without reviving old sessions on re-add", async () => {
  const { db, adapter } = fixture();
  try {
    await assertOperatorAdmission(adapter, "target");
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "admin@example.invalid", AUTH_ADMIN_EMAILS: "admin@example.invalid" });
    await reconcileOperatorAdmission(adapter);
    assert.equal(db.prepare("SELECT id FROM Session WHERE id = 'target'").get(), undefined);
    assert(db.prepare("SELECT id FROM Session WHERE id = 'admin'").get());
    await assert.rejects(assertOperatorAdmission(adapter, "target"), { status: "FORBIDDEN" });
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: approved, AUTH_ADMIN_EMAILS: approved });
    await reconcileOperatorAdmission(adapter);
    await assertOperatorAdmission(adapter, "target");
    assert.equal(db.prepare("SELECT id FROM Session WHERE id = 'target'").get(), undefined);
    db.exec("UPDATE User SET emailVerified = 0 WHERE id = 'admin'");
    await reconcileOperatorAdmission(adapter);
    assert.equal(db.prepare("SELECT id FROM Session WHERE id = 'admin'").get(), undefined);
    await assert.rejects(assertOperatorAdmission(adapter, "admin"), { status: "FORBIDDEN" });
  } finally { db.close(); }
});

test("admin approval is a ceiling, removal demotes without banning, and re-add never promotes", async () => {
  const { db, adapter, input } = fixture();
  try {
    db.exec(`INSERT INTO User (id,name,email,role,updatedAt)
      VALUES ('system','Internal','system@example.invalid','system',CURRENT_TIMESTAMP)`);
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: approved, AUTH_ADMIN_EMAILS: "target@example.invalid" });
    // The mutation fence independently checks fresh policy even before cleanup.
    assert.equal(await changeOperatorAccess(adapter, input), null);
    await reconcileOperatorAdmission(adapter);
    assert.deepEqual(db.prepare("SELECT role, banned FROM User WHERE id = 'admin'").get(), { role: "user", banned: 0 });
    assert(db.prepare("SELECT id FROM Session WHERE id = 'admin'").get());
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: approved, AUTH_ADMIN_EMAILS: approved });
    await reconcileOperatorAdmission(adapter);
    assert.equal((db.prepare("SELECT role FROM User WHERE id = 'admin'").get() as { role: string }).role, "user");
    db.exec("UPDATE User SET role = 'admin' WHERE id = 'admin'");
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: approved, AUTH_ADMIN_EMAILS: "admin@example.invalid" });
    assert.equal(await changeOperatorAccess(adapter, { ...input, action: "make_admin" }), null);
    db.exec("UPDATE User SET role = 'user,admin' WHERE id = 'target'");
    await reconcileOperatorAdmission(adapter);
    assert.equal((db.prepare("SELECT role FROM User WHERE id = 'target'").get() as { role: string }).role, "user",
      "Legacy comma-separated plugin roles must not bypass the exact admin ceiling.");
    assert.equal((db.prepare("SELECT role FROM User WHERE id = 'system'").get() as { role: string }).role, "system",
      "The internal service identity is not an operator administrator and must remain unchanged.");
    assert.equal(await changeOperatorAccess(adapter, input), "banned", "Other reviewed admin actions remain available.");
    db.exec("UPDATE User SET role = 'admin,user' WHERE id = 'admin'");
    await reconcileOperatorAdmission(adapter);
    assert.equal((db.prepare("SELECT role FROM User WHERE id = 'admin'").get() as { role: string }).role, "admin,user",
      "A verified, approved legacy multi-role administrator retains the existing grant.");
  } finally { db.close(); }
});

test("invalid owner configuration and database failures stop access without destructive cleanup", async () => {
  const { db, adapter } = fixture();
  try {
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: "", AUTH_ADMIN_EMAILS: "" });
    await assert.rejects(reconcileOperatorAdmission(adapter), { status: "SERVICE_UNAVAILABLE" });
    assert.equal((db.prepare("SELECT COUNT(*) n FROM Session").get() as { n: number }).n, 2);
    assert.equal((db.prepare("SELECT role FROM User WHERE id = 'admin'").get() as { role: string }).role, "admin");
    setCloudflareBindings({ AUTH_ALLOWED_EMAILS: approved, AUTH_ADMIN_EMAILS: approved });
    const unavailable = { prepare() { throw new Error("synthetic database failure"); } };
    await assert.rejects(reconcileOperatorAdmission(unavailable), /synthetic database failure/);
    await assert.rejects(assertOperatorAdmission(unavailable, "admin"), /synthetic database failure/);
  } finally { db.close(); }
});
