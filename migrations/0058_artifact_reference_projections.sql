-- Append-only evidence-use endings and lineage-wide current-reference snapshots.
--
-- End records preserve the original use. Projections are valid only for their
-- exact complete source snapshot. Neither record authorizes release or deletion.
-- Runtime loading, persistence, and provider activity remain separate gates.

CREATE TABLE "RevenueArtifactEvidenceUseEnd" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "endVersion" TEXT NOT NULL,
  "evidenceUseId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "useType" TEXT NOT NULL,
  "useDigest" TEXT NOT NULL,
  "endedAt" DATETIME NOT NULL,
  "recordedAt" DATETIME NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "basisType" TEXT NOT NULL,
  "basisRecordId" TEXT NOT NULL,
  "basisRecordVersion" TEXT NOT NULL,
  "basisDigest" TEXT NOT NULL,
  "replacementEvidenceUseId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "recorderKind" TEXT NOT NULL,
  "endDigest" TEXT NOT NULL,
  "endJson" TEXT NOT NULL,
  "requiresRetentionReview" INTEGER NOT NULL,
  "releaseAuthorized" INTEGER NOT NULL,
  "deletionAuthorized" INTEGER NOT NULL,
  "providerDeleteAuthorized" INTEGER NOT NULL,
  "providerDeletePerformed" INTEGER NOT NULL,
  "costUsd" REAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("useType" IN ('QUALIFICATION_SNAPSHOT', 'OUTREACH_APPROVAL', 'CONSENT_EVIDENCE', 'OUTREACH_TOUCH', 'LEGAL_HOLD')),
  CHECK ("reasonCode" IN ('RECORD_RETENTION_COMPLETE', 'REPLACED_BY_EVIDENCE_USE', 'LEGAL_HOLD_CLEARED')),
  CHECK ("basisType" IN ('OWNER_RETENTION_REVIEW', 'EVIDENCE_USE_REPLACEMENT', 'LEGAL_CLEARANCE')),
  CHECK ("actorRole" IN ('OWNER', 'COMPLIANCE')),
  CHECK ("mode" = 'SHADOW'),
  CHECK ("recorderKind" = 'FIXTURE'),
  CHECK (julianday("recordedAt") >= julianday("endedAt")),
  CHECK (("reasonCode" = 'REPLACED_BY_EVIDENCE_USE' AND "basisType" = 'EVIDENCE_USE_REPLACEMENT' AND "replacementEvidenceUseId" IS NOT NULL)
    OR ("reasonCode" <> 'REPLACED_BY_EVIDENCE_USE' AND "replacementEvidenceUseId" IS NULL)),
  CHECK ("replacementEvidenceUseId" IS NULL OR "replacementEvidenceUseId" <> "evidenceUseId"),
  CHECK (("useType" = 'LEGAL_HOLD' AND "reasonCode" = 'LEGAL_HOLD_CLEARED' AND "basisType" = 'LEGAL_CLEARANCE' AND "actorRole" = 'COMPLIANCE')
    OR ("useType" <> 'LEGAL_HOLD' AND "reasonCode" <> 'LEGAL_HOLD_CLEARED' AND "basisType" <> 'LEGAL_CLEARANCE')),
  CHECK (length("useDigest") = 64),
  CHECK (length("basisDigest") = 64),
  CHECK (length("endDigest") = 64),
  CHECK (json_valid("endJson")),
  CHECK ("requiresRetentionReview" = 1),
  CHECK ("releaseAuthorized" = 0),
  CHECK ("deletionAuthorized" = 0),
  CHECK ("providerDeleteAuthorized" = 0),
  CHECK ("providerDeletePerformed" = 0),
  CHECK ("costUsd" = 0),
  FOREIGN KEY ("evidenceUseId") REFERENCES "RevenueArtifactEvidenceUse" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("replacementEvidenceUseId") REFERENCES "RevenueArtifactEvidenceUse" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueArtifactEvidenceUseEnd_use_key" ON "RevenueArtifactEvidenceUseEnd" ("evidenceUseId");
CREATE UNIQUE INDEX "RevenueArtifactEvidenceUseEnd_digest_key" ON "RevenueArtifactEvidenceUseEnd" ("endDigest");
CREATE INDEX "RevenueArtifactEvidenceUseEnd_business_recorded_idx" ON "RevenueArtifactEvidenceUseEnd" ("businessId", "recordedAt");

CREATE TABLE "RevenueArtifactReferenceProjection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectionVersion" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "lineageRootManifestId" TEXT NOT NULL,
  "snapshotCapturedAt" DATETIME NOT NULL,
  "projectedAt" DATETIME NOT NULL,
  "freshUntil" DATETIME NOT NULL,
  "snapshotComplete" INTEGER NOT NULL,
  "sourceManifestCount" INTEGER NOT NULL,
  "sourcePromotionCount" INTEGER NOT NULL,
  "sourceManifestUseCount" INTEGER NOT NULL,
  "sourceEvidenceUseCount" INTEGER NOT NULL,
  "sourceUseEndCount" INTEGER NOT NULL,
  "sourceAvailabilityCount" INTEGER NOT NULL,
  "sourceFactsDigest" TEXT NOT NULL,
  "sourceFactsJson" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "activeUseCount" INTEGER NOT NULL,
  "endedUseCount" INTEGER NOT NULL,
  "ambiguousUseCount" INTEGER NOT NULL,
  "unassignedUseCount" INTEGER NOT NULL,
  "requiredRetentionClass" TEXT,
  "projectionDigest" TEXT NOT NULL,
  "projectionJson" TEXT NOT NULL,
  "retentionReviewSuggested" INTEGER NOT NULL,
  "validOnlyForSourceFactsDigest" INTEGER NOT NULL,
  "requiresFreshReferenceCheck" INTEGER NOT NULL,
  "releaseAuthorized" INTEGER NOT NULL,
  "deletionAuthorized" INTEGER NOT NULL,
  "providerDeleteAuthorized" INTEGER NOT NULL,
  "providerDeletePerformed" INTEGER NOT NULL,
  "providerOperationsAuthorized" INTEGER NOT NULL,
  "costAuthorizedUsd" REAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (julianday("projectedAt") >= julianday("snapshotCapturedAt")),
  CHECK (julianday("freshUntil") >= julianday("projectedAt")),
  CHECK ("snapshotComplete" = 1),
  CHECK ("sourceManifestCount" >= 1 AND "sourceManifestCount" <= 100),
  CHECK ("sourcePromotionCount" >= 0 AND "sourcePromotionCount" <= 200),
  CHECK ("sourceManifestUseCount" >= 0 AND "sourceManifestUseCount" <= 1000),
  CHECK ("sourceEvidenceUseCount" >= 0 AND "sourceEvidenceUseCount" <= 1000),
  CHECK ("sourceUseEndCount" >= 0 AND "sourceUseEndCount" <= 1000),
  CHECK ("sourceAvailabilityCount" = "sourceManifestCount"),
  CHECK (length("sourceFactsDigest") = 64),
  CHECK (length("projectionDigest") = 64),
  CHECK (json_valid("sourceFactsJson")),
  CHECK (json_valid("projectionJson")),
  CHECK ("state" IN ('ACTIVE_REFERENCES', 'LEGAL_HOLD_ACTIVE', 'NO_CURRENT_REFERENCES', 'INDETERMINATE')),
  CHECK ("activeUseCount" >= 0 AND "activeUseCount" <= 1000),
  CHECK ("endedUseCount" >= 0 AND "endedUseCount" <= 1000),
  CHECK ("ambiguousUseCount" >= 0 AND "ambiguousUseCount" <= 1000),
  CHECK ("unassignedUseCount" >= 0 AND "unassignedUseCount" <= 1000),
  CHECK ("requiredRetentionClass" IS NULL OR "requiredRetentionClass" IN ('QUALIFICATION_180D', 'OUTREACH_ACTIVE', 'LEGAL_HOLD')),
  CHECK (("activeUseCount" = 0 AND "requiredRetentionClass" IS NULL)
    OR ("activeUseCount" > 0 AND "requiredRetentionClass" IS NOT NULL)),
  CHECK (("state" = 'NO_CURRENT_REFERENCES' AND "activeUseCount" = 0 AND "ambiguousUseCount" = 0 AND "unassignedUseCount" = 0)
    OR "state" <> 'NO_CURRENT_REFERENCES'),
  CHECK (("state" = 'INDETERMINATE' AND ("ambiguousUseCount" > 0 OR "unassignedUseCount" > 0))
    OR "state" <> 'INDETERMINATE'),
  CHECK ("retentionReviewSuggested" IN (0, 1)),
  CHECK ("validOnlyForSourceFactsDigest" = 1),
  CHECK ("requiresFreshReferenceCheck" = 1),
  CHECK ("releaseAuthorized" = 0),
  CHECK ("deletionAuthorized" = 0),
  CHECK ("providerDeleteAuthorized" = 0),
  CHECK ("providerDeletePerformed" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0),
  FOREIGN KEY ("businessId") REFERENCES "RevenueBusiness" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("lineageRootManifestId") REFERENCES "RevenueArtifactManifest" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueArtifactReferenceProjection_snapshot_key" ON "RevenueArtifactReferenceProjection" ("lineageRootManifestId", "projectionVersion", "snapshotCapturedAt");
CREATE UNIQUE INDEX "RevenueArtifactReferenceProjection_digest_key" ON "RevenueArtifactReferenceProjection" ("projectionDigest");
CREATE INDEX "RevenueArtifactReferenceProjection_root_projected_idx" ON "RevenueArtifactReferenceProjection" ("lineageRootManifestId", "projectedAt");

CREATE TABLE "RevenueArtifactReferenceProjectionUse" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectionId" TEXT NOT NULL,
  "evidenceUseId" TEXT NOT NULL,
  "useDigest" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "evidenceUseEndId" TEXT,
  "requiredRetentionClass" TEXT NOT NULL,
  "assignmentState" TEXT NOT NULL,
  "currentCandidateCount" INTEGER NOT NULL,
  "rowDigest" TEXT NOT NULL,
  "rowJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("state" IN ('ACTIVE', 'ENDED', 'INDETERMINATE')),
  CHECK ("requiredRetentionClass" IN ('QUALIFICATION_180D', 'OUTREACH_ACTIVE', 'LEGAL_HOLD')),
  CHECK ("assignmentState" IN ('UNIQUE', 'AMBIGUOUS', 'UNASSIGNED', 'ENDED')),
  CHECK ("currentCandidateCount" >= 0 AND "currentCandidateCount" <= 100),
  CHECK (("state" = 'ENDED' AND "evidenceUseEndId" IS NOT NULL AND "assignmentState" = 'ENDED' AND "currentCandidateCount" = 0)
    OR ("state" <> 'ENDED' AND "evidenceUseEndId" IS NULL AND "assignmentState" <> 'ENDED')),
  CHECK (("assignmentState" = 'UNIQUE' AND "currentCandidateCount" = 1)
    OR ("assignmentState" = 'AMBIGUOUS' AND "currentCandidateCount" > 1)
    OR ("assignmentState" IN ('UNASSIGNED', 'ENDED') AND "currentCandidateCount" = 0)),
  CHECK (length("useDigest") = 64),
  CHECK (length("rowDigest") = 64),
  CHECK (json_valid("rowJson")),
  FOREIGN KEY ("projectionId") REFERENCES "RevenueArtifactReferenceProjection" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("evidenceUseId") REFERENCES "RevenueArtifactEvidenceUse" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("evidenceUseEndId") REFERENCES "RevenueArtifactEvidenceUseEnd" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueArtifactReferenceProjectionUse_projection_use_key" ON "RevenueArtifactReferenceProjectionUse" ("projectionId", "evidenceUseId");
CREATE UNIQUE INDEX "RevenueArtifactReferenceProjectionUse_digest_key" ON "RevenueArtifactReferenceProjectionUse" ("rowDigest");

CREATE TABLE "RevenueArtifactReferenceProjectionAssignment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectionUseId" TEXT NOT NULL,
  "manifestId" TEXT NOT NULL,
  "manifestDigest" TEXT NOT NULL,
  "retentionClass" TEXT NOT NULL,
  "lineageDepth" INTEGER NOT NULL,
  "assignmentKind" TEXT NOT NULL,
  "assignmentDigest" TEXT NOT NULL,
  "assignmentJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("retentionClass" IN ('QUALIFICATION_180D', 'OUTREACH_ACTIVE', 'LEGAL_HOLD')),
  CHECK ("lineageDepth" >= 0 AND "lineageDepth" <= 100),
  CHECK ("assignmentKind" IN ('UNIQUE_CURRENT', 'AMBIGUOUS_CURRENT')),
  CHECK (length("manifestDigest") = 64),
  CHECK (length("assignmentDigest") = 64),
  CHECK (json_valid("assignmentJson")),
  FOREIGN KEY ("projectionUseId") REFERENCES "RevenueArtifactReferenceProjectionUse" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("manifestId") REFERENCES "RevenueArtifactManifest" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "RevenueArtifactReferenceProjectionAssignment_use_manifest_key" ON "RevenueArtifactReferenceProjectionAssignment" ("projectionUseId", "manifestId");
CREATE UNIQUE INDEX "RevenueArtifactReferenceProjectionAssignment_digest_key" ON "RevenueArtifactReferenceProjectionAssignment" ("assignmentDigest");

