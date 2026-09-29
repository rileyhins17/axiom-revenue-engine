# ADR 0006 — Require measured browser evidence before visual claims

- Status: accepted
- Date: 2026-08-22

## Decision

Represent each browser attempt as a versioned evidence record rather than a bag
of booleans. Version 1 uses two fixed comparison profiles: 1440×900 desktop and
390×844 touch/mobile at device scale 1. A successful record binds the business,
page kind, requested/final URL, provider receipt, capture time, viewport,
screenshot reference and SHA-256 digest, measurement artifact, browser time,
warnings, and explicit coverage for layout, actions, forms, navigation, and text.

Server-HTML facts and browser measurements merge only when business, page kind,
final URL, and viewport identity agree. Browser-computed visibility and geometry
may prove above-the-fold placement. Server HTML alone cannot. Failed, missing, or
partial measurement remains `UNKNOWN`, even when a screenshot exists.

The deterministic website audit advances to `website-audit-deterministic-v2`.
Page-set completeness, HTML completeness, and visual coverage now control whether
an absent service page, trust signal, action, form, metadata field, or mobile
measurement is a supported failure or a manual-review gap.

## Why

A screenshot is useful proof for a person but not a deterministic machine fact.
Without a fixed viewport and recorded DOM geometry, the engine can mistake a
responsive layout, late render, provider timeout, partial crawl, or hidden
navigation state for evidence that a site is bad. That would directly damage
lead quality and could put an unsupported claim into outreach.

Cloudflare's current snapshot API supports explicit viewports plus screenshot,
content, and accessibility-tree outputs, while its Worker-compatible Playwright
package supports controlled browser automation. These capabilities can satisfy
the contract in a later adapter without putting provider details into the domain
model: [Snapshot API](https://developers.cloudflare.com/api/resources/browser_rendering/subresources/snapshot/methods/create/)
and [Browser Run Playwright](https://developers.cloudflare.com/browser-run/playwright/).

## Consequences

- Visual absence never defaults to `false`; unknown coverage lowers evidence
  confidence and creates an owner-review reason instead of a negative claim.
- A captured desktop render is required before action/form coverage can be called
  complete. Mobile usability requires its own artifact and measurements.
- Unreachable/no-site audits cannot retain stale successful artifacts or mobile
  facts, and browser merge rejects cross-business, cross-page, cross-URL, and
  duplicate-profile contamination.
- Raw screenshots cannot be embedded in domain records. Only bounded artifact
  references and content hashes are accepted.
- The current milestone uses synthetic fixtures only. The engine configuration
  still forbids Browser and R2 bindings, so it makes no provider call and spends
  nothing.
- The next adapter must use an injected runner, public-URL policy, strict time and
  page limits, no form submission, no authentication, and fake-network tests
  before any staging binding is considered.
