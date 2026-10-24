-- FCC "March 1 pack" campaign contacts.
-- Kept in their own table, NOT in Lead, so the autonomous website-outreach
-- scheduler can never queue or send to them. Sending for this campaign is a
-- separate, explicitly enabled path (see src/lib/fcc-campaign.ts).

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
  -- ready | held | step1_sent | step2_sent | replied | unsubscribed | bounced
  "status" TEXT NOT NULL DEFAULT 'ready',
  "step1SentAt" TEXT,
  "step2DueAt" TEXT,
  "step2SentAt" TEXT,
  "gmailThreadId" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "FccCampaignContact_campaignKey_email_key"
  ON "FccCampaignContact" ("campaignKey", "email");

CREATE INDEX IF NOT EXISTS "FccCampaignContact_campaignKey_status_idx"
  ON "FccCampaignContact" ("campaignKey", "status");
