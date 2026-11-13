# Owner context

What the engine is for and who decides what. This repository is public, so there are
no personal details, contact lists or prices beyond what the emails themselves say.

## The business

- Axiom ([axiominternational.ca](https://axiominternational.ca/fcc-filings/)) helps US
  voice providers with their listing in the FCC's Robocall Mitigation Database. Every
  listing must be recertified by March 1 each year, and about 3,600 providers show no
  2026 recertification.
- The first email offers a free short list of what looks out of date on the listing.
  Paid help after that is a flat price, stated in the email: Axiom prepares the updates
  and a fresh mitigation plan, and the provider's own officer files them from their own
  FCC login. Axiom never holds a login, isn't a law firm and gives no legal advice.
- When a listing's Recertify button looks closed, the first email offers only the free
  list, with no price (copy v8, Nov 3).

## The engine's job

Send the FCC emails from the founders' Gmail inboxes, follow up in the same thread, find
replies and bounces, stop itself when something looks wrong, tell both founders, and show
what happened. Nothing else. Calls, lead search, the website campaign and AI drafting
were removed on 2026-11-03 ([ADR 0064](adr/0064-fcc-only-engine.md)).

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
