-- Append-only owner next-action ledger. These records do not grant qualification,
-- consent, provider, outreach, or other workflow authority.
CREATE TABLE "RevenueOwnerTask" (
  "taskId" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "owner" TEXT NOT NULL CHECK ("owner" IN ('RILEY', 'AIDAN')),
  "actionText" TEXT NOT NULL CHECK (length("actionText") BETWEEN 1 AND 500),
  "dueAt" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL CHECK (length("actorUserId") BETWEEN 1 AND 160),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT
);
CREATE INDEX "RevenueOwnerTask_business_created_idx"
  ON "RevenueOwnerTask" ("businessId", "createdAt" DESC, "taskId");

CREATE TABLE "RevenueOwnerTaskTerminalEvent" (
  "eventId" TEXT NOT NULL PRIMARY KEY,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "taskId" TEXT NOT NULL UNIQUE,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('COMPLETE', 'CANCEL')),
  "actorUserId" TEXT NOT NULL CHECK (length("actorUserId") BETWEEN 1 AND 160),
  "note" TEXT NOT NULL CHECK (length("note") BETWEEN 1 AND 500),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY ("taskId") REFERENCES "RevenueOwnerTask" ("taskId") ON DELETE RESTRICT
);
CREATE INDEX "RevenueOwnerTaskTerminalEvent_task_idx"
  ON "RevenueOwnerTaskTerminalEvent" ("taskId", "createdAt");

CREATE TRIGGER "RevenueOwnerTask_immutable_update" BEFORE UPDATE ON "RevenueOwnerTask"
BEGIN SELECT RAISE(ABORT, 'REVENUE_OWNER_TASK_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueOwnerTask_immutable_delete" BEFORE DELETE ON "RevenueOwnerTask"
BEGIN SELECT RAISE(ABORT, 'REVENUE_OWNER_TASK_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueOwnerTaskTerminalEvent_immutable_update" BEFORE UPDATE ON "RevenueOwnerTaskTerminalEvent"
BEGIN SELECT RAISE(ABORT, 'REVENUE_OWNER_TASK_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueOwnerTaskTerminalEvent_immutable_delete" BEFORE DELETE ON "RevenueOwnerTaskTerminalEvent"
BEGIN SELECT RAISE(ABORT, 'REVENUE_OWNER_TASK_APPEND_ONLY'); END;
