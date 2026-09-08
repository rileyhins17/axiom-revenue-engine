-- Source-only production shape for owner-auth idempotency and a transactional
-- outbox. This migration is intentionally not applied by any local, staging,
-- or production command in this checkpoint.
--
-- The future D1 adapter must execute reservation, the operation-specific
-- mutation, finalization, and outbox insertion in one D1 batch. A retry that
-- sees COMMITTED must skip the mutation and return the exact stored result.
-- The outbox is an immutable owner-operation event; delivery state may advance
-- only through the guarded transition below. Nothing here grants route,
-- progress, provider, outreach, send, deployment, or cost authority.

CREATE TABLE "RevenuePrivateKwOwnerAuthIdempotency" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recordVersion" TEXT NOT NULL,
  "recordKind" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "boundaryId" TEXT NOT NULL,
  "boundaryDigest" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "recordId" TEXT,
  "recordDigest" TEXT,
  "resultDigest" TEXT,
  "resultJson" TEXT,
  "reservedAt" DATETIME NOT NULL,
  "committedAt" DATETIME,
  "recordedAt" DATETIME,
  "transactionKind" TEXT NOT NULL,
  "recordScope" TEXT NOT NULL,
  "outboxRequired" INTEGER NOT NULL DEFAULT 1,
  "mutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "databaseMutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "routeAuthorized" INTEGER NOT NULL DEFAULT 0,
  "uiMutationAuthorized" INTEGER NOT NULL DEFAULT 0,
  "outreachAuthorized" INTEGER NOT NULL DEFAULT 0,
  "sendAuthorized" INTEGER NOT NULL DEFAULT 0,
  "deploymentAuthorized" INTEGER NOT NULL DEFAULT 0,
  "providerOperationsAuthorized" INTEGER NOT NULL DEFAULT 0,
  "costAuthorizedUsd" REAL NOT NULL DEFAULT 0,
  CHECK ("recordVersion" = 'kw-owner-auth-idempotency-v1'),
  CHECK ("recordKind" = 'OWNER_AUTH_MUTATION_IDEMPOTENCY'),
  CHECK ("state" IN ('RESERVED', 'COMMITTED')),
  CHECK ("id" = "idempotencyKey"),
  CHECK ("idempotencyKey" GLOB 'kw-owner-mutation-idempotency:[0-9a-f]*' AND length("idempotencyKey") = 94),
  CHECK ("boundaryId" GLOB 'kw-owner-auth-server-boundary:[0-9a-f]*' AND length("boundaryId") = 94),
  CHECK (length("boundaryDigest") = 64 AND "boundaryDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("owner" IN ('RILEY', 'AIDAN')),
  CHECK ("operation" GLOB '[a-z]*' AND length("operation") >= 3 AND length("operation") <= 160),
  CHECK (length("payloadDigest") = 64 AND "payloadDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("recordId" IS NULL OR ("recordId" GLOB 'kw-owner-auth-idempotency:[0-9a-f]*' AND length("recordId") = 90)),
  CHECK ("recordDigest" IS NULL OR (length("recordDigest") = 64 AND "recordDigest" NOT GLOB '*[^0-9a-f]*')),
  CHECK ("resultDigest" IS NULL OR (length("resultDigest") = 64 AND "resultDigest" NOT GLOB '*[^0-9a-f]*')),
  CHECK (("state" = 'RESERVED' AND "recordId" IS NULL AND "recordDigest" IS NULL AND "resultDigest" IS NULL AND "resultJson" IS NULL AND "committedAt" IS NULL AND "recordedAt" IS NULL) OR ("state" = 'COMMITTED' AND "recordId" IS NOT NULL AND "recordDigest" IS NOT NULL AND "resultDigest" IS NOT NULL AND "resultJson" IS NOT NULL AND "committedAt" IS NOT NULL AND "recordedAt" IS NOT NULL)),
  CHECK ("state" = 'RESERVED' OR (json_valid("resultJson") AND json_type("resultJson") = 'object')),
  CHECK (julianday("reservedAt") IS NOT NULL),
  CHECK ("committedAt" IS NULL OR julianday("committedAt") IS NOT NULL),
  CHECK ("recordedAt" IS NULL OR julianday("recordedAt") IS NOT NULL),
  CHECK ("committedAt" IS NULL OR julianday("committedAt") >= julianday("reservedAt")),
  CHECK ("recordedAt" IS NULL OR julianday("recordedAt") >= julianday("reservedAt")),
  CHECK ("transactionKind" = 'D1_BATCH'),
  CHECK ("recordScope" = 'OWNER_AUTH_MUTATION_IDEMPOTENCY_ONLY'),
  CHECK ("outboxRequired" = 1),
  CHECK ("mutationAuthorized" = 0),
  CHECK ("databaseMutationAuthorized" = 0),
  CHECK ("routeAuthorized" = 0),
  CHECK ("uiMutationAuthorized" = 0),
  CHECK ("outreachAuthorized" = 0),
  CHECK ("sendAuthorized" = 0),
  CHECK ("deploymentAuthorized" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0)
);

CREATE UNIQUE INDEX "RevenuePrivateKwOwnerAuthIdempotency_key_key"
  ON "RevenuePrivateKwOwnerAuthIdempotency" ("idempotencyKey");
CREATE UNIQUE INDEX "RevenuePrivateKwOwnerAuthIdempotency_record_key"
  ON "RevenuePrivateKwOwnerAuthIdempotency" ("recordId")
  WHERE "recordId" IS NOT NULL;
CREATE INDEX "RevenuePrivateKwOwnerAuthIdempotency_state_reserved_idx"
  ON "RevenuePrivateKwOwnerAuthIdempotency" ("state", "reservedAt");

CREATE TRIGGER "RevenuePrivateKwOwnerAuthIdempotency_contract_insert"
BEFORE INSERT ON "RevenuePrivateKwOwnerAuthIdempotency"
WHEN
  NEW."id" <> NEW."idempotencyKey"
  OR NEW."state" = 'COMMITTED' AND NEW."recordId" <> 'kw-owner-auth-idempotency:' || NEW."recordDigest"
  OR NEW."state" = 'COMMITTED' AND (
    json_extract(NEW."resultJson", '$.recordVersion') IS NOT NEW."recordVersion"
    OR json_extract(NEW."resultJson", '$.recordKind') IS NOT NEW."recordKind"
    OR json_extract(NEW."resultJson", '$.recordId') IS NOT NEW."recordId"
    OR json_extract(NEW."resultJson", '$.recordDigest') IS NOT NEW."recordDigest"
    OR json_extract(NEW."resultJson", '$.idempotencyKey') IS NOT NEW."idempotencyKey"
    OR json_extract(NEW."resultJson", '$.boundaryId') IS NOT NEW."boundaryId"
    OR json_extract(NEW."resultJson", '$.boundaryDigest') IS NOT NEW."boundaryDigest"
    OR json_extract(NEW."resultJson", '$.owner') IS NOT NEW."owner"
    OR json_extract(NEW."resultJson", '$.operation') IS NOT NEW."operation"
    OR json_extract(NEW."resultJson", '$.payloadDigest') IS NOT NEW."payloadDigest"
    OR json_extract(NEW."resultJson", '$.resultDigest') IS NOT NEW."resultDigest"
    OR json_extract(NEW."resultJson", '$.state') IS NOT NEW."state"
    OR json_extract(NEW."resultJson", '$.authority.mutationAuthorized') IS NOT 0
    OR json_extract(NEW."resultJson", '$.authority.databaseMutationAuthorized') IS NOT 0
    OR json_extract(NEW."resultJson", '$.authority.routeAuthorized') IS NOT 0
    OR json_extract(NEW."resultJson", '$.authority.uiMutationAuthorized') IS NOT 0
    OR json_extract(NEW."resultJson", '$.authority.outreachAuthorized') IS NOT 0
    OR json_extract(NEW."resultJson", '$.authority.sendAuthorized') IS NOT 0
    OR json_extract(NEW."resultJson", '$.authority.deploymentAuthorized') IS NOT 0
    OR json_extract(NEW."resultJson", '$.authority.providerOperationsAuthorized') IS NOT 0
    OR json_extract(NEW."resultJson", '$.authority.costAuthorizedUsd') IS NOT 0
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_CONTRACT_MISMATCH'); END;

CREATE TRIGGER "RevenuePrivateKwOwnerAuthIdempotency_transition_update"
BEFORE UPDATE ON "RevenuePrivateKwOwnerAuthIdempotency"
WHEN
  OLD."state" <> 'RESERVED'
  OR NEW."state" <> 'COMMITTED'
  OR NEW."id" <> OLD."id"
  OR NEW."recordVersion" <> OLD."recordVersion"
  OR NEW."recordKind" <> OLD."recordKind"
  OR NEW."idempotencyKey" <> OLD."idempotencyKey"
  OR NEW."boundaryId" <> OLD."boundaryId"
  OR NEW."boundaryDigest" <> OLD."boundaryDigest"
  OR NEW."owner" <> OLD."owner"
  OR NEW."operation" <> OLD."operation"
  OR NEW."payloadDigest" <> OLD."payloadDigest"
  OR NEW."reservedAt" <> OLD."reservedAt"
  OR NEW."transactionKind" <> OLD."transactionKind"
  OR NEW."recordScope" <> OLD."recordScope"
  OR NEW."outboxRequired" <> OLD."outboxRequired"
  OR NEW."mutationAuthorized" <> 0
  OR NEW."databaseMutationAuthorized" <> 0
  OR NEW."routeAuthorized" <> 0
  OR NEW."uiMutationAuthorized" <> 0
  OR NEW."outreachAuthorized" <> 0
  OR NEW."sendAuthorized" <> 0
  OR NEW."deploymentAuthorized" <> 0
  OR NEW."providerOperationsAuthorized" <> 0
  OR NEW."costAuthorizedUsd" <> 0
  OR NEW."recordId" IS NULL
  OR NEW."recordDigest" IS NULL
  OR NEW."resultDigest" IS NULL
  OR NEW."resultJson" IS NULL
  OR NEW."committedAt" IS NULL
  OR NEW."recordedAt" IS NULL
  OR NEW."recordId" <> 'kw-owner-auth-idempotency:' || NEW."recordDigest"
  OR json_extract(NEW."resultJson", '$.recordVersion') IS NOT NEW."recordVersion"
  OR json_extract(NEW."resultJson", '$.recordKind') IS NOT NEW."recordKind"
  OR json_extract(NEW."resultJson", '$.recordId') IS NOT NEW."recordId"
  OR json_extract(NEW."resultJson", '$.recordDigest') IS NOT NEW."recordDigest"
  OR json_extract(NEW."resultJson", '$.idempotencyKey') IS NOT NEW."idempotencyKey"
  OR json_extract(NEW."resultJson", '$.boundaryId') IS NOT NEW."boundaryId"
  OR json_extract(NEW."resultJson", '$.boundaryDigest') IS NOT NEW."boundaryDigest"
  OR json_extract(NEW."resultJson", '$.owner') IS NOT NEW."owner"
  OR json_extract(NEW."resultJson", '$.operation') IS NOT NEW."operation"
  OR json_extract(NEW."resultJson", '$.payloadDigest') IS NOT NEW."payloadDigest"
  OR json_extract(NEW."resultJson", '$.resultDigest') IS NOT NEW."resultDigest"
  OR json_extract(NEW."resultJson", '$.state') IS NOT NEW."state"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_INVALID_TRANSITION'); END;

CREATE TRIGGER "RevenuePrivateKwOwnerAuthIdempotency_immutable_delete"
BEFORE DELETE ON "RevenuePrivateKwOwnerAuthIdempotency"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_OWNER_AUTH_IDEMPOTENCY_APPEND_ONLY'); END;

CREATE TABLE "RevenuePrivateKwOwnerAuthMutationOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "outboxVersion" TEXT NOT NULL,
  "eventKind" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "recordDigest" TEXT NOT NULL,
  "eventDigest" TEXT NOT NULL,
  "eventJson" TEXT NOT NULL,
  "deliveryState" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL,
  "lastAttemptAt" DATETIME,
  "deliveredAt" DATETIME,
  "deliveryAuthorized" INTEGER NOT NULL DEFAULT 0,
  "providerOperationsAuthorized" INTEGER NOT NULL DEFAULT 0,
  "costAuthorizedUsd" REAL NOT NULL DEFAULT 0,
  CHECK ("outboxVersion" = 'kw-owner-auth-outbox-v1'),
  CHECK ("eventKind" = 'OWNER_AUTH_MUTATION_COMMITTED'),
  CHECK ("id" GLOB 'kw-owner-auth-outbox:[0-9a-f]*' AND length("id") = 85),
  CHECK ("idempotencyKey" GLOB 'kw-owner-mutation-idempotency:[0-9a-f]*' AND length("idempotencyKey") = 94),
  CHECK ("recordId" GLOB 'kw-owner-auth-idempotency:[0-9a-f]*' AND length("recordId") = 90),
  CHECK ("owner" IN ('RILEY', 'AIDAN')),
  CHECK ("operation" GLOB '[a-z]*' AND length("operation") >= 3 AND length("operation") <= 160),
  CHECK (length("payloadDigest") = 64 AND "payloadDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("recordDigest") = 64 AND "recordDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("eventDigest") = 64 AND "eventDigest" NOT GLOB '*[^0-9a-f]*'),
  CHECK (json_valid("eventJson") AND json_type("eventJson") = 'object'),
  CHECK ("deliveryState" IN ('PENDING', 'DELIVERED', 'FAILED')),
  CHECK ("attemptCount" >= 0 AND "attemptCount" <= 100),
  CHECK (julianday("createdAt") IS NOT NULL),
  CHECK ("lastAttemptAt" IS NULL OR julianday("lastAttemptAt") IS NOT NULL),
  CHECK ("deliveredAt" IS NULL OR julianday("deliveredAt") IS NOT NULL),
  CHECK ("deliveryState" <> 'DELIVERED' OR "deliveredAt" IS NOT NULL),
  CHECK ("deliveryAuthorized" = 0),
  CHECK ("providerOperationsAuthorized" = 0),
  CHECK ("costAuthorizedUsd" = 0),
  FOREIGN KEY ("idempotencyKey") REFERENCES "RevenuePrivateKwOwnerAuthIdempotency" ("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "RevenuePrivateKwOwnerAuthMutationOutbox_record_key"
  ON "RevenuePrivateKwOwnerAuthMutationOutbox" ("recordId");
CREATE UNIQUE INDEX "RevenuePrivateKwOwnerAuthMutationOutbox_event_key"
  ON "RevenuePrivateKwOwnerAuthMutationOutbox" ("eventDigest");
CREATE INDEX "RevenuePrivateKwOwnerAuthMutationOutbox_delivery_idx"
  ON "RevenuePrivateKwOwnerAuthMutationOutbox" ("deliveryState", "createdAt");

CREATE TRIGGER "RevenuePrivateKwOwnerAuthMutationOutbox_contract_insert"
BEFORE INSERT ON "RevenuePrivateKwOwnerAuthMutationOutbox"
WHEN
  json_extract(NEW."eventJson", '$.eventVersion') IS NOT NEW."outboxVersion"
  OR json_extract(NEW."eventJson", '$.eventKind') IS NOT NEW."eventKind"
  OR json_extract(NEW."eventJson", '$.eventId') IS NOT NEW."id"
  OR json_extract(NEW."eventJson", '$.idempotencyKey') IS NOT NEW."idempotencyKey"
  OR json_extract(NEW."eventJson", '$.recordId') IS NOT NEW."recordId"
  OR json_extract(NEW."eventJson", '$.owner') IS NOT NEW."owner"
  OR json_extract(NEW."eventJson", '$.operation') IS NOT NEW."operation"
  OR json_extract(NEW."eventJson", '$.payloadDigest') IS NOT NEW."payloadDigest"
  OR json_extract(NEW."eventJson", '$.recordDigest') IS NOT NEW."recordDigest"
  OR json_extract(NEW."eventJson", '$.eventDigest') IS NOT NEW."eventDigest"
  OR json_extract(NEW."eventJson", '$.state') IS NOT 'COMMITTED'
  OR json_extract(NEW."eventJson", '$.authority.deliveryAuthorized') IS NOT 0
  OR json_extract(NEW."eventJson", '$.authority.providerOperationsAuthorized') IS NOT 0
  OR json_extract(NEW."eventJson", '$.authority.costAuthorizedUsd') IS NOT 0
  OR NOT EXISTS (
    SELECT 1 FROM "RevenuePrivateKwOwnerAuthIdempotency" record
    WHERE record."id" = NEW."idempotencyKey"
      AND record."state" = 'COMMITTED'
      AND record."recordId" = NEW."recordId"
      AND record."owner" = NEW."owner"
      AND record."operation" = NEW."operation"
      AND record."payloadDigest" = NEW."payloadDigest"
      AND record."recordDigest" = NEW."recordDigest"
  )
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_OWNER_AUTH_OUTBOX_CONTRACT_MISMATCH'); END;

CREATE TRIGGER "RevenuePrivateKwOwnerAuthMutationOutbox_delivery_update"
BEFORE UPDATE ON "RevenuePrivateKwOwnerAuthMutationOutbox"
WHEN
  NEW."id" <> OLD."id"
  OR NEW."outboxVersion" <> OLD."outboxVersion"
  OR NEW."eventKind" <> OLD."eventKind"
  OR NEW."idempotencyKey" <> OLD."idempotencyKey"
  OR NEW."recordId" <> OLD."recordId"
  OR NEW."owner" <> OLD."owner"
  OR NEW."operation" <> OLD."operation"
  OR NEW."payloadDigest" <> OLD."payloadDigest"
  OR NEW."recordDigest" <> OLD."recordDigest"
  OR NEW."eventDigest" <> OLD."eventDigest"
  OR NEW."eventJson" <> OLD."eventJson"
  OR NEW."deliveryAuthorized" <> 0
  OR NEW."providerOperationsAuthorized" <> 0
  OR NEW."costAuthorizedUsd" <> 0
  OR NEW."attemptCount" < OLD."attemptCount"
  OR NEW."attemptCount" > 100
  OR (OLD."deliveryState" = 'PENDING' AND NEW."deliveryState" NOT IN ('PENDING', 'DELIVERED', 'FAILED'))
  OR (OLD."deliveryState" = 'FAILED' AND NEW."deliveryState" NOT IN ('FAILED', 'PENDING', 'DELIVERED'))
  OR (OLD."deliveryState" = 'DELIVERED' AND NEW."deliveryState" <> 'DELIVERED')
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_OWNER_AUTH_OUTBOX_INVALID_TRANSITION'); END;

CREATE TRIGGER "RevenuePrivateKwOwnerAuthMutationOutbox_immutable_delete"
BEFORE DELETE ON "RevenuePrivateKwOwnerAuthMutationOutbox"
BEGIN SELECT RAISE(ABORT, 'REVENUE_PRIVATE_KW_OWNER_AUTH_OUTBOX_APPEND_ONLY'); END;
