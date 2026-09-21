-- Additive local M2 HTML evidence partitions and immutable lineage.
-- This migration grants no provider, remote, qualification, contact, outreach,
-- send, deployment, or cost authority.

ALTER TABLE "RevenueWebsiteSnapshot"
  ADD COLUMN "evidenceMode" TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK ("evidenceMode" IN ('LEGACY', 'M2_HTML_ONLY'));
ALTER TABLE "RevenueEvidenceClaim"
  ADD COLUMN "evidenceMode" TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK ("evidenceMode" IN ('LEGACY', 'M2_HTML_ONLY'));
ALTER TABLE "RevenueQualificationSnapshot"
  ADD COLUMN "evidenceMode" TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK ("evidenceMode" IN ('LEGACY', 'M2_HTML_ONLY'));
ALTER TABLE "RevenueContactPoint"
  ADD COLUMN "evidenceMode" TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK ("evidenceMode" IN ('LEGACY', 'M2_HTML_ONLY'));
ALTER TABLE "RevenueVerificationResult"
  ADD COLUMN "evidenceMode" TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK ("evidenceMode" IN ('LEGACY', 'M2_HTML_ONLY'));
ALTER TABLE "RevenueLeadAssessmentReceipt"
  ADD COLUMN "assessmentKind" TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK ("assessmentKind" IN ('LEGACY', 'WEBSITE_FIT_EVIDENCE'));
ALTER TABLE "RevenuePrivateKwContactInvocationReceipt"
  ADD COLUMN "assessmentKind" TEXT NOT NULL DEFAULT 'LEGACY'
  CHECK ("assessmentKind" IN ('LEGACY', 'WEBSITE_FIT_EVIDENCE'));

CREATE TABLE "RevenuePrivateKwM2HtmlAssessmentLineage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "lineageVersion" TEXT NOT NULL,
  "lineageDigest" TEXT NOT NULL,
  "lineageSeedDigest" TEXT NOT NULL,
  "assessmentKind" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "sourceMaterializationReceiptId" TEXT NOT NULL,
  "sourcePlanDigest" TEXT NOT NULL,
  "workflowReceiptId" TEXT NOT NULL,
  "htmlOperationId" TEXT NOT NULL,
  "htmlOperationDigest" TEXT NOT NULL,
  "mappingId" TEXT NOT NULL,
  "mappingDigest" TEXT NOT NULL,
  "websiteSnapshotId" TEXT NOT NULL,
  "qualificationSnapshotId" TEXT NOT NULL,
  "assessmentReceiptId" TEXT NOT NULL,
  "assessmentReceiptDigest" TEXT NOT NULL,
  "websiteProgressId" TEXT NOT NULL,
  "websiteProgressDigest" TEXT NOT NULL,
  "assessmentProgressId" TEXT NOT NULL,
  "assessmentProgressDigest" TEXT NOT NULL,
  "sourcePolicyDigest" TEXT NOT NULL,
  "transportChainDigest" TEXT NOT NULL,
  "pageSetDigest" TEXT NOT NULL,
  "htmlClassification" TEXT NOT NULL,
  "retentionDisposition" TEXT NOT NULL,
  "lineageJson" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "localOnly" INTEGER NOT NULL DEFAULT 1,
  "qualificationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "contactAuthorized" INTEGER NOT NULL DEFAULT 0,
  "consentAuthorized" INTEGER NOT NULL DEFAULT 0,
  "outreachAuthorized" INTEGER NOT NULL DEFAULT 0,
  "sendAuthorized" INTEGER NOT NULL DEFAULT 0,
  "browserAuthorized" INTEGER NOT NULL DEFAULT 0,
  "r2Authorized" INTEGER NOT NULL DEFAULT 0,
  "deploymentAuthorized" INTEGER NOT NULL DEFAULT 0,
  "providerOperationsAuthorized" INTEGER NOT NULL DEFAULT 0,
  "costAuthorizedUsd" REAL NOT NULL DEFAULT 0,
  CHECK ("lineageVersion" = 'kw-m2-html-lineage-v1'),
  CHECK ("id" = 'kw-m2-html-lineage:' || "lineageDigest"),
  CHECK (length("lineageDigest") = 64 AND "lineageDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("lineageSeedDigest") = 64 AND "lineageSeedDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("sourcePlanDigest") = 64 AND "sourcePlanDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("htmlOperationDigest") = 64 AND "htmlOperationDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("mappingDigest") = 64 AND "mappingDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("assessmentReceiptDigest") = 64 AND "assessmentReceiptDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("websiteProgressDigest") = 64 AND "websiteProgressDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("assessmentProgressDigest") = 64 AND "assessmentProgressDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("sourcePolicyDigest") = 64 AND "sourcePolicyDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("transportChainDigest") = 64 AND "transportChainDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("pageSetDigest") = 64 AND "pageSetDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("assessmentKind" = 'WEBSITE_FIT_EVIDENCE'),
  CHECK ("htmlClassification" = 'UNKNOWN'),
  CHECK ("retentionDisposition" IN ('RAW_HTML_ALLOWED', 'DERIVED_FACTS_ONLY', 'BLOCKED')),
  CHECK (json_valid("lineageJson") AND json_type("lineageJson") = 'object'),
  CHECK ("localOnly" = 1),
  CHECK ("qualificationAuthorized" = 0),
  CHECK ("contactAuthorized" = 0),
  CHECK ("consentAuthorized" = 0),
  CHECK ("outreachAuthorized" = 0),
  CHECK ("sendAuthorized" = 0),
  CHECK ("browserAuthorized" = 0),
  CHECK ("r2Authorized" = 0),
  CHECK ("deploymentAuthorized" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("sourceMaterializationReceiptId") REFERENCES "RevenuePrivateKwMaterializationReceipt" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("workflowReceiptId") REFERENCES "RevenueWorkflowReceiptRevision" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("websiteSnapshotId") REFERENCES "RevenueWebsiteSnapshot" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("qualificationSnapshotId") REFERENCES "RevenueQualificationSnapshot" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("assessmentReceiptId") REFERENCES "RevenueLeadAssessmentReceipt" ("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "RevenuePrivateKwM2HtmlAssessmentLineage_html_operation_key"
  ON "RevenuePrivateKwM2HtmlAssessmentLineage" ("htmlOperationId", "htmlOperationDigest");
CREATE UNIQUE INDEX "RevenuePrivateKwM2HtmlAssessmentLineage_assessment_key"
  ON "RevenuePrivateKwM2HtmlAssessmentLineage" ("assessmentReceiptId");
CREATE UNIQUE INDEX "RevenuePrivateKwM2HtmlAssessmentLineage_website_progress_key"
  ON "RevenuePrivateKwM2HtmlAssessmentLineage" ("websiteProgressId");
CREATE UNIQUE INDEX "RevenuePrivateKwM2HtmlAssessmentLineage_assessment_progress_key"
  ON "RevenuePrivateKwM2HtmlAssessmentLineage" ("assessmentProgressId");
CREATE UNIQUE INDEX "RevenuePrivateKwM2HtmlAssessmentLineage_digest_key"
  ON "RevenuePrivateKwM2HtmlAssessmentLineage" ("lineageDigest");

CREATE INDEX "RevenueWebsiteSnapshot_business_mode_captured_idx"
  ON "RevenueWebsiteSnapshot" ("businessId", "evidenceMode", "capturedAt", "id");
CREATE INDEX "RevenueEvidenceClaim_website_mode_idx"
  ON "RevenueEvidenceClaim" ("websiteSnapshotId", "evidenceMode", "id");
CREATE INDEX "RevenueQualificationSnapshot_business_mode_created_idx"
  ON "RevenueQualificationSnapshot" ("businessId", "evidenceMode", "createdAt", "id");
CREATE INDEX "RevenueLeadAssessmentReceipt_business_kind_recorded_idx"
  ON "RevenueLeadAssessmentReceipt" ("businessId", "assessmentKind", "recordedAt", "id");
CREATE INDEX "RevenueContactPoint_business_mode_source_idx"
  ON "RevenueContactPoint" ("businessId", "evidenceMode", "sourceCapturedAt", "id");
CREATE INDEX "RevenueVerificationResult_contact_mode_verified_idx"
  ON "RevenueVerificationResult" ("contactPointId", "evidenceMode", "verifiedAt", "id");

CREATE TRIGGER "RevenuePrivateKwM2HtmlAssessmentLineage_lineage_insert"
BEFORE INSERT ON "RevenuePrivateKwM2HtmlAssessmentLineage"
WHEN
  json_extract(NEW."lineageJson", '$.lineageVersion') IS NOT NEW."lineageVersion"
  OR json_extract(NEW."lineageJson", '$.lineageId') IS NOT NEW."id"
  OR json_extract(NEW."lineageJson", '$.lineageDigest') IS NOT NEW."lineageDigest"
  OR json_extract(NEW."lineageJson", '$.lineageSeedDigest') IS NOT NEW."lineageSeedDigest"
  OR json_extract(NEW."lineageJson", '$.assessmentKind') IS NOT NEW."assessmentKind"
  OR json_extract(NEW."lineageJson", '$.businessId') IS NOT NEW."businessId"
  OR json_extract(NEW."lineageJson", '$.sourceMaterializationReceiptId') IS NOT NEW."sourceMaterializationReceiptId"
  OR json_extract(NEW."lineageJson", '$.workflowReceiptId') IS NOT NEW."workflowReceiptId"
  OR json_extract(NEW."lineageJson", '$.htmlOperationId') IS NOT NEW."htmlOperationId"
  OR json_extract(NEW."lineageJson", '$.htmlOperationDigest') IS NOT NEW."htmlOperationDigest"
  OR json_extract(NEW."lineageJson", '$.mappingId') IS NOT NEW."mappingId"
  OR json_extract(NEW."lineageJson", '$.mappingDigest') IS NOT NEW."mappingDigest"
  OR json_extract(NEW."lineageJson", '$.websiteSnapshotId') IS NOT NEW."websiteSnapshotId"
  OR json_extract(NEW."lineageJson", '$.qualificationSnapshotId') IS NOT NEW."qualificationSnapshotId"
  OR json_extract(NEW."lineageJson", '$.assessmentReceiptId') IS NOT NEW."assessmentReceiptId"
  OR json_extract(NEW."lineageJson", '$.assessmentReceiptDigest') IS NOT NEW."assessmentReceiptDigest"
  OR json_extract(NEW."lineageJson", '$.websiteProgressId') IS NOT NEW."websiteProgressId"
  OR json_extract(NEW."lineageJson", '$.websiteProgressDigest') IS NOT NEW."websiteProgressDigest"
  OR json_extract(NEW."lineageJson", '$.assessmentProgressId') IS NOT NEW."assessmentProgressId"
  OR json_extract(NEW."lineageJson", '$.assessmentProgressDigest') IS NOT NEW."assessmentProgressDigest"
  OR json_extract(NEW."lineageJson", '$.sourcePolicyDigest') IS NOT NEW."sourcePolicyDigest"
  OR json_extract(NEW."lineageJson", '$.transportChainDigest') IS NOT NEW."transportChainDigest"
  OR json_extract(NEW."lineageJson", '$.pageSetDigest') IS NOT NEW."pageSetDigest"
  OR json_extract(NEW."lineageJson", '$.htmlClassification') IS NOT NEW."htmlClassification"
  OR json_extract(NEW."lineageJson", '$.retentionDisposition') IS NOT NEW."retentionDisposition"
  OR json_extract(NEW."lineageJson", '$.authority.localOnly') IS NOT 1
  OR json_extract(NEW."lineageJson", '$.authority.qualificationAuthorized') IS NOT 0
  OR json_extract(NEW."lineageJson", '$.authority.contactAuthorized') IS NOT 0
  OR json_extract(NEW."lineageJson", '$.authority.consentAuthorized') IS NOT 0
  OR json_extract(NEW."lineageJson", '$.authority.outreachAuthorized') IS NOT 0
  OR json_extract(NEW."lineageJson", '$.authority.sendAuthorized') IS NOT 0
  OR json_extract(NEW."lineageJson", '$.authority.browserAuthorized') IS NOT 0
  OR json_extract(NEW."lineageJson", '$.authority.r2Authorized') IS NOT 0
  OR json_extract(NEW."lineageJson", '$.authority.deploymentAuthorized') IS NOT 0
  OR json_extract(NEW."lineageJson", '$.authority.providerOperationsAuthorized') IS NOT 0
  OR json_extract(NEW."lineageJson", '$.authority.costAuthorizedUsd') IS NOT 0
  OR NOT EXISTS (SELECT 1 FROM "RevenueBusiness" WHERE "id" = NEW."businessId")
  OR NOT EXISTS (SELECT 1 FROM "RevenuePrivateKwMaterializationReceipt" WHERE "id" = NEW."sourceMaterializationReceiptId")
  OR NOT EXISTS (SELECT 1 FROM "RevenueWorkflowReceiptRevision" WHERE "id" = NEW."workflowReceiptId")
  OR NOT EXISTS (SELECT 1 FROM "RevenueWebsiteSnapshot" WHERE "id" = NEW."websiteSnapshotId" AND "businessId" = NEW."businessId" AND "evidenceMode" = 'M2_HTML_ONLY')
  OR NOT EXISTS (SELECT 1 FROM "RevenueQualificationSnapshot" WHERE "id" = NEW."qualificationSnapshotId" AND "businessId" = NEW."businessId" AND "evidenceMode" = 'M2_HTML_ONLY')
  OR NOT EXISTS (SELECT 1 FROM "RevenueLeadAssessmentReceipt" WHERE "id" = NEW."assessmentReceiptId" AND "businessId" = NEW."businessId" AND "assessmentKind" = 'WEBSITE_FIT_EVIDENCE')
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_M2_HTML_LINEAGE_MISMATCH'); END;

CREATE TRIGGER "RevenuePrivateKwM2HtmlAssessmentLineage_immutable_update"
BEFORE UPDATE ON "RevenuePrivateKwM2HtmlAssessmentLineage"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_M2_HTML_LINEAGE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenuePrivateKwM2HtmlAssessmentLineage_immutable_delete"
BEFORE DELETE ON "RevenuePrivateKwM2HtmlAssessmentLineage"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_M2_HTML_LINEAGE_APPEND_ONLY'); END;
