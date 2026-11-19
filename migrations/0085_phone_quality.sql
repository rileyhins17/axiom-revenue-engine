-- Better numbers to call. On 2026-09-28, 7 of Aidan's 19 calls reached dead numbers, all
-- on businesses Google lists without a website; he found working numbers on the websites
-- of others. Additive only: every existing row keeps its values.
--   altPhone          the other number when the business's own website and Google disagree
--                     (the website's number becomes the main one; Google's is kept here).
--   googleRatingCount / googleRating
--                     from the same Places search (Enterprise fields, no extra cost). A
--                     listing with no reviews is often a defunct business, so the call
--                     queue reaches established businesses first.
ALTER TABLE "EngineProspect" ADD COLUMN "altPhone" TEXT CHECK ("altPhone" IS NULL OR length("altPhone") <= 40);
ALTER TABLE "EngineProspect" ADD COLUMN "googleRatingCount" INTEGER CHECK ("googleRatingCount" IS NULL OR "googleRatingCount" >= 0);
ALTER TABLE "EngineProspect" ADD COLUMN "googleRating" REAL CHECK ("googleRating" IS NULL OR ("googleRating" >= 0 AND "googleRating" <= 5));
ALTER TABLE "DiscoveryHeld" ADD COLUMN "googleRatingCount" INTEGER CHECK ("googleRatingCount" IS NULL OR "googleRatingCount" >= 0);
ALTER TABLE "DiscoveryHeld" ADD COLUMN "googleRating" REAL CHECK ("googleRating" IS NULL OR ("googleRating" >= 0 AND "googleRating" <= 5));
