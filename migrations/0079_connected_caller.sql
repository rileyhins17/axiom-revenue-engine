-- Caller v2: append-only evidence, physical attempt ownership, and durable sync.
CREATE TABLE CallerResult (
  workspaceId TEXT NOT NULL,
  eventId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  actorUserId TEXT NOT NULL,
  actor TEXT NOT NULL CHECK(actor IN ('AIDAN','RILEY')),
  sourceEntityId TEXT NOT NULL,
  contactId TEXT NOT NULL,
  payloadHash TEXT NOT NULL CHECK(length(payloadHash)=64),
  payloadJson TEXT NOT NULL,
  recordId TEXT NOT NULL UNIQUE,
  occurredAt TEXT NOT NULL,
  receivedAt TEXT NOT NULL,
  outcome TEXT NOT NULL,
  attempted INTEGER CHECK(attempted IN (0,1) OR attempted IS NULL),
  connectedAt TEXT,
  correctionOf TEXT,
  PRIMARY KEY(workspaceId,eventId),
  FOREIGN KEY(workspaceId,correctionOf) REFERENCES CallerResult(workspaceId,eventId)
);
CREATE UNIQUE INDEX CallerResult_initial_attempt ON CallerResult(workspaceId,attemptId) WHERE correctionOf IS NULL;
CREATE UNIQUE INDEX CallerResult_correction_parent ON CallerResult(workspaceId,correctionOf) WHERE correctionOf IS NOT NULL;
CREATE INDEX CallerResult_occurred ON CallerResult(workspaceId,occurredAt);
CREATE INDEX CallerResult_attempt ON CallerResult(workspaceId,attemptId,receivedAt);
CREATE TRIGGER CallerResult_no_update BEFORE UPDATE ON CallerResult BEGIN SELECT RAISE(ABORT,'CALLER_RESULT_APPEND_ONLY'); END;
CREATE TRIGGER CallerResult_no_delete BEFORE DELETE ON CallerResult BEGIN SELECT RAISE(ABORT,'CALLER_RESULT_APPEND_ONLY'); END;

ALTER TABLE EngineProspectActivity ADD COLUMN callerEventId TEXT;
ALTER TABLE EngineProspectActivity ADD COLUMN callerAttemptId TEXT;
ALTER TABLE EngineProspectActivity ADD COLUMN occurredAt TEXT;
ALTER TABLE EngineProspectActivity ADD COLUMN callerOutcome TEXT;
ALTER TABLE EngineProspectActivity ADD COLUMN callerAttempted INTEGER;
ALTER TABLE EngineProspectActivity ADD COLUMN callerConnected INTEGER;
CREATE UNIQUE INDEX EngineProspectActivity_caller_event ON EngineProspectActivity(callerEventId) WHERE callerEventId IS NOT NULL;

-- Current business view; original immutable rows remain available for audit/export.
CREATE VIEW EngineProspectActivityCurrent AS
SELECT a.rowid AS activityRowId,a.activityId,a.idempotencyKey,a.prospectId,a.channel,a.outcome,
  COALESCE(json_extract(r.payloadJson,'$.summary'),a.note) AS note,
  a.followUpAt,a.actor,a.actorUserId,a.createdAt,a.callerEventId,a.callerAttemptId,
  a.occurredAt,a.callerOutcome,a.callerAttempted,a.callerConnected,
  COALESCE(a.occurredAt,a.createdAt) AS effectiveAt
FROM EngineProspectActivity a LEFT JOIN CallerResult r ON r.workspaceId='axiom' AND r.eventId=a.callerEventId
WHERE a.callerEventId IS NULL OR NOT EXISTS(SELECT 1 FROM CallerResult c WHERE c.workspaceId='axiom' AND c.correctionOf=a.callerEventId);

CREATE TABLE CallerContactControl (
  workspaceId TEXT NOT NULL,
  contactKey TEXT NOT NULL,
  stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN (0,1)),
  stopRevision INTEGER NOT NULL DEFAULT 0,
  stopReason TEXT,
  ownerId TEXT,
  attemptId TEXT,
  phase TEXT NOT NULL DEFAULT 'closed' CHECK(phase IN ('reserved','armed','active','uncertain','closed')),
  leaseUntil TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(workspaceId,contactKey)
);
CREATE TABLE CallerAttempt (
  workspaceId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  contactKey TEXT NOT NULL,
  sourceEntityId TEXT NOT NULL,
  sourceRevision TEXT NOT NULL,
  ownerId TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('reserved','armed','active','uncertain','closed')),
  firstArmedAt TEXT,
  createdAt TEXT NOT NULL,
  closedAt TEXT,
  PRIMARY KEY(workspaceId,attemptId)
);
CREATE TABLE CallerProjection (
  deliveryKey TEXT NOT NULL PRIMARY KEY,
  workspaceId TEXT NOT NULL,
  originEventId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  targetSystem TEXT NOT NULL CHECK(targetSystem IN ('revenue-engine','orbit')),
  grantId TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  payloadHash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  nextAttemptAt TEXT NOT NULL,
  leaseOwner TEXT,
  leaseUntil TEXT,
  receiptJson TEXT,
  lastError TEXT,
  FOREIGN KEY(workspaceId,originEventId) REFERENCES CallerResult(workspaceId,eventId)
);
CREATE INDEX CallerProjection_due ON CallerProjection(status,nextAttemptAt);
