# ADR 0004 — Parse untrusted HTML as bounded facts, not browser truth

- Status: accepted
- Date: 2026-08-22

## Decision

Use the exact `parse5-sax-parser` package for server-HTML fact extraction. The
extractor is streaming/SAX-style, never executes page scripts, and stops after a
bounded number of tokens. Visible text, JSON-LD, actions, forms, links, and output
arrays each have explicit limits and a versioned schema.

Server HTML can establish that an element is present and not explicitly hidden.
It cannot establish visual placement, computed CSS visibility, mobile usability,
or whether a JavaScript application later changes the page. Those facts remain
unknown until the separately gated Browser Rendering layer proves them.

The parser project describes parse5 as WHATWG HTML-compliant and browser-like:
[parse5 repository](https://github.com/inikulin/parse5).

## Why

Regular expressions do not reliably parse malformed or adversarial HTML. A full
DOM is unnecessary for this extraction pass and can amplify memory use on pages
with extremely large node counts. Streaming tokens allow the engine to stop work
at a clear ceiling while still handling HTML syntax through a maintained parser.

## Consequences

- Truncated token/text/JSON-LD results are marked incomplete and cannot represent
  full audit coverage.
- Scripts and event handlers are data only and are never evaluated.
- Unsafe, private, credentialed, or non-HTTP navigation targets cannot become
  discovered links or form destinations.
- An HTML action records above-the-fold state as `UNKNOWN`; the audit cannot turn
  that unknown into a negative claim.
- The extractor is fixture-tested and remains disconnected from live capture,
  Browser Rendering, R2, D1, queues, and the inert Workflow.
