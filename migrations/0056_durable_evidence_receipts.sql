-- Durable, append-only receipts for the shadow website-evidence path.
--
-- This migration is additive. It creates no trigger, schedule, provider binding,
-- execution authority, or outreach path. Runtime mutation remains separately
-- release-gated; the current planner emits validation-only SQL artifacts.

CREATE TABLE "RevenueWorkflowRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowKind" TEXT NOT NULL,
  "workflowVersion" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "orchestratorKind" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "requestJson" TEXT NOT NULL,
  "maxCostUsd" REAL NOT NULL DEFAULT 0,
  "requestedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("mode" = 'SHADOW'),
  CHECK ("maxCostUsd" >= 0),
  CHECK (length("requestDigest") = 64),
  CHECK (json_valid("requestJson")),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RevenueWorkflowRun_kind_idempotency_key" ON "RevenueWorkflowRun" ("workflowKind", "idempotencyKey");
CREATE INDEX "RevenueWorkflowRun_business_requested_idx" ON "RevenueWorkflowRun" ("businessId", "requestedAt");

CREATE TABLE "RevenueWorkflowReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "sitePath" TEXT,
  "currentStep" TEXT,
  "receiptDigest" TEXT NOT NULL,
  "receiptJson" TEXT NOT NULL,
  "totalCostUsd" REAL NOT NULL DEFAULT 0,
  "completedAt" DATETIME NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("attemptNumber" >= 1),
  CHECK ("status" IN ('COMPLETED', 'PARTIAL', 'FAILED')),
  CHECK ("sitePath" IS NULL OR "sitePath" IN ('CAPTURED', 'UNREACHABLE')),
  CHECK ("totalCostUsd" >= 0),
  CHECK (length("receiptDigest") = 64),
  CHECK (json_valid("receiptJson")),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RevenueWorkflowReceipt_run_attempt_key" ON "RevenueWorkflowReceipt" ("workflowRunId", "attemptNumber");
CREATE UNIQUE INDEX "RevenueWorkflowReceipt_run_digest_key" ON "RevenueWorkflowReceipt" ("workflowRunId", "receiptDigest");
CREATE INDEX "RevenueWorkflowReceipt_run_completed_idx" ON "RevenueWorkflowReceipt" ("workflowRunId", "completedAt");

CREATE TABLE "RevenueWorkflowStepReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowReceiptId" TEXT NOT NULL,
  "stepOrdinal" INTEGER NOT NULL,
  "stepName" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "outputDigest" TEXT,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "warningCodesJson" TEXT NOT NULL DEFAULT '[]',
  "failureJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("stepOrdinal" >= 1 AND "stepOrdinal" <= 64),
  CHECK ("status" IN ('SUCCEEDED', 'PARTIAL', 'SKIPPED', 'FAILED')),
  CHECK ("attempts" >= 0),
  CHECK ("itemCount" >= 0),
  CHECK ("outputDigest" IS NULL OR length("outputDigest") = 64),
  CHECK (json_valid("warningCodesJson")),
  CHECK ("failureJson" IS NULL OR json_valid("failureJson")),
  FOREIGN KEY ("workflowReceiptId") REFERENCES "RevenueWorkflowReceipt" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RevenueWorkflowStepReceipt_receipt_ordinal_key" ON "RevenueWorkflowStepReceipt" ("workflowReceiptId", "stepOrdinal");
CREATE UNIQUE INDEX "RevenueWorkflowStepReceipt_receipt_name_key" ON "RevenueWorkflowStepReceipt" ("workflowReceiptId", "stepName");

CREATE TABLE "RevenueWebsitePageSelection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "selectionVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "discoveryComplete" INTEGER NOT NULL,
  "sourceCapturedAt" DATETIME NOT NULL,
  "plannedAt" DATETIME NOT NULL,
  "planDigest" TEXT NOT NULL,
  "planJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("status" IN ('READY', 'PARTIAL')),
  CHECK ("discoveryComplete" IN (0, 1)),
  CHECK (length("planDigest") = 64),
  CHECK (json_valid("planJson")),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RevenueWebsitePageSelection_workflow_key" ON "RevenueWebsitePageSelection" ("workflowRunId");
CREATE INDEX "RevenueWebsitePageSelection_business_planned_idx" ON "RevenueWebsitePageSelection" ("businessId", "plannedAt");

CREATE TABLE "RevenueWebsiteSelectedPage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "selectionId" TEXT NOT NULL,
  "pageKind" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "reasonCodesJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("pageKind" IN ('HOME', 'SERVICE', 'ABOUT', 'CONTACT')),
  CHECK ("score" >= 0 AND "score" <= 100),
  CHECK (json_valid("reasonCodesJson")),
  FOREIGN KEY ("selectionId") REFERENCES "RevenueWebsitePageSelection" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RevenueWebsiteSelectedPage_selection_kind_key" ON "RevenueWebsiteSelectedPage" ("selectionId", "pageKind");
CREATE UNIQUE INDEX "RevenueWebsiteSelectedPage_selection_url_key" ON "RevenueWebsiteSelectedPage" ("selectionId", "url");

CREATE TABLE "RevenueWebsitePageCandidate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "selectionId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "kindHint" TEXT NOT NULL,
  "serviceScore" INTEGER NOT NULL,
  "aboutScore" INTEGER NOT NULL,
  "contactScore" INTEGER NOT NULL,
  "eligibleKindsJson" TEXT NOT NULL DEFAULT '[]',
  "selectedAs" TEXT,
  "decision" TEXT NOT NULL,
  "reasonCodesJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("kindHint" IN ('HOME', 'SERVICE', 'ABOUT', 'CONTACT', 'OTHER')),
  CHECK ("serviceScore" >= 0 AND "serviceScore" <= 100),
  CHECK ("aboutScore" >= 0 AND "aboutScore" <= 100),
  CHECK ("contactScore" >= 0 AND "contactScore" <= 100),
  CHECK ("selectedAs" IS NULL OR "selectedAs" IN ('SERVICE', 'ABOUT', 'CONTACT')),
  CHECK ("decision" IN ('SELECTED', 'SKIPPED')),
  CHECK (json_valid("eligibleKindsJson")),
  CHECK (json_valid("reasonCodesJson")),
  FOREIGN KEY ("selectionId") REFERENCES "RevenueWebsitePageSelection" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RevenueWebsitePageCandidate_selection_url_key" ON "RevenueWebsitePageCandidate" ("selectionId", "url");

CREATE TABLE "RevenueWebsiteAuditAssembly" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "assemblyVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "pageSetComplete" INTEGER NOT NULL,
  "assemblyDigest" TEXT NOT NULL,
  "assemblyJson" TEXT NOT NULL,
  "assembledAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("status" IN ('READY', 'PARTIAL')),
  CHECK ("pageSetComplete" IN (0, 1)),
  CHECK (length("assemblyDigest") = 64),
  CHECK (json_valid("assemblyJson")),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RevenueWebsiteAuditAssembly_workflow_key" ON "RevenueWebsiteAuditAssembly" ("workflowRunId");

CREATE TABLE "RevenueArtifactManifest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "manifestVersion" TEXT NOT NULL,
  "retentionClass" TEXT NOT NULL,
  "provenanceReceiptType" TEXT NOT NULL,
  "provenanceReceiptId" TEXT NOT NULL,
  "verifiedAt" DATETIME NOT NULL,
  "manifestDigest" TEXT NOT NULL,
  "manifestJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("retentionClass" IN ('SHADOW_30D', 'QUALIFICATION_180D', 'OUTREACH_ACTIVE', 'LEGAL_HOLD')),
  CHECK ("provenanceReceiptType" IN ('ARTIFACT_WRITE', 'ARTIFACT_PROMOTION')),
  CHECK (length("manifestDigest") = 64),
  CHECK (json_valid("manifestJson")),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RevenueArtifactManifest_receipt_key" ON "RevenueArtifactManifest" ("provenanceReceiptType", "provenanceReceiptId");
CREATE INDEX "RevenueArtifactManifest_workflow_verified_idx" ON "RevenueArtifactManifest" ("workflowRunId", "verifiedAt");

CREATE TABLE "RevenueArtifactManifestItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "manifestId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "artifactRef" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "etag" TEXT NOT NULL,
  "uploadedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("kind" IN ('BROWSER_SCREENSHOT', 'BROWSER_MEASUREMENT')),
  CHECK ("byteLength" > 0),
  CHECK (length("sha256") = 64),
  FOREIGN KEY ("manifestId") REFERENCES "RevenueArtifactManifest" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "RevenueArtifactManifestItem_manifest_kind_key" ON "RevenueArtifactManifestItem" ("manifestId", "kind");
CREATE INDEX "RevenueArtifactManifestItem_artifact_ref_idx" ON "RevenueArtifactManifestItem" ("artifactRef");
CREATE INDEX "RevenueArtifactManifestItem_object_key_idx" ON "RevenueArtifactManifestItem" ("objectKey");

CREATE TABLE "RevenueArtifactEvidenceUse" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "useType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "recordVersion" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("useType" IN ('QUALIFICATION_SNAPSHOT', 'OUTREACH_APPROVAL', 'CONSENT_EVIDENCE', 'OUTREACH_TOUCH', 'LEGAL_HOLD')),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE
);
CREATE INDEX "RevenueArtifactEvidenceUse_business_recorded_idx" ON "RevenueArtifactEvidenceUse" ("businessId", "recordedAt");
CREATE INDEX "RevenueArtifactEvidenceUse_record_idx" ON "RevenueArtifactEvidenceUse" ("useType", "recordId");

CREATE TABLE "RevenueArtifactPromotionReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workflowRunId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "sourceManifestId" TEXT NOT NULL,
  "resultManifestId" TEXT,
  "contractVersion" TEXT NOT NULL,
  "sourceRetentionClass" TEXT NOT NULL,
  "targetRetentionClass" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "planDigest" TEXT NOT NULL,
  "receiptDigest" TEXT NOT NULL,
  "planJson" TEXT NOT NULL,
  "receiptJson" TEXT NOT NULL,
  "providerCopyPerformed" INTEGER NOT NULL DEFAULT 0,
  "costUsd" REAL NOT NULL DEFAULT 0,
  "completedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("sourceRetentionClass" IN ('SHADOW_30D', 'QUALIFICATION_180D', 'OUTREACH_ACTIVE', 'LEGAL_HOLD')),
  CHECK ("targetRetentionClass" IN ('SHADOW_30D', 'QUALIFICATION_180D', 'OUTREACH_ACTIVE', 'LEGAL_HOLD')),
  CHECK ("action" IN ('NO_COPY_REQUIRED', 'COPY_REQUIRED')),
  CHECK ("outcome" IN ('COMPLETED', 'FAILED')),
  CHECK (length("planDigest") = 64),
  CHECK (length("receiptDigest") = 64),
  CHECK (json_valid("planJson")),
  CHECK (json_valid("receiptJson")),
  CHECK ("providerCopyPerformed" IN (0, 1)),
  CHECK ("costUsd" >= 0),
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("sourceManifestId") REFERENCES "RevenueArtifactManifest" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("resultManifestId") REFERENCES "RevenueArtifactManifest" ("id") ON DELETE RESTRICT
);
CREATE INDEX "RevenueArtifactPromotionReceipt_workflow_completed_idx" ON "RevenueArtifactPromotionReceipt" ("workflowRunId", "completedAt");

CREATE TABLE "RevenueArtifactPromotionUse" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "promotionId" TEXT NOT NULL,
  "evidenceUseId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("promotionId") REFERENCES "RevenueArtifactPromotionReceipt" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("evidenceUseId") REFERENCES "RevenueArtifactEvidenceUse" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueArtifactPromotionUse_pair_key" ON "RevenueArtifactPromotionUse" ("promotionId", "evidenceUseId");

CREATE TABLE "RevenueArtifactManifestEvidenceUse" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "manifestId" TEXT NOT NULL,
  "evidenceUseId" TEXT NOT NULL,
  "viaPromotionId" TEXT NOT NULL,
  "linkedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("manifestId") REFERENCES "RevenueArtifactManifest" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("evidenceUseId") REFERENCES "RevenueArtifactEvidenceUse" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("viaPromotionId") REFERENCES "RevenueArtifactPromotionReceipt" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueArtifactManifestEvidenceUse_pair_key" ON "RevenueArtifactManifestEvidenceUse" ("manifestId", "evidenceUseId");

CREATE TABLE "RevenueArtifactReleaseRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "manifestId" TEXT NOT NULL,
  "contractVersion" TEXT NOT NULL,
  "retentionClass" TEXT NOT NULL,
  "manifestDigest" TEXT NOT NULL,
  "evidenceUseDigest" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "releaseApproved" INTEGER NOT NULL,
  "requiresFreshReferenceCheck" INTEGER NOT NULL,
  "requiresSeparateDeletionGate" INTEGER NOT NULL,
  "providerDeleteAuthorized" INTEGER NOT NULL,
  "providerDeletePerformed" INTEGER NOT NULL,
  "costUsd" REAL NOT NULL DEFAULT 0,
  "decisionDigest" TEXT NOT NULL,
  "recordJson" TEXT NOT NULL,
  "decidedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("retentionClass" IN ('OUTREACH_ACTIVE', 'LEGAL_HOLD')),
  CHECK ("actorRole" IN ('OWNER', 'COMPLIANCE')),
  CHECK ("decision" IN ('KEEP_PROTECTED', 'RELEASE_APPROVED')),
  CHECK ("releaseApproved" IN (0, 1)),
  CHECK ("requiresFreshReferenceCheck" = 1),
  CHECK ("requiresSeparateDeletionGate" = 1),
  CHECK ("providerDeleteAuthorized" = 0),
  CHECK ("providerDeletePerformed" = 0),
  CHECK ("costUsd" = 0),
  CHECK (length("manifestDigest") = 64),
  CHECK (length("evidenceUseDigest") = 64),
  CHECK (length("decisionDigest") = 64),
  CHECK (json_valid("recordJson")),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("manifestId") REFERENCES "RevenueArtifactManifest" ("id") ON DELETE RESTRICT
);
CREATE INDEX "RevenueArtifactReleaseRecord_manifest_decided_idx" ON "RevenueArtifactReleaseRecord" ("manifestId", "decidedAt");

CREATE TABLE "RevenueArtifactReleaseUse" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "releaseId" TEXT NOT NULL,
  "evidenceUseId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("releaseId") REFERENCES "RevenueArtifactReleaseRecord" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("evidenceUseId") REFERENCES "RevenueArtifactEvidenceUse" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueArtifactReleaseUse_pair_key" ON "RevenueArtifactReleaseUse" ("releaseId", "evidenceUseId");
