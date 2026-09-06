# ADR 0055 — Record abandoned owner-auth reservations additively and prove mutation counts

- Status: Accepted for source-only design
- Date: 2026-09-04
- Technical proposal: Revenue Engine integration owner; owner activation approval pending

## Context

ADR 0054 deliberately makes every visible `RESERVED` owner-auth idempotency row
fail closed. A worker may have stopped, but a timestamp cannot prove that a
slow worker will never return. Reclaiming, deleting, or finalizing the row in
place could therefore run one owner action twice or erase the evidence needed
to investigate the unsafe writer.

The future adapter also needs an auditable answer to a simpler but dangerous
question: how many rows changed? A successful owner mutation must change one
and only one intended business row, create one idempotency result, and enqueue
one outbox event in the same transaction. An exact replay must change none of
those rows. Any process loss or integrity failure must leave no partial rows.

No additive migration, D1 binding, route, UI action, owner decision, or
production operation is approved by this ADR. The contracts in this
checkpoint are validation-only and are exercised against a disposable
in-memory SQLite fixture.

## Decision

### Abandonment is a separate immutable receipt

When the recovery classifier blocks a `RESERVED` row, a future reviewed
adapter may append an `ABANDONED` receipt in a separate table. The original
reservation remains intact and remains non-reusable. The receipt binds:

- the exact idempotency key, authenticated boundary digest, owner, operation,
  and payload digest;
- the exact in-process reservation observation and recovery decision digests;
- the blocked action and a bounded reason code;
- database-observed reservation time and the database time when the receipt is
  recorded; and
- an explicit retention policy.

The source-only policy proposes a one-year minimum and two-year maximum
technical retention window. This is not a legal conclusion or a deletion
command. The original reservation and recovery receipt are append-only;
deletion requires a separate owner-approved release. No replacement key is
issued by recovery. A later retry must create a new content-addressed intent
through a separately reviewed key-issuance path.

Only the exact frozen values created in the current process may be consumed as
validated candidates. This proves validation ran, not that a database was read
or a recovery occurred. Receipt timestamps remain caller supplied in this
disconnected design. No candidate can authorize key replacement or fence an
old writer; the future schema and writer must prove both before recovery is usable.

### Affected-row proof is an explicit transaction receipt

The future D1 adapter must return a content-addressed proof for one of three
paths:

| Path | Required counts and state |
| --- | --- |
| `FRESH_COMMIT` | claim matched; transaction committed; exactly one operation row, one idempotency insert, one outbox insert; one ledger and one outbox row remain; no unrelated rows changed |
| `EXACT_REPLAY` | committed row already exists; claim did not match; zero operation rows, zero ledger inserts, zero outbox inserts; the existing ledger and outbox remain exactly one each; no unrelated rows changed |
| `ROLLBACK` | whole transaction rolled back; zero operation rows, zero inserts, zero remaining ledger/outbox rows; a failure reason is recorded; no unrelated rows changed |

The count contract is bound to the exact non-executable claim descriptor from ADR 0054
and has zero mutation, database, route, UI, provider, deployment, outreach,
send, and cost authority. Counts outside these invariants are failures, not a
best-effort warning. Its assurance is `CALLER_COUNTS_VALIDATED_ONLY` and
`durableExecutionProven` stays false. Counts mean committed net changes scoped
to the intent; a rolled-back statement can report affected rows even though
none survive. The future adapter must assert counts inside the transaction and
reload committed state. Checking them after commit cannot roll the action back.
The simplified SQLite test is not migration 0070 or a D1 adapter.

## Options considered

### Reclaim or delete stale reservations

Rejected. Age does not fence a slow writer and deletion destroys replay and
incident evidence.

### Mark the existing reservation `ABANDONED`

Rejected. Migration 0070 intentionally limits the ledger to `RESERVED` and
`COMMITTED`, and changing the same row would blur the original intent with its
recovery outcome. An additive record preserves both histories.

### Record only a recovery log without count invariants

Rejected. A log can say that an operation was attempted but cannot prove that
the owner row, idempotency ledger, and outbox changed exactly once or rolled
back together.

### Add a typed immutable receipt and count proof before connecting an adapter

Selected. It makes recovery, replay, duplicate delivery, and process-loss
behaviour reviewable and testable while keeping all authority disconnected.

## Consequences

- A blocked reservation becomes explicit recovery work without a duplicate
  owner action or destructive cleanup.
- The system retains enough identity and chronology to investigate a partial
  writer and safely issue a new intent later.
- A future migration must add the recovery table, immutable guards, retention
  review, and a separately approved replacement-key path.
- A future D1 adapter must expose affected-row counts and prove its transaction
  outcome before any owner-facing result is trusted.
- This checkpoint adds no live database, migration, route, operator command,
  provider, mailbox, prospect, deployment, or spend capability.

## Action items

1. [x] Add the source-only abandonment receipt, retention policy, and
   affected-row proof contracts.
2. [x] Exercise fresh, replay, and rollback after each write in a simplified
   disposable SQLite fixture; reject copied candidates and chronology/count drift.
3. [x] Prove the migration-0069/0070 SQL transaction in disposable SQLite with
   one concrete operation, statement-level abort dependencies, exact
   stored-result replay, a deterministic stale-preflight race, and rollback
   after every statement; see ADR 0056. This does not prove a D1 adapter,
   concurrent D1 execution, or live durability.
4. [ ] Design the future replacement-key issuance boundary with owner auth,
   MFA/recovery, backup, and rollback evidence.
5. [ ] Require the existing release gate before applying a migration to a real
   resource or activating an owner mutation. Disconnected implementation and
   disposable verification remain authorized rebuild work.
