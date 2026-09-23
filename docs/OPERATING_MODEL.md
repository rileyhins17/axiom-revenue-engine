# Axiom Revenue Engine — operating model

**Status:** proposed companion policy for Master Plan v2, 2026-09-20, America/Toronto. It binds owner workflow and safety sequence; it does not change runtime policy, activate providers, authorize mailboxes, or approve sends. Existing code and owner gates remain authoritative until reviewed implementation changes them.

## Operating promise

The Revenue Engine helps Riley and Aidan choose the next worthwhile action. It is measured by useful opportunities and owner capacity, not rows, drafts, or provider acceptance. Every lead shows identity, observations, uncertainty, freshness, route, and next owner action.

Riley owns design, technical quality, implementation, and launch decisions. Aidan owns sales coordination, follow-through, and support. Every active business, contact, reply, and opportunity has one accountable owner, one next action, and one due date. Either owner can stop new external work immediately. A stop never deletes history and never stops necessary suppression or reply handling.

## The two-owner weekly rhythm

The routine review target is 30 minutes per week. That time is reserved for a short Today view:

1. **Five minutes: safety.** Check stops, incidents, unsubscribe/complaint/bounce items, overdue replies, readiness, budget, and stale evidence/consent. A red item blocks new contact work.
2. **Ten minutes: shortlist.** Review the highest-value next accounts. Riley checks technical evidence; Aidan checks fit, timing, route, and ownership. Strong accounts can remain research tasks.
3. **Ten minutes: actions.** Approve bounded research, manual tasks, reply ownership, and CRM steps. Approval covers an understandable operation or exact visible message set, not each internal transaction.
4. **Five minutes: learning.** Record corrections, false positives, source gaps, wasted time, and one experiment decision. Never raise volume to satisfy a metric.

Calibration, calls, proposals, delivery, reply handling, and incidents are additional work. If capacity is exceeded, shrink the shortlist. The proposed first-touch experiment is **5–10 total owner-managed touches per week across both owners**, with channel-specific approval and no follow-ups. Email is not an approved cold-first-touch channel while current provider terms conflict with that use. The separate ten-task prepared queue cap limits inventory; it is not an additional allowance for external actions. The master plan’s 50-per-week figure is a later ceiling, not a target or authorization.

## Evidence and freshness contract

An account is contact-ready only when its identity, business fit, rebuild observations, route, and consent basis are separately visible. A directory row, email verifier result, model score, or public address cannot substitute for the missing dimensions. Every factual claim retains source URL or artifact, capture time, method, evidence version, confidence/uncertainty, and the business/contact identity to which it belongs.

Proposed freshness defaults, subject to provider-specific restrictions and later implementation tests:

| Evidence or state | Proposed validity | Effect when stale |
|---|---:|---|
| Business identity, domain, address, service area | 90 days | Reconfirm before contact or merge |
| Website audit and screenshots/DOM | 60 days, or sooner on change signal | Re-audit before using a weakness |
| Public email publication and recipient role | 30 days | Recheck page, no-solicitation context, and role |
| Email verification result | 7 days | Reverify; never treat verification as consent |
| Consent/legal-basis record | Until withdrawn or its legal window expires | Block send; preserve minimum accountability record |
| Suppression/unsubscribe/complaint | Indefinite while needed to prevent contact | Always enforce before any route |
| Exact message approval | 7 days or any material change | Reapprove exact recipient/body/evidence |
| Budget/provider readiness | Before every external operation | Block if unknown, stale, or contradictory |

These are policy proposals, not current runtime changes. The shortest applicable expiry wins. New contact data must not resurrect a suppressed business. Timing requires a dated event or owner knowledge, not a model guess.

## Contact and send gates

Only a verified email may eventually be automated. Phone calls, forms, and social DMs remain manual tasks with their own rules. A lawful-looking channel is not a qualified opportunity, and a qualified account without email remains valuable.

Before an email can enter an owner approval packet, all of the following must be present:

- canonical business identity and accountable owner;
- current source-backed evidence, including at least one supported conversion-critical observation and the exact URL/artifact;
- a relevant recipient or approved role inbox, with publication context and current role relevance;
- verification result and capture time, with catch-all, unknown, malformed, disposable, stale, and conflicting results blocked;
- documented consent basis or clearly identified legal route, plus no-solicitation check and source evidence;
- active suppression checks at both contact and business level;
- current sender identity, mailing address, contact information, unsubscribe mechanism, campaign/offer version, and budget reservation;
- message claim review: no invented familiarity, urgency, result, case study, or unsupported customer consequence;
- exact evidence, recipient, sender identity, Cloudflare destination/reply owner, subject/body digest, policy version, and expiry bound to the approval.

CASL requires the sender to establish consent, identify the sender, and provide an unsubscribe mechanism. CRTC guidance says conspicuous publication is conditional on no contrary statement and message relevance to the recipient’s business role; implied consent can expire, while express consent persists until withdrawn. ISED summarizes two-year transaction/contract windows and six-month inquiry windows, identification/contact requirements, and the 10-business-day unsubscribe deadline. These sources guide the gate; they do not constitute legal advice: [CRTC implied-consent guidance](https://crtc.gc.ca/eng/com500/guide.htm), [ISED consent guidance](https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/getting-consent-send-email).

Email verification tests deliverability risk; it does not create consent. Calls are governed separately by CRTC Unsolicited Telecommunications Rules and internal do-not-call requirements: [CRTC telemarketing obligations](https://crtc.gc.ca/eng/phone/telemarketing/tobligations.htm). A contact form must never be test-submitted. Direct social messages can be CEMs depending on the platform and must be assessed manually: [CRTC social-media FAQ](https://crtc.gc.ca/eng/com500/faq500.htm).

The pre-send gate reruns immediately before dispatch against authoritative current state, not a cached dashboard: global/campaign/identity stop, suppression, consent, verification, evidence freshness, approval expiry, cadence, owner capacity, provider readiness, and budget. Any unknown or contradiction blocks the send. Follow-ups stay off until a separate experiment has its own evidence and approval.

## Manual pilot, then provider readiness

The first pilot is manual. The proposed five to ten total first touches per week can proceed only through an owner-approved channel with a proven legal route. Prioritize owner-managed calls and other separately approved manual tasks while cold email remains blocked. Do not use Resend for unsolicited messages: its current AUP expressly forbids cold outreach and requires explicit opt-in. Do not use Cloudflare Email Service for cold marketing: its current FAQ says the service is intended for transactional messages. Each permitted touch has an owner, exact message or task, timestamp, outcome, and next action. A complaint, wrong-recipient event, duplicate-send concern, suppression defect, or unexplained send outcome pauses the cohort immediately. ([Resend AUP](https://resend.com/legal/acceptable-use), [Cloudflare Email Service FAQ](https://developers.cloudflare.com/email-service/reference/faq/))

The selected zero-paid-mailbox path is Cloudflare Email Routing from the root domain to verified existing owner destinations for inbound mail only. A public DNS lookup (2026-09-23) confirms Cloudflare root MX/SPF, DMARC quarantine, a Resend verification token, two TXT values at `resend._domainkey`, and SES-looking SPF/MX records at `send`; DNS does not prove active destinations/rules, account ownership, which DKIM value is current, verified sender, or policy permission to send. Resend is unselected for cold prospecting under its current AUP. Cloudflare Email Sending is also not a cold-outreach route under its current transactional-only guidance. The app has no v2 send adapter or inbox integration, so the M4 manual observed-reply record is not provider connection/readiness. Cloudflare routing still needs destination verification, active rules and a controlled forward/reply test. For explicitly opt-in or transactional mail only, a later Resend review requires owner-approved account/billing state, restricted secret storage, verified domain, sender/legal identity, signed webhook endpoint, suppression policy, privacy/retention decision, recovery ownership, and a tested stop path. [Cloudflare routing](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/), [Cloudflare FAQ](https://developers.cloudflare.com/email-service/reference/faq/), [Resend AUP](https://resend.com/legal/acceptable-use), [Resend domain verification](https://resend.com/docs/add-a-domain), [Resend API keys](https://resend.com/docs/create-an-api-key).

Inbound owner replies are manually monitored at the verified Cloudflare destinations only after routing is proven. If an opt-in or transactional app-triggered send is later authorized, persist the Resend provider ID and stable `Message-ID`, set the owner alias as `Reply-To`, preserve `In-Reply-To`/`References`, validate webhook signatures, deduplicate by `svix-id`, and reconcile `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`. These future controls do not make Resend acceptable for cold outreach under its current AUP. Legacy Gmail OAuth/send/inbox-sync remains quarantined from v2; Gmail polling is a separately reviewed fallback, not the selected architecture. No provider, destination, or mailbox is assumed connected in this planning cycle, and no incremental provider spend has occurred.

Reply and suppression handling must work before production send. Ingestion classifies unsubscribe/complaint and bounce first, assigns an owner and due time, and applies suppression immediately. Replies then become interest, question/referral, negative, out-of-office, or unrelated. AI cannot override a stop or send a reply. If replies are stale or unowned, reduce or stop outreach.

For any future policy-permitted email, distinguish provider acceptance, confirmed send, delivery evidence, bounce, human reply, qualified interest, and opportunity. A timeout after dispatch is `UNKNOWN_OUTCOME`; it is never blindly retried. Reconcile provider history, Resend webhook events, or owner review, record the provider message ID when available, and resolve the state explicitly. Queues and application receipts provide at-least-once safety and idempotency; they do not create an exactly-once email guarantee. A hard bounce, complaint or unsubscribe immediately updates suppression; a delivery delay remains a separate review state. These controls do not override provider terms. [Resend AUP](https://resend.com/legal/acceptable-use), [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [Resend event types](https://resend.com/docs/webhooks/event-types), [Resend webhooks](https://resend.com/docs/webhooks/introduction).

## CRM and revenue truth

An interested reply is not an opportunity until an owner confirms the fit and next commercial step. Proposed stages are `NEW_REPLY`, `QUALIFYING`, `MEETING`, `PROPOSAL`, `WON`, `LOST`, and `DEFERRED`. Every transition records owner, timestamp, reason, next action, and lineage to business, contact, source, and campaign.

`WON` means an owner-confirmed commercial commitment, not positive sentiment or a drafted proposal. Track signed value, invoiced value, collected cash, refunds, recurring services, delivery, cancellations, and contribution separately. Collected revenue is cash actually received with an owner-held source, never inferred from opportunity value. Preserve losses, deferrals, negative replies, and suppression.

## Retention and deletion matrix

Retention is purpose-based. A legal hold overrides ordinary deletion and records who placed, reviewed, and released it. Source terms and provider restrictions override local convenience.

| Data class | Minimum needed use | Proposed lifecycle |
|---|---|---|
| Rejected/duplicate research | Explain rejection and avoid repeat work | Short-lived; delete raw artifacts after the review window and retain only minimal rejection reason/identity hash |
| Current business and website evidence | Reproducible qualification and audit | Keep current version plus superseded provenance until the source/audit window and any active decision expire; delete private screenshots/artifacts on expiry unless needed for dispute/hold |
| Contact and consent evidence | Accountability and suppression | Keep the minimum record for the consent window, withdrawal, complaint, and defensible audit period; avoid unnecessary message bodies |
| Suppression records | Prevent recontact | Retain minimal business/contact key, suppression reason, source, and timestamp as long as contact could recur; use keyed HMAC tokens for lookup where raw address is unnecessary |
| Cloudflare destination/reply state and any permitted Resend provider data | Manual owner handling and suppression; outbound reconciliation only for policy-permitted mail | Store only destination ownership/rule status, provider/message IDs, event type/time, suppression reason and minimum needed owner notes; keep API keys in approved secret storage; do not ingest full forwarded bodies by default; delete provider/webhook and mailbox-derived content when purpose ends or owner disconnects, subject to hold |
| CRM opportunity/revenue | Sales and financial reconciliation | Retain according to the applicable business/accounting need and legal hold; keep source/document references rather than duplicate sensitive documents |
| Backups | Restore and incident recovery | Apply a documented rotation and expiry; deletion is complete only after backup generations age out, except legal hold. No irrevocable “forever” retention by default |

Raw email should not be a suppression key. Normalize in memory, then use a private keyed HMAC token with key version metadata for durable lookup. Keep evidence private, redact logs, and never place secrets or full inbox payloads in screenshots, exports, prompts, commits, or reports.

This HMAC design is a proposed privacy improvement, not a current schema requirement. If adopted, dual-read old/new key versions during rotation and preserve necessary encrypted source evidence; a key rotation must never make a suppressed address appear new. Business-level and contact-level suppressions remain distinct, with no automatic unsuppression from a fresh import or mailbox change.

For the first capture pilot, prepare explicit retention values before collecting data: proposed 30 days for unused/rejected raw captures, 180-day review of dormant uncontacted account data, 30 days for raw operational logs, and a bounded backup rotation. Active evidence-use references, consent accountability, legal holds and source restrictions determine exceptions. These are local policy proposals, not statements of statutory retention. No artifact deletion is authorized by reaching a date: the existing lifecycle/reference/hold checks and a reviewed deletion path still apply. The minimum suppression record survives removal of a lead while recontact remains possible.

## Owner permission packets

A permission packet is a human-understandable decision boundary, not a click for every database transaction. It states the cohort/operation, purpose, external effect, sender identity, Cloudflare destination/reply owner, provider route, source/consent evidence, freshness, count, cost, retained data, risks, rollback/stop action, and decision required. Internal writes remain idempotent, auditable, and independently gated. A packet cannot imply approval for a different cohort, provider, offer, budget, or autonomous mode.

The owner can approve the 5–10-per-week experiment only after reply/suppression readiness, Cloudflare destination and channel-specific legal/provider gates, and exact actions are reviewable. Cold email remains off until a compatible provider policy and legal route are proven. Until then, the system remains research/manual; no production send, OAuth connection, paid activation, migration, or deployment is implied.
