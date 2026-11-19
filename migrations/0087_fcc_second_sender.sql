-- A second FCC sending inbox (Riley, Nov 1 2026). Each contact keeps the inbox
-- that sent their first email, so their follow-up goes from the same inbox in
-- the same thread. NULL means the first FCC inbox (Aidan's), which sent
-- everything before this, so no existing row changes.
ALTER TABLE "FccCampaignContact" ADD COLUMN "senderAddress" TEXT;
ALTER TABLE "FccCampaignSend" ADD COLUMN "senderAddress" TEXT;
CREATE INDEX IF NOT EXISTS "FccCampaignSend_day_sender_idx" ON "FccCampaignSend" ("sendDay", "senderAddress");
