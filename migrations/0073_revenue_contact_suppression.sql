-- A permanent, owner-recorded do-not-contact decision for one exact contact point.
-- This is independent of RevenueBusinessStopEvent and provider-side state.
CREATE TABLE "RevenueContactSuppressionEvent" (
  "suppressionId" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "contactPointId" TEXT NOT NULL,
  "contactFingerprint" TEXT NOT NULL CHECK (length("contactFingerprint") = 64),
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "reason" TEXT NOT NULL CHECK ("reason" IN ('UNSUBSCRIBE', 'COMPLAINT', 'BOUNCE')),
  "note" TEXT NOT NULL CHECK (length("note") BETWEEN 1 AND 300),
  "actorUserId" TEXT NOT NULL CHECK (length("actorUserId") BETWEEN 1 AND 160),
  "observedAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE ("contactPointId"),
  UNIQUE ("businessId", "contactFingerprint"),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("contactPointId") REFERENCES "RevenueContactPoint" ("id") ON DELETE RESTRICT
);
CREATE INDEX "RevenueContactSuppressionEvent_business_idx"
  ON "RevenueContactSuppressionEvent" ("businessId");
CREATE TRIGGER "RevenueContactSuppressionEvent_scope_insert"
BEFORE INSERT ON "RevenueContactSuppressionEvent"
WHEN NOT EXISTS (
  SELECT 1 FROM "RevenueContactPoint" contact
  WHERE contact."id" = NEW."contactPointId" AND contact."businessId" = NEW."businessId"
)
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_SUPPRESSION_SCOPE_INVALID'); END;
CREATE TRIGGER "RevenueContactSuppressionEvent_immutable_update"
BEFORE UPDATE ON "RevenueContactSuppressionEvent"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_SUPPRESSION_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueContactSuppressionEvent_immutable_delete"
BEFORE DELETE ON "RevenueContactSuppressionEvent"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_SUPPRESSION_APPEND_ONLY'); END;
