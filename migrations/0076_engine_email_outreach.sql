-- Engine email outreach: public business emails found on the business's own
-- website, a permanent suppression list, one first-touch email per business,
-- and a single owner switch that defaults OFF. Follow-ups are not modelled.
CREATE TABLE "EngineProspectEmail" (
  "prospectId" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL CHECK (length("email") BETWEEN 6 AND 254 AND "email" = lower("email") AND "email" LIKE '%_@_%._%'),
  "sourceUrl" TEXT NOT NULL CHECK (length("sourceUrl") BETWEEN 8 AND 300),
  "method" TEXT NOT NULL CHECK ("method" IN ('MAILTO_LINK', 'PAGE_TEXT')),
  "capturedAt" TEXT NOT NULL,
  "runId" TEXT NOT NULL CHECK (length("runId") BETWEEN 1 AND 120),
  FOREIGN KEY ("prospectId") REFERENCES "EngineProspect" ("prospectId") ON DELETE RESTRICT
);

CREATE TABLE "EngineEmailSuppression" (
  "email" TEXT NOT NULL PRIMARY KEY CHECK (length("email") BETWEEN 3 AND 254 AND "email" = lower("email")),
  "reason" TEXT NOT NULL CHECK ("reason" IN ('UNSUBSCRIBED', 'BOUNCED', 'DO_NOT_CONTACT', 'OWNER')),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER "EngineEmailSuppression_no_delete" BEFORE DELETE ON "EngineEmailSuppression"
BEGIN SELECT RAISE(ABORT, 'ENGINE_EMAIL_SUPPRESSION_PERMANENT'); END;
CREATE TRIGGER "EngineEmailSuppression_no_update" BEFORE UPDATE ON "EngineEmailSuppression"
BEGIN SELECT RAISE(ABORT, 'ENGINE_EMAIL_SUPPRESSION_PERMANENT'); END;

-- One row per business ever emailed. A CLAIMED row that never reaches SENT or
-- FAILED is treated as sent for cap purposes, so a crash can never double-send.
CREATE TABLE "EngineEmailSend" (
  "sendId" TEXT NOT NULL PRIMARY KEY,
  "prospectId" TEXT NOT NULL UNIQUE,
  "email" TEXT NOT NULL,
  "sendDay" TEXT NOT NULL CHECK (length("sendDay") = 10),
  "templateVersion" TEXT NOT NULL CHECK (length("templateVersion") BETWEEN 1 AND 60),
  "unsubscribeToken" TEXT NOT NULL UNIQUE CHECK (length("unsubscribeToken") >= 32),
  "status" TEXT NOT NULL CHECK ("status" IN ('CLAIMED', 'SENT', 'FAILED')),
  "detail" TEXT CHECK ("detail" IS NULL OR length("detail") <= 300),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "finishedAt" TEXT,
  FOREIGN KEY ("prospectId") REFERENCES "EngineProspect" ("prospectId") ON DELETE RESTRICT
);
CREATE INDEX "EngineEmailSend_day_idx" ON "EngineEmailSend" ("sendDay");
CREATE UNIQUE INDEX "EngineEmailSend_email_idx" ON "EngineEmailSend" ("email");
CREATE TRIGGER "EngineEmailSend_no_delete" BEFORE DELETE ON "EngineEmailSend"
BEGIN SELECT RAISE(ABORT, 'ENGINE_EMAIL_SEND_NO_DELETE'); END;
CREATE TRIGGER "EngineEmailSend_forward_only" BEFORE UPDATE ON "EngineEmailSend"
WHEN OLD."status" <> 'CLAIMED' OR NEW."prospectId" <> OLD."prospectId" OR NEW."email" <> OLD."email" OR NEW."unsubscribeToken" <> OLD."unsubscribeToken"
BEGIN SELECT RAISE(ABORT, 'ENGINE_EMAIL_SEND_FORWARD_ONLY'); END;

CREATE TABLE "EngineEmailSetting" (
  "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1),
  "enabled" INTEGER NOT NULL DEFAULT 0 CHECK ("enabled" IN (0, 1)),
  "dailyCap" INTEGER NOT NULL DEFAULT 10 CHECK ("dailyCap" BETWEEN 0 AND 10),
  "templateApprovedVersion" TEXT,
  "updatedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updatedBy" TEXT
);
INSERT INTO "EngineEmailSetting" ("id", "enabled", "dailyCap") VALUES (1, 0, 10);
