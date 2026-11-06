# Axiom Revenue Engine

Axiom's outreach engine: the one sender for every outreach list. Campaigns (US cities from Nov 9,
agencies next) and the FCC filing emails go from the founders' Gmail inboxes on weekdays, follows up in the same thread, checks the inboxes for replies
and bounces, pauses itself when something looks wrong, and shows Riley and Aidan
what happened at [operations.getaxiom.ca](https://operations.getaxiom.ca).

## Screens

- **Today**: today's sends per inbox, the latest replies to answer, follow-ups and
  how long the ready list lasts. A banner says when sending is paused or locked.
- **Campaigns**: every list beside FCC (cities first): next send, Pause and Resume per campaign,
  numbers, batches with 10 sample emails exactly as they will go out, held rows and Approve.
- **FCC**: the full campaign: next send, Pause and Resume, sends per day, reply and
  bounce rates by email version and inbox, batches, replies, bounces and problems.
- **Settings**: your account, profile picture and the iPhone home-screen app.

Sign-in is by a 6-digit code emailed to Riley's or Aidan's own inbox. Nobody else
can sign in.

## How sending works

Read [the campaigns runbook](docs/runbooks/CAMPAIGNS.md) and [the FCC runbook](docs/runbooks/FCC_CAMPAIGN.md)
before changing anything about sending. Campaigns and FCC share each inbox's safe daily amount and its
1 to 3 minute gap, and campaigns go first. FCC in short:

- A tick runs every minute from 10:00 Toronto time on weekdays. It sends one email
  at a time, 1 to 3 minutes apart, in two windows (10:00–12:00 and 12:30–2:30). The
  second window opens only if 1 or fewer emails bounced that morning.
- Each inbox has its own daily ceiling. A new inbox starts small and climbs.
- Follow-ups go before new companies: one 3 days after the first email and a last
  one about 7 days after it, in the same thread, from the same inbox.
- Before every email the inbox is checked: anyone at that company who wrote back,
  or an address that bounced, gets nothing more.
- It pauses itself on a Google warning, a refused send or 3 bounces in a day. Only a
  founder's Resume reopens it.
- Any new email wording locks sending until a founder's go names that version.
- Every 15 minutes a health check emails both founders if sending is paused, locked
  during send hours, silent by 11:00 on a weekday, or if the 9 a.m. reply check
  hasn't finished by 10:30. It emails again once it's fixed.

## Code

| What | Where |
| --- | --- |
| Worker entry: schedules, request time limit, alert emails | `worker.mjs` |
| Email wording and versions | `src/lib/fcc-campaign.ts` |
| Who gets what, and when | `src/lib/fcc-campaign-sender.ts`, `src/lib/fcc-campaign-tick.ts` |
| Reply check | `src/lib/fcc-campaign-replies.ts` |
| Pause, resume and notes | `src/lib/fcc-campaign-control.ts` |
| Numbers for the screens | `src/lib/fcc-campaign-status.ts` |
| Campaigns: lists, words, inbox limits, sending, screens | `src/lib/outreach/`, `src/app/campaigns` |
| Health check | `src/lib/ops/health.ts` |
| Gmail over SMTP and IMAP | `src/lib/revenue-engine/smtp-client.ts`, `imap-client.ts` |
| Screens | `src/app/dashboard`, `src/app/fcc`, `src/app/settings` |
| Contact lists, go and pause SQL | `scripts/fcc-campaign.ts`, `scripts/outreach.ts` |
| Database changes | `migrations/` (next free number: 0091) |

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
