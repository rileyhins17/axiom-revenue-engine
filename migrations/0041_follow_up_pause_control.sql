-- Manual follow-up pause control. Lets operators halt all follow-up sends from
-- the UI without touching env vars or redeploying. Initial outreach continues.
--
-- Replaces the broken env-var path (AUTONOMOUS_MAX_FOLLOW_UP_SENDS_PER_DAY=0)
-- which silently failed because module-level env cache in env.ts could capture
-- defaults before bindings were available. DB-driven flag is read fresh on
-- every scheduler tick via the settings query already in the hot path.

ALTER TABLE "OutreachAutomationSetting"
ADD COLUMN "followUpsPaused" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OutreachAutomationSetting"
ADD COLUMN "followUpsPausedAt" DATETIME;

ALTER TABLE "OutreachAutomationSetting"
ADD COLUMN "followUpsPausedBy" TEXT;

-- Default behavior: follow-ups paused on (kill switch active).
-- Operator must explicitly flip to off via Settings UI before follow-ups send.
UPDATE "OutreachAutomationSetting"
SET
  "followUpsPaused" = 1,
  "followUpsPausedAt" = CURRENT_TIMESTAMP,
  "followUpsPausedBy" = 'system:migration_0041',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'global';
