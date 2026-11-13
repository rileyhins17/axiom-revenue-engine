-- The Replies screen (Nov 13, 2026): a founder marks a reply answered, so both founders can see which real
-- replies still wait for an answer, and marks the replies that count toward the campaign's success number
-- (cities: someone asked for the report or a price), which the founders judge each test by.
-- Only adds nullable columns: older code ignores them, and nothing about sending reads them.
ALTER TABLE "OutreachReply" ADD COLUMN "answeredAt" TEXT;
ALTER TABLE "OutreachReply" ADD COLUMN "answeredBy" TEXT CHECK ("answeredBy" IS NULL OR length("answeredBy") <= 120);
ALTER TABLE "OutreachReply" ADD COLUMN "successAt" TEXT;
ALTER TABLE "OutreachReply" ADD COLUMN "successBy" TEXT CHECK ("successBy" IS NULL OR length("successBy") <= 120);
