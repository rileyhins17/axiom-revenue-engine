-- Append-only proof that one separately owner-approved private KW source plan
-- and one deterministic website-evidence workflow were materialized together.
--
-- This migration is additive. It creates no command, schedule, route, provider
-- binding, migration authority, assessment authority, outreach, or send path.

CREATE TABLE "RevenuePrivateKwMaterializationReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "materializationVersion" TEXT NOT NULL,
  "sourceImportId" TEXT NOT NULL,
  "sourcePlanDigest" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "evaluationCandidateId" TEXT NOT NULL,
  "workflowRunId" TEXT NOT NULL,
  "workflowReceiptId" TEXT NOT NULL,
  "sourceRunCount" INTEGER NOT NULL,
  "businessCount" INTEGER NOT NULL,
  "locationCount" INTEGER NOT NULL,
  "sourceRecordCount" INTEGER NOT NULL,
  "workflowRecordCount" INTEGER NOT NULL,
  "materializationDigest" TEXT NOT NULL,
  "materializationJson" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "executionKind" TEXT NOT NULL,
  "transactionKind" TEXT NOT NULL,
  "localOnly" INTEGER NOT NULL,
  "localSourceMutationAuthorized" INTEGER NOT NULL,
  "localWorkflowMutationAuthorized" INTEGER NOT NULL,
  "localAssessmentMutationAuthorized" INTEGER NOT NULL,
  "schemaMutationAuthorized" INTEGER NOT NULL,
  "captureAuthorized" INTEGER NOT NULL,
  "contactDiscoveryAuthorized" INTEGER NOT NULL,
  "contactVerificationAuthorized" INTEGER NOT NULL,
  "outreachAuthorized" INTEGER NOT NULL,
  "sendAuthorized" INTEGER NOT NULL,
  "providerOperationsAuthorized" INTEGER NOT NULL,
  "costAuthorizedUsd" REAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length("sourcePlanDigest") = 64),
  CHECK (length("materializationDigest") = 64),
  CHECK (json_valid("materializationJson")),
  CHECK ("sourceRunCount" >= 1 AND "sourceRunCount" <= 9),
  CHECK ("businessCount" >= 1 AND "businessCount" <= 50),
  CHECK ("locationCount" = "businessCount"),
  CHECK ("sourceRecordCount" = "businessCount"),
  CHECK ("workflowRecordCount" = 6),
  CHECK ("executionKind" = 'IGNORED_LOCAL_SQLITE'),
  CHECK ("transactionKind" = 'BETTER_SQLITE3_IMMEDIATE'),
  CHECK ("localOnly" = 1),
  CHECK ("localSourceMutationAuthorized" = 1),
  CHECK ("localWorkflowMutationAuthorized" = 1),
  CHECK ("localAssessmentMutationAuthorized" = 0),
  CHECK ("schemaMutationAuthorized" = 0),
  CHECK ("captureAuthorized" = 0),
  CHECK ("contactDiscoveryAuthorized" = 0),
  CHECK ("contactVerificationAuthorized" = 0),
  CHECK ("outreachAuthorized" = 0),
  CHECK ("sendAuthorized" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("workflowReceiptId") REFERENCES "RevenueWorkflowReceiptRevision" ("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "RevenuePrivateKwMaterializationReceipt_source_workflow_key"
  ON "RevenuePrivateKwMaterializationReceipt" ("sourcePlanDigest", "workflowReceiptId");
CREATE UNIQUE INDEX "RevenuePrivateKwMaterializationReceipt_digest_key"
  ON "RevenuePrivateKwMaterializationReceipt" ("materializationDigest");
CREATE INDEX "RevenuePrivateKwMaterializationReceipt_business_recorded_idx"
  ON "RevenuePrivateKwMaterializationReceipt" ("businessId", "recordedAt");

CREATE TRIGGER "RevenuePrivateKwMaterializationReceipt_lineage_insert"
BEFORE INSERT ON "RevenuePrivateKwMaterializationReceipt"
WHEN NOT EXISTS (
  SELECT 1
  FROM "RevenueWorkflowReceiptRevision" receipt
  JOIN "RevenueWorkflowAttemptClosure" closure
    ON closure."attemptId" = receipt."attemptId"
   AND closure."terminalReceiptId" = receipt."id"
  JOIN "RevenueWorkflowRun" run
    ON run."id" = receipt."workflowRunId"
  WHERE receipt."id" = NEW."workflowReceiptId"
    AND receipt."workflowRunId" = NEW."workflowRunId"
    AND receipt."status" IN ('COMPLETED', 'PARTIAL')
    AND closure."status" = 'SEALED'
    AND run."businessId" = NEW."businessId"
    AND run."mode" = 'SHADOW'
    AND run."maxCostUsd" = 0
)
BEGIN
  SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_MATERIALIZATION_LINEAGE_MISMATCH');
END;

CREATE TRIGGER "RevenuePrivateKwMaterializationReceipt_immutable_update"
BEFORE UPDATE ON "RevenuePrivateKwMaterializationReceipt"
BEGIN
  SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_MATERIALIZATION_APPEND_ONLY');
END;

CREATE TRIGGER "RevenuePrivateKwMaterializationReceipt_immutable_delete"
BEFORE DELETE ON "RevenuePrivateKwMaterializationReceipt"
BEGIN
  SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_MATERIALIZATION_APPEND_ONLY');
END;
