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

Calibration, calls, proposals, delivery, reply handling, and incidents are additional work. If capacity is exceeded, shrink the shortlist. The proposed first-touch experiment is **5–10 total messages per week across both owners**, manual and without follow-ups. The separate ten-task prepared queue cap limits inventory; it is not an additional allowance for external actions. The master plan’s 50-per-week figure is a later ceiling, not a target or authorization.

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
- exact evidence, recipient, mailbox, subject/body digest, policy version, and expiry bound to the approval.

CASL requires the sender to establish consent, identify the sender, and provide an unsubscribe mechanism. CRTC guidance says conspicuous publication is conditional on no contrary statement and message relevance to the recipient’s business role; implied consent can expire, while express consent persists until withdrawn. ISED summarizes two-year transaction/contract windows and six-month inquiry windows, identification/contact requirements, and the 10-business-day unsubscribe deadline. These sources guide the gate; they do not constitute legal advice: [CRTC implied-consent guidance](https://crtc.gc.ca/eng/com500/guide.htm), [ISED consent guidance](https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/getting-consent-send-email).

Email verification tests deliverability risk; it does not create consent. Calls are governed separately by CRTC Unsolicited Telecommunications Rules and internal do-not-call requirements: [CRTC telemarketing obligations](https://crtc.gc.ca/eng/phone/telemarketing/tobligations.htm). A contact form must never be test-submitted. Direct social messages can be CEMs depending on the platform and must be assessed manually: [CRTC social-media FAQ](https://crtc.gc.ca/eng/com500/faq500.htm).

The pre-send gate reruns immediately before dispatch against authoritative current state, not a cached dashboard: global/campaign/mailbox stop, suppression, consent, verification, evidence freshness, approval expiry, cadence, owner capacity, provider readiness, and budget. Any unknown or contradiction blocks the send. Follow-ups stay off until a separate experiment has its own evidence and approval.

## Manual pilot, then Gmail readiness

The first pilot is manual. Start with five to ten total first touches per week, no automated calls/forms/DMs, and no follow-ups. Each touch has an owner, exact message, timestamp, provider result, and next reply action. A complaint, wrong-recipient event, duplicate-send concern, suppression defect, or unexplained send outcome pauses the cohort immediately.

Gmail integration is not ready merely because an OAuth client exists. Readiness requires named mailbox owners, recovery ownership, narrow scopes, secure refresh-token storage, a privacy/retention decision, and a tested stop path. Gmail `gmail.readonly` is restricted; `gmail.send` is sensitive. Public apps using restricted data may require verification and a security assessment. Internal-use exemption applies only when users are within the same Google Workspace or Cloud Identity organization, the project is organization-owned, and the consent screen is Internal: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Google internal-use exception](https://support.google.com/cloud/answer/13464323), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

For two mailboxes, begin with manual reply handling and incremental polling at a proposed freshness target of 15 minutes or less. Full sync establishes the baseline; `history.list(startHistoryId)` handles changes, and an unavailable cursor requires full resync: [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync). Defer Pub/Sub/watch until polling is insufficient; if enabled, renew `watch` at least every seven days: [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push). External Testing projects with Gmail scopes can issue refresh tokens that expire after seven days, so staging must test reauthorization and production must use the appropriate published/internal configuration. No mailbox is assumed connected in this planning cycle.

Reply and suppression handling must work before production send. Ingestion classifies unsubscribe/complaint and bounce first, assigns an owner and due time, and applies suppression immediately. Replies then become interest, question/referral, negative, out-of-office, or unrelated. AI cannot override a stop or send a reply. If replies are stale or unowned, reduce or stop outreach.

The system must distinguish provider acceptance, confirmed send, delivery evidence, bounce, human reply, qualified interest, and opportunity. A timeout after dispatch is `UNKNOWN_OUTCOME`; it is never blindly retried. Reconcile provider history or owner review, record the provider message ID when available, and resolve the state explicitly. Queues and application receipts provide at-least-once safety and idempotency; they do not create an exactly-once email guarantee. [Gmail send reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).

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
| Gmail tokens and message data | Sync and owner reply handling | Secrets in approved secret storage; retain only required metadata/body excerpt; delete mailbox-derived content when its operational purpose ends or owner disconnects, subject to hold |
| CRM opportunity/revenue | Sales and financial reconciliation | Retain according to the applicable business/accounting need and legal hold; keep source/document references rather than duplicate sensitive documents |
| Backups | Restore and incident recovery | Apply a documented rotation and expiry; deletion is complete only after backup generations age out, except legal hold. No irrevocable “forever” retention by default |

Raw email should not be a suppression key. Normalize in memory, then use a private keyed HMAC token with key version metadata for durable lookup. Keep evidence private, redact logs, and never place secrets or full inbox payloads in screenshots, exports, prompts, commits, or reports.

This HMAC design is a proposed privacy improvement, not a current schema requirement. If adopted, dual-read old/new key versions during rotation and preserve necessary encrypted source evidence; a key rotation must never make a suppressed address appear new. Business-level and contact-level suppressions remain distinct, with no automatic unsuppression from a fresh import or mailbox change.

For the first capture pilot, prepare explicit retention values before collecting data: proposed 30 days for unused/rejected raw captures, 180-day review of dormant uncontacted account data, 30 days for raw operational logs, and a bounded backup rotation. Active evidence-use references, consent accountability, legal holds and source restrictions determine exceptions. These are local policy proposals, not statements of statutory retention. No artifact deletion is authorized by reaching a date: the existing lifecycle/reference/hold checks and a reviewed deletion path still apply. The minimum suppression record survives removal of a lead while recontact remains possible.

## Owner permission packets

A permission packet is a human-understandable decision boundary, not a click for every database transaction. It states the cohort/operation, purpose, external effect, identities/mailboxes, source/consent evidence, freshness, count, cost, retained data, risks, rollback/stop action, and decision required. Internal writes remain idempotent, auditable, and independently gated. A packet cannot imply approval for a different cohort, provider, offer, budget, or autonomous mode.

The owner can approve the 5–10-per-week experiment only after reply/suppression readiness, mailbox/legal gates, and exact messages are reviewable. Until then, the system remains research/manual; no production send, OAuth connection, paid activation, migration, or deployment is implied.
