# ADR 0003 — Treat every website target and redirect as untrusted

- Status: accepted
- Date: 2026-08-22

## Decision

Website capture will run through one bounded adapter. It accepts only canonical
public HTTP(S) domain names on standard ports, rejects credentials, IP literals,
local/reserved names, control characters, and oversized URLs, and validates every
redirect before making the next request. Redirects are followed manually, with a
maximum of five. A complete capture is limited to ten seconds and 1 MiB of HTML;
non-HTML, empty, oversized, looping, blocked, and failed responses remain explicit
outcomes rather than usable evidence.

The engine Worker must keep Cloudflare's `global_fetch_strictly_public`
compatibility flag. This routes global `fetch()` calls as public-Internet requests
instead of allowing a same-zone origin shortcut. See Cloudflare's
[compatibility flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
and [redirect warning](https://developers.cloudflare.com/workers/runtime-apis/request/#properties).

## Why

Discovery providers and websites are untrusted input. Automatic redirect
following could bypass the first URL check, reach an internal or reserved target,
forward headers to another host, loop indefinitely, or consume unbounded memory.
The audit cannot be commercially trustworthy if a partial or rejected fetch is
silently treated as page evidence.

## Consequences

- The capture transport is injected in tests; fixtures never contact a live site.
- The inert Worker still does not call the adapter and has no queue, route,
  schedule, provider credential, or execution budget.
- Every redirect starts a new header-safe request; cookies, authorization, and
  source-provider headers are never forwarded.
- IP-hosted and non-standard-port sites enter manual review unless a later,
  separately approved policy safely supports them.
- HTML extraction, Browser Rendering, screenshots, R2 persistence, and real
  source acquisition require later release gates.
