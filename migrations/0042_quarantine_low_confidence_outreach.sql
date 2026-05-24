-- Tighten the autonomous send queue after restoring recipient-quality gates.
-- Any open sequence for a low-confidence, generic, bounced, or unclassified
-- recipient is stopped so the scheduler does not spend send attempts on bad
-- contacts. Uncontacted leads are moved out of READY_FOR_FIRST_TOUCH.

UPDATE "OutreachSequenceStep"
SET
  "status" = 'SKIPPED',
  "claimedAt" = NULL,
  "claimedByRunId" = NULL,
  "errorMessage" = 'low_confidence_recipient',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('SCHEDULED', 'CLAIMED', 'SENDING')
  AND "sequenceId" IN (
    SELECT seq."id"
    FROM "OutreachSequence" seq
    JOIN "Lead" lead ON lead."id" = seq."leadId"
    WHERE seq."status" IN ('QUEUED', 'ACTIVE', 'SENDING')
      AND (
        lead."email" IS NULL
        OR trim(lead."email") = ''
        OR lower(COALESCE(lead."emailFlags", '')) LIKE '%bounced%'
        OR lower(COALESCE(lead."emailFlags", '')) LIKE '%no_mx%'
        OR lower(COALESCE(lead."emailFlags", '')) LIKE '%generic_prefix%'
        OR lower(COALESCE(lead."emailType", '')) = 'generic'
        OR lower(COALESCE(lead."emailType", '')) NOT IN ('owner', 'staff')
        OR (lower(COALESCE(lead."emailType", '')) = 'owner' AND COALESCE(lead."emailConfidence", 0) < 0.5)
        OR (lower(COALESCE(lead."emailType", '')) = 'staff' AND COALESCE(lead."emailConfidence", 0) < 0.65)
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) IN (
          'admin', 'appointments', 'booking', 'bookings', 'contact', 'customerservice',
          'dispatch', 'enquiries', 'enquiry', 'estimate', 'estimates', 'estimating',
          'frontdesk', 'general', 'hello', 'help', 'info', 'inquiry', 'lead', 'leads',
          'mail', 'marketing', 'media', 'office', 'operations', 'quote', 'quotes',
          'reception', 'sales', 'service', 'social', 'support', 'team', 'web',
          'webmaster', 'website', 'welcome'
        )
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) GLOB 'info.*'
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) GLOB 'contact.*'
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) GLOB 'sales.*'
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) GLOB 'office.*'
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) GLOB 'support.*'
      )
  );

UPDATE "OutreachSequence"
SET
  "status" = 'STOPPED',
  "stopReason" = 'LOW_CONFIDENCE_RECIPIENT',
  "nextScheduledAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('QUEUED', 'ACTIVE', 'SENDING')
  AND EXISTS (
    SELECT 1
    FROM "Lead" lead
    WHERE lead."id" = "OutreachSequence"."leadId"
      AND (
        lead."email" IS NULL
        OR trim(lead."email") = ''
        OR lower(COALESCE(lead."emailFlags", '')) LIKE '%bounced%'
        OR lower(COALESCE(lead."emailFlags", '')) LIKE '%no_mx%'
        OR lower(COALESCE(lead."emailFlags", '')) LIKE '%generic_prefix%'
        OR lower(COALESCE(lead."emailType", '')) = 'generic'
        OR lower(COALESCE(lead."emailType", '')) NOT IN ('owner', 'staff')
        OR (lower(COALESCE(lead."emailType", '')) = 'owner' AND COALESCE(lead."emailConfidence", 0) < 0.5)
        OR (lower(COALESCE(lead."emailType", '')) = 'staff' AND COALESCE(lead."emailConfidence", 0) < 0.65)
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) IN (
          'admin', 'appointments', 'booking', 'bookings', 'contact', 'customerservice',
          'dispatch', 'enquiries', 'enquiry', 'estimate', 'estimates', 'estimating',
          'frontdesk', 'general', 'hello', 'help', 'info', 'inquiry', 'lead', 'leads',
          'mail', 'marketing', 'media', 'office', 'operations', 'quote', 'quotes',
          'reception', 'sales', 'service', 'social', 'support', 'team', 'web',
          'webmaster', 'website', 'welcome'
        )
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) GLOB 'info.*'
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) GLOB 'contact.*'
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) GLOB 'sales.*'
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) GLOB 'office.*'
        OR lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) GLOB 'support.*'
      )
  );

UPDATE "Lead"
SET
  "outreachStatus" = 'NOT_CONTACTED',
  "nextFollowUpDue" = NULL,
  "lastUpdated" = CURRENT_TIMESTAMP
WHERE "firstContactedAt" IS NULL
  AND "outreachStatus" = 'READY_FOR_FIRST_TOUCH'
  AND (
    "email" IS NULL
    OR trim("email") = ''
    OR lower(COALESCE("emailFlags", '')) LIKE '%bounced%'
    OR lower(COALESCE("emailFlags", '')) LIKE '%no_mx%'
    OR lower(COALESCE("emailFlags", '')) LIKE '%generic_prefix%'
    OR lower(COALESCE("emailType", '')) = 'generic'
    OR lower(COALESCE("emailType", '')) NOT IN ('owner', 'staff')
    OR (lower(COALESCE("emailType", '')) = 'owner' AND COALESCE("emailConfidence", 0) < 0.5)
    OR (lower(COALESCE("emailType", '')) = 'staff' AND COALESCE("emailConfidence", 0) < 0.65)
    OR lower(substr(trim("email"), 1, instr(trim("email"), '@') - 1)) IN (
      'admin', 'appointments', 'booking', 'bookings', 'contact', 'customerservice',
      'dispatch', 'enquiries', 'enquiry', 'estimate', 'estimates', 'estimating',
      'frontdesk', 'general', 'hello', 'help', 'info', 'inquiry', 'lead', 'leads',
      'mail', 'marketing', 'media', 'office', 'operations', 'quote', 'quotes',
      'reception', 'sales', 'service', 'social', 'support', 'team', 'web',
      'webmaster', 'website', 'welcome'
    )
    OR lower(substr(trim("email"), 1, instr(trim("email"), '@') - 1)) GLOB 'info.*'
    OR lower(substr(trim("email"), 1, instr(trim("email"), '@') - 1)) GLOB 'contact.*'
    OR lower(substr(trim("email"), 1, instr(trim("email"), '@') - 1)) GLOB 'sales.*'
    OR lower(substr(trim("email"), 1, instr(trim("email"), '@') - 1)) GLOB 'office.*'
    OR lower(substr(trim("email"), 1, instr(trim("email"), '@') - 1)) GLOB 'support.*'
  );
