# Gotchas

Traps that cost real time on this engine. Each has the symptom, the cause and the fix.
Older entries from the retired website campaign are in git history before 2026-11-03.

## WORKERS-001 — A cancelled request froze every later page on that copy of the Worker

- **Symptom:** "This page couldn't load" on Today, FCC or Settings, again and again,
  until a hard reload or an Incognito window. The Worker logs showed requests to
  `/dashboard`, `/fcc`, `/settings` and `/api/auth/get-session` that never answered:
  `canceled` after up to 100 minutes, with only 4–20 ms of CPU, each followed by
  "waitUntil() tasks did not complete".
- **Cause:** on Cloudflare, work started inside a request belongs to that request.
  When the browser cancels it (it cancels page preloads all the time), unfinished
  work is dropped and never resolves. Any promise shared at module level then stays
  pending forever, and every later request that awaits it hangs. Sign-in did this
  twice: first a shared auth instance (fixed Oct 28), then better-auth's own
  one-time `import("node:async_hooks")` setup for its three request stores. Every
  nav link also used full prefetch, so each page load started five dynamic renders
  that the browser then cancelled.
- **Fix (2026-11-03):** `worker.mjs` creates better-auth's request stores at startup,
  so sign-in never waits on anything a request started. The old database wrapper with
  its shared "ensure table" promises is gone. Nav links use the default prefetch
  (loading state only). Any read that hasn't answered in 20 seconds gets a 503 that
  the app retries; the sign-in check and screen data give up after 10–12 seconds,
  and `src/app/error.tsx` retries once before showing anything.
- **Prevention:** never cache a promise (or anything pending) in module scope. Watch
  the Worker logs for `page_timeout` and `step_timeout` events: each names the step.

## TEST-001 — A test passed for a week, then failed on the live branch with no code change

- **Symptom:** Nov 13: `npm test` on the untouched live branch failed 1 of 186 ("the hourly reply check reads every inbox ...": "Missing expected rejection"). It had passed at every release up to Nov 5.
- **Cause:** the sender stamps `firstSentAt` with the real clock, and the test's made-up replies were dated Nov 9. Once the real date passed Nov 9, every reply read as older than the email it answered and was skipped.
- **Fix (2026-11-13):** the test sets `firstSentAt` to the morning its fixtures are dated.
- **Prevention:** a fixture with a real date needs every clock pinned, including ones the code under test reads for itself. After writing such a test, run it with the system date moved a month ahead (`faketime`, or temporarily shift the fixture dates back).

## MAIL-001 — A bounce from another mail server went unrecorded

- **Symptom:** Nov 3: a Nov 6 email to a Purelymail-hosted address came back two seconds
  later (5.1.1, no such mailbox), but the contact stayed `step1_sent`, Today and the FCC
  screen showed no bounce, and it counted toward neither the second-batch rule nor the
  3-bounce pause. Aidan's Claude saw it in the inbox.
- **Cause:** the inbox check only counted mail from `mailer-daemon` or `postmaster`.
  Gmail's own bounces and most mail servers use those; Purelymail writes from
  `noreply@purelymail.com`.
- **Fix (2026-11-04):** `FCC_BOUNCE_SEARCH` in `src/lib/fcc-campaign-sender.ts` also counts
  a no-reply sender or a bounce subject ("Undeliverable", "Undelivered Mail Returned to
  Sender", "Mail delivery failed", "failure notice", "Returned mail", "not delivered"). The
  checks that stop a contact still need that contact's address in the body. If Gmail ever
  refuses the wider search, the Google-only one takes over for that session and the logs
  show `fcc_bounce_search_fallback`. The missed contact was marked bounced by hand.
- **Prevention:** `imap-client.test.ts` holds a Purelymail-style and an Exchange-style bounce.
  A Nov 6 contact gets no follow-up, so a bounce that arrives after the day's last tick had
  no later check at all; since Nov 4 each inbox's first look of the day sweeps the last 5
  days' contacts (`FCC_LATE_BOUNCE_DAYS` in `fcc-campaign-tick.ts`). Such a bounce counts
  toward the day it was sent, never toward the new day's pause or second-batch rules.

## MAIL-002 — The signature's logo vanished in Gmail's dark mode

- **Symptom:** Nov 4 (Riley, from the Gmail app on their phone): the Axiom logo at the foot of a
  sent FCC email showed as a white wordmark on a light grey box, barely readable.
- **Cause:** the site's lockup is white on a transparent background (made for its dark pages),
  and the signature put it on a dark cell drawn with CSS (`background:#101318`). Gmail's dark
  mode recolours CSS backgrounds and text (a dark cell turns light) but never touches images,
  so the white image sat on a light tile. Light-mode readers saw it as intended.
- **Fix (2026-11-04):** the dark tile is part of the image file: `public/brand/axiom-lockup-tile-328.png`
  (328x126, shown at 164x63), served by the app itself at `FCC_LOGO_URL`, with no CSS colour
  behind it. The look is the same in both modes.
- **Prevention:** `fcc-campaign.test.ts` fails if a CSS background comes back behind the logo
  or the file goes missing or changes size. Rule for any email image: a logo that needs a
  particular background must carry that background in the file.

## OPS-015 — Cloudflare weekday 1 is Sunday

- **Symptom:** a "weekday" schedule (`1-5`) ran on a Sunday.
- **Cause:** Cloudflare numbers weekdays 1 = Sunday to 7 = Saturday.
- **Fix:** schedules that need weekdays use names (`MON-FRI`). The FCC tick runs every
  day and decides weekdays itself, in Toronto time.
- **Prevention:** `src/lib/ops/schedules.test.ts` pins the live schedules and their
  handlers.

## DATA-013 — Windows checkouts changed migration bytes

- **Symptom:** tests reported the schema differed from the migrations in a new Windows
  worktree.
- **Cause:** `core.autocrlf=true` checked the SQL out as CRLF.
- **Fix:** `.gitattributes` pins `migrations/*.sql` to LF.

## DATA-014 — A parent table with ON DELETE RESTRICT children can't be rebuilt alone on D1

- **Symptom:** a table rebuild failed with `FOREIGN KEY constraint failed`.
- **Cause:** D1 always enforces foreign keys and applies RESTRICT at once, even when
  deferred.
- **Fix:** copy the parent and all children aside, drop children first, recreate and
  restore with rowids, then recreate triggers and views. Rehearse on a full live
  export before a release.

## DATA-015 — D1's remote runner rejects CASE inside a trigger body

- **Symptom:** `migrations apply --remote` failed with `incomplete input` although the
  same file worked locally.
- **Cause:** the remote runner splits statements itself and reads the `END` of a
  `CASE ... END` as the trigger's end.
- **Fix:** write trigger guards as `SELECT RAISE(ABORT, '...') WHERE <condition>;`.

## BUILD-004 — OpenNext compiles local `.env` values into the bundle

- **Symptom:** a local secret appeared in `.open-next/cloudflare/next-env.mjs`.
- **Cause:** OpenNext compiles Next's `.env*` files into a runtime fallback module.
- **Fix:** `build:cloudflare` runs `scripts/sanitize-cloudflare-bundle.mjs`, which
  empties that module and scans the bundle for secrets before anything can upload.
  Never bypass it.

## BUILD-005 — A reused checkout traces ignored files into the bundle

- **Symptom:** the sanitizer stopped a build over private files in the bundle.
- **Cause:** Next traced ignored local files (and an untracked `.mts` in `outreach/`
  even breaks the type check). A clean git index is not a clean build folder.
- **Fix:** release from the clean `rv` clone, and keep scratch files out of the repo.

## TOOL-001 — Shell-quoted edits dropped regex backslashes

- **Symptom:** a regex in a file changed meaning after an edit made through a shell
  string (`\D` became `D`).
- **Fix:** make regex-bearing edits with a file-editing tool or a script file, then
  re-read the line.

## UI-003 — An entrance animation trapped fixed phone UI

- **Cause:** `template.tsx` animates every page; an animation that fills `both` leaves
  a transform, and a transformed ancestor becomes the containing block for
  `position: fixed`.
- **Fix:** entrance animations fill `backwards` only.

## UI-004 — Unlayered CSS outranks Tailwind's `hidden`

- **Cause:** Tailwind v4 utilities live in `@layer utilities`; an unlayered
  `.owner-* { display: ... }` rule wins regardless of specificity.
- **Fix:** hide with an explicit rule in `globals.css`, and check for unlayered
  `display` rules before relying on `hidden`.
