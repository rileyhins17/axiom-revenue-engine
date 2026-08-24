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
| ArtifactWritePlan | A transient, bounded content-addressed batch whose object keys, retention class, media metadata, bytes, SHA-256 digests, create-if-absent policy, and zero provider authority validate together. |
| ArtifactWriteReceipt | The immutable outcome of a fixture storage attempt, including created/reused items, exact object identity, operation counts, cost, failure point, and no-delete rollback decision. |
| ArtifactManifest | Verified identity and current retention location for a bounded group of immutable artifacts, derived only from a completed write or promotion receipt. |
| ArtifactEvidenceUse | Versioned qualification, outreach, consent, touch, or legal-hold record that determines the minimum protection an artifact requires. |
| ArtifactPromotionPlan/Receipt | Idempotent copy plan and result that preserve content identity while moving evidence only to a stronger retention prefix. |
| ArtifactManifestEvidenceUse | Immutable link from a promoted manifest to the exact versioned business record that currently requires its retention. |
| ArtifactReleaseRecord | Content-bound owner/compliance retention decision covering every listed evidence use; it records review but cannot itself delete an object. |
| WebsitePageSelectionPlan | Deterministic zero-cost ranking of one same-site service, about, and contact URL from fresh homepage link evidence, with visible candidate scores, exclusions, completeness, and budget receipt. |
| WebsiteAuditAssembly | One versioned business-level receipt linking selected page captures, HTML facts, Browser evidence, artifact receipts, freshness, completeness, and per-business budgets to the exact deterministic audit input. |
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
| WorkflowRun | Stable identity and canonical request for one versioned workflow; immutable attempt receipts carry changing execution outcomes. |
| WorkflowReceipt | One immutable attempt outcome with status, site path, total cost, exact aggregate JSON/digest, completion time, and recording time. |
| WorkflowStepReceipt | One ordered checkpoint outcome attached to an exact WorkflowReceipt revision, with attempts, timing, digest, item count, warnings, and failure. |
| DurableEvidencePersistencePlan | Bounded fixture-only expected-state/preflight/insert-if-absent plan for migration 0056; it grants neither database mutation nor workflow resume authority. |
| WorkflowDefinitionDescriptor | Exact workflow graph, checkpoint codec, and component-version set bound by one digest; version 1 resume has no implicit compatibility fallback. |
| WorkflowDeliveryRecord | One idempotent receipt of the exact canonical workflow request, definition digest, delivery ID, mode, and receive time. |
| WorkflowAttemptSnapshot | One numbered execution attempt with immutable identity, status, delivery, request/definition digests, and monotonically increasing fencing token. |
| WorkflowLeaseClaim | Exact attempt owner, acquisition/expiry window, delivery, and fencing token used to reject stale-worker checkpoints. |
| WebsiteEvidenceCheckpoint | Full bounded step payload plus content-addressed locator, byte length, output digest, direct committed dependencies, attempt/fence, site path, and commit state. |
| ArtifactRecoveryRecord | Exact content-addressed write plan and receipt retained across partial failure, deployment interruption, created/reused retry, and no-delete reconciliation. |
| WorkflowReceiptRevision | Versioned wrapper binding an exact aggregate workflow receipt to its request, definition, and attempt; completed and partial audit results become terminal only when sealed. |
| FixtureWebsiteEvidenceResumePlan | Deterministic zero-authority decision to block, return terminal, wait, request a first fence, or request a higher-fenced takeover with an exact continuation/reconciliation plan. |
| WorkflowAttempt/Closure | Durable attempt identity plus at most one immutable ended-state record; absence of a closure means running, and sealed closure requires its exact terminal receipt. |
| WorkflowCheckpointPayload/StateReceipt | Content-addressed full fixture payload and stable checkpoint identity plus append-only prepared/committed state, so commit never overwrites recovery history. |
| ArtifactRecoveryPlan/Receipt | Byte-bound content-addressed plan stored once plus one or more exact fenced retry outcomes with zero provider-write/cost authority and no-delete rollback. |
| FencedEvidenceResumePersistencePlan | Migration-0057 expected-state/preflight/insert-if-absent plan that rejects blocked resume history, checks every collision candidate, and grants no database or execution authority. |
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
- Artifact object keys are derived from retention class, artifact kind, digest
  prefix, full digest, and media extension. Create-if-absent retries may reuse an
  object only after key, size, SHA-256, storage class, media metadata, and custom
  metadata all match. A partial batch is not rolled back by deletion because an
  immutable object may already be shared; unreferenced shadow objects expire by
  lifecycle instead.
- Shadow artifacts expire after 30 days and uncontacted qualification artifacts
  after 180 days. `OUTREACH_ACTIVE` and `LEGAL_HOLD` have no automatic deletion;
  release requires an approved compliance/owner decision. CRTC guidance does not
  prescribe one universal CASL record-retention period.
- Retention promotion is monotonic. Evidence uses compute the minimum destination:
  qualification uses require `QUALIFICATION_180D`; approval, consent, and touch
  uses require `OUTREACH_ACTIVE`; legal use requires `LEGAL_HOLD`. Already stronger
  protection is reused and never demoted.
- Promotion keeps the same `artifact:sha256:<digest>` identity while changing the
  prefix and retention metadata. Source and destination objects must reconcile;
  partial copies remain immutable for retry and are never rollback-deleted.
- A workflow receipt lists the manifest derived from every successful artifact
  write. A promotion source must already be in that receipt or an earlier ordered
  promotion, and a release record cannot introduce evidence outside that chain.
- Persisted evidence-use links mean "known active use" in version 1. No use-ending
  record or current-reference projection exists yet, so these records cannot
  authorize expiry, release, object deletion, or a claimed zero reference count.
- A release decision reviews every listed use exactly once and is bound to the
  manifest, uses, actor, reason, rationale, and time by a deterministic digest.
  Even an approved release has `providerDeleteAuthorized: false`; a future delete
  requires a fresh live-reference check and a separate explicitly approved gate.
- Page selection uses only fresh, complete homepage facts and cannot call a plan
  ready without a unique service, about, and contact page. It ranks all three
  roles together so one ambiguous URL cannot fill more than one requirement.
- A candidate must be canonical, public, same-authority, query-free, HTML-like,
  and above a visible role threshold. Service relevance uses the configured niche
  and expected services; policy, blog/news, careers, account/commerce, FAQ,
  financing/rebate/promotion, file, and homepage-duplicate destinations are not
  eligible. Every exclusion remains visible in the plan.
- A full website audit requires captured `HOME`, `SERVICE`, `ABOUT`, and `CONTACT`
  pages with complete HTML and desktop action/form coverage, plus complete mobile
  measurements for the homepage. A missing, failed, stale, cross-site, or partial
  page makes the assembly partial and cannot turn an unseen feature into a defect.
- Assembly budgets apply to the whole business, not each page independently:
  five selected pages, six Browser captures, 120 Browser seconds, 30 MiB of
  artifacts, 5 MiB of HTML, evidence no older than 24 hours, and at most two
  hours of cross-capture skew. Version 1 is fixture-only and costs zero.
- Real evaluation businesses and Riley's labels live in private D1 or ignored
  local storage. Synthetic fixtures may be committed; prospect records may not.
- A saved private persistence artifact is not trusted executable input. Any
  future loader must revalidate the source import, reproduce the canonical plan,
  require exact preflight matches, and stop on collision or drift.
- Durable evidence persistence is also validation-only. Migration 0056 can hold
  immutable receipt revisions, but the current module has no D1 executor and
  emits `mutationAuthorized: false` and `resumeAuthorized: false`. A step output
  digest is not a replay payload.
- Fixture resume now requires the full schema-validated payload and locator,
  current definition digest, dependency-closed graph, exact request/delivery,
  contiguous attempt history, and an active monotonically fenced lease at every
  write. A higher fence invalidates an older worker even if its local lease view
  appears usable.
- `COMPLETED`, `PARTIAL`, and completed unreachable audit receipts are terminal
  only after the exact attempt seals them. An active lease otherwise means wait;
  expiry is exclusive, and takeover must propose both the next attempt number
  and a higher fencing token from durable history.
- Browser measurement is a side-effect boundary. Without a committed storage
  checkpoint, resume falls back to captured subpages and reconciles exact
  retained artifact plans. Missing prepared receipts require all deterministic
  plans to be reconciled; object mismatch or invalid-receipt failures block.
  Content-addressed orphans are retained for lifecycle handling, never rollback
  deleted.
- The resume planner is still not a runtime. It cannot persist a checkpoint,
  acquire a lease, run a step, contact a provider, spend money, or delete an
  object: `mutationAuthorized`, `executionAuthorized`, and deletion authority
  remain false, with provider operations and cost fixed at zero.
- Migration 0057 stores stable attempt identity separately from one immutable
  closure, and checkpoint identity/payload separately from prepared/committed
  state receipts. Artifact recovery plans are also separate from retry receipts,
  so an exact failed-then-completed reconciliation does not rewrite the plan.
- Fenced persistence preflights query every row matching the primary or any
  alternate unique identity and use no `LIMIT 1`. Missing is safe to insert;
  exactly one byte-for-byte expected row is idempotent; drift or multiple rows
  block. A blocked resume decision cannot produce a persistence plan.
- The migration-0057 planner serializes fixture `Uint8Array` artifact bytes with
  an explicit base64 tag, but has no loader or D1 executor. Atomic fence claim,
  decode/revalidation, D1 payload-size policy, and transaction post-verification
  remain separate release-gated work.
- An approval is invalid after content changes, expiry, rejection, or revocation;
  the final provider call recomputes its digest every time.
