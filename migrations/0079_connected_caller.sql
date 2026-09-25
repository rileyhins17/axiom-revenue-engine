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


CREATE TABLE CallerContactControl (
  workspaceId TEXT NOT NULL,
  contactKey TEXT NOT NULL,
  sourceEntityId TEXT,
  stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN (0,1)),
  stopRevision INTEGER NOT NULL DEFAULT 0,
  stopReason TEXT,
  stoppedAt TEXT,
  stoppedBy TEXT,
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
  linkId TEXT,
  originSourceJson TEXT,
  originActorId TEXT,
  phase TEXT NOT NULL CHECK(phase IN ('reserved','armed','active','uncertain','closed')),
  firstArmedAt TEXT,
  resolution TEXT CHECK(resolution IN ('not_dialed','call_finished','result_saved') OR resolution IS NULL),
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
CREATE TABLE CallerCommandGuard (id TEXT PRIMARY KEY, passed INTEGER NOT NULL CONSTRAINT caller_command_guard CHECK(passed=1));

-- Peer history has a separate receipt and never replays source domain commands.
CREATE TABLE CallerMirror (
  workspaceId TEXT NOT NULL,
  projectionId TEXT NOT NULL,
  linkId TEXT NOT NULL,
  originSystem TEXT NOT NULL CHECK(originSystem='orbit'),
  originEventId TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  originActorKey TEXT NOT NULL,
  payloadHash TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  occurredAt TEXT NOT NULL,
  receivedAt TEXT NOT NULL,
  correctionOf TEXT,
  PRIMARY KEY(workspaceId,projectionId),
  UNIQUE(workspaceId,originSystem,originEventId),
  FOREIGN KEY(workspaceId,originSystem,correctionOf) REFERENCES CallerMirror(workspaceId,originSystem,originEventId)
);
CREATE UNIQUE INDEX CallerMirror_initial_attempt ON CallerMirror(workspaceId,originSystem,attemptId) WHERE correctionOf IS NULL;
CREATE UNIQUE INDEX CallerMirror_correction_parent ON CallerMirror(workspaceId,originSystem,correctionOf) WHERE correctionOf IS NOT NULL;
CREATE TRIGGER CallerMirror_no_update BEFORE UPDATE ON CallerMirror BEGIN SELECT RAISE(ABORT,'CALLER_MIRROR_APPEND_ONLY'); END;
CREATE TRIGGER CallerMirror_no_delete BEFORE DELETE ON CallerMirror BEGIN SELECT RAISE(ABORT,'CALLER_MIRROR_APPEND_ONLY'); END;

-- A pending link is durable and blocks standalone calling until both peers
-- acknowledge this exact mapping. No phone/domain matching creates these rows.
CREATE TABLE CallerSourceLink (
  workspaceId TEXT NOT NULL,
  linkId TEXT NOT NULL,
  grantId TEXT NOT NULL,
  sourceEntityId TEXT NOT NULL,
  engineContactKey TEXT NOT NULL,
  orbitWorkspaceId TEXT NOT NULL,
  orbitContactId TEXT NOT NULL,
  identityJson TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','active')),
  revision INTEGER NOT NULL CHECK(revision IN (1,2)),
  confirmedBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(workspaceId,linkId),
  UNIQUE(workspaceId,engineContactKey),
  UNIQUE(orbitWorkspaceId,orbitContactId)
);
CREATE TRIGGER CallerSourceLink_claim_guard BEFORE INSERT ON CallerSourceLink
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM CallerContactControl WHERE workspaceId=NEW.workspaceId
    AND contactKey=NEW.engineContactKey AND phase<>'closed') THEN RAISE(ABORT,'CALLER_LINK_CLAIM_HELD') END;
END;

CREATE INDEX CallerContactControl_source ON CallerContactControl(workspaceId,sourceEntityId);
-- The database guard also protects legacy token and manual web writers. A NOTE
-- remains available for historical context without inventing a second call.
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

-- Independent suppression delivery must not fabricate a physical call.
CREATE TABLE CallerStopDelivery (
 deliveryKey TEXT PRIMARY KEY,workspaceId TEXT NOT NULL,grantId TEXT NOT NULL,payloadJson TEXT NOT NULL,payloadHash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,nextAttemptAt TEXT NOT NULL,leaseOwner TEXT,leaseUntil TEXT,receiptJson TEXT,lastError TEXT
);
CREATE INDEX CallerStopDelivery_due ON CallerStopDelivery(status,nextAttemptAt);
CREATE TABLE CallerStopReceipt(workspaceId TEXT NOT NULL,projectionId TEXT NOT NULL,payloadHash TEXT NOT NULL,receivedAt TEXT NOT NULL,PRIMARY KEY(workspaceId,projectionId));
