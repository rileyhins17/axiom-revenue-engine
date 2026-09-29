# ADR 0022 — Bound manifest HEAD observations before connecting R2

- Status: accepted
- Date: 2026-08-25

## Context

Artifact availability v2 requires one fresh, exact `R2_HEAD` observation for
every manifest object before a database snapshot can become transactionally
complete. The engine still has no R2 bucket, binding, credential, runtime route,
or provider adapter. Caller-supplied JSON must not be able to impersonate the
future trusted provider boundary.

The earlier storage policy also used `QUALIFICATION_180D` as if it authorized an
R2 lifecycle delete. ADR 0021 established that 180 days is a review boundary,
not deletion authority, but the lower-level lifecycle generator still contained
the older rule.

## Decision

Version 1 introduces an injected fixture-only manifest HEAD adapter. It:

- validates one exact manifest, request/receipt identity, request time, and a
  freshness window of at most five minutes;
- attempts every manifest object once in canonical order, with a maximum of ten
  fixture calls;
- records matched, missing, metadata-mismatched, malformed, and client-error
  observations without exposing provider error text;
- binds every observation, the complete object set, the availability receipt,
  and the execution to SHA-256 digests;
- normalizes the future provider shape to key, size, ETag, upload time, Standard
  storage, and exact fixed custom metadata; and
- reports zero provider operations, zero cost, and no persistence, retry,
  release, deletion, outreach, or provider authority.

The receipt is always `checkerKind=FIXTURE` and `providerReadPerformed=false`.
It therefore cannot be selected as an `R2_HEAD` winner, even when every fixture
object matches.

Only `SHADOW_30D` may carry an automatic expiry and generate a future lifecycle
rule. `QUALIFICATION_180D` requires review after 180 days but has no automatic
deletion; outreach-active and legal-hold objects likewise have no lifecycle
expiry. Releasing or deleting any promoted object remains a separate,
fresh-reference, owner-approved design.

A future live adapter must use `R2Bucket.head()` and establish provider
provenance inside the trusted runtime. It must map Cloudflare's `Standard`
storage class into the normalized `STANDARD` value, reject Infrequent Access for
the pilot, validate every metadata field, count each HEAD as a Class B operation,
and bind actual operations and cost into the receipt. It may not accept a
caller-asserted `R2_HEAD` result.

## Consequences

- Retry, metadata, ordering, freshness, and budget semantics can be tested
  without an account activation or live request.
- The lower-level lifecycle policy now agrees with projection and availability
  contracts; qualification evidence cannot be silently deleted at day 180.
- A fixture result is useful test evidence but never transactional completeness.
- R2 account activation, a private Standard bucket, a staging-only binding, the
  live adapter, synthetic smoke test, cost receipt, and rollback rehearsal remain
  separate release gates in `docs/runbooks/STAGING_R2_ACTIVATION.md`.
- No Cloudflare resource, D1 row, migration, provider operation, or charge was
  created by this decision.

