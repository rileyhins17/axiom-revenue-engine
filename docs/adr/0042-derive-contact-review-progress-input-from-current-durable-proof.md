# ADR 0042 — Derive contact-review progress input from current durable proof

**Status:** Accepted
**Date:** 2026-09-01
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0041 makes one reviewed contact invocation trustworthy only after a complete,
database-clock-checked durable reload and a separate `contact-review-proof:*`
bound to the exact guarded assessment checkpoint. The generic shadow-progress
recorder still accepts any schema-valid phase input, however. Passing saved proof
or invocation JSON to that recorder would discard the stronger durable and
in-process provenance.

The contact review must also remain attached to the complete ten-business parent
used when the input was derived. Another business may legitimately advance first,
but a previously derived input must not silently rebase onto that changed parent.
A copied checkpoint, copied durable reload, caller-provided clock, or stale
verification window must fail before a progress receipt can be considered.

## Decision

Add a validation-only `CONTACT_REVIEW` phase-input adapter that accepts only the
manifest, the exact guarded assessment parent checkpoint, and the exact
in-process `CURRENT` result of the durable contact-invocation reload.

The adapter:

- rechecks the manifest identity, digest, source import/plan, exact ten-business
  scope, selected business, candidate, source record, name, city, and niche;
- requires exactly the source/workflow, current-website-evidence, and assessment
  receipt prefix, with `CONTACT_REVIEW_APPROVAL` as the selected business's next
  gate;
- regenerates `contact-review-proof:*` internally instead of accepting
  caller-supplied proof JSON;
- binds the exact source materialization, assessment receipt/proof, reviewed
  invocation, discovery result, final contact materialization, and current
  durable row/guard verification;
- derives `completedAt` from the durable invocation receipt and `recordedAt`
  from the final database clock, while requiring the clock to remain inside the
  current assessment/contact-evidence window and no older than the complete
  parent checkpoint;
- returns one deeply frozen, zero-execution-authority normalized phase input
  registered in a module-private `WeakSet`; and
- privately binds that exact input to the manifest and parent checkpoint
  identities/digests in a `WeakMap`.

A content-equivalent manifest or parent reloaded safely from storage may be
presented to the parent guard. Copied input JSON cannot recreate in-process trust.
The adapter does not import the progress appender or phase-receipt builder and has
no file, database, runtime, provider, operator, real-business, or live-data path.

## Options Considered

### Option A — Pass saved contact proof JSON to the generic recorder

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Resume safety | Low |
| Provenance strength | Low |
| Operational risk | High because serialized proof becomes progress authority |

**Pros:** Minimal code and reuses the existing generic recorder.

**Cons:** Cannot preserve exact durable-object trust, current database time, or
the exact full-cohort parent after an interruption.

### Option B — Reload contact state and append progress in one function

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Resume safety | Medium |
| Provenance strength | High |
| Operational risk | Medium because a read/proof boundary also mutates progress |

**Pros:** Fewer public steps and one combined call.

**Cons:** Mixes database provenance, phase-input construction, and checkpoint
mutation, making least authority and retry behaviour harder to prove.

### Option C — Derive an exact-parent in-process input without appending

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Resume safety | High |
| Provenance strength | High |
| Operational risk | Low because derivation has no write or operator path |

**Pros:** Keeps durable reload, proof, normalized input, and progress mutation as
separate testable authorities.

**Cons:** A resumed task must repeat the bounded read-only reload and input
derivation before any later append.

Option C was selected.

## Trade-off Analysis

Exact in-process trust deliberately expires across serialization or process loss.
Re-running the bounded durable reload costs more local validation work than
reading a saved JSON object, but it refreshes database time and detects changed
guards, rows, assessment lineage, verification expiry, or cohort progress. Exact
parent binding also forbids automatic rebasing when another business advances;
the input must be rebuilt against the new complete checkpoint. For a ten-business
shadow slice, this bounded repetition is preferable to ambiguous merge semantics
or copied JSON becoming authority.

## Consequences

- Schema-valid invocation, durable reload, proof, phase-input, and parent copies
  cannot advance contact-review progress.
- Stale verification, clock regression, incomplete assessment predecessors,
  cross-manifest lineage, changed parents, and internally rebuilt proof drift fail
  closed.
- The input names the reviewed invocation as its primary receipt and the exact
  internally rebuilt `contact-review-proof:*` as its required support.
- The assessment checkpoint remains unchanged; this milestone creates no phase
  receipt or next checkpoint.
- ADR 0043 now provides the separate exact-parent guarded in-memory append. It
  independently proves one contact-review receipt, the exact summary
  transition, and no unrelated change before the synthetic chain advances to
  `CONTACT_REVIEW_PERSISTED`.
- No operator command, file/database write, live binding, provider, real-business
  execution, contact action, deployment, migration, or spend is introduced.

## Action Items

1. [x] Add the current-durable-reload-only, internally proof-rebuilding
   `CONTACT_REVIEW` phase-input adapter.
2. [x] Bind exact trusted inputs privately to their manifest and complete
   assessment parent checkpoint.
3. [x] Prove zero authority, exact chronology, copied-trust rejection, stale
   evidence rejection, lineage rejection, and changed-parent rejection.
4. [x] Add static safety checks forbidding appender, operator, Worker, file,
   database, runtime, provider, mutation, and caller-clock wiring.
5. [x] Add a separate exact-parent guarded in-memory contact-review append;
   ADR 0043 keeps durable, operator, live-data, and real-business wiring out.
6. [ ] Design the owner-dossier acceptance proof/input separately from its
   eventual append and from all durable/operator wiring.
