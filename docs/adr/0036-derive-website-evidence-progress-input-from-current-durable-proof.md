# ADR 0036 — Derive website-evidence progress input only from current durable proof

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

The shadow-slice progress contract requires a normalized
`CURRENT_WEBSITE_EVIDENCE` input, but the eligibility proof now survives process
loss in an append-only D1 record. Structural JSON, a successful fresh commit,
or an exact replay is not enough to prove that evidence is still current when a
later task resumes. Calling the generic progress appender directly would also
combine two trust decisions: deriving the phase input and changing the durable
resume checkpoint.

The boundary must remain useful across lost Codex tasks without turning stored
history into authority, bypassing the exact ten-business manifest, or quietly
connecting Browser Rendering, R2, D1, providers, real businesses, or spend.

## Decision

Add a validation-only adapter that accepts only the exact frozen in-process
result returned by the migration-0068 loader when its execution path is
`DURABLE_RELOAD` and its database-clock freshness state is `CURRENT`.

Before deriving an input, the adapter rechecks:

- the exact manifest identity, digest, slice, source plan, and ten-business
  business/candidate/source-record scope;
- the selected business, website URL, source URL, evaluation candidate, and
  source record;
- the one completed `SOURCE_WORKFLOW` predecessor and its exact receipt identity,
  digest, and completion time;
- the website-evidence proof and durable eligibility receipt identities,
  digests, workflow/audit/artifact lineage, and preparation time; and
- the half-open evidence window using the loader's database clock, durable row
  timestamp, evaluation time, proof preparation time, and caller recording time.

The returned phase input is deeply frozen and registered in a module-private
`WeakSet`. A structurally identical copy cannot cross the exported in-process
guard. Its authority comes from the existing all-false/zero progress contract.
The module does not import or call the progress appender or phase-receipt
builder, read D1 or R2, access runtime bindings, call providers, mutate data, or
authorize phase execution.

## Options considered

| Option | Continuity after process loss | Trust strength | Risk |
|---|---|---|---|
| Accept any schema-valid eligibility JSON | High | Low | Copied or stale history could impersonate current proof |
| Accept fresh commit, replay, or reload results | High | Medium | A mutation response could be reused without an independent later read |
| Accept only an exact current durable reload | High | High | Requires a separate reload and a later append boundary |

The exact current durable reload was selected because the extra read is a small
cost in a ten-business shadow pilot and preserves the distinction between
stored history, current evidence, and progress mutation.

## Trade-off analysis

Separating input derivation from progress append creates one additional typed
boundary and test surface. In exchange, a lost task can resume from durable
proof without trusting chat or copied JSON, stale evidence cannot advance the
chain, and a defect in input validation cannot itself write a checkpoint. The
design intentionally favors auditability and fail-closed recovery over a
one-call convenience path.

## Consequences

- A later process can derive the exact normalized phase input only after a new
  current database-clock reload.
- Fresh commits, exact replays, copied outputs, stale results, cross-business or
  cross-source lineage, predecessor replacement, and false chronology fail
  closed.
- This adapter leaves the existing progress checkpoint unchanged. ADR 0037
  separately defines a guarded in-memory append and still grants no durable or
  operational progress path.
- There is still no operator command, Worker import, live D1 binding, Browser/R2
  activation, real-business execution, provider operation, outreach, or spend.
- Static safety checks prevent accidental wiring to the Worker, runtime/data
  APIs, or generic progress writer.

## Action items

1. [x] Add the module-private durable-reload-only phase-input adapter.
2. [x] Test happy-path derivation, copied trust, commit response, stale evidence,
   false chronology, predecessor replacement, proof drift, unchanged progress,
   and zero authority.
3. [x] Add static safety enforcement for runtime, provider, mutation, and
   progress-writer isolation.
4. [x] Add the separate parent-bound guarded in-memory append boundary in ADR
   0037; keep durable, live, and real-business wiring separately approval-gated.
