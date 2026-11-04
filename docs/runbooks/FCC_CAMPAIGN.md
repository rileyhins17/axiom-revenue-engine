# FCC campaign: going live

**What it does (Aidan's send rules, Oct 27).** On weekdays the live app sends FCC emails from Aidan's Gmail, one at a time, 1 to 3 minutes apart (random), so 30 take about an hour. The first 30 start at 10:00 Toronto time. From 12:30 up to 30 more go, but only if today has 1 bounce or fewer: 60 a day is the ceiling. Follow-ups that are due go first and count toward the day: one 3 days after the first email, and a last one about 7 days after it (at least 4 days after the first follow-up), both in the same thread from the inbox that sent the first email. Before each email it checks Aidan's inbox: if anyone at that company wrote back, or an email bounced, that contact stops. Bounces go on the permanent do-not-email list. A bounce is a message from a mail system (mailer-daemon, postmaster or a no-reply address) or with a bounce subject ("Undeliverable", "Mail delivery failed" and the like) that names the contact's address; until Nov 4 only Google's own bounce emails counted, and a Purelymail bounce went unrecorded. A bounce that arrives after the day's last check is recorded by the next morning's first check, which looks back five days. Generic inboxes (support@, info@ and the like) are never sent to. The emails are plain text with one link (the signature), no tracking and no attachments.

**When it pauses itself.** Any of these pauses the whole campaign until Riley or Aidan presses Resume on the FCC screen: a Google "critical security alert" or "suspicious" notice, or a Gmail "sending limit" or "message blocked" bounce in the inbox that day; 3 or more bounces in a day; Gmail refusing the login; Gmail refusing an email. The reason shows on the FCC screen and on Today, and within 15 minutes the health check emails both founders the reason (and again once it is resumed). It also emails if a new email version is waiting for a go during send hours, if nothing has gone out by 11:00 on a weekday, or if the 9 a.m. reply check hasn't finished by 10:30.

**What it never does.** Send anything before a founder's go is recorded. Send more than 60 a day from one inbox. Send two emails at once. Email anyone twice for the same step, even after a crash. Change or delete anything in Aidan's mailbox (the inbox check is read-only). The FCC screen's Pause is the only stop.

Code: `src/lib/fcc-campaign-tick.ts` (the minute-by-minute schedule and safety pauses), `src/lib/fcc-campaign-sender.ts` (who gets what, claims), `src/lib/fcc-campaign-control.ts` (pause/resume), `src/lib/fcc-campaign-worker.ts` (live wiring, cron `* 14-19 * * *`), `src/app/fcc/page.tsx` (screen), `migrations/0086_fcc_campaign_contacts.sql` (tables, starts locked), `migrations/0088_fcc_day7_follow_up.sql` (send records allow step 3), `scripts/fcc-campaign.ts` (tools). Decision: `docs/adr/0063-fcc-send-tick.md`.

## One-time setup

1. **Aidan makes a Gmail app password.** Google Account → Security → turn on 2-Step Verification if it's off → App passwords → name it "Axiom FCC". Copy the 16 letters. It never goes in a file or a chat.
2. **Check the password works (no contacts are emailed).** From a checkout of this branch, in PowerShell:
   ```
   $env:FCC_SENDER_ADDRESS = "aidanmageebusiness@gmail.com"
   $env:FCC_SMTP_PASSWORD = "<the 16 letters>"
   npx tsx --env-file=outreach/fcc-campaign.env scripts/fcc-campaign.ts smtp-test <first-100.csv>
   ```
   Two test emails arrive in Aidan's own inbox, the second threaded under the first, and the inbox check says it works.
3. **Release.** Merge the PR into `codex/revenue-engine-production`, then run the guarded release (`scripts/release-production.mjs`: backup, checksum, approval phrase). It applies migration 0086 and deploys. Done 2026-10-24 (see `docs/STATUS.md`).
4. **Secrets (once).**
   ```
   npx wrangler secret put FCC_SMTP_PASSWORD --config wrangler.production.jsonc
   npx wrangler secret put FCC_CAMPAIGN_MAILING_ADDRESS --config wrangler.production.jsonc
   ```
5. **Load the contacts.**
   ```
   npx tsx scripts/fcc-campaign.ts import-sql <contacts.csv> outreach/fcc-import.sql
   npx wrangler d1 execute axiom-ops-omniscient --remote --config wrangler.production.jsonc --file outreach/fcc-import.sql
   ```
   The CSV must use the FCC filing columns (business_name, contact_name, title, email, phone, state, rmd_number, last_filing_date, recertified_on_page, filing_url). Re-running it never duplicates anyone.

## Go, pause, check

- **Go (only after Aidan says go):**
  ```
  npx tsx scripts/fcc-campaign.ts go-sql Aidan > outreach/fcc-go.sql
  npx wrangler d1 execute axiom-ops-omniscient --remote --config wrangler.production.jsonc --file outreach/fcc-go.sql
  ```
  The next weekday at 10:00 it sends. If the email wording changes, bump `FCC_CAMPAIGN_KEY` in `src/lib/fcc-campaign.ts`: that locks sending again until a new go.
- **Pause or resume:** the big button on the FCC screen (operations.getaxiom.ca/fcc). It only changes FCC sending. Resume works only while a go is recorded for the current copy key. Without the app, `pause-sql` does the same as Pause.
- **Check:** `SELECT "status", COUNT(*) FROM "FccCampaignContact" GROUP BY "status";` Each run logs an `fcc_campaign` line in the Worker logs (what was sent, replies, bounces, and anything held back).
- **A contact marked `failed`** hit a mail-server error and is waiting for a person. To try again, set its status back to `ready`.

## November 6 hot list (one-off)

A one-time first email to the hot list (`fcc_hot_list_nov6.csv`, outside this repo), ahead of the normal queue. Copy: `renderFccEmailNov6` in `src/lib/fcc-campaign.ts` (Aidan's NOV-6-EMAIL wording). Contacts are under campaign key `fcc-nov6-hot`, one first email each, no day-3 follow-up. Anyone it reaches is out of the March queue for good: no March first email and no March follow-up. The hot list shares each inbox's daily ceiling, and the normal queue waits until it is empty. Nothing is sent before the go.

**Who sends it.** Only the first inbox (Aidan's), because that's where anyone emailed so far would have replied. **Who it skips.** Anyone whose March row is held, failed, replied, bounced or suppressed, unless the only reason is that they signed a 2026 declaration: that stop is about the March wording, and this email's line is written for them. Anyone at a company where another mailbox replied, is suppressed or is held for a non-generic reason (shared hosts and free mail don't count). Everyone on it gets an inbox check first, so an unrecorded reply from their company also stops it. **Last day.** It closes after `FCC_NOV6_LAST_SEND_DAY` (Thu Nov 5), and anyone it never reached rejoins the March queue. **Replies.** The daily reply check reads this list too and tells both founders who wrote back. Add any "no thanks" to the do-not-email list.

**Read this first.** Changing `FCC_COPY_VERSION` to `fcc-march1-pack-v6-nov6` locks the whole campaign, including the current March queue, until a new go names it. The go also releases the normal v4 first emails and follow-ups under that same version. Deploy the code only when you want that.

1. **Build the SQL (locally, nothing sent).** Write it outside the repo:
   ```
   npx tsx scripts/fcc-campaign.ts import-nov6-sql <path>\fcc_hot_list_nov6.csv <path>\fcc_nov6_import.sql
   ```
   It prints the rows, how many are sendable, and how many are held (generic inboxes, by the address or the file's `email_type`). Expect 242 rows: 197 sendable, 45 held.
2. **Load (no email goes out).**
   ```
   npx wrangler d1 execute axiom-ops-omniscient --remote --config wrangler.production.jsonc --file <path>\fcc_nov6_import.sql
   ```
   Re-running it never duplicates anyone.
3. **Check overlap with the March pack before the go.** The sender skips anyone whose March contact has replied, bounced or been suppressed, but it still emails people who only got the March email, in a new thread. Run this to see how many, and decide with Aidan before the go:
   ```
   SELECT COUNT(*) FROM "FccCampaignContact" h JOIN "FccCampaignContact" m ON m."email" = h."email" AND m."campaignKey" = 'fcc-march1-pack-v3-calmer'
     WHERE h."campaignKey" = 'fcc-nov6-hot' AND h."status" = 'ready' AND m."status" IN ('step1_sent','step2_sent');
   ```
4. **Release the code** (merge, then the guarded release), so the Worker has `fcc-march1-pack-v6-nov6`.
5. **Go (only after Aidan says go):**
   ```
   npx tsx scripts/fcc-campaign.ts go-sql Aidan > <path>\fcc-go.sql
   npx wrangler d1 execute axiom-ops-omniscient --remote --config wrangler.production.jsonc --file <path>\fcc-go.sql
   ```
   Weekdays from 10:00 Toronto, the tick sends 30, then up to 30 more from 12:30, only if today has 1 bounce or fewer. At 60 a day it takes Monday to Thursday. Riley's inbox keeps sending normal first emails alongside it. Load the list before the go, or one person can get both emails that morning.
6. **Watch:** the same FCC screen, which shows the hot list as its own "November 6 list" row, and `fcc_campaign` log lines. To count it directly, use `SELECT "status", COUNT(*) FROM "FccCampaignContact" WHERE "campaignKey" = 'fcc-nov6-hot' GROUP BY "status";` (`step1_sent` = emailed, `held` = not sent). Pause with the FCC screen or `pause-sql`.

## Day-7 follow-up and the subject test (v7)

**Read this first.** Releasing this changes `FCC_COPY_VERSION` to `fcc-march1-pack-v7-day7`, which locks all FCC sending (both inboxes, the March queue, and the November 6 list if it is still open) until a founder's go names it. Release and go belong together. The release applies `migrations/0088_fcc_day7_follow_up.sql` first: it rebuilds `FccCampaignSend` so `step` can be 3 and keeps every row, index and trigger.

**The day-7 follow-up.** Aidan's text, approved Oct 29, word for word (Nov 1: keep "I'll close this out after this one"; no day-14 email): `renderFccEmailDay7` in `src/lib/fcc-campaign.ts`. It goes to everyone on the March list who got the first email and the day-3 follow-up, whichever copy they got: in the same thread ("Re: " and their first email's subject), from the inbox that sent the first email, signed by that inbox's founder, with the campaign's mailing address. It falls due 7 days after the first email and at least 4 days after the day-3 one, goes after the day's day-3 follow-ups and before new first emails, and counts inside each inbox's daily limit. It never goes to the November 6 list. Before it goes: the do-not-email list; anyone else at the company (same domain, unless it's a shared mail service or a host several companies use) who replied, was stopped, bounced or is held for anything but a generic inbox; and the inbox check (a reply from the company, or a bounce, since the first email). Someone who got it stays `step2_sent`, so the daily reply check keeps reading for their answer; their `FccCampaignSend` row with `step` 3 records it.

**Check:**
```
SELECT "sendDay", COALESCE("senderAddress",'') AS inbox, COUNT(*) FROM "FccCampaignSend" WHERE "step" = 3 AND "status" = 'SENT' GROUP BY 1, 2;
```
A day-7 email Gmail refused leaves the contact `failed`. To try again, set its status back to `step2_sent` (not `ready`).

**The subject test.** New first emails from both inboxes (not the November 6 email) split by contact id: half keep "Question about <company>'s RMD listing" (Message-ID `<fcc-v7a-…>`), half get "<company>'s FCC listing" (`<fcc-v7b-…>`), with the same short company name the body uses. The words are v5's. Each person's follow-ups answer under their first email's subject. The FCC screen's "What's working" table shows replies for each subject as two "Subject test" rows. People first emailed before this release keep their own copy (v3, v4 or v5).
