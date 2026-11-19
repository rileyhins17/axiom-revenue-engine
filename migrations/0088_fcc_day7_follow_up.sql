-- The FCC day-7 follow-up (Aidan's text, approved Oct 29): a third email in the
-- first email's thread. FccCampaignSend."step" allowed only 1 and 2, and SQLite
-- can't change a CHECK in place, so this rebuilds the table with the same
-- columns, rows (rowids included), indexes and triggers; only the CHECK on
-- "step" now also allows 3.
-- FccCampaignSend is a child (it references FccCampaignContact) and nothing
-- references it, so dropping it trips no RESTRICT (docs/GOTCHAS.md DATA-014).
-- The triggers keep their WHEN form, with nothing but RAISE in the body
-- (DATA-015). FccCampaignContact is unchanged: a contact who got the day-7
-- email stays 'step2_sent', and their step-3 send row records it.
CREATE TABLE "_m0088_send" AS SELECT rowid AS "_rowid", * FROM "FccCampaignSend";
DROP TRIGGER "FccCampaignSend_no_delete";
DROP TRIGGER "FccCampaignSend_forward_only";
DROP TABLE "FccCampaignSend";

CREATE TABLE "FccCampaignSend" (
  "sendId" TEXT PRIMARY KEY NOT NULL,
  "contactId" TEXT NOT NULL,
  "step" INTEGER NOT NULL CHECK ("step" IN (1, 2, 3)),
  "email" TEXT NOT NULL,
  "sendDay" TEXT NOT NULL CHECK (length("sendDay") = 10),
  "messageId" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('CLAIMED', 'SENT', 'FAILED')),
  "detail" TEXT CHECK ("detail" IS NULL OR length("detail") <= 300),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "finishedAt" TEXT,
  "senderAddress" TEXT,
  FOREIGN KEY ("contactId") REFERENCES "FccCampaignContact" ("id") ON DELETE RESTRICT
);
INSERT INTO "FccCampaignSend" (rowid, "sendId", "contactId", "step", "email", "sendDay", "messageId", "status", "detail", "createdAt", "finishedAt", "senderAddress")
  SELECT "_rowid", "sendId", "contactId", "step", "email", "sendDay", "messageId", "status", "detail", "createdAt", "finishedAt", "senderAddress"
  FROM "_m0088_send" ORDER BY "_rowid";
DROP TABLE "_m0088_send";

CREATE UNIQUE INDEX IF NOT EXISTS "FccCampaignSend_contact_step_key" ON "FccCampaignSend" ("contactId", "step") WHERE "status" <> 'FAILED';
CREATE INDEX IF NOT EXISTS "FccCampaignSend_day_idx" ON "FccCampaignSend" ("sendDay");
CREATE INDEX IF NOT EXISTS "FccCampaignSend_day_sender_idx" ON "FccCampaignSend" ("sendDay", "senderAddress");
CREATE TRIGGER IF NOT EXISTS "FccCampaignSend_no_delete" BEFORE DELETE ON "FccCampaignSend"
BEGIN SELECT RAISE(ABORT, 'FCC_CAMPAIGN_SEND_NO_DELETE'); END;
CREATE TRIGGER IF NOT EXISTS "FccCampaignSend_forward_only" BEFORE UPDATE ON "FccCampaignSend"
WHEN OLD."status" <> 'CLAIMED' OR NEW."contactId" <> OLD."contactId" OR NEW."step" <> OLD."step" OR NEW."messageId" <> OLD."messageId"
BEGIN SELECT RAISE(ABORT, 'FCC_CAMPAIGN_SEND_FORWARD_ONLY'); END;
