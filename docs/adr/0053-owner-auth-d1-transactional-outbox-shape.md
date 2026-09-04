# ADR 0053 — Define the owner-auth D1 reservation and transactional outbox shape

- Status: Accepted for source-only design
- Date: 2026-09-03
- Deciders: Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0052 defined the safe in-process replay contract but intentionally left the
durable storage boundary open. A real owner action must not be performed twice
when a request is retried, and a downstream progress event must not be lost if
the process crashes after the action commits. A plain `INSERT OR IGNORE` of a
completed record is not enough: the operation and the outbox need a single
transactional claim.

No owner route, Better Auth adapter, D1 binding, staging database, or production
deployment is approved yet. This decision therefore adds only a migration
source file and a validation-only SQL plan; it does not apply the migration or
execute any operation.

## Decision

Migration `0070_owner_auth_idempotency_outbox.sql` defines two tables.

### Idempotency ledger

`RevenuePrivateKwOwnerAuthIdempotency` uses the exact idempotency key as its
primary key and has two guarded states:

1. `RESERVED` is a short-lived transaction claim. Intent fields are fixed and
   all result fields are null.
2. `COMMITTED` contains the exact content-addressed record and result. A
   `RESERVED` row may transition to `COMMITTED` once; committed rows cannot be
   edited or deleted.

The row mirrors owner, operation, payload digest, boundary digest, result
digest, and the canonical record JSON. SQLite checks and triggers reject
identity drift, invalid state transitions, malformed JSON, and any non-zero
mutation, route, provider, or cost authority.

### Transactional outbox

`RevenuePrivateKwOwnerAuthMutationOutbox` contains one immutable event per
committed record. Its unique record and event digests prevent duplicate
enqueueing. A contract trigger requires the exact committed idempotency row and
mirrored event JSON. Only delivery metadata may advance from `PENDING` to
`FAILED` or `DELIVERED`; the event identity and authority fields cannot change.

### Future D1 batch order

The disconnected plan in
`private-kw-owner-auth-idempotency-d1-plan.ts` fixes the future order:

1. reserve the key with database time inside the current verified session
   window;
2. reload the reservation and fail closed on a conflicting existing intent;
3. run the operation-specific mutation only when an embedded `RESERVED` claim
   predicate matches the exact owner, operation, boundary, and payload;
4. finalize the reservation with the exact result and database timestamps;
5. insert the outbox event and reload the committed row.

All five steps plus the operation-specific statement must share one D1 batch.
If a retry sees `COMMITTED`, it skips the mutation and replays the exact stored
result. A crash rolls back the entire batch, so a later retry can claim the key
again. The plan is deliberately non-executable until a future adapter supplies
the operation-specific mutation and proves its claim predicate.

## Options considered

### Completed-row insert without a reservation

Rejected. Two concurrent requests could both perform a non-idempotent mutation
before either completed row is visible.

### Mutable outbox identity and unrestricted status updates

Rejected. A relay must be able to advance delivery metadata, but it must never
rewrite the owner, operation, payload, or event identity.

### Apply D1 migration now

Rejected. Owner authentication, MFA, staging, backup, rollback, and an explicit
release gate are not complete. This checkpoint remains disconnected and
source-only.

## Consequences

- The future adapter has a concrete, testable transaction contract rather than
  an ambiguous “write it atomically” requirement.
- Schema checks protect replay identity and keep operational authority at zero.
- The migration intentionally cannot clean up abandoned reservations; a future
  release must choose a bounded recovery policy and test it before activation.
- No provider, route, UI action, database resource, deployment, migration, or
  spend is introduced by this ADR.

## Action items

1. [x] Add the source-only 0070 schema and guarded outbox.
2. [x] Add a typed, disconnected D1 plan with SQL-shape and fake-SQLite tests.
3. [ ] Review reservation recovery and operation-specific claim predicates.
4. [ ] Back up and validate a staging D1 database before any application.
5. [ ] Connect a real owner mutation only after explicit release approval and a
   rehearsed duplicate-delivery/rollback test.
