-- Atomic, append-only receipts for shadow website-audit and qualification writes.
--
-- This migration creates no schedule, route, provider binding, outreach path, or
-- production authority. The private executor remains disconnected from both
-- Workers. A receipt can only point at an existing sealed workflow revision,
-- website snapshot, and qualification snapshot.

CREATE TABLE "RevenueLeadAssessmentReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assessmentVersion" TEXT NOT NULL,
  "assessmentKey" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "workflowReceiptId" TEXT NOT NULL,
  "websiteSnapshotId" TEXT NOT NULL,
  "qualificationSnapshotId" TEXT NOT NULL,
  "auditDigest" TEXT NOT NULL,
  "qualificationDigest" TEXT NOT NULL,
  "basisDigest" TEXT NOT NULL,
  "evidenceClaimCount" INTEGER NOT NULL,
  "assessmentDigest" TEXT NOT NULL,
  "assessmentJson" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "mode" TEXT NOT NULL,
  "transactionKind" TEXT NOT NULL,
  "outreachAuthorized" INTEGER NOT NULL DEFAULT 0,
  "sendAuthorized" INTEGER NOT NULL DEFAULT 0,
  "providerOperationsAuthorized" INTEGER NOT NULL DEFAULT 0,
  "costAuthorizedUsd" REAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("mode" = 'SHADOW'),
  CHECK ("transactionKind" = 'D1_BATCH'),
  CHECK (length("auditDigest") = 64),
  CHECK (length("qualificationDigest") = 64),
  CHECK (length("basisDigest") = 64),
  CHECK (length("assessmentDigest") = 64),
  CHECK ("evidenceClaimCount" >= 0 AND "evidenceClaimCount" <= 100),
  CHECK (json_valid("assessmentJson")),
  CHECK ("outreachAuthorized" = 0),
  CHECK ("sendAuthorized" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("workflowReceiptId") REFERENCES "RevenueWorkflowReceiptRevision" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("websiteSnapshotId") REFERENCES "RevenueWebsiteSnapshot" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("qualificationSnapshotId") REFERENCES "RevenueQualificationSnapshot" ("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "RevenueLeadAssessmentReceipt_assessment_key"
  ON "RevenueLeadAssessmentReceipt" ("assessmentKey");
CREATE UNIQUE INDEX "RevenueLeadAssessmentReceipt_qualification_key"
  ON "RevenueLeadAssessmentReceipt" ("qualificationSnapshotId");
CREATE INDEX "RevenueLeadAssessmentReceipt_business_recorded_idx"
  ON "RevenueLeadAssessmentReceipt" ("businessId", "recordedAt");
CREATE INDEX "RevenueLeadAssessmentReceipt_workflow_receipt_idx"
  ON "RevenueLeadAssessmentReceipt" ("workflowReceiptId");

CREATE TRIGGER "RevenueWebsiteSnapshot_assessment_immutable_update"
BEFORE UPDATE ON "RevenueWebsiteSnapshot"
BEGIN SELECT RAISE(ABORT, 'REVENUE_LEAD_ASSESSMENT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWebsiteSnapshot_assessment_immutable_delete"
BEFORE DELETE ON "RevenueWebsiteSnapshot"
BEGIN SELECT RAISE(ABORT, 'REVENUE_LEAD_ASSESSMENT_APPEND_ONLY'); END;

CREATE TRIGGER "RevenueEvidenceClaim_assessment_immutable_update"
BEFORE UPDATE ON "RevenueEvidenceClaim"
BEGIN SELECT RAISE(ABORT, 'REVENUE_LEAD_ASSESSMENT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueEvidenceClaim_assessment_immutable_delete"
BEFORE DELETE ON "RevenueEvidenceClaim"
BEGIN SELECT RAISE(ABORT, 'REVENUE_LEAD_ASSESSMENT_APPEND_ONLY'); END;

CREATE TRIGGER "RevenueQualificationSnapshot_assessment_immutable_update"
BEFORE UPDATE ON "RevenueQualificationSnapshot"
BEGIN SELECT RAISE(ABORT, 'REVENUE_LEAD_ASSESSMENT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueQualificationSnapshot_assessment_immutable_delete"
BEFORE DELETE ON "RevenueQualificationSnapshot"
BEGIN SELECT RAISE(ABORT, 'REVENUE_LEAD_ASSESSMENT_APPEND_ONLY'); END;

CREATE TRIGGER "RevenueLeadAssessmentReceipt_immutable_update"
BEFORE UPDATE ON "RevenueLeadAssessmentReceipt"
BEGIN SELECT RAISE(ABORT, 'REVENUE_LEAD_ASSESSMENT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueLeadAssessmentReceipt_immutable_delete"
BEFORE DELETE ON "RevenueLeadAssessmentReceipt"
BEGIN SELECT RAISE(ABORT, 'REVENUE_LEAD_ASSESSMENT_APPEND_ONLY'); END;
