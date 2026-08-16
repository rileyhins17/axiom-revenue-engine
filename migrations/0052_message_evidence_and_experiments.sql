-- Preserve the evidence and deterministic experiment assignment behind every
-- generated outreach step. Nullable columns keep historical messages honest:
-- old sends were not generated under this policy and must not be attributed to it.

ALTER TABLE "OutreachSequenceStep" ADD COLUMN "messagePolicyVersion" TEXT;
ALTER TABLE "OutreachSequenceStep" ADD COLUMN "campaignKey" TEXT;
ALTER TABLE "OutreachSequenceStep" ADD COLUMN "variantKey" TEXT;
ALTER TABLE "OutreachSequenceStep" ADD COLUMN "evidenceJson" TEXT;
ALTER TABLE "OutreachSequenceStep" ADD COLUMN "observedIssue" TEXT;
ALTER TABLE "OutreachSequenceStep" ADD COLUMN "ctaType" TEXT;
ALTER TABLE "OutreachSequenceStep" ADD COLUMN "confidenceScore" INTEGER;
ALTER TABLE "OutreachSequenceStep" ADD COLUMN "validationStatus" TEXT;

CREATE INDEX "OutreachSequenceStep_campaignKey_variantKey_status_idx"
  ON "OutreachSequenceStep" ("campaignKey", "variantKey", "status");

CREATE INDEX "OutreachSequenceStep_messagePolicyVersion_createdAt_idx"
  ON "OutreachSequenceStep" ("messagePolicyVersion", "createdAt");
