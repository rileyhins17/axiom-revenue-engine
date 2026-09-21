# Revenue Engine code reality audit

**Date:** 2026-09-20 (America/Toronto)
**Scope:** read-only code/data-flow audit for the master-plan rebuild.
**Snapshot:** branch `RileyHinsperger/axiom-revenue-engine-rebuild`, HEAD `02e0c5a3ef69fe004d8ab7aab1314f0021f07f33`. The two pre-existing untracked files `src/lib/revenue-engine/private-kw-assessment-progress.ts` and `.test.ts` were preserved. No tests, builds, deploys, provider calls, or secret reads were performed. Repository STATUS/README claims were treated as historical or repository-reported unless confirmed by source.

## Executive finding

APE is two systems sharing a console and migrations. The legacy system has the only complete operational path: scrape jobs and agent routes write legacy `Lead` records; `src/lib/auto-pipeline.ts` enriches, qualifies, and queues them; `src/lib/outreach-automation.ts` schedules/sends through `src/lib/gmail.ts`, syncs replies, and updates funnel/CRM state. The rebuild is a strong evidence and provenance kernel, but its real-business path stops before live discovery, website capture, contact providers, assessment execution, queues, and sends. The current “vertical slice” is therefore owner read-only presentation over data that must be prepared through guarded local fixture/SQLite commands; it is not an end-to-end acquisition loop.

## Verified code map

Discovery/intake: legacy `src/lib/autonomous-intake.ts:77` dispatches `ScrapeJob` from `ScrapeTarget` after `evaluateAutomationSafety`; `src/lib/cloud-scrape-worker.ts` and `src/lib/scrape-engine.ts` process events and persist legacy leads through `scrape-lead-persistence.ts`. New contracts in `src/engine/adapters.ts:43` (`SourceAdapter`, `AuditAdapter`, `WebsiteCaptureAdapter`, `ContactAdapter`, `VerificationAdapter`, `MailboxAdapter`) have no concrete runtime implementations or Worker imports.

Audit/evidence: `src/lib/revenue-engine/website-capture.ts:206` has bounded public HTTP capture with injected transport; `html-page-facts.ts`, `website-page-selection.ts`, `browser-measurement-adapter.ts`, `content-addressed-artifact-store.ts`, and `website-audit-assembly.ts` are fixture/provider-free boundaries. `fixture-website-evidence-workflow.ts:404` composes eight receipts but requires fixture dependencies and zero provider operations. No `BROWSER`/R2 path is attached to `src/engine/worker.ts`.

Qualification/assessment: `qualification.ts` is deterministic and shadow-only, preserving five dimensions and separate route selection. `lead-assessment.ts` binds source, website, evidence, and qualification identities; `lead-assessment-d1.ts:562` can execute an injected D1 batch and `:154` trusts only the exact durable reload object. The assessment writer and migrations 0054–0068 are tested against disposable SQLite/D1-like fixtures, but no remote migration or operator route exists. The next documented gate is the zero-authority `ASSESSMENT` phase-input adapter.

Contacts/outreach: `contact-discovery.ts` and `contact-verification.ts` strictly separate evidence candidates from deliverability/availability; `contact-persistence-plan.ts` and private-KW scripts generate/execute append-only local bundles under explicit approvals. The new contracts cannot call providers or grant consent/send authority. Legacy `lead-qualification.ts`, `axiom-scoring.ts`, `outreach-automation.ts`, and `gmail.ts` remain separate and use different records/policies.

Provider/credentials: `src/lib/revenue-engine/ai/types.ts:45` exposes only `AIProvider.generateStructured`, with provider literal `openai`; `ai/openai-responses.ts:101` requires `OPENAI_API_KEY`, pins nano/mini model snapshots, retries up to two attempts, and estimates cost from a local price table. There is no Jev adapter, no live Revenue Engine provider caller, and the user has no OpenAI API key. `.env.example` makes OpenAI optional, while `src/lib/env.ts:52` accepts it but does not create a budget reservation.

Workflow/runtime: `src/engine/worker.ts:21` validates immutable SHADOW input and returns `HALTED/scaffold_locked`; `wrangler.engine.jsonc` declares only an inert two-step Workflow with no queue, schedule, D1, R2, Browser, or secret. The console `wrangler.jsonc` still binds legacy D1/Browser, but new Revenue Engine readers are only reached through authenticated Next routes.

Owner/UI/export: `/api/v1/leads` and `/api/v1/leads/[businessId]` call SELECT-only `owner-lead-read-model.ts` and `owner-lead-detail-read-model.ts`; `/leads` and `/leads/evaluation` provide read/review/download flows. The owner read model is bounded to 100 businesses and returns explicit authority false/zero. `/api/leads/export` and `src/lib/export/{csv.ts,export-presets.ts}` export legacy Prisma `Lead` rows, not the new v2 evidence dossier. CRM pages/routes use legacy `Lead`, `Client`, activities, and emails.

## Ten critique findings

1. **No end-to-end new pipeline.** There is no runtime path from source discovery to `RevenueBusiness` to website capture to assessment. The highest-value next milestone must connect one bounded local/synthetic path before adding more provenance layers.

2. **Worker is deliberately inert.** `src/engine/worker.ts` cannot advance any receipt. STATUS’s many “checkpoint” claims describe source/fixture proof, not deployed runtime readiness.

3. **Real source evidence is absent.** Private-KW manifests and commands are ignored-local and no-overwrite; ADR 0032 still leaves ten real reviewed records pending. Do not infer a 10/50 evaluation from synthetic fixtures.

4. **Browser/R2 are contracts, not capabilities.** Capture, artifact, availability, and lifecycle modules enforce zero cost and fixture kinds. Activating R2 requires the separate runbook, approval phrase, pricing capture, rollback, and synthetic smoke.

5. **Assessment persistence is overbuilt relative to execution.** Append-only triggers, sealed workflow forests, current-reference projections, durable reloads, and 0068 eligibility protections are valuable once real execution exists, but currently increase review surface without producing a usable lead. Freeze further provenance expansion until one end-to-end shadow record flows through it.

6. **Contact path stops at local fixtures.** Discovery/verification schemas are excellent safety seams, but no live provider or real website/contact source can populate them. Any owner dossier contact proof remains research/manual until a reviewed provider milestone.

7. **Provider assumptions are disconnected.** The OpenAI adapter is testable but not callable without a key; it is not imported by the engine Worker. Existing local cost estimation is not a monthly ledger, reservation, or crash-safe settlement.

8. **Budget enforcement is mostly a future contract.** Migration 0054 contains `RevenueCostLedger`, but source search found no operational reservation/settlement service. New modules hard-code zero cost; legacy limits (`OUTREACH_DAILY_SEND_LIMIT`, autonomous caps) are not a unified C$50 ceiling. Unknown provider price/FX/usage can therefore evade a true cross-provider budget unless a minimal pilot ledger precedes paid inference.

9. **Legacy send failure risk remains material.** `outreach-automation.ts:2072` can create sequences and `:3807` sends via Gmail; reply sync also calls Gmail. Environment defaults disable autonomy (`wrangler.jsonc:52–57`), but routes and manual operations remain stateful legacy paths with records separate from the v2 dossier. No OpenAI key does not protect against Gmail sends.

10. **Testing proves contracts, not production behavior.** The many `src/lib/revenue-engine/*.test.ts` files use fake transports and disposable databases; owner UI acceptance uses synthetic state. This is appropriate, but reports must label fixture, local SQLite, CI, staging, and production evidence separately. Required release commands in `AGENTS.md` have not been run in this audit.

## Minimal next slice and dependency graph

```text
review exact synthetic/approved 10-business input
  -> one local source/workflow materialization
  -> one bounded website-evidence workflow
  -> one assessment D1 batch + exact durable reload
  -> one read-only dossier/comparison artifact
  -> owner labels and report
  -> only then contact discovery/verification fixture comparison
```

Implement only the missing `ASSESSMENT` phase-input adapter and a single local command that consumes the current trusted website-evidence and assessment reload proofs. Reuse `private-kw-source-workflow-materialization.ts`, `private-kw-assessment-invocation.ts`, `lead-assessment-d1.ts`, `private-kw-assessment-progress-proof.ts`, and the owner dossier. Do not add live Browser/R2, Jev/OpenAI, remote migrations, CRM writes, or outreach in this milestone. Its exit gate is one exact business with a reproducible current assessment visible in the dossier and a report proving zero provider/send/cost authority.

After that gate, the next smallest useful milestone is a fixture-only comparison: deterministic assessment versus a separately typed advisory decision provider, with bounded evidence packet, cache identity, minimal reservation ledger, fake failures/timeouts, and 10-case report. The fixed 50-business cohort follows only after the ten-case lineage and cost mechanics pass; owner labels remain independent and tuning/holdout is frozen.

## Reuse, defer, retire

Reuse the evidence schemas, public-URL guards, deterministic audit, content-addressed identities, append-only D1 plans, owner read models, and fixture test helpers. Defer deeper artifact retention/projection, production Worker wiring, R2, Browser, live source/contact providers, Jev/OpenAI runtime, and CRM/reply unification until the minimal slice proves value. Retire or quarantine legacy autonomous intake only after shadow reconciliation and a 30-day rollback window; do not delete legacy tables or routes in this cycle. Keep legacy outreach available only behind existing explicit emergency/approval gates.

## Owner and release implications

The owner benefit is a trustworthy “why this lead” dossier and a bounded review queue, not more tables. Track exact business count, current assessment reload success, evidence completeness, owner minutes/lead, label agreement, false-negative review, provider attempts, cache hits, reserved/settled/ambiguous cost, and C$50 headroom. No staging or production claim is current without live read-only verification. Before any future checkpoint, run `npm run check:safety`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:cloudflare`, `npx wrangler deploy --env="" --dry-run --autoconfig false`, then `npm run test:owner-ui` last; this audit intentionally ran none.

## Verification finding — 2026-09-20

The recorded verification run reports safety exit 0, tests exit 1, and typecheck exit 0 (`data/planning-audit-2026-09-20/verification.json`). `tests.log` reports **466 passing and 22 failing tests**; its 45 `✖` markers are duplicated per-test/result-summary output, not 45 distinct failures. All 22 failures originate in the tracked `src/lib/revenue-engine/artifact-reference-d1-source-decoder.test.ts` fixture and fail before the intended assertions with the same Zod error from tracked `src/lib/revenue-engine/artifact-manifest-availability.ts:157`: `expiresAt` must be later than `checkedAt`.

The direct cause is clock-sensitive fixture data at test line 544: for every `SHADOW_30D` manifest, `expiresAt` is hard-coded to `2026-09-20T00:00:00.000Z`, while `currentSnapshotTiming()` at lines 700–709 derives `checkedAt` from the actual clock. The run occurred after that UTC expiry, so current-time tests fail during fixture construction; the failures are unrelated to the docs/status edits and unrelated to the two pre-existing untracked assessment-progress files. The plausible repair milestone is a focused test-fixture clock/expiry stabilization change: inject one fixed `now` into all timing builders or derive fixture expiry from supplied timing, while retaining separate explicit expired-history cases. Re-run the decoder file first, then the full test gate; do not weaken production expiry validation or simply advance a hard-coded date.

## Verification finding — 2026-09-20 owner UI acceptance

The saved `data/planning-audit-2026-09-20/owner-ui.log` proves `npm run test:owner-ui` failed during `owner route warmup`: after successful `/leads`, dossier, and `/leads/evaluation` HTTP responses (all 200 in `output/playwright/owner-ui-2628-1789960246373/next-server.log`), Playwright timed out after 30 seconds waiting for `[data-quality-lab-ready='true']`. The current script waits for this marker at `scripts/verify-owner-ui-acceptance.ts:828-829`; the component renders it as `clientReady ? "true" : "false"` and sets `clientReady` only in a browser `useEffect` (`src/components/leads/owner-lead-evaluation-workspace.tsx:72-91,229`). Thus the proven failure is post-response readiness/hydration/effect completion, not route compilation or an HTTP 5xx. The warmup page has no console/page-error listeners, and the saved server log contains no browser diagnostic, so the exact client-side cause is currently unproven. The artifact contains only the server log and fixture database; no screenshot or browser error was saved. The earlier expired `SHADOW_30D` decoder fixture failures are not evidenced as causal here: this warmup does not load the evaluation checkpoint, and the readiness marker is clock-independent. Repair should first add diagnostic capture or reproduce under the existing script, then stabilize the readiness assertion; no source fix was made in this audit.
