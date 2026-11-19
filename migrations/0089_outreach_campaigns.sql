-- The engine becomes the one sender for all outreach (Riley, Nov 5 2026). Campaigns run
-- beside the FCC sender, each with its own list (any CSV columns), words, schedule, daily
-- limit, follow-up, pause switch and numbers. Sending inboxes are settings rows, so adding
-- one needs a row and its app password (a Worker secret), not a code change.
--
-- Nothing is sent until a campaign is live AND the batch holding the contact has been
-- approved by a named founder, for the exact words it was approved on. Every campaign
-- starts paused. Inbox limits are shared with FCC: src/lib/outreach/outreach-inboxes.ts.

CREATE TABLE IF NOT EXISTS "OutreachInbox" (
  "address" TEXT PRIMARY KEY NOT NULL CHECK ("address" = lower("address") AND "address" LIKE '%_@_%._%'),
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 80),
  -- The NAME of the Worker secret that holds this inbox's app password, never the password.
  "passwordSecret" TEXT NOT NULL CHECK (length("passwordSecret") BETWEEN 1 AND 80 AND "passwordSecret" NOT GLOB '*[^A-Z0-9_]*'),
  "smtpHost" TEXT NOT NULL DEFAULT 'smtp.gmail.com',
  "imapHost" TEXT NOT NULL DEFAULT 'imap.gmail.com',
  -- The most this inbox may send in a day, all campaigns together, once its ramp is over.
  "dailyMax" INTEGER NOT NULL DEFAULT 60 CHECK ("dailyMax" BETWEEN 0 AND 200),
  -- A new inbox's daily amounts by week, counted from rampFrom, e.g. [15,30]; [] = no ramp.
  "rampJson" TEXT NOT NULL DEFAULT '[]',
  "rampFrom" TEXT CHECK ("rampFrom" IS NULL OR length("rampFrom") = 10),
  "enabled" INTEGER NOT NULL DEFAULT 1 CHECK ("enabled" IN (0, 1)),
  "note" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updatedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The two inboxes FCC warmed. Aidan's has sent 60 a day since Oct 28. Riley's first sent on
-- Nov 2 and follows FCC's new-inbox ramp: 15 a day in week 1, 30 in week 2, 60 from week 3.
INSERT OR IGNORE INTO "OutreachInbox" ("address","name","passwordSecret","dailyMax","rampJson","rampFrom","note") VALUES
  ('aidanmageebusiness@gmail.com', 'Aidan Magee', 'FCC_SMTP_PASSWORD', 60, '[]', NULL, 'FCC''s first inbox; 60 a day since Oct 28'),
  ('rileyhinspergerbusiness@gmail.com', 'Riley Hinsperger', 'FCC_SMTP_PASSWORD_2', 60, '[15,30]', '2026-11-02', 'First sent Nov 2: 15 a day, then 30, then 60');

CREATE TABLE IF NOT EXISTS "OutreachCampaign" (
  "key" TEXT PRIMARY KEY NOT NULL CHECK (length("key") BETWEEN 2 AND 40 AND "key" NOT GLOB '*[^a-z0-9-]*'),
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 80),
  "state" TEXT NOT NULL DEFAULT 'paused' CHECK ("state" IN ('live', 'paused')),
  "stateReason" TEXT CHECK ("stateReason" IS NULL OR length("stateReason") <= 300),
  "stateBy" TEXT CHECK ("stateBy" IS NULL OR length("stateBy") <= 120),
  "stateAt" TEXT,
  -- Lower goes first when two campaigns want the same inbox in the same minute. FCC goes after every campaign.
  "priority" INTEGER NOT NULL DEFAULT 50,
  -- No email before startDay or after endDay (Toronto days, inclusive).
  "startDay" TEXT CHECK ("startDay" IS NULL OR length("startDay") = 10),
  "endDay" TEXT CHECK ("endDay" IS NULL OR length("endDay") = 10),
  "sendDays" TEXT NOT NULL DEFAULT 'Mon,Tue,Wed,Thu,Fri',
  -- Minutes after midnight, Toronto time. The send tick runs 9:00 to 14:59 in winter time.
  "windowStart" INTEGER NOT NULL DEFAULT 540 CHECK ("windowStart" BETWEEN 0 AND 1439),
  "windowEnd" INTEGER NOT NULL DEFAULT 870 CHECK ("windowEnd" BETWEEN 1 AND 1440),
  -- Most emails a day for the whole campaign, follow-ups included.
  "dailyLimit" INTEGER NOT NULL DEFAULT 0 CHECK ("dailyLimit" BETWEEN 0 AND 1000),
  -- Which inboxes may send it, and at most how many a day from each: [{"address":"...","perDay":30}]
  "inboxesJson" TEXT NOT NULL DEFAULT '[]',
  -- Follow-ups after the first email, each this many business days (Mon-Fri) after the one before.
  "followUps" INTEGER NOT NULL DEFAULT 1 CHECK ("followUps" BETWEEN 0 AND 3),
  "followUpBusinessDays" INTEGER NOT NULL DEFAULT 5 CHECK ("followUpBusinessDays" BETWEEN 1 AND 30),
  -- {"steps":[{"subject":"...","body":"..."},{"body":"..."}]}; a follow-up's subject is "Re: " the first one's.
  "wordsJson" TEXT NOT NULL DEFAULT '{"steps":[]}',
  "wordsVersion" TEXT,
  -- Hold rules and options, e.g. {"holdUnless":{"verified":["yes","true"]},"noLinksInFirst":true}
  "rulesJson" TEXT NOT NULL DEFAULT '{}',
  -- Founders whose approval opens a batch, e.g. ["Aidan"].
  "approversJson" TEXT NOT NULL DEFAULT '["Riley","Aidan"]',
  "note" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updatedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One loaded list. It waits until a named approver approves it, for the words it was approved on.
CREATE TABLE IF NOT EXISTS "OutreachBatch" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "campaignKey" TEXT NOT NULL,
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 120),
  "source" TEXT CHECK ("source" IS NULL OR length("source") <= 300),
  "columnsJson" TEXT NOT NULL DEFAULT '[]',
  "rows" INTEGER NOT NULL DEFAULT 0,
  "ready" INTEGER NOT NULL DEFAULT 0,
  "held" INTEGER NOT NULL DEFAULT 0,
  "loadedBy" TEXT NOT NULL CHECK (length("loadedBy") BETWEEN 1 AND 120),
  "loadedAt" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'waiting' CHECK ("status" IN ('waiting', 'approved', 'stopped')),
  "approvedBy" TEXT CHECK ("approvedBy" IS NULL OR length("approvedBy") <= 120),
  "approvedAt" TEXT,
  "approvedWords" TEXT,
  "approvalNote" TEXT CHECK ("approvalNote" IS NULL OR length("approvalNote") <= 300),
  "sendOrder" INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY ("campaignKey") REFERENCES "OutreachCampaign" ("key") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "OutreachBatch_campaign_idx" ON "OutreachBatch" ("campaignKey", "sendOrder");

CREATE TABLE IF NOT EXISTS "OutreachContact" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "campaignKey" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "email" TEXT NOT NULL CHECK ("email" = lower("email") AND length("email") BETWEEN 3 AND 254),
  -- Every column of the CSV row, by its normalised name.
  "fieldsJson" TEXT NOT NULL,
  -- ready: waits for its first email; held: never sent; sent: first email out, follow-ups to come;
  -- done: every email sent (replies still read); replied, bounced, suppressed: stopped for good;
  -- failed: Gmail refused it, waits for a person.
  "status" TEXT NOT NULL DEFAULT 'ready' CHECK ("status" IN ('ready', 'held', 'sent', 'done', 'replied', 'bounced', 'suppressed', 'failed')),
  "holdReason" TEXT CHECK ("holdReason" IS NULL OR length("holdReason") <= 300),
  "stoppedReason" TEXT CHECK ("stoppedReason" IS NULL OR length("stoppedReason") <= 300),
  "stepsSent" INTEGER NOT NULL DEFAULT 0,
  "senderAddress" TEXT,
  "firstSentAt" TEXT,
  "firstSentDay" TEXT,
  "firstMessageId" TEXT,
  "firstSubject" TEXT,
  "lastMessageId" TEXT,
  "nextDueDay" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("batchId") REFERENCES "OutreachBatch" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS "OutreachContact_campaign_email_key" ON "OutreachContact" ("campaignKey", "email");
CREATE INDEX IF NOT EXISTS "OutreachContact_campaign_status_idx" ON "OutreachContact" ("campaignKey", "status");
CREATE INDEX IF NOT EXISTS "OutreachContact_batch_idx" ON "OutreachContact" ("batchId", "rowNumber");
CREATE INDEX IF NOT EXISTS "OutreachContact_email_idx" ON "OutreachContact" ("email");

-- One row per email, claimed before it is sent, like FccCampaignSend: a CLAIMED row that never
-- finishes counts as sent, so a crash can never send twice. Test sends (to our own inboxes) are
-- kind 'test' with no contact; they count toward the inbox's day.
CREATE TABLE IF NOT EXISTS "OutreachSend" (
  "sendId" TEXT PRIMARY KEY NOT NULL,
  "campaignKey" TEXT NOT NULL,
  "contactId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'real' CHECK ("kind" IN ('real', 'test')),
  "step" INTEGER NOT NULL CHECK ("step" BETWEEN 1 AND 4),
  "email" TEXT NOT NULL,
  "senderAddress" TEXT NOT NULL,
  "sendDay" TEXT NOT NULL CHECK (length("sendDay") = 10),
  "messageId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('CLAIMED', 'SENT', 'FAILED')),
  "detail" TEXT CHECK ("detail" IS NULL OR length("detail") <= 300),
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "finishedAt" TEXT,
  CHECK (("kind" = 'real') = ("contactId" IS NOT NULL)),
  FOREIGN KEY ("contactId") REFERENCES "OutreachContact" ("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS "OutreachSend_contact_step_key" ON "OutreachSend" ("contactId", "step") WHERE "status" <> 'FAILED' AND "kind" = 'real';
CREATE INDEX IF NOT EXISTS "OutreachSend_inbox_day_idx" ON "OutreachSend" ("senderAddress", "sendDay");
CREATE INDEX IF NOT EXISTS "OutreachSend_campaign_day_idx" ON "OutreachSend" ("campaignKey", "sendDay");
CREATE TRIGGER IF NOT EXISTS "OutreachSend_no_delete" BEFORE DELETE ON "OutreachSend"
BEGIN SELECT RAISE(ABORT, 'OUTREACH_SEND_NO_DELETE'); END;
CREATE TRIGGER IF NOT EXISTS "OutreachSend_forward_only" BEFORE UPDATE ON "OutreachSend"
WHEN OLD."status" <> 'CLAIMED' OR NEW."contactId" IS NOT OLD."contactId" OR NEW."step" <> OLD."step" OR NEW."messageId" <> OLD."messageId" OR NEW."senderAddress" <> OLD."senderAddress"
BEGIN SELECT RAISE(ABORT, 'OUTREACH_SEND_FORWARD_ONLY'); END;

-- Each message a contact (or someone at their organisation) sent back, found by the inbox checks.
CREATE TABLE IF NOT EXISTS "OutreachReply" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "campaignKey" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "inbox" TEXT NOT NULL,
  "fromAddress" TEXT NOT NULL,
  "receivedAt" TEXT,
  "subject" TEXT CHECK ("subject" IS NULL OR length("subject") <= 300),
  "quote" TEXT CHECK ("quote" IS NULL OR length("quote") <= 600),
  -- reply: a person wrote back; automatic: out of office and the like; no_thanks: asked us to stop.
  "kind" TEXT NOT NULL CHECK ("kind" IN ('reply', 'automatic', 'no_thanks')),
  "foundAt" TEXT NOT NULL,
  "toldFoundersAt" TEXT,
  FOREIGN KEY ("contactId") REFERENCES "OutreachContact" ("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "OutreachReply_campaign_idx" ON "OutreachReply" ("campaignKey", "foundAt");
CREATE INDEX IF NOT EXISTS "OutreachReply_contact_idx" ON "OutreachReply" ("contactId");

-- US cities (Aidan's second path, Nov 5). Starts paused, with no words and no list: nothing can
-- send until the words are loaded, a batch is approved by Aidan and a founder sets it live.
INSERT OR IGNORE INTO "OutreachCampaign" ("key","name","state","stateReason","stateBy","stateAt","priority","startDay","sendDays","windowStart","windowEnd",
    "dailyLimit","inboxesJson","followUps","followUpBusinessDays","rulesJson","approversJson","note")
  VALUES ('us-cities', 'US cities: accessibility', 'paused', 'New campaign: waiting for its words and an approved batch', 'Riley''s Claude',
    strftime('%Y-%m-%dT%H:%M:%fZ','now'), 10, '2026-11-09', 'Mon,Tue,Wed,Thu,Fri', 540, 870,
    30, '[{"address":"aidanmageebusiness@gmail.com","perDay":30}]', 1, 5,
    '{"holdUnless":{"verified":["yes","true","y","1","verified"]},"noLinksInFirst":true,"stopOnAutoReply":true}', '["Aidan"]',
    'Aidan''s plan doc "Axiom''s second path: the plan", item 4. 30 a day from Mon Nov 9, Aidan''s inbox until the Nov 13 review.');
