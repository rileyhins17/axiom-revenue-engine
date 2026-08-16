-- Separate account value from channel readiness with a durable, versioned
-- qualification decision. Historical rows are marked as migrated evidence;
-- new rows are written from the v2 policy at discovery time.

CREATE TABLE "QualificationSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "snapshotKey" TEXT NOT NULL,
  "leadId" INTEGER NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "legacyScore" INTEGER NOT NULL,
  "totalScore" INTEGER NOT NULL,
  "websiteNeedScore" INTEGER NOT NULL,
  "businessFitScore" INTEGER NOT NULL,
  "reachabilityScore" INTEGER NOT NULL,
  "timingScore" INTEGER NOT NULL,
  "hardGateStatus" TEXT NOT NULL,
  "band" TEXT NOT NULL,
  "recommendedChannel" TEXT NOT NULL,
  "autonomousEmailEligible" INTEGER NOT NULL DEFAULT 0,
  "reasonCodesJson" TEXT NOT NULL DEFAULT '[]',
  "evidenceJson" TEXT NOT NULL DEFAULT '{}',
  "sourceJobId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "QualificationSnapshot_snapshotKey_key"
  ON "QualificationSnapshot" ("snapshotKey");
CREATE INDEX "QualificationSnapshot_leadId_createdAt_idx"
  ON "QualificationSnapshot" ("leadId", "createdAt");
CREATE INDEX "QualificationSnapshot_policyVersion_band_createdAt_idx"
  ON "QualificationSnapshot" ("policyVersion", "band", "createdAt");
CREATE INDEX "QualificationSnapshot_recommendedChannel_band_idx"
  ON "QualificationSnapshot" ("recommendedChannel", "band");

WITH raw AS (
  SELECT
    l.*,
    CASE
      WHEN json_valid(COALESCE(l."scoreBreakdown", ''))
      THEN CAST(ROUND(MIN(35, MAX(0, COALESCE(json_extract(l."scoreBreakdown", '$.painOpportunity'), 0))) * 40.0 / 35.0) AS INTEGER)
      ELSE 0
    END AS website_need,
    CASE
      WHEN json_valid(COALESCE(l."scoreBreakdown", ''))
      THEN CAST(ROUND(MIN(25, MAX(0, COALESCE(json_extract(l."scoreBreakdown", '$.businessValue'), 0)))) AS INTEGER)
      ELSE 0
    END AS business_fit,
    CASE
      WHEN json_valid(COALESCE(l."scoreBreakdown", ''))
      THEN CAST(ROUND(MIN(25, MAX(0, COALESCE(json_extract(l."scoreBreakdown", '$.reachability'), 0))) * 20.0 / 25.0) AS INTEGER)
      ELSE 0
    END AS reachability,
    CASE
      WHEN json_valid(COALESCE(l."scoreBreakdown", ''))
      THEN CAST(ROUND(MIN(15, MAX(0, COALESCE(json_extract(l."scoreBreakdown", '$.localFit'), 0)))) AS INTEGER)
      ELSE 0
    END AS timing,
    CASE
      WHEN COALESCE(l."email", '') != ''
        AND (
          (LOWER(COALESCE(l."emailType", '')) = 'owner' AND COALESCE(l."emailConfidence", 0) >= 0.5)
          OR (LOWER(COALESCE(l."emailType", '')) = 'staff' AND COALESCE(l."emailConfidence", 0) >= 0.65)
        )
        AND LOWER(COALESCE(l."emailFlags", '')) NOT LIKE '%bounced%'
        AND LOWER(COALESCE(l."emailFlags", '')) NOT LIKE '%no_mx%'
        AND LOWER(COALESCE(l."emailFlags", '')) NOT LIKE '%generic_prefix%'
      THEN 1 ELSE 0
    END AS email_ready
  FROM "Lead" l
), scored AS (
  SELECT
    raw.*,
    MIN(100, website_need + business_fit + reachability + timing) AS v2_total,
    CASE
      WHEN email_ready = 1 THEN 'EMAIL'
      WHEN LENGTH(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE("phone", ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', '')) >= 10
        AND COALESCE("phoneConfidence", 0) >= 0.5 THEN 'PHONE'
      WHEN COALESCE("socialLink", '') != '' THEN 'SOCIAL'
      ELSE 'RESEARCH'
    END AS route
  FROM raw
), classified AS (
  SELECT
    scored.*,
    CASE
      WHEN COALESCE("isArchived", 0) = 1 OR v2_total < 30 THEN 'RESEARCH'
      WHEN route = 'RESEARCH' THEN 'REVIEW'
      WHEN v2_total >= 70 THEN 'PRIORITY'
      ELSE 'OUTREACH'
    END AS qualification_band
  FROM scored
)
INSERT OR IGNORE INTO "QualificationSnapshot" (
  "id", "snapshotKey", "leadId", "policyVersion", "legacyScore", "totalScore",
  "websiteNeedScore", "businessFitScore", "reachabilityScore", "timingScore",
  "hardGateStatus", "band", "recommendedChannel", "autonomousEmailEligible",
  "reasonCodesJson", "evidenceJson", "sourceJobId", "createdAt"
)
SELECT
  'history:qualification:' || "id",
  "id" || ':axiom-revenue-v2:historical',
  "id",
  'axiom-revenue-v2',
  MIN(100, MAX(0, COALESCE("axiomScore", 0))),
  v2_total,
  website_need,
  business_fit,
  reachability,
  timing,
  CASE WHEN COALESCE("isArchived", 0) = 1 THEN 'DISQUALIFIED' ELSE 'PASS' END,
  qualification_band,
  route,
  CASE WHEN route = 'EMAIL' AND qualification_band IN ('OUTREACH', 'PRIORITY') THEN 1 ELSE 0 END,
  json_array('historical_migration', 'route_' || LOWER(route)),
  json_object('historical', 1, 'websiteStatus', "websiteStatus", 'emailReady', email_ready),
  "sourceJobId",
  "createdAt"
FROM classified;

INSERT OR IGNORE INTO "FunnelEvent" (
  "id", "dedupeKey", "eventType", "leadId", "scrapeJobId", "scrapeTargetId",
  "channel", "policyVersion", "score", "metadataJson", "occurredAt"
)
SELECT
  'history:qualified:' || q."leadId",
  'lead-qualified:' || q."leadId" || ':' || q."policyVersion",
  'LEAD_QUALIFIED',
  q."leadId",
  l."sourceJobId",
  l."sourceTargetId",
  q."recommendedChannel",
  q."policyVersion",
  q."totalScore",
  json_object('band', q."band", 'historical', 1),
  q."createdAt"
FROM "QualificationSnapshot" q
JOIN "Lead" l ON l."id" = q."leadId"
WHERE q."band" IN ('OUTREACH', 'PRIORITY');
