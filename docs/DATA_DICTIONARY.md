# Revenue Engine data dictionary

| Record | Meaning |
|---|---|
| Business | Canonical company identity, independent of any source or contact. |
| Location | A physical/service location and typed country/region/city geography. |
| SourceRecord | Raw provider observation with provenance and source-owned ID. |
| CoverageRun | One source/niche/geographic-cell attempt, yield, duplicates, cost, and cooldown. |
| WebsiteSnapshot | Timestamped, bounded website capture with requested/final URL, redirect chain, HTTP outcome, content metadata, artifact references, and deterministic checks. |
| HtmlPageFacts | Versioned server-HTML observations for metadata, visible text, actions, forms, trust markers, structured-data types, and internal links; visual placement and computed visibility remain unknown. |
| BrowserPageEvidence | One versioned fixed-viewport render outcome with screenshot/measurement artifact references, hashes, deterministic layout/action/form/navigation/text observations, explicit coverage, provider receipt, and failure state. |
| BrowserMeasurementDraft | A bounded, zero-cost, unpersisted fixture-runner result containing screenshot/measurement bytes, canonical hashes, validated public-navigation receipt, and no artifact-write authority. |
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
| PrivateKwImportPlan | Versioned, ignored local seed of canonical research-only businesses, locations, cohort source runs, and source records; it grants no qualification or outreach authority. |
| PrivateKwPersistencePlan | Validation-only, schema-bound expected-state and insert-if-absent plan for the private seed; it has no executor or mutation authority and creates no qualification, contact, or outreach records. |

## Identity and evidence rules

- Business identity is resolved from source IDs, normalized domain, phone,
  address, and name; no single weak field is universally authoritative.
- The private KW seed refuses shared domain, phone, or normalized name/location
  signals instead of silently merging possible duplicates. Source-run and record
  IDs remain deterministic for the same import version and input.
- ContactPoint is not Business. A business may have many routes and people.
- Current state may change, but FunnelEvent, EvidenceClaim, QualificationSnapshot,
  ConsentEvidence, WorkflowRun, and CostLedger are immutable/versioned history.
- Unknown or migrated evidence remains explicitly unknown; never fabricate it to
  satisfy a non-null UI.
- Deterministic website checks record `PASS`, `FAIL`, or `UNKNOWN`; only a
  supportable `FAIL` creates a negative EvidenceClaim, while unknown capture
  coverage lowers evidence confidence instead of becoming a guessed weakness.
- Rejected, failed, oversized, non-HTML, and timed-out website captures cannot be
  converted into DOM or visual evidence. Each redirect is a separately validated
  public target and the capture result retains its policy/version.
- Incomplete HTML extraction cannot claim full page coverage. Server HTML never
  proves above-the-fold placement, computed CSS, or mobile usability; those
  require captured browser evidence.
- A screenshot is an artifact, not a finding. Browser facts become usable only
  when their fixed viewport, business/page/URL identity, measurement version,
  coverage flags, artifact reference, and digest validate. Partial or failed
  measurement stays unknown.
- A BrowserMeasurementDraft is not durable evidence. Finalization recomputes its
  byte lengths, canonical measurement bytes, and SHA-256 digests, then requires
  exact `artifact:sha256:<digest>` references. Version 1 accepts fixtures only;
  live Browser and R2 adapters require separate release gates.
- Real evaluation businesses and Riley's labels live in private D1 or ignored
  local storage. Synthetic fixtures may be committed; prospect records may not.
- A saved private persistence artifact is not trusted executable input. Any
  future loader must revalidate the source import, reproduce the canonical plan,
  require exact preflight matches, and stop on collision or drift.
- An approval is invalid after content changes, expiry, rejection, or revocation;
  the final provider call recomputes its digest every time.
