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
| ArtifactEvidenceUseEnd | One immutable, basis-backed ending for an exact evidence-use version; it preserves history and grants no release or deletion authority. |
| ArtifactPromotionPlan/Receipt | Idempotent copy plan and result that preserve content identity while moving evidence only to a stronger retention prefix. |
| ArtifactManifestEvidenceUse | Immutable link from a promoted manifest to the exact versioned business record that currently requires its retention. |
| ArtifactReferenceProjection | Immutable, time-bounded lineage snapshot that assigns each active use to the weakest valid sufficient manifest or reports ambiguity/incompleteness. |
| ArtifactReferenceProjectionUse/Assignment | Queryable per-use state and exact current protecting-manifest candidate(s), including ended, unique, ambiguous, and unassigned outcomes. |
| ArtifactReleaseRecord | Content-bound owner/compliance retention decision covering every listed evidence use; it records review but cannot itself delete an object. |
| WebsitePageSelectionPlan | Deterministic zero-cost ranking of one same-site service, about, and contact URL from fresh homepage link evidence, with visible candidate scores, exclusions, completeness, and budget receipt. |
| WebsiteAuditAssembly | One versioned business-level receipt linking selected page captures, HTML facts, Browser evidence, artifact receipts, freshness, completeness, and per-business budgets to the exact deterministic audit input. |
| EvidenceClaim | One supportable observation with URL/artifact, method, confidence, and audit version. |
| ContactDiscoveryCandidate | One canonical email, Canadian phone, form, or supported social route for one exact business. It groups immutable public evidence but remains `NOT_VERIFIED`, consent-unassessed, and non-automatable. |
| ContactDiscoveryReceipt | Append-only record of one exact validated discovery result, its business, candidate/evidence counts, mode, adapter, and zero operational authority. |
| ContactPoint | One immutable version of a stable email, phone, form, or social candidate. Its row ID binds the discovery result and candidate digest; `candidateId` remains stable across refreshed versions. |
| ContactEvidenceClaim/Use | Reusable immutable public observation plus the append-only link proving which exact discovery/contact version used it. |
| ConsentEvidence | Recorded lawful basis and public-source context for a contact action. |
| ContactVerificationResult | Content-bound, channel-specific fixture result for one exact discovery candidate. It can recommend owner email review or a manual phone/form/social action, but cannot persist, approve outreach, or authorize sending. |
| VerificationResult | Append-only persisted deliverability/availability receipt bound to one exact contact-point version and source result, with freshness, derived owner status/action, and zero operational authority. |
| ContactPersistencePlan | Schema-0063 validation-only preflight/append plan for discovery, contact versions, evidence, and verification history. It distinguishes fresh, exact replay, collision, and incomplete history but has no executor or mutation authority. |
| PrivateKwContactPersistence | Separately owner-approved ignored-local transaction that re-derives the exact validation-only contact plan, checks the complete schema and every collision identity inside SQLite `IMMEDIATE`, inserts only a fresh complete fixture bundle, and reloads it before commit. |
| RevenuePrivateKwContactPersistenceReceipt | Append-only schema-0065 completion seal inserted last after the exact discovery/contact/evidence/verification bundle; schema 0066 hardens its content-derived identity and exact verification-ID set. It binds the approval, plan, counts, transaction type, and zero consent/downstream authority. |
| PrivateKwContactReview | No-overwrite owner-readable artifact constructed with a read-only canonical local database. It binds one exact source candidate and reconstructed persisted assessment to fixture discovery/verification evidence, visible scores/routes, `UNASSESSED` consent, and zero mutation/provider/outreach authority. |
| RevenuePrivateKwContactInvocationReceipt | Append-only schema-0067 final seal retaining the complete reviewed packet and binding it to the exact source-plan digest, assessment receipt/digest, contact materialization, discovery receipt, reviewer, approval time, and zero downstream authority. |
| QualificationSnapshot | Versioned five-score decision, gates, reasons, and recommended route. |
| RevenueLeadAssessment | Deterministic, content-bound combination of one sealed website audit, explicit business-fit/timing basis, conservative research-only qualification, refresh time, and zero operational authority. |
| RevenueLeadAssessmentReceipt | Append-only D1 receipt linking one exact workflow receipt, website snapshot, evidence set, and qualification snapshot committed in one batch. |
| ChannelRoute | Ranked next-contact channel plus manual/automated policy. |
| OwnerLeadProjection | Read-only, current owner view of one v2 business: separate scores, recomputed qualification, strongest exact evidence, best current route, refresh/block state, and zero operational authority. |
| OwnerLeadListResponse | Authenticated, private/no-store, bounded list of ranked owner projections plus explicit invalid-row/contact counts and no mutation/outreach/provider/cost authority. |
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
| ArtifactReferencePersistencePlan | Migration-0058 collision-complete preflight/insert-if-absent plan for endings, projections, projected uses, and assignments; it grants no mutation, retention-release, deletion, provider, or cost authority. |
| ArtifactReferenceSnapshotAttempt | One append-only, five-minute-or-shorter attempt/lease claim for a lineage snapshot, with a contiguous attempt number, strictly increasing fencing token, versioned query contract, and zero operational authority. |
| ArtifactManifestAvailabilityReceipt | Immutable content-bound fixture or R2 HEAD observation for one exact manifest; only a future fresh, unambiguous R2 winner per manifest may satisfy transactional completeness. |
| ArtifactManifestHeadExecution | Fixture-only, digest-bound attempt over every canonical manifest object with explicit missing/mismatch/error outcomes and zero provider, persistence, retry, release, deletion, or cost authority. |
| ArtifactDeliveryGrant | Canonical HMAC-authenticated, five-minute-or-shorter authorization bound to one authenticated session, exact business/snapshot/screenshot reference, website freshness, and artifact expiry; it contains no R2 URL or object key. |
| FixtureArtifactDeliveryExecution | Fixture-only proof that an authorized desktop/mobile WebP can be integrity-checked and returned with private same-origin headers while provider, mutation, outreach, send, and cost authority remain zero. |
| ArtifactReferenceSourceSetProof | Canonical count, stable row identities, predicate version, set digest, and proof digest for one of the 15 exact workflow/lineage/use/availability source sets. |
| ArtifactReferenceCompletenessReceipt | Private-executor-created and reloaded seal binding the winning attempt/fence, all exact source-set proofs, and normalized source facts; its structural schema alone is never trusted and it grants no retention or deletion authority. |
| ArtifactReferenceAtomicPlan | Validation-only D1 claim/read/recheck/commit contract. The private executor reconstructs it exactly before use, so redigesting altered control SQL cannot authorize execution. |
| ArtifactReferenceTrustedD1Execution | Result available only after the private executor verifies all 51 writer guards, rechecks all 15 source sets, atomically commits the receipt/proofs, and independently reloads them. It grants no projection, retention, provider, release, deletion, outreach, or cost authority. |
| CostLedger | Provider usage/cost attached to a run, lead, campaign, and budget period. |
| KwLeadEvaluationSet | Private 50-lead owner-labelled KW quality gate used to measure engine agreement before live outreach. |
| PrivateKwImportPlan | Versioned, ignored local seed of canonical research-only businesses, locations, cohort source runs, and source records; it grants no qualification or outreach authority. |
| PrivateKwPersistencePlan | Validation-only, schema-bound expected-state and insert-if-absent plan for the private seed; it has no executor or mutation authority and creates no qualification, contact, or outreach records. |
| PrivateKwShadowSliceManifest | Content-bound, ignored-local scope for exactly ten manually reviewed independent KW businesses, their balanced city/niche mix, ordered integration phases, current checkpoint, and next separate gate; it grants no execution, provider, mutation, deployment, outreach, send, or cost authority. |
| PrivateKwShadowSlicePhaseReceipt | Content-derived normalized reference to one already-verified upstream phase result for one exact manifest business, including the fixed phase, primary/supporting receipt identities and digests, predecessor receipt, completion/recording time, and all-false/zero execution authority. |
| PrivateKwShadowSliceProgressCheckpoint | Immutable ignored-local ten-business resume point that embeds each business's exact ordered phase-receipt prefix, parent checkpoint, derived current checkpoint/next gate, and progress summary; it cannot execute or approve any phase. |
| PrivateKwSourceWorkflowProgressAdapter | Read-only/query-only local adapter that reconstructs one approved source/workflow materialization, verifies the canonical schema and every exact stored row including the sealed terminal workflow and final materialization receipts, then emits the first zero-authority normalized phase-receipt input. |
| PrivateKwCurrentWebsiteEvidenceProof | Synthetic-only content-addressed proof that binds one exact shadow-slice business and source/workflow predecessor to a complete captured website workflow, desktop/mobile homepage evidence, deterministic audit, durable persistence plan, every artifact manifest, and fresh fixture availability receipts. It grants zero execution/progress authority and cannot replace the separate trusted website-evidence eligibility receipt. |
| PrivateKwAssessmentProgressProof | Synthetic-only content-addressed proof that binds one exact manifest business and completed website-evidence phase to its evidence/eligibility references, sealed workflow and audit, immutable assessment identities/digests, and committed-and-reloaded D1 result. It is required as a separate `ASSESSMENT` progress reference but cannot read or mutate D1, execute qualification, create a phase receipt, advance progress, discover contacts, or authorize outreach. |
| PrivateKwSourceWorkflowMaterialization | Separately owner-approved ignored-local transaction that re-derives one deterministic audit and may append only the exact source plan plus one sealed six-row workflow lineage. It cannot assess, capture, contact, deploy, migrate, call a provider, or spend. |
| RevenuePrivateKwMaterializationReceipt | Append-only schema-0064 seal committed last after the exact local source/workflow rows; it binds the source-plan, candidate, audit, workflow, approval, row counts, transaction type, and zero downstream authority. |

## Identity and evidence rules

- Business identity is resolved from source IDs, normalized domain, phone,
  address, and name; no single weak field is universally authoritative.
- Owner lead projection never treats email availability as business quality.
  Route order is verified named email, verified role email, phone, form, social,
  then research; every non-email route remains manual and every email remains
  unapproved by the read model.
- Contact discovery and verification are separate gates. Discovery keeps the
  canonical value plus every source URL, capture time, method, confidence,
  publication state, contrary-contact-statement state, role relevance, and
  unassessed consent state. It cannot claim reachability. Verification binds one
  result to the exact business, candidate ID/digest, channel, and value; it cannot
  infer consent, approval, or send authority.
- Email verification distinguishes deliverable, undeliverable, catch-all, and
  unknown. Only a current deliverable named/role address can become an owner-
  reviewable route. Positive phone, form, and social results remain manual;
  generic business inboxes and all ambiguous outcomes remain research work.
- Stable candidate identity is not a mutable contact row. Each discovery creates
  a content-bound contact-point version; repeated verification appends another
  receipt. Current owner state is projected from the latest version/verification.
  Migrations 0062–0063 reject loose inserts, lineage/payload drift, and every
  update/delete.
- Local contact persistence requires a separate approval bound to the discovery,
  every verification result, and the re-derived plan. Schema 0065's final receipt,
  hardened by schema 0066, is distinct from the discovery parent: exact replay
  writes nothing, globally
  reusable evidence may match, and partial or receipt-less discovery-owned state
  is never repaired.
- Local contact invocation separates review from mutation. Review preparation
  opens SQLite read-only and reconstructs the assessment from sealed lineage; a
  different current approval is required before one outer `IMMEDIATE`
  transaction can persist the contact bundle and schema-0067 receipt. The final
  receipt retains the full review, and a missing final receipt rolls the contact
  bundle back rather than leaving detached reachability beside an assessment.
- Public contact evidence does not imply CASL consent. Discovery and persistence
  retain `UNASSESSED`; a future `ConsentEvidence` decision remains mandatory and
  separate from verification or owner route readiness.
- Shadow assessment persistence also refuses to infer reachability from website
  or source data. It stores reachability zero and route `RESEARCH`; contact and
  verification records must later prove a usable channel under a separate gate.
- Owner screenshot delivery requires the current authenticated user/session and
  exact business, website snapshot, logical viewport, artifact reference,
  website refresh deadline, and artifact expiry to match a signed grant. The
  grant is capped at five minutes, streams only integrity-checked WebP through a
  same-origin private/no-store response, and never exposes an R2 URL or object
  key. DOM artifacts are not renderable under this contract.
- An assessment starts only from the exact sealed terminal workflow-receipt
  revision. Its website snapshot, capture-specific evidence claims,
  qualification, and assessment receipt commit atomically and reload exactly.
  Migration 0061 makes all four record types append-only and grants no runtime,
  outreach, send, provider, or cost authority.
- Owner projections accept source evidence up to 90 days old and website audits
  up to 60 days old. Future/stale facts, score/evidence drift, or qualification
  predating the audit become explicit refresh work rather than actionable state.
- The owner reader uses bounded SELECTs over the latest v2 records, normalizes
  public URLs, rejects cross-business contamination, and returns only exact audit
  observations as “why this lead.” It cannot write D1 or call a provider.
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
- Shadow artifacts expire after 30 days. Qualification evidence requires review
  after 180 days but has no automatic deletion. `OUTREACH_ACTIVE` and
  `LEGAL_HOLD` also have no automatic deletion; release requires an approved
  compliance/owner decision. CRTC guidance does not prescribe one universal
  CASL record-retention period.
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
- Persisted evidence-use links are immutable history, not a live counter. One
  exact use-ending record may close a versioned purpose; a new purpose needs a
  new use ID. Legal hold can end only through explicit compliance clearance.
- A fixture current-reference projection binds an explicit workflow/business
  lineage, evidence-use set, completed promotions, exact promotion/use links,
  use endings, and content-bound availability facts. Each active use selects the
  weakest verified-present, unexpired linked copy that satisfies retention.
  Equal candidates or no valid candidate make the projection indeterminate.
- Fixture snapshots are `FIXTURE_ASSERTED`, never transactionally complete, and
  cannot produce `NO_CURRENT_REFERENCES` or a retention-review suggestion. Every
  currentness check replays the deterministic projection, and release, deletion,
  provider operations, retention conclusions, and cost authority remain false/zero.
- Atomic reference planning derives 15 database source sets from the workflow
  and lineage root rather than accepting caller-supplied IDs. Each set binds all
  raw rows, stable IDs, count, predicate version, and digest. Caller observations
  can produce only an explicitly untrusted proof; structural JSON and digests do
  not prove a D1 transaction.
- A trusted completeness receipt requires a single winning half-open fence, the
  same source-set digests before commit, one fresh unambiguous R2 HEAD receipt per
  manifest, database-enforced writer freeze, exact recheck, atomic parent/child
  insert and postverify, and an independent committed-row reload. The private
  local-only executor now proves this in disposable D1; it has no runtime binding.
- One website-evidence workflow can contain several independent artifact roots.
  Raw decoding validates the complete workflow forest and every boundary row,
  then selects one explicit root component for projection. Other roots remain
  visible; they are never silently filtered or treated as children.
- Availability v2 binds canonically ordered per-object HEAD facts: expected and
  observed key, kind, artifact reference, length, SHA-256 metadata, and ETag.
  Its object-set digest covers those observations, not only expected keys. Only
  one latest, fresh, exact `R2_HEAD` winner per manifest can satisfy structural
  decoding; fixture, future, stale, missing, unknown, or tied observations block.
- Manifest HEAD adapter v1 accepts only an injected fixture client, at most ten
  exact objects, at most five minutes of freshness, and zero provider Class B
  operations/cost. Its normalized object shape mirrors the future R2 mapping,
  but it emits `checkerKind=FIXTURE` and `providerReadPerformed=false`; even an
  all-matched result cannot become an `R2_HEAD` winner or grant authority.
- The 15-set D1 source decoder uses exact-column schemas, parses canonical stored
  JSON with current domain schemas, recomputes every digest, checks denormalized
  columns and alternate identities, reconstructs contiguous fenced attempts and
  one sealed terminal result, and validates manifest/promotion/use/replacement
  closure. It cannot upgrade a caller observation to trust; only the private
  database executor can do so after commit and reload.
- A trusted projection-v2 input must be the exact frozen in-process object
  returned by a fresh executor commit. Schema-shaped clones and exact sealed
  replays are not materialized source snapshots and cannot be projected. The
  adapter separately binds the sealed availability-v2 source digest and its
  deterministic v1 compatibility-replay digest.
- A transactionally complete selected lineage with zero active evidence uses may
  report `NO_CURRENT_REFERENCES`. Ambiguous or unassigned active uses remain
  `INDETERMINATE`. These are reference observations only: retention conclusions,
  projection persistence, release, deletion, provider work, and cost all remain
  unauthorized.
- Only `SHADOW_30D` availability carries an automatic object-expiry fact.
  `QUALIFICATION_180D` is a review policy for promoted evidence, not an R2
  lifecycle deletion authorization; all promoted classes reject an invented
  automatic object expiry.
- Migration 0060 makes all 15 atomic source tables append-only and freezes any
  scoped insert while an unsealed workflow snapshot satisfies
  `acquiredAt <= database-now < expiresAt`. The database scope includes alternate
  workflow identity, every workflow manifest, touching promotions, their links,
  recursive replacement uses/endings, and availability. Snapshot attempts,
  completeness receipts, and source-set proofs are immutable too. The private
  executor verifies all 51 trigger definitions before claiming an attempt, but
  migration 0060 is still local-only and has no runtime binding.
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
- Source/workflow materialization uses a different owner approval from shadow
  assessment. It accepts the original source plan and deterministic audit input,
  re-derives both trusted plans, acquires one SQLite `IMMEDIATE` transaction,
  checks every primary and alternate identity, appends missing source and sealed
  workflow rows, commits its receipt last, and reloads every row before commit.
  Exact replay writes nothing; a receipt with any missing child is corruption.
- The schema-0064 receipt positively authorizes only this ignored-local source
  and workflow transaction. Assessment, schema changes, capture, contact work,
  outreach, send, provider operations, cost, deployment, and staging/production
  access remain false or zero and require their own later gates.
- The guarded local assessment command accepts the original prepared source plan,
  not a saved persistence artifact. Persistence plan v2 queries every primary or
  alternate identity without `LIMIT 1`; the command requires exactly one expected
  row for every planned source entity before it can call the sealed assessment
  writer. Zero rows, multiple rows, or field drift stop execution.
- Local shadow approval authorizes one append-only assessment write only. It
  binds the exact source-plan digest, evaluation candidate, sealed workflow
  receipt, business-fit/timing basis, scores, policy blocks, reviewer, and
  assessment timestamp. It cannot create source/workflow/contact rows, infer
  reachability, call providers, or authorize outreach.
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
