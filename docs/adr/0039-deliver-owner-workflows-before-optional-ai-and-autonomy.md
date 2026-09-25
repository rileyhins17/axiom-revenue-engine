# ADR 0039 — Deliver complete owner workflows before optional AI and autonomy

**Status:** proposed implementation direction; recorded as the current planning roadmap.
**Date:** 2026-09-20. **Deciders:** Riley/Aidan for operational adoption; repository integration owner for implementation.
**Scope:** comprehensive planning revision only; no application implementation, provider activation, release, migration or contact authorization.

## Context

The rebuild has strong tested evidence/provenance contracts, local persistence boundaries and owner read surfaces, but its separate Worker validates then halts. There is no connected new end-to-end acquisition loop. The earlier plan assigned OpenAI workloads, and a Jev integration proposal mistakenly described a usable OpenAI fallback. Riley confirmed no OpenAI API keys. Public offer/pricing and provider economics also differ from older planning assumptions.

The business needs worthwhile opportunities within a C$50 total monthly ceiling and limited founder time. Adding model adapters or more disconnected safety layers before an owner can use real evidence delays that outcome.

## Decision

1. Retain the Cloudflare/TypeScript platform and existing evidence safeguards. Finish one offline business-to-dossier path, then ten approved real dossiers, then the fixed 50-business evaluation.
2. Build contact, exact-message approval, suppression, replies and minimum CRM behavior before sending. Start with a separately approved small human-triggered cohort; increase autonomy only when evidence and owner capacity support it.
3. Make provider readiness explicit as built/connected/authorized/verified. Keep OpenAI unconnected and optional. Jev is a subordinate typed-decision experiment after evidence quality, not a prerequisite. Deterministic templates and owner review are valid complete baseline functions.
4. Preserve existing v3 scoring/policy in runtime. Propose account-opportunity/action-readiness projections as a versioned experiment; model confidence never substitutes for evidence confidence or permission.
5. Implement a minimal shared reservation/settlement ledger before any paid engine provider operation, including manually triggered capture, storage and verification, with fixed costs, cash commitments, tax/FX and ambiguous attempts. Free-tier claims require actual account validation, usage evidence and overage controls.
6. Keep authoritative current STATUS concise; retain historical details in an archive. Every milestone must yield an observable owner workflow or clear an identified blocker.

## Options considered

| Option | Value | Cost/complexity | Decision |
|---|---|---|---|
| Continue isolated proof-layer/model-adapter milestones | Strong local invariants | Slow route to real owner value; account assumptions easy to miss | Freeze expansion except concrete blockers |
| Replace with managed outbound/CRM or VPS | Potential ready-made operations | Subscription/migration/maintenance; evidence and source-rights gaps remain | Defer pending actual economic advantage |
| Compose existing stack into complete owner workflows | Reuses UI/tests/contracts; proves sales usefulness early | Real integration and readiness still required | Selected planning direction |

## Relationship to earlier ADRs

ADR 0001's platform and additive-migration choice remains. ADR 0002's evidence, schema, pinning and evaluation principles remain; its assumption of an initial activated OpenAI provider is replaced in future sequencing by optional separately provisioned AI. ADRs 0003–0038 remain binding on their implemented mechanisms. This document does not weaken current trust checks, approval phrases, artifact retention, staging packets or dormant-runtime defaults.

Any simplification of internal approval/composition boundaries must preserve the same external authority and receive its own implementation review and tests. No existing accepted ADR is silently rewritten into different runtime behavior.

## Consequences and next actions

The first release may use no AI account. Model cost savings cannot be claimed against nonexistent usage. Account/legal/source readiness become visible milestones. Legacy suppression and contact-history reconciliation precede any new email. Exactly-once email delivery is not promised; unknown outcomes require reconciliation.

- [ ] Repair the identified tracked fixture-clock failure and diagnose the owner-UI warmup failure in a separate implementation cycle.
- [ ] Review the two preexisting assessment-progress files, then complete M1 using existing writers/readers and durable reload.
- [ ] Prepare the exact M2 real-research/storage capability packet without activating it by implication.

Implementation details and acceptance live in [MASTER_PLAN](../MASTER_PLAN.md), [DELIVERY_PLAN](../DELIVERY_PLAN.md), and [VALIDATION_PLAN](../VALIDATION_PLAN.md).
