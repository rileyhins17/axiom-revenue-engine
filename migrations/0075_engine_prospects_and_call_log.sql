-- Engine prospects published from weekly runs, and the owners' append-only
-- call/visit log. A prospect row is not consent or permission to contact; a
-- DO_NOT_CONTACT activity permanently removes the business from call lists.
CREATE TABLE "EngineProspect" (
  "prospectId" TEXT NOT NULL PRIMARY KEY CHECK (length("prospectId") BETWEEN 1 AND 300),
  "placeId" TEXT CHECK ("placeId" IS NULL OR length("placeId") <= 300),
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 200),
  "city" TEXT NOT NULL CHECK ("city" IN ('KITCHENER', 'WATERLOO', 'CAMBRIDGE')),
  "niche" TEXT NOT NULL CHECK ("niche" IN ('ROOFING', 'HVAC', 'LANDSCAPING')),
  "websiteUrl" TEXT CHECK ("websiteUrl" IS NULL OR length("websiteUrl") <= 300),
  "phone" TEXT CHECK ("phone" IS NULL OR length("phone") <= 40),
  "address" TEXT CHECK ("address" IS NULL OR length("address") <= 200),
  "label" TEXT NOT NULL CHECK ("label" IN ('STRONG', 'WEAK', 'NO_WEBSITE')),
  "reasons" TEXT NOT NULL CHECK (length("reasons") <= 2000),
  "runId" TEXT NOT NULL CHECK (length("runId") BETWEEN 1 AND 120),
  "firstSeenAt" TEXT NOT NULL,
  "lastSeenAt" TEXT NOT NULL
);
CREATE INDEX "EngineProspect_label_city_idx" ON "EngineProspect" ("label", "city", "niche");

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
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY ("prospectId") REFERENCES "EngineProspect" ("prospectId") ON DELETE RESTRICT
);
CREATE INDEX "EngineProspectActivity_prospect_created_idx" ON "EngineProspectActivity" ("prospectId", "createdAt" DESC);

CREATE TRIGGER "EngineProspectActivity_immutable_update" BEFORE UPDATE ON "EngineProspectActivity"
BEGIN SELECT RAISE(ABORT, 'ENGINE_PROSPECT_ACTIVITY_APPEND_ONLY'); END;
CREATE TRIGGER "EngineProspectActivity_immutable_delete" BEFORE DELETE ON "EngineProspectActivity"
BEGIN SELECT RAISE(ABORT, 'ENGINE_PROSPECT_ACTIVITY_APPEND_ONLY'); END;
CREATE TRIGGER "EngineProspect_no_delete" BEFORE DELETE ON "EngineProspect"
BEGIN SELECT RAISE(ABORT, 'ENGINE_PROSPECT_NO_DELETE'); END;
