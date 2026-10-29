# ADR 0015 — Persist fenced resume history without executing it

- Status: accepted
- Date: 2026-08-23

## Context

ADR 0014 defined the exact delivery, attempt, lease, checkpoint, artifact, and
terminal-receipt history needed to resume a website-evidence workflow safely.
Migration 0056 cannot store that reconstruction state. It retains aggregate and
step receipts, but not full checkpoint payloads or the fencing history that
proves which worker was allowed to produce them.

Two records in the resume contract are snapshots rather than immutable facts:
an attempt changes from `RUNNING` to an ended state, and a checkpoint can change
from `PREPARED` to `COMMITTED`. Storing either snapshot under one stable primary
key would require an update or make the valid transition look like corruption.

The migration-0056 preflight style also used one `OR (...) LIMIT 1` query. If a
primary key matched one row and an alternate identity matched another, that
query could inspect only one conflict candidate.

## Decision

Add migration 0057 and a fixture-only, validation-only persistence planner.

- Store the shared workflow definition, stable workflow request, deliveries,
  attempt identities, and exact lease claims as immutable records.
- Treat the absence of an attempt closure as `RUNNING`. An attempt gets at most
  one immutable `FAILED`, `SEALED`, or `ABANDONED` closure. A sealed closure must
  reference its exact terminal receipt revision.
- Store each full checkpoint payload under its content digest and locator. Keep
  stable checkpoint identity separate from append-only `PREPARED` and
  `COMMITTED` state receipts.
- Enforce one step and one ordinal per attempt. Preserve exact dependency links
  to both the parent checkpoint and dependency payload digest.
- Store artifact recovery plans separately from retry receipts. This permits a
  failed write followed by a completed reconciliation without duplicating or
  silently changing the original byte-bound plan.
- Encode transient `Uint8Array` plan bytes as explicit base64-tagged canonical
  JSON. The stored record remains fixture-only; a future loader must decode and
  schema-validate it before use.
- Give every alternate collision identity a database `UNIQUE` constraint.
  Preflights return every matching row with no `LIMIT 1`; zero matches means
  missing, one exact match means idempotent, and drift or multiple matches block.
- Reject a resume snapshot whose deterministic decision is `BLOCKED` before
  returning any SQL plan.
- Emit ordered `INSERT OR IGNORE` statements only as data. The module has no D1
  client, transaction, lease acquisition, workflow runner, provider binding, or
  mutation function.

The planner always returns `mutationAuthorized: false`,
`resumeAuthorized: false`, `executionAuthorized: false`, zero provider
operations, and zero authorized cost.

## Options considered

| Option | Benefit | Rejected cost or risk |
|---|---|---|
| Update attempt/checkpoint rows in place | Familiar current-state model | Erases the history needed to prove crash and stale-worker safety |
| Store every full snapshot as an unconstrained revision | Fully append-only | Allows conflicting closures or repeated state claims without a current-state rule |
| Keep artifact plan and receipt in one row | Fewer tables | Repeats large byte-bound plans and weakens plan-identity collision checks |
| Use `OR (...) LIMIT 1` preflights | Small query result | Can hide a second row reached through an alternate unique identity |
| Stable identities plus constrained closures/state receipts | Immutable, queryable, retry-safe | More explicit tables and ordering; selected |

## Consequences

- A valid RUNNING-to-ended or PREPARED-to-COMMITTED transition no longer needs
  to overwrite durable history.
- Duplicate delivery, attempt/fence collision, closure collision, checkpoint
  drift, alternate-key collision, exact replay, terminal sealing, and artifact
  recovery all have deterministic tests against the real SQLite schema.
- All 57 migrations replay from zero in isolated local D1 storage.
- Migration 0057 is not applied to staging or production.
- `INSERT OR IGNORE` is not lease acquisition. A future executor must use one D1
  transaction to re-read terminal/current state, claim the next fence, insert
  exact rows, and post-verify the winning identity before any step executes.
- The fixture payload table proves the recovery contract, but it is not yet a
  production storage decision for large payloads. Browser/R2/D1 size limits and
  rollback must pass a separate release gate.

## Follow-up

1. Add evidence-use ending and current-reference projections without deletion
   authority.
2. Design transaction and loader contracts separately; do not add a D1 executor
   until atomic fence acquisition, decoding, idempotency, and rollback tests pass.
3. Keep Browser, R2, Workflow, staging bindings, and provider activity behind
   their own explicit release gate.
