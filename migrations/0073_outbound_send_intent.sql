-- Source-only: apply only under a separately approved backup/release gate.
-- This ledger is not authorization to send. Policy/budget claims must be composed
-- atomically by the shared dispatcher before either outbound caller is activated.
-- UTC billing months; no row is seeded here. A reviewed accounting import must
-- include subscriptions/other provider commitments before unpausing a month.
CREATE TABLE "RuntimeBudgetMonth" (
  "month" TEXT PRIMARY KEY NOT NULL CHECK (typeof("month") = 'text'
    AND length("month") = 7 AND instr("month", char(0)) = 0 AND "month" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
    AND substr("month", 6, 2) BETWEEN '01' AND '12'),
  "currency" TEXT NOT NULL DEFAULT 'CAD' CHECK ("currency" = 'CAD'),
  "ceilingCents" INTEGER NOT NULL CHECK (typeof("ceilingCents") = 'integer' AND "ceilingCents" BETWEEN 0 AND 5000),
  "committedCents" INTEGER NOT NULL CHECK (typeof("committedCents") = 'integer' AND "committedCents" BETWEEN 0 AND 9007199254740991),
  "accountingDigest" TEXT NOT NULL CHECK (typeof("accountingDigest") = 'text' AND length("accountingDigest") = 64
    AND "accountingDigest" NOT GLOB '*[^a-f0-9]*' AND instr("accountingDigest", char(0)) = 0),
  "paused" INTEGER NOT NULL DEFAULT 1 CHECK ("paused" IN (0, 1)),
  -- Accounting must be able to record already-incurred excess costs honestly,
  -- but an overcommitted month can only exist in a paused, non-spendable state.
  CHECK ("committedCents" <= "ceilingCents" OR "paused" = 1)
);
CREATE TRIGGER "RuntimeBudgetMonth_no_reset" BEFORE UPDATE ON "RuntimeBudgetMonth"
WHEN NEW."month" IS NOT OLD."month" OR NEW."currency" IS NOT OLD."currency"
  OR NEW."committedCents" < OLD."committedCents"
BEGIN SELECT RAISE(ABORT, 'budget identity or committed spend cannot reset'); END;
CREATE TRIGGER "RuntimeBudgetMonth_no_replace" BEFORE INSERT ON "RuntimeBudgetMonth"
WHEN EXISTS (SELECT 1 FROM "RuntimeBudgetMonth" WHERE "month" = NEW."month")
BEGIN SELECT RAISE(ABORT, 'budget month already exists'); END;
CREATE TRIGGER "RuntimeBudgetMonth_no_delete" BEFORE DELETE ON "RuntimeBudgetMonth"
BEGIN SELECT RAISE(ABORT, 'budget history requires reviewed maintenance'); END;

CREATE TABLE "OutboundSendIntent" (
  "id" TEXT PRIMARY KEY NOT NULL CHECK (length("id") = 64 AND "id" NOT GLOB '*[^a-f0-9]*'),
  "attemptToken" TEXT NOT NULL UNIQUE CHECK (length("attemptToken") = 32 AND "attemptToken" NOT GLOB '*[^a-f0-9]*'),
  "ownerId" TEXT NOT NULL CHECK (length("ownerId") BETWEEN 1 AND 256),
  "mailboxId" TEXT NOT NULL CHECK (length("mailboxId") BETWEEN 1 AND 256),
  "operationKey" TEXT NOT NULL CHECK (length("operationKey") BETWEEN 1 AND 256),
  "payloadDigest" TEXT NOT NULL CHECK (length("payloadDigest") = 64 AND "payloadDigest" NOT GLOB '*[^a-f0-9]*'),
  "mode" TEXT NOT NULL CHECK ("mode" IN ('MANUAL_REPLY', 'AUTOMATED')),
  "rfcMessageId" TEXT NOT NULL UNIQUE CHECK (length("rfcMessageId") BETWEEN 3 AND 254),
  "budgetMonth" TEXT NOT NULL REFERENCES "RuntimeBudgetMonth"("month"),
  "reservedCostCents" INTEGER NOT NULL CHECK (typeof("reservedCostCents") = 'integer' AND "reservedCostCents" BETWEEN 0 AND 5000),
  "state" TEXT NOT NULL DEFAULT 'DISPATCHING'
    CHECK ("state" IN ('DISPATCHING', 'UNKNOWN', 'SENT', 'REJECTED')),
  "providerMessageId" TEXT,
  "providerThreadId" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (typeof("createdAt") = 'integer' AND "createdAt" >= 0),
  "updatedAt" INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (typeof("updatedAt") = 'integer' AND "updatedAt" >= 0),
  UNIQUE ("ownerId", "operationKey"),
  CHECK (typeof("id") = 'text' AND typeof("attemptToken") = 'text'
    AND typeof("ownerId") = 'text' AND typeof("mailboxId") = 'text'
    AND typeof("operationKey") = 'text' AND typeof("payloadDigest") = 'text'
    AND typeof("rfcMessageId") = 'text'),
  CHECK ("providerMessageId" IS NULL OR typeof("providerMessageId") = 'text'),
  CHECK ("providerThreadId" IS NULL OR typeof("providerThreadId") = 'text'),
  CHECK (instr("id", char(0)) = 0 AND instr("attemptToken", char(0)) = 0
    AND instr("payloadDigest", char(0)) = 0),
  CHECK ("ownerId" NOT GLOB '*[^!-~]*' AND instr("ownerId", char(0)) = 0),
  CHECK ("mailboxId" NOT GLOB '*[^!-~]*' AND instr("mailboxId", char(0)) = 0),
  CHECK ("operationKey" NOT GLOB '*[^!-~]*' AND instr("operationKey", char(0)) = 0),
  CHECK ("providerMessageId" IS NULL OR
    ("providerMessageId" NOT GLOB '*[^!-~]*' AND instr("providerMessageId", char(0)) = 0)),
  CHECK ("providerThreadId" IS NULL OR
    ("providerThreadId" NOT GLOB '*[^!-~]*' AND instr("providerThreadId", char(0)) = 0)),
  CHECK (instr("rfcMessageId", char(0)) = 0
    AND substr("rfcMessageId", 1, 1) = '<' AND substr("rfcMessageId", -1) = '>'
    AND instr("rfcMessageId", '@') BETWEEN 3 AND length("rfcMessageId") - 2
    AND substr("rfcMessageId", 2, instr("rfcMessageId", '@') - 2) NOT GLOB '*[^A-Za-z0-9._-]*'
    AND substr("rfcMessageId", instr("rfcMessageId", '@') + 1,
      length("rfcMessageId") - instr("rfcMessageId", '@') - 1) NOT GLOB '*[^A-Za-z0-9.-]*'),
  CHECK ("createdAt" <= 9007199254740991 AND "updatedAt" <= 9007199254740991),
  CHECK ("updatedAt" >= "createdAt"),
  CHECK (("state" = 'SENT' AND length("providerMessageId") BETWEEN 1 AND 256
          AND length("providerThreadId") BETWEEN 1 AND 256
          AND "providerMessageId" IS NOT NULL AND "providerThreadId" IS NOT NULL)
    OR ("state" <> 'SENT' AND "providerMessageId" IS NULL AND "providerThreadId" IS NULL))
);

CREATE TRIGGER "OutboundSendIntent_initial"
BEFORE INSERT ON "OutboundSendIntent"
WHEN NEW."state" <> 'DISPATCHING' OR NEW."providerMessageId" IS NOT NULL
  OR NEW."providerThreadId" IS NOT NULL
  OR EXISTS (SELECT 1 FROM "OutboundSendIntent" old WHERE old."id" = NEW."id"
    OR (old."ownerId" = NEW."ownerId" AND old."operationKey" = NEW."operationKey")
    OR old."rfcMessageId" = NEW."rfcMessageId" OR old."attemptToken" = NEW."attemptToken")
BEGIN
  SELECT RAISE(ABORT, 'invalid outbound initial state');
END;

CREATE TRIGGER "OutboundSendIntent_transition"
BEFORE UPDATE ON "OutboundSendIntent"
WHEN NEW."id" IS NOT OLD."id" OR NEW."attemptToken" IS NOT OLD."attemptToken"
  OR NEW."ownerId" IS NOT OLD."ownerId"
  OR NEW."mailboxId" IS NOT OLD."mailboxId"
  OR NEW."operationKey" IS NOT OLD."operationKey"
  OR NEW."payloadDigest" IS NOT OLD."payloadDigest"
  OR NEW."mode" IS NOT OLD."mode"
  OR NEW."rfcMessageId" IS NOT OLD."rfcMessageId"
  OR NEW."budgetMonth" IS NOT OLD."budgetMonth" OR NEW."reservedCostCents" IS NOT OLD."reservedCostCents"
  OR NEW."createdAt" IS NOT OLD."createdAt" OR NEW."updatedAt" < OLD."updatedAt"
  OR NOT ((OLD."state" = 'DISPATCHING' AND NEW."state" IN ('UNKNOWN', 'SENT', 'REJECTED'))
    OR (OLD."state" = 'UNKNOWN' AND NEW."state" = 'SENT'))
BEGIN
  SELECT RAISE(ABORT, 'invalid outbound transition');
END;

-- This trigger participates in the exact INSERT statement transaction. Any
-- budget rejection rolls the intent insertion back, including RETURNING results.
CREATE TRIGGER "OutboundSendIntent_reserve_budget" AFTER INSERT ON "OutboundSendIntent"
BEGIN
  UPDATE "RuntimeBudgetMonth"
    SET "committedCents" = "committedCents" + NEW."reservedCostCents"
    WHERE "month" = NEW."budgetMonth" AND "month" = strftime('%Y-%m', 'now')
      AND "paused" = 0 AND "ceilingCents" > 0 AND "committedCents" < "ceilingCents"
      AND "committedCents" <= "ceilingCents" - NEW."reservedCostCents";
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'outbound budget unavailable') END;
END;

CREATE TRIGGER "OutboundSendIntent_no_delete"
BEFORE DELETE ON "OutboundSendIntent"
BEGIN
  SELECT RAISE(ABORT, 'outbound intent retention requires reviewed maintenance');
END;
