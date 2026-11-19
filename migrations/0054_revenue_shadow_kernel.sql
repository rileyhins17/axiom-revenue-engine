-- Evidence and qualification shadow kernel.
-- These tables are additive and cannot authorize outreach. They let the new
-- Revenue Engine compare decisions against legacy data before cutover.

CREATE TABLE "RevenueBusiness" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "canonicalName" TEXT NOT NULL,
  "normalizedDomain" TEXT,
  "normalizedPhone" TEXT,
  "independenceStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RevenueBusiness_normalizedDomain_key" ON "RevenueBusiness" ("normalizedDomain") WHERE "normalizedDomain" IS NOT NULL;
CREATE INDEX "RevenueBusiness_normalizedPhone_idx" ON "RevenueBusiness" ("normalizedPhone");

CREATE TABLE "RevenueLocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "addressLine" TEXT,
  "city" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "postalCode" TEXT,
  "geoCell" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE
);
CREATE INDEX "RevenueLocation_businessId_idx" ON "RevenueLocation" ("businessId");
CREATE INDEX "RevenueLocation_country_region_city_idx" ON "RevenueLocation" ("country", "region", "city");

CREATE TABLE "RevenueSourceRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "adapter" TEXT NOT NULL,
  "niche" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "geoCell" TEXT,
  "queryText" TEXT NOT NULL,
  "filtersJson" TEXT NOT NULL DEFAULT '{}',
  "cursor" TEXT,
  "status" TEXT NOT NULL,
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "qualifiedCount" INTEGER NOT NULL DEFAULT 0,
  "costUsd" REAL NOT NULL DEFAULT 0,
  "startedAt" DATETIME NOT NULL,
  "completedAt" DATETIME,
  "cooldownUntil" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RevenueSourceRun_coverage_idx" ON "RevenueSourceRun" ("adapter", "country", "region", "city", "niche", "geoCell", "completedAt");

CREATE TABLE "RevenueSourceRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceRunId" TEXT NOT NULL,
  "sourceOwnedId" TEXT NOT NULL,
  "businessId" TEXT,
  "rawPayloadJson" TEXT NOT NULL,
  "identitySignalsJson" TEXT NOT NULL DEFAULT '{}',
  "capturedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("sourceRunId") REFERENCES "RevenueSourceRun" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "RevenueSourceRecord_source_identity_key" ON "RevenueSourceRecord" ("sourceRunId", "sourceOwnedId");
CREATE INDEX "RevenueSourceRecord_businessId_idx" ON "RevenueSourceRecord" ("businessId");

CREATE TABLE "RevenueWebsiteSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "finalUrl" TEXT,
  "classification" TEXT NOT NULL,
  "auditVersion" TEXT NOT NULL,
  "desktopArtifactRef" TEXT,
  "mobileArtifactRef" TEXT,
  "domArtifactRef" TEXT,
  "deterministicChecksJson" TEXT NOT NULL DEFAULT '{}',
  "capturedAt" DATETIME NOT NULL,
  "refreshAfter" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE
);
CREATE INDEX "RevenueWebsiteSnapshot_business_captured_idx" ON "RevenueWebsiteSnapshot" ("businessId", "capturedAt");

CREATE TABLE "RevenueEvidenceClaim" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "websiteSnapshotId" TEXT,
  "category" TEXT NOT NULL,
  "observation" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "artifactRef" TEXT,
  "method" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL,
  "conversionCritical" INTEGER NOT NULL DEFAULT 0,
  "auditVersion" TEXT NOT NULL,
  "capturedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("confidence" >= 0 AND "confidence" <= 100),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("websiteSnapshotId") REFERENCES "RevenueWebsiteSnapshot" ("id") ON DELETE SET NULL
);
CREATE INDEX "RevenueEvidenceClaim_business_captured_idx" ON "RevenueEvidenceClaim" ("businessId", "capturedAt");
CREATE INDEX "RevenueEvidenceClaim_snapshot_idx" ON "RevenueEvidenceClaim" ("websiteSnapshotId");

CREATE TABLE "RevenueContactPoint" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "label" TEXT,
  "personName" TEXT,
  "role" TEXT,
  "sourceUrl" TEXT,
  "sourceCapturedAt" DATETIME,
  "automationPermitted" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE
);
CREATE INDEX "RevenueContactPoint_business_channel_idx" ON "RevenueContactPoint" ("businessId", "channel", "status");
CREATE INDEX "RevenueContactPoint_value_idx" ON "RevenueContactPoint" ("value");

CREATE TABLE "RevenueVerificationResult" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "contactPointId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "catchAll" INTEGER,
  "staleAfter" DATETIME,
  "detailsJson" TEXT NOT NULL DEFAULT '{}',
  "verifiedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("contactPointId") REFERENCES "RevenueContactPoint" ("id") ON DELETE CASCADE
);
CREATE INDEX "RevenueVerificationResult_contact_verified_idx" ON "RevenueVerificationResult" ("contactPointId", "verifiedAt");

CREATE TABLE "RevenueQualificationSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "snapshotKey" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "shadowOnly" INTEGER NOT NULL DEFAULT 1,
  "totalScore" INTEGER NOT NULL,
  "rebuildNeedScore" INTEGER NOT NULL,
  "businessFitScore" INTEGER NOT NULL,
  "reachabilityScore" INTEGER NOT NULL,
  "timingScore" INTEGER NOT NULL,
  "evidenceConfidenceScore" INTEGER NOT NULL,
  "band" TEXT NOT NULL,
  "recommendedChannel" TEXT NOT NULL,
  "supportedObservationCount" INTEGER NOT NULL,
  "conversionCriticalCount" INTEGER NOT NULL,
  "failedGatesJson" TEXT NOT NULL DEFAULT '[]',
  "evidenceClaimIdsJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RevenueQualificationSnapshot_snapshotKey_key" ON "RevenueQualificationSnapshot" ("snapshotKey");
CREATE INDEX "RevenueQualificationSnapshot_business_created_idx" ON "RevenueQualificationSnapshot" ("businessId", "createdAt");
CREATE INDEX "RevenueQualificationSnapshot_policy_band_score_idx" ON "RevenueQualificationSnapshot" ("policyVersion", "band", "totalScore");

CREATE TABLE "RevenueCostLedger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "businessId" TEXT,
  "sourceRunId" TEXT,
  "workflowRunId" TEXT,
  "model" TEXT,
  "inputUnits" INTEGER NOT NULL DEFAULT 0,
  "outputUnits" INTEGER NOT NULL DEFAULT 0,
  "costUsd" REAL NOT NULL DEFAULT 0,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "incurredAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("sourceRunId") REFERENCES "RevenueSourceRun" ("id") ON DELETE SET NULL
);
CREATE INDEX "RevenueCostLedger_incurred_provider_idx" ON "RevenueCostLedger" ("incurredAt", "provider");
CREATE INDEX "RevenueCostLedger_business_idx" ON "RevenueCostLedger" ("businessId");
