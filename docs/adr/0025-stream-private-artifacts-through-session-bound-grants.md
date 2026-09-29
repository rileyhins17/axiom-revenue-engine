# ADR 0025 — Stream private artifacts through session-bound grants

**Status:** Accepted
**Date:** 2026-08-26
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

The owner lead dossier records desktop, mobile, and DOM artifact references, but
it intentionally cannot preview them while R2 is disabled. A future screenshot
preview must not solve that gap by making the bucket public, returning an R2
object key, redirecting to `r2.dev`, or treating a bearer URL as sufficient
authorization.

An artifact reference also is not enough. The application must prove that the
current authenticated session is viewing the exact business, website snapshot,
logical screenshot kind, and current artifact reference. A preview must expire
when its short grant, website audit, or underlying shadow artifact expires.

DOM capture is higher risk than an image because rendering stored page markup in
the operator origin can execute untrusted content. It is useful as audit input,
but it does not need to be rendered to explain a lead.

## Decision

Define a versioned private artifact-delivery contract with these rules:

- only desktop and mobile WebP screenshots are eligible;
- a grant is HMAC-authenticated, canonical, bound to the exact user session and
  dossier identity, and valid for no more than five minutes;
- the grant expires earlier when the website snapshot or stored artifact does;
- validation requires fresh authenticated-session context and the exact current
  dossier values again; possession of the token alone is insufficient;
- the browser receives only a same-origin application path and content-addressed
  artifact reference, never an R2 URL, bucket name, object key, user ID, or raw
  session ID;
- the application streams verified bytes instead of redirecting to storage;
- the response is `image/webp`, `private, no-store`, same-origin, `nosniff`, and
  uses a generic filename without business identity; and
- stored bytes must match their length, SHA-256 artifact identity, and WebP
  signature before they can become a response.

Version 1 includes a deterministic signer/verifier and an injected fixture
reader. It deliberately has no Next.js route, R2 binding, D1 lookup, public
endpoint, or Worker import. A later live adapter must use the authenticated
same-origin route, resolve the exact manifest privately, and pass a separate R2
activation/deployment gate.

## Safety boundary

- Signing material is injected and must contain at least 32 bytes; it is never
  read from source, logged, returned in a grant, or persisted by this module.
- The session binding is an HMAC of user/session identity, so raw auth identifiers
  are absent from the browser-visible token.
- Tampering, wrong session, wrong business, wrong snapshot, wrong artifact,
  future issuance, expiry, stale evidence, weak keys, invalid bytes, and DOM
  requests fail closed.
- Fixture execution reports zero provider operations and cost. Runtime,
  mutation, outreach, and send authority remain false.
- R2 remains private and disabled; this decision does not approve a bucket,
  binding, route, migration, deployment, or provider read.

## Alternatives considered

### Make an R2 development or custom domain public

Rejected. Public object delivery bypasses owner authentication and exposes
evidence independently from the dossier's current authorization state.

### Return an R2 object key or presigned storage URL

Rejected. It leaks storage topology and makes the browser-facing capability
harder to bind to the current internal session and exact lead record.

### Render stored DOM evidence in the application

Rejected. It creates an unnecessary cross-site scripting boundary. DOM facts
remain machine-consumed audit inputs; owners can inspect screenshots and the
plain-language claims derived from them.

### Use a long-lived share link

Rejected. Evidence changes and shadow artifacts expire. A five-minute maximum
grant is enough for an authenticated dossier view without becoming a durable
bearer credential.

## Consequences

- The future owner dossier has one precise safe contract for desktop/mobile
  proof instead of needing to invent authorization during R2 activation.
- Preview URLs cannot work outside their original authenticated session and
  exact current dossier context.
- The application must proxy screenshot bytes, which adds one bounded Worker/R2
  read per uncached preview; this is accepted because owner review volume is low.
- A later route must obtain the current dossier and manifest privately before
  reading storage. This checkpoint does not implement that integration.
- DOM download or inspection needs a separate, non-rendering design if it ever
  becomes necessary.

## Verification

Unit tests cover canonical issuance, five-minute and evidence expiry, tampering,
key mismatch, session/dossier mismatch, exact-boundary expiry, weak signing keys,
WebP integrity, hardened response headers, no-read-before-authorization, and DOM
or storage-key rejection. The repository safety gate verifies fixture-only,
zero-provider authority and absence of engine wiring.
