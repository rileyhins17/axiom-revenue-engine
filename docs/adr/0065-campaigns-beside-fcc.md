# 0065: Campaigns beside FCC, one inbox budget

Date: 2026-11-05. Status: accepted (Riley's brief, Nov 5; Aidan's plan "Axiom's second path", items 4 and 7).

## Context

The engine sent only FCC emails, with FCC's list, words and rules in code. Cities start Mon Nov 9 and agencies move in the week after; more avenues will follow. FCC runs until the Nov 13 review and must not change before then. Riley: adding an avenue later should take a list, the email words, a schedule and a founder's OK, never new code; no inbox may go over the daily amount it has proven safe, all campaigns counted together; while FCC runs, cities go first.

## Decision

- A generic campaign path beside FCC's (`src/lib/outreach/`), with its own tables (migration 0089): sending inboxes as rows (the password is a named Worker secret), campaigns as rows (list rules, words, schedule, limits, follow-up, approvers, state), batches that wait for a named approver and pin the words they were approved on, contacts with any CSV columns, claimed sends, replies.
- FCC's code stays as it is, with one change: its count, gap and bounce rules for an inbox include the campaigns' emails from that inbox (`outreach-inboxes.ts`), and a lowered limit on the inbox's row binds FCC too. With no campaign emails every FCC number is what it was.
- One minute tick per inbox: campaigns first, FCC only if no campaign email went (`outreach-worker.ts`). No new schedule: the release script still allows only the two crons.
- One do-not-email list for everyone: `EngineEmailSuppression`, which FCC already reads.

## Consequences

- On a day cities use Aidan's inbox, they take its morning half (30) and FCC sends its share after 12:30; FCC's health alarm allows for that.
- FCC can be retired by pausing it; nothing else depends on it.
- Words, lists and limits change with SQL (scripts/outreach.ts) or, from Nov 11, on the Campaigns screen; only behaviour changes need a release.
