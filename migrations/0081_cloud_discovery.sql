-- Server-side lead discovery: usage counter, rotation cursor, run log and the
-- queue of businesses with a website that wait for a website check.
-- (Wider towns/trades need an EngineProspect rebuild; see a later migration.)
-- Google Places usage for the month; discovery stops before the free-tier cap.
CREATE TABLE "PlacesUsage" (
  "month" TEXT NOT NULL PRIMARY KEY CHECK (length("month") = 7),
  "requests" INTEGER NOT NULL DEFAULT 0 CHECK ("requests" >= 0)
);
-- Requests already made from the local runs this month (2026-09).
INSERT INTO "PlacesUsage" ("month", "requests") VALUES ('2026-09', 133);

-- Where the rotating search left off (which town/trade/query, and the next page).
CREATE TABLE "DiscoveryCursor" (
  "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1),
  "cellIndex" INTEGER NOT NULL DEFAULT 0 CHECK ("cellIndex" >= 0),
  "pageToken" TEXT CHECK ("pageToken" IS NULL OR length("pageToken") <= 20000),
  "updatedAt" TEXT NOT NULL
);
INSERT INTO "DiscoveryCursor" ("id", "cellIndex", "pageToken", "updatedAt") VALUES (1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- One row per discovery run, so owners can see what came in and when.
CREATE TABLE "DiscoveryRun" (
  "runId" TEXT NOT NULL PRIMARY KEY,
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('SCHEDULE', 'OWNER')),
  "actor" TEXT CHECK ("actor" IS NULL OR "actor" IN ('RILEY', 'AIDAN')),
  "startedAt" TEXT NOT NULL,
  "finishedAt" TEXT,
  "requests" INTEGER NOT NULL DEFAULT 0,
  "found" INTEGER NOT NULL DEFAULT 0,
  "added" INTEGER NOT NULL DEFAULT 0,
  "held" INTEGER NOT NULL DEFAULT 0,
  "stopReason" TEXT CHECK ("stopReason" IS NULL OR length("stopReason") <= 200)
);
CREATE TRIGGER "DiscoveryRun_no_delete" BEFORE DELETE ON "DiscoveryRun"
BEGIN SELECT RAISE(ABORT, 'DISCOVERY_RUN_NO_DELETE'); END;

-- Businesses that have a website wait here for a cloud website check before joining the call list.
CREATE TABLE "DiscoveryHeld" (
  "placeId" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "niche" TEXT NOT NULL,
  "websiteUrl" TEXT NOT NULL,
  "phone" TEXT,
  "address" TEXT,
  "status" TEXT NOT NULL DEFAULT 'WAITING' CHECK ("status" IN ('WAITING', 'CHECKED', 'FAILED')),
  "firstSeenAt" TEXT NOT NULL
);
