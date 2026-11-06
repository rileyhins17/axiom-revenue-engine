-- Close the remaining direct-SQL lineage gaps in migration 0062 before any
-- contact persistence executor exists. These are additional fail-closed insert
-- guards; they do not rewrite rows or grant runtime/persistence authority.

CREATE TRIGGER "RevenueContactDiscoveryReceipt_lineage_insert"
BEFORE INSERT ON "RevenueContactDiscoveryReceipt"
WHEN
  json_extract(NEW."resultJson", '$.completedAt') IS NOT NEW."completedAt"
  OR json_extract(NEW."resultJson", '$.mode') IS NOT NEW."mode"
  OR json_extract(NEW."resultJson", '$.adapterKind') IS NOT NEW."adapterKind"
  OR json_array_length(NEW."resultJson", '$.candidates') <> NEW."candidateCount"
  OR COALESCE((
    SELECT SUM(json_array_length(candidate.value, '$.evidenceClaims'))
    FROM json_each(NEW."resultJson", '$.candidates') candidate
  ), 0) <> NEW."evidenceUseCount"
  OR (
    SELECT COUNT(DISTINCT json_extract(evidence.value, '$.evidenceId'))
    FROM json_each(NEW."resultJson", '$.candidates') candidate
    JOIN json_each(candidate.value, '$.evidenceClaims') evidence
  ) <> NEW."evidenceClaimCount"
  OR EXISTS (
    SELECT 1 FROM json_each(NEW."resultJson", '$.candidates') candidate
    WHERE json_extract(candidate.value, '$.businessId') IS NOT NEW."businessId"
  )
  OR json_extract(NEW."resultJson", '$.authority.runtimeConnected') <> 0
  OR json_extract(NEW."resultJson", '$.authority.contactPersistenceAuthorized') <> 0
  OR json_extract(NEW."resultJson", '$.authority.verificationAuthorized') <> 0
  OR json_extract(NEW."resultJson", '$.authority.outreachAuthorized') <> 0
  OR json_extract(NEW."resultJson", '$.authority.sendAuthorized') <> 0
  OR json_extract(NEW."resultJson", '$.authority.providerOperationsAuthorized') <> 0
  OR json_extract(NEW."resultJson", '$.authority.costAuthorizedUsd') <> 0
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_RECEIPT_MISMATCH'); END;

CREATE TRIGGER "RevenueContactPoint_lineage_insert"
BEFORE INSERT ON "RevenueContactPoint"
WHEN
  json_extract(NEW."candidateJson", '$.label') IS NOT NEW."label"
  OR json_extract(NEW."candidateJson", '$.personName') IS NOT NEW."personName"
  OR json_extract(NEW."candidateJson", '$.role') IS NOT NEW."role"
  OR json_extract(NEW."candidateJson", '$.socialPlatform') IS NOT NEW."socialPlatform"
  OR json_extract(NEW."candidateJson", '$.verificationStatus') IS NOT 'NOT_VERIFIED'
  OR json_extract(NEW."candidateJson", '$.automationPermitted') <> 0
  OR NOT EXISTS (
    SELECT 1
    FROM "RevenueContactDiscoveryReceipt" receipt
    JOIN json_each(receipt."resultJson", '$.candidates') candidate
    WHERE receipt."id" = NEW."discoveryReceiptId"
      AND json_extract(candidate.value, '$.candidateId') IS NEW."candidateId"
      AND json_extract(candidate.value, '$.candidateDigest') IS NEW."candidateDigest"
      AND json(candidate.value) = json(NEW."candidateJson")
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_LINEAGE_MISMATCH'); END;

CREATE TRIGGER "RevenueContactEvidenceUse_lineage_insert"
BEFORE INSERT ON "RevenueContactEvidenceUse"
WHEN NOT EXISTS (
  SELECT 1
  FROM "RevenueContactPoint" contact
  JOIN "RevenueContactEvidenceClaim" evidence ON evidence."id" = NEW."evidenceClaimId"
  JOIN json_each(contact."candidateJson", '$.evidenceClaims') candidateEvidence
  WHERE contact."id" = NEW."contactPointId"
    AND contact."discoveryReceiptId" = NEW."discoveryReceiptId"
    AND contact."businessId" = NEW."businessId"
    AND json_extract(candidateEvidence.value, '$.evidenceId') IS NEW."evidenceClaimId"
    AND json(candidateEvidence.value) = json(evidence."evidenceJson")
)
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_EVIDENCE_LINEAGE_MISMATCH'); END;

CREATE TRIGGER "RevenueVerificationResult_payload_insert"
BEFORE INSERT ON "RevenueVerificationResult"
WHEN
  json_extract(NEW."resultJson", '$.businessId') IS NOT (
    SELECT contact."businessId" FROM "RevenueContactPoint" contact WHERE contact."id" = NEW."contactPointId"
  )
  OR json_extract(NEW."resultJson", '$.channel') IS NOT (
    SELECT contact."channel" FROM "RevenueContactPoint" contact WHERE contact."id" = NEW."contactPointId"
  )
  OR json_extract(NEW."resultJson", '$.value') IS NOT (
    SELECT contact."value" FROM "RevenueContactPoint" contact WHERE contact."id" = NEW."contactPointId"
  )
  OR json_extract(NEW."resultJson", '$.recipientKind') IS NOT (
    SELECT contact."recipientKind" FROM "RevenueContactPoint" contact WHERE contact."id" = NEW."contactPointId"
  )
  OR json(NEW."detailsJson") <> json_extract(NEW."resultJson", '$.observation')
  OR json_extract(NEW."resultJson", '$.observation.provider') IS NOT NEW."provider"
  OR json_extract(NEW."resultJson", '$.observation.sourceUrl') IS NOT NEW."sourceUrl"
  OR json_extract(NEW."resultJson", '$.observation.verifiedAt') IS NOT NEW."verifiedAt"
  OR json_extract(NEW."resultJson", '$.observation.staleAfter') IS NOT NEW."staleAfter"
  OR json_extract(NEW."resultJson", '$.ownerProjection.status') IS NOT NEW."ownerStatus"
  OR json_extract(NEW."resultJson", '$.ownerProjection.automationPermitted') <> 0
  OR json_extract(NEW."resultJson", '$.usableRoute') <> NEW."usableRoute"
  OR json_extract(NEW."resultJson", '$.recommendedAction') IS NOT NEW."recommendedAction"
  OR json_extract(NEW."resultJson", '$.consentBasis') IS NOT NEW."consentBasis"
  OR json_extract(NEW."resultJson", '$.complianceReviewRequired') <> NEW."complianceReviewRequired"
  OR json_extract(NEW."resultJson", '$.autonomousEmailEligible') <> 0
  OR json_extract(NEW."resultJson", '$.mode') IS NOT NEW."mode"
  OR json_extract(NEW."resultJson", '$.verifierKind') IS NOT NEW."verifierKind"
  OR json_extract(NEW."resultJson", '$.completedAt') IS NOT NEW."createdAt"
  OR json_extract(NEW."resultJson", '$.authority.runtimeConnected') <> 0
  OR json_extract(NEW."resultJson", '$.authority.verificationPersistenceAuthorized') <> 0
  OR json_extract(NEW."resultJson", '$.authority.qualificationPersistenceAuthorized') <> 0
  OR json_extract(NEW."resultJson", '$.authority.outreachAuthorized') <> 0
  OR json_extract(NEW."resultJson", '$.authority.sendAuthorized') <> 0
  OR json_extract(NEW."resultJson", '$.authority.providerOperationsAuthorized') <> 0
  OR json_extract(NEW."resultJson", '$.authority.costAuthorizedUsd') <> 0
BEGIN SELECT RAISE(ABORT, 'REVENUE_CONTACT_VERIFICATION_PAYLOAD_MISMATCH'); END;
