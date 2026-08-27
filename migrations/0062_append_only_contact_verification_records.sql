-- Append-only, evidence-complete contact discovery and verification records.
--
-- This migration grants no provider, runtime, outreach, consent, or send
-- authority. Existing migration-0054 rows remain readable but become immutable;
-- every future insert must carry the versioned contact persistence contract.

CREATE TABLE "RevenueContactDiscoveryReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "persistenceVersion" TEXT NOT NULL,
  "discoveryVersion" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "evidenceClaimCount" INTEGER NOT NULL,
  "evidenceUseCount" INTEGER NOT NULL,
  "resultDigest" TEXT NOT NULL,
  "resultJson" TEXT NOT NULL,
  "completedAt" DATETIME NOT NULL,
  "mode" TEXT NOT NULL,
  "adapterKind" TEXT NOT NULL,
  "runtimeConnected" INTEGER NOT NULL DEFAULT 0,
  "sourceContactPersistenceAuthorized" INTEGER NOT NULL DEFAULT 0,
  "sourceVerificationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "outreachAuthorized" INTEGER NOT NULL DEFAULT 0,
  "sendAuthorized" INTEGER NOT NULL DEFAULT 0,
  "providerOperationsAuthorized" INTEGER NOT NULL DEFAULT 0,
  "costAuthorizedUsd" REAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL,
  CHECK ("persistenceVersion" = 'revenue-contact-persistence-plan-v1'),
  CHECK ("mode" = 'SHADOW'),
  CHECK ("adapterKind" = 'FIXTURE'),
  CHECK ("candidateCount" >= 0 AND "candidateCount" <= 25),
  CHECK ("evidenceClaimCount" >= 0 AND "evidenceClaimCount" <= 500),
  CHECK ("evidenceUseCount" >= 0 AND "evidenceUseCount" <= 500),
  CHECK ("evidenceClaimCount" <= "evidenceUseCount" OR "evidenceUseCount" = 0),
  CHECK (length("requestDigest") = 64 AND "requestDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("resultDigest") = 64 AND "resultDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (json_valid("resultJson")),
  CHECK (json_type("resultJson", '$.discoveryResultId') = 'text' AND json_extract("resultJson", '$.discoveryResultId') = "id"),
  CHECK (json_type("resultJson", '$.requestId') = 'text' AND json_extract("resultJson", '$.requestId') = "requestId"),
  CHECK (json_type("resultJson", '$.requestDigest') = 'text' AND json_extract("resultJson", '$.requestDigest') = "requestDigest"),
  CHECK (json_type("resultJson", '$.businessId') = 'text' AND json_extract("resultJson", '$.businessId') = "businessId"),
  CHECK (json_type("resultJson", '$.discoveryResultDigest') = 'text' AND json_extract("resultJson", '$.discoveryResultDigest') = "resultDigest"),
  CHECK ("runtimeConnected" = 0),
  CHECK ("sourceContactPersistenceAuthorized" = 0),
  CHECK ("sourceVerificationAuthorized" = 0),
  CHECK ("outreachAuthorized" = 0),
  CHECK ("sendAuthorized" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0),
  UNIQUE ("requestId"),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT
);
CREATE INDEX "RevenueContactDiscoveryReceipt_business_completed_idx"
  ON "RevenueContactDiscoveryReceipt" ("businessId", "completedAt");

ALTER TABLE "RevenueContactPoint" ADD COLUMN "persistenceVersion" TEXT;
ALTER TABLE "RevenueContactPoint" ADD COLUMN "discoveryReceiptId" TEXT REFERENCES "RevenueContactDiscoveryReceipt" ("id") ON DELETE RESTRICT;
ALTER TABLE "RevenueContactPoint" ADD COLUMN "candidateId" TEXT;
ALTER TABLE "RevenueContactPoint" ADD COLUMN "candidateDigest" TEXT;
ALTER TABLE "RevenueContactPoint" ADD COLUMN "candidateJson" TEXT;
ALTER TABLE "RevenueContactPoint" ADD COLUMN "recipientKind" TEXT;
ALTER TABLE "RevenueContactPoint" ADD COLUMN "socialPlatform" TEXT;
ALTER TABLE "RevenueContactPoint" ADD COLUMN "consentBasis" TEXT;
CREATE INDEX "RevenueContactPoint_business_candidate_version_idx"
  ON "RevenueContactPoint" ("businessId", "candidateId", "sourceCapturedAt", "id");
CREATE UNIQUE INDEX "RevenueContactPoint_discovery_candidate_key"
  ON "RevenueContactPoint" ("discoveryReceiptId", "candidateId")
  WHERE "discoveryReceiptId" IS NOT NULL AND "candidateId" IS NOT NULL;

CREATE TABLE "RevenueContactEvidenceClaim" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "evidenceVersion" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "capturedAt" DATETIME NOT NULL,
  "method" TEXT NOT NULL,
  "observation" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL,
  "publicationJson" TEXT NOT NULL,
  "evidenceJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL,
  CHECK ("evidenceVersion" = 'revenue-contact-evidence-v1'),
  CHECK ("method" IN ('HTML_MAILTO', 'HTML_TEL', 'HTML_TEXT', 'HTML_FORM', 'HTML_SOCIAL_LINK', 'SOURCE_RECORD', 'OWNER_REVIEW')),
  CHECK ("confidence" >= 0 AND "confidence" <= 100),
  CHECK (json_valid("publicationJson")),
  CHECK (json_valid("evidenceJson")),
  CHECK (json_type("evidenceJson", '$.evidenceId') = 'text' AND json_extract("evidenceJson", '$.evidenceId') = "id"),
  CHECK (json_type("evidenceJson", '$.evidenceVersion') = 'text' AND json_extract("evidenceJson", '$.evidenceVersion') = "evidenceVersion"),
  CHECK (json_type("evidenceJson", '$.sourceUrl') = 'text' AND json_extract("evidenceJson", '$.sourceUrl') = "sourceUrl"),
  CHECK (json_type("evidenceJson", '$.capturedAt') = 'text' AND json_extract("evidenceJson", '$.capturedAt') = "capturedAt"),
  CHECK (json_type("evidenceJson", '$.method') = 'text' AND json_extract("evidenceJson", '$.method') = "method"),
  CHECK (json_type("evidenceJson", '$.observation') = 'text' AND json_extract("evidenceJson", '$.observation') = "observation"),
  CHECK (json_type("evidenceJson", '$.confidence') = 'integer' AND json_extract("evidenceJson", '$.confidence') = "confidence"),
  CHECK (json_extract("evidenceJson", '$.publication') = json("publicationJson"))
);

CREATE TABLE "RevenueContactEvidenceUse" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "discoveryReceiptId" TEXT NOT NULL,
  "contactPointId" TEXT NOT NULL,
  "evidenceClaimId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL,
  UNIQUE ("discoveryReceiptId", "contactPointId", "evidenceClaimId"),
  FOREIGN KEY ("discoveryReceiptId") REFERENCES "RevenueContactDiscoveryReceipt" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("contactPointId") REFERENCES "RevenueContactPoint" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("evidenceClaimId") REFERENCES "RevenueContactEvidenceClaim" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT
);
CREATE INDEX "RevenueContactEvidenceUse_contact_idx"
  ON "RevenueContactEvidenceUse" ("contactPointId", "evidenceClaimId");

ALTER TABLE "RevenueVerificationResult" ADD COLUMN "persistenceVersion" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "verificationResultId" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "verificationVersion" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "requestId" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "requestDigest" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "candidateId" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "candidateDigest" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "resultDigest" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "resultJson" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "ownerStatus" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "recommendedAction" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "usableRoute" INTEGER;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "consentBasis" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "complianceReviewRequired" INTEGER;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "autonomousEmailEligible" INTEGER;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "mode" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "verifierKind" TEXT;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "runtimeConnected" INTEGER;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "verificationPersistenceAuthorized" INTEGER;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "qualificationPersistenceAuthorized" INTEGER;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "outreachAuthorized" INTEGER;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "sendAuthorized" INTEGER;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "providerOperationsAuthorized" INTEGER;
ALTER TABLE "RevenueVerificationResult" ADD COLUMN "costAuthorizedUsd" REAL;
CREATE UNIQUE INDEX "RevenueVerificationResult_contact_source_result_key"
  ON "RevenueVerificationResult" ("contactPointId", "verificationResultId")
  WHERE "verificationResultId" IS NOT NULL;
CREATE INDEX "RevenueVerificationResult_candidate_verified_idx"
  ON "RevenueVerificationResult" ("candidateId", "candidateDigest", "verifiedAt");

CREATE TRIGGER "RevenueContactPoint_contract_insert"
BEFORE INSERT ON "RevenueContactPoint"
WHEN
  NEW."persistenceVersion" IS NOT 'revenue-contact-persistence-plan-v1'
  OR NEW."discoveryReceiptId" IS NULL
  OR NEW."candidateId" IS NULL
  OR NEW."candidateDigest" IS NULL
  OR length(NEW."candidateDigest") <> 64
  OR NEW."candidateDigest" GLOB '*[^0-9a-f]*'
  OR NEW."candidateJson" IS NULL
  OR NOT json_valid(NEW."candidateJson")
  OR NEW."recipientKind" NOT IN ('NAMED_PERSON', 'ROLE', 'BUSINESS', 'UNKNOWN')
  OR (NEW."channel" = 'SOCIAL' AND NEW."socialPlatform" NOT IN ('FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X'))
  OR (NEW."channel" <> 'SOCIAL' AND NEW."socialPlatform" IS NOT NULL)
  OR NEW."consentBasis" IS NOT 'UNASSESSED'
  OR NEW."sourceUrl" IS NULL
  OR NEW."sourceCapturedAt" IS NULL
  OR NEW."automationPermitted" <> 0
  OR NEW."status" <> 'CANDIDATE'
  OR json_extract(NEW."candidateJson", '$.candidateId') IS NOT NEW."candidateId"
  OR json_extract(NEW."candidateJson", '$.candidateDigest') IS NOT NEW."candidateDigest"
  OR json_extract(NEW."candidateJson", '$.businessId') IS NOT NEW."businessId"
  OR json_extract(NEW."candidateJson", '$.channel') IS NOT NEW."channel"
  OR json_extract(NEW."candidateJson", '$.value') IS NOT NEW."value"
  OR json_extract(NEW."candidateJson", '$.recipientKind') IS NOT NEW."recipientKind"
  OR json_extract(NEW."candidateJson", '$.consentBasis') IS NOT NEW."consentBasis"
  OR NOT EXISTS (
    SELECT 1 FROM "RevenueContactDiscoveryReceipt" receipt
    WHERE receipt."id" = NEW."discoveryReceiptId"
      AND receipt."businessId" = NEW."businessId"
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_CONTRACT_REQUIRED'); END;

CREATE TRIGGER "RevenueContactEvidenceUse_contract_insert"
BEFORE INSERT ON "RevenueContactEvidenceUse"
WHEN
  NOT EXISTS (
    SELECT 1
    FROM "RevenueContactPoint" contact
    JOIN "RevenueContactDiscoveryReceipt" receipt ON receipt."id" = NEW."discoveryReceiptId"
    WHERE contact."id" = NEW."contactPointId"
      AND contact."discoveryReceiptId" = NEW."discoveryReceiptId"
      AND contact."businessId" = NEW."businessId"
      AND receipt."businessId" = NEW."businessId"
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_EVIDENCE_MISMATCH'); END;

CREATE TRIGGER "RevenueVerificationResult_contract_insert"
BEFORE INSERT ON "RevenueVerificationResult"
WHEN
  NEW."persistenceVersion" IS NOT 'revenue-contact-persistence-plan-v1'
  OR NEW."verificationResultId" IS NULL
  OR NEW."verificationVersion" IS NOT 'revenue-contact-verification-v1'
  OR NEW."requestId" IS NULL
  OR NEW."requestDigest" IS NULL
  OR length(NEW."requestDigest") <> 64
  OR NEW."requestDigest" GLOB '*[^0-9a-f]*'
  OR NEW."candidateId" IS NULL
  OR NEW."candidateDigest" IS NULL
  OR length(NEW."candidateDigest") <> 64
  OR NEW."candidateDigest" GLOB '*[^0-9a-f]*'
  OR NEW."resultDigest" IS NULL
  OR length(NEW."resultDigest") <> 64
  OR NEW."resultDigest" GLOB '*[^0-9a-f]*'
  OR NEW."resultJson" IS NULL
  OR NOT json_valid(NEW."resultJson")
  OR NEW."sourceUrl" IS NULL
  OR NEW."provider" <> 'FIXTURE'
  OR NEW."staleAfter" IS NULL
  OR NEW."ownerStatus" NOT IN ('CANDIDATE', 'USABLE', 'VERIFIED', 'INVALID')
  OR NEW."recommendedAction" NOT IN ('REVIEW_EMAIL', 'MANUAL_PHONE', 'MANUAL_FORM', 'MANUAL_SOCIAL', 'RESEARCH')
  OR NEW."usableRoute" NOT IN (0, 1)
  OR NEW."consentBasis" IS NOT 'UNASSESSED'
  OR NEW."complianceReviewRequired" NOT IN (0, 1)
  OR NEW."autonomousEmailEligible" <> 0
  OR NEW."mode" IS NOT 'SHADOW'
  OR NEW."verifierKind" IS NOT 'FIXTURE'
  OR NEW."runtimeConnected" <> 0
  OR NEW."verificationPersistenceAuthorized" <> 0
  OR NEW."qualificationPersistenceAuthorized" <> 0
  OR NEW."outreachAuthorized" <> 0
  OR NEW."sendAuthorized" <> 0
  OR NEW."providerOperationsAuthorized" <> 0
  OR NEW."costAuthorizedUsd" <> 0
  OR json_extract(NEW."resultJson", '$.verificationResultId') IS NOT NEW."verificationResultId"
  OR json_extract(NEW."resultJson", '$.requestId') IS NOT NEW."requestId"
  OR json_extract(NEW."resultJson", '$.requestDigest') IS NOT NEW."requestDigest"
  OR json_extract(NEW."resultJson", '$.candidateId') IS NOT NEW."candidateId"
  OR json_extract(NEW."resultJson", '$.candidateDigest') IS NOT NEW."candidateDigest"
  OR json_extract(NEW."resultJson", '$.verificationResultDigest') IS NOT NEW."resultDigest"
  OR json_extract(NEW."resultJson", '$.observation.status') IS NOT NEW."status"
  OR NOT EXISTS (
    SELECT 1 FROM "RevenueContactPoint" contact
    WHERE contact."id" = NEW."contactPointId"
      AND contact."candidateId" = NEW."candidateId"
      AND contact."candidateDigest" = NEW."candidateDigest"
      AND (
        (contact."channel" = 'EMAIL'
          AND NEW."status" IN ('DELIVERABLE', 'UNDELIVERABLE', 'CATCH_ALL', 'UNKNOWN')
          AND NEW."catchAll" = CASE WHEN NEW."status" = 'CATCH_ALL' THEN 1 ELSE 0 END
          AND NEW."ownerStatus" = CASE
            WHEN NEW."status" = 'DELIVERABLE' AND contact."recipientKind" IN ('NAMED_PERSON', 'ROLE') THEN 'VERIFIED'
            WHEN NEW."status" = 'UNDELIVERABLE' THEN 'INVALID'
            ELSE 'CANDIDATE' END
          AND NEW."usableRoute" = CASE
            WHEN NEW."status" = 'DELIVERABLE' AND contact."recipientKind" IN ('NAMED_PERSON', 'ROLE') THEN 1 ELSE 0 END
          AND NEW."recommendedAction" = CASE
            WHEN NEW."status" = 'DELIVERABLE' AND contact."recipientKind" IN ('NAMED_PERSON', 'ROLE') THEN 'REVIEW_EMAIL' ELSE 'RESEARCH' END
          AND NEW."complianceReviewRequired" = 1)
        OR (contact."channel" = 'PHONE'
          AND NEW."status" IN ('PUBLISHED', 'UNAVAILABLE', 'UNKNOWN')
          AND NEW."catchAll" IS NULL
          AND NEW."ownerStatus" = CASE WHEN NEW."status" = 'PUBLISHED' THEN 'USABLE' WHEN NEW."status" = 'UNAVAILABLE' THEN 'INVALID' ELSE 'CANDIDATE' END
          AND NEW."usableRoute" = CASE WHEN NEW."status" = 'PUBLISHED' THEN 1 ELSE 0 END
          AND NEW."recommendedAction" = CASE WHEN NEW."status" = 'PUBLISHED' THEN 'MANUAL_PHONE' ELSE 'RESEARCH' END
          AND NEW."complianceReviewRequired" = 0)
        OR (contact."channel" = 'FORM'
          AND NEW."status" IN ('AVAILABLE', 'UNAVAILABLE', 'UNKNOWN')
          AND NEW."catchAll" IS NULL
          AND NEW."ownerStatus" = CASE WHEN NEW."status" = 'AVAILABLE' THEN 'USABLE' WHEN NEW."status" = 'UNAVAILABLE' THEN 'INVALID' ELSE 'CANDIDATE' END
          AND NEW."usableRoute" = CASE WHEN NEW."status" = 'AVAILABLE' THEN 1 ELSE 0 END
          AND NEW."recommendedAction" = CASE WHEN NEW."status" = 'AVAILABLE' THEN 'MANUAL_FORM' ELSE 'RESEARCH' END
          AND NEW."complianceReviewRequired" = 0)
        OR (contact."channel" = 'SOCIAL'
          AND NEW."status" IN ('ACTIVE', 'INACTIVE', 'UNKNOWN')
          AND NEW."catchAll" IS NULL
          AND NEW."ownerStatus" = CASE WHEN NEW."status" = 'ACTIVE' THEN 'USABLE' WHEN NEW."status" = 'INACTIVE' THEN 'INVALID' ELSE 'CANDIDATE' END
          AND NEW."usableRoute" = CASE WHEN NEW."status" = 'ACTIVE' THEN 1 ELSE 0 END
          AND NEW."recommendedAction" = CASE WHEN NEW."status" = 'ACTIVE' THEN 'MANUAL_SOCIAL' ELSE 'RESEARCH' END
          AND NEW."complianceReviewRequired" = 0)
      )
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_VERIFICATION_MISMATCH'); END;

CREATE TRIGGER "RevenueContactDiscoveryReceipt_immutable_update"
BEFORE UPDATE ON "RevenueContactDiscoveryReceipt"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueContactDiscoveryReceipt_immutable_delete"
BEFORE DELETE ON "RevenueContactDiscoveryReceipt"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueContactPoint_immutable_update"
BEFORE UPDATE ON "RevenueContactPoint"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueContactPoint_immutable_delete"
BEFORE DELETE ON "RevenueContactPoint"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueContactEvidenceClaim_immutable_update"
BEFORE UPDATE ON "RevenueContactEvidenceClaim"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueContactEvidenceClaim_immutable_delete"
BEFORE DELETE ON "RevenueContactEvidenceClaim"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueContactEvidenceUse_immutable_update"
BEFORE UPDATE ON "RevenueContactEvidenceUse"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueContactEvidenceUse_immutable_delete"
BEFORE DELETE ON "RevenueContactEvidenceUse"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueVerificationResult_immutable_update"
BEFORE UPDATE ON "RevenueVerificationResult"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueVerificationResult_immutable_delete"
BEFORE DELETE ON "RevenueVerificationResult"
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_APPEND_ONLY'); END;
