# Jev integration design brief

> Superseded as an execution sequence by [Master Plan v2](../MASTER_PLAN.md).
> This is a research-stage optional experiment, not a prerequisite or active
> implementation instruction. The new delivery/operating/budget plans control.

Date: 2026-09-20. Status: proposed research/design; not an approved runtime policy.

## Outcome

Use Jev to reduce the cost and owner effort of narrow semantic decisions while preserving the Revenue Engine's evidence, qualification, approval, and budget contracts. Optimize cost per owner-confirmed useful lead and review minutes, not decisions per second. This work produces a plan; it does not activate providers or change production.

## Repository baseline and authority

Owner clarification on 2026-09-20: Riley has no OpenAI API keys. OpenAI model assignments and adapter code describe a planned capability, not an available fallback. The first Jev experiment must operate independently of OpenAI, using deterministic results and owner labels as its baseline and owner review for uncertainty. Any nano/mini runtime use requires separate provider setup and authorization. Retain the adapter code without making its activation a dependency.

Observed local branch: `RileyHinsperger/axiom-revenue-engine-rebuild`; HEAD `02e0c5a3ef69fe004d8ab7aab1314f0021f07f33`. Two untracked assessment-progress source/test files predate this research and must be preserved. Reinspect them before planning overlapping implementation.

The repository reports legacy production paused and an isolated staging console, with the new evidence pipeline largely fixture/shadow-only. Those are repository-reported operational states, not a fresh live Cloudflare inspection. The global cost ledger is explicitly pending. Existing OpenAI job token/retry limits do not prove an enforced monthly C$50 ceiling.

Use the current source, not historical memory of an empty APE checkout. Read `AGENTS.md`, owner context, status, master plan, gotchas, ADR 0002, and ADRs 0032/0033/0038 before implementation.

## Architecture decision

Add a separate typed `DecisionProvider.evaluate` abstraction beside the existing `AIProvider.generateStructured`. Jev does not provide arbitrary generated JSON, prose, or image analysis. Keep the existing OpenAI interface and callers intact for the first milestone. Native server-side `fetch` plus existing Zod avoids SDK and gateway dependencies unless official research reveals a material benefit.

Flow: validated current evidence -> deterministic exclusions/checks -> bounded text evidence packet -> cached Jev semantic assessment -> validated advisory result -> existing policy/owner review. Uncertainty requests more evidence or review. Missing evidence is UNKNOWN, never false. No Jev output can create evidence, consent, verification, eligibility, or send authority.

V1 contains only business/service-fit classification and research triage, in shadow mode. Select existing evidence identifiers as supporting observations; never generate new factual observations. Use explicit UNKNOWN choices and defer on contradictions, incomplete coverage, or out-of-domain input. Preserve the five independent score dimensions and existing qualification thresholds; never equate a model confidence score with evidence confidence or probability of a sale.

Later experiments, ranked after V1: prioritize ambiguous website findings using existing captured measurements; choose whether a case merits a bounded OpenAI escalation; classify incoming replies after authorized mailbox sync exists; rank owner-approved opportunities. Unsubscribe detection/suppression remains conservative and independent. No discovery replacement, automatic record merge, missing-site claim from absence of retrieval, automatic contact-channel policy change, or automatic sending.

## Cost and caching requirements

Retain the existing C$50/month total runtime ceiling including fixed costs. Propose a maximum C$1/month Jev suballocation from the existing AI envelope, not an extra C$1 outside it. Actual cash access/top-ups and tax/FX must be checked before activation. A separate explicit paid-pilot authorization is still required.

A provider-independent reservation and usage ledger is a prerequisite to live inference: reserve worst-case attempt and fallback costs atomically before dispatch; settle confirmed usage; retain conservative reservations after ambiguous timeouts; deny unknown price, stale FX/configuration, or missing ledger. An idempotency key cannot promise exactly-once provider billing. Bound concurrency, total requests, input size, timeout, and retry count. Budget escalations separately and never silently switch providers.

Cache only successfully validated responses by tenant/business identity, exact evidence digest and freshness, question/rubric version, pinned model, and provider route. Evidence expiry or change invalidates reuse even when cache age is short. Reuse sibling questions over shared state, with a small versioned question set. Do not send whole HTML, full CRM records, screenshots, secrets, personal inboxes, or account context to Jev. Strip instructions from scraped content where possible and treat all source text as untrusted data.

## Evaluation and promotion

First prove zero-network adapter and decision-policy behavior with fixtures. Then, once separately authorized data/provider gates are met, use the existing ten-business slice for pipeline correctness and the fixed 50-business cohort for owner agreement. Keep owner labels independent of model output where practical. Freeze a stratified tuning/holdout partition before prompt changes; keep additional synthetic adversarial safety cases separate from accuracy statistics. Report counts, class confusion, abstention, priority precision/recall, owner minutes, paid attempts, cost including fallback, and uncertainty. The existing >=85% agreement gate is a project acceptance requirement, not proof of calibrated probabilities or generalization. Fifty examples cannot establish rare-event reliability.

Do not remove leads solely on unvalidated Jev judgment. Manually review discarded/deferred cases during shadow evaluation so false negatives remain visible. Promotion requires a versioned experiment reviewed by the owner, no deterioration in useful-lead recall or evidence integrity, and a measurable review-time or economic benefit versus deterministic-only and existing nano baselines. No absolute savings are claimed until baseline usage exists.

## Observable milestones

1. Fixture-only provider contract, bounded evidence packet, versioned questions, strict response validation, advisory output and read-only comparison report. No runtime wiring or schema migration needed for this first exit gate.
2. Shared cost reservation, exact-result cache, retry accounting and local fake-provider evaluation runner. Prove budget exhaustion and crash recovery using isolated test storage.
3. Separately authorized ten-business provider smoke experiment and frozen 50-business comparison. This is research/shadow execution only and cannot alter qualification records or outreach authority.
4. Adopt advisory routing only if evidence supports it; otherwise leave the feature off and retain baseline behavior. Deployment follows the existing backup, rollback, exact-release and owner approval gates.

Future live integration depends on completing the actual evidence/assessment pipeline; Jev must not become another disconnected architecture project. First deliver a useful comparison artifact from the smallest existing valid dataset.

## Research inputs

- `2026-09-20-ape-integration-audit.md`: repository seams and current limitations.
- `2026-09-20-jev-provider-research.md`: primary-source API and vendor limits.
- `2026-09-20-jev-economics.md`: primary-source price/access research and cost scenarios.

Unknown terms, pinning semantics, data retention, pricing currency or billing minimums must be identified explicitly. Vendor speed/calibration claims are not measured Axiom results.
