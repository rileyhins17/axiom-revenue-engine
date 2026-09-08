-- Append-only records required to reconstruct and validate a fenced resume.
--
-- This migration is additive. It creates no trigger, schedule, provider binding,
-- execution authority, or outreach path. Attempt and checkpoint state changes are
-- revisions so durable history is never overwritten. Runtime mutation remains a
-- separate release-gated milestone; the current planner emits SQL artifacts only.

CREATE TABLE "RevenueWorkflowDefinition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowKind" TEXT NOT NULL,
  "definitionVersion" TEXT NOT NULL,
  "definitionDigest" TEXT NOT NULL,
  "definitionJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("workflowKind" = 'WEBSITE_EVIDENCE'),
  CHECK ("id" = "definitionDigest"),
  CHECK (length("definitionDigest") = 64),
  CHECK (json_valid("definitionJson"))
);
CREATE UNIQUE INDEX "RevenueWorkflowDefinition_kind_version_key" ON "RevenueWorkflowDefinition" ("workflowKind", "definitionVersion");

CREATE TABLE "RevenueWorkflowDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "deliveryVersion" TEXT NOT NULL,
  "workflowVersion" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "deliveryDigest" TEXT NOT NULL,
  "deliveryJson" TEXT NOT NULL,
  "receivedAt" DATETIME NOT NULL,
  "mode" TEXT NOT NULL,
  "deliveryKind" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("mode" = 'SHADOW'),
  CHECK ("deliveryKind" = 'FIXTURE'),
  CHECK (length("requestDigest") = 64),
  CHECK (length("payloadDigest") = 64),
  CHECK (length("deliveryDigest") = 64),
  CHECK ("payloadDigest" = "requestDigest"),
  CHECK (json_valid("deliveryJson")),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("definitionId") REFERENCES "RevenueWorkflowDefinition" ("id") ON DELETE RESTRICT
);
CREATE INDEX "RevenueWorkflowDelivery_run_received_idx" ON "RevenueWorkflowDelivery" ("workflowRunId", "receivedAt");

CREATE TABLE "RevenueWorkflowAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "attemptVersion" TEXT NOT NULL,
  "workflowVersion" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "fencingToken" INTEGER NOT NULL,
  "startedAt" DATETIME NOT NULL,
  "attemptDigest" TEXT NOT NULL,
  "attemptJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("attemptNumber" >= 1 AND "attemptNumber" <= 10000),
  CHECK ("fencingToken" >= 1 AND "fencingToken" <= 2147483647),
  CHECK (length("requestDigest") = 64),
  CHECK (length("attemptDigest") = 64),
  CHECK (json_valid("attemptJson")),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("definitionId") REFERENCES "RevenueWorkflowDefinition" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("deliveryId") REFERENCES "RevenueWorkflowDelivery" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueWorkflowAttempt_run_number_key" ON "RevenueWorkflowAttempt" ("workflowRunId", "attemptNumber");
CREATE UNIQUE INDEX "RevenueWorkflowAttempt_run_fence_key" ON "RevenueWorkflowAttempt" ("workflowRunId", "fencingToken");

CREATE TABLE "RevenueWorkflowLease" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "leaseVersion" TEXT NOT NULL,
  "workflowVersion" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "ownerId" TEXT NOT NULL,
  "fencingToken" INTEGER NOT NULL,
  "acquiredAt" DATETIME NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "mode" TEXT NOT NULL,
  "leaseKind" TEXT NOT NULL,
  "leaseDigest" TEXT NOT NULL,
  "leaseJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("mode" = 'SHADOW'),
  CHECK ("leaseKind" = 'FIXTURE'),
  CHECK ("attemptNumber" >= 1 AND "attemptNumber" <= 10000),
  CHECK ("fencingToken" >= 1 AND "fencingToken" <= 2147483647),
  CHECK (julianday("expiresAt") > julianday("acquiredAt")),
  CHECK (length("requestDigest") = 64),
  CHECK (length("leaseDigest") = 64),
  CHECK (json_valid("leaseJson")),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("definitionId") REFERENCES "RevenueWorkflowDefinition" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("attemptId") REFERENCES "RevenueWorkflowAttempt" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("deliveryId") REFERENCES "RevenueWorkflowDelivery" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueWorkflowLease_attempt_key" ON "RevenueWorkflowLease" ("attemptId");
CREATE UNIQUE INDEX "RevenueWorkflowLease_run_fence_key" ON "RevenueWorkflowLease" ("workflowRunId", "fencingToken");

CREATE TABLE "RevenueWorkflowReceiptRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "revisionVersion" TEXT NOT NULL,
  "workflowVersion" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "receiptDigest" TEXT NOT NULL,
  "receiptJson" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("attemptNumber" >= 1 AND "attemptNumber" <= 10000),
  CHECK ("status" IN ('COMPLETED', 'PARTIAL', 'FAILED')),
  CHECK (length("requestDigest") = 64),
  CHECK (length("receiptDigest") = 64),
  CHECK (json_valid("receiptJson")),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("definitionId") REFERENCES "RevenueWorkflowDefinition" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("attemptId") REFERENCES "RevenueWorkflowAttempt" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueWorkflowReceiptRevision_attempt_key" ON "RevenueWorkflowReceiptRevision" ("attemptId");
CREATE UNIQUE INDEX "RevenueWorkflowReceiptRevision_run_digest_key" ON "RevenueWorkflowReceiptRevision" ("workflowRunId", "receiptDigest");
CREATE INDEX "RevenueWorkflowReceiptRevision_run_recorded_idx" ON "RevenueWorkflowReceiptRevision" ("workflowRunId", "recordedAt");

CREATE TABLE "RevenueWorkflowAttemptClosure" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "endedAt" DATETIME NOT NULL,
  "terminalReceiptId" TEXT,
  "closureDigest" TEXT NOT NULL,
  "closureJson" TEXT NOT NULL,
  "effectiveAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("status" IN ('FAILED', 'SEALED', 'ABANDONED')),
  CHECK (("status" = 'SEALED' AND "terminalReceiptId" IS NOT NULL) OR ("status" <> 'SEALED' AND "terminalReceiptId" IS NULL)),
  CHECK (length("closureDigest") = 64),
  CHECK (json_valid("closureJson")),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("attemptId") REFERENCES "RevenueWorkflowAttempt" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("terminalReceiptId") REFERENCES "RevenueWorkflowReceiptRevision" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueWorkflowAttemptClosure_attempt_key" ON "RevenueWorkflowAttemptClosure" ("attemptId");

CREATE TABLE "RevenueWorkflowCheckpointPayload" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "checkpointId" TEXT NOT NULL,
  "checkpointVersion" TEXT NOT NULL,
  "payloadRef" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "payloadByteLength" INTEGER NOT NULL,
  "payloadEncoding" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("id" = "payloadDigest"),
  CHECK (length("payloadDigest") = 64),
  CHECK ("payloadByteLength" > 0 AND "payloadByteLength" <= 8388608),
  CHECK ("payloadEncoding" = 'CANONICAL_JSON_V1'),
  CHECK ("payloadRef" = 'fixture-checkpoint:sha256:' || "payloadDigest"),
  CHECK (json_valid("payloadJson"))
);
CREATE UNIQUE INDEX "RevenueWorkflowCheckpointPayload_checkpoint_key" ON "RevenueWorkflowCheckpointPayload" ("checkpointId");
CREATE UNIQUE INDEX "RevenueWorkflowCheckpointPayload_ref_key" ON "RevenueWorkflowCheckpointPayload" ("payloadRef");

CREATE TABLE "RevenueWorkflowCheckpoint" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "payloadId" TEXT NOT NULL,
  "checkpointVersion" TEXT NOT NULL,
  "workflowVersion" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "fencingToken" INTEGER NOT NULL,
  "step" TEXT NOT NULL,
  "stepOrdinal" INTEGER NOT NULL,
  "sitePath" TEXT NOT NULL,
  "outputDigest" TEXT NOT NULL,
  "locatorVersion" TEXT NOT NULL,
  "locatorKind" TEXT NOT NULL,
  "completedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("attemptNumber" >= 1 AND "attemptNumber" <= 10000),
  CHECK ("fencingToken" >= 1 AND "fencingToken" <= 2147483647),
  CHECK ("stepOrdinal" >= 1 AND "stepOrdinal" <= 100),
  CHECK ("step" IN ('CAPTURE_HOME', 'EXTRACT_HOME', 'SELECT_PAGES', 'CAPTURE_SUBPAGES', 'MEASURE_BROWSER', 'STORE_ARTIFACTS', 'ASSEMBLE_AUDIT', 'RUN_AUDIT')),
  CHECK (("step" = 'CAPTURE_HOME' AND "stepOrdinal" = 1)
    OR ("step" = 'EXTRACT_HOME' AND "stepOrdinal" = 2)
    OR ("step" = 'SELECT_PAGES' AND "stepOrdinal" = 3)
    OR ("step" = 'CAPTURE_SUBPAGES' AND "stepOrdinal" = 4)
    OR ("step" = 'MEASURE_BROWSER' AND "stepOrdinal" = 5)
    OR ("step" = 'STORE_ARTIFACTS' AND "stepOrdinal" = 6)
    OR ("step" = 'ASSEMBLE_AUDIT' AND "stepOrdinal" = 7)
    OR ("step" = 'RUN_AUDIT' AND "stepOrdinal" = 8)),
  CHECK ("sitePath" IN ('CAPTURED', 'UNREACHABLE')),
  CHECK ("locatorKind" = 'FIXTURE_CONTENT_ADDRESS'),
  CHECK (length("requestDigest") = 64),
  CHECK (length("outputDigest") = 64),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("definitionId") REFERENCES "RevenueWorkflowDefinition" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("attemptId") REFERENCES "RevenueWorkflowAttempt" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("leaseId") REFERENCES "RevenueWorkflowLease" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("payloadId") REFERENCES "RevenueWorkflowCheckpointPayload" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueWorkflowCheckpoint_attempt_step_key" ON "RevenueWorkflowCheckpoint" ("attemptId", "step");
CREATE UNIQUE INDEX "RevenueWorkflowCheckpoint_attempt_ordinal_key" ON "RevenueWorkflowCheckpoint" ("attemptId", "stepOrdinal");
CREATE INDEX "RevenueWorkflowCheckpoint_run_ordinal_idx" ON "RevenueWorkflowCheckpoint" ("workflowRunId", "stepOrdinal");

CREATE TABLE "RevenueWorkflowCheckpointStateReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "checkpointId" TEXT NOT NULL,
  "commitState" TEXT NOT NULL,
  "recordDigest" TEXT NOT NULL,
  "recordJson" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("commitState" IN ('PREPARED', 'COMMITTED')),
  CHECK (length("recordDigest") = 64),
  CHECK (json_valid("recordJson")),
  FOREIGN KEY ("checkpointId") REFERENCES "RevenueWorkflowCheckpoint" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueWorkflowCheckpointStateReceipt_checkpoint_state_key" ON "RevenueWorkflowCheckpointStateReceipt" ("checkpointId", "commitState");
CREATE INDEX "RevenueWorkflowCheckpointStateReceipt_checkpoint_recorded_idx" ON "RevenueWorkflowCheckpointStateReceipt" ("checkpointId", "recordedAt");

CREATE TABLE "RevenueWorkflowCheckpointDependency" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "checkpointId" TEXT NOT NULL,
  "dependencyCheckpointId" TEXT NOT NULL,
  "dependencyPayloadId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("checkpointId" <> "dependencyCheckpointId"),
  FOREIGN KEY ("checkpointId") REFERENCES "RevenueWorkflowCheckpoint" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("dependencyCheckpointId") REFERENCES "RevenueWorkflowCheckpoint" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("dependencyPayloadId") REFERENCES "RevenueWorkflowCheckpointPayload" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueWorkflowCheckpointDependency_pair_key" ON "RevenueWorkflowCheckpointDependency" ("checkpointId", "dependencyCheckpointId");

CREATE TABLE "RevenueArtifactRecoveryPlan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "recoveryVersion" TEXT NOT NULL,
  "workflowVersion" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "pageKind" TEXT NOT NULL,
  "profile" TEXT NOT NULL,
  "planDigest" TEXT NOT NULL,
  "payloadEncoding" TEXT NOT NULL,
  "planJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("pageKind" IN ('HOME', 'SERVICE', 'ABOUT', 'CONTACT')),
  CHECK ("profile" IN ('DESKTOP_1440X900', 'MOBILE_390X844')),
  CHECK ("payloadEncoding" = 'CANONICAL_JSON_WITH_BASE64_BYTES_V1'),
  CHECK (length("requestDigest") = 64),
  CHECK (length("planDigest") = 64),
  CHECK (json_valid("planJson")),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("definitionId") REFERENCES "RevenueWorkflowDefinition" ("id") ON DELETE RESTRICT
);

CREATE TABLE "RevenueArtifactRecoveryReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "workflowRunId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "fencingToken" INTEGER NOT NULL,
  "receiptDigest" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "failureCode" TEXT,
  "receiptJson" TEXT NOT NULL,
  "providerWritePerformed" INTEGER NOT NULL,
  "costUsd" REAL NOT NULL,
  "rollbackAction" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("attemptNumber" >= 1 AND "attemptNumber" <= 10000),
  CHECK ("fencingToken" >= 1 AND "fencingToken" <= 2147483647),
  CHECK ("outcome" IN ('COMPLETED', 'FAILED')),
  CHECK (("outcome" = 'COMPLETED' AND "failureCode" IS NULL) OR ("outcome" = 'FAILED' AND "failureCode" IS NOT NULL)),
  CHECK ("failureCode" IS NULL OR "failureCode" IN ('STORE_ERROR', 'INVALID_RECEIPT', 'EXISTING_OBJECT_MISMATCH')),
  CHECK (length("receiptDigest") = 64),
  CHECK (json_valid("receiptJson")),
  CHECK ("providerWritePerformed" = 0),
  CHECK ("costUsd" = 0),
  CHECK ("rollbackAction" = 'NONE_KEEP_CONTENT_ADDRESSED_ORPHANS'),
  FOREIGN KEY ("planId") REFERENCES "RevenueArtifactRecoveryPlan" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("attemptId") REFERENCES "RevenueWorkflowAttempt" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("leaseId") REFERENCES "RevenueWorkflowLease" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueArtifactRecoveryReceipt_attempt_plan_digest_key" ON "RevenueArtifactRecoveryReceipt" ("attemptId", "planId", "receiptDigest");
CREATE INDEX "RevenueArtifactRecoveryReceipt_run_recorded_idx" ON "RevenueArtifactRecoveryReceipt" ("workflowRunId", "recordedAt");
