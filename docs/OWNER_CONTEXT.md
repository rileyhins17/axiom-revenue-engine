# Owner context

What the engine is for and who decides what. This repository is public, so there are
no personal details, contact lists or prices beyond what the emails themselves say.

## The business

- Axiom is Riley and Aidan's web studio. It finds work by email: each campaign is one list
  and one offer (US cities and counties: a free website accessibility report ahead of the
  April 2027 deadline; school districts; the next list after that).
- The founders judge each campaign at their Thursday meeting by a few numbers: emails sent,
  real replies, no thanks, bounces, and the campaign's own success number (cities: requests
  for the report or a price, per 100 emailed).
- The first campaign, FCC filing help for US voice providers, ran Oct 26 to Nov 11, 2026 and
  was ended by both founders on Nov 12. Its record is kept.

## The engine's job

Send each campaign's emails from the founders' Gmail inboxes, follow up in the same thread,
find replies and bounces, stop itself when something looks wrong, tell both founders, and show
what needs them. Nothing else. Leads and conversations live in Axiom Command, not here: the
engine finds the reply, a founder answers it from Gmail.

## Who decides

- Riley and Aidan are the only users and the only people who decide the email wording
  (each new version needs a founder's go), which contacts are loaded, how many go out
  each day, pausing and resuming, and releases.
- Claude sessions build, test and release through `scripts/release-production.mjs`.
  They never change who gets emailed, what it says, how many go out, or the pause
  without a founder's word, and they never send an email or message on a founder's
  behalf.
- A founder answers each reply within 2 hours, using the saved replies in Gmail.

## What good looks like

- Every weekday the emails go out on time. If anything stops them, both founders get an
  email within 15 minutes saying what happened and what to do.
- The Today screen answers three questions in 10 seconds: did today's emails go, who
  replied, and what's next.
- The engine costs nothing beyond the existing Cloudflare plan.
- Plain words everywhere: no unexplained jargon, and no "healthy" claim without a real
  check behind it.
