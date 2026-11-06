# Campaigns: every outreach list beside FCC

**What it is (Riley, Nov 5 2026).** The engine is the one sender for all our outreach. Each campaign has its own list (a CSV with any columns), email words with `{column}` blanks, schedule, daily limit, follow-up, Pause button and numbers, on the Campaigns screen (operations.getaxiom.ca/campaigns). FCC keeps its own code and screen until it stops; it shares the inboxes with the campaigns. Adding an avenue takes a list, the words, a schedule and a founder's OK: rows and SQL, never new code. Decision: `docs/adr/0065-campaigns-beside-fcc.md`.

## What every campaign does

- **Gates.** Nothing goes to anyone until the campaign is live (Pause/Resume on its screen) and the contact's batch has been approved by the campaign's named approver (cities: Aidan), after reading 10 samples exactly as they will go out. The approval is for the words at that moment: changed words lock every batch until it is approved again.
- **Holds.** A row is held (never sent) when its address is invalid or repeats an earlier row, a hold rule fails (cities: `verified` must be yes or true), a blank the words use is empty, an email can't be written from it (a first email with a link or web address), or the address is on the do-not-email list. Held rows and their reasons are on the batch screen. An address already in the campaign is skipped.
- **Words.** Plain text. The first email's words start with `Subject: ...`. Follow-ups go in the same thread, from the same inbox, with "Re: " and the first subject. `{sender_name}` and `{sender_first_name}` are the sending inbox's name. The engine adds the footer itself: `Axiom · <mailing address>` and `Not useful? Reply "no thanks" and we won't email you again.` (the address is `FCC_CAMPAIGN_MAILING_ADDRESS`). No HTML, images or attachments ever.
- **Order and limits.** Due follow-ups first, then first emails (batch order, then CSV row order), up to the campaign's daily limit (follow-ups count) and its share of each inbox.
- **Inbox safety, shared with FCC** (`src/lib/outreach/outreach-inboxes.ts`). Per inbox per Toronto day, all campaigns and FCC together: never above its safe amount (`OutreachInbox.dailyMax`, or its ramp while new); half of it from the start of the day, the rest only from 12:30 and only if that inbox had at most 1 bounce; one email at a time, 1 to 3 minutes apart. Each minute the campaigns' tick runs first and FCC's tick runs only if no campaign email left that inbox (`src/lib/outreach/outreach-worker.ts`), so campaigns go before FCC.
- **Checks before every email.** The do-not-email list (any bounce or "no thanks" in any campaign or FCC); someone else at the same organisation already replied or was stopped; before a follow-up, the inbox is read for a reply from the person or their organisation (not shared mail services) or a bounce since the first email.
- **Replies** (`src/lib/outreach/outreach-replies.ts`). Every hour from 7:00 to 21:00 Toronto, every day, the 15-minute check reads every sending inbox (All Mail and Spam, read-only), whichever one sent the email, for a message from anyone a campaign emailed or from their organisation. A reply (or an automatic reply, unless the campaign's `stopOnAutoReply` is false) stops their follow-ups for good. A "no thanks", "not interested", "unsubscribe" and the like also puts the address (and a colleague's, if a colleague said it) on the do-not-email list. Both founders get one email per hour that found real replies, with the words and which inbox to answer from; a failed email is sent again the next hour. Each reply is stored once in `OutreachReply`.
- **Pauses** (until a founder presses Resume): 3 of a campaign's own emails bounced in a day pauses that campaign only (Aidan, Nov 5: "a city bounce never pauses FCC or agency sending"); FCC pauses on its own 3. A Google warning in the inbox, or Gmail refusing the login or an email, pauses every campaign on that inbox. Separately, an inbox with 3 bounces in a day from everyone together (campaigns and FCC) sends nothing more that day and starts again the next morning, with nobody paused: Google judges the inbox, not the campaign. The health check emails both founders about an automatic pause, an inbox stopped for the day, and a live campaign with people waiting that has sent nothing an hour into its send hours.
- **Mail servers.** Loading a list looks up every email domain (Cloudflare DNS over HTTPS): a domain with no mail server, a "null MX" or no such domain holds its rows ("... has no mail server, so the email would bounce"). A lookup that keeps failing stops the load; nothing is written. Batches should still arrive checked by Emailable (Aidan's side); the engine doesn't call it.
- **Every bounce** goes on `EngineEmailSuppression` (`BOUNCED`), which FCC also reads, so nobody who bounced anywhere is emailed again.
- **Test emails** go only to Riley's or Aidan's own inbox (`TEST_INBOXES`, fixed in code): "Send me a test" on a batch queues 3 samples and their follow-ups; the 15-minute check sends them.

## Cities (Aidan's second path, item 4)

Campaign `us-cities`: weekdays 9:00 to 14:30 Toronto from Mon Nov 9, 30 a day, Aidan's inbox only until the Fri Nov 13 review, one follow-up 5 business days later, approver Aidan, priority 10. Aidan's Claude posts each batch in the Slack DM (columns: email, first_name, title, city, state, population, website, contact_page, verified, error_count, worst_problem, pdf_date, pdf_url, scan_date) with the two texts.

## Load a batch from the screen (any founder, no PC needed)

Campaigns → the campaign → **Load a list** (`/campaigns/<key>/load`). Pick the CSV (or paste it), give the batch a name, and change the words only if they are new. **Check the list** saves nothing: it shows how many rows are ready and held (with each reason) and the first 3 emails with their follow-ups exactly as they would go. **Load this batch** saves exactly what was checked and opens the batch, which waits for the campaign's approver (cities: Aidan) to read 10 samples and press Approve. New words are saved for the whole campaign and lock every approved batch until it is approved again. Up to 300 rows and 40 different email domains per load (the free plan allows 50 outside requests per request, and each domain is one mail-server lookup); bigger lists load from a PC.

## Load a batch (from a PC with this repo)

```
npx tsx scripts/outreach.ts preview <first.txt> <followup.txt> <list.csv>            # read the samples and holds, nothing written
npx tsx scripts/outreach.ts words-sql us-cities <first.txt> <followup.txt> <out\words.sql>
npx tsx scripts/outreach.ts import-sql us-cities "Cities batch 1" <list.csv> <first.txt> <followup.txt> <out\batch.sql>
npx wrangler d1 execute axiom-ops-omniscient --remote --config wrangler.production.jsonc --file <out\words.sql>
npx wrangler d1 execute axiom-ops-omniscient --remote --config wrangler.production.jsonc --file <out\batch.sql>
```
Keep CSVs and SQL outside the repo or in the gitignored `outreach/` folder (they hold names and addresses). Re-running a batch file changes nothing. Then the approver opens the batch on the Campaigns screen, reads the samples and presses Approve. If they approve somewhere else (Slack), record it with `approve-sql <batch id> Aidan "<where he said so>"` only after they said so.

## Change a setting (no release)

```
npx tsx scripts/outreach.ts settings-sql us-cities <out\s.sql> state=live
npx tsx scripts/outreach.ts settings-sql us-cities <out\s.sql> 'inboxesJson=[{"address":"aidanmageebusiness@gmail.com","perDay":60},{"address":"rileyhinspergerbusiness@gmail.com","perDay":60}]' dailyLimit=120
```
Then run the file with `wrangler d1 execute ... --file`. Raising limits, adding inboxes or changing who is emailed needs both founders' yes (AGENTS.md).

## Add a campaign (a new avenue, no code)

```
npx tsx scripts/outreach.ts new-campaign-sql agencies "Agencies: overflow web work" <out\new.sql> 'inboxesJson=[{"address":"...","perDay":10}]' dailyLimit=10 'approversJson=["Aidan"]' [followUps=1 followUpBusinessDays=4 priority=20 'rulesJson={...}' sendDays=... windowStart=... windowEnd=... startDay=...]
```
Run the file with `wrangler d1 execute ... --file`. The campaign starts paused and sends nothing until its words and a first list are loaded (Campaigns screen → Load a list), its approver approves the batch, and a founder presses Resume. Its inboxes must be sending inboxes (below); both founders' yes is needed for a new avenue's limits (AGENTS.md).

## Add a sending inbox (no rebuild)

1. The inbox's owner makes a Gmail (or Workspace) app password. It never goes in a file or a chat.
2. `npx wrangler secret put SENDER_PASSWORD_<NAME> --config wrangler.production.jsonc` (the owner pastes it).
3. One row: `INSERT INTO "OutreachInbox" ("address","name","passwordSecret","dailyMax","rampJson","rampFrom") VALUES ('new@domain.com','Riley Hinsperger','SENDER_PASSWORD_<NAME>',60,'[15,30]','<first send day>');` A new inbox ramps 15 a day, then 30, then its dailyMax.
4. Add it to a campaign's `inboxesJson`. A non-Gmail provider: set `smtpHost`/`imapHost` (ports 465 and 993, TLS).

## Check

- Screen: operations.getaxiom.ca/campaigns (numbers, next send, last check, batches, replies, bounces, problems).
- Logs: each minute an `outreach_tick` line (per inbox: `SENT`, `CHECKED`, `PAUSED` or why it skipped) beside FCC's `fcc_campaign` line.
- SQL: `SELECT "status", COUNT(*) FROM "OutreachContact" WHERE "campaignKey" = 'us-cities' GROUP BY 1;`
- A contact marked `failed` waits for a person: set it back to `ready` (first email) or `sent` (follow-up) to retry.
