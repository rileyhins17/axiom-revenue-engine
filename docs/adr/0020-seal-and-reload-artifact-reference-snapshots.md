# ADR 0020 — Seal and reload artifact-reference snapshots through a private D1 executor

- Status: accepted
- Date: 2026-08-24

## Context

ADRs 0017–0019 defined the 15 source sets, strict decoder, availability v2,
append-only history, and database writer freeze. They intentionally stopped
before anything could issue a trusted completeness receipt.

D1 `batch()` is transactional and rolls the complete sequence back when one
statement fails, but it is not an interactive transaction that application code
can pause while it validates hashes. A safe executor therefore cannot read rows,
inspect them in TypeScript, and then pretend a later write remained inside the
same open transaction.

The schema also creates a foreign key from every source-set proof to its
completeness receipt. The parent must physically be inserted before the proof
children. “Insert completeness last” from ADR 0017 was therefore not executable
as written.

## Decision

Add a private `artifact-reference-d1-executor-v1` protocol with a narrow injected
batch boundary and one Cloudflare adapter typed from the generated `D1Database`
binding. It is not imported by the inert engine and no D1 binding is configured.

The protocol is:

1. Rebuild and compare the complete atomic plan so a caller cannot alter a
   control statement and merely recompute the plan digest.
2. Query `sqlite_master` and require all 51 exact source-freeze and append-only
   trigger contracts before touching transaction state.
3. Return an exact sealed replay when the planned attempt already has one
   canonical receipt and all 15 canonical proof rows.
4. In one D1 batch, use database time, conditionally claim the contiguous
   attempt/higher fence, verify one active winner with no higher fence, and read
   all 15 source sets.
5. Decode and validate the source rows without granting trust.
6. While the unsealed database fence still freezes every scoped writer, run all
   15 reads again in one batch and require identical source proofs and decoded
   facts.
7. Database-time preflight every receipt primary/alternate identity and every
   proof primary/scoped identity.
8. In one rollback-safe D1 batch, conditionally insert the completeness parent,
   insert all 15 proof children, and select the fence, parent, and children back.
   The parent is physically first for the foreign key, but no partial parent is
   externally visible because a child or postcondition failure rolls back the
   whole batch.
9. Reload the attempt, receipt, and all proof rows in a separate batch before
   returning the only transactionally trusted result type.

The executor uses query contract v2 and plan v3. Claims and winner checks use
database time, the half-open lease, the exact attempt digest, and absence of a
higher fence. A completeness receipt must still be fresh when committed and may
not extend beyond the attempt window.

## Trust and authority boundary

- Caller-supplied observations, decoded rows, and structural receipt parsing
  remain explicitly untrusted.
- The trusted result exists only after commit plus independent reload.
- An exact replay returns the historical receipt but no materialized source
  rows; a later projection must not invent them.
- Completeness does not authorize projection persistence, retention conclusions,
  release, deletion, provider operations, outreach, or cost.
- The executor is disposable/local only. No Worker route, queue, workflow,
  schedule, D1/R2/Browser binding, migration apply, deployment, or provider call
  is part of this decision.

## Verification

Disposable in-memory D1 tests cover fresh commit, exact sealed replay, all 15
proof children, independent reload, redigested control-statement forgery,
missing writer guards, source-result drift, target collisions, child rollback,
expired database-time fences, and divergent attempt alternate identities.

All 60 migrations must continue to replay from zero. Migrations 0059–0060 remain
unapplied to staging and production.

## Consequences

The transactionally trusted completeness boundary now exists as isolated code
and disposable-database proof. This closes the prerequisite for a fixture-only
projection-v2 adapter, but it does not make projection persistence or retention
decisions safe by itself. A live engine binding remains a separate backup,
rollback, staging, budget, and owner-approval release gate.
