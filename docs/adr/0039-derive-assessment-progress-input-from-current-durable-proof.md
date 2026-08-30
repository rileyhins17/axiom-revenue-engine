# ADR 0039 — Derive assessment progress input from current durable proof

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0038 makes one persisted lead assessment trustworthy only after an exact,
database-clock-checked durable reload. The assessment proof then binds that
reload to the selected business and its completed website-evidence predecessor.
The generic progress recorder still accepts any schema-valid phase input,
however, so passing proof JSON directly into it would discard the stronger
durable and in-process provenance.

The ten-business shadow slice can also advance unevenly. An assessment input
must bind the exact complete parent checkpoint without incorrectly requiring
the selected business to be the last business updated. Conversely, an edited
and re-hashed checkpoint timestamp or a checkpoint newer than the durable
database read must not become a valid parent.

## Decision

Add a validation-only `ASSESSMENT` phase-input adapter that accepts the manifest,
the full parent checkpoint, the current website-evidence proof, and the exact
in-process `CURRENT` result of the durable assessment reload.

The adapter:

- rechecks the exact manifest identity, digest, source plan, ten-business scope,
  selected business, evaluation candidate, source record, business name, URLs,
  independence, and research-only state;
- requires exactly the source/workflow and current-website-evidence receipt
  prefix, with `ASSESSMENT_APPROVAL` as the selected business's next gate;
- regenerates `assessment-proof:*` internally from the exact durable reload
  rather than accepting caller-supplied proof JSON;
- verifies that the parent checkpoint timestamp equals the latest recorded
  receipt across the complete cohort and that D1 time is not older than that
  parent;
- uses the durable assessment receipt time as `completedAt` and the durable D1
  clock as `recordedAt`, with no caller-owned clock;
- returns one deeply frozen, zero-execution-authority phase input registered in
  a module-private `WeakSet`; and
- privately binds that exact input to the manifest ID/digest and parent
  checkpoint ID/digest in a `WeakMap`.

A content-equivalent manifest or parent reloaded safely from storage can be
presented to the parent guard, but copied phase-input JSON cannot recreate
in-process trust. The adapter does not import the generic appender or receipt
builder and has no file, database, runtime, provider, operator, or live-data
path.

## Options Considered

### Option A — Pass assessment proof JSON to the generic recorder

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Resume safety | Low |
| Provenance strength | Low |
| Operational risk | High because copied proof can become progress |

### Option B — Reload the assessment and append progress in one function

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Resume safety | Medium |
| Provenance strength | High |
| Operational risk | Medium because a read boundary also mutates progress |

### Option C — Derive a parent-bound in-process input without appending

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Resume safety | High |
| Provenance strength | High |
| Operational risk | Low because derivation has no write path |

Option C was selected. The extra boundary is small for a ten-business pilot and
preserves the separation between proving an assessment and changing the resume
checkpoint.

## Trade-off Analysis

Exact in-process trust intentionally expires at a process boundary. A later task
must reload the assessment from D1 and derive the input again, which provides a
fresh database clock and catches changed rows or guards. Binding the full parent
means any cohort progress change requires re-derivation, but an unrelated valid
business update is allowed once the input is rebuilt against that new parent.
This costs a bounded read and validation pass while avoiding implicit merge or
rebase semantics.

## Consequences

- A copied writer response, durable reload clone, proof, or phase input cannot
  advance assessment progress.
- Stale assessments, mismatched businesses, website-proof drift, incomplete
  predecessors, forged checkpoint chronology, and parents newer than D1 time
  fail closed.
- Another business may validly advance before input derivation; the selected
  assessment remains usable when the complete new parent is canonical and the
  durable reload clock is current enough.
- The existing progress checkpoint remains unchanged by this adapter.
- A separate guarded append boundary is still required before any assessment
  receipt can be added, and durable/operator/live-data wiring remains separately
  approval-gated.
- No real business, database, Cloudflare resource, provider, mailbox, prospect,
  deployment, migration, or paid runtime is touched by this decision.

## Action Items

1. [x] Add the durable-reload-only, internally proof-rebuilding phase-input
   adapter.
2. [x] Bind exact inputs privately to their manifest and complete parent
   checkpoint.
3. [x] Prove copied trust, stale state, lineage drift, missing predecessor,
   forged parent time, valid unrelated-business progress, and zero authority.
4. [x] Add static safety checks forbidding appender, operator, Worker, database,
   provider, file, runtime, and caller-clock wiring.
5. [ ] Design a separate exact-parent guarded in-memory assessment append. Do
   not add durable, operator, live-data, or real-business wiring in that change.
