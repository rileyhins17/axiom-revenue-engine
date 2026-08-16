-- Migration 0049 initially treated every legacy replyDetectedAt timestamp as a
-- reply. Older bounce handling also populated that field, so distinguish the
-- two outcomes using the sequence's durable stopReason and repair one lead
-- projection that had drifted from its reply evidence.

DELETE FROM "FunnelEvent"
WHERE "eventType" = 'REPLY_DETECTED'
  AND "sequenceId" IN (
    SELECT "id" FROM "OutreachSequence" WHERE "stopReason" = 'BOUNCED'
  );

INSERT OR IGNORE INTO "FunnelEvent" (
  "id", "dedupeKey", "eventType", "leadId", "sequenceId", "channel", "metadataJson", "occurredAt"
)
SELECT
  'history:bounce:' || "id",
  'bounce-detected:' || "id",
  'BOUNCE_DETECTED',
  "leadId",
  "id",
  'EMAIL',
  json_object('historical', 1),
  "replyDetectedAt"
FROM "OutreachSequence"
WHERE "replyDetectedAt" IS NOT NULL AND "stopReason" = 'BOUNCED';

UPDATE "Lead"
SET
  "outreachStatus" = 'REPLIED',
  "outreachChannel" = 'EMAIL',
  "lastReplyAt" = COALESCE(
    "lastReplyAt",
    (
      SELECT MAX("replyDetectedAt")
      FROM "OutreachSequence"
      WHERE "OutreachSequence"."leadId" = "Lead"."id"
        AND "OutreachSequence"."stopReason" = 'REPLIED'
    )
  ),
  "lastUpdated" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT "leadId" FROM "OutreachSequence" WHERE "stopReason" = 'REPLIED'
);
