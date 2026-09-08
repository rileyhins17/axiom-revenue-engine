-- Source-only security migration. Apply only through an approved, backed-up
-- release; 0070 remains a separate, unapproved design migration.
DELETE FROM "Session" WHERE "userId" IN
  (SELECT "id" FROM "User" WHERE COALESCE("banned", 0) <> 0);

-- statement-breakpoint
CREATE TRIGGER operator_ban_revoke_sessions
AFTER UPDATE OF "banned" ON "User"
WHEN COALESCE(NEW."banned", 0) <> 0
BEGIN
  DELETE FROM "Session" WHERE "userId" = NEW."id";
END;

-- statement-breakpoint
CREATE TRIGGER operator_ban_block_session_insert
BEFORE INSERT ON "Session"
WHEN EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."userId" AND COALESCE("banned", 0) <> 0)
BEGIN
  SELECT RAISE(ABORT, 'Banned operator cannot hold a session');
END;

-- statement-breakpoint
CREATE TRIGGER operator_ban_block_session_update
BEFORE UPDATE ON "Session"
WHEN EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."userId" AND COALESCE("banned", 0) <> 0)
BEGIN
  SELECT RAISE(ABORT, 'Banned operator cannot hold a session');
END;
