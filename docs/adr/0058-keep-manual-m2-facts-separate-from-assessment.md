# ADR 0058: Keep manual M2 facts separate from assessment

- Status: accepted for the local M2 evidence workflow
- Date: 2026-09-23
- Scope: optional manual website observations in the local Business Review

## Decision

A named owner may save an optional, concise company-level website observation
in original words from an exact public page, or record that evidence was
insufficient. The record is bound to a current saved `KEEP` or `REPLACE`
identity decision, exact approved website origin, server-recorded time,
manual method, confidence, audit version and content digest. It lives in
ignored local evaluation storage, is append-only and can be reloaded. The
authenticated local API is unavailable with Cloudflare bindings; the owner
screen shows the control only for a verified local M2 console and keeps it
collapsed until requested.

Codex may use a separate local command under Riley's delegated research and
routine-decision authority. It requires a current, source-specific decision
bound to the exact saved identity, command, approved origin and page. The
decision permits only own-word derived company facts, with no raw HTML, copied
text, personal/contact data, provider calls or spend. The immutable note names
`CODEX`, seals the decision digest and records a retention review date; that
date is a review reminder, not automatic deletion. The decision and command
live in ignored local files, and this route does not enable cloud capture.

The record always keeps website need `UNKNOWN`, qualification `RESEARCH`,
all scores zero and all contact, consent, outreach, send, provider, deployment
and cost authority disabled. It never advances the real M2 assessment ledger.
The note field rejects common contact values and URLs, but its declaration
that wording is original and contains no personal data still requires the
operator's judgment. The operator must not paste page copy, HTML, DOM,
screenshots, testimonials or individual details.

## Why

The current sources have no general raw-HTML retention clearance, and two of
the selected sites returned access denials. Small human observations can
preserve a useful factual clue without adding a third-party service or
claiming that an HTML parser has judged visual quality. The local-first
evaluation can retain an honest `UNKNOWN` result while source-specific terms
and real assessment gates are resolved. Riley is not required to perform the
optional entry. Codex attribution keeps delegated research distinct from a
note actually entered by Riley or Aidan.

## Rejected alternatives

- Treating an identity check or one manually entered fact as a qualified lead
  would fabricate website need and contaminate the 10-real / 50-judged gates.
- Saving page bodies, copied prose, screenshots or personal contact details
  would exceed the facts-only retention boundary.
- Showing the form by default or loading its local-only endpoint in the hosted
  app would add owner UI clutter and an avoidable cloud error.
- Adding an automated browser fetch or model score here would require separate
  source, provider, evidence and budget decisions and does not solve the
  observed source-rights block.

## Verification and limits

The initial local slice at `a969f10` passed ten focused synthetic tests, the
full 865-test suite, typecheck, lint, safety, clean Cloudflare build and
no-upload default/staging dry runs, plus owner UI acceptance. The later Codex
command has focused synthetic coverage for exact source-decision binding,
attribution, sealed provenance and retry; consult [STATUS](../STATUS.md) for
its exact-commit verification. No real observation or assessment is counted
by these tests. See the [source disposition](../reviews/2026-09-23-m2-manual-facts-only-source-disposition.md)
for the current site-specific holds.
