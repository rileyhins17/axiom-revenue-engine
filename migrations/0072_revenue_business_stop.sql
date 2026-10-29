-- Manual, permanent owner stop for one exact v2 business identity.
-- This ledger is separate from contact suppression, tasks, and provider state.
CREATE TABLE "RevenueBusinessStopEvent" (
  "stopId" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL UNIQUE,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "reason" TEXT NOT NULL CHECK ("reason" IN ('OWNER_DECISION', 'PROSPECT_REQUEST', 'OTHER')),
  "source" TEXT NOT NULL DEFAULT 'OWNER_ACTION' CHECK ("source" = 'OWNER_ACTION'),
  "note" TEXT NOT NULL CHECK (length("note") BETWEEN 1 AND 500),
  "actorUserId" TEXT NOT NULL CHECK (length("actorUserId") BETWEEN 1 AND 160),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT
);
CREATE TRIGGER "RevenueBusinessStopEvent_immutable_update" BEFORE UPDATE ON "RevenueBusinessStopEvent"
BEGIN SELECT RAISE(ABORT, 'REVENUE_BUSINESS_STOP_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueBusinessStopEvent_immutable_delete" BEFORE DELETE ON "RevenueBusinessStopEvent"
BEGIN SELECT RAISE(ABORT, 'REVENUE_BUSINESS_STOP_APPEND_ONLY'); END;
