# Revenue Engine source and contact strategy

**Checked:** 2026-09-20 (America/Toronto)
**Scope:** primary official sources only; no inboxes, prospects, API calls, secrets, account changes, submissions, or sends. This is an implementation research note, not legal advice.

## Recommendation

Build the first discovery layer around Axiom’s own deterministic web research and a small owner-curated seed file. Use a municipal dataset only when its licence, update date, geography, and fields are explicit. Treat Google Places as an optional, metered identity/enrichment adapter, not as the durable lead database: Google permits indefinite storage of `place_id`, but restricts caching/export of most returned place content. Avoid making public OpenStreetMap Nominatim a scheduled discovery service; its policy prohibits systematic queries and discourages recurring bulk geocoding.

For Kitchener, Waterloo, and Cambridge roofing, HVAC, and landscaping, the useful unit is an evidence-backed business dossier: canonical name/domain/address, source URLs and capture times, service-area clues, deterministic website findings, route candidates, and legal basis for any contact. A directory row is only a discovery hint. Reachability is separate from fit, rebuild need, timing, and evidence confidence.

## Source ladder for KW trades

**1. Direct public business sites (default).** Search by niche and city, inspect the business’s own website, and record the exact page where the business identifies itself, services, locations, phone, or email. Audit the site with deterministic checks first: availability, HTTPS, mobile layout, service-area clarity, above-fold CTA, tap-to-call, forms/dead ends, service pages, trust/local proof, and whether the site is already effective. Store URL, timestamp, method, screenshot/DOM proof, and audit version. A public website is strong evidence of identity and website condition; it is not consent to email a person, proof of qualification, or proof of current operation. Do not infer phone/email validity from existence alone.

**2. Owner-curated seed CSV (best first pilot).** Riley or Aidan can supply 10–50 businesses from existing knowledge, referrals, trade associations, or manually inspected search results. The seed should contain only business identity and source links, not scraped personal data. This produces a clean labelled set for canonicalization and website-audit evaluation and avoids paying for broad discovery before the quality loop works.

**3. Municipal/open government sources (coverage and corroboration).** Cambridge’s official Open Data page says its data is machine-readable and covered by the City’s Open Data Licence Version 2.1, which permits commercial use subject to licence terms and attribution: https://www.cambridge.ca/mayor-city-council-government/open-data/. The City’s Cambridge Data Hub is described as a decision-support tool for retail properties, demographics, and consumer expenditures, not a guaranteed current business-contact directory: https://www.cambridge.ca/business-building-development/economic-development/small-business/. Waterloo exposes an official open-data Search API using OGC API – Records: https://data.waterloo.ca/api/search/definition/. Waterloo’s map service visibly includes business-licence layers, but the accessible service page does not establish a general licence or that all records are suitable for commercial reuse: https://maps.waterloo.ca/Geocortex/Essentials/Internal/REST/sites/City_Map_Internal/map/mapservices. Verify each collection’s licence, fields, update cadence, and permitted use before importing.

The Region of Waterloo’s 2024 Workplace Count terms are a useful warning: business name, description, contact information, address, phone, email, website, and year established are private except where a business opted into a directory; aggregate business type, employees, floor space, hybrid-work answers, NAICS, and similar fields may be available in aggregate: https://www.regionofwaterloo.ca/en/doing-business/resources/Workplace-Count/WPC_2024__Terms_of_Use.pdf. Do not assume a municipal “business” dataset contains lawful or current contact details.

**4. Google Places API (optional identity enrichment).** Google’s Places API is pay-as-you-go by request/SKU. For Place Details, Text Search, and Nearby Search (New), specify a `FieldMask`; Google bills at the highest SKU represented by the requested fields, so request only fields needed for a specific job: https://developers.google.com/maps/documentation/places/web-service/usage-and-billing and https://developers.google.com/maps/documentation/places/web-service/data-fields. The exact live dollar price should be read from Google’s current pricing table/calculator at implementation time; this report does not freeze a number.

Google’s Places policy says applications must have publicly accessible Terms of Use and Privacy Policy incorporating Google’s terms, must not pre-fetch/cache/store Places content beyond explicit exceptions, and must provide Google and provider attribution when displaying results. `place_id` is exempt from caching restrictions and can be stored indefinitely; the specific Places caching exception is latitude/longitude for up to 30 consecutive days. This is not a blanket 30-day permission for names, addresses, phones, websites, ratings, reviews, or other place content. Places content displayed on a map must be shown on a Google Map; without a corresponding map, follow the required Google logo/attribution rules: https://developers.google.com/maps/documentation/places/web-service/policies. The service terms also state Places content must not be used with a non-Google map and repeat the 30-day lat/lng rule: https://cloud.google.com/maps-platform/terms/maps-service-terms.

For Axiom, persist `place_id` plus identity, source URLs, and evidence independently sourced under Axiom’s own rights. Do not launder restricted Places content into “canonical” or “derived” fields, and do not build an indefinitely retained listings database from Places responses. If a live Places check is later approved, make the adapter field-mask-minimal, rate-limited, attributed where shown, and explicit that only the documented lat/lng cache exception lasts 30 days.

**5. OpenStreetMap (limited map/context aid).** OSM data is under ODbL and requires attribution; published derivative databases have share-alike obligations: https://www.openstreetmap.org/copyright. The public Nominatim service has a maximum of one request per second, requires an identifying User-Agent/Referer and attribution, discourages recurring bulk geocoding, and prohibits systematic queries, grid scans, complete POI downloads, and automated details-page scraping: https://operations.osmfoundation.org/policies/nominatim/. It is therefore unsuitable as an unattended “find every roofer in KW” source. If OSM is used, use a deliberate small lookup or a separately hosted/licensed extract after reviewing ODbL consequences. Coverage is community-maintained and must not be assumed complete or current.

## CASL and channel routing

An email, SMS, instant-message account, telephone account, and some social accounts can be an “electronic address” under CASL. A commercial electronic message (CEM) generally requires prior express or implied consent, sender identification, and an unsubscribe mechanism. CRTC guidance: https://crtc.gc.ca/eng/com500/guide.htm; ISED summary: https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/getting-consent-send-email.

**Public email is conditional, not a licence.** Conspicuous publication can support implied consent only when the address was published by or for the recipient, no accompanying statement rejects unsolicited CEMs, and the message is relevant to that person’s business role, functions, or duties. The sender has the burden of proof. Preserve the exact URL/screenshot, capture time, address, publication context, no-solicitation check, recipient role, and why the specific message is relevant. A reproduced or purchased list does not itself create consent. A role inbox can be a channel, but it does not prove the person or business is qualified.

Express consent is not time-limited until withdrawn. Common implied-consent periods are two years after a transaction, or where a written contract is still in existence or expired within the preceding two years, and six months after an inquiry/application. Unsubscribe requests must be actioned within 10 business days. Each CEM must identify Axiom and the sender, provide a current mailing address plus phone/email/website contact, keep contact information valid for at least 60 days, and include a readily usable no-cost unsubscribe mechanism. Consent and suppression records are mandatory operational evidence. Email verification can reduce bounces and identify malformed/catch-all risk; it does not create CASL consent and must never upgrade an unconsented address to sendable.

**Phone.** Calls are governed by the CRTC Unsolicited Telecommunications Rules, separate from CASL. Business-to-business numbers are exempt from Part II National DNCL rules, but calls still face Telemarketing and ADAD rules; telemarketers must register, identify themselves and the purpose of the call, respect calling hours, and maintain an internal do-not-call list. Consumer numbers require DNCL subscription unless an exemption or valid express consent applies. Internal do-not-call requests must be recorded within 14 days; the current list used for non-exempt calls must be no more than 31 days old: https://crtc.gc.ca/eng/phone/telemarketing/tobligations/register-inscrire.htm and https://crtc.gc.ca/eng/phone/telemarketing/tobligations/rules-regles.htm. Axiom should keep calls manual, with a visible call task, script, identity, time window, and suppression check. No autodialer or prerecorded solicitation is in scope.

**Forms and social.** A contact form is a manual route, not permission to submit. Use it only when an owner approves the specific form, observes its purpose/terms, and records the result; never test-submit a prospect form. A one-way general social broadcast is generally outside CASL, while direct messages through a closed two-way system can be CEMs and must be assessed case by case: https://crtc.gc.ca/eng/com500/faq500.htm. Keep social DMs manual and subject to platform rules, identity, relevance, suppression, and no bulk automation.

## Mail route and legacy Gmail fallback

The selected first-pilot route has zero paid mailbox seats: public DNS observed
on 2026-09-21 supports Cloudflare Email Routing at the root, so inbound
`riley@getaxiom.ca` and `aidan@getaxiom.ca` can forward to verified existing
owner destinations. A separate typed Resend outbound/reply adapter is
conditional on an owner-approved account, API key, verified sending domain,
legal identity, webhook, suppression and reply gates. The Resend verification
TXT token does not prove account/key/domain readiness; two `resend._domainkey`
TXT values require dashboard reconciliation. Cloudflare forwarding cannot send
custom-domain replies itself, so M4 must prove a human-triggered Resend reply
flow or a separately reviewed free owner-only send-as route. Keep the root MX
on Cloudflare; Resend custom receiving belongs on a separately reviewed
subdomain, if ever needed. ([Cloudflare routing](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/),
[Cloudflare Postmaster](https://developers.cloudflare.com/email-service/reference/postmaster/),
[Resend pricing](https://resend.com/pricing?product=transactional),
[Resend domain verification](https://resend.com/docs/add-a-domain))

The following Gmail material is a **conditional legacy fallback**, not the v2
mailbox architecture. Keep OAuth/send/inbox-sync code quarantined from new v2
records until a separately approved reconciliation and provider decision.

### Gmail reply operations

Use OAuth with the narrowest scopes. `gmail.readonly` is a restricted scope; `https://mail.google.com/` is broader restricted access and should be avoided. `gmail.send` is sensitive, while add-on-specific compose/message scopes are narrower where an add-on architecture genuinely fits: https://developers.google.com/workspace/gmail/api/auth/scopes. A public/external app using restricted scopes needs OAuth verification; if restricted data is stored or transmitted through a server, Google requires an independent security assessment unless an exception applies. An internal-use exception applies only when the app is used by people in the same Google Workspace or Cloud Identity organization, the Cloud project is owned by that organization, and the OAuth consent screen is configured for Internal use: https://support.google.com/cloud/answer/13464323. This is a launch dependency, not a reason to request broad access early. If testing uses an External consent screen in Testing status with Gmail scopes, refresh tokens expire after seven days; use a separate staging project and plan reauthorization, or move the approved production client to In Production: https://developers.google.com/identity/protocols/oauth2.

If a two-owner Gmail reply console is separately approved as a legacy fallback, begin with manual reply handling and then use server-side OAuth offline access, protecting refresh tokens as secrets: https://developers.google.com/workspace/gmail/api/auth/web-server. Prefer polling incremental sync first (target freshness <=15 minutes) to avoid Pub/Sub/watch complexity. First sync is full (`messages.list`, then batched `messages.get`); store only the minimum message/thread metadata and necessary body excerpts. Store the latest `historyId`, then use `history.list(startHistoryId=...)` for incremental changes. Gmail history is typically available at least a week but can be shorter; HTTP 404 means discard the cursor and full-sync: https://developers.google.com/workspace/gmail/api/guides/sync.

If polling later proves insufficient, push notifications require Pub/Sub and `users.watch`; the response includes an expiration, and the watch must be renewed at least every seven days (Google recommends daily): https://developers.google.com/workspace/gmail/api/guides/push. Treat Pub/Sub notifications as triggers, not complete events: fetch history, deduplicate by message/history IDs, and make processing resumable and idempotent. On token revocation or invalid grant, stop sync, alert the owner, and require explicit reauthorization.

Current Gmail API quotas for newer projects are 1,200,000 quota units/minute/project and 6,000/minute/user/project; `history.list` costs 2 units, `messages.list` 5, `messages.get` 20, `watch` 100, and `messages.send` 100. There is also a 500-recipient-per-message limit. Google states standard use is currently free, but quota overages are planned to become billable later in 2026 with notice: https://developers.google.com/workspace/gmail/api/reference/quota. These quotas do not authorize sending; Axiom’s explicit approval gates still apply.

## First pilot and quality gates

Start with **10 businesses**, ideally owner-curated across the three niches and three cities. Capture the full dossier, run the deterministic audit, canonicalize, and have Riley label fit, rebuild need, route, and evidence quality. Do not send. The exit gate is 100% identity/source completeness, zero duplicate or chain blocks, every claim reproducible, and an honest error log of false positives, missing sites, stale contact paths, and ambiguous consent.

Expand to **50 businesses** only after the 10-row review shows the workflow is usable in the owner success test. Use the 50 as the owner-labelled evaluation set described in the master plan. Report coverage by source/city/niche, audit agreement, evidence completeness, usable-route rate, and suppression/legal-block rate. Do not call a tiny sample a conversion result. If approved later, run a small **5–10 total first-touch/week experiment**, manual only, with no follow-ups or automated calls/forms/DMs. The master plan’s 50 first touches/week is a ceiling, not an initial target; stop immediately when an owner sees a consent, identity, source, or suppression defect.

## Verified versus unknown

**Verified:** the official CASL consent/evidence and expiry rules above; CRTC phone/DNCL distinctions; Google Places field-mask, SKU billing, attribution, `place_id`, and the 30-day lat/lng-only exception; Cambridge’s licence statement; Waterloo’s API surface; OSM attribution and Nominatim restrictions; Cloudflare root-routing constraints and reply limitation; Resend’s published free-plan facts, domain/key requirements, send API, event types and webhook behavior; and Gmail scope categories, internal-use exception, verification/security-assessment requirements, testing refresh-token behavior, history-based sync, watch renewal, and current quota table.

**Unknown or requiring a live access check:** which Waterloo collections are commercially reusable and current; whether a particular municipal layer covers roofing/HVAC/landscaping operators; actual Google Places SKU price at the chosen fields and any credits; whether Axiom’s eventual OAuth app is truly same-organization Internal use; Cloudflare destination/rule state; Resend account/key/domain/webhook state and the ambiguous DKIM records; owner destination/reply setup; mailbox history volume, token state, and polling freshness. Pub/Sub/watch configuration is deferred unless a separately approved Gmail fallback is needed. No source here proves business qualification, email consent, deliverability, or current website quality for any prospect.

## Primary sources

- https://crtc.gc.ca/eng/com500/guide.htm
- https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/getting-consent-send-email
- https://crtc.gc.ca/eng/com500/faq500.htm
- https://crtc.gc.ca/eng/phone/telemarketing/tobligations/register-inscrire.htm
- https://crtc.gc.ca/eng/phone/telemarketing/tobligations/rules-regles.htm
- https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
- https://developers.google.com/maps/documentation/places/web-service/policies
- https://cloud.google.com/maps-platform/terms/maps-service-terms
- https://www.cambridge.ca/mayor-city-council-government/open-data/
- https://data.waterloo.ca/api/search/definition/
- https://www.regionofwaterloo.ca/en/doing-business/resources/Workplace-Count/WPC_2024__Terms_of_Use.pdf
- https://www.openstreetmap.org/copyright
- https://operations.osmfoundation.org/policies/nominatim/
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://support.google.com/cloud/answer/13464323
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/workspace/gmail/api/guides/sync
- https://developers.google.com/workspace/gmail/api/guides/push
- https://developers.google.com/workspace/gmail/api/reference/quota
