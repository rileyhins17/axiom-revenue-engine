# ADR 0059: Record delegated browser-view website-need assessments

- Status: accepted for the local M2 evaluation
- Date: 2026-09-23
- Scope: website-need judgement for the ten saved M2 businesses and later M3 cases

## Context

M2 needs ten real website-need assessments. The existing HTML capture and
assessment pipeline is built, but by design it always ends in `UNKNOWN /
NON_QUALIFYING_HTML_ONLY`: HTML cannot show phone layout, legibility or
whether the call and quote path is usable. It also required an owner-only
capture approval that nobody had given. After many checkpoints, M2 stood at
0/10. Riley has delegated routine review decisions and asked for real,
source-cleared assessments without being asked to review the ten identities.

## Decision

Claude, as the delegated reviewer, may assess a saved M2 business by viewing
its ordinary public pages in a normal browser at desktop and phone widths, at
human pace: at most four pages per business, no forms, logins, downloads,
CAPTCHA or access-control bypass, and no retry of a denial. Only own-word,
company-level findings are kept (`DERIVED_FACTS_ONLY`); no page copy, HTML,
DOM, screenshots, personal names or individual contact values are stored.
This is a source decision for this route only
(`adr-0059-delegated-browser-view-derived-facts-v1`). It does not clear raw
HTML retention or automated crawling, and it does not change the existing
held HTML capture pipeline.

Each assessment is an immutable, content-addressed JSON record in ignored
`data/kw-evaluation/m2-website-need/`, bound to the pinned delegated
KEEP/REPLACE ledger. It names `CLAUDE` as assessor and `RILEY` as delegator.
Every finding cites a page and width that was viewed, a category, severity,
whether it is on the call/quote path, and a confidence. The stated need must
equal the deterministic rule:

- `REBUILD`: at least three major or critical issues, one conversion-critical
  (the plan's "three supported observations including a conversion-critical
  issue").
- `MINOR_IMPROVEMENT`: any major issue, or two or more minor issues.
- `NO_OPPORTUNITY`: otherwise.
- `INCOMPLETE`: the homepage was not viewed at both widths.

Records stay `RESEARCH`, `PENDING_OWNER_CONFIRMATION`, with qualification,
contact, consent, outreach, send, provider, deployment and spend authority
off. The `/leads/m2` owner page shows a short plain-language summary in the
local workspace only.

## Consequences

M2 can be measured honestly: 10/10 businesses now have evidence-backed
website-need assessments (two rebuild, one minor, seven no opportunity). The
low hit rate is itself the key finding: identity/independence selection did
not find weak websites, so M3 sourcing now pre-screens homepages for weak-site
signals before full assessment. A delegated judgement is not an owner's; the
owners can overrule any record, and a rebuild finding is not permission to
contact. The recorded `viewedAt` is the upper bound of the viewing window
(19:55–20:40 UTC on 2026-09-23), not a per-page instant.

## Rejected alternatives

- Running the HTML pipeline first: it cannot produce a need judgement and
  would still leave website need `UNKNOWN`.
- Asking Riley to approve each capture: Riley delegated this class of review.
- Storing screenshots as proof: outside the facts-only retention boundary.
