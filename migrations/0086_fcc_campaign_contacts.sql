-- FCC "March 1 pack" campaign: contacts, one send record per email, and the
-- founders' go switch.
-- Contacts are kept in their own table, NOT in Lead or EngineProspect, so the
-- website-outreach paths can never queue or send to them. Sending happens only
-- in src/lib/fcc-campaign-sender.ts, and only after a founder records the go
-- for the exact approved copy (FccCampaignSetting starts locked).

CREATE TABLE IF NOT EXISTS "FccCampaignContact" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "campaignKey" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "contactName" TEXT,
  "title" TEXT,
  "phone" TEXT,
  "company" TEXT NOT NULL,
  "filingsJson" TEXT NOT NULL,
  "emailKind" TEXT NOT NULL,
  "sendable" INTEGER NOT NULL DEFAULT 0,
  "holdReason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ready' CHECK ("status" IN ('ready', 'held', 'step1_sent', 'step2_sent', 'replied', 'bounced', 'suppressed', 'failed')),
  "step1SentAt" TEXT,
  "step1MessageId" TEXT,
  "step2DueAt" TEXT,
  "step2SentAt" TEXT,
  "stoppedReason" TEXT CHECK ("stoppedReason" IS NULL OR length("stoppedReason") <= 300),
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "FccCampaignContact_campaignKey_email_key"
  ON "FccCampaignContact" ("campaignKey", "email");

CREATE INDEX IF NOT EXISTS "FccCampaignContact_campaignKey_status_idx"
  ON "FccCampaignContact" ("campaignKey", "status");

-- One live row per contact per step, claimed before sending. A CLAIMED row that
-- never reaches SENT or FAILED counts as sent, so a crash can never double-send.
-- A FAILED row stays as history; the contact is only retried after a person
-- sets it back to 'ready'.
CREATE TABLE IF NOT EXISTS "FccCampaignSend" (
  "sendId" TEXT PRIMARY KEY NOT NULL,
  "contactId" TEXT NOT NULL,
  "step" INTEGER NOT NULL CHECK ("step" IN (1, 2)),
  "email" TEXT NOT NULL,
  "sendDay" TEXT NOT NULL CHECK (length("sendDay") = 10),
  "messageId" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('CLAIMED', 'SENT', 'FAILED')),
  "detail" TEXT CHECK ("detail" IS NULL OR length("detail") <= 300),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "finishedAt" TEXT,
  FOREIGN KEY ("contactId") REFERENCES "FccCampaignContact" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS "FccCampaignSend_contact_step_key" ON "FccCampaignSend" ("contactId", "step") WHERE "status" <> 'FAILED';
CREATE INDEX IF NOT EXISTS "FccCampaignSend_day_idx" ON "FccCampaignSend" ("sendDay");
CREATE TRIGGER IF NOT EXISTS "FccCampaignSend_no_delete" BEFORE DELETE ON "FccCampaignSend"
BEGIN SELECT RAISE(ABORT, 'FCC_CAMPAIGN_SEND_NO_DELETE'); END;
CREATE TRIGGER IF NOT EXISTS "FccCampaignSend_forward_only" BEFORE UPDATE ON "FccCampaignSend"
WHEN OLD."status" <> 'CLAIMED' OR NEW."contactId" <> OLD."contactId" OR NEW."step" <> OLD."step" OR NEW."messageId" <> OLD."messageId"
BEGIN SELECT RAISE(ABORT, 'FCC_CAMPAIGN_SEND_FORWARD_ONLY'); END;

-- The founders' go. Locked until someone records who gave the go and which copy
-- version they approved; a new copy version locks sending again.
CREATE TABLE IF NOT EXISTS "FccCampaignSetting" (
  "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1),
  "enabled" INTEGER NOT NULL DEFAULT 0 CHECK ("enabled" IN (0, 1)),
  "dailyCap" INTEGER NOT NULL DEFAULT 30 CHECK ("dailyCap" BETWEEN 0 AND 30),
  "approvedCopy" TEXT,
  "goBy" TEXT CHECK ("goBy" IS NULL OR length("goBy") BETWEEN 1 AND 80),
  "goAt" TEXT,
  "updatedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO "FccCampaignSetting" ("id", "enabled", "dailyCap") VALUES (1, 0, 30);
