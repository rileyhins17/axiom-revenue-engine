-- Source-only metadata; no credentials, provider ingestion or sending authority.
-- A reviewed provider adapter must establish these identities. Legacy Gmail
-- history is not automatically promoted. All tables start empty.
CREATE TABLE "RevenueMailboxIdentity" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id"),
  "providerKey" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL UNIQUE,
  "address" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK ("state" IN ('DISCONNECTED','PAUSED','READY')),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch()),
  "retiredAt" INTEGER CHECK ("retiredAt" IS NULL OR (typeof("retiredAt")='integer' AND "retiredAt">="createdAt")),
  CHECK (length("id") BETWEEN 1 AND 256 AND instr("id",char(0))=0),
  CHECK (length("connectionId") BETWEEN 1 AND 256 AND instr("connectionId",char(0))=0),
  CHECK (length("providerKey") BETWEEN 1 AND 256 AND length("providerAccountId") BETWEEN 1 AND 256),
  CHECK (length("address") BETWEEN 3 AND 254 AND instr("address",char(0))=0)
);
CREATE UNIQUE INDEX "RevenueMailboxIdentity_current_account"
  ON "RevenueMailboxIdentity" ("providerKey","providerAccountId") WHERE "retiredAt" IS NULL;

CREATE TABLE "RevenueMailConversation" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "mailboxId" TEXT NOT NULL REFERENCES "RevenueMailboxIdentity"("id"),
  "leadId" INTEGER NOT NULL REFERENCES "Lead"("id"),
  "providerThreadId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch()),
  "retiredAt" INTEGER CHECK ("retiredAt" IS NULL OR (typeof("retiredAt")='integer' AND "retiredAt">="createdAt")),
  CHECK (length("id") BETWEEN 1 AND 256 AND instr("id",char(0))=0),
  CHECK (length("providerThreadId") BETWEEN 1 AND 256 AND instr("providerThreadId",char(0))=0)
);
CREATE UNIQUE INDEX "RevenueMailConversation_current_thread"
  ON "RevenueMailConversation" ("mailboxId","providerThreadId") WHERE "retiredAt" IS NULL;

CREATE TABLE "RevenueMailReplyTarget" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "conversationId" TEXT NOT NULL REFERENCES "RevenueMailConversation"("id"),
  "providerMessageId" TEXT NOT NULL,
  "recipientAddress" TEXT NOT NULL,
  "inReplyTo" TEXT NOT NULL,
  "referencesJson" TEXT NOT NULL CHECK (json_valid("referencesJson") AND json_type("referencesJson")='array' AND length("referencesJson")<=6000),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch()),
  "retiredAt" INTEGER CHECK ("retiredAt" IS NULL OR (typeof("retiredAt")='integer' AND "retiredAt">="createdAt")),
  CHECK (length("id") BETWEEN 1 AND 256 AND instr("id",char(0))=0),
  CHECK (length("providerMessageId") BETWEEN 1 AND 256 AND instr("providerMessageId",char(0))=0),
  CHECK (length("recipientAddress") BETWEEN 3 AND 254 AND instr("recipientAddress",char(0))=0),
  CHECK (length("inReplyTo") BETWEEN 3 AND 254 AND instr("inReplyTo",char(0))=0)
);
CREATE UNIQUE INDEX "RevenueMailReplyTarget_current_message_recipient"
  ON "RevenueMailReplyTarget" ("conversationId","providerMessageId","recipientAddress") WHERE "retiredAt" IS NULL;

CREATE TRIGGER "RevenueMailboxIdentity_insert" BEFORE INSERT ON "RevenueMailboxIdentity"
WHEN NEW."createdAt" IS NOT unixepoch() OR NEW."retiredAt" IS NOT NULL
  OR EXISTS (SELECT 1 FROM "RevenueMailboxIdentity" WHERE "id"=NEW."id" OR "connectionId"=NEW."connectionId"
    OR ("providerKey"=NEW."providerKey" AND "providerAccountId"=NEW."providerAccountId" AND "retiredAt" IS NULL))
BEGIN SELECT RAISE(ABORT,'invalid or existing mailbox identity'); END;
CREATE TRIGGER "RevenueMailboxIdentity_update" BEFORE UPDATE ON "RevenueMailboxIdentity"
WHEN NEW."id" IS NOT OLD."id" OR NEW."ownerId" IS NOT OLD."ownerId"
  OR NEW."providerKey" IS NOT OLD."providerKey" OR NEW."providerAccountId" IS NOT OLD."providerAccountId"
  OR NEW."connectionId" IS NOT OLD."connectionId" OR NEW."address" IS NOT OLD."address"
  OR NEW."createdAt" IS NOT OLD."createdAt" OR OLD."retiredAt" IS NOT NULL
  OR (NEW."retiredAt" IS NOT NULL AND NEW."retiredAt" IS NOT unixepoch())
BEGIN SELECT RAISE(ABORT,'mailbox identity cannot be rewritten or unretired'); END;
CREATE TRIGGER "RevenueMailboxIdentity_no_delete" BEFORE DELETE ON "RevenueMailboxIdentity"
BEGIN SELECT RAISE(ABORT,'mailbox identity history cannot be deleted'); END;

CREATE TRIGGER "RevenueMailConversation_insert" BEFORE INSERT ON "RevenueMailConversation"
WHEN NEW."createdAt" IS NOT unixepoch() OR NEW."retiredAt" IS NOT NULL
  OR EXISTS (SELECT 1 FROM "RevenueMailConversation" WHERE "id"=NEW."id"
    OR ("mailboxId"=NEW."mailboxId" AND "providerThreadId"=NEW."providerThreadId" AND "retiredAt" IS NULL))
  OR NOT EXISTS (SELECT 1 FROM "RevenueMailboxIdentity" WHERE "id"=NEW."mailboxId" AND "retiredAt" IS NULL)
BEGIN SELECT RAISE(ABORT,'invalid or existing mail conversation'); END;
CREATE TRIGGER "RevenueMailConversation_update" BEFORE UPDATE ON "RevenueMailConversation"
WHEN NEW."id" IS NOT OLD."id" OR NEW."mailboxId" IS NOT OLD."mailboxId"
  OR NEW."leadId" IS NOT OLD."leadId" OR NEW."providerThreadId" IS NOT OLD."providerThreadId"
  OR NEW."createdAt" IS NOT OLD."createdAt" OR OLD."retiredAt" IS NOT NULL
  OR NEW."retiredAt" IS NOT unixepoch()
BEGIN SELECT RAISE(ABORT,'mail conversation is immutable except first retirement'); END;
CREATE TRIGGER "RevenueMailConversation_no_delete" BEFORE DELETE ON "RevenueMailConversation"
BEGIN SELECT RAISE(ABORT,'mail conversation history cannot be deleted'); END;

CREATE TRIGGER "RevenueMailReplyTarget_insert" BEFORE INSERT ON "RevenueMailReplyTarget"
WHEN NEW."createdAt" IS NOT unixepoch() OR NEW."retiredAt" IS NOT NULL
  OR EXISTS (SELECT 1 FROM "RevenueMailReplyTarget" WHERE "id"=NEW."id"
    OR ("conversationId"=NEW."conversationId" AND "providerMessageId"=NEW."providerMessageId"
      AND "recipientAddress"=NEW."recipientAddress" AND "retiredAt" IS NULL))
  OR NOT EXISTS (SELECT 1 FROM "RevenueMailConversation" c JOIN "RevenueMailboxIdentity" m ON m."id"=c."mailboxId"
    WHERE c."id"=NEW."conversationId" AND c."retiredAt" IS NULL AND m."retiredAt" IS NULL)
BEGIN SELECT RAISE(ABORT,'invalid or existing reply target'); END;
CREATE TRIGGER "RevenueMailReplyTarget_update" BEFORE UPDATE ON "RevenueMailReplyTarget"
WHEN NEW."id" IS NOT OLD."id" OR NEW."conversationId" IS NOT OLD."conversationId"
  OR NEW."providerMessageId" IS NOT OLD."providerMessageId" OR NEW."recipientAddress" IS NOT OLD."recipientAddress"
  OR NEW."inReplyTo" IS NOT OLD."inReplyTo" OR NEW."referencesJson" IS NOT OLD."referencesJson"
  OR NEW."createdAt" IS NOT OLD."createdAt" OR OLD."retiredAt" IS NOT NULL
  OR NEW."retiredAt" IS NOT unixepoch()
BEGIN SELECT RAISE(ABORT,'reply target is immutable except first retirement'); END;
CREATE TRIGGER "RevenueMailReplyTarget_no_delete" BEFORE DELETE ON "RevenueMailReplyTarget"
BEGIN SELECT RAISE(ABORT,'reply target history cannot be deleted'); END;
