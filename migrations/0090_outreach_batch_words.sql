-- Each batch keeps the email words it was loaded with, and is approved on exactly those (Nov 5: Aidan's side
-- sends each city batch with its own two texts, and batch B1 uses a second version of the words). A batch's words
-- never change afterwards; new words come with a new batch. NULL: the campaign's words (batches loaded before this).
ALTER TABLE "OutreachBatch" ADD COLUMN "wordsJson" TEXT;
ALTER TABLE "OutreachBatch" ADD COLUMN "wordsVersion" TEXT;
