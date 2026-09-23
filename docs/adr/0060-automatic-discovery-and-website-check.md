# ADR 0060: Automatic discovery and website check, graded by an answer key

- Status: accepted for local runs; discovery activation needs the owner's key
- Date: 2026-09-23

## Context

Riley stated that the engine, not Claude or Codex, must find businesses. The
50 hand-checked businesses (ADR 0059) therefore became an answer key. The
existing deterministic audit v4 had never run on real sites. OpenStreetMap
coverage was measured: 16 local trade businesses in the region and 1 of the
50 known ones, so it cannot be the discovery source.

## Decision

1. **Discovery:** Google Places API (New) Text Search, one query per city and
   trade, up to three pages. It is off unless `AXIOM_PLACES_DISCOVERY_ENABLED=1`
   and a restricted `AXIOM_GOOGLE_PLACES_KEY` are set locally. Each request is
   counted in a local monthly ledger before it is sent; caps are 30 requests
   per run and 200 per month. Places is a hint: the engine keeps the place ID
   and the business's own website origin, and judges the business from its
   own site. Other Places content is transient.
2. **Website check:** a local headless browser loads each homepage once at
   1440 px desktop and once at 390 px with a phone user agent. No clicks,
   forms or downloads. Only derived signals and the audit result are stored.
   Screenshots are not kept; artifact references say `not-retained:`.
3. **Triage:** audit v4 is unchanged. A separate versioned experiment,
   `engine-lead-rules-v5-experiment`, labels STRONG / WEAK / WRONG from
   phone layout, sideways scroll, CMS age, footer staleness and the call and
   quote path, and marks generic city-and-trade domains without an address and
   location pages as WRONG.
4. **Grading:** both are graded against the answer key with a fixed hash
   split (35 tuning / 15 holdout). v4: 33/49 agree, 0/8 strong prospects.
   v5: 42/49 (86%), 7/8 strong, 7/8 non-targets; holdout 14/15. The v5
   author saw all captured signals before writing it, so the holdout is not
   pristine; a fresh sample is needed before any claim of generalisation.

## Cost

With the website field, each request is a Text Search Enterprise event:
1,000 free per month (checked 2026-09-23), then US$28 per 1,000. A weekly
sweep is about 27 requests. Worst case at the 200 monthly cap with no free
tier is about US$5.60 (about C$8), within the C$50 ceiling. Expected C$0.

## Consequences

The engine can find, check and shortlist on its own once the key exists. A
shortlist is not permission to contact anyone; contact still needs the
channel, consent and approval gates.
