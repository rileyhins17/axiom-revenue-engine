-- Persist one exact current-website-evidence eligibility receipt after its
-- in-process D1/R2 trust boundary has succeeded.
--
-- This migration is additive and grants no Browser, R2, source, workflow,
-- phase, qualification, outreach, send, deployment, provider, or cost
-- authority. The row is durable history; freshness must be checked again from
-- the database clock every time it is loaded.

CREATE TABLE "RevenueCurrentWebsiteEvidenceEligibilityReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eligibilityVersion" TEXT NOT NULL,
  "receiptKind" TEXT NOT NULL,
  "receiptDigest" TEXT NOT NULL,
  "manifestId" TEXT NOT NULL,
  "manifestDigest" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "evaluationCandidateId" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "websiteEvidenceProofId" TEXT NOT NULL,
  "websiteEvidenceProofDigest" TEXT NOT NULL,
  "workflowRunId" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "workflowReceiptId" TEXT NOT NULL,
  "workflowReceiptDigest" TEXT NOT NULL,
  "auditDigest" TEXT NOT NULL,
  "artifactSetDigest" TEXT NOT NULL,
  "workflowForestDigest" TEXT NOT NULL,
  "artifactCount" INTEGER NOT NULL,
  "artifactsDigest" TEXT NOT NULL,
  "evidenceFreshThrough" DATETIME NOT NULL,
  "evaluatedAt" DATETIME NOT NULL,
  "receiptJson" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "transactionKind" TEXT NOT NULL,
  "validationOnly" INTEGER NOT NULL DEFAULT 1,
  "exactTrustedExecutionInstancesRequired" INTEGER NOT NULL DEFAULT 1,
  "phaseInputCreationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "progressReceiptCreationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "phaseAdvancementAuthorized" INTEGER NOT NULL DEFAULT 0,
  "browserCaptureAuthorized" INTEGER NOT NULL DEFAULT 0,
  "artifactStorageAuthorized" INTEGER NOT NULL DEFAULT 0,
  "r2ReadAuthorized" INTEGER NOT NULL DEFAULT 0,
  "contactDiscoveryAuthorized" INTEGER NOT NULL DEFAULT 0,
  "qualificationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "outreachAuthorized" INTEGER NOT NULL DEFAULT 0,
  "sendAuthorized" INTEGER NOT NULL DEFAULT 0,
  "deploymentAuthorized" INTEGER NOT NULL DEFAULT 0,
  "providerOperationsAuthorized" INTEGER NOT NULL DEFAULT 0,
  "costAuthorizedUsd" REAL NOT NULL DEFAULT 0,
  CHECK ("eligibilityVersion" = 'kw-current-website-evidence-eligibility-v1'),
  CHECK ("receiptKind" = 'CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY'),
  CHECK ("id" GLOB 'website-evidence-eligibility:[0-9a-f]*' AND length("id") = 93),
  CHECK ("id" = 'website-evidence-eligibility:' || "receiptDigest"),
  CHECK (length("receiptDigest") = 64 AND "receiptDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("manifestId" GLOB 'kw-shadow-slice:[0-9a-f]*' AND length("manifestId") = 80),
  CHECK (length("manifestDigest") = 64 AND "manifestDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("websiteEvidenceProofId" GLOB 'website-evidence:[0-9a-f]*' AND length("websiteEvidenceProofId") = 81),
  CHECK ("websiteEvidenceProofId" = 'website-evidence:' || "websiteEvidenceProofDigest"),
  CHECK (length("websiteEvidenceProofDigest") = 64 AND "websiteEvidenceProofDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("requestDigest") = 64 AND "requestDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("workflowReceiptDigest") = 64 AND "workflowReceiptDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("auditDigest") = 64 AND "auditDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("artifactSetDigest") = 64 AND "artifactSetDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("workflowForestDigest") = 64 AND "workflowForestDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("artifactsDigest") = 64 AND "artifactsDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("artifactCount" >= 2 AND "artifactCount" <= 5),
  CHECK (julianday("evidenceFreshThrough") > julianday("evaluatedAt")),
  CHECK (julianday("recordedAt") >= julianday("evaluatedAt")),
  CHECK (json_valid("receiptJson") AND json_type("receiptJson") = 'object'),
  CHECK ("transactionKind" = 'D1_BATCH'),
  CHECK ("validationOnly" = 1),
  CHECK ("exactTrustedExecutionInstancesRequired" = 1),
  CHECK ("phaseInputCreationAuthorized" = 0),
  CHECK ("progressReceiptCreationAuthorized" = 0),
  CHECK ("phaseAdvancementAuthorized" = 0),
  CHECK ("browserCaptureAuthorized" = 0),
  CHECK ("artifactStorageAuthorized" = 0),
  CHECK ("r2ReadAuthorized" = 0),
  CHECK ("contactDiscoveryAuthorized" = 0),
  CHECK ("qualificationAuthorized" = 0),
  CHECK ("outreachAuthorized" = 0),
  CHECK ("sendAuthorized" = 0),
  CHECK ("deploymentAuthorized" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("workflowRunId") REFERENCES "RevenueWorkflowRun" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("workflowReceiptId") REFERENCES "RevenueWorkflowReceiptRevision" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueCurrentWebsiteEvidenceEligibilityReceipt_digest_key"
  ON "RevenueCurrentWebsiteEvidenceEligibilityReceipt" ("receiptDigest");
CREATE INDEX "RevenueCurrentWebsiteEvidenceEligibilityReceipt_business_recorded_idx"
  ON "RevenueCurrentWebsiteEvidenceEligibilityReceipt" ("businessId", "recordedAt");

CREATE TRIGGER "RevenueCurrentWebsiteEvidenceEligibilityReceipt_lineage_insert"
BEFORE INSERT ON "RevenueCurrentWebsiteEvidenceEligibilityReceipt"
WHEN
  json_extract(NEW."receiptJson", '$.eligibilityVersion') IS NOT NEW."eligibilityVersion"
  OR json_extract(NEW."receiptJson", '$.receiptKind') IS NOT NEW."receiptKind"
  OR json_extract(NEW."receiptJson", '$.receiptId') IS NOT NEW."id"
  OR json_extract(NEW."receiptJson", '$.receiptDigest') IS NOT NEW."receiptDigest"
  OR json_extract(NEW."receiptJson", '$.manifestId') IS NOT NEW."manifestId"
  OR json_extract(NEW."receiptJson", '$.manifestDigest') IS NOT NEW."manifestDigest"
  OR json_extract(NEW."receiptJson", '$.businessId') IS NOT NEW."businessId"
  OR json_extract(NEW."receiptJson", '$.evaluationCandidateId') IS NOT NEW."evaluationCandidateId"
  OR json_extract(NEW."receiptJson", '$.sourceRecordId') IS NOT NEW."sourceRecordId"
  OR json_extract(NEW."receiptJson", '$.websiteEvidence.proofId') IS NOT NEW."websiteEvidenceProofId"
  OR json_extract(NEW."receiptJson", '$.websiteEvidence.proofDigest') IS NOT NEW."websiteEvidenceProofDigest"
  OR json_extract(NEW."receiptJson", '$.persistedWorkflow.workflowId') IS NOT NEW."workflowRunId"
  OR json_extract(NEW."receiptJson", '$.persistedWorkflow.requestDigest') IS NOT NEW."requestDigest"
  OR json_extract(NEW."receiptJson", '$.websiteEvidence.workflowReceiptId') IS NOT NEW."workflowReceiptId"
  OR json_extract(NEW."receiptJson", '$.persistedWorkflow.workflowReceiptDigest') IS NOT NEW."workflowReceiptDigest"
  OR json_extract(NEW."receiptJson", '$.websiteEvidence.auditDigest') IS NOT NEW."auditDigest"
  OR json_extract(NEW."receiptJson", '$.websiteEvidence.artifactSetDigest') IS NOT NEW."artifactSetDigest"
  OR json_extract(NEW."receiptJson", '$.persistedWorkflow.workflowForestDigest') IS NOT NEW."workflowForestDigest"
  OR json_array_length(NEW."receiptJson", '$.artifacts') <> NEW."artifactCount"
  OR json_extract(NEW."receiptJson", '$.evidenceFreshThrough') IS NOT NEW."evidenceFreshThrough"
  OR json_extract(NEW."receiptJson", '$.evaluatedAt') IS NOT NEW."evaluatedAt"
  OR json_extract(NEW."receiptJson", '$.authority.validationOnly') IS NOT 1
  OR json_extract(NEW."receiptJson", '$.authority.exactTrustedExecutionInstancesRequired') IS NOT 1
  OR json_extract(NEW."receiptJson", '$.authority.phaseInputCreationAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.progressReceiptCreationAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.phaseAdvancementAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.browserCaptureAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.artifactStorageAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.r2ReadAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.contactDiscoveryAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.qualificationAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.outreachAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.sendAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.deploymentAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.providerOperationsAuthorized') IS NOT 0
  OR json_extract(NEW."receiptJson", '$.authority.costAuthorizedUsd') IS NOT 0
  OR NOT EXISTS (
    SELECT 1 FROM "RevenueWorkflowRun" run
    WHERE run."id" = NEW."workflowRunId"
      AND run."businessId" = NEW."businessId"
      AND run."requestDigest" = NEW."requestDigest"
      AND run."mode" = 'SHADOW'
  )
  OR NOT EXISTS (
    SELECT 1 FROM "RevenueWorkflowReceiptRevision" receipt
    WHERE receipt."id" = NEW."workflowReceiptId"
      AND receipt."workflowRunId" = NEW."workflowRunId"
      AND receipt."receiptDigest" = NEW."workflowReceiptDigest"
      AND receipt."status" IN ('COMPLETED', 'PARTIAL')
      AND json_array_length(receipt."receiptJson", '$.artifactManifests') = NEW."artifactCount"
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW."receiptJson", '$.artifacts') artifact
    WHERE NOT EXISTS (
      SELECT 1 FROM "RevenueArtifactManifest" manifest
      WHERE manifest."id" = json_extract(artifact.value, '$.manifestId')
        AND manifest."workflowRunId" = NEW."workflowRunId"
        AND manifest."manifestDigest" = json_extract(artifact.value, '$.manifestDigest')
        AND manifest."retentionClass" = 'SHADOW_30D'
    )
    OR NOT EXISTS (
      SELECT 1 FROM "RevenueWorkflowReceiptRevision" receipt,
        json_each(receipt."receiptJson", '$.artifactManifests') terminalManifest
      WHERE receipt."id" = NEW."workflowReceiptId"
        AND json_extract(terminalManifest.value, '$.manifestId') = json_extract(artifact.value, '$.manifestId')
    )
    OR NOT EXISTS (
      SELECT 1 FROM "RevenueArtifactReferenceCompletenessReceipt" completeness
      WHERE completeness."id" = json_extract(artifact.value, '$.completeness.receiptId')
        AND completeness."receiptDigest" = json_extract(artifact.value, '$.completeness.receiptDigest')
        AND completeness."snapshotAttemptId" = json_extract(artifact.value, '$.completeness.snapshotAttemptId')
        AND completeness."workflowRunId" = NEW."workflowRunId"
        AND completeness."businessId" = NEW."businessId"
        AND completeness."lineageRootManifestId" = json_extract(artifact.value, '$.manifestId')
        AND completeness."snapshotCapturedAt" = json_extract(artifact.value, '$.completeness.snapshotCapturedAt')
        AND completeness."recordedAt" = json_extract(artifact.value, '$.completeness.recordedAt')
        AND completeness."freshUntil" = json_extract(artifact.value, '$.completeness.freshUntil')
        AND completeness."sourceFactsDigest" = json_extract(artifact.value, '$.completeness.sourceFactsDigest')
        AND completeness."sourceSetProofsDigest" = json_extract(artifact.value, '$.completeness.sourceSetProofsDigest')
        AND completeness."completenessAssurance" = 'D1_ATOMIC_RECHECK_AND_RELOAD'
        AND completeness."availabilityAssurance" = 'R2_HEAD_PER_MANIFEST'
        AND completeness."snapshotComplete" = 1
        AND completeness."committedAndReloaded" = 1
    )
    OR NOT EXISTS (
      SELECT 1 FROM "RevenueArtifactReferenceSourceSetProof" proof
      WHERE proof."completenessReceiptId" = json_extract(artifact.value, '$.completeness.receiptId')
        AND proof."setName" = 'AVAILABILITY'
        AND proof."proofDigest" = json_extract(artifact.value, '$.completeness.availabilitySourceSetProofDigest')
    )
    OR NOT EXISTS (
      SELECT 1 FROM "RevenueArtifactManifestAvailabilityReceipt" availability
      WHERE availability."id" = json_extract(artifact.value, '$.availability.receiptId')
        AND availability."manifestId" = json_extract(artifact.value, '$.manifestId')
        AND availability."receiptDigest" = json_extract(artifact.value, '$.availability.receiptDigest')
        AND availability."checkedAt" = json_extract(artifact.value, '$.availability.checkedAt')
        AND availability."validThrough" = json_extract(artifact.value, '$.availability.validThrough')
        AND availability."expiresAt" = json_extract(artifact.value, '$.availability.expiresAt')
        AND availability."checkerKind" = 'R2_HEAD'
        AND availability."objectSetDigest" = json_extract(artifact.value, '$.availability.objectSetDigest')
        AND availability."providerReadPerformed" = 1
        AND availability."state" = 'VERIFIED_PRESENT'
    )
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_LINEAGE_MISMATCH'); END;

CREATE TRIGGER "RevenueCurrentWebsiteEvidenceEligibilityReceipt_immutable_update"
BEFORE UPDATE ON "RevenueCurrentWebsiteEvidenceEligibilityReceipt"
BEGIN SELECT RAISE(ABORT, 'REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_APPEND_ONLY'); END;

CREATE TRIGGER "RevenueCurrentWebsiteEvidenceEligibilityReceipt_immutable_delete"
BEFORE DELETE ON "RevenueCurrentWebsiteEvidenceEligibilityReceipt"
BEGIN SELECT RAISE(ABORT, 'REVENUE_WEBSITE_EVIDENCE_ELIGIBILITY_APPEND_ONLY'); END;
