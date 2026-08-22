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
  switch off; all applicable gates must agree before work.
- **Prevention/test:** `src/lib/env.test.ts` plus `npm run check:safety`.
- **Affected area:** all automation.
- **Verifying commit:** `7afc212`.

## DATA-001 — Raw SQL drifted from the live schema

- **Symptom:** unit behavior passed while production queries referenced columns or
  semantics that differed from the live D1 database.
- **Root cause:** hand-maintained SQL facade, many migrations, and no live-schema
  reconciliation gate.
- **Proven fix:** typed repositories, repeatable migration verification, a schema
  inventory, and pre-cutover count reconciliation.
- **Prevention/test:** migration checks in CI and a staging/production inventory
  step in the release runbook.
- **Affected area:** D1, dashboard, scheduler.
- **Verifying commit:** pending v2 repository layer.

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
- **Verifying commit:** workflow added in `7afc212`; Linux CI result pending.

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
- **Verifying commit:** `7afc212`.
