# Provisional M2 website source-rights review

**Checked:** 2026-09-22, America/Toronto. **Scope:** the ten research-only
businesses in the ignored local M2 owner packet
`data/kw-evaluation/m2-public-research-2026-09-22-review.md`, which still
awaits owner identity/disposition review. This was a bounded
read-only check of each official domain's `robots.txt` and discoverable legal
pages. No page body, screenshot, personal contact data, or HTML capture was
saved by this review.

| Candidate | Public access evidence | Raw HTML retention decision |
|---|---|---|
| M2-01 Roofsaver | [`robots.txt`](https://www.roofsaverinc.ca/robots.txt) returned 404; the linked [privacy notice](https://www.roofsaverinc.ca/privacy.htm) did not supply a clear copying licence. | `UNCLEAR` — block raw capture. |
| M2-02 Air Comfort | [`robots.txt`](https://aircomfortmechanical.ca/robots.txt) allowed `/` and disallowed `/api/`; no applicable terms/copying licence was found in the bounded review. | `UNCLEAR` — block raw capture. |
| M2-03 TNT Property Maintenance | [`robots.txt`](https://www.tntpropertymaintenance.com/robots.txt) broadly allowed public paths with Wix internal/query exclusions and named-bot rules; no copying licence was found. | `UNCLEAR` — block raw capture. |
| M2-04 Garcia Roofing | [`robots.txt`](https://www.garciaroofing.ca/robots.txt) disallowed WordPress admin paths; the [privacy page](https://www.garciaroofing.ca/privacy-policy/) did not establish retained-copy rights. | `UNCLEAR` — block raw capture. |
| M2-05 Delta Air Systems | [`robots.txt`](https://deltaairsystems.com/robots.txt) had no disallowed public paths. Footer terms/privacy labels did not yield a distinct usable policy in the bounded check. | `UNCLEAR` — block raw capture. |
| M2-06 Comfort Air | [`robots.txt`](https://comfortairontario.ca/robots.txt) and tested legal paths returned 403. The access denial ended the check. | `UNCLEAR` — block access and raw capture. |
| M2-07 Thomson Roofing | [`robots.txt`](https://www.thomsonroofing.ca/robots.txt) broadly allowed public paths with Wix exclusions and named-bot rules. A linked [privacy PDF](https://www.thomsonroofing.ca/_files/ugd/6494a2_fbbef2c7edaf45a584882c90dfcf9950.pdf) was identified but not downloaded or reviewed. | `UNCLEAR` — block raw capture. |
| M2-08 Aircor | [`robots.txt`](https://www.aircor.ca/robots.txt) returned an empty text body; no copying licence was found. | `UNCLEAR` — block raw capture. |
| M2-09 Denaeyer Mechanical | [`robots.txt`](https://www.denmech.ca/robots.txt) disallowed calendar/event actions and query strings and stated a three-second crawl delay; no copying licence was found. | `UNCLEAR` — block raw capture. |
| M2-10 TriCity Landscapers | [`robots.txt`](https://tricitylandscaper.ca/robots.txt) and the homepage returned 403. The access denial ended the check. | `UNCLEAR` — block access and raw capture. |

`robots.txt` describes crawler access; it is not a licence to retain or reuse
copyrighted page content. No affirmative permission for a retained full-page
HTML copy was established for this provisional cohort. The earlier public
research approval was limited to manual viewing and concise derived facts and
URLs; it expressly excluded saved page bodies and screenshots. Keep the source
policy at `DERIVED_FACTS_ONLY` while raw-HTML rights, source terms, retention,
and the exact owner-reviewed cohort remain unresolved. This review does not
authorize capture, qualification, contact, or a provider call. See [ADR 0040](../adr/0040-bounded-local-html-first-m2-route.md)
and the [research scope record](2026-09-21-m2-public-research-scope.md).

The [Copyright Act's fair-dealing research provision](https://laws-lois.justice.gc.ca/eng/acts/c-42/Section-29.html)
does not decide this proposed full-page commercial retention use by itself.
[CIPO's copyright guidance](https://ised-isde.canada.ca/site/canadian-intellectual-property-office/en/copyright-infringement)
describes copying protected content as a rights question. Obtain a documented
source-specific basis and a reviewed retention decision before changing any
candidate to `RAW_HTML_ALLOWED`; do not infer that basis from silence, a missing
terms page, or an `Allow` rule.
