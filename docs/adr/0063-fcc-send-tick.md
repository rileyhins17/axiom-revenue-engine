# ADR 0063: FCC emails go out from a one-minute tick, not a daily burst

Date: 2026-10-27. Status: accepted (Aidan's send rules, Slack 19:59 EDT; Riley's session).

## Context

The FCC sender ran once at 14:00 UTC on weekdays and sent up to 30 emails over one
SMTP connection in about a minute. Aidan asked for the opposite of a burst: start
at 10:00, space emails 1 to 3 minutes apart at random, add a second batch of 30 at
about 12:30 only when the morning had 1 bounce or fewer, and pause everything on a
Google warning or 3 bounces. His Gmail is the only channel, so it must not be
flagged.

A Worker cron invocation can't wait an hour. AGENTS.md prefers Queues or Workflows
for new long-running work, but neither is bound to this Worker yet, and adding one
the night before the first send would add new infrastructure to the riskiest path.

## Decision

- A new cron `* 14-19 * * *` runs one FCC tick a minute. The tick reads Toronto
  time, so 10:00 stays 10:00 after the clocks change (and weekdays never depend on
  Cloudflare's weekday numbering, GOTCHAS OPS-015).
- Each tick sends at most one email. The gap after an email is 60 to 180 seconds,
  derived from its random send id, so every tick agrees on it; a tick waits inside
  its minute for the exact moment.
- The claim is one SQL statement guarded by the day's cap and a 50-second gap, so
  overlapping or repeated ticks can't send two at once or pass the cap.
- Safety pauses set `FccCampaignSetting.enabled = 0` and record why in `KvStore`
  (`fcc.control`), with no migration. Only a founder's Resume reopens it, and only
  for a copy key that has a recorded go.
- The old 14:00 cron keeps running only the retired website batch.

## Consequences

- About 360 more Worker invocations a day, most of which return at once. No cost
  change.
- One Gmail login (inbox, then sending) per email instead of one per day.
- Detecting Google notices in the inbox is best effort (subject and body search).
  Gmail's own refusals (limits, blocks, login) are caught reliably at send time.
- If this ever needs longer waits or more steps, move it to a Workflow.
