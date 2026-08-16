CREATE TABLE IF NOT EXISTS "AgentResultReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "jobId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "leadId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentResultReceipt_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentResultReceipt_jobId_dedupeKey_key"
ON "AgentResultReceipt"("jobId", "dedupeKey");

CREATE INDEX IF NOT EXISTS "AgentResultReceipt_createdAt_idx"
ON "AgentResultReceipt"("createdAt");
