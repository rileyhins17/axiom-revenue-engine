# Jev Revenue Engine Integration Plan

> **Superseded sequencing, 2026-09-20:** retain this as a researched optional
> experiment backlog. [Master Plan v2](../../MASTER_PLAN.md) and
> [DELIVERY_PLAN](../../DELIVERY_PLAN.md) are authoritative: complete the evidence
> path and M3 quality evaluation before deciding whether Jev is useful. This
> document is not the next implementation task and grants no execution. OpenAI
> is not provisioned; the baseline is deterministic results and owner review.
> Its older cost/pilot details must be reconciled with
> [PROVIDER_AND_BUDGET_PLAN](../../PROVIDER_AND_BUDGET_PLAN.md) before execution.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an off-by-default, fixture-first Jev advisory path for narrow semantic business/service-fit and research-triage decisions, while preserving APE’s evidence, qualification, approval, and budget contracts.

**Architecture:** Add a separate `DecisionProvider.evaluate` abstraction beside the existing `AIProvider.generateStructured`; Jev’s typed Choice/Score/Noul API is not arbitrary JSON generation and must not be forced through the OpenAI provider interface. Feed Jev only a bounded, canonical evidence packet, cache only validated results keyed to exact evidence and rubric versions, and return advisory output to comparison/reporting surfaces. Deterministic gates, five qualification dimensions, owner labels, consent, verification, outreach, and send authority remain independent.

**Tech Stack:** TypeScript, Zod, native `fetch`/`AbortController`, Cloudflare-compatible adapters, existing `tsx --test` tests, local fake provider/storage, SHA-256 canonical digests.

**Spec:** `docs/research/2026-09-20-jev-integration-spec.md` (with `2026-09-20-jev-provider-research.md`, `2026-09-20-jev-economics.md`, and `2026-09-20-ape-integration-audit.md`).

## Global Constraints

- **Owner correction (2026-09-20): Riley does not have OpenAI API keys.** The OpenAI adapter and model IDs are code/planned architecture only, not an available service or measured operating baseline. V1 must work without OpenAI credentials: compare deterministic results and owner labels with fixtures, then with Jev only if separately activated. Ambiguous cases go to owner review. A live nano/mini comparison or fallback is optional future provider onboarding, requiring its own credentials, billing decision, and authorization. The hypothetical nano cost table is not current spend or realized savings.
- Keep Jev shadow-only and off by default; no production provider route, migration, send, or qualification-policy change in this plan.
- Pin `jev-1.13.0`; never use `jev-latest` for an evaluated result. Log the response model.
- Use only validated evidence identifiers and existing observations; Jev may not invent factual observations, evidence, consent, verification, eligibility, or outreach authority.
- Preserve all five independent qualification scores and thresholds; Jev is advisory triage, not a replacement score or probability of sale.
- Missing, stale, contradictory, incomplete, or out-of-domain evidence yields `UNKNOWN`/review, never a negative fact or automatic rejection.
- Reserve worst-case attempt/fallback cost before dispatch; settle confirmed usage; retain conservative reservations after ambiguous timeout/crash.
- Deny unknown price, stale FX/configuration, missing ledger, missing cache identity, or exhausted budget. No automatic top-up or recharge.
- Keep the total runtime ceiling at C$50/month; propose at most C$1/month Jev allocation inside the existing AI envelope, never as an extra budget.
- Do not send whole HTML, screenshots, secrets, personal inboxes, or full CRM records; strip scraped instructions and treat source text as untrusted.
- First evaluation uses the existing ten-business shadow slice for pipeline correctness, then the fixed 50-business owner-labelled cohort with frozen stratified tuning/holdout partitions.
- The existing >=85% agreement gate is acceptance evidence, not calibrated probability or generalization proof; report uncertainty and false negatives.

## Review Focus

- **Evidence drift:** changed digest/freshness must invalidate cache and prevent reuse; test in Task 3.
- **Provider ambiguity:** 401/422/429/529, malformed answers, missing model, and unknown usage must fail closed; test in Task 2.
- **Crash billing:** timeout after dispatch must preserve a reservation and require reconciliation; test in Task 4.
- **Semantic abstention:** contradictions, incomplete coverage, and out-of-domain state must return review/unknown without rejecting a lead; test in Task 2.
- **Evaluation leakage:** owner labels must not tune prompts or thresholds across frozen holdout boundaries; test in Task 5.

## File Map Before Implementation

Create `src/lib/revenue-engine/decisions/types.ts` for versioned Jev-neutral decision questions, bounded evidence packets, validated advisory answers, and `DecisionProvider`. Create `src/lib/revenue-engine/decisions/jev.ts` for the native HTTP adapter and response validation. Create `src/lib/revenue-engine/decisions/evidence-packet.ts` for deterministic minimization and digests. Create `src/lib/revenue-engine/decisions/cache.ts` and `budget-ledger.ts` for exact-result reuse and reservations. Create fixture tests beside each module and a local evaluation runner under `scripts/evaluate-jev-shadow.ts` with tests. Modify `src/lib/revenue-engine/ai/` only to leave `AIProvider` and OpenAI callers intact; do not alter `qualification.ts`, `lead-assessment.ts`, or stage-gate contracts. Add only documentation/status after implementation gates pass.

### Task 1: Define the decision contract and bounded evidence packet

**Files:** Create `src/lib/revenue-engine/decisions/types.ts`, `evidence-packet.ts`, and their tests.

**Interfaces:** `DecisionProvider.evaluate(input: DecisionRequest): Promise<DecisionResult>`; `DecisionRequest` contains `requestId`, `decisionVersion`, `questionSetVersion`, `model`, `evidenceDigest`, `state`, `limits`, `mode: "OFFLINE_FIXTURE" | "APPROVED_NETWORK"`, and immutable authority fields. Define `DecisionResult` as a discriminated union with `status: "VALID" | "ABSTAINED"`, `advisoryOnly: true`, provider/model, strict answers or an abstention reason, usage, request/evidence/rubric digests, and no mutation authority. Fixture mode has zero provider operations; network mode requires an approved reservation.

- [ ] Write failing `node:test` assertions for canonical request IDs, pinned model, an 8 KB UTF-8 serialized request cap including all question text, conservative 8,192-token reservation (never infer tokens as bytes/4), exact evidence identifiers, strict Choice answers, explicit `UNKNOWN`, and authority literals. Define V1 rubrics: `fit` (`STRONG_FIT|REVIEW|OUT_OF_SCOPE|UNKNOWN`), `triage` (`PRIORITIZE_RESEARCH|REQUEST_EVIDENCE|DEFER|UNKNOWN`), and `uncertainty` (`SUFFICIENT|CONTRADICTORY|INCOMPLETE|OUT_OF_DOMAIN`).
- [ ] Implement canonical JSON and SHA-256 helpers. Build `buildBusinessFitPacket(assessment, evidenceClaims)` selecting only existing claim IDs, URLs, capture times, methods, confidence, audit version, business/niche/service context, and no raw unbounded HTML.
- [ ] Reject cross-business claims, stale evidence, duplicate IDs, private URLs, unsupported methods, future timestamps, and malformed digests. Mark known prompt-injection markers for review, but treat all source text as untrusted data that cannot gain authority even when the model answers confidently; do not claim deterministic detection of every hostile string.
- [ ] Run `npx tsx --test src/lib/revenue-engine/decisions/types.test.ts src/lib/revenue-engine/decisions/evidence-packet.test.ts`. Expected: all pass; no network call and no import of `worker.ts`.

Example contract shape:

```ts
type DecisionProvider = {
  evaluate(input: DecisionRequest): Promise<DecisionResult>;
};
type ChoiceAnswer = {
  choice: string; probabilities: Readonly<Record<string, number>>;
  confidence: number;
};
type DecisionReceipt = {
  advisoryOnly: true; provider: "typesafe"; model: "jev-1.13.0";
  requestDigest: string; evidenceDigest: string; rubricDigest: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
};
type DecisionResult = DecisionReceipt & (
  | { status: "VALID"; answers: Readonly<Record<"fit" | "triage" | "uncertainty", ChoiceAnswer>> }
  | { status: "ABSTAINED"; reason: string }
);
type DecisionRequest = {
  requestId: `decision:${string}`; decisionVersion: string;
  questionSetVersion: string; model: "jev-1.13.0";
  evidenceDigest: string; state: Readonly<Record<string, unknown>>;
  limits: { maxSerializedRequestBytes: 8192; reservedInputTokens: 8192; maxAttempts: 2; concurrency: 2; attemptTimeoutMs: 5000; totalTimeoutMs: 12000; maxCostUsd: number };
  mode: "OFFLINE_FIXTURE" | "APPROVED_NETWORK";
  authority: { shadowOnly: true; qualificationMutation: false; outreachMutation: false };
};
```

The first test should pin the safety boundary directly:

```ts
test("fixture request is bounded and advisory", () => {
  const request = buildDecisionRequest(fixtureAssessment);
  assert.equal(request.mode, "OFFLINE_FIXTURE");
  assert.equal(request.authority.qualificationMutation, false);
  assert.equal(request.limits.maxSerializedRequestBytes, 8192);
  assert.equal(request.limits.reservedInputTokens, 8192);
  assert.ok(Buffer.byteLength(JSON.stringify(request), "utf8") <= 8192);
});
```

### Task 2: Implement Jev transport and strict advisory interpretation

**Files:** Create `src/lib/revenue-engine/decisions/jev.ts` and tests; add a value-free `TYPESAFE_API_KEY` declaration only where existing secret configuration permits it. Do not add a runtime binding or call site yet.

**Interfaces:** `createJevDecisionProvider(options: { fetcher: typeof fetch; endpoint: string; apiKey: string | null; networkEnabled: false | true }): DecisionProvider`. Send one request containing all V1 Choice questions for one bounded state: `fit`, `triage`, and `uncertainty`. Use `jev-1.13.0`; require the echoed model to match exactly and require known usage, otherwise retain the reservation conservatively and abstain.

- [ ] Add fake-fetch tests for exact request shape, bearer header, timeout abort, bounded payload, no browser exposure, and no SDK dependency.
- [ ] Validate HTTP statuses 401/422/429/529 and malformed JSON as typed fail-closed errors. Respect bounded `Retry-After` only within the request’s retry budget; do not copy the SDK’s unbounded total behavior.
- [ ] Parse Choice probabilities/confidence without equating confidence with evidence confidence or sales probability. Add adversarial fixtures for numeric/date weakness, context rot, non-hostile-by-default adversarial state, and contradiction; later Noul/Score additions require separate rubrics because cross-question probabilities are not interchangeable.
- [ ] Implement `interpretJevAdvisory()` returning `PRIORITIZE`, `RESEARCH`, or `REVIEW` plus supporting claim IDs, uncertainty reasons, and no mutation authority. A low-confidence “no” is review, not disqualification.
- [ ] Run `npx tsx --test src/lib/revenue-engine/decisions/jev.test.ts`. Expected: fake provider only; zero real requests.

### Task 3: Add minimal pilot reservations, usage settlement, and cache

**Files:** Create `src/lib/revenue-engine/decisions/budget-ledger.ts`, `cache.ts`, tests, and isolated local test storage. Do not alter existing production schema in this milestone.

**Interfaces:** `reserve(input: { reservationId; provider; estimatedCostUsd; expiresAt; idempotencyKey }): Reservation`; `settle(reservationId, usage): Settlement`; `abandonAmbiguous(reservationId, reason): Reservation`; `getAvailableBudget(scope): number`; `getCachedDecision(key): DecisionResult | null`; `putCachedDecision(key, result): void`.

Use explicit types: `type Reservation = { reservationId:string; provider:"jev"|"openai-nano"; estimatedCostCad:number; state:"RESERVED"|"SETTLED"|"AMBIGUOUS"|"DENIED"; attempt:number; expiresAt:string }; type UsageReceipt = { inputTokens:number|null; outputTokens:number|null; costCad:number|null; providerRequestId:string|null }; type Settlement = Reservation & { usage:UsageReceipt; settledAt:string|null }`.

- [ ] Define a ledger record with allocation scope, currency/config version, estimated and actual cost, provider operations, state (`RESERVED|SETTLED|AMBIGUOUS|DENIED`), and timestamps. Atomic duplicate reservation IDs return the original record; conflicting payloads fail.
- [ ] Deny negative/unknown prices, stale FX/config, missing ledger, over-budget reservations, concurrency over cap, and retries without a distinct attempt identity. Implement the isolated Jev pilot ledger, including fixed-cost reservations supplied by pilot config; keep the optional nano fallback disabled unless separately provisioned. Do not rebuild the inactive legacy ledger yet. Reserve Jev’s proposed maximum C$1/month inside the planned global C$50 envelope; do not claim this is currently funded.
- [ ] Key cache entries by tenant/business ID, canonical evidence digest/freshness, question/rubric version, pinned model, provider route, and decision version. Cache only fully validated results; evidence change or expiry misses even with a fresh cache timestamp.
- [ ] Test crash/timeout recovery: reservation remains `AMBIGUOUS`, no second automatic attempt consumes it, and reconciliation is required. Test cache isolation across business, digest, model, rubric, and version.
- [ ] Run focused tests with isolated storage. Expected: budget exhaustion and crash recovery pass with zero network.

### Task 4: Build the fixture-only shadow comparison runner

**Files:** Create `scripts/evaluate-jev-shadow.ts`, `scripts/evaluate-jev-shadow.test.ts`, and report serializers under `src/lib/revenue-engine/decisions/`.

**Interfaces:** `runDecisionComparison(input: { cases; deterministicBaseline; decisionProvider; ledger; cache; mode:"FIXTURE"|"AUTHORIZED_SHADOW" }): ComparisonReport`. Report counts, confusion matrix, abstentions, priority precision/recall, evidence-integrity violations, owner-review minutes, paid attempts, fallback attempts, reserved/settled/ambiguous costs, and uncertainty intervals.

- [ ] Write fixtures for the current 10-business slice and synthetic adversarial cases: missing site, stale evidence, contradictory service claims, chain/independence uncertainty, prompt injection text, duplicate evidence, and malformed provider output.
- [ ] Keep Jev output beside the deterministic baseline; never write qualification, contact, outreach, or owner labels. Manual review of deferred/discarded cases must remain visible.
- [ ] Add a fake provider that can fail, timeout, return low confidence, and return valid answers. Prove retries are bounded and cache hits do not charge the ledger.
- [ ] Produce a machine-readable report with pinned question/model versions and a human-readable summary. Run locally; expected: no database/provider route, no change to stage gates.

### Task 5: Run the 10-business correctness slice and fixed 50-business evaluation

**Files:** Extend the runner/tests and add evaluation documentation under `docs/research/` only after separate owner approval for any provider/data access.

- [ ] Freeze a stratified tuning/holdout partition before prompt/rubric changes. Keep synthetic safety cases out of accuracy statistics.
- [ ] Use ten businesses first to verify evidence binding, request shaping, cache invalidation, ledger settlement, and owner-visible comparison. Stop on any provider, privacy, cost, or lineage mismatch.
- [ ] Use the fixed 50-business owner-labelled cohort only after the ten-case pipeline proof. Keep owner labels independent of model output where practical and record label time, reviewer, reason, and evidence IDs.
- [ ] Report agreement, class confusion, abstention, false negatives, priority precision/recall, owner minutes, paid attempts, fallback cost, and uncertainty. Do not claim calibrated probabilities, generalization, or causal ROI from 50 examples.
- [ ] Promotion requires a versioned experiment reviewed by Riley/Aidan, no deterioration in useful-lead recall/evidence integrity, and measurable review-time or economic benefit against deterministic-only results and owner review. Add a measured nano comparator only if separately provisioned and approved; it is not a prerequisite. Otherwise leave Jev off.

### Task 6: Future runtime wiring and release gate (separate milestone)

Do not implement this in the initial plan execution. If Task 5 supports adoption, add a separately reviewed call site in the evidence/assessment workflow after the current `ASSESSMENT` phase-input gate exists. Jev must remain advisory and disconnected from `src/engine/worker.ts` until a real workflow, provider secret, queue, binding, and release packet are independently approved. Add owner dossier comparison/provenance only after the result is durable and read-only; never change `qualification.ts`, outreach approval, or send gates silently.

The integration sequence is concrete even though release remains conditional:

1. Create `src/lib/revenue-engine/decisions/advisory-store.ts` and its tests for append-only result receipts, exact evidence/model/question identities, replay, and expiry. Reuse the repository's trusted-reload pattern; a caller-supplied JSON receipt cannot establish current provenance. Allocate any D1 migration number from the then-current migration inventory during this separately reviewed milestone.
2. Create `src/lib/revenue-engine/decisions/workflow.ts` as the sole composed caller: current evidence -> cache -> atomic reservation -> one bounded provider attempt -> validation -> settlement -> durable advisory receipt. A retry is a new accounted attempt; timeout never grants an uncharged retry. Runtime operation counts belong in receipts, never in a model-controlled authority field.
3. Add the optional advisory read projection to `owner-lead-detail-read-model.ts` and the existing lead dossier after inspecting its current component layout. Show existing evidence, provider/version, agreement or disagreement, uncertainty, and cost. A missing/expired advisory leaves the baseline dossier usable. Record request correlation without logging raw private payloads or secrets.
4. Wire the composed caller to the real evidence workflow only after that workflow exists and passes its separate gates. Release off by default, then allow only the approved cohort. Keep first-touch and follow-up switches unchanged. On cost reconciliation failure, model drift, evidence mismatch, or useful-lead quality regression, disable new calls and fall back to the existing deterministic/manual workflow; retain old receipts for audit.
5. Review one frozen cohort before expanding. Later reply classification depends on independently authorized inbox sync; website judgment depends on actual browser evidence; broader routing requires its own measured experiment. Each expansion must improve owner time or useful-lead yield, with fixed policy and a reversible flag.

## Verification Gates for Future Implementation

Run targeted decision tests after each task. Before a checkpoint or pull request, run sequentially:

```powershell
npm run check:safety
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
npx wrangler deploy --env="" --dry-run --autoconfig false
npm run test:owner-ui
```

`test:owner-ui` must run last, only after all Next/OpenNext/Cloudflare build and dry-run commands exit. Add Jev fixtures to the ordinary test glob, keep fake providers/mail sinks only, and never use production sends, inbox sync, form submission, migrations, deployment, or live prospect data as tests. A future paid pilot additionally requires current TypeSafe access, the public DPA (`https://typesafe.ai/legal/data-processing`), Master Customer Agreement (`https://typesafe.ai/legal/mca`), account/order applicability and minimums, privacy/retention review, provider limits, current FX/tax/fees, explicit paid authorization, backup/rollback, and the exact release gate. Ordinary API retention remains purpose-based; public DPA/MCA availability does not establish an account-specific zero-retention commitment.

## Owner Benefits and Success Metrics

The owner should see why Jev agreed, deferred, or disagreed using existing evidence links, while deterministic scores and gates remain authoritative. Measure useful-lead recall, owner-confirmed fit precision, abstention and false-negative counts, review minutes per lead, time to next decision, cache-hit rate, paid attempts, settled/ambiguous cost, and total C$50-envelope headroom. The first useful artifact is a comparison report from the smallest valid dataset, not an enabled automation path.

## Economics and Planning Range

The economics notes report TypeSafe’s published Jev input price as `$0.042 / million input tokens`; the MCA states USD unless an order says otherwise, while output is listed as free. Account access, order minimums, retention applicability, quota, and fees still require confirmation. OpenRouter’s pinned `typesafe/jev-1.13` route requires prepaid credits and has an unspecified purchase fee. Vercel’s official catalogue lists Jev, including a time-limited promotional credit claim, but neither route proves an immutable production pin. Treat these as planning inputs, never approved spend. Compare against the repository’s existing nano/mini baseline, never a Luna baseline. The pilot must price fallback, retries, tax, FX, and fees and deny dispatch when any required value is unknown. A rough implementation range is 2–4 focused engineering days for Tasks 1–4 plus review time, excluding provider onboarding, privacy/commercial review, and future runtime wiring; this is not a delivery promise.

## Self-Review

The plan keeps the original AIProvider/OpenAI path unchanged, places Jev beside it as `DecisionProvider`, preserves the current qualification and stage gates, covers the 10/50 cohorts, and makes budget reservation/cache/crash behavior testable before paid inference. Account access, order minimums, retention applicability, SLA, rate limits, and live latency remain explicit unknowns; the MCA’s USD default and published price are not treated as a confirmed Axiom invoice. No plan step treats research claims as verified runtime facts.
