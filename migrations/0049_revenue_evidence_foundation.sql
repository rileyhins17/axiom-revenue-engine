-- Revenue evidence foundation.
--
-- 1. Preserve the actual target geography all the way from ScrapeTarget to
--    ScrapeJob and Lead. Historical jobs used an Ontario-only Maps query, so
--    their truthful execution geography is backfilled as ON/CA.
-- 2. Add an append-only FunnelEvent ledger so discovery, delivery, replies,
--    opportunities, and wins can be measured from durable events instead of
--    mutable current-state fields.

ALTER TABLE "ScrapeJob" ADD COLUMN "region" TEXT NOT NULL DEFAULT 'ON';
ALTER TABLE "ScrapeJob" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'CA';
ALTER TABLE "ScrapeJob" ADD COLUMN "targetId" TEXT;

CREATE INDEX IF NOT EXISTS "ScrapeJob_targetId_createdAt_idx"
  ON "ScrapeJob" ("targetId", "createdAt");
CREATE INDEX IF NOT EXISTS "ScrapeJob_country_region_city_createdAt_idx"
  ON "ScrapeJob" ("country", "region", "city", "createdAt");

ALTER TABLE "Lead" ADD COLUMN "region" TEXT;
ALTER TABLE "Lead" ADD COLUMN "country" TEXT;
ALTER TABLE "Lead" ADD COLUMN "sourceJobId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "sourceTargetId" TEXT;

CREATE INDEX IF NOT EXISTS "Lead_country_region_city_createdAt_idx"
  ON "Lead" ("country", "region", "city", "createdAt");
CREATE INDEX IF NOT EXISTS "Lead_sourceJobId_idx" ON "Lead" ("sourceJobId");
CREATE INDEX IF NOT EXISTS "Lead_sourceTargetId_idx" ON "Lead" ("sourceTargetId");

CREATE TABLE "FunnelEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dedupeKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "leadId" INTEGER,
  "scrapeJobId" TEXT,
  "scrapeTargetId" TEXT,
  "sequenceId" TEXT,
  "sequenceStepId" TEXT,
  "outreachEmailId" TEXT,
  "channel" TEXT,
  "policyVersion" TEXT,
  "score" INTEGER,
  "metadataJson" TEXT,
  "occurredAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "FunnelEvent_dedupeKey_key" ON "FunnelEvent" ("dedupeKey");
CREATE INDEX "FunnelEvent_eventType_occurredAt_idx" ON "FunnelEvent" ("eventType", "occurredAt");
CREATE INDEX "FunnelEvent_leadId_occurredAt_idx" ON "FunnelEvent" ("leadId", "occurredAt");
CREATE INDEX "FunnelEvent_scrapeJobId_idx" ON "FunnelEvent" ("scrapeJobId");
CREATE INDEX "FunnelEvent_sequenceId_idx" ON "FunnelEvent" ("sequenceId");

-- Seed the ledger from the historical records that have reliable timestamps.
-- These inserts are idempotent and contain no email bodies or recipient data.
INSERT OR IGNORE INTO "FunnelEvent" (
  "id", "dedupeKey", "eventType", "scrapeJobId", "score", "metadataJson", "occurredAt"
)
SELECT
  'history:scrape:' || "id",
  'scrape-job:' || "id",
  'SCRAPE_JOB_CREATED',
  "id",
  NULL,
  json_object('niche', "niche", 'city', "city", 'historical', 1),
  "createdAt"
FROM "ScrapeJob";

INSERT OR IGNORE INTO "FunnelEvent" (
  "id", "dedupeKey", "eventType", "leadId", "score", "metadataJson", "occurredAt"
)
SELECT
  'history:lead:' || "id",
  'lead-discovered:' || "id",
  'LEAD_DISCOVERED',
  "id",
  "axiomScore",
  json_object('niche', "niche", 'city', "city", 'historical', 1),
  "createdAt"
FROM "Lead";

INSERT OR IGNORE INTO "FunnelEvent" (
  "id", "dedupeKey", "eventType", "leadId", "sequenceId", "sequenceStepId",
  "outreachEmailId", "channel", "metadataJson", "occurredAt"
)
SELECT
  'history:sent:' || "id",
  'outreach-sent:' || "id",
  'OUTREACH_SENT',
  "leadId",
  "sequenceId",
  "sequenceStepId",
  "id",
  'EMAIL',
  json_object('senderMailboxId', "mailboxId", 'historical', 1),
  "sentAt"
FROM "OutreachEmail"
WHERE "status" = 'sent' AND "sentAt" IS NOT NULL;

INSERT OR IGNORE INTO "FunnelEvent" (
  "id", "dedupeKey", "eventType", "leadId", "sequenceId", "channel", "metadataJson", "occurredAt"
)
SELECT
  'history:reply:' || "id",
  'reply-detected:' || "id",
  'REPLY_DETECTED',
  "leadId",
  "id",
  'EMAIL',
  json_object('historical', 1),
  "replyDetectedAt"
FROM "OutreachSequence"
WHERE "replyDetectedAt" IS NOT NULL AND "stopReason" = 'REPLIED';

INSERT OR IGNORE INTO "FunnelEvent" (
  "id", "dedupeKey", "eventType", "leadId", "sequenceId", "channel", "metadataJson", "occurredAt"
)
SELECT
  'history:bounce:' || "id",
  'bounce-detected:' || "id",
  'BOUNCE_DETECTED',
  "leadId",
  "id",
  'EMAIL',
  json_object('historical', 1),
  "replyDetectedAt"
FROM "OutreachSequence"
WHERE "replyDetectedAt" IS NOT NULL AND "stopReason" = 'BOUNCED';

INSERT OR IGNORE INTO "FunnelEvent" (
  "id", "dedupeKey", "eventType", "leadId", "channel", "metadataJson", "occurredAt"
)
SELECT
  'history:opportunity:' || "id",
  'opportunity-created:' || "id",
  'OPPORTUNITY_CREATED',
  "id",
  COALESCE("outreachChannel", 'UNKNOWN'),
  json_object('dealStage', "dealStage", 'historical', 1),
  COALESCE("lastUpdated", "createdAt")
FROM "Lead"
WHERE "dealStage" IS NOT NULL AND "dealStage" != 'LOST';

INSERT OR IGNORE INTO "FunnelEvent" (
  "id", "dedupeKey", "eventType", "leadId", "channel", "metadataJson", "occurredAt"
)
SELECT
  'history:won:' || "id",
  'deal-won:' || "id",
  'DEAL_WON',
  "id",
  COALESCE("outreachChannel", 'UNKNOWN'),
  json_object('dealStage', "dealStage", 'historical', 1),
  COALESCE("signedAt", "lastUpdated", "createdAt")
FROM "Lead"
WHERE "dealStage" IN ('SIGNED', 'ACTIVE', 'DELIVERED', 'RETAINED');
