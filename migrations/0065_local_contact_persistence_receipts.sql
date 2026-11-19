-- Prove one separately approved ignored-local contact persistence transaction.
--
-- The discovery receipt must exist before its child rows, so it cannot also be
-- the transaction-completion marker. This append-only receipt is inserted last
-- and proves that the exact discovery/contact/evidence/verification bundle was
-- present together. It grants no discovery, verification-provider, consent,
-- qualification, outreach, send, runtime, or cost authority.

CREATE TABLE "RevenuePrivateKwContactPersistenceReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "materializationVersion" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "discoveryReceiptId" TEXT NOT NULL,
  "discoveryResultDigest" TEXT NOT NULL,
  "persistencePlanDigest" TEXT NOT NULL,
  "materializationDigest" TEXT NOT NULL,
  "materializationJson" TEXT NOT NULL,
  "contactPointCount" INTEGER NOT NULL,
  "evidenceClaimCount" INTEGER NOT NULL,
  "evidenceUseCount" INTEGER NOT NULL,
  "verificationResultCount" INTEGER NOT NULL,
  "verificationResultIdsJson" TEXT NOT NULL,
  "consentRows" INTEGER NOT NULL DEFAULT 0,
  "reviewedBy" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "executionKind" TEXT NOT NULL,
  "transactionKind" TEXT NOT NULL,
  "localOnly" INTEGER NOT NULL DEFAULT 1,
  "localDatabaseAccessAuthorized" INTEGER NOT NULL DEFAULT 1,
  "localContactMutationAuthorized" INTEGER NOT NULL DEFAULT 1,
  "localVerificationMutationAuthorized" INTEGER NOT NULL DEFAULT 1,
  "sourceMutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "workflowMutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "assessmentMutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "schemaMutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "captureAuthorized" INTEGER NOT NULL DEFAULT 0,
  "contactDiscoveryAuthorized" INTEGER NOT NULL DEFAULT 0,
  "contactVerificationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "consentDecisionAuthorized" INTEGER NOT NULL DEFAULT 0,
  "qualificationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "outreachAuthorized" INTEGER NOT NULL DEFAULT 0,
  "sendAuthorized" INTEGER NOT NULL DEFAULT 0,
  "providerOperationsAuthorized" INTEGER NOT NULL DEFAULT 0,
  "costAuthorizedUsd" REAL NOT NULL DEFAULT 0,
  CHECK ("materializationVersion" = 'kw-private-contact-persistence-v1'),
  CHECK ("id" GLOB 'kw-contact-persistence:[0-9a-f]*' AND length("id") = 87),
  CHECK (length("discoveryResultDigest") = 64 AND "discoveryResultDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("persistencePlanDigest") = 64 AND "persistencePlanDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("materializationDigest") = 64 AND "materializationDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (json_valid("materializationJson")),
  CHECK (json_valid("verificationResultIdsJson") AND json_type("verificationResultIdsJson") = 'array'),
  CHECK ("contactPointCount" >= 0 AND "contactPointCount" <= 25),
  CHECK ("evidenceClaimCount" >= 0 AND "evidenceClaimCount" <= 500),
  CHECK ("evidenceUseCount" >= 0 AND "evidenceUseCount" <= 500),
  CHECK ("verificationResultCount" >= 0 AND "verificationResultCount" <= 250),
  CHECK (json_array_length("verificationResultIdsJson") = "verificationResultCount"),
  CHECK ("consentRows" = 0),
  CHECK ("reviewedBy" IN ('RILEY', 'AIDAN')),
  CHECK ("executionKind" = 'IGNORED_LOCAL_SQLITE'),
  CHECK ("transactionKind" = 'BETTER_SQLITE3_IMMEDIATE'),
  CHECK ("localOnly" = 1),
  CHECK ("localDatabaseAccessAuthorized" = 1),
  CHECK ("localContactMutationAuthorized" = 1),
  CHECK ("localVerificationMutationAuthorized" = 1),
  CHECK ("sourceMutationAuthorized" = 0),
  CHECK ("workflowMutationAuthorized" = 0),
  CHECK ("assessmentMutationAuthorized" = 0),
  CHECK ("schemaMutationAuthorized" = 0),
  CHECK ("captureAuthorized" = 0),
  CHECK ("contactDiscoveryAuthorized" = 0),
  CHECK ("contactVerificationAuthorized" = 0),
  CHECK ("consentDecisionAuthorized" = 0),
  CHECK ("qualificationAuthorized" = 0),
  CHECK ("outreachAuthorized" = 0),
  CHECK ("sendAuthorized" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0),
  UNIQUE ("discoveryReceiptId"),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("discoveryReceiptId") REFERENCES "RevenueContactDiscoveryReceipt" ("id") ON DELETE RESTRICT
);

CREATE TRIGGER "RevenuePrivateKwContactPersistenceReceipt_lineage_insert"
BEFORE INSERT ON "RevenuePrivateKwContactPersistenceReceipt"
WHEN
  json_extract(NEW."materializationJson", '$.businessId') IS NOT NEW."businessId"
  OR json_extract(NEW."materializationJson", '$.discoveryResultId') IS NOT NEW."discoveryReceiptId"
  OR json_extract(NEW."materializationJson", '$.discoveryResultDigest') IS NOT NEW."discoveryResultDigest"
  OR json_extract(NEW."materializationJson", '$.persistencePlanDigest') IS NOT NEW."persistencePlanDigest"
  OR json_extract(NEW."materializationJson", '$.approval.reviewedBy') IS NOT NEW."reviewedBy"
  OR json_extract(NEW."materializationJson", '$.approval.reviewedAt') IS NOT NEW."recordedAt"
  OR json_extract(NEW."materializationJson", '$.summary.contactPointVersions') <> NEW."contactPointCount"
  OR json_extract(NEW."materializationJson", '$.summary.evidenceClaims') <> NEW."evidenceClaimCount"
  OR json_extract(NEW."materializationJson", '$.summary.evidenceUses') <> NEW."evidenceUseCount"
  OR json_extract(NEW."materializationJson", '$.summary.verificationResults') <> NEW."verificationResultCount"
  OR json_extract(NEW."materializationJson", '$.summary.consentRows') <> 0
  OR json_extract(NEW."materializationJson", '$.authority.localOnly') <> 1
  OR json_extract(NEW."materializationJson", '$.authority.localContactMutationAuthorized') <> 1
  OR json_extract(NEW."materializationJson", '$.authority.localVerificationMutationAuthorized') <> 1
  OR json_extract(NEW."materializationJson", '$.authority.contactDiscoveryAuthorized') <> 0
  OR json_extract(NEW."materializationJson", '$.authority.contactVerificationAuthorized') <> 0
  OR json_extract(NEW."materializationJson", '$.authority.consentDecisionAuthorized') <> 0
  OR json_extract(NEW."materializationJson", '$.authority.qualificationAuthorized') <> 0
  OR json_extract(NEW."materializationJson", '$.authority.outreachAuthorized') <> 0
  OR json_extract(NEW."materializationJson", '$.authority.sendAuthorized') <> 0
  OR json_extract(NEW."materializationJson", '$.authority.providerOperationsAuthorized') <> 0
  OR json_extract(NEW."materializationJson", '$.authority.costAuthorizedUsd') <> 0
  OR json_extract(NEW."materializationJson", '$.verificationResultIds') <> json(NEW."verificationResultIdsJson")
  OR NOT EXISTS (
    SELECT 1 FROM "RevenueContactDiscoveryReceipt" receipt
    WHERE receipt."id" = NEW."discoveryReceiptId"
      AND receipt."businessId" = NEW."businessId"
      AND receipt."resultDigest" = NEW."discoveryResultDigest"
      AND receipt."candidateCount" = NEW."contactPointCount"
      AND receipt."evidenceClaimCount" = NEW."evidenceClaimCount"
      AND receipt."evidenceUseCount" = NEW."evidenceUseCount"
  )
  OR (SELECT COUNT(*) FROM "RevenueContactPoint" contact
      WHERE contact."discoveryReceiptId" = NEW."discoveryReceiptId") <> NEW."contactPointCount"
  OR (SELECT COUNT(*) FROM "RevenueContactEvidenceUse" evidenceUse
      WHERE evidenceUse."discoveryReceiptId" = NEW."discoveryReceiptId") <> NEW."evidenceUseCount"
  OR (SELECT COUNT(DISTINCT evidenceUse."evidenceClaimId") FROM "RevenueContactEvidenceUse" evidenceUse
      WHERE evidenceUse."discoveryReceiptId" = NEW."discoveryReceiptId") <> NEW."evidenceClaimCount"
  OR (SELECT COUNT(*)
      FROM "RevenueVerificationResult" verification
      JOIN "RevenueContactPoint" contact ON contact."id" = verification."contactPointId"
      WHERE contact."discoveryReceiptId" = NEW."discoveryReceiptId") <> NEW."verificationResultCount"
  OR EXISTS (
    SELECT 1 FROM json_each(NEW."verificationResultIdsJson") expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM "RevenueVerificationResult" verification
      JOIN "RevenueContactPoint" contact ON contact."id" = verification."contactPointId"
      WHERE contact."discoveryReceiptId" = NEW."discoveryReceiptId"
        AND verification."verificationResultId" = expected.value
    )
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_LINEAGE_MISMATCH'); END;

CREATE TRIGGER "RevenuePrivateKwContactPersistenceReceipt_immutable_update"
BEFORE UPDATE ON "RevenuePrivateKwContactPersistenceReceipt"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_APPEND_ONLY'); END;

CREATE TRIGGER "RevenuePrivateKwContactPersistenceReceipt_immutable_delete"
BEFORE DELETE ON "RevenuePrivateKwContactPersistenceReceipt"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_APPEND_ONLY'); END;
