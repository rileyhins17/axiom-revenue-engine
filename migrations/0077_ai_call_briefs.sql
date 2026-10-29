-- AI call briefs and a hard spend ledger. Every model call reserves its maximum
-- possible cost before it runs; the reservation is settled to the real cost after.
CREATE TABLE "AiUsage" (
  "usageId" TEXT NOT NULL PRIMARY KEY,
  "month" TEXT NOT NULL CHECK (length("month") = 7),
  "feature" TEXT NOT NULL CHECK ("feature" IN ('CALL_BRIEF', 'ASSISTANT')),
  "model" TEXT NOT NULL CHECK (length("model") BETWEEN 1 AND 80),
  "promptVersion" TEXT NOT NULL CHECK (length("promptVersion") BETWEEN 1 AND 60),
  "status" TEXT NOT NULL CHECK ("status" IN ('RESERVED', 'SETTLED', 'FAILED')),
  "inputTokens" INTEGER NOT NULL DEFAULT 0 CHECK ("inputTokens" >= 0),
  "outputTokens" INTEGER NOT NULL DEFAULT 0 CHECK ("outputTokens" >= 0),
  "costMicroUsd" INTEGER NOT NULL CHECK ("costMicroUsd" BETWEEN 0 AND 100000),
  "actor" TEXT NOT NULL CHECK ("actor" IN ('RILEY', 'AIDAN')),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX "AiUsage_month_idx" ON "AiUsage" ("month");
CREATE TRIGGER "AiUsage_no_delete" BEFORE DELETE ON "AiUsage"
BEGIN SELECT RAISE(ABORT, 'AI_USAGE_NO_DELETE'); END;
CREATE TRIGGER "AiUsage_settle_once" BEFORE UPDATE ON "AiUsage"
WHEN OLD."status" <> 'RESERVED' OR NEW."usageId" <> OLD."usageId" OR NEW."month" <> OLD."month"
BEGIN SELECT RAISE(ABORT, 'AI_USAGE_SETTLE_ONCE'); END;

CREATE TABLE "AiCallBrief" (
  "prospectId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL CHECK (length("inputHash") = 64),
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "brief" TEXT NOT NULL CHECK (length("brief") <= 6000),
  "usageId" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY ("prospectId", "inputHash"),
  FOREIGN KEY ("prospectId") REFERENCES "EngineProspect" ("prospectId") ON DELETE RESTRICT
);

-- Problems reported by the owners or the assistant, for a Claude Code session to pick up.
CREATE TABLE "AppFixRequest" (
  "requestId" TEXT NOT NULL PRIMARY KEY,
  "summary" TEXT NOT NULL CHECK (length("summary") BETWEEN 3 AND 200),
  "details" TEXT NOT NULL CHECK (length("details") <= 4000),
  "page" TEXT CHECK ("page" IS NULL OR length("page") <= 200),
  "source" TEXT NOT NULL CHECK ("source" IN ('OWNER', 'ASSISTANT')),
  "actor" TEXT NOT NULL CHECK ("actor" IN ('RILEY', 'AIDAN')),
  "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'DONE', 'WONT_FIX')),
  "resolution" TEXT CHECK ("resolution" IS NULL OR length("resolution") <= 2000),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updatedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX "AppFixRequest_status_idx" ON "AppFixRequest" ("status", "createdAt");
CREATE TRIGGER "AppFixRequest_no_delete" BEFORE DELETE ON "AppFixRequest"
BEGIN SELECT RAISE(ABORT, 'APP_FIX_REQUEST_NO_DELETE'); END;
