-- Remove role/business-department inboxes that the old validator mislabeled
-- as owners from the live autonomous first-touch queue.

UPDATE "Lead"
SET
  "email" = lower(trim(replace("email", '%20', ''))),
  "lastUpdated" = CURRENT_TIMESTAMP
WHERE "email" IS NOT NULL
  AND instr(lower("email"), '%20') > 0;

UPDATE "OutreachSequenceStep"
SET
  "status" = 'SKIPPED',
  "claimedAt" = NULL,
  "claimedByRunId" = NULL,
  "errorMessage" = 'role_mailbox_recipient',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('SCHEDULED', 'CLAIMED', 'SENDING')
  AND "sequenceId" IN (
    SELECT seq."id"
    FROM "OutreachSequence" seq
    JOIN "Lead" lead ON lead."id" = seq."leadId"
    WHERE seq."status" IN ('QUEUED', 'ACTIVE', 'SENDING')
      AND lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) IN (
        'accounting', 'accounts', 'arborist', 'billing', 'careers', 'ltd',
        'payment', 'payments', 'payroll', 'recruiting', 'trees'
      )
  );

UPDATE "OutreachSequence"
SET
  "status" = 'STOPPED',
  "stopReason" = 'ROLE_MAILBOX_RECIPIENT',
  "nextScheduledAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('QUEUED', 'ACTIVE', 'SENDING')
  AND EXISTS (
    SELECT 1
    FROM "Lead" lead
    WHERE lead."id" = "OutreachSequence"."leadId"
      AND lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) IN (
        'accounting', 'accounts', 'arborist', 'billing', 'careers', 'ltd',
        'payment', 'payments', 'payroll', 'recruiting', 'trees'
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
    'accounting', 'accounts', 'arborist', 'billing', 'careers', 'ltd',
    'payment', 'payments', 'payroll', 'recruiting', 'trees'
  );
