# ADR 0040 — Append assessment progress only against its exact parent

**Status:** Accepted
**Date:** 2026-08-31
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0039 creates one module-private `ASSESSMENT` phase input from an exact
current durable assessment reload, internally regenerated proof, exact manifest
business, and complete content-addressed parent checkpoint. The generic progress
appender is deterministic, but it accepts any schema-valid phase input. Calling
it directly would discard the exact-object and parent trust established by the
assessment adapter.

The append must also be safe to retry after an interrupted integration step. A
retry against the exact same parent should return the same logical and in-memory
result, while a changed parent—including the already-completed child—must not be
silently rebased or recorded twice.

## Decision

Add a separate validation-only in-memory assessment append boundary. It accepts
only the exact phase-input instance registered by ADR 0039 and requires the
content-equivalent manifest and parent ID/digest used when that input was
derived.

The boundary calls the canonical progress appender and then independently
verifies:

- the result names the exact parent checkpoint;
- the manifest, slice, source plan, progress version, and authority are
  unchanged;
- the checkpoint time equals the trusted input's D1-derived recording time;
- total completed receipts increase by exactly one and fully completed business
  count does not change;
- one business moves from `CURRENT_WEBSITE_EVIDENCE_PERSISTED` to
  `ASSESSMENT_PERSISTED`, with `CONTACT_REVIEW_APPROVAL` as its next gate;
- every other checkpoint count remains unchanged;
- the selected business keeps its exact prior two-receipt prefix and gains only
  the expected canonical assessment receipt; and
- all other nine business records remain canonically equivalent.

The result is deeply frozen and registered in a module-private `WeakSet`. A
`WeakMap` caches the result by exact trusted input and parent identity. Repeating
the exact call returns the same checkpoint object; presenting any different
parent fails closed.

The module has no file, database, runtime, provider, operator, real-data, or
external connection. It does not execute qualification or contact discovery; it
only advances already-proven in-memory shadow progress.

## Options Considered

### Option A — Use the generic operator recorder

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Trust preservation | Low |
| Retry behavior | File-oriented rather than exact in-process |
| Operational risk | High because copied input could become progress |

### Option B — Append inside the durable assessment loader

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Trust preservation | High |
| Retry behavior | Coupled to database reads |
| Operational risk | Medium because proof and state change share one boundary |

### Option C — Separate exact-parent in-memory append

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Trust preservation | High |
| Retry behavior | Exact and instance-cached |
| Operational risk | Low because it has no durable or operator path |

Option C was selected. It maintains the explicit separation between durable
assessment proof, phase-input derivation, and progress mutation while keeping
retries deterministic.

## Trade-off Analysis

The result is intentionally not durable and its trust does not survive
serialization. That means an interrupted task must reload the assessment,
re-derive the input, and append again from the persisted parent. This extra
bounded work is preferable to treating copied JSON as authority. Exact parent
binding also forbids automatic rebasing when any other business advances; the
input must be re-derived against the new complete cohort checkpoint.

## Consequences

- One assessment can advance exactly once in one in-memory checkpoint.
- Exact retry returns the same deeply frozen checkpoint instance.
- Copied input, changed manifest, changed/re-digested parent, and replay against
  the completed child fail closed.
- Prior receipts, unrelated businesses, checkpoint counts, and zero-authority
  policy cannot change unnoticed.
- No file or database progress record is created, so this does not authorize a
  real pilot run or establish a durable operator path.
- The next integration gap is a trustworthy `CONTACT_REVIEW` proof and phase
  input bound to the exact assessment checkpoint and reviewed contact
  invocation. A schema-valid contact invocation alone must not be trusted.
- No production/staging deployment, migration, provider, mailbox, prospect,
  real-business operation, or spend is introduced.

## Action Items

1. [x] Add the exact-parent, in-memory assessment append boundary.
2. [x] Independently prove one-receipt-only mutation, summary transition, prior
   prefix preservation, and unchanged unrelated records.
3. [x] Cache exact retries and reject copied inputs, changed parents, and child
   replay.
4. [x] Add static safety enforcement against operator, Worker, file, database,
   runtime, provider, and mutation wiring.
5. [ ] Design the `CONTACT_REVIEW` durable/proof boundary before creating its
   phase input or progress append.
