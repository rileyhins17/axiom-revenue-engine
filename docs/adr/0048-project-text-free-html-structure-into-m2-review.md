# ADR 0048: Show bounded HTML structure in the local M2 review

- Status: accepted for the local M2 implementation
- Date: 2026-09-22
- Scope: derived-only M2 website evidence and the read-only owner console

## Decision

For an authorized `DERIVED_FACTS_ONLY` capture, project transient HTML parser
output into a small `kw-html-structure-v1` summary. It records only title and
description presence, closed action-kind and trust-marker enums, form counts,
and counts of closed internal-link kinds. The page URL, capture time, extractor
version, retention mode and source authorization remain in the surrounding
evidence chain. Free-text page copy, titles, descriptions, labels, action and
form destinations, personal contact values, full HTML, rendered DOM and
screenshots are excluded from the summary.

The summary is stored inside the existing derived-facts record and copied into
its sealed page receipt. Exact replay compares the receipt summary to the
content-addressed facts record; an omitted or changed summary fails. An
optional field preserves read compatibility with older receipts that did not
carry structural facts. A summary may appear only on a captured
`DERIVED_FACTS_ONLY` page. The same sealed page receipts feed complete owner
details and research-only reports, so the local console can render the facts
without a second independent source or a new write path.

The console calls these **HTML markers**, not verified visual placement,
working forms, conversion quality, rebuild need or buying intent. Browser and
mobile evidence remain unknown, qualification stays `UNKNOWN` with zero scores,
and contact, consent, outreach, send, provider and deployment authority remain
off. A later visual or owner assessment must make the actual website-fit
judgment under its own gate.

## Why

The earlier derived-only route stored page-kind and completeness IDs but
discarded almost every extracted website fact. It could prove that pages were
fetched, yet gave Riley and Aidan little to inspect when deciding which site
deserved further research. Full HTML retention lacked an affirmative basis in
the provisional ten-site source review. A closed, text-free summary provides
useful triage at the existing default retention mode with a small privacy and
storage footprint.

## Rejected alternatives

- Retaining page text, screenshots or raw HTML by default would silently widen
  the source and retention decision.
- Turning missing markers into a rebuild score would overstate an HTML-only
  parser's coverage and confuse a research signal with a qualification result.
- Reading the facts store directly from the browser would bypass the sealed
  receipt and local inspection boundary.

## Verification and limits

Synthetic tests cover the text-free projection, closed bounds, durable
derived-only storage with no `.html` object, exact replay and tamper rejection,
complete owner projection, and the authenticated desktop/mobile review.
These checks do not count as real M2 assessments. The exact-ten identity review,
source-specific rights and first supervised real capture remain separate gates.
