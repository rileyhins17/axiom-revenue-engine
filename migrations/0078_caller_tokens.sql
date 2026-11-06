-- Personal API tokens for the Axiom Caller browser extension. Only a SHA-256
-- hash is stored; the token is shown to its owner once. Revoked tokens stay.
CREATE TABLE "CallerToken" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY CHECK (length("tokenHash") = 64),
  "actor" TEXT NOT NULL CHECK ("actor" IN ('RILEY', 'AIDAN')),
  "actorUserId" TEXT NOT NULL CHECK (length("actorUserId") BETWEEN 1 AND 160),
  "label" TEXT NOT NULL CHECK (length("label") BETWEEN 1 AND 80),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "lastUsedAt" TEXT,
  "revokedAt" TEXT
);
CREATE TRIGGER "CallerToken_no_delete" BEFORE DELETE ON "CallerToken"
BEGIN SELECT RAISE(ABORT, 'CALLER_TOKEN_NO_DELETE'); END;
