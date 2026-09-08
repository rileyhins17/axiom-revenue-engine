-- Source-only additive security migration; no live application is authorized.
CREATE TABLE "GmailOAuthTransaction" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "sessionId" TEXT NOT NULL REFERENCES "Session"("id") ON DELETE CASCADE,
  "redirectUri" TEXT NOT NULL,
  "targetEmail" TEXT NOT NULL,
  "issuedAt" INTEGER NOT NULL DEFAULT (unixepoch()),
  "expiresAt" INTEGER NOT NULL DEFAULT (unixepoch() + 600),
  "consumedAt" INTEGER,
  CHECK (length("id") = 64),
  CHECK ("expiresAt" = "issuedAt" + 600),
  CHECK ("consumedAt" IS NULL OR "consumedAt" >= "issuedAt")
);
