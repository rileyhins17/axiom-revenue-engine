-- The Claude connector (/api/mcp, Nov 13, 2026) signs in with a private key per founder instead of the
-- sign-in cookie. Each founder can hold two: one sent in a header (Claude Code) and one that is part of
-- a link (claude.ai custom connectors, which can't send a header). Only the SHA-256 of a key is kept; the
-- key itself is shown once, in Settings, when it is made. Making a new key of a kind replaces that
-- founder's old one, and turning a key off deletes its row.
-- Only adds a table: older code never reads it, and nothing about sending reads it.
CREATE TABLE IF NOT EXISTS "EngineConnectorKey" (
  "founder" TEXT NOT NULL CHECK ("founder" IN ('Riley', 'Aidan')),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('header', 'link')),
  "keyHash" TEXT NOT NULL UNIQUE CHECK (length("keyHash") = 64),
  "lastFour" TEXT CHECK ("lastFour" IS NULL OR length("lastFour") <= 4),
  "createdAt" TEXT NOT NULL,
  "lastUsedAt" TEXT,
  PRIMARY KEY ("founder", "kind")
);
