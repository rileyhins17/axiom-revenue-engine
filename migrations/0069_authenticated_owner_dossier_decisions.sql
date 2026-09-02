-- Define the inactive append-only ledger for one exact authenticated owner
-- dossier decision. This schema is source-only until a later separately
-- approved D1 executor rechecks the live verified Better Auth session, accepts
-- only the exact in-process decision instance, commits with database time, and
-- performs an exact durable reload.
--
-- This migration adds no route, UI action, executor, progress append, provider,
-- outreach, send, deployment, or cost authority.

CREATE TABLE "RevenuePrivateKwOwnerDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "decisionVersion" TEXT NOT NULL,
  "recordKind" TEXT NOT NULL,
  "decisionDigest" TEXT NOT NULL,
  "manifestId" TEXT NOT NULL,
  "manifestDigest" TEXT NOT NULL,
  "sourceImportId" TEXT NOT NULL,
  "sourcePlanDigest" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "evaluationCandidateId" TEXT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "parentCheckpointId" TEXT NOT NULL,
  "parentCheckpointDigest" TEXT NOT NULL,
  "previousPhaseReceiptId" TEXT NOT NULL,
  "previousPhaseReceiptDigest" TEXT NOT NULL,
  "dossierDigest" TEXT NOT NULL,
  "dossierGeneratedAt" DATETIME NOT NULL,
  "websiteSnapshotId" TEXT NOT NULL,
  "qualificationSnapshotId" TEXT NOT NULL,
  "contactInvocationId" TEXT NOT NULL,
  "contactInvocationDigest" TEXT NOT NULL,
  "contactReviewId" TEXT NOT NULL,
  "acceptanceProofId" TEXT NOT NULL,
  "acceptanceProofDigest" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "decidedBy" TEXT NOT NULL,
  "decidedAt" DATETIME NOT NULL,
  "authProvider" TEXT NOT NULL,
  "authSubjectBindingDigest" TEXT NOT NULL,
  "authSessionBindingDigest" TEXT NOT NULL,
  "authDecisionBindingDigest" TEXT NOT NULL,
  "authBindingKeyVersion" TEXT NOT NULL,
  "sessionExpiresAt" DATETIME NOT NULL,
  "decisionJson" TEXT NOT NULL,
  "preparedAt" DATETIME NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "transactionKind" TEXT NOT NULL,
  "recordScope" TEXT NOT NULL,
  "authenticatedSessionRequired" INTEGER NOT NULL DEFAULT 1,
  "verifiedOwnerEmailRequired" INTEGER NOT NULL DEFAULT 1,
  "currentSessionRecheckAtFutureWriteRequired" INTEGER NOT NULL DEFAULT 1,
  "exactTrustedDecisionInstanceRequired" INTEGER NOT NULL DEFAULT 1,
  "durableExactReloadRequiredBeforeProgress" INTEGER NOT NULL DEFAULT 1,
  "ownerDecisionPersistenceAuthorized" INTEGER NOT NULL DEFAULT 0,
  "phaseInputCreationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "progressReceiptCreationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "phaseAdvancementAuthorized" INTEGER NOT NULL DEFAULT 0,
  "browserCaptureAuthorized" INTEGER NOT NULL DEFAULT 0,
  "contactDiscoveryAuthorized" INTEGER NOT NULL DEFAULT 0,
  "contactVerificationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "consentDecisionAuthorized" INTEGER NOT NULL DEFAULT 0,
  "qualificationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "mailboxSyncAuthorized" INTEGER NOT NULL DEFAULT 0,
  "outreachAuthorized" INTEGER NOT NULL DEFAULT 0,
  "sendAuthorized" INTEGER NOT NULL DEFAULT 0,
  "deploymentAuthorized" INTEGER NOT NULL DEFAULT 0,
  "providerOperationsAuthorized" INTEGER NOT NULL DEFAULT 0,
  "costAuthorizedUsd" REAL NOT NULL DEFAULT 0,
  CHECK ("decisionVersion" = 'kw-authenticated-owner-dossier-decision-v1'),
  CHECK ("recordKind" = 'AUTHENTICATED_OWNER_DOSSIER_DECISION'),
  CHECK ("id" GLOB 'kw-owner-decision:[0-9a-f]*' AND length("id") = 82),
  CHECK ("id" = 'kw-owner-decision:' || "decisionDigest"),
  CHECK (length("decisionDigest") = 64 AND "decisionDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("manifestId" GLOB 'kw-shadow-slice:[0-9a-f]*' AND length("manifestId") = 80),
  CHECK (length("manifestDigest") = 64 AND "manifestDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("sourcePlanDigest") = 64 AND "sourcePlanDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("parentCheckpointId" GLOB 'kw-shadow-progress:[0-9a-f]*' AND length("parentCheckpointId") = 83),
  CHECK (length("parentCheckpointDigest") = 64 AND "parentCheckpointDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("previousPhaseReceiptId" GLOB 'kw-shadow-phase:[0-9a-f]*' AND length("previousPhaseReceiptId") = 80),
  CHECK (length("previousPhaseReceiptDigest") = 64 AND "previousPhaseReceiptDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("dossierDigest") = 64 AND "dossierDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("contactInvocationId" GLOB 'kw-contact-invocation:[0-9a-f]*' AND length("contactInvocationId") = 86),
  CHECK ("contactInvocationId" = 'kw-contact-invocation:' || "contactInvocationDigest"),
  CHECK (length("contactInvocationDigest") = 64 AND "contactInvocationDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("contactReviewId" GLOB 'kw-contact-review:[0-9a-f]*' AND length("contactReviewId") = 82),
  CHECK ("acceptanceProofId" GLOB 'owner-dossier-acceptance:[0-9a-f]*' AND length("acceptanceProofId") = 89),
  CHECK ("acceptanceProofId" = 'owner-dossier-acceptance:' || "acceptanceProofDigest"),
  CHECK (length("acceptanceProofDigest") = 64 AND "acceptanceProofDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("decision" = 'ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS'),
  CHECK ("decidedBy" IN ('RILEY', 'AIDAN')),
  CHECK ("authProvider" = 'BETTER_AUTH'),
  CHECK (length("authSubjectBindingDigest") = 64 AND "authSubjectBindingDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("authSessionBindingDigest") = 64 AND "authSessionBindingDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("authDecisionBindingDigest") = 64 AND "authDecisionBindingDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("authBindingKeyVersion") >= 3 AND length("authBindingKeyVersion") <= 64),
  CHECK (julianday("dossierGeneratedAt") IS NOT NULL),
  CHECK (julianday("decidedAt") IS NOT NULL),
  CHECK (julianday("preparedAt") IS NOT NULL),
  CHECK (julianday("recordedAt") IS NOT NULL),
  CHECK (julianday("sessionExpiresAt") IS NOT NULL),
  CHECK (julianday("decidedAt") >= julianday("dossierGeneratedAt")),
  CHECK (julianday("preparedAt") = julianday("decidedAt")),
  CHECK (julianday("sessionExpiresAt") > julianday("decidedAt")),
  CHECK (julianday("recordedAt") >= julianday("preparedAt")),
  CHECK (julianday("recordedAt") < julianday("sessionExpiresAt")),
  CHECK (json_valid("decisionJson") AND json_type("decisionJson") = 'object'),
  CHECK ("transactionKind" = 'D1_BATCH'),
  CHECK ("recordScope" = 'OWNER_DECISION_RECORD_ONLY'),
  CHECK ("authenticatedSessionRequired" = 1),
  CHECK ("verifiedOwnerEmailRequired" = 1),
  CHECK ("currentSessionRecheckAtFutureWriteRequired" = 1),
  CHECK ("exactTrustedDecisionInstanceRequired" = 1),
  CHECK ("durableExactReloadRequiredBeforeProgress" = 1),
  CHECK ("ownerDecisionPersistenceAuthorized" = 0),
  CHECK ("phaseInputCreationAuthorized" = 0),
  CHECK ("progressReceiptCreationAuthorized" = 0),
  CHECK ("phaseAdvancementAuthorized" = 0),
  CHECK ("browserCaptureAuthorized" = 0),
  CHECK ("contactDiscoveryAuthorized" = 0),
  CHECK ("contactVerificationAuthorized" = 0),
  CHECK ("consentDecisionAuthorized" = 0),
  CHECK ("qualificationAuthorized" = 0),
  CHECK ("mailboxSyncAuthorized" = 0),
  CHECK ("outreachAuthorized" = 0),
  CHECK ("sendAuthorized" = 0),
  CHECK ("deploymentAuthorized" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0),
  UNIQUE ("acceptanceProofId"),
  UNIQUE ("authDecisionBindingDigest"),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "RevenuePrivateKwOwnerDecision_digest_key"
  ON "RevenuePrivateKwOwnerDecision" ("decisionDigest");
CREATE INDEX "RevenuePrivateKwOwnerDecision_business_decided_idx"
  ON "RevenuePrivateKwOwnerDecision" ("businessId", "decidedAt");

CREATE TRIGGER "RevenuePrivateKwOwnerDecision_lineage_insert"
BEFORE INSERT ON "RevenuePrivateKwOwnerDecision"
WHEN
  json_extract(NEW."decisionJson", '$.recordVersion') IS NOT NEW."decisionVersion"
  OR json_extract(NEW."decisionJson", '$.recordKind') IS NOT NEW."recordKind"
  OR json_extract(NEW."decisionJson", '$.recordId') IS NOT NEW."id"
  OR json_extract(NEW."decisionJson", '$.recordDigest') IS NOT NEW."decisionDigest"
  OR json_extract(NEW."decisionJson", '$.manifestId') IS NOT NEW."manifestId"
  OR json_extract(NEW."decisionJson", '$.manifestDigest') IS NOT NEW."manifestDigest"
  OR json_extract(NEW."decisionJson", '$.sourceImportId') IS NOT NEW."sourceImportId"
  OR json_extract(NEW."decisionJson", '$.sourcePlanDigest') IS NOT NEW."sourcePlanDigest"
  OR json_extract(NEW."decisionJson", '$.businessId') IS NOT NEW."businessId"
  OR json_extract(NEW."decisionJson", '$.evaluationCandidateId') IS NOT NEW."evaluationCandidateId"
  OR json_extract(NEW."decisionJson", '$.sourceRecordId') IS NOT NEW."sourceRecordId"
  OR json_extract(NEW."decisionJson", '$.parentCheckpoint.checkpointId') IS NOT NEW."parentCheckpointId"
  OR json_extract(NEW."decisionJson", '$.parentCheckpoint.checkpointDigest') IS NOT NEW."parentCheckpointDigest"
  OR json_extract(NEW."decisionJson", '$.previousPhaseReceipt.phaseReceiptId') IS NOT NEW."previousPhaseReceiptId"
  OR json_extract(NEW."decisionJson", '$.previousPhaseReceipt.phaseReceiptDigest') IS NOT NEW."previousPhaseReceiptDigest"
  OR json_extract(NEW."decisionJson", '$.ownerDossier.dossierDigest') IS NOT NEW."dossierDigest"
  OR json_extract(NEW."decisionJson", '$.ownerDossier.generatedAt') IS NOT NEW."dossierGeneratedAt"
  OR json_extract(NEW."decisionJson", '$.ownerDossier.websiteSnapshotId') IS NOT NEW."websiteSnapshotId"
  OR json_extract(NEW."decisionJson", '$.ownerDossier.qualificationSnapshotId') IS NOT NEW."qualificationSnapshotId"
  OR json_extract(NEW."decisionJson", '$.previousPhaseReceipt.contactInvocationId') IS NOT NEW."contactInvocationId"
  OR json_extract(NEW."decisionJson", '$.previousPhaseReceipt.contactInvocationDigest') IS NOT NEW."contactInvocationDigest"
  OR json_extract(NEW."decisionJson", '$.ownerDossier.contactReviewId') IS NOT NEW."contactReviewId"
  OR json_extract(NEW."decisionJson", '$.acceptanceProof.proofId') IS NOT NEW."acceptanceProofId"
  OR json_extract(NEW."decisionJson", '$.acceptanceProof.proofDigest') IS NOT NEW."acceptanceProofDigest"
  OR json_extract(NEW."decisionJson", '$.decision.decision') IS NOT NEW."decision"
  OR json_extract(NEW."decisionJson", '$.decision.decidedBy') IS NOT NEW."decidedBy"
  OR json_extract(NEW."decisionJson", '$.decision.decidedAt') IS NOT NEW."decidedAt"
  OR json_extract(NEW."decisionJson", '$.authentication.authenticationProvider') IS NOT NEW."authProvider"
  OR json_extract(NEW."decisionJson", '$.authentication.emailVerified') IS NOT 1
  OR json_extract(NEW."decisionJson", '$.authentication.subjectBindingDigest') IS NOT NEW."authSubjectBindingDigest"
  OR json_extract(NEW."decisionJson", '$.authentication.sessionBindingDigest') IS NOT NEW."authSessionBindingDigest"
  OR json_extract(NEW."decisionJson", '$.authentication.decisionBindingDigest') IS NOT NEW."authDecisionBindingDigest"
  OR json_extract(NEW."decisionJson", '$.authentication.bindingKeyVersion') IS NOT NEW."authBindingKeyVersion"
  OR json_extract(NEW."decisionJson", '$.authentication.sessionExpiresAt') IS NOT NEW."sessionExpiresAt"
  OR json_extract(NEW."decisionJson", '$.preparedAt') IS NOT NEW."preparedAt"
  OR json_extract(NEW."decisionJson", '$.authority.contractValidationOnly') IS NOT 1
  OR json_extract(NEW."decisionJson", '$.authority.currentOwnerSessionRequiredAtFutureWrite') IS NOT 1
  OR json_extract(NEW."decisionJson", '$.authority.exactTrustedDecisionInstanceRequiredAtFutureWrite') IS NOT 1
  OR json_extract(NEW."decisionJson", '$.authority.durableExactReloadRequiredBeforeProgress') IS NOT 1
  OR json_extract(NEW."decisionJson", '$.authority.durableDecisionRecorded') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.ownerDecisionPersistenceAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.phaseInputCreationAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.progressReceiptCreationAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.phaseAdvancementAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.fileReadAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.fileMutationAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.databaseReadAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.databaseMutationAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.browserCaptureAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.contactDiscoveryExecutionAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.contactVerificationExecutionAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.consentDecisionAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.qualificationAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.mailboxSyncAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.outreachAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.sendAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.deploymentAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.providerOperationsAuthorized') IS NOT 0
  OR json_extract(NEW."decisionJson", '$.authority.costAuthorizedUsd') IS NOT 0
  OR EXISTS (
    SELECT 1 FROM json_tree(NEW."decisionJson")
    WHERE "key" IN ('authenticatedUserId', 'authenticatedSessionId', 'authenticatedEmail')
  )
  OR NOT EXISTS (
    SELECT 1 FROM "RevenueBusiness" business
    WHERE business."id" = NEW."businessId"
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_OWNER_DECISION_LINEAGE_MISMATCH'); END;

CREATE TRIGGER "RevenuePrivateKwOwnerDecision_immutable_update"
BEFORE UPDATE ON "RevenuePrivateKwOwnerDecision"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_OWNER_DECISION_APPEND_ONLY'); END;

CREATE TRIGGER "RevenuePrivateKwOwnerDecision_immutable_delete"
BEFORE DELETE ON "RevenuePrivateKwOwnerDecision"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_OWNER_DECISION_APPEND_ONLY'); END;
