-- Sweep business-name/page-artifact local parts that the old "single word =
-- owner" heuristic admitted.

UPDATE "OutreachSequenceStep"
SET
  "status" = 'SKIPPED',
  "claimedAt" = NULL,
  "claimedByRunId" = NULL,
  "errorMessage" = 'company_slug_recipient',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('SCHEDULED', 'CLAIMED', 'SENDING')
  AND "sequenceId" IN (
    SELECT seq."id"
    FROM "OutreachSequence" seq
    JOIN "Lead" lead ON lead."id" = seq."leadId"
    WHERE seq."status" IN ('QUEUED', 'ACTIVE', 'SENDING')
      AND lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) IN (
        'cougartech', 'db.plumbingnow', 'dr.drain', 'drainproottawainc',
        'dsplumbing', 'etobicoke', 'located', 'metroflow', 'neptune',
        'regina', 'showroom', 'theplumbshoppe', 'unplugged', 'user'
      )
  );

UPDATE "OutreachSequence"
SET
  "status" = 'STOPPED',
  "stopReason" = 'COMPANY_SLUG_RECIPIENT',
  "nextScheduledAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('QUEUED', 'ACTIVE', 'SENDING')
  AND EXISTS (
    SELECT 1
    FROM "Lead" lead
    WHERE lead."id" = "OutreachSequence"."leadId"
      AND lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) IN (
        'cougartech', 'db.plumbingnow', 'dr.drain', 'drainproottawainc',
        'dsplumbing', 'etobicoke', 'located', 'metroflow', 'neptune',
        'regina', 'showroom', 'theplumbshoppe', 'unplugged', 'user'
      )
  );

UPDATE "Lead"
SET
  "outreachStatus" = 'NOT_CONTACTED',
  "nextFollowUpDue" = NULL,
  "lastUpdated" = CURRENT_TIMESTAMP
WHERE "firstContactedAt" IS NULL
  AND "outreachStatus" = 'READY_FOR_FIRST_TOUCH'
  AND lower(substr(trim("email"), 1, instr(trim("email"), '@') - 1)) IN (
    'cougartech', 'db.plumbingnow', 'dr.drain', 'drainproottawainc',
    'dsplumbing', 'etobicoke', 'located', 'metroflow', 'neptune',
    'regina', 'showroom', 'theplumbshoppe', 'unplugged', 'user'
  );
