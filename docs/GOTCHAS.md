# Gotcha ledger

A gotcha is a proven failure pattern that could recur. Add only after evidence.
Include symptom, root cause, proven fix, prevention/test, affected area, and the
verifying commit. Promote a repeated gotcha into an automated test or `AGENTS.md`.
Retire entries when the architecture makes them impossible.

## DATA-011 — A realistic UI fixture bypassed the writer it claimed to represent

- **Symptom:** the owner dossier browser test rendered plausible contact routes,
  but its setup executed validation-plan SQL directly. The UI could therefore
  stay green even if the actual transactional contact executor, completion
  receipt, or replay rules stopped producing readable rows.
- **Root cause:** the read surface was originally built before the separately
  approved executor existed, and its synthetic seed was not upgraded when the
  writer became authoritative.
- **Proven fix:** the acceptance seed now inserts only the business/audit/
  qualification prerequisites directly, then passes exact synthetic discovery,
  verification, and approval contracts through the real contact executor. It
  requires a fresh commit, immutable completion receipt, exact reload, and
  mutation-free replay before the browser starts.
- **Prevention/test:** the safety scan requires the executor call and receipt
  query, forbids the former loose-planner loop, and keeps consent, qualification,
  providers, outreach, send, and cost authority off. The browser must render the
  executor-produced phone, form, and email routes on authenticated desktop and
  mobile pages with zero external requests.
- **Affected area:** owner list/dossier acceptance, writer-reader compatibility,
  contact provenance, schema migrations, and CI confidence.
- **Verifying commit:** branch HEAD containing the executor-backed owner dossier
  fixture and this entry.

## DATA-010 — Persisted contact evidence was detached from qualification lineage

- **Symptom:** a contact bundle could be valid for one business yet provide no
  durable proof of the exact source plan, sealed website assessment, or complete
  owner-readable evidence packet that justified researching that route.
- **Root cause:** the schema-0065/0066 completion receipt correctly sealed the
  contact transaction but intentionally stopped at business/contact lineage; the
  later operator invocation boundary did not yet exist.
- **Proven fix:** review preparation now opens canonical local SQLite read-only,
  reconstructs the persisted assessment from its sealed workflow receipt, and
  derives fixture contact results into a no-overwrite packet. A separate approval
  and outer `IMMEDIATE` transaction insert schema 0067's immutable invocation
  receipt last with the complete review and exact source/assessment/contact
  lineage.
- **Prevention/test:** the integration test covers read-only review counts,
  approval drift with zero writes, final-receipt rollback, fresh commit,
  mutation-free replay, full-review persistence, missing JSON authority,
  and update/delete rejection. Database trigger comparisons use `IS NOT 0/1`
  so missing JSON fields fail closed instead of disappearing into SQLite's
  three-valued `NULL` logic. The safety scan prevents Worker/provider wiring,
  binds the review ID to its digest, and requires all downstream authority to
  remain zero.
- **Affected area:** lead qualification, contact research, owner review, dossier
  provenance, local KW evaluation, and future provider adapters.
- **Verifying commit:** branch HEAD containing ADR 0031 and migration 0067.

## DATA-009 — A discovery parent receipt was mistaken for transaction completion

- **Symptom:** a contact discovery receipt could exist while one or more contact,
  evidence-use, or verification children were absent, yet a retry might treat
  the parent as proof that the approved bundle had completed.
- **Root cause:** the discovery receipt is both a domain record and a required
  parent for child insert guards, so it must be written before those children and
  cannot also be the transaction's final completion marker.
- **Proven fix:** migration 0065 adds a separate append-only local materialization
  receipt inserted last under one SQLite `IMMEDIATE` transaction, and migration
  0066 hardens its content-derived identity and exact verification set. The executor
  re-derives the trusted plan, rejects partial or unreceipted history, and reloads
  every exact row before commit.
- **Prevention/test:** executor tests cover fresh commit, write-free replay,
  reusable evidence, stale/drifted approval, partial/unreceipted history,
  direct-SQL forgery, and rollback when the final receipt fails. The safety scan
  keeps the executor disconnected from files, runtime, providers, and outreach.
- **Affected area:** contact discovery persistence, evidence lineage,
  verification history, local KW evaluation, and future runtime adapters.
- **Verifying commit:** branch HEAD containing ADR 0030 and migrations 0065–0066.

## GEO-001 — Province leaked into unrelated searches

- **Symptom:** U.S. and western-Canada targets were queried with Ontario wording.
- **Root cause:** Geography was composed from a hardcoded province rather than a
  target's country/region/city identity.
- **Proven fix:** Carry country and region through target, job, lead, and query
  composition; cover non-Ontario examples in tests.
- **Prevention/test:** `src/lib/geo.test.ts`; every source adapter accepts a typed
  geography rather than free-form concatenation.
- **Affected area:** acquisition and coverage.
- **Verifying commit:** legacy fixes at/after `7a7e940`; v2 verification pending.

## SAFE-001 — Configuration looked enabled while the database was paused

- **Symptom:** checked-in intake/queue/send switches said true even though hidden
  database pause records were the real production stop.
- **Root cause:** multiple authorities and unsafe defaults.
- **Proven fix:** code, examples, and infrastructure default every autonomous
  switch off; all applicable gates must agree before work. The production
  inventory also corrected the legacy master database bit to `enabled=0` after a
  verified export; the old Worker remains rollback-only and is not the new source
  of configuration truth.
- **Prevention/test:** `src/lib/env.test.ts` plus `npm run check:safety`.
- **Affected area:** all automation.
- **Verifying commit:** `7afc212`; live stop and production inventory recorded in
  `4408a89`.

## SAFE-002 — A paused cron still wrote a skipped run every five minutes

- **Symptom:** no email or scrape work ran, but D1 recorded 287 `SKIPPED`
  automation runs in 24 hours and continuously refreshed the scheduler lease.
- **Root cause:** the legacy cron acquired/persisted scheduler state before
  returning at the database pause gate.
- **Proven fix:** remove all cron triggers from the rollback-only legacy Worker
  during the rebuild; checked-in default and staging crons are empty, and future
  durable schedules remain absent until their phase is explicitly approved.
- **Prevention/test:** a disabled phase has no deployed schedule; paused workflow
  tests assert zero provider calls and zero durable run/lease writes.
- **Affected area:** production safety, D1 cost/noise, observability.
- **Verifying commit:** `4408a89`; production trigger removal observed through
  the full propagation window on 2026-08-21; no-cron staging config checkpoint
  `23ee458`.

## DATA-001 — Raw SQL drifted from the live schema

- **Symptom:** unit behavior passed while production queries referenced columns or
  semantics that differed from the live D1 database.
- **Root cause:** hand-maintained SQL facade, many migrations, and no live-schema
  reconciliation gate.
- **Proven fix:** typed repositories, repeatable migration verification, a schema
  inventory, and pre-cutover count reconciliation.
- **Prevention/test:** migration checks in CI and a staging/production inventory
  step in the release runbook; query `sqlite_master`/`PRAGMA table_info` before
  writing operational SQL instead of guessing names from surrounding code.
- **Affected area:** D1, dashboard, scheduler.
- **Verifying commit:** staging inventory confirmed the singular live names on
  2026-08-22; typed v2 repository layer remains pending.

## DATA-002 — A one-row preflight hid alternate identity collisions

- **Symptom:** an idempotency preflight could return the expected primary-key row
  while a second row matched an alternate unique identity, making an ignored
  insert look safely idempotent.
- **Root cause:** the query combined primary and alternate identities with `OR`
  and `LIMIT 1`, so it never proved how many durable rows matched.
- **Proven fix:** enforce every alternate identity with a `UNIQUE` index, return
  all matching rows, and accept only zero rows or one exact expected row.
- **Prevention/test:**
  `fenced-evidence-resume-persistence-plan.test.ts` covers stored drift, a real
  alternate-key collision, and explicit multiple-match rejection; new durable
  planners must not use `LIMIT 1` for collision preflight. The older private KW
  source planner was upgraded to collision-complete v2 when this repeated there;
  `private-kw-persistence-plan.test.ts` now proves that an exact primary row plus
  a second alternate-identity match is a conflict, and the safety gate forbids
  `LIMIT 1` in that planner.
- **Affected area:** D1 idempotency, retries, imports, and workflow recovery.
- **Verifying commit:** `6d5db2b`.

## RUN-002 — Mutable snapshots were mistaken for append-only records

- **Symptom:** a valid attempt transition from `RUNNING` to `SEALED`, or a
  checkpoint transition from `PREPARED` to `COMMITTED`, would require an update
  or fail exact-preflight validation under the same stable ID.
- **Root cause:** stable identity and changing state were combined in one
  supposedly immutable row.
- **Proven fix:** store stable attempt/checkpoint identity once; represent ended
  attempts with one immutable closure and checkpoint state with constrained
  append-only receipts. Store artifact plans separately from retry receipts for
  the same reason.
- **Prevention/test:** migration 0057 unique constraints and fenced-persistence
  tests cover running-without-closure, terminal sealing order, state/retry
  identity, and exact replay.
- **Affected area:** durable workflow recovery, fencing, and artifact replay.
- **Verifying commit:** `6d5db2b`.

## DATA-003 — Historical promotion links looked like current references

- **Symptom:** one evidence use linked through qualification, outreach, and legal
  copies would make every historical manifest appear permanently active, while
  choosing only the newest/strongest copy would prevent safe fallback after a
  stronger purpose ended.
- **Root cause:** immutable promotion/use history was treated as a mutable current
  assignment instead of evaluating the full lineage, use endings, expiry, and
  verified object availability together.
- **Proven fix:** keep one immutable ending per use version and build a
  time-bounded lineage projection over an explicit use set. Require exact
  promotion-to-result links, an original write root, content-bound availability,
  and deterministic replay. A fixture assertion is never treated as a complete
  database read, so it cannot produce a zero-reference conclusion.
- **Prevention/test:** `artifact-reference-projection.test.ts` covers legal-hold
  fallback, expiry fallback, equal-rank ambiguity, no-copy self-edges, omitted
  links/ancestors, forged assignments, stale/future facts, all-ended fixture
  assertions, and zero authority. Migration/persistence tests cover exact
  replacement bundles, SQL constraints, idempotency, drift, collisions, and FKs.
- **Affected area:** evidence retention, promotion lineage, compliance review,
  and future R2 lifecycle cleanup.
- **Verifying commit:** `fb9f4dd` (hardens the initial `9681e56` slice).

## DATA-004 — A valid digest was mistaken for proof of a complete database snapshot

- **Symptom:** caller-supplied rows could be normalized and hashed into a
  schema-valid “complete” receipt even though another relevant database row was
  omitted, read at a different time, or added between read and commit.
- **Root cause:** content integrity, source completeness, transaction atomicity,
  and trusted provenance were treated as the same property. D1 Sessions provide
  sequential consistency, but that alone does not keep one interactive snapshot
  open while application code computes and later persists a projection.
- **Proven fix:** derive 15 versioned source predicates from the workflow/lineage
  root, claim a bounded database-time higher fence, freeze every scoped writer in
  D1, bind every raw row identity/count/digest, re-read and compare every source
  set while that freeze is active, atomically commit the completeness parent plus
  15 proof children, and independently reload them. Because D1 batches are not
  interactive, validation and commit are separate batches joined by database
  writer guards. A target-schema string is not proof that those guards exist, so
  the executor verifies all 51 trigger definitions before claiming trust. Pure
  validation still emits only `transactionallyTrusted=false`.
- **Prevention/test:** the safety checker keeps the executor disconnected from the
  inert Worker and all business authority false. Disposable-D1 tests cover exact
  plan reconstruction, generated SQL, all writer guards, fresh commit/replay,
  missing/duplicate sets, source drift, target collisions, child rollback, wrong
  or expired fences, active contention, forged receipt/proof digests, migration
  constraints, and the rule that structural parsing never establishes trust.
- **Affected area:** D1 reference snapshots, artifact availability, retention
  projection, retries, and any future release/deletion decision.
- **Verifying commit:** `a9da5ad` (extends `98cd88a`).

## DATA-005 — A workflow-wide artifact set was mistaken for one lineage

- **Symptom:** a valid multi-page workflow could look cyclic or disconnected
  because several independent write manifests were treated as children of one
  root, while silently selecting one root risked hiding malformed boundary rows.
- **Root cause:** source-query scope and projection-lineage scope were treated as
  identical. The source query correctly returns the whole workflow, but a
  current-reference projection follows one artifact ancestry chain.
- **Proven fix:** validate every row as a workflow forest, bind the complete
  forest digest, and then select one explicit root component while retaining the
  other root IDs. Availability receipts also bind exact observed object metadata
  so expected-key hashes cannot impersonate R2 proof.
- **Prevention/test:** the decoder integration test uses a sealed workflow with
  multiple independent roots and all 15 source sets. It rejects wrong roots,
  omitted manifest items, schema drift, missing terminal closure, and ambiguous
  availability; row reordering cannot change the decoded digest.
- **Affected area:** artifact lineage, atomic source snapshots, R2 availability,
  current-reference projection, and future retention conclusions.
- **Verifying commit:** `588926a`.

## DATA-006 — An application lock was mistaken for a database source freeze

- **Symptom:** an atomic source read could still become stale before its final
  receipt commit if one retrying, legacy, or future writer skipped the voluntary
  application fence.
- **Root cause:** the proposed safety property depended on writer cooperation.
  It also focused on one lineage root even though the query contract includes a
  whole workflow forest and recursively linked use records.
- **Proven fix:** migration 0060 makes all 15 source tables append-only and adds
  scoped D1 insert triggers that freeze the exact workflow-wide query domain
  during an active unsealed snapshot. Transaction control records are immutable,
  and provider availability must be persisted before the claim.
- **Prevention/test:** the guard contract enumerates one table per source set and
  all 51 required triggers. Integration tests reject update/delete on every
  source table and freeze direct, manifest, promotion, recursive-use, and
  availability inserts while allowing unrelated records and post-seal writes.
- **Affected area:** trusted snapshot execution, workflow retries, artifact
  lineage, evidence-use replacement, availability, and future retention logic.
- **Verifying commit:** `7d20981`.

## DATA-007 — A retention review window was mistaken for automatic object expiry

- **Symptom:** the older lineage projector required a future `expiresAt` for
  `QUALIFICATION_180D`, while availability v2 rejected that same expiry as unsafe
  for a promoted object. A complete projection failed as soon as qualification
  evidence entered the lineage.
- **Root cause:** the 180-day business retention-review policy was represented as
  if it were direct permission for storage lifecycle deletion. This drifted from
  the newer rule that promoted evidence stays protected until an explicit
  reference and release review.
- **Proven fix:** only `SHADOW_30D` carries automatic object expiry. Qualification,
  outreach, and legal-hold manifests require no automatic expiry; the lower-level
  lifecycle generator and the projection now enforce the same rule. Later
  release/deletion remains a separate zero-authority gate.
- **Prevention/test:** projection, persistence, availability-v2, trusted-adapter,
  and safety tests reject invented promoted-object expiry while preserving
  missing-object fallback and the 180-day review policy.
- **Affected area:** artifact availability, qualification retention, current-
  reference replay, future R2 lifecycle policy, and deletion safety.
- **Verifying commit:** `5508e57` (reconciles the lower-level policy after the
  initial projection fix in `9e0673b`).

## DATA-008 — Repeat audits reused evidence identities

- **Symptom:** auditing the same business again under the same audit version
  generated the same evidence-claim IDs, so an append-only database could not
  preserve both captures even when their observations or timestamps differed.
- **Root cause:** claim identity included the business, audit version, and check,
  but omitted the capture identity.
- **Proven fix:** `website-audit-deterministic-v4` derives each claim ID from a
  SHA-256 digest of business ID, audit version, capture time, and check ID.
- **Prevention/test:** repeat-capture tests require disjoint claim sets; the
  safety checker requires the v4 capture-bound hash; migration 0061 makes website
  snapshots and evidence claims append-only so accidental reuse fails closed.
- **Affected area:** website refresh, evidence history, idempotent qualification
  persistence, and owner lead audit timelines.
- **Verifying commit:** branch HEAD containing ADR 0024 and migration 0061.

## DATA-009 — Schema-valid execution JSON impersonated durable assessment proof

- **Symptom:** the assessment progress-proof builder accepted a copied or
  hand-built `RevenueLeadAssessmentD1Execution` object when its fields and
  digests were schema-valid, even though the object did not prove a current
  database reload.
- **Root cause:** data shape and content integrity were treated as transaction
  provenance. The immediate writer response was allowed to cross a process-loss
  boundary that should require fresh durable evidence.
- **Proven fix:** load by exact assessment ID/digest, verify all eight
  migration-0061 immutable triggers, rebuild the assessment from the durable
  sealed workflow source and business, exactly reload every derived row, and
  classify freshness from D1 time. Deep-freeze and register the result in a
  module-private `WeakSet`; only the exact `CURRENT` object can feed proof.
- **Prevention/test:** adversarial tests reject clones, missing guards, row
  drift, source drift, and stale database time. The safety checker forbids the
  proof builder from importing the schema-valid writer-execution contract or a
  caller-owned proof time.
- **Affected area:** shadow assessment persistence, interrupted-task recovery,
  assessment progress proof, and every future `ASSESSMENT` phase-input/append
  boundary.
- **Verifying commit:** branch HEAD containing ADR 0038.

## AI-001 — Provider/model documentation drift

- **Symptom:** runtime used DeepSeek while setup documentation named Gemini; the
  default DeepSeek alias later became deprecated.
- **Root cause:** provider details spread across implementation, examples, and UI.
- **Proven fix:** one provider contract, pinned model snapshots, schema validation,
  and evaluation-gated upgrades.
- **Prevention/test:** provider contract tests assert endpoint, model, structured
  output, usage, and fail-closed parsing.
- **Affected area:** extraction, audit, ranking, drafting.
- **Verifying commit:** `7afc212`.

## RUN-001 — Cron self-dispatch hid CPU-bound orchestration

- **Symptom:** one scheduled invocation exceeded Worker CPU limits, then self-fetch
  was used to obtain multiple request budgets.
- **Root cause:** long multi-step work lived inside the web Worker scheduler.
- **Proven fix:** move new durable chains to Workflows and bounded fan-out to
  Queues; retain self-dispatch only as temporary legacy behavior.
- **Prevention/test:** retry/idempotency/deployment-interruption tests; no new
  long-running work in `worker.mjs` or the legacy automation file.
- **Affected area:** runtime orchestration.
- **Verifying commit:** pending engine Worker.

## SOURCE-001 — Google Maps DOM selectors were brittle

- **Symptom:** consent screens, markup changes, infinite scroll, and timeouts caused
  high scrape failure and repeated recovery work.
- **Root cause:** primary discovery depended on consumer-page DOM markup.
- **Proven fix:** a source adapter backed by a supported data API for discovery;
  Browser Rendering focuses on public business websites and evidence.
- **Prevention/test:** adapter contract fixtures, provider-failure tests, coverage
  yield tracking, and a <5% provider-failure gate.
- **Affected area:** discovery.
- **Verifying commit:** pending Outscraper adapter.

## DOC-001 — Bootstrap instructions referenced `the-omniscient`

- **Symptom:** a fresh task could clone or describe the wrong repository.
- **Root cause:** stale generated bootstrap documentation was not part of release
  verification.
- **Proven fix:** repository-first resume contract and current README/STATUS.
- **Prevention/test:** naming scan in `npm run check:safety`.
- **Affected area:** agent continuity.
- **Verifying commit:** `7afc212`.

## QUAL-001 — Email availability was confused with lead quality

- **Symptom:** commercially strong businesses were downgraded or discarded when no
  usable email was found, while generic mailboxes could make weak leads look ready.
- **Root cause:** one blended score and an email-first pipeline.
- **Proven fix:** independent business-fit, rebuild-need, reachability, timing, and
  evidence-confidence scores plus a separate channel route.
- **Prevention/test:** qualification tests show identical account value regardless
  of email and route strong no-email accounts to a manual channel.
- **Affected area:** qualification and UI.
- **Verifying commit:** foundation began at `d5f0e52`; v3 gates pending.

## BUILD-006 — Development chunk rewrites can truncate browser scripts

- **Symptom:** the authenticated owner UI rendered normally and local requests
  returned 200, but Playwright intermittently reported an empty error or
  `SyntaxError: Invalid or unexpected token` during navigation. A client-side
  route could also render its complete dossier before Next applied the route's
  document title, producing a transient empty-title assertion.
- **Root cause:** Next's first streamed SSR page can request a shared development
  chunk while on-demand compilation rewrites that file in place. An external
  filesystem/HTTP trace proved a 3,138,186-byte `app/layout.js` read overlapped a
  same-inode rewrite and ended after 1,179,648 bytes. Compression removed the
  original Content-Length, so the server completed a valid gzip/200 response
  containing truncated JavaScript. The captured browser script matched that
  prefix exactly. This occurred with fresh `.next` assets and no concurrent
  build. The longer M2 run reproduced this after warmup: Chromium captured an
  exact 327,680-byte prefix of the same 3,138,186-byte layout chunk during mobile
  navigation. Initial warmup alone does not protect later development page
  eviction/recompilation. Separate Next/OpenNext builds sharing `.next` remain
  another hazard.
- **Proven fix:** let every Next/OpenNext/Cloudflare build and dry run exit before
  starting `npm run test:owner-ui`. The current gate requires the completed
  production `.next/BUILD_ID` and serves it with `next start`, preserving immutable
  built assets throughout the longer workflow. It never clears that build or
  starts a development compiler. First fetch
  and fully consume all authenticated owner routes through local HTTP,
  with no browser reading their scripts. Then warm those routes in a disposable
  browser page, awaiting `load` before each next navigation; SSR headings alone
  do not establish async script completion. Close it and use a fresh page for
  timed/error-audited acceptance. Preserve detailed page-error
  name/message/stack diagnostics; do not suppress syntax errors or blank errors.
  Wait up to five seconds for each exact route title after visible readiness;
  this allows asynchronous metadata application without weakening the expected
  title.
  With the earlier three-route warmup correction, the external trace recorded four layout rewrites before
  the first browser read and eight complete 3,138,186-byte reads, without overlap.
  Waiting for browser `load` alone passed but still allowed a rewrite/read overlap;
  both the HTTP preparation and browser load barrier were required. Production
  assets now remove the later eviction/rewrite path as well.
- **Prevention/test:** `AGENTS.md` forbids concurrent execution, and the owner UI
  acceptance command requires the completed build, prepares and
  warms every measured route, waits for exact titles, and checks eight fresh-page
  views. `owner-ui-warmup-streaming.acceptance.ts` serves delayed async scripts
  over loopback and executes the actual warmup function. It failed on both early
  navigations with the former DOMContentLoaded behavior, then passed with the
  load barrier. It separately requires all three HTTP preparations before the
  first browser script request. It runs inside every owner UI acceptance invocation.
  Chromium parser/runtime attribution now retains the exact failing source as
  `.js.txt`, script location and event-time stage. Its tests cover delayed source
  capture, attribution and unavailable-source errors. Existing uncaught browser
  errors continue to fail acceptance.
  GitHub CI and every local release cycle run the commands sequentially.
- **Affected area:** owner UI acceptance, Next.js development server, OpenNext,
  Wrangler dry runs, Windows/OneDrive workspaces, and local release evidence.
- **Verifying commit:** `ce13dd7`, with production assets, eight-view browser
  acceptance, the streaming regression and all required checks passing.
  `878d0ff` introduced the earlier six-view warmup correction; `6aaf216`
  introduced the source attribution used to diagnose the failure.

## BUILD-001 — Local success did not equal Linux/Cloudflare success

- **Symptom:** OpenNext emitted a Windows warning and generated duplicate-key
  warnings even when tests passed.
- **Root cause:** local Windows was the only release surface.
- **Proven fix:** Linux GitHub Actions runs build and Wrangler dry run.
- **Prevention/test:** required CI gate before production approval.
- **Affected area:** build/deployment.
- **Verifying commit:** workflow added in `7afc212`; clean Linux run
  `32547238706` passed at `6a03de6`.

## UI-001 — “Healthy” UI was not backed by business or runtime proof

- **Symptom:** attractive status surfaces implied health while replies, workflow,
  mailbox, or business outcomes were unknown.
- **Root cause:** hardcoded labels and vanity metrics.
- **Proven fix:** only show a health/lead state from explicit checks and
  freshness; otherwise show refresh, research, blocked, or the exact problem.
  The owner lead projection recomputes current qualification and preserves
  non-email lead value instead of ranking record/email counts.
- **Prevention/test:** projection/read-model tests cover stale/future facts,
  score/snapshot drift, invalid rows, route quality, and zero authority. The
  owner list has fixture-rendered semantic/content tests and safety-source
  guards. `npm run test:owner-ui` now exercises authenticated list/detail flows,
  exact route identities, WCAG AA, keyboard focus, reduced motion, desktop/mobile
  layout, read-only controls, and owner discoverability budgets in isolated
  Chromium; CI installs the pinned browser and runs the same gate.
- **Affected area:** Today, Leads, System, navigation, and owner read APIs.
- **Verifying commit:** owner read-model source `bf0c2c4`; first owner Leads
  workspace `5e273fa`.

## UI-002 — A fixed mobile navigation could make an essential action untestable

- **Symptom:** the mobile Leads view visibly rendered the evidence-dossier link,
  but an automated pointer action stayed on `/leads` until its route assertion
  timed out.
- **Root cause:** scrolling a far-down action only “into view” does not prove its
  actual click target is clear of a fixed bottom navigation layer. Locator click
  actionability can also perform its own last-moment scroll after a geometry
  check. A raw coordinate avoids that second scroll, but the long mobile card can
  still finish a layout frame after the coordinate is measured. In both cases,
  the pointer can land on the current `/leads` page even though the earlier
  rectangle was clear. Browser actionability, visual presence, and a one-frame
  coordinate were all too weak for this owner task.
- **Proven fix:** center the dossier action in the mobile viewport, measure its
  rectangle against the fixed primary navigation, verify its exact destination,
  require its rectangle to remain unchanged across five animation frames, prove
  `elementFromPoint` at the link centre belongs to that anchor, and click that
  stable, already-proven coordinate without allowing another locator auto-scroll.
  Start the exact-URL wait before the pointer click and include the failing stage
  plus current URL in diagnostics.
- **Prevention/test:** `npm run test:owner-ui` now proves the unobscured mobile
  stable pointer target and exact navigation as part of all six desktop/mobile
  owner views. The one-frame coordinate failure was reproduced twice; two
  consecutive stability-bound post-fix runs passed.
- **Affected area:** mobile Leads owner task, fixed primary navigation, and
  Playwright release acceptance.
- **Verifying commit:** branch HEAD containing ADR 0035 and the coordinate-bound
  mobile owner UI gate; earlier geometry work began with the assessment-progress
  proof checkpoint.

## TYPE-001 — Hand-written Cloudflare bindings hid unsafe assumptions

- **Symptom:** generated runtime types made previously passing code fail because
  response JSON was implicitly trusted and test env values inherited production
  string literals.
- **Root cause:** a small hand-maintained `cloudflare-env.d.ts` drifted from the
  actual Worker runtime and compatibility date.
- **Proven fix:** generate bindings with Wrangler, explicitly narrow JSON at each
  client boundary, and use a mutable test-only process-env view.
- **Prevention/test:** CI regenerates `cloudflare-env.d.ts`, rejects a diff, then
  runs typecheck and the Cloudflare build.
- **Affected area:** environment bindings, client APIs, CI.
- **Verifying commit:** `7afc212`; staging environment refresh `e68ac40`.

## BUILD-002 — CI runtime lagged behind Wrangler's Node requirement

- **Symptom:** Linux CI stopped at `wrangler types` before migrations or tests.
- **Root cause:** both GitHub workflows pinned Node 20 while Wrangler 4.123.0
  declares Node >=22.
- **Proven fix:** run CI and protected deployment on Node 22 and declare the same
  minimum in the root package.
- **Prevention/test:** dependency installation plus generated-binding verification
  run before the rest of every Linux gate.
- **Affected area:** CI, Cloudflare tooling, release workflow.
- **Verifying commit:** `14d85a0`; confirmed by clean Linux run `32547238706`.

## TYPE-002 — Generated bindings absorbed a local secret name

- **Symptom:** bindings regenerated cleanly on Riley's machine but failed the CI
  diff because only local `.env.local` contained `OPENAI_API_KEY`; the first
  engine-local runtime also inherited that unrelated secret name.
- **Root cause:** Wrangler type generation was allowed to discover private local
  environment files, making generated output machine-dependent.
- **Proven fix:** generate/check with an explicit tracked empty env file, declare
  an empty `secrets.required` allow-list on the inert engine, and keep secret
  *names* in a value-free declaration separate from generated bindings.
- **Prevention/test:** console and engine type generation use
  `wrangler.typegen.env`; `npm run cf:engine:dev` uses the same file; the safety
  check requires the empty engine secret allow-list.
- **Affected area:** generated bindings, secrets, CI reproducibility.
- **Verifying commit:** `6a03de6`; clean Linux run `32547238706`; separate engine
  enforcement in `5d3ef6a`.

## BUILD-005 — A new compatibility date exceeded the pinned local runtime

- **Symptom:** the new engine passed a Wrangler dry bundle but `wrangler dev`
  could not start because compatibility date `2026-08-22` was newer than the
  bundled workerd runtime's `2026-08-18` maximum.
- **Root cause:** the project pinned Wrangler 4.123.0 while the new Worker
  correctly selected the current compatibility date.
- **Proven fix:** pin Wrangler 4.125.0, regenerate both binding files, and prove
  the local engine starts and returns the locked health response.
- **Prevention/test:** keep Wrangler exact, regenerate types with dependency
  upgrades, run both Cloudflare dry builds in CI, and locally exercise `/health`
  when advancing a compatibility date.
- **Affected area:** Cloudflare local runtime, generated types, CI.
- **Verifying commit:** `5d3ef6a`.

## BUILD-003 — One branch push launched the same CI twice

- **Symptom:** pushing a PR branch launched both `push` and `pull_request` runs,
  doubling builds, minutes, and noise.
- **Root cause:** CI listened to every rebuild-branch push as well as every PR.
- **Proven fix:** run branch validation through `pull_request` and reserve `push`
  validation for `main`; avoid a third explicit build because the Wrangler type
  check already executes OpenNext.
- **Prevention/test:** inspect workflow triggers and steps whenever a new release
  gate is added.
- **Affected area:** GitHub Actions cost and feedback time.
- **Verifying commit:** `6a03de6` produced one PR run and no duplicate push run.

## BUILD-004 — OpenNext compiled local secrets into its runtime environment file

- **Symptom:** the first staging pre-deploy inspection found the local OpenAI key
  value inside `.open-next/cloudflare/next-env.mjs` even though `.env.local` was
  ignored by Git.
- **Root cause:** OpenNext intentionally compiles values from Next.js `.env*`
  files into a runtime fallback module. Git ignore rules do not affect build
  output.
- **Proven fix:** every Cloudflare build replaces the compiled fallback with empty
  environments, then scans the entire generated bundle for sensitive source
  values and recognizable secret material before Wrangler can upload it.
- **Prevention/test:** `scripts/sanitize-cloudflare-bundle.test.mjs`; the safety
  configuration requires the sanitizer in `build:cloudflare`; provider secrets
  are set in Cloudflare's secret store instead of supplied by local build files.
- **Affected area:** all Cloudflare builds, previews, dry runs, and deployments.
- **Verifying commit:** `ab5621c`.

## DEPLOY-001 — Required reviewers are unavailable on this private repo plan

- **Symptom:** GitHub returned 422 when creating an environment reviewer rule,
  even with an empty reviewer list.
- **Root cause:** GitHub's current Free/Pro/Team environment reviewer protection
  is limited to public repositories; this repository is correctly private.
- **Proven fix:** create the `production` environment with a custom `main` branch
  policy and keep the exact release SHA, backup reference, typed approval phrase,
  and absent-by-default deployment credentials as the no-cost release gates.
- **Prevention/test:** audit the environment and secret names read-only before a
  release; never weaken repository privacy to gain a reviewer button.
- **Affected area:** GitHub Actions and production approval.
- **Verifying commit:** `4408a89`; environment configured 2026-08-21.

## DEPLOY-002 — Manual release inputs were treated as trusted shell text

- **Symptom:** a branch name or abbreviated commit could be supplied as the
  release target, and workflow inputs were interpolated directly into shell code.
- **Root cause:** the workflow asked for approval evidence but did not validate
  its structure, exact checkout, or relationship to `main`.
- **Proven fix:** validate a 40-character SHA and structured D1 checksum reference,
  pass inputs through environment variables, verify exact checkout, and require
  the release commit to be an ancestor of `origin/main`.
- **Prevention/test:** `scripts/validate-release-inputs.test.mjs`; production
  environment remains limited to `main` and credentials remain absent by default.
- **Affected area:** production release integrity and workflow injection safety.
- **Verifying commit:** `23ee458`.
