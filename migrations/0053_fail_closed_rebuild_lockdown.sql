-- Revenue Engine rebuild safety lockdown.
--
-- This corrective migration intentionally leaves the legacy engine stopped.
-- Enabling a future phase requires an approved rollout with the matching
-- repository switch, database policy, mailbox health, budget, and approval gate.

UPDATE "OutreachAutomationSetting"
SET
  "enabled" = 0,
  "globalPaused" = 1,
  "emergencyPaused" = 1,
  "emergencyPausedAt" = CURRENT_TIMESTAMP,
  "emergencyPausedBy" = 'system:migration_0053',
  "emergencyPauseReason" = 'Axiom Revenue Engine controlled rebuild',
  "intakePaused" = 1,
  "intakePausedAt" = CURRENT_TIMESTAMP,
  "intakePausedBy" = 'system:migration_0053',
  "followUpsPaused" = 1,
  "followUpsPausedAt" = CURRENT_TIMESTAMP,
  "followUpsPausedBy" = 'system:migration_0053',
  "weekdaysOnly" = 1,
  "sendWindowStartHour" = 9,
  "sendWindowStartMinute" = 0,
  "sendWindowEndHour" = 16,
  "sendWindowEndMinute" = 30,
  "schedulerClaimBatch" = 2,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'global';

UPDATE "OutreachMailbox"
SET
  "dailyLimit" = MIN("dailyLimit", 5),
  "hourlyLimit" = MIN("hourlyLimit", 1),
  "minDelaySeconds" = MAX("minDelaySeconds", 3600),
  "maxDelaySeconds" = MAX("maxDelaySeconds", 7200),
  "updatedAt" = CURRENT_TIMESTAMP;
