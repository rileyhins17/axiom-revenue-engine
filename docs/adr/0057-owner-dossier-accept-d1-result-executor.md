# ADR 0057 — Prove an owner-dossier commit from exact D1 results

- Status: Accepted for disconnected source-only implementation
- Date: 2026-09-05
- Technical proposal: Revenue Engine integration owner; activation approval pending

## Context

ADR 0056 defines the atomic SQL shape for `owner.dossier.accept`. That plan can
reserve one idempotency key, insert the exact signed owner decision, finalize the
reservation, create one outbox event, and reload the bundle in one batch. It did
not interpret Cloudflare D1 return objects, distinguish an absent key from a
complete replay, or recover safely when the client loses a response after the
database may have committed.

Cloudflare documents `D1Database.batch()` as an ordered transaction: one
statement failure aborts or rolls back the sequence, and results correspond to
the submitted statement order. A successful result also exposes
`meta.changes`; success alone does not prove that the intended row changed. The
executor therefore treats the SQL dependency chain as the atomicity control and
the returned counts plus exact reload as postconditions.

This checkpoint remains disconnected. It imports no generated environment,
Better Auth adapter, route, Worker, provider, file operation, or named D1
binding. Source migrations 0069 and 0070 remain unapplied outside disposable
tests.

## Decision

### Strengthen the plan contract before database access

The concrete plan advances to version 2 and now content-addresses:

- the owner-session start and expiry;
- canonical expected idempotency, signed decision, and outbox JSON;
- the exact normalized SHA-256 digest of all nine migration trigger bodies; and
- all previous identities, SQL statements, ordering, counts, and zero-authority
  constraints.

Before the first database call, the executor verifies the plan's signed owner
decision with the injected versioned binding material. A wrong key or version
cannot cause a write and then fail verification afterward.

### Interpret only exact D1-shaped results

The injected boundary prepares and batches statements but has no runtime
binding. Every response must have `success: true`, bounded SQL rows, and a
non-negative integer `meta.changes`. Cloudflare's documented `results: null`
form is normalized to an empty list before the exact per-statement checks.
Result counts and order must exactly match the plan.

The read batch must prove one of two states:

1. **ABSENT:** no idempotency row, no target decision, and no target outbox row;
   or
2. **COMMITTED:** exactly one matching idempotency row, signed owner-decision
   row, and pending outbox row.

A visible `RESERVED` row, duplicate row, partial bundle, mismatched canonical
JSON, wrong HMAC, identity drift, chronology drift, expired session, or trigger
drift fails closed. The trigger verifier hashes each normalized complete
`sqlite_master.sql` definition. It reads every trigger on the three guarded
tables, rejects any unexpected tenth trigger, verifies each object's type and
owning table, and requires one consistent `PRAGMA schema_version`. Keeping the
old trigger name, operation, and abort marker while weakening its body is
insufficient.

The fresh reservation and owner-decision statements carry two private sentinel
bindings. Only after the exact read succeeds does the executor replace both
sentinels with the observed schema version. Both SQL statements require that
version to remain current. A trigger or schema change between preflight and the
write therefore turns the operation into a zero-row/failing transaction rather
than letting stale preflight evidence authorize it. The recovery read then sees
the new schema and must independently pass the exact trigger set again.

### Require exact fresh counts and reload

The fresh result must report exactly one changed row for reservation, owner
decision, finalization, and outbox. Each mutation result must contain no rows.
The remaining results must reload exactly one complete bundle and a final
database timestamp inside the half-open authenticated session window. Fresh and
replayed bundles must also satisfy the complete order `reservedAt <=
decision.recordedAt <= committedAt = recordedAt <= outbox.createdAt <=
databaseNow`.

The executor creates the existing affected-row proof only from these validated
results. That proof still truthfully says `CALLER_COUNTS_VALIDATED_ONLY` and
`durableExecutionProven: false`: an injected boundary response is not proof that
a live Cloudflare database was used.

### Recover ambiguity only through a new read

Any fresh-batch exception or postcondition failure triggers exactly one new
read-only replay batch. The executor returns `EXACT_REPLAY` only when that new
observation proves the complete expected committed bundle. An absent,
reserved, partial, malformed, expired, or drifted reload remains a failure.
This covers both a losing reservation race and a lost response after a winning
commit without retrying the mutation.

Execution results are deeply frozen and exact-instance trusted. Copying their
JSON cannot manufacture durable proof or downstream authority.

## Consequences

- The first concrete owner operation now has a fail-closed D1 result state
  machine instead of relying on truthy responses.
- Exact replay performs no mutation and produces zero-change affected-row
  evidence.
- An ambiguous response can converge safely on the winner without a duplicate
  decision or outbox event.
- Trigger-body drift that retains familiar names and error strings is detected.
- Unexpected target-table triggers, wrong trigger ownership/type, and schema
  drift between preflight and write are detected before a commit can be
  classified.
- Both documented array and null mutation-result forms are interpreted without
  weakening row/count checks.
- The structural adapter is ready for a later isolated Miniflare/D1 rehearsal,
  but is intentionally unreachable from runtime and operator code.
- No owner action, route, UI button, progress append, deployment, migration,
  provider operation, outreach, send, or spend authority is introduced.

## Action items

1. [x] Add the disconnected parser/executor and D1-shaped boundary adapter.
2. [x] Prove fresh commit, exact replay, stale-preflight race recovery,
   post-commit response loss, trigger-body tamper, unexpected trigger, wrong
   trigger type/table, post-preflight schema drift, nullable mutation results,
   full timestamp chronology, reserved/partial state, affected-row metadata
   drift, malformed result count, copied trust, and wrong binding material in
   disposable tests.
3. [ ] Rehearse the unchanged adapter against an isolated disposable
   D1/Miniflare resource, including actual concurrent callers and process-loss
   recovery.
4. [ ] Re-review exact trigger digests whenever migrations 0069 or 0070 change;
   a migration change requires a new plan version and disposable proof.
5. [ ] Keep migration application, owner UI wiring, progress advancement, and
   staging/production activation behind their separate explicit gates.
