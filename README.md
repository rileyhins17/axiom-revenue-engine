# Axiom Revenue Engine

Axiom's outreach sender and reply catcher. Every campaign (US cities and counties, school
districts, and whatever list comes next) goes from the founders' Gmail inboxes on weekdays,
follows up in the same thread, reads the inboxes for replies and bounces, pauses itself when
something looks wrong, and shows Riley and Aidan what needs them at
[operations.getaxiom.ca](https://operations.getaxiom.ca). FCC, the first campaign, ended on
Nov 12, 2026; its record is kept as an archive ([ADR 0066](docs/adr/0066-outreach-first-engine.md)).

## Screens

Phone tabs (the founders mostly use an iPhone): **Today**, **Replies**, **Campaigns**, **More**.

- **Today**: what needs you, most urgent first, each with one button: a campaign that paused
  itself, replies to answer, batches waiting for your Approve (only the campaign's approver gets
  the card), an inbox resting for the day. Then emails sent today per inbox, each campaign's
  row, and this week's numbers. With nothing to do it says so and when the next email goes.
- **Replies**: everyone who wrote back, newest first, with what they said, which inbox to answer
  from and a link that searches that Gmail inbox. Filters: To answer, Answered, No thanks,
  Automatic, All, and by campaign. A founder marks a reply answered, and marks the ones that
  count toward the campaign's success number (cities: price requests).
- **Campaigns**: every campaign with today, what waits and its results. A campaign's page leads
  with its batches (waiting for approval, sending, done), then numbers, the words, schedule and
  limits, a search of its people, and Load a list. A batch's page shows 10 sample emails exactly
  as they go out and every held row; Approve is pinned to the bottom and asks once more.
- **More → Inboxes**: each sending inbox today: sent of its safe amount, bounces, resting or
  not, when the next email goes, the last reply check, which campaigns use it. Read-only.
- **More → Do-not-email list**: is an address or a domain blocked, why, when, in which campaign.
- **More → FCC archive**: FCC's all-time numbers, read-only.
- **More → Settings**: your account, profile picture and the iPhone home-screen app.

Sign-in is by a 6-digit code emailed to Riley's or Aidan's own inbox. Nobody else
can sign in. The screens follow the phone's light or dark setting.

## How sending works

Read [the campaigns runbook](docs/runbooks/CAMPAIGNS.md) before changing anything about sending. In short:

- Nothing goes to anyone until the campaign is live and the contact's batch was approved by the
  campaign's named approver, for exactly the words it was approved on.
- A tick runs every minute in the send hours. Each inbox sends one email at a time, 1 to 3
  minutes apart, never above its safe daily amount for all campaigns together: half before
  12:30, the rest only if that inbox had 1 bounce or fewer.
- Follow-ups go before first emails, in the same thread, from the same inbox.
- Before every email: the do-not-email list, and whether anyone at the organisation replied.
- A campaign pauses itself when 3 of its own emails bounce in a day, on a Google warning, or
  when Gmail refuses a send or a login. An inbox with 3 bounces in a day rests until morning.
- Every hour from 7:00 to 21:00 the inboxes are read for replies (read-only), and both
  founders get one email per hour that found real ones.
- Every 15 minutes a health check emails both founders about an automatic pause, an inbox
  resting, a live campaign that is silent, or a reply check that stopped. On Mondays at 8:00
  both get last week's numbers for every campaign.

FCC's own sender ([its runbook](docs/runbooks/FCC_CAMPAIGN.md)) is still in the code, paused for good.

## Code

| What | Where |
| --- | --- |
| Worker entry: schedules, request time limit, alert emails | `worker.mjs` |
| FCC (ended): wording and versions | `src/lib/fcc-campaign.ts` |
| FCC (ended): who got what, and when | `src/lib/fcc-campaign-sender.ts`, `src/lib/fcc-campaign-tick.ts` |
| Reply checks | `src/lib/outreach/outreach-replies.ts` (hourly, campaigns), `src/lib/fcc-campaign-replies.ts` (daily, FCC) |
| Monday numbers email | `src/lib/fcc-weekly-numbers.ts` (every campaign; the name is from FCC's days) |
| Campaigns: lists, words, inbox limits, sending | `src/lib/outreach/` |
| What Today, Replies, Inboxes and the do-not-email list show | `src/lib/outreach/outreach-today.ts`, `outreach-reply-list.ts`, `outreach-inbox-health.ts`, `outreach-lookup.ts`, `outreach-week.ts` |
| Health check | `src/lib/ops/health.ts` |
| Local preview with made-up data | `scripts/demo-data.ts`, `docs/runbooks/LOCAL_PREVIEW.md` |
| Gmail over SMTP and IMAP | `src/lib/revenue-engine/smtp-client.ts`, `imap-client.ts` |
| Screens | `src/app/dashboard` (Today), `replies`, `campaigns`, `inboxes`, `do-not-email`, `fcc` (archive), `settings`; building blocks in `src/components/owner/kit.tsx` |
| Contact lists, go and pause SQL | `scripts/fcc-campaign.ts`, `scripts/outreach.ts` |
| Database changes | `migrations/` (next free number: 0092) |

## Working on it

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
```

The live branch is `codex/revenue-engine-production`; `main` is months behind and
must not be deployed. Releases go only through `scripts/release-production.mjs`
(fresh backup, live-settings check, smoke test, automatic rollback), after the day's
last send. Each release is written up at the top of [docs/STATUS.md](docs/STATUS.md).
Lessons that cost time are in [docs/GOTCHAS.md](docs/GOTCHAS.md).

This repository is public. Contact lists, the mailing address and app passwords
never go in it: they live in the gitignored `outreach/` folder or in Cloudflare's
secret store.
