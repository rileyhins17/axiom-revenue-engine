import type { D1DatabaseLike } from "./cloudflare";

// Exact runtime prerequisite, deliberately duplicated from source migration
// 0071 and checked against both SQLite and D1 in tests. A deployment-order
// mistake must deny authentication rather than silently weaken a ban.
const guards = {
  operator_ban_revoke_sessions: `CREATE TRIGGER operator_ban_revoke_sessions
    AFTER UPDATE OF "banned" ON "User" WHEN COALESCE(NEW."banned", 0) <> 0
    BEGIN DELETE FROM "Session" WHERE "userId" = NEW."id"; END`,
  operator_ban_block_session_insert: `CREATE TRIGGER operator_ban_block_session_insert
    BEFORE INSERT ON "Session"
    WHEN EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."userId" AND COALESCE("banned", 0) <> 0)
    BEGIN SELECT RAISE(ABORT, 'Banned operator cannot hold a session'); END`,
  operator_ban_block_session_update: `CREATE TRIGGER operator_ban_block_session_update
    BEFORE UPDATE ON "Session"
    WHEN EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."userId" AND COALESCE("banned", 0) <> 0)
    BEGIN SELECT RAISE(ABORT, 'Banned operator cannot hold a session'); END`,
} as const;

const normalize = (sql: string) => sql.trim().replace(/;$/, "").replace(/\s+/g, " ");

export async function operatorBanSchemaReady(database: D1DatabaseLike): Promise<boolean> {
  try {
    const { results = [] } = await database.prepare(`
      SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN (?, ?, ?)
    `).bind(...Object.keys(guards)).all<{ name: string; sql: string | null }>();
    return results.length === Object.keys(guards).length && Object.entries(guards).every(([name, sql]) =>
      results.some((row) => row.name === name && typeof row.sql === "string" && normalize(row.sql) === normalize(sql)));
  } catch {
    return false;
  }
}

// Keep the installed plugin's read-only inspection endpoints. All other admin
// endpoints stay disabled until they share the app's reviewed mutation fence.
// Current app code has no admin client plugin or caller of these shortcuts.
const readOnlyAdminPaths = new Set([
  "/admin/get-user", "/admin/list-users", "/admin/list-user-sessions", "/admin/has-permission",
]);

export function isBlockedAdminAuthPath(path: string): boolean {
  return path.startsWith("/admin/") && !readOnlyAdminPaths.has(path);
}
