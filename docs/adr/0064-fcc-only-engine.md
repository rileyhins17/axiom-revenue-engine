# ADR 0064: The engine does FCC emails only

Date: 2026-11-03. Status: accepted (Riley, Nov 3: the calls and the rest "aren't
needing to be talked about at all in there").

## Context

Only the FCC email campaign is live, but the app still carried the retired website
campaign: lead search and a weekday discovery schedule that spent Google Places
requests, the website check, the call list and connected calling, AI drafting, the old
outreach email engine, the vault, their APIs, and about 490 files nothing reached. That
made the server bundle about 1.9 MB compressed, so fresh copies of the Worker started
slowly, and it kept switches and routes that could send or change data with nobody
looking at them. Its shared start-up promises were also part of the "This page couldn't
load" hangs (GOTCHAS WORKERS-001).

## Decision

- Three signed-in screens: Today, FCC and Settings. Every retired path redirects to
  Today.
- Two schedules: the 15-minute health check, which also starts the 9 a.m. reply check,
  and the one-minute FCC tick ([ADR 0063](0063-fcc-send-tick.md)). Discovery, the old
  engine email, caller sync and internal tasks are gone.
- The health check watches FCC sending: paused, locked during send hours, nothing sent
  by 11:00 with people waiting, and a late reply check. It emails both founders once,
  reminds daily, and says when it's fixed.
- Plain D1 SQL everywhere. The Prisma wrapper and its shared "make sure the table
  exists" promises are gone.
- No migration drops anything. The old campaign's tables stay in the database, unread,
  until a founder decides otherwise.
- The release script stops on any automation switch that isn't `"false"`, on any
  schedule other than the two above, and if `/fcc` doesn't send a signed-out visitor to
  sign-in.

## Consequences

- The server bundle is 1.37 MB compressed, and `npm test` runs in about 10 seconds.
- Bringing back calls or lead search means restoring code from git history before
  2026-11-03, with a new ADR.
- ADRs 0001 to 0060 and 0062 described the retired system and are in git history. ADR
  0061 (how the live database was upgraded in place) and ADR 0063 still apply.
