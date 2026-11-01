# FCC campaign: going live

**What it does (Aidan's send rules, Oct 27).** On weekdays the live app sends FCC emails from Aidan's Gmail, one at a time, 1 to 3 minutes apart (random), so 30 take about an hour. The first 30 start at 10:00 Toronto time. From 11:45 and from 1:30 up to 30 more go each time, but only if today has 1 bounce or fewer: 90 a day is the ceiling (Aidan, Nov 1). Follow-ups that are due go first (3 days after the first email, in the same thread) and count toward the day. Before each email it checks Aidan's inbox: if anyone at that company wrote back, or an email bounced, that contact stops. Bounces go on the permanent do-not-email list. Generic inboxes (support@, info@ and the like) are never sent to. The emails are plain text with one link (the signature), no tracking and no attachments.

**When it pauses itself.** Any of these pauses the whole campaign until Riley or Aidan presses Resume on the FCC screen: a Google "critical security alert" or "suspicious" notice, or a Gmail "sending limit" or "message blocked" bounce in the inbox that day; 3 or more bounces in a day; Gmail refusing the login; Gmail refusing an email. The reason shows on the FCC screen. Nothing can text anyone, so someone watches the FCC screen around 10:05 and at noon.

**What it never does.** Send anything before a founder's go is recorded. Send more than 90 a day. Send two emails at once. Email anyone twice for the same step, even after a crash. Change or delete anything in Aidan's mailbox (the inbox check is read-only). Obey or touch the old website outreach stops in Settings: the FCC screen's Pause is the only FCC stop.

Code: `src/lib/fcc-campaign-tick.ts` (the minute-by-minute schedule and safety pauses), `src/lib/fcc-campaign-sender.ts` (who gets what, claims), `src/lib/fcc-campaign-control.ts` (pause/resume), `src/lib/fcc-campaign-worker.ts` (live wiring, cron `* 14-19 * * *`), `src/app/fcc/page.tsx` (screen), `migrations/0086_fcc_campaign_contacts.sql` (tables, starts locked), `scripts/fcc-campaign.ts` (tools). Decision: `docs/adr/0063-fcc-send-tick.md`.

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

A one-time first email to the hot list (`fcc_hot_list_nov6.csv`, outside this repo), ahead of the normal queue. Copy: `renderFccEmailNov6` in `src/lib/fcc-campaign.ts` (Aidan's NOV-6-EMAIL wording). Contacts are under campaign key `fcc-nov6-hot`, one first email each, no day-3 follow-up. Anyone it reaches is out of the March queue for good: no March first email and no March follow-up. The hot list shares the 90-a-day ceiling, and the normal queue waits until it is empty. Nothing is sent before the go.

**Who it skips.** Anyone whose March row is held, failed, replied, bounced or suppressed. Anyone at a company where another mailbox replied, is suppressed or is held for a non-generic reason (shared hosts and free mail don't count). **Last day.** It closes after `FCC_NOV6_LAST_SEND_DAY` (Thu Nov 5), and anyone it never reached rejoins the March queue. **Replies.** Replies and opt-outs to this email aren't recorded by the engine, because it has no follow-up to check them: read them in Gmail and add any "no thanks" to the do-not-email list by hand.

**Read this first.** Changing `FCC_COPY_VERSION` to `fcc-nov6-v5` locks the whole campaign, including the current March queue, until a new go names it. The go also releases the normal v4 first emails and follow-ups under that same version. Deploy the code only when you want that.

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
4. **Release the code** (merge, then the guarded release), so the Worker has `fcc-nov6-v5`.
5. **Go (only after Aidan says go):**
   ```
   npx tsx scripts/fcc-campaign.ts go-sql Aidan > <path>\fcc-go.sql
   npx wrangler d1 execute axiom-ops-omniscient --remote --config wrangler.production.jsonc --file <path>\fcc-go.sql
   ```
   Weekdays from 10:00 Toronto, the tick sends 30, then up to 30 more from 11:45 and from 1:30, only if today has 1 bounce or fewer. At 90 a day it takes Monday to Wednesday. Load the list before the go, or one person can get both emails that morning.
6. **Watch:** the same FCC screen, which shows the hot list as its own "November 6 list" row, and `fcc_campaign` log lines. To count it directly, use `SELECT "status", COUNT(*) FROM "FccCampaignContact" WHERE "campaignKey" = 'fcc-nov6-hot' GROUP BY "status";` (`step1_sent` = emailed, `held` = not sent). Pause with the FCC screen or `pause-sql`.
