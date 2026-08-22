# Revenue Engine data dictionary

| Record | Meaning |
|---|---|
| Business | Canonical company identity, independent of any source or contact. |
| Location | A physical/service location and typed country/region/city geography. |
| SourceRecord | Raw provider observation with provenance and source-owned ID. |
| CoverageRun | One source/niche/geographic-cell attempt, yield, duplicates, cost, and cooldown. |
| WebsiteSnapshot | Timestamped desktop/mobile website capture and deterministic checks. |
| EvidenceClaim | One supportable observation with URL/artifact, method, confidence, and audit version. |
| ContactPoint | Email, phone, form, social route, or operator identity candidate. |
| ConsentEvidence | Recorded lawful basis and public-source context for a contact action. |
| VerificationResult | Deliverability, freshness, provider, method, and timestamp for a contact. |
| QualificationSnapshot | Versioned five-score decision, gates, reasons, and recommended route. |
| ChannelRoute | Ranked next-contact channel plus manual/automated policy. |
| Campaign | Approved audience, offer, policy, budget, and stop conditions. |
| Variant | Versioned message hypothesis with a 25-first-touch review cap. |
| Touch | Approved/sent/manual contact attempt with evidence, route, and attribution. |
| OutreachApproval | Human decision bound to the exact recipient, content digest, campaign, variant, and policy version. |
| InboundMessage | Synced reply or delivery event with thread identity. |
| ReplyClassification | Bounce, unsubscribe, negative, neutral, positive, referral, or opportunity. |
| Opportunity | Qualified commercial conversation, stage, value, owner, and next action. |
| Client | Won customer and delivery/recurring value state. |
| FunnelEvent | Append-only, idempotent business event used for outcome measurement. |
| Suppression | Durable do-not-contact state and reason across all relevant identities. |
| WorkflowRun | Resumable execution receipt with version, step, attempt, result, and failure. |
| CostLedger | Provider usage/cost attached to a run, lead, campaign, and budget period. |
| KwLeadEvaluationSet | Private 50-lead owner-labelled KW quality gate used to measure engine agreement before live outreach. |

## Identity and evidence rules

- Business identity is resolved from source IDs, normalized domain, phone,
  address, and name; no single weak field is universally authoritative.
- ContactPoint is not Business. A business may have many routes and people.
- Current state may change, but FunnelEvent, EvidenceClaim, QualificationSnapshot,
  ConsentEvidence, WorkflowRun, and CostLedger are immutable/versioned history.
- Unknown or migrated evidence remains explicitly unknown; never fabricate it to
  satisfy a non-null UI.
- Deterministic website checks record `PASS`, `FAIL`, or `UNKNOWN`; only a
  supportable `FAIL` creates a negative EvidenceClaim, while unknown capture
  coverage lowers evidence confidence instead of becoming a guessed weakness.
- Real evaluation businesses and Riley's labels live in private D1 or ignored
  local storage. Synthetic fixtures may be committed; prospect records may not.
- An approval is invalid after content changes, expiry, rejection, or revocation;
  the final provider call recomputes its digest every time.
