-- Cloud website check for businesses that list a website (DiscoveryHeld). It runs on
-- Cloudflare's browser, never on anyone's computer. Each check records the label and
-- reasons it reached and the capture/rules versions it used; a site that will not load
-- is retried, then marked FAILED. Additive only: existing rows keep their values.
ALTER TABLE "DiscoveryHeld" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0);
ALTER TABLE "DiscoveryHeld" ADD COLUMN "checkedAt" TEXT CHECK ("checkedAt" IS NULL OR length("checkedAt") <= 40);
ALTER TABLE "DiscoveryHeld" ADD COLUMN "label" TEXT CHECK ("label" IS NULL OR "label" IN ('STRONG', 'WEAK', 'WRONG'));
ALTER TABLE "DiscoveryHeld" ADD COLUMN "reasons" TEXT CHECK ("reasons" IS NULL OR length("reasons") <= 2000);
ALTER TABLE "DiscoveryHeld" ADD COLUMN "finalUrl" TEXT CHECK ("finalUrl" IS NULL OR length("finalUrl") <= 300);
ALTER TABLE "DiscoveryHeld" ADD COLUMN "checkVersion" TEXT CHECK ("checkVersion" IS NULL OR length("checkVersion") <= 120);
ALTER TABLE "DiscoveryHeld" ADD COLUMN "prospectId" TEXT CHECK ("prospectId" IS NULL OR length("prospectId") <= 300);
ALTER TABLE "DiscoveryHeld" ADD COLUMN "lastError" TEXT CHECK ("lastError" IS NULL OR length("lastError") <= 300);
CREATE INDEX "DiscoveryHeld_status_idx" ON "DiscoveryHeld" ("status", "firstSeenAt");

-- One row per check run, so owners can see what was checked and when.
CREATE TABLE "SiteCheckRun" (
  "runId" TEXT NOT NULL PRIMARY KEY CHECK (length("runId") BETWEEN 1 AND 120),
  "startedAt" TEXT NOT NULL,
  "finishedAt" TEXT,
  "checked" INTEGER NOT NULL DEFAULT 0 CHECK ("checked" >= 0),
  "strong" INTEGER NOT NULL DEFAULT 0 CHECK ("strong" >= 0),
  "weak" INTEGER NOT NULL DEFAULT 0 CHECK ("weak" >= 0),
  "wrong" INTEGER NOT NULL DEFAULT 0 CHECK ("wrong" >= 0),
  "failed" INTEGER NOT NULL DEFAULT 0 CHECK ("failed" >= 0),
  "stopReason" TEXT CHECK ("stopReason" IS NULL OR length("stopReason") <= 200)
);
CREATE TRIGGER "SiteCheckRun_no_delete" BEFORE DELETE ON "SiteCheckRun"
BEGIN SELECT RAISE(ABORT, 'SITE_CHECK_RUN_NO_DELETE'); END;
