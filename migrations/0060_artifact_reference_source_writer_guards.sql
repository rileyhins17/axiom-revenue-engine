-- Database-enforced source freeze for atomic artifact-reference snapshots.
--
-- Every source row is append-only. While an unsealed snapshot attempt is in
-- its half-open active window, inserts that would change any of its 15 source
-- sets abort inside D1. Provider availability receipts must therefore be
-- collected and persisted before the snapshot claim. This migration does not
-- add an executor, issue completeness receipts, or grant projection, retention,
-- release, deletion, provider-operation, outreach, or cost authority.

CREATE TRIGGER "RevenueWorkflowRun_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueWorkflowRun"
WHEN EXISTS (
  SELECT 1
  FROM "RevenueArtifactReferenceSnapshotAttempt" s
  JOIN "RevenueWorkflowRun" locked ON locked."id" = s."workflowRunId"
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL
    AND julianday(s."acquiredAt") <= julianday('now')
    AND julianday(s."expiresAt") > julianday('now')
    AND (s."workflowRunId" = NEW."id"
      OR (locked."workflowKind" = NEW."workflowKind" AND locked."idempotencyKey" = NEW."idempotencyKey"))
)
BEGIN
  SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN');
END;

CREATE TRIGGER "RevenueWorkflowDefinition_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueWorkflowDefinition"
WHEN EXISTS (
  SELECT 1
  FROM "RevenueArtifactReferenceSnapshotAttempt" s
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL
    AND julianday(s."acquiredAt") <= julianday('now')
    AND julianday(s."expiresAt") > julianday('now')
    AND (EXISTS (SELECT 1 FROM "RevenueWorkflowDelivery" d WHERE d."workflowRunId" = s."workflowRunId" AND d."definitionId" = NEW."id")
      OR EXISTS (SELECT 1 FROM "RevenueWorkflowAttempt" a WHERE a."workflowRunId" = s."workflowRunId" AND a."definitionId" = NEW."id"))
)
BEGIN
  SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN');
END;

CREATE TRIGGER "RevenueWorkflowDelivery_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueWorkflowDelivery"
WHEN EXISTS (
  SELECT 1 FROM "RevenueArtifactReferenceSnapshotAttempt" s
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL AND julianday(s."acquiredAt") <= julianday('now') AND julianday(s."expiresAt") > julianday('now')
    AND s."workflowRunId" = NEW."workflowRunId"
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueWorkflowAttempt_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueWorkflowAttempt"
WHEN EXISTS (
  SELECT 1 FROM "RevenueArtifactReferenceSnapshotAttempt" s
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL AND julianday(s."acquiredAt") <= julianday('now') AND julianday(s."expiresAt") > julianday('now')
    AND s."workflowRunId" = NEW."workflowRunId"
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueWorkflowLease_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueWorkflowLease"
WHEN EXISTS (
  SELECT 1 FROM "RevenueArtifactReferenceSnapshotAttempt" s
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL AND julianday(s."acquiredAt") <= julianday('now') AND julianday(s."expiresAt") > julianday('now')
    AND s."workflowRunId" = NEW."workflowRunId"
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueWorkflowReceiptRevision_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueWorkflowReceiptRevision"
WHEN EXISTS (
  SELECT 1 FROM "RevenueArtifactReferenceSnapshotAttempt" s
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL AND julianday(s."acquiredAt") <= julianday('now') AND julianday(s."expiresAt") > julianday('now')
    AND s."workflowRunId" = NEW."workflowRunId"
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueWorkflowAttemptClosure_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueWorkflowAttemptClosure"
WHEN EXISTS (
  SELECT 1 FROM "RevenueArtifactReferenceSnapshotAttempt" s
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL AND julianday(s."acquiredAt") <= julianday('now') AND julianday(s."expiresAt") > julianday('now')
    AND s."workflowRunId" = NEW."workflowRunId"
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueArtifactManifest_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueArtifactManifest"
WHEN EXISTS (
  SELECT 1 FROM "RevenueArtifactReferenceSnapshotAttempt" s
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL AND julianday(s."acquiredAt") <= julianday('now') AND julianday(s."expiresAt") > julianday('now')
    AND s."workflowRunId" = NEW."workflowRunId"
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueArtifactManifestItem_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueArtifactManifestItem"
WHEN EXISTS (
  SELECT 1
  FROM "RevenueArtifactReferenceSnapshotAttempt" s
  JOIN "RevenueArtifactManifest" m ON m."id" = NEW."manifestId" AND m."workflowRunId" = s."workflowRunId"
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL AND julianday(s."acquiredAt") <= julianday('now') AND julianday(s."expiresAt") > julianday('now')
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueArtifactPromotionReceipt_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueArtifactPromotionReceipt"
WHEN EXISTS (
  SELECT 1
  FROM "RevenueArtifactReferenceSnapshotAttempt" s
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL
    AND julianday(s."acquiredAt") <= julianday('now')
    AND julianday(s."expiresAt") > julianday('now')
    AND (s."workflowRunId" = NEW."workflowRunId"
      OR EXISTS (SELECT 1 FROM "RevenueArtifactManifest" m WHERE m."id" = NEW."sourceManifestId" AND m."workflowRunId" = s."workflowRunId")
      OR EXISTS (SELECT 1 FROM "RevenueArtifactManifest" m WHERE m."id" = NEW."resultManifestId" AND m."workflowRunId" = s."workflowRunId"))
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueArtifactPromotionUse_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueArtifactPromotionUse"
WHEN EXISTS (
  SELECT 1
  FROM "RevenueArtifactReferenceSnapshotAttempt" s
  JOIN "RevenueArtifactPromotionReceipt" p ON p."id" = NEW."promotionId"
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL
    AND julianday(s."acquiredAt") <= julianday('now')
    AND julianday(s."expiresAt") > julianday('now')
    AND (s."workflowRunId" = p."workflowRunId"
      OR EXISTS (SELECT 1 FROM "RevenueArtifactManifest" m WHERE m."id" = p."sourceManifestId" AND m."workflowRunId" = s."workflowRunId")
      OR EXISTS (SELECT 1 FROM "RevenueArtifactManifest" m WHERE m."id" = p."resultManifestId" AND m."workflowRunId" = s."workflowRunId"))
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueArtifactManifestEvidenceUse_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueArtifactManifestEvidenceUse"
WHEN EXISTS (
  SELECT 1
  FROM "RevenueArtifactReferenceSnapshotAttempt" s
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL
    AND julianday(s."acquiredAt") <= julianday('now')
    AND julianday(s."expiresAt") > julianday('now')
    AND (EXISTS (SELECT 1 FROM "RevenueArtifactManifest" m WHERE m."id" = NEW."manifestId" AND m."workflowRunId" = s."workflowRunId")
      OR EXISTS (
        SELECT 1 FROM "RevenueArtifactPromotionReceipt" p
        WHERE p."id" = NEW."viaPromotionId"
          AND (p."workflowRunId" = s."workflowRunId"
            OR EXISTS (SELECT 1 FROM "RevenueArtifactManifest" m WHERE m."id" = p."sourceManifestId" AND m."workflowRunId" = s."workflowRunId")
            OR EXISTS (SELECT 1 FROM "RevenueArtifactManifest" m WHERE m."id" = p."resultManifestId" AND m."workflowRunId" = s."workflowRunId"))
      ))
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueArtifactEvidenceUse_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueArtifactEvidenceUse"
WHEN EXISTS (
  WITH RECURSIVE "ActiveSnapshot"("workflowRunId") AS (
    SELECT s."workflowRunId"
    FROM "RevenueArtifactReferenceSnapshotAttempt" s
    LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
    WHERE c."id" IS NULL AND julianday(s."acquiredAt") <= julianday('now') AND julianday(s."expiresAt") > julianday('now')
  ), "ScopedManifest"("id") AS (
    SELECT m."id" FROM "RevenueArtifactManifest" m JOIN "ActiveSnapshot" s ON s."workflowRunId" = m."workflowRunId"
  ), "ScopedPromotion"("id") AS (
    SELECT p."id" FROM "RevenueArtifactPromotionReceipt" p
    WHERE p."workflowRunId" IN (SELECT "workflowRunId" FROM "ActiveSnapshot")
      OR p."sourceManifestId" IN (SELECT "id" FROM "ScopedManifest")
      OR p."resultManifestId" IN (SELECT "id" FROM "ScopedManifest")
  ), "SeedUse"("id") AS (
    SELECT u."evidenceUseId" FROM "RevenueArtifactPromotionUse" u WHERE u."promotionId" IN (SELECT "id" FROM "ScopedPromotion")
    UNION
    SELECT u."evidenceUseId" FROM "RevenueArtifactManifestEvidenceUse" u
    WHERE u."manifestId" IN (SELECT "id" FROM "ScopedManifest") OR u."viaPromotionId" IN (SELECT "id" FROM "ScopedPromotion")
  ), "ScopedUse"("id") AS (
    SELECT "id" FROM "SeedUse"
    UNION
    SELECT e."replacementEvidenceUseId" FROM "RevenueArtifactEvidenceUseEnd" e
    JOIN "ScopedUse" u ON u."id" = e."evidenceUseId"
    WHERE e."replacementEvidenceUseId" IS NOT NULL
  )
  SELECT 1 FROM "ScopedUse" WHERE "id" = NEW."id"
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueArtifactEvidenceUseEnd_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueArtifactEvidenceUseEnd"
WHEN EXISTS (
  WITH RECURSIVE "ActiveSnapshot"("workflowRunId") AS (
    SELECT s."workflowRunId"
    FROM "RevenueArtifactReferenceSnapshotAttempt" s
    LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
    WHERE c."id" IS NULL AND julianday(s."acquiredAt") <= julianday('now') AND julianday(s."expiresAt") > julianday('now')
  ), "ScopedManifest"("id") AS (
    SELECT m."id" FROM "RevenueArtifactManifest" m JOIN "ActiveSnapshot" s ON s."workflowRunId" = m."workflowRunId"
  ), "ScopedPromotion"("id") AS (
    SELECT p."id" FROM "RevenueArtifactPromotionReceipt" p
    WHERE p."workflowRunId" IN (SELECT "workflowRunId" FROM "ActiveSnapshot")
      OR p."sourceManifestId" IN (SELECT "id" FROM "ScopedManifest")
      OR p."resultManifestId" IN (SELECT "id" FROM "ScopedManifest")
  ), "SeedUse"("id") AS (
    SELECT u."evidenceUseId" FROM "RevenueArtifactPromotionUse" u WHERE u."promotionId" IN (SELECT "id" FROM "ScopedPromotion")
    UNION
    SELECT u."evidenceUseId" FROM "RevenueArtifactManifestEvidenceUse" u
    WHERE u."manifestId" IN (SELECT "id" FROM "ScopedManifest") OR u."viaPromotionId" IN (SELECT "id" FROM "ScopedPromotion")
  ), "ScopedUse"("id") AS (
    SELECT "id" FROM "SeedUse"
    UNION
    SELECT e."replacementEvidenceUseId" FROM "RevenueArtifactEvidenceUseEnd" e
    JOIN "ScopedUse" u ON u."id" = e."evidenceUseId"
    WHERE e."replacementEvidenceUseId" IS NOT NULL
  )
  SELECT 1 FROM "ScopedUse" WHERE "id" = NEW."evidenceUseId"
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

CREATE TRIGGER "RevenueArtifactManifestAvailabilityReceipt_reference_source_freeze_insert"
BEFORE INSERT ON "RevenueArtifactManifestAvailabilityReceipt"
WHEN EXISTS (
  SELECT 1
  FROM "RevenueArtifactReferenceSnapshotAttempt" s
  JOIN "RevenueArtifactManifest" m ON m."id" = NEW."manifestId" AND m."workflowRunId" = s."workflowRunId"
  LEFT JOIN "RevenueArtifactReferenceCompletenessReceipt" c ON c."snapshotAttemptId" = s."id"
  WHERE c."id" IS NULL AND julianday(s."acquiredAt") <= julianday('now') AND julianday(s."expiresAt") > julianday('now')
)
BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_SOURCE_FROZEN'); END;

-- Source rows and transaction control records are immutable. Changes are new
-- append-only rows with new identities, never UPDATE or DELETE revisions.
CREATE TRIGGER "RevenueWorkflowRun_reference_source_immutable_update" BEFORE UPDATE ON "RevenueWorkflowRun" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowRun_reference_source_immutable_delete" BEFORE DELETE ON "RevenueWorkflowRun" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowDefinition_reference_source_immutable_update" BEFORE UPDATE ON "RevenueWorkflowDefinition" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowDefinition_reference_source_immutable_delete" BEFORE DELETE ON "RevenueWorkflowDefinition" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowDelivery_reference_source_immutable_update" BEFORE UPDATE ON "RevenueWorkflowDelivery" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowDelivery_reference_source_immutable_delete" BEFORE DELETE ON "RevenueWorkflowDelivery" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowAttempt_reference_source_immutable_update" BEFORE UPDATE ON "RevenueWorkflowAttempt" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowAttempt_reference_source_immutable_delete" BEFORE DELETE ON "RevenueWorkflowAttempt" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowLease_reference_source_immutable_update" BEFORE UPDATE ON "RevenueWorkflowLease" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowLease_reference_source_immutable_delete" BEFORE DELETE ON "RevenueWorkflowLease" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowReceiptRevision_reference_source_immutable_update" BEFORE UPDATE ON "RevenueWorkflowReceiptRevision" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowReceiptRevision_reference_source_immutable_delete" BEFORE DELETE ON "RevenueWorkflowReceiptRevision" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowAttemptClosure_reference_source_immutable_update" BEFORE UPDATE ON "RevenueWorkflowAttemptClosure" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueWorkflowAttemptClosure_reference_source_immutable_delete" BEFORE DELETE ON "RevenueWorkflowAttemptClosure" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactManifest_reference_source_immutable_update" BEFORE UPDATE ON "RevenueArtifactManifest" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactManifest_reference_source_immutable_delete" BEFORE DELETE ON "RevenueArtifactManifest" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactManifestItem_reference_source_immutable_update" BEFORE UPDATE ON "RevenueArtifactManifestItem" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactManifestItem_reference_source_immutable_delete" BEFORE DELETE ON "RevenueArtifactManifestItem" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactPromotionReceipt_reference_source_immutable_update" BEFORE UPDATE ON "RevenueArtifactPromotionReceipt" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactPromotionReceipt_reference_source_immutable_delete" BEFORE DELETE ON "RevenueArtifactPromotionReceipt" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactPromotionUse_reference_source_immutable_update" BEFORE UPDATE ON "RevenueArtifactPromotionUse" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactPromotionUse_reference_source_immutable_delete" BEFORE DELETE ON "RevenueArtifactPromotionUse" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactManifestEvidenceUse_reference_source_immutable_update" BEFORE UPDATE ON "RevenueArtifactManifestEvidenceUse" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactManifestEvidenceUse_reference_source_immutable_delete" BEFORE DELETE ON "RevenueArtifactManifestEvidenceUse" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactEvidenceUse_reference_source_immutable_update" BEFORE UPDATE ON "RevenueArtifactEvidenceUse" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactEvidenceUse_reference_source_immutable_delete" BEFORE DELETE ON "RevenueArtifactEvidenceUse" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactEvidenceUseEnd_reference_source_immutable_update" BEFORE UPDATE ON "RevenueArtifactEvidenceUseEnd" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactEvidenceUseEnd_reference_source_immutable_delete" BEFORE DELETE ON "RevenueArtifactEvidenceUseEnd" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactManifestAvailabilityReceipt_reference_source_immutable_update" BEFORE UPDATE ON "RevenueArtifactManifestAvailabilityReceipt" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactManifestAvailabilityReceipt_reference_source_immutable_delete" BEFORE DELETE ON "RevenueArtifactManifestAvailabilityReceipt" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;

CREATE TRIGGER "RevenueArtifactReferenceSnapshotAttempt_immutable_update" BEFORE UPDATE ON "RevenueArtifactReferenceSnapshotAttempt" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactReferenceSnapshotAttempt_immutable_delete" BEFORE DELETE ON "RevenueArtifactReferenceSnapshotAttempt" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactReferenceCompletenessReceipt_immutable_update" BEFORE UPDATE ON "RevenueArtifactReferenceCompletenessReceipt" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactReferenceCompletenessReceipt_immutable_delete" BEFORE DELETE ON "RevenueArtifactReferenceCompletenessReceipt" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactReferenceSourceSetProof_immutable_update" BEFORE UPDATE ON "RevenueArtifactReferenceSourceSetProof" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
CREATE TRIGGER "RevenueArtifactReferenceSourceSetProof_immutable_delete" BEFORE DELETE ON "RevenueArtifactReferenceSourceSetProof" BEGIN SELECT RAISE(ABORT, 'ARTIFACT_REFERENCE_APPEND_ONLY'); END;
