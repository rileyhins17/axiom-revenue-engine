-- Phone-number fixes and notes sent from Axiom Caller before a call.
-- Append-only: every edit keeps the number it replaced, so nothing is overwritten silently.
-- The only other change an edit makes is setting EngineProspect.phone to the corrected number.
CREATE TABLE "CallerContactEdit" (
  "editId" TEXT NOT NULL PRIMARY KEY CHECK (length("editId") = 36),
  "workspaceId" TEXT NOT NULL CHECK ("workspaceId" = 'axiom'),
  "prospectId" TEXT NOT NULL REFERENCES "EngineProspect"("prospectId") ON DELETE RESTRICT,
  "actor" TEXT NOT NULL CHECK ("actor" IN ('RILEY', 'AIDAN')),
  "actorUserId" TEXT NOT NULL CHECK (length("actorUserId") BETWEEN 1 AND 160),
  "previousPhone" TEXT CHECK ("previousPhone" IS NULL OR length("previousPhone") <= 40),
  "newPhone" TEXT CHECK ("newPhone" IS NULL OR length("newPhone") BETWEEN 7 AND 40),
  "note" TEXT CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 1000),
  "payloadHash" TEXT NOT NULL CHECK (length("payloadHash") = 64),
  "occurredAt" TEXT NOT NULL CHECK (length("occurredAt") <= 40),
  "createdAt" TEXT NOT NULL CHECK (length("createdAt") <= 40),
  CHECK ("newPhone" IS NOT NULL OR "note" IS NOT NULL)
);
CREATE INDEX "CallerContactEdit_prospect" ON "CallerContactEdit" ("prospectId", "createdAt");
CREATE TRIGGER "CallerContactEdit_immutable_update" BEFORE UPDATE ON "CallerContactEdit"
BEGIN SELECT RAISE(ABORT, 'CALLER_CONTACT_EDIT_IMMUTABLE'); END;
CREATE TRIGGER "CallerContactEdit_no_delete" BEFORE DELETE ON "CallerContactEdit"
BEGIN SELECT RAISE(ABORT, 'CALLER_CONTACT_EDIT_NO_DELETE'); END;
