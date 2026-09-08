# ADR 0021 — Project fresh sealed artifact references without operational authority

- Status: accepted
- Date: 2026-08-24

## Context

ADR 0020 established the first private D1 result that can truthfully claim a
transactionally complete artifact-reference snapshot. The existing v1 projector
still accepts fixture-asserted rows, deliberately reports an incomplete
snapshot, and cannot conclude that no current references exist.

Two trust gaps remained:

1. a plain JSON object shaped like an executor result could be passed around as
   if schema validity proved it came from the executor; and
2. an exact sealed replay contains the historical receipt but not the
   materialized source rows needed to reproduce lineage assignments.

The older projector also treated `QUALIFICATION_180D` as an automatic object
expiry. Availability v2 correctly treats every promoted class as protected from
automatic object deletion. The 180-day qualification policy is a retention
review boundary, not permission for R2 lifecycle deletion.

## Decision

Add `artifact-reference-trusted-projection-v2` as a fixture-only compatibility
adapter over the existing deterministic lineage projector.

The private executor now deep-freezes each returned result and records its exact
object identity in a module-private `WeakSet`. The projection adapter accepts
only that exact in-process object and then requires:

- `executionPath=FRESH_COMMIT`;
- materialized decoded source rows;
- one independently reloaded completeness receipt;
- matching workflow, business, root, snapshot, availability, and source-facts
  identities;
- a projection time no earlier than receipt recording and strictly before the
  half-open freshness boundary; and
- exact deterministic replay of the selected lineage.

An exact sealed replay is valid history but is not projectable because it has no
source rows. A cloned or reconstructed JSON envelope is not accepted as trusted
in-process provenance.

Availability v2 rows are deterministically reduced into the older projector's
compatibility shape only after their full source digest is sealed. The output
keeps both the sealed v2 source digest and the compatibility replay digest. This
conversion does not replace or weaken the D1 receipt.

The v2 reference states are:

- `NO_CURRENT_REFERENCES` when the complete selected lineage has zero active
  uses;
- `INDETERMINATE` when an active use is ambiguous or unassigned;
- `LEGAL_HOLD_ACTIVE` when all active uses resolve and legal hold is the strongest
  required class; and
- `ACTIVE_REFERENCES` for other fully resolved active uses.

`NO_CURRENT_REFERENCES` is an observed reference state, not authority to release
or delete anything. Every output keeps retention-conclusion, persistence,
release, deletion, provider-operation, and cost authority false or zero. The
caller-supplied projection clock remains explicitly fixture-only and every result
requires a fresh reference check before later use.

## Verification

Disposable-D1 tests cover:

- a fresh complete no-current-reference observation;
- stale half-open freshness rejection;
- exact-replay rejection without materialized rows;
- cloned trust-envelope rejection and source-facts drift;
- equal-rank ambiguous assignments remaining indeterminate;
- frozen executor results and schema rejection of forged authority; and
- promoted manifests rejecting invented automatic object expiry.

The safety checker keeps the adapter disconnected from the inert Worker, forbids
runtime/provider/database access, and requires every authority field to remain
off. All 60 migrations continue to replay from zero.

## Consequences

The rebuild can now distinguish a complete “no current references” observation
from an incomplete fixture without turning either one into a deletion decision.
No projection row is persisted, no R2 object is read or deleted, and no live
resource is connected.

The next boundary is a separately release-gated R2 HEAD adapter and staging smoke
test. It requires its own budget, resource inventory, rollback, and owner approval
before any bucket, binding, live request, or migration apply.
