# ADR 0054 — Keep owner-auth reservation recovery fail-closed

- Status: Accepted for source-only design
- Date: 2026-09-04
- Deciders: Riley Hinsperger and the Revenue Engine integration owner

## Context

Migration 0070 uses a `RESERVED` row as the claim that protects a future
owner-auth mutation from duplicate execution. The intended D1 batch is atomic:
reserve, verify the reservation, execute one operation-specific mutation,
finalize the exact result, enqueue one outbox event, and reload the commit. A
successful batch therefore exposes only `COMMITTED`; a rolled-back batch should
expose neither the reservation nor the result.

The failure case still needs an explicit rule. A row that is visibly
`RESERVED` may have been left by an unsafe partial writer, a process that ran
the statements outside one batch, or a future schema/version mismatch. Time
alone cannot prove that the original worker stopped, and reclaiming the row
could allow a slow worker to commit the same owner action later. The operation
statement also needs a precise, reviewable claim predicate rather than an
informal “check the key first” convention.

No recovery adapter, D1 binding, owner route, or production migration is
approved in this checkpoint.

## Decision

### Reservation recovery

The validation-only recovery policy treats every visible `RESERVED` row as
non-authoritative:

- younger than the two-minute expected batch window: `BLOCK_VISIBLE_RESERVED`;
- at or beyond that window: `BLOCK_STALE_RESERVED`;
- outside the owner-session window: `BLOCK_EXPIRED_SESSION_RESERVED`.

All three outcomes stop the operation and require a separately reviewed
recovery receipt. Recovery cannot finalize, delete, or reuse the row, and a
same-key retry remains blocked until a future additive migration defines an
append-only abandonment/recovery record. A new intent must use a new
content-addressed key after that future recovery is approved. A `COMMITTED` row
is the only state that permits `REPLAY_EXACT_RESULT`, and it never permits a
second operation mutation.

The policy uses database time supplied by a future read boundary and verifies
that reservation and session chronology is coherent. It does not treat the
caller clock, row age, or a copied JSON object as proof of recovery.

### Operation-specific claim

The future operation mutation must be one parameterized DML statement that
embeds this exact predicate as an `EXISTS` subquery:

```sql
EXISTS (
  SELECT 1 FROM "RevenuePrivateKwOwnerAuthIdempotency"
  WHERE "id" = ?
    AND "state" = 'RESERVED'
    AND "boundaryDigest" = ?
    AND "owner" = ?
    AND "operation" = ?
    AND "payloadDigest" = ?
)
```

The claim descriptor binds those five values to the exact server-auth boundary,
forbids interpolated identity values, and requires the operation statement to
share the same D1 batch as reservation, finalization, and outbox insertion. It
rejects multi-statements, comments, DDL, `RETURNING`, unquoted target drift,
and attempts to mutate the idempotency ledger or its outbox. The descriptor is
content-addressed, frozen, and not executable by this module.

## Options considered

### Reclaim a stale `RESERVED` row in place

Rejected. A time threshold cannot fence a slow original worker. Reclaiming in
place would make the same key represent two possible mutations and would
destroy the evidence that an unsafe writer existed.

### Delete the stale row and let the caller retry

Rejected. Migration 0070 is append-only, and deleting the row would erase the
replay/conflict history. A future additive migration may record an explicit
abandonment outcome, but it must not silently remove the original intent.

### Allow the operation to check only the idempotency key

Rejected. The key must remain bound to owner, operation, payload, and the exact
authenticated request boundary. A key-only check can be reused across a
different action or session.

### Define a typed, non-executable claim and recovery policy first

Selected. It makes the dangerous cases testable while keeping the live route,
database, and mutation authority disconnected.

## Consequences

- Unsafe or partial writers become visible recovery work instead of silently
  becoming a duplicate-send or duplicate-decision path.
- Every future owner mutation has one exact claim shape and an auditable digest.
- A future additive migration must define an abandonment record, operator
  review, bounded retention, and how a replacement key is issued.
- The operation adapter must prove affected-row counts and claim success inside
  the same D1 batch; zero or multiple changes are failures.
- The current application gains no route, database resource, provider access,
  deployment ability, owner authority, or spend.

## Action items

1. [x] Add the validation-only recovery classifier and operation-claim
   descriptor.
2. [x] Test visible, stale, expired, committed, copied, malformed, and
   multi-statement cases.
3. [ ] Design the additive `ABANDONED`/recovery receipt schema and retention
   policy without applying it.
4. [ ] Prove affected-row-count and rollback behavior in a disposable D1/SQLite
   fixture before any staging migration.
5. [ ] Require explicit owner-auth, MFA/recovery, backup, rollback, and release
   approval before connecting a real owner mutation.
