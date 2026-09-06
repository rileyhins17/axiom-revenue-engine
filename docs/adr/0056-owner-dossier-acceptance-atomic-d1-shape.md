# ADR 0056 — Make owner-dossier acceptance fail atomically before D1 can commit

- Status: Accepted for source-only design
- Date: 2026-09-05
- Technical proposal: Revenue Engine integration owner; owner activation approval pending

## Context

Migration 0069 can store one authenticated owner decision. Migration 0070 can
reserve an idempotency key, finalize its exact result, and create one outbox
event. The remaining design gap was the operation between those two contracts:
inserting the exact `RevenuePrivateKwOwnerDecision` row for
`owner.dossier.accept`.

Cloudflare documents `D1Database.batch()` as a transaction whose statements run
sequentially and whose whole sequence rolls back when a statement fails. A
successful statement that changes zero rows does not fail, however; its result
simply reports zero changes. See the current [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
and [D1 return-object documentation](https://developers.cloudflare.com/d1/worker-api/return-object/).
Application code that inspects a zero count only after `batch()` returns is too
late to undo a committed partial sequence.

This ADR defines and exercises one concrete source-only transaction. It does
not connect a D1 binding, apply a migration, expose an owner route, append
progress, deliver an outbox event, deploy, contact anyone, or authorize spend.

## Decision

### Bind one exact owner action

The concrete transaction accepts only `owner.dossier.accept`. Its request digest
binds the exact authenticated owner-decision record ID, record digest, business,
and read-only-shadow decision. Its stored idempotency result names that same
record and outcome. Before producing SQL, the plan requires the exact in-process:

- owner-auth server boundary;
- idempotency result;
- authenticated owner-decision record; and
- rechecked Better Auth session/HMAC binding.

Owner, session window, operation, payload, result, business, record identity,
and chronology must all agree. The finished plan is content-addressed, deeply
frozen, and accepted only as the exact in-process instance.

### Separate absent, blocked, and replay paths

A future adapter first reads the required migration guards, database time,
idempotency row, owner-decision row, and outbox row in one read batch.

- No idempotency row and no conflicting decision/outbox permit a fresh attempt.
- A visible `RESERVED` row remains blocked under ADR 0054.
- A `COMMITTED` row can return only after the exact decision, idempotency result,
  and outbox bundle reloads without mutation.
- Missing, partial, conflicting, or guard-drifted state fails closed.

The current checkpoint builds these preflight/replay queries but does not yet
implement the future D1 result parser or retry loop.

### Make fresh-path failures become SQL errors

The fresh batch uses this fixed order:

1. regular `INSERT` of the reservation;
2. regular `INSERT` of the exact owner decision, gated by the full reservation
   claim, current database-time session window, and all migration 0069/0070
   writer guards;
3. one reservation-to-commit `UPDATE`, additionally gated on the exact stored
   owner decision and `changes() = 1` from the immediately preceding decision
   insert;
4. regular `INSERT` of one outbox event;
5. exact reload of the idempotency row;
6. exact reload of the owner-decision row;
7. exact reload of the outbox row; and
8. a final database-time read.

Fresh reservation and outbox inserts deliberately do not use `OR IGNORE`.
A losing concurrent reservation therefore raises a unique-key error instead of
silently changing zero rows. The outbox `recordId` is selected from the exact
`COMMITTED` idempotency row into a non-null column. If the operation or
finalization changed zero rows, finalization sets its required state to `NULL`
or the outbox statement cannot find a committed row; either dependency raises a
database error. An exact decision left by an older or differently keyed attempt
therefore cannot impersonate a decision inserted by this transaction. D1's
documented batch behavior must then roll back the whole fresh attempt.

After a successful batch, a future adapter must still require reported changes
of exactly `1, 1, 1, 1` for reservation, owner decision, finalization, and
outbox, followed by exact reload. Those postconditions detect response or
adapter drift; the SQL dependency chain is what prevents a zero-row partial
operation from committing.

The disposable SQLite harness can inspect each affected-row count while its
local transaction is still open and throws immediately on any mismatch. That
is an additional test-harness control, not an assumption about the future D1
adapter: D1 returns batch metadata after the transactional batch. The D1-safe
control is therefore the SQL error dependency above; returned metadata and the
exact durable reload are post-batch verification.

### Treat a losing race as a new observation

If two callers both preflight an absent key, only one regular reservation insert
can commit. The losing batch aborts. It may then perform a new read-only
preflight and return `EXACT_REPLAY` only if the full committed bundle matches
the same request and result. Any other state remains a conflict or visible
reservation; it cannot be converted into success by the caught exception.

## Options considered

### Keep `INSERT OR IGNORE` throughout the fresh batch

Rejected. It is convenient for replay but converts conflicts and missing work
into successful zero-row statements. A later JavaScript count check cannot roll
back a batch that already returned.

### Inspect affected-row counts only after `batch()`

Rejected as the primary safety mechanism. Post-commit inspection is useful for
detecting adapter drift, but it is not an atomicity control.

### Put reservation, owner decision, finalization, and outbox in separate calls

Rejected. A crash between calls could leave the owner decision without replay
state or the replay state without an outbox event.

### Use regular inserts plus a commit-dependent outbox insert

Selected. Primary-key conflicts become statement errors, the exact reservation
claim gates the owner row, the finalization depends on that row, and the outbox
insert depends on the committed result. Any broken link aborts the documented
transactional batch.

## Consequences

- The first concrete owner mutation now has a reviewable target and fixed SQL
  order instead of an abstract operation placeholder.
- Fresh commit, full read-only replay equality, a deterministic stale-preflight
  race interleaving, all nine trigger-loss cases, a zero-row operation with its
  exact decision pre-existing and without JavaScript count enforcement, partial
  replay bundles, and injected failure after every statement can be exercised
  against the exact migration chain in disposable in-memory SQLite.
- An independent valid owner decision/idempotency/outbox bundle is retained
  unchanged through the target commit, replay, trigger loss, and every injected
  rollback case.
- The generic `OR IGNORE` plan from ADR 0053 remains a non-executable historical
  shape; it is not sufficient for this concrete fresh mutation.
- The next adapter must parse current D1 result metadata, verify every required
  trigger rather than merely count rows, and re-read after a caught race before
  classifying it.
- This design still does not prove Cloudflare D1 execution, durability, or
  process-loss recovery. A disposable SQLite transaction is evidence about the
  SQL contract only.
- No live resource, route, UI control, provider, mailbox, prospect, deployment,
  migration application, or cost authority is introduced.

## Action items

1. [x] Add the content-addressed concrete transaction plan for
   `owner.dossier.accept`.
2. [x] Exercise migration 0069 plus 0070 in disposable in-memory SQLite for one
   fresh commit, exact read-only replay, a deterministic stale-preflight race,
   all nine guard-loss cases, SQL-enforced zero-row rollback despite a
   pre-existing exact decision, partial-bundle visibility, unrelated-bundle
   preservation, and rollback after every statement. Actual concurrent D1
   execution remains part of action 4.
3. [ ] Add a disconnected D1-result parser/executor that verifies exact trigger
   definitions, database time, affected-row metadata, durable row identity, and
   the post-race reload without importing a live binding.
4. [ ] Rehearse that adapter against an isolated disposable D1/Miniflare resource
   before any staging migration proposal.
5. [ ] Keep owner email verification, MFA/recovery, backup, rollback, and the
   existing explicit release approval as activation gates.
