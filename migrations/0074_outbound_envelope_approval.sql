-- Source-only. No production migration or sending authority is granted.
CREATE TABLE "OutboundEnvelopeApproval" (
  "intentId" TEXT PRIMARY KEY NOT NULL CHECK (typeof("intentId") = 'text' AND instr("intentId", char(0))=0 AND length("intentId") = 64 AND "intentId" NOT GLOB '*[^a-f0-9]*'),
  "intentJson" TEXT NOT NULL CHECK (typeof("intentJson") = 'text' AND length("intentJson") BETWEEN 2 AND 8192 AND json_valid("intentJson")),
  "envelopeJson" TEXT NOT NULL CHECK (typeof("envelopeJson") = 'text' AND length("envelopeJson") BETWEEN 2 AND 600000 AND json_valid("envelopeJson")),
  "approvedByUserId" TEXT NOT NULL REFERENCES "User"("id"),
  "approvedAt" INTEGER NOT NULL DEFAULT (unixepoch()) CHECK (typeof("approvedAt") = 'integer' AND "approvedAt" >= 0),
  "expiresAt" INTEGER NOT NULL CHECK (typeof("expiresAt") = 'integer' AND "expiresAt" > "approvedAt" AND "expiresAt" <= 9007199254740991),
  "revokedAt" INTEGER CHECK ("revokedAt" IS NULL OR (typeof("revokedAt") = 'integer' AND "revokedAt" >= "approvedAt")),
  CHECK (json_extract("intentJson", '$.id') IS "intentId")
);

CREATE TRIGGER "OutboundEnvelopeApproval_insert" BEFORE INSERT ON "OutboundEnvelopeApproval"
WHEN NEW."approvedAt" <> unixepoch() OR NEW."revokedAt" IS NOT NULL
  OR EXISTS (SELECT 1 FROM "OutboundEnvelopeApproval" WHERE "intentId" = NEW."intentId")
BEGIN SELECT RAISE(ABORT, 'invalid or existing outbound approval'); END;

CREATE TRIGGER "OutboundEnvelopeApproval_immutable" BEFORE UPDATE ON "OutboundEnvelopeApproval"
WHEN NEW."intentId" IS NOT OLD."intentId" OR NEW."intentJson" IS NOT OLD."intentJson"
  OR NEW."envelopeJson" IS NOT OLD."envelopeJson" OR NEW."approvedByUserId" IS NOT OLD."approvedByUserId"
  OR NEW."approvedAt" IS NOT OLD."approvedAt" OR NEW."expiresAt" IS NOT OLD."expiresAt"
  OR OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL OR NEW."revokedAt" <> unixepoch()
BEGIN SELECT RAISE(ABORT, 'outbound approval is immutable except first revocation'); END;

CREATE TRIGGER "OutboundEnvelopeApproval_no_delete" BEFORE DELETE ON "OutboundEnvelopeApproval"
BEGIN SELECT RAISE(ABORT, 'outbound approval history cannot be deleted'); END;
