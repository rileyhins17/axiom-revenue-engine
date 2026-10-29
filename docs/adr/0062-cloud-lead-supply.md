# ADR 0062: Cloud lead supply — server search, wider market, cloud website check

- Status: accepted (owner decisions 2026-09-26 and 2026-09-27)
- Date: 2026-09-28
- Supersedes: the local-run parts of ADR 0060 (discovery and website check now run on Cloudflare)

## Context

The call list ran dry on 2026-09-26: every business had been called, and new
businesses only arrived when Riley ran the Places search and the Playwright website
check on his own computer. Riley does not want any scraping on his computer. The
original market (Kitchener, Waterloo, Cambridge × roofing, HVAC, landscaping) is
mostly exhausted: a 30-request search now finds ~330 businesses but adds ~7 new ones.
Aidan's call notes (Sep 22) say visibly broken websites are the best targets, so the
businesses that list a website (held back until checked) matter as much as the
no-website ones.

## Decision

1. **Server search (migration 0081).** Google Places Text Search runs on the main
   Worker every weekday at 07:00 Toronto (30 requests) and when an owner presses
   "Find new leads now" (10 requests), capped at 600 requests a month (free tier is
   1,000) and by the Google Cloud daily quota (40). No-website businesses with a
   phone join the call list; businesses with a website wait in `DiscoveryHeld`.
   Owner decision: Google's name, phone and address are stored (Google's terms allow
   only place IDs; the owner accepted the key-suspension risk).
2. **Wider market (migration 0083).** Guelph, Brantford, Stratford, Woodstock,
   Elmira, New Hamburg, Ayr and Breslau; plumbing and electrical. `EngineProspect`
   is rebuilt because SQLite cannot change a CHECK constraint. Its five child tables
   are rebuilt with identical definitions because D1 always enforces foreign keys and
   ON DELETE RESTRICT fires immediately even with deferred keys (GOTCHAS DATA-014).
   Rowids are preserved, so call-history order and Caller source revisions are
   unchanged. The search rotation puts never-searched towns and trades first and
   spreads each day's searches across towns; a business's town comes from Google's
   address when it names one of the eleven towns.
3. **Cloud website check (migration 0084, Worker `axiom-site-check`).** The same
   capture (`engine-site-capture-v1`) and rules (`engine-lead-rules-v8`, v7 plus the
   new towns and trades in the generic-domain check) run on Cloudflare Browser Run
   through `@cloudflare/playwright`, six sites every 10 minutes on weekday daytimes,
   at most 120 a day (~25 browser-minutes, inside the included hours). STRONG (weak
   website) and WEAK businesses join `EngineProspect` with their reasons, exactly as
   the local publish step did; WRONG is recorded but not added; a site that will not
   load is retried, then marked FAILED. Only labels, reasons, the final URL and
   versions are stored. It is a separate Worker with no public address, so it cannot
   slow down or break the app or calling; `SITE_CHECK_ENABLED` pauses it.
4. **Schedules name their weekdays** (`MON-FRI`): Cloudflare numbers weekdays from
   1 = Sunday (GOTCHAS OPS-015). The Worker also accepts the numeric form.
5. **Health checks** email both owners if the morning search did not run, Google
   refused the key, or the website check stalled or cannot open sites.

## Verification

- 0083 rehearsed on a full export of live (all 150 tables, every rowid, all 231
  Caller revisions, lists, queue and Caller tasks identical; rules still enforced)
  and, with 0084, through `wrangler d1 migrations apply` on the local D1 engine.
- Cloud capture graded nine businesses the local run had graded on 2026-09-24:
  5/5 weak and 4/4 working matched, with the same reasons (one site now serves
  HTTPS, so "not secure" no longer applies).
- Unit tests cover the rotation, town mapping, the site-check writer (weak/working/
  WRONG, retries, caps, idempotency), both migrations and the new health checks.

## Consequences

- Spend: Places stays in the free tier; Browser Run stays inside the Workers Paid
  plan's included hours at 120 checks a day. Raising the Google daily quota (for
  example to 100) would be free within the 600/month cap and is the next lever.
- A future table rebuild must follow the 0083 pattern and its test.
- The local weekly run and publish scripts remain for reference; they are no longer
  the source of new businesses.
