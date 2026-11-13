# ADR 0066: The engine is the outreach sender and reply catcher; FCC is an archive

Date: 2026-11-13. Status: proposed (built on a branch, not released; Riley's ask, Nov 12: "the revenue engine shows FCC as 1 of 3 tabs but we dropped FCC as a whole ... needs to be actually perfectly optimal based on what we're using it for").

## Context

Both founders ended FCC on Nov 12, 2026. Its sending has been paused since Nov 11 and will not come back. What the engine is used for now is the campaigns ([ADR 0065](0065-campaigns-beside-fcc.md)): cities and counties, school districts, lists aimed at IT, web and communications contacts, and whatever comes next. Two Gmail inboxes send them.

What the founders do on it:

- Aidan reads a batch's samples and presses Approve. It is the most frequent action and the only one that must happen on the screen.
- Both want to know whether anyone real replied, who answers, and from which inbox.
- Both want to know sending is healthy: each inbox today, pauses, bounces, an inbox resting for the day.
- At the Thursday meeting they judge each test by a few numbers per campaign (cities: requests for the report or a price per 100 emailed, replies, bounces, no thanks).

The phone app had three tabs, Today, FCC and More. Campaigns sat under More and Today was all about FCC.

## Decision

- **Tabs: Today, Replies, Campaigns, More.** More holds Inboxes, the do-not-email list, the FCC archive and Settings. The desktop sidebar lists the same.
- **Today** answers "what needs you, then is everything OK": cards for a campaign that paused itself, a reply check that stopped, replies to answer, batches waiting for *this* founder's Approve, an inbox resting, failed sends; then emails sent today per inbox, each campaign's row, and the week's numbers. Nothing about FCC. The rules are `needsYou` in `src/lib/outreach/outreach-today.ts`.
- **Replies** lists every recorded reply, newest first, with the inbox to answer from and a link that searches that Gmail inbox. A founder can mark a reply answered, and mark it as one that counts toward the campaign's success number (migration 0091 adds four nullable columns to `OutreachReply`). The marks change nothing else: the engine still only reads mail.
- **A campaign's success number** is the count of replies a founder marked. Its name is the optional `successLabel` in the campaign's `rulesJson` ("Price requests" for cities); without one it reads "Interested replies". Sending never reads it.
- **Campaign page** leads with its batches (waiting for approval, then sending, then done), then numbers, the words, schedule and limits (read-only), a search of its people, and Load a list. Follow-ups taken off the schedule show as "on hold".
- **Batch page** keeps its 10 samples and the approval rules exactly. Approve sits in a bar pinned to the bottom and opens a sheet that names the count; the sheet's button is the approval.
- **Inboxes** and **Do-not-email list** are new read-only screens.
- **`/fcc` is the FCC archive**: all-time numbers, read-only. It has no Resume button; it shows Pause only if FCC is ever found switched on. FCC's replies are on Replies under "FCC (ended)". FCC's tables, its do-not-email entries and its sending code stay.
- **The health check** no longer reports FCC as paused, locked or silent. It reports FCC switched on again (`fcc-live`). Every campaign and inbox alert is unchanged.
- **The Monday 8 am email** reports last week for every campaign, with FCC left out. Same once-a-week and retry rules.
- **Dark mode** follows the phone's setting.

## Consequences

- Nothing about who is emailed, what they get, how many, when, or any pause changes. The sender, the reply check and the inbox limits are untouched.
- Each screen makes a fixed handful of database reads however many campaigns or inboxes there are (the free plan allows 50 a request), inside the 12-second limit.
- FCC's sending code still runs its tick each minute and finds itself paused. Removing it is a separate change with its own proof.
- `scripts/demo-data.ts` builds a local database of made-up data for previewing the screens ([LOCAL_PREVIEW](../runbooks/LOCAL_PREVIEW.md)).
