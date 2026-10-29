-- Health monitor memory: one row per problem, so owners are emailed once when it
-- starts, once when it is fixed, and at most daily while it continues.
CREATE TABLE "HealthAlertState" (
  "checkKey" TEXT NOT NULL PRIMARY KEY CHECK (length("checkKey") BETWEEN 1 AND 60),
  "status" TEXT NOT NULL CHECK ("status" IN ('OK', 'PROBLEM')),
  "summary" TEXT NOT NULL CHECK (length("summary") <= 500),
  "since" TEXT NOT NULL,
  "lastNotifiedAt" TEXT,
  "updatedAt" TEXT NOT NULL
);
