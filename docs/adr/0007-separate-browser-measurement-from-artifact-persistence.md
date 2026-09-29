# ADR 0007 — Separate Browser measurement from artifact persistence

- Status: accepted
- Date: 2026-08-22

## Decision

Build Browser acquisition as two independently gated boundaries:

1. A measurement runner returns bounded screenshot bytes, deterministic page
   measurements, provider timing, and a fail-closed network receipt.
2. A future artifact store writes those bytes under content-addressed keys and
   returns references that exactly match the draft SHA-256 digests.

The version 1 measurement adapter accepts only an injected `FIXTURE` runner. A
request is shadow-only, has a zero-dollar budget, uses one of the two fixed
comparison viewports, and cannot authorize artifact writes. It caps redirects,
navigation time, browser time, observed requests, screenshot size, and canonical
measurement JSON size.

Every requested, redirected, final, and document URL must already be a canonical
public HTTP(S) domain. The runner receipt must prove request interception and URL
validation, zero private-network requests, zero credential use, zero form
submissions, and zero accepted downloads. Service workers are blocked and cache
reuse is disabled by request policy.

Before a captured draft becomes `BrowserPageEvidence`, finalization recomputes
the screenshot byte length/digest and the canonical measurement bytes,
length/digest. It accepts only exact `artifact:sha256:<digest>` references.
Failure drafts cannot receive success references.

## Why

Browser automation and durable storage fail differently and create different
risks. Combining them would make it harder to prove whether a failed capture
wrote a partial artifact, whether a retry duplicated a write, or whether an
evidence record points at the bytes that were actually measured. A draft plus a
content-addressed persistence boundary makes the later operation idempotent and
detects mutation or reference mix-ups before evidence enters qualification.

Cloudflare supports explicit screenshot/viewport capture through Browser
Rendering and controlled Worker-compatible browser automation. Those provider
capabilities are suitable for a later staging runner, but they do not justify
adding a live binding before request safety, artifact retention, budget, and
rollback are independently approved: [Snapshot API](https://developers.cloudflare.com/api/resources/browser_rendering/subresources/snapshot/methods/create/)
and [Browser Run Playwright](https://developers.cloudflare.com/browser-run/playwright/).

## Consequences

- The current adapter can be tested deeply without navigating to any real site,
  creating an R2 bucket, or spending provider budget.
- Safety checks prevent the fixture-only module from importing Cloudflare
  Playwright, accessing an engine Browser binding, or writing an R2 object.
- In-memory draft bytes are transient and are not valid evidence by themselves.
- A future R2 adapter must define content-addressed keys, conditional/idempotent
  writes, metadata, retention, deletion, rollback, and reconciliation before a
  staging bucket is provisioned.
- A future Cloudflare runner is a new version and release gate. It must preserve
  these contracts, use only isolated staging resources, and pass a non-prospect
  smoke test before any real business audit is considered.
