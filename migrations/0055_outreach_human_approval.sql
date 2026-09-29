-- No outbound message may leave the Revenue Engine without an explicit,
-- content-bound operator approval. Editing any material field invalidates the
-- prior approval because the final send gate recomputes contentDigest.

CREATE TABLE "OutreachApproval" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "approvalKey" TEXT NOT NULL,
  "leadId" INTEGER NOT NULL,
  "sequenceId" TEXT NOT NULL,
  "sequenceStepId" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "campaignKey" TEXT,
  "variantKey" TEXT,
  "messagePolicyVersion" TEXT,
  "decision" TEXT NOT NULL DEFAULT 'PENDING',
  "decisionReason" TEXT,
  "decidedByUserId" TEXT,
  "decidedAt" DATETIME,
  "expiresAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutreachApproval_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutreachApproval_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "OutreachSequence" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutreachApproval_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "OutreachSequenceStep" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutreachApproval_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CHECK ("decision" IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE UNIQUE INDEX "OutreachApproval_approvalKey_key" ON "OutreachApproval" ("approvalKey");
CREATE INDEX "OutreachApproval_step_decision_created_idx" ON "OutreachApproval" ("sequenceStepId", "decision", "createdAt");
CREATE INDEX "OutreachApproval_lead_created_idx" ON "OutreachApproval" ("leadId", "createdAt");
