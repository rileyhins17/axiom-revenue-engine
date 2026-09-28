-- Wider market: Kitchener, Waterloo and Cambridge plus Guelph, Brantford, Stratford,
-- Woodstock, Elmira, New Hamburg, Ayr and Breslau; roofing, HVAC and landscaping plus
-- plumbing and electrical (owner decision 2026-09-26).
--
-- SQLite cannot change a CHECK constraint in place, so EngineProspect is rebuilt.
-- D1 always enforces foreign keys, and ON DELETE RESTRICT is checked immediately
-- (even with deferred foreign keys), so the five tables that reference EngineProspect
-- are copied aside and rebuilt too, with definitions identical to before. Every row
-- keeps its rowid, so the call history order and Caller source revisions do not change.
-- Protective triggers are recreated only after the rows are copied back, so restoring
-- history cannot trip the new-row guards. The whole file runs as one D1 batch.
PRAGMA defer_foreign_keys = true;

-- 1. Copy every affected row aside, keeping its rowid.
CREATE TABLE "_m0083_EngineProspect" AS SELECT rowid AS "_rowid", * FROM "EngineProspect";
CREATE TABLE "_m0083_EngineProspectActivity" AS SELECT rowid AS "_rowid", * FROM "EngineProspectActivity";
CREATE TABLE "_m0083_EngineProspectEmail" AS SELECT rowid AS "_rowid", * FROM "EngineProspectEmail";
CREATE TABLE "_m0083_EngineEmailSend" AS SELECT rowid AS "_rowid", * FROM "EngineEmailSend";
CREATE TABLE "_m0083_AiCallBrief" AS SELECT rowid AS "_rowid", * FROM "AiCallBrief";
CREATE TABLE "_m0083_CallerContactEdit" AS SELECT rowid AS "_rowid", * FROM "CallerContactEdit";

-- 2. Drop the view and the child tables first (their triggers go with them), then the parent.
DROP VIEW "EngineProspectActivityCurrent";
DROP TABLE "CallerContactEdit";
DROP TABLE "AiCallBrief";
DROP TABLE "EngineEmailSend";
DROP TABLE "EngineProspectEmail";
DROP TABLE "EngineProspectActivity";
DROP TABLE "EngineProspect";

-- 3. The parent, with the wider towns and trades. Everything else is unchanged.
CREATE TABLE "EngineProspect" (
  "prospectId" TEXT NOT NULL PRIMARY KEY CHECK (length("prospectId") BETWEEN 1 AND 300),
  "placeId" TEXT CHECK ("placeId" IS NULL OR length("placeId") <= 300),
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 200),
  "city" TEXT NOT NULL CHECK ("city" IN ('KITCHENER', 'WATERLOO', 'CAMBRIDGE', 'GUELPH', 'BRANTFORD', 'STRATFORD', 'WOODSTOCK', 'ELMIRA', 'NEW_HAMBURG', 'AYR', 'BRESLAU')),
  "niche" TEXT NOT NULL CHECK ("niche" IN ('ROOFING', 'HVAC', 'LANDSCAPING', 'PLUMBING', 'ELECTRICAL')),
  "websiteUrl" TEXT CHECK ("websiteUrl" IS NULL OR length("websiteUrl") <= 300),
  "phone" TEXT CHECK ("phone" IS NULL OR length("phone") <= 40),
  "address" TEXT CHECK ("address" IS NULL OR length("address") <= 200),
  "label" TEXT NOT NULL CHECK ("label" IN ('STRONG', 'WEAK', 'NO_WEBSITE')),
  "reasons" TEXT NOT NULL CHECK (length("reasons") <= 2000),
  "runId" TEXT NOT NULL CHECK (length("runId") BETWEEN 1 AND 120),
  "firstSeenAt" TEXT NOT NULL,
  "lastSeenAt" TEXT NOT NULL
);
INSERT INTO "EngineProspect" (rowid, "prospectId", "placeId", "name", "city", "niche", "websiteUrl", "phone", "address", "label", "reasons", "runId", "firstSeenAt", "lastSeenAt")
  SELECT "_rowid", "prospectId", "placeId", "name", "city", "niche", "websiteUrl", "phone", "address", "label", "reasons", "runId", "firstSeenAt", "lastSeenAt" FROM "_m0083_EngineProspect" ORDER BY "_rowid";
CREATE INDEX "EngineProspect_label_city_idx" ON "EngineProspect" ("label", "city", "niche");

-- 4. The child tables, exactly as before (0075, 0076, 0077, 0079, 0082).
CREATE TABLE "EngineProspectActivity" (
  "activityId" TEXT NOT NULL PRIMARY KEY,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "prospectId" TEXT NOT NULL,
  "channel" TEXT NOT NULL CHECK ("channel" IN ('CALL', 'VISIT', 'EMAIL', 'NOTE')),
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('NO_ANSWER', 'VOICEMAIL', 'GATEKEEPER', 'CALL_BACK', 'NOT_INTERESTED', 'INTERESTED', 'MEETING_BOOKED', 'WON', 'WRONG_NUMBER', 'DO_NOT_CONTACT', 'NOTE')),
  "note" TEXT NOT NULL CHECK (length("note") <= 1000),
  "followUpAt" TEXT CHECK ("followUpAt" IS NULL OR length("followUpAt") <= 40),
  "actor" TEXT NOT NULL CHECK ("actor" IN ('RILEY', 'AIDAN')),
  "actorUserId" TEXT NOT NULL CHECK (length("actorUserId") BETWEEN 1 AND 160),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), callerEventId TEXT, callerAttemptId TEXT, occurredAt TEXT, callerOutcome TEXT, callerAttempted INTEGER, callerConnected INTEGER,
  FOREIGN KEY ("prospectId") REFERENCES "EngineProspect" ("prospectId") ON DELETE RESTRICT
);
INSERT INTO "EngineProspectActivity" (rowid, "activityId", "idempotencyKey", "prospectId", "channel", "outcome", "note", "followUpAt", "actor", "actorUserId", "createdAt", callerEventId, callerAttemptId, occurredAt, callerOutcome, callerAttempted, callerConnected)
  SELECT "_rowid", "activityId", "idempotencyKey", "prospectId", "channel", "outcome", "note", "followUpAt", "actor", "actorUserId", "createdAt", callerEventId, callerAttemptId, occurredAt, callerOutcome, callerAttempted, callerConnected FROM "_m0083_EngineProspectActivity" ORDER BY "_rowid";
CREATE INDEX "EngineProspectActivity_prospect_created_idx" ON "EngineProspectActivity" ("prospectId", "createdAt" DESC);
CREATE UNIQUE INDEX EngineProspectActivity_caller_event ON EngineProspectActivity(callerEventId) WHERE callerEventId IS NOT NULL;

CREATE TABLE "EngineProspectEmail" (
  "prospectId" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL CHECK (length("email") BETWEEN 6 AND 254 AND "email" = lower("email") AND "email" LIKE '%_@_%._%'),
  "sourceUrl" TEXT NOT NULL CHECK (length("sourceUrl") BETWEEN 8 AND 300),
  "method" TEXT NOT NULL CHECK ("method" IN ('MAILTO_LINK', 'PAGE_TEXT')),
  "capturedAt" TEXT NOT NULL,
  "runId" TEXT NOT NULL CHECK (length("runId") BETWEEN 1 AND 120),
  FOREIGN KEY ("prospectId") REFERENCES "EngineProspect" ("prospectId") ON DELETE RESTRICT
);
INSERT INTO "EngineProspectEmail" (rowid, "prospectId", "email", "sourceUrl", "method", "capturedAt", "runId")
  SELECT "_rowid", "prospectId", "email", "sourceUrl", "method", "capturedAt", "runId" FROM "_m0083_EngineProspectEmail" ORDER BY "_rowid";

CREATE TABLE "EngineEmailSend" (
  "sendId" TEXT NOT NULL PRIMARY KEY,
  "prospectId" TEXT NOT NULL UNIQUE,
  "email" TEXT NOT NULL,
  "sendDay" TEXT NOT NULL CHECK (length("sendDay") = 10),
  "templateVersion" TEXT NOT NULL CHECK (length("templateVersion") BETWEEN 1 AND 60),
  "unsubscribeToken" TEXT NOT NULL UNIQUE CHECK (length("unsubscribeToken") >= 32),
  "status" TEXT NOT NULL CHECK ("status" IN ('CLAIMED', 'SENT', 'FAILED')),
  "detail" TEXT CHECK ("detail" IS NULL OR length("detail") <= 300),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "finishedAt" TEXT,
  FOREIGN KEY ("prospectId") REFERENCES "EngineProspect" ("prospectId") ON DELETE RESTRICT
);
INSERT INTO "EngineEmailSend" (rowid, "sendId", "prospectId", "email", "sendDay", "templateVersion", "unsubscribeToken", "status", "detail", "createdAt", "finishedAt")
  SELECT "_rowid", "sendId", "prospectId", "email", "sendDay", "templateVersion", "unsubscribeToken", "status", "detail", "createdAt", "finishedAt" FROM "_m0083_EngineEmailSend" ORDER BY "_rowid";
CREATE INDEX "EngineEmailSend_day_idx" ON "EngineEmailSend" ("sendDay");
CREATE UNIQUE INDEX "EngineEmailSend_email_idx" ON "EngineEmailSend" ("email");

CREATE TABLE "AiCallBrief" (
  "prospectId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL CHECK (length("inputHash") = 64),
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "brief" TEXT NOT NULL CHECK (length("brief") <= 6000),
  "usageId" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY ("prospectId", "inputHash"),
  FOREIGN KEY ("prospectId") REFERENCES "EngineProspect" ("prospectId") ON DELETE RESTRICT
);
INSERT INTO "AiCallBrief" (rowid, "prospectId", "inputHash", "model", "promptVersion", "brief", "usageId", "createdAt")
  SELECT "_rowid", "prospectId", "inputHash", "model", "promptVersion", "brief", "usageId", "createdAt" FROM "_m0083_AiCallBrief" ORDER BY "_rowid";

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
INSERT INTO "CallerContactEdit" (rowid, "editId", "workspaceId", "prospectId", "actor", "actorUserId", "previousPhone", "newPhone", "note", "payloadHash", "occurredAt", "createdAt")
  SELECT "_rowid", "editId", "workspaceId", "prospectId", "actor", "actorUserId", "previousPhone", "newPhone", "note", "payloadHash", "occurredAt", "createdAt" FROM "_m0083_CallerContactEdit" ORDER BY "_rowid";
CREATE INDEX "CallerContactEdit_prospect" ON "CallerContactEdit" ("prospectId", "createdAt");

-- 5. The protective triggers, identical to before, now that history is back in place.
CREATE TRIGGER "EngineProspect_no_delete" BEFORE DELETE ON "EngineProspect"
BEGIN SELECT RAISE(ABORT, 'ENGINE_PROSPECT_NO_DELETE'); END;
CREATE TRIGGER "EngineProspectActivity_immutable_update" BEFORE UPDATE ON "EngineProspectActivity"
BEGIN SELECT RAISE(ABORT, 'ENGINE_PROSPECT_ACTIVITY_APPEND_ONLY'); END;
CREATE TRIGGER "EngineProspectActivity_immutable_delete" BEFORE DELETE ON "EngineProspectActivity"
BEGIN SELECT RAISE(ABORT, 'ENGINE_PROSPECT_ACTIVITY_APPEND_ONLY'); END;
CREATE TRIGGER EngineProspectActivity_caller_guard BEFORE INSERT ON EngineProspectActivity
WHEN NEW.callerEventId IS NULL AND NEW.channel <> 'NOTE'
BEGIN
  SELECT CASE WHEN NEW.channel='CALL' AND EXISTS(SELECT 1 FROM CallerSourceLink l WHERE l.workspaceId='axiom'
    AND l.sourceEntityId=NEW.prospectId) THEN RAISE(ABORT,'CALLER_LINK_REQUIRED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM CallerContactControl c WHERE c.workspaceId='axiom'
    AND c.sourceEntityId=NEW.prospectId AND c.stopped=1) THEN RAISE(ABORT,'CALLER_STOPPED') END;
  SELECT CASE WHEN NEW.channel='CALL' AND EXISTS(SELECT 1 FROM CallerContactControl c WHERE c.workspaceId='axiom'
    AND c.sourceEntityId=NEW.prospectId AND c.phase<>'closed') THEN RAISE(ABORT,'CALLER_CLAIM_REQUIRED') END;
END;
CREATE TRIGGER EngineProspectActivity_conversion_guard BEFORE INSERT ON EngineProspectActivity WHEN NEW.channel='CALL' AND NEW.callerEventId IS NULL
 BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM CallerConversionJob WHERE workspaceId='axiom' AND sourceEntityId=NEW.prospectId) THEN RAISE(ABORT,'CALLER_LINK_REQUIRED') END; END;
CREATE TRIGGER "EngineEmailSend_forward_only" BEFORE UPDATE ON "EngineEmailSend"
WHEN OLD."status" <> 'CLAIMED' OR NEW."prospectId" <> OLD."prospectId" OR NEW."email" <> OLD."email" OR NEW."unsubscribeToken" <> OLD."unsubscribeToken"
BEGIN SELECT RAISE(ABORT, 'ENGINE_EMAIL_SEND_FORWARD_ONLY'); END;
CREATE TRIGGER "EngineEmailSend_no_delete" BEFORE DELETE ON "EngineEmailSend"
BEGIN SELECT RAISE(ABORT, 'ENGINE_EMAIL_SEND_NO_DELETE'); END;
CREATE TRIGGER "CallerContactEdit_immutable_update" BEFORE UPDATE ON "CallerContactEdit"
BEGIN SELECT RAISE(ABORT, 'CALLER_CONTACT_EDIT_IMMUTABLE'); END;
CREATE TRIGGER "CallerContactEdit_no_delete" BEFORE DELETE ON "CallerContactEdit"
BEGIN SELECT RAISE(ABORT, 'CALLER_CONTACT_EDIT_NO_DELETE'); END;

-- 6. The combined call history view, identical to 0079.
CREATE VIEW EngineProspectActivityCurrent AS
SELECT a.rowid AS activityRowId,a.activityId,a.idempotencyKey,a.prospectId,a.channel,a.outcome,
  COALESCE(json_extract(r.payloadJson,'$.summary'),a.note) AS note,
  a.followUpAt,a.actor,a.actorUserId,a.createdAt,a.callerEventId,a.callerAttemptId,
  a.occurredAt,a.callerOutcome,a.callerAttempted,a.callerConnected,
  COALESCE(a.occurredAt,a.createdAt) AS effectiveAt,json_extract(r.payloadJson,'$.nextAction') AS nextActionJson
FROM EngineProspectActivity a LEFT JOIN CallerResult r ON r.workspaceId='axiom' AND r.eventId=a.callerEventId
WHERE a.callerEventId IS NULL OR NOT EXISTS(SELECT 1 FROM CallerResult c WHERE c.workspaceId='axiom' AND c.correctionOf=a.callerEventId)
UNION ALL
SELECT m.rowid,'mirror:'||m.projectionId,NULL,l.sourceEntityId,
 CASE WHEN json_extract(m.payloadJson,'$.attempted')=1 THEN 'CALL' ELSE 'NOTE' END,
 CASE json_extract(m.payloadJson,'$.outcome') WHEN 'no_answer' THEN 'NO_ANSWER' WHEN 'voicemail' THEN 'VOICEMAIL' WHEN 'left_message' THEN 'VOICEMAIL'
 WHEN 'wrong_number' THEN 'WRONG_NUMBER' WHEN 'gatekeeper' THEN 'GATEKEEPER' WHEN 'callback' THEN 'CALL_BACK' WHEN 'interested' THEN 'INTERESTED'
 WHEN 'meeting_booked' THEN 'MEETING_BOOKED' WHEN 'not_interested' THEN 'NOT_INTERESTED' WHEN 'do_not_contact' THEN 'DO_NOT_CONTACT' ELSE 'NOTE' END,
 'Call recorded in Orbit. '||json_extract(m.payloadJson,'$.outcome'),json_extract(m.payloadJson,'$.nextAction.localDate'),'ORBIT',NULL,m.receivedAt,'mirror:'||m.originEventId,m.attemptId,
 m.occurredAt,json_extract(m.payloadJson,'$.outcome'),json_extract(m.payloadJson,'$.attempted'),json_extract(m.payloadJson,'$.connectedAt') IS NOT NULL,m.occurredAt,json_extract(m.payloadJson,'$.nextAction')
FROM CallerMirror m JOIN CallerSourceLink l ON l.workspaceId=m.workspaceId AND l.linkId=m.linkId
WHERE NOT EXISTS(SELECT 1 FROM CallerMirror c WHERE c.workspaceId=m.workspaceId AND c.originSystem=m.originSystem AND c.correctionOf=m.originEventId)
 AND NOT EXISTS(SELECT 1 FROM CallerResult r WHERE r.workspaceId=m.workspaceId AND r.attemptId=m.attemptId);

-- 7. Remove the copies.
DROP TABLE "_m0083_EngineProspect";
DROP TABLE "_m0083_EngineProspectActivity";
DROP TABLE "_m0083_EngineProspectEmail";
DROP TABLE "_m0083_EngineEmailSend";
DROP TABLE "_m0083_AiCallBrief";
DROP TABLE "_m0083_CallerContactEdit";

-- 8. The search list changes order (new towns and trades first), so the rotation restarts.
UPDATE "DiscoveryCursor" SET "cellIndex" = 0, "pageToken" = NULL, "updatedAt" = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE "id" = 1;
