-- Harden migration 0065 without rewriting its applied append-only contract.
-- Require content-derived receipt identity plus a duplicate-free, bidirectional
-- verification-result set. This adds one insert guard and mutates no rows.

CREATE TRIGGER "RevenuePrivateKwContactPersistenceReceipt_identity_insert"
BEFORE INSERT ON "RevenuePrivateKwContactPersistenceReceipt"
WHEN
  NEW."id" <> 'kw-contact-persistence:' || NEW."materializationDigest"
  OR json_extract(NEW."materializationJson", '$.materializationVersion') IS NOT NEW."materializationVersion"
  OR (SELECT COUNT(DISTINCT expected.value) FROM json_each(NEW."verificationResultIdsJson") expected)
      <> NEW."verificationResultCount"
  OR EXISTS (
    SELECT 1
    FROM "RevenueVerificationResult" verification
    JOIN "RevenueContactPoint" contact ON contact."id" = verification."contactPointId"
    WHERE contact."discoveryReceiptId" = NEW."discoveryReceiptId"
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW."verificationResultIdsJson") expected
        WHERE expected.value = verification."verificationResultId"
      )
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_CONTACT_PERSISTENCE_IDENTITY_MISMATCH'); END;
