# Gotcha ledger

A gotcha is a proven failure pattern that could recur. Add only after evidence.
Include symptom, root cause, proven fix, prevention/test, affected area, and the
verifying commit. Promote a repeated gotcha into an automated test or `AGENTS.md`.
Retire entries when the architecture makes them impossible.

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
  planners must not use `LIMIT 1` for collision preflight.
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
  root, claim a bounded strictly higher fence, bind every raw row identity/count/
  digest, and require atomic recheck, insert, post-verification, and committed-row
  reload. Pure validation code emits only `transactionallyTrusted=false` and
  cannot mint a completeness receipt.
- **Prevention/test:** the safety checker locks receipt creation and execution
  off. Atomic-reference tests cover immutable query drift, generated SQL,
  missing/duplicate sets, wrong or expired fences, active-lease contention,
  exact-expiry takeover, forged receipt digests, migration constraints, and the
  rule that structural receipt parsing never establishes trust.
- **Affected area:** D1 reference snapshots, artifact availability, retention
  projection, retries, and any future release/deletion decision.
- **Verifying commit:** `98cd88a`.

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
- **Proven fix:** only show a health state from explicit checks and freshness;
  otherwise show “unknown” or the exact problem.
- **Prevention/test:** owner-flow and data-accuracy tests.
- **Affected area:** Today/System/navigation.
- **Verifying commit:** pending owner-first UI slice.

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
