-- Final live-queue sweep after deploying stricter recipient policy. This
-- catches rows old cron ticks could have requeued between prior migrations.

UPDATE "OutreachSequenceStep"
SET
  "status" = 'SKIPPED',
  "claimedAt" = NULL,
  "claimedByRunId" = NULL,
  "errorMessage" = 'policy_ineligible_recipient',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('SCHEDULED', 'CLAIMED', 'SENDING')
  AND "sequenceId" IN (
    SELECT seq."id"
    FROM "OutreachSequence" seq
    JOIN "Lead" lead ON lead."id" = seq."leadId"
    WHERE seq."status" IN ('QUEUED', 'ACTIVE', 'SENDING')
      AND (
        lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) IN (
          'accounting', 'accounts', 'ads', 'admin', 'arborist', 'appointments',
          'available', 'billing', 'booking', 'bookings', 'careers', 'contact',
          'created', 'customerservice', 'dispatch', 'excellent', 'enquiries',
          'enquiry', 'estimate', 'estimates', 'estimating', 'frontdesk',
          'general', 'hello', 'help', 'info', 'inquiry', 'lead', 'leads',
          'ltd', 'mail', 'marketing', 'media', 'office', 'online', 'ontact',
          'operations', 'payment', 'payments', 'payroll', 'privacy',
          'privacypolicy', 'quote', 'quotes', 'reception', 'recruiting',
          'rinfo', 'sales', 'service', 'services', 'social', 'support',
          'team', 'trees', 'web', 'webmaster', 'website', 'webstore', 'welcome'
        )
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%marriott%'
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%mr. rooter%'
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%mr rooter%'
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%kent building supplies%'
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%superior propane%'
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%help international%'
      )
  );

UPDATE "OutreachSequence"
SET
  "status" = 'STOPPED',
  "stopReason" = 'POLICY_INELIGIBLE_RECIPIENT',
  "nextScheduledAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN ('QUEUED', 'ACTIVE', 'SENDING')
  AND EXISTS (
    SELECT 1
    FROM "Lead" lead
    WHERE lead."id" = "OutreachSequence"."leadId"
      AND (
        lower(substr(trim(lead."email"), 1, instr(trim(lead."email"), '@') - 1)) IN (
          'accounting', 'accounts', 'ads', 'admin', 'arborist', 'appointments',
          'available', 'billing', 'booking', 'bookings', 'careers', 'contact',
          'created', 'customerservice', 'dispatch', 'excellent', 'enquiries',
          'enquiry', 'estimate', 'estimates', 'estimating', 'frontdesk',
          'general', 'hello', 'help', 'info', 'inquiry', 'lead', 'leads',
          'ltd', 'mail', 'marketing', 'media', 'office', 'online', 'ontact',
          'operations', 'payment', 'payments', 'payroll', 'privacy',
          'privacypolicy', 'quote', 'quotes', 'reception', 'recruiting',
          'rinfo', 'sales', 'service', 'services', 'social', 'support',
          'team', 'trees', 'web', 'webmaster', 'website', 'webstore', 'welcome'
        )
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%marriott%'
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%mr. rooter%'
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%mr rooter%'
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%kent building supplies%'
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%superior propane%'
        OR lower(COALESCE(lead."businessName", '') || ' ' || COALESCE(lead."category", '')) LIKE '%help international%'
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
    lower(substr(trim("email"), 1, instr(trim("email"), '@') - 1)) IN (
      'accounting', 'accounts', 'ads', 'admin', 'arborist', 'appointments',
      'available', 'billing', 'booking', 'bookings', 'careers', 'contact',
      'created', 'customerservice', 'dispatch', 'excellent', 'enquiries',
      'enquiry', 'estimate', 'estimates', 'estimating', 'frontdesk',
      'general', 'hello', 'help', 'info', 'inquiry', 'lead', 'leads',
      'ltd', 'mail', 'marketing', 'media', 'office', 'online', 'ontact',
      'operations', 'payment', 'payments', 'payroll', 'privacy',
      'privacypolicy', 'quote', 'quotes', 'reception', 'recruiting',
      'rinfo', 'sales', 'service', 'services', 'social', 'support',
      'team', 'trees', 'web', 'webmaster', 'website', 'webstore', 'welcome'
    )
    OR lower(COALESCE("businessName", '') || ' ' || COALESCE("category", '')) LIKE '%marriott%'
    OR lower(COALESCE("businessName", '') || ' ' || COALESCE("category", '')) LIKE '%mr. rooter%'
    OR lower(COALESCE("businessName", '') || ' ' || COALESCE("category", '')) LIKE '%mr rooter%'
    OR lower(COALESCE("businessName", '') || ' ' || COALESCE("category", '')) LIKE '%kent building supplies%'
    OR lower(COALESCE("businessName", '') || ' ' || COALESCE("category", '')) LIKE '%superior propane%'
    OR lower(COALESCE("businessName", '') || ' ' || COALESCE("category", '')) LIKE '%help international%'
  );
