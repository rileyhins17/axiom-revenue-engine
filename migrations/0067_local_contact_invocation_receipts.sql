-- Bind one ignored-local contact persistence transaction to the complete
-- human-reviewed contact packet and exact existing source/assessment lineage.
-- This receipt is inserted last by a separate operator command. It does not
-- authorize discovery, verification providers, consent, qualification,
-- outreach, sending, remote databases, deployment, or spend.

CREATE TABLE "RevenuePrivateKwContactInvocationReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "invocationVersion" TEXT NOT NULL,
  "invocationDigest" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "reviewDigest" TEXT NOT NULL,
  "sourcePlanDigest" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "assessmentReceiptId" TEXT NOT NULL,
  "assessmentDigest" TEXT NOT NULL,
  "materializationReceiptId" TEXT NOT NULL,
  "discoveryReceiptId" TEXT NOT NULL,
  "invocationJson" TEXT NOT NULL,
  "reviewedBy" TEXT NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "executionKind" TEXT NOT NULL,
  "localOnly" INTEGER NOT NULL DEFAULT 1,
  "localContactMutationAuthorized" INTEGER NOT NULL DEFAULT 1,
  "localVerificationMutationAuthorized" INTEGER NOT NULL DEFAULT 1,
  "localInvocationReceiptAuthorized" INTEGER NOT NULL DEFAULT 1,
  "sourceMutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "workflowMutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "assessmentMutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "schemaMutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "captureAuthorized" INTEGER NOT NULL DEFAULT 0,
  "contactDiscoveryExecutionAuthorized" INTEGER NOT NULL DEFAULT 0,
  "contactVerificationExecutionAuthorized" INTEGER NOT NULL DEFAULT 0,
  "consentDecisionAuthorized" INTEGER NOT NULL DEFAULT 0,
  "qualificationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "outreachAuthorized" INTEGER NOT NULL DEFAULT 0,
  "sendAuthorized" INTEGER NOT NULL DEFAULT 0,
  "providerOperationsAuthorized" INTEGER NOT NULL DEFAULT 0,
  "costAuthorizedUsd" REAL NOT NULL DEFAULT 0,
  CHECK ("invocationVersion" = 'kw-private-contact-invocation-v1'),
  CHECK ("id" GLOB 'kw-contact-invocation:[0-9a-f]*' AND length("id") = 86),
  CHECK ("id" = 'kw-contact-invocation:' || "invocationDigest"),
  CHECK (length("invocationDigest") = 64 AND "invocationDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("reviewId" GLOB 'kw-contact-review:[0-9a-f]*' AND length("reviewId") = 82),
  CHECK ("reviewId" = 'kw-contact-review:' || "reviewDigest"),
  CHECK (length("reviewDigest") = 64 AND "reviewDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("sourcePlanDigest") = 64 AND "sourcePlanDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("assessmentReceiptId" GLOB 'assessment:[0-9a-f]*' AND length("assessmentReceiptId") = 75),
  CHECK (length("assessmentDigest") = 64 AND "assessmentDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (json_valid("invocationJson") AND json_type("invocationJson") = 'object'),
  CHECK ("reviewedBy" IN ('RILEY', 'AIDAN')),
  CHECK ("executionKind" = 'IGNORED_LOCAL_SQLITE'),
  CHECK ("localOnly" = 1),
  CHECK ("localContactMutationAuthorized" = 1),
  CHECK ("localVerificationMutationAuthorized" = 1),
  CHECK ("localInvocationReceiptAuthorized" = 1),
  CHECK ("sourceMutationAuthorized" = 0),
  CHECK ("workflowMutationAuthorized" = 0),
  CHECK ("assessmentMutationAuthorized" = 0),
  CHECK ("schemaMutationAuthorized" = 0),
  CHECK ("captureAuthorized" = 0),
  CHECK ("contactDiscoveryExecutionAuthorized" = 0),
  CHECK ("contactVerificationExecutionAuthorized" = 0),
  CHECK ("consentDecisionAuthorized" = 0),
  CHECK ("qualificationAuthorized" = 0),
  CHECK ("outreachAuthorized" = 0),
  CHECK ("sendAuthorized" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0),
  UNIQUE ("reviewId"),
  UNIQUE ("materializationReceiptId"),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("assessmentReceiptId") REFERENCES "RevenueLeadAssessmentReceipt" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("materializationReceiptId") REFERENCES "RevenuePrivateKwContactPersistenceReceipt" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("discoveryReceiptId") REFERENCES "RevenueContactDiscoveryReceipt" ("id") ON DELETE RESTRICT
);

CREATE TRIGGER "RevenuePrivateKwContactInvocationReceipt_lineage_insert"
BEFORE INSERT ON "RevenuePrivateKwContactInvocationReceipt"
WHEN
  json_extract(NEW."invocationJson", '$.invocationVersion') IS NOT NEW."invocationVersion"
  OR json_extract(NEW."invocationJson", '$.invocationId') IS NOT NEW."id"
  OR json_extract(NEW."invocationJson", '$.invocationDigest') IS NOT NEW."invocationDigest"
  OR json_extract(NEW."invocationJson", '$.reviewId') IS NOT NEW."reviewId"
  OR json_extract(NEW."invocationJson", '$.reviewDigest') IS NOT NEW."reviewDigest"
  OR json_extract(NEW."invocationJson", '$.sourcePlanDigest') IS NOT NEW."sourcePlanDigest"
  OR json_extract(NEW."invocationJson", '$.businessId') IS NOT NEW."businessId"
  OR json_extract(NEW."invocationJson", '$.assessment.assessmentReceiptId') IS NOT NEW."assessmentReceiptId"
  OR json_extract(NEW."invocationJson", '$.assessment.assessmentDigest') IS NOT NEW."assessmentDigest"
  OR json_extract(NEW."invocationJson", '$.contactMaterializationId') IS NOT NEW."materializationReceiptId"
  OR json_extract(NEW."invocationJson", '$.review.discovery.discoveryResultId') IS NOT NEW."discoveryReceiptId"
  OR json_extract(NEW."invocationJson", '$.review.reviewId') IS NOT NEW."reviewId"
  OR json_extract(NEW."invocationJson", '$.review.reviewDigest') IS NOT NEW."reviewDigest"
  OR json_extract(NEW."invocationJson", '$.approval.persistenceApproval.approval.reviewedBy') IS NOT NEW."reviewedBy"
  OR json_extract(NEW."invocationJson", '$.approval.persistenceApproval.approval.reviewedAt') IS NOT NEW."recordedAt"
  OR json_extract(NEW."invocationJson", '$.authority.executionKind') IS NOT NEW."executionKind"
  OR json_extract(NEW."invocationJson", '$.authority.localContactMutationAuthorized') IS NOT 1
  OR json_extract(NEW."invocationJson", '$.authority.localVerificationMutationAuthorized') IS NOT 1
  OR json_extract(NEW."invocationJson", '$.authority.localInvocationReceiptAuthorized') IS NOT 1
  OR json_extract(NEW."invocationJson", '$.authority.sourceMutationAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.workflowMutationAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.assessmentMutationAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.schemaMutationAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.captureAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.contactDiscoveryExecutionAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.contactVerificationExecutionAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.consentDecisionAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.qualificationAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.outreachAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.sendAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.providerOperationsAuthorized') IS NOT 0
  OR json_extract(NEW."invocationJson", '$.authority.costAuthorizedUsd') IS NOT 0
  OR NOT EXISTS (
    SELECT 1 FROM "RevenueLeadAssessmentReceipt" assessment
    WHERE assessment."id" = NEW."assessmentReceiptId"
      AND assessment."businessId" = NEW."businessId"
      AND assessment."assessmentDigest" = NEW."assessmentDigest"
      AND assessment."workflowReceiptId" = json_extract(NEW."invocationJson", '$.assessment.workflowReceiptId')
      AND assessment."websiteSnapshotId" = json_extract(NEW."invocationJson", '$.assessment.websiteSnapshotId')
      AND assessment."qualificationSnapshotId" = json_extract(NEW."invocationJson", '$.assessment.qualificationSnapshotId')
  )
  OR NOT EXISTS (
    SELECT 1 FROM "RevenuePrivateKwContactPersistenceReceipt" materialization
    WHERE materialization."id" = NEW."materializationReceiptId"
      AND materialization."businessId" = NEW."businessId"
      AND materialization."discoveryReceiptId" = NEW."discoveryReceiptId"
      AND materialization."discoveryResultDigest" = json_extract(NEW."invocationJson", '$.review.discovery.discoveryResultDigest')
      AND materialization."reviewedBy" = NEW."reviewedBy"
      AND materialization."recordedAt" = NEW."recordedAt"
  )
  OR NOT EXISTS (
    SELECT 1 FROM "RevenueContactDiscoveryReceipt" discovery
    WHERE discovery."id" = NEW."discoveryReceiptId"
      AND discovery."businessId" = NEW."businessId"
      AND discovery."resultDigest" = json_extract(NEW."invocationJson", '$.review.discovery.discoveryResultDigest')
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_CONTACT_INVOCATION_LINEAGE_MISMATCH'); END;

CREATE TRIGGER "RevenuePrivateKwContactInvocationReceipt_immutable_update"
BEFORE UPDATE ON "RevenuePrivateKwContactInvocationReceipt"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_CONTACT_INVOCATION_APPEND_ONLY'); END;

CREATE TRIGGER "RevenuePrivateKwContactInvocationReceipt_immutable_delete"
BEFORE DELETE ON "RevenuePrivateKwContactInvocationReceipt"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_CONTACT_INVOCATION_APPEND_ONLY'); END;
