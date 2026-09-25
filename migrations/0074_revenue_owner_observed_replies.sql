-- Owner-recorded replies observed outside this system. No message or provider
-- content is stored. Inserting a reply creates its manual owner task in the
-- same SQLite statement through the trigger below.
CREATE TABLE "RevenueOwnerObservedReply" (
  "replyId" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "contactPointId" TEXT NOT NULL,
  "contactFingerprint" TEXT NOT NULL CHECK (length("contactFingerprint") = 64),
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "category" TEXT NOT NULL CHECK ("category" IN ('INTEREST','QUESTION','NEGATIVE','REFERRAL','OUT_OF_OFFICE','OTHER')),
  "summary" TEXT NOT NULL CHECK (length("summary") BETWEEN 1 AND 300),
  "observedAt" TEXT NOT NULL,
  "owner" TEXT NOT NULL CHECK ("owner" IN ('RILEY','AIDAN')),
  "actionText" TEXT NOT NULL CHECK (length("actionText") BETWEEN 1 AND 500),
  "dueAt" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL CHECK (length("actorUserId") BETWEEN 1 AND 160),
  "taskId" TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("contactPointId") REFERENCES "RevenueContactPoint" ("id") ON DELETE RESTRICT
);
CREATE INDEX "RevenueOwnerObservedReply_business_created_idx"
  ON "RevenueOwnerObservedReply" ("businessId", "createdAt" DESC, "replyId");

CREATE TRIGGER "RevenueOwnerObservedReply_admission"
BEFORE INSERT ON "RevenueOwnerObservedReply"
BEGIN
  SELECT RAISE(ABORT, 'REVENUE_OWNER_REPLY_CONTACT_INVALID') WHERE NOT EXISTS (
    SELECT 1 FROM "RevenueContactPoint" contact
    WHERE contact."id" = NEW."contactPointId"
      AND contact."businessId" = NEW."businessId"
      AND contact."channel" = 'EMAIL'
  );
  SELECT RAISE(ABORT, 'REVENUE_OWNER_REPLY_BUSINESS_STOPPED') WHERE EXISTS (
    SELECT 1 FROM "RevenueBusinessStopEvent" stop
    WHERE stop."businessId" = NEW."businessId"
  );
  SELECT RAISE(ABORT, 'REVENUE_OWNER_REPLY_CONTACT_SUPPRESSED') WHERE EXISTS (
    SELECT 1 FROM "RevenueContactSuppressionEvent" suppression
    WHERE suppression."businessId" = NEW."businessId"
      AND suppression."contactFingerprint" = NEW."contactFingerprint"
  );
END;

CREATE TRIGGER "RevenueOwnerObservedReply_create_task"
AFTER INSERT ON "RevenueOwnerObservedReply"
BEGIN
  INSERT INTO "RevenueOwnerTask"
    ("taskId","businessId","idempotencyKey","owner","actionText","dueAt","actorUserId")
  VALUES
    (NEW."taskId",NEW."businessId",'owner-reply:' || NEW."idempotencyKey",NEW."owner",NEW."actionText",NEW."dueAt",NEW."actorUserId");
END;

CREATE TRIGGER "RevenueOwnerObservedReply_immutable_update"
BEFORE UPDATE ON "RevenueOwnerObservedReply"
BEGIN SELECT RAISE(ABORT, 'REVENUE_OWNER_REPLY_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueOwnerObservedReply_immutable_delete"
BEFORE DELETE ON "RevenueOwnerObservedReply"
BEGIN SELECT RAISE(ABORT, 'REVENUE_OWNER_REPLY_APPEND_ONLY'); END;
