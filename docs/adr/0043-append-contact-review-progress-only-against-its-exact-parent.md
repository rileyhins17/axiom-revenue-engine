# ADR 0043 — Append contact-review progress only against its exact parent

**Status:** Accepted
**Date:** 2026-09-01
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0042 derives one module-private `CONTACT_REVIEW` phase input only from the
exact current durable contact reload, internally regenerated proof, exact
manifest business, and complete content-addressed assessment checkpoint. The
generic progress appender is deterministic, but it accepts schema-valid phase
inputs. Calling it directly would discard the exact-object and parent trust
established by the contact-review adapter.

The append must also be safe to retry after an interrupted integration step. A
retry against the exact same parent should return the same logical and
in-memory result. A copied input, changed parent, or replay against the already
completed child must not be silently rebased or recorded twice.

## Decision

Add a separate validation-only in-memory contact-review append boundary. It
accepts only the exact phase-input instance registered by ADR 0042 and requires
the content-equivalent manifest plus parent ID/digest used when that input was
derived.

The boundary calls the canonical receipt builder and progress appender, then
independently verifies:

- the result names the exact assessment parent checkpoint;
- the manifest, slice, source plan, progress version, and zero-authority policy
  are unchanged;
- the checkpoint time equals the trusted input's database-derived recording
  time;
- total completed receipts increase by exactly one and fully completed business
  count does not change;
- one business moves from `ASSESSMENT_PERSISTED` to
  `CONTACT_REVIEW_PERSISTED`, with `OWNER_DOSSIER_ACCEPTANCE` as its next gate;
- every other checkpoint count remains unchanged;
- the selected business keeps its exact prior three-receipt prefix and gains
  only the expected canonical contact-review receipt; and
- all other nine business records remain canonically equivalent.

The result is deeply frozen and registered in a module-private `WeakSet`. A
`WeakMap` caches the result by exact trusted input and parent identity. Repeating
the exact call returns the same checkpoint object; presenting any different
parent fails closed.

The module has no file, database, runtime, provider, operator, real-data, or
external connection. It does not discover or verify contacts, infer consent, or
perform outreach; it only advances already-proven in-memory shadow progress.

## Options Considered

### Option A — Use the generic operator recorder

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Trust preservation | Low |
| Retry behavior | File-oriented rather than exact in-process |
| Operational risk | High because copied input could become progress |

**Pros:** Minimal new code and an existing output mechanism.

**Cons:** Serialized JSON would become authority and would lose the exact
durable-object and parent trust established by ADRs 0041–0042.

### Option B — Append inside the durable contact loader or input adapter

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Trust preservation | High |
| Retry behavior | Coupled to database reads and proof construction |
| Operational risk | Medium because proof and state change share one boundary |

**Pros:** Fewer public steps.

**Cons:** Mixes durable provenance, proof/input construction, and progress
mutation, making least authority and failure isolation harder to prove.

### Option C — Separate exact-parent in-memory append

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Trust preservation | High |
| Retry behavior | Exact and instance-cached |
| Operational risk | Low because it has no durable or operator path |

**Pros:** Preserves explicit, testable boundaries and makes the one-record
transition independently auditable.

**Cons:** A resumed task must repeat the bounded reload and input derivation
before appending again.

Option C was selected.

## Trade-off Analysis

The result is intentionally not durable and its trust does not survive
serialization. After a process loss, the engine must reload the contact state,
re-derive the input, and append again from the persisted parent. This bounded
repetition is preferable to trusting copied JSON. Exact parent binding also
forbids automatic rebasing when any other business advances; the input must be
re-derived against the new complete cohort checkpoint.

## Consequences

- One reviewed contact phase can advance exactly once in one in-memory
  checkpoint.
- Exact retry returns the same deeply frozen checkpoint instance.
- Copied input, changed manifest, changed/re-digested parent, and replay against
  the completed child fail closed.
- Prior receipts, unrelated businesses, checkpoint counts, and zero-authority
  policy cannot change unnoticed.
- No file or database progress record is created, so this does not authorize a
  real pilot run or establish a durable operator path.
- The next integration gap is a trustworthy owner-dossier acceptance proof and
  phase input bound to the exact contact-review checkpoint and owner-readable
  dossier.
- No production/staging deployment, migration, provider, mailbox, prospect,
  real-business operation, or spend is introduced.

## Action Items

1. [x] Add the exact-parent, in-memory contact-review append boundary.
2. [x] Independently prove one-receipt-only mutation, summary transition, prior
   prefix preservation, and unchanged unrelated records.
3. [x] Cache exact retries and reject copied inputs, changed parents, and child
   replay.
4. [x] Add static safety enforcement against operator, Worker, file, database,
   runtime, provider, network, and mutation wiring.
5. [x] Design a trustworthy `OWNER_DOSSIER` acceptance proof and phase input
   before any owner-dossier progress append or durable/operator wiring; ADR 0044
   keeps authentication, durable recording, append, and operator wiring separate.
