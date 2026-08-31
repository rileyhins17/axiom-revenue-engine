# ADR 0038 — Trust assessments only after exact durable reload

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

The shadow assessment writer already commits one website snapshot, its evidence
claims, one qualification snapshot, and one final assessment receipt through a
single D1 batch. Migration 0061 prevents later updates or deletes. The
assessment progress-proof builder nevertheless accepted any
schema-valid `RevenueLeadAssessmentD1Execution` object. A copied or hand-built
JSON object could therefore claim that persistence occurred without crossing a
database trust boundary.

The writer's immediate commit response is also insufficient after a process,
task, or deployment boundary. Resumable work needs to prove the exact stored row
set, its original sealed workflow source, its current database-clock freshness,
and the presence of the immutable migration guards every time it resumes.

## Decision

Add a read-only durable assessment reload to the existing private injected D1
adapter. It accepts only an assessment ID and digest, then performs two bounded
read batches:

1. Verify all eight exact migration-0061 update/delete triggers, read the D1
   clock, and load the exact assessment receipt by both ID and digest.
2. Load the sealed terminal workflow receipt, current business identity, website
   snapshot, complete evidence-claim set, qualification snapshot, and final
   assessment receipt.

The boundary parses the canonical stored assessment JSON, checks every mirrored
receipt column, reconstructs the original assessment request, and calls the
deterministic assessment builder again using the durable business and sealed
workflow source. The rebuilt assessment must be canonically identical. Every
persisted row must then exactly match the record plan derived from that rebuilt
assessment; missing, extra, ambiguous, or drifted data fails closed.

Freshness is classified exclusively from the D1 clock as `NOT_YET_CURRENT`,
`CURRENT`, or `STALE`. The returned `DURABLE_RELOAD` result is deeply frozen and
registered in a module-private `WeakSet`. Consumers must present that exact
in-process object. Schema parsing alone, serialization, or `structuredClone`
cannot recreate trust.

The assessment progress-proof builder now accepts only an exact `CURRENT`
durable reload. Its proof timestamp is the durable D1 clock, not a caller-owned
timestamp. It records the reloaded row counts, receipt time, freshness, sealed
source rebuild, and writer-guard verification. No `ASSESSMENT` phase input or
progress append is created by this decision.

## Options considered

### Option A — Keep trusting the writer response

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Resume safety | Low |
| Database provenance | Low |
| Operational risk | High because copied JSON can impersonate persistence |

### Option B — Parse a receipt row without rebuilding source lineage

| Dimension | Assessment |
|---|---|
| Complexity | Low to medium |
| Resume safety | Medium |
| Database provenance | Medium |
| Operational risk | Medium because internally consistent drift can survive |

### Option C — Exact guarded reload plus deterministic source rebuild

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Resume safety | High |
| Database provenance | High |
| Operational risk | Low within the private database trust boundary |

Option C was selected. The additional bounded reads and deterministic rebuild
are negligible for a ten-business pilot and materially reduce the chance that
stale, copied, partial, or drifted state becomes business progress.

## Trade-off analysis

The exact-object requirement intentionally does not survive serialization. A
new task must call the durable reload again, which is the point: current trust
comes from current database evidence rather than inherited chat state. The
design reuses schema 0061 instead of adding another table or migration because
the needed row set and eight append-only guards already exist. A privileged
database administrator can still replace schema objects; that authority remains
outside the application trust boundary and is controlled by deployment,
migration, backup, and access procedures.

## Consequences

- Fresh writer responses and exact replay responses remain useful diagnostics
  but cannot become assessment progress proof.
- Process-loss recovery starts from an ID and digest and must reload the exact
  durable row set.
- Copied reload envelopes, missing triggers, row drift, changed business/source
  facts, stale history, and caller-clock substitution fail closed.
- Durable stale assessments remain visible history but cannot be treated as
  current progress evidence.
- The loader performs database reads only and grants no qualification execution,
  phase-input creation, progress append, deployment, provider, outreach, send,
  or cost authority.
- No operator command, Worker route, live binding, real-business run,
  deployment, or migration is introduced.
- ADRs 0039 and 0040 close the assessment input/append gap while keeping the
  transition in memory. Durable/operator progress and the following contact
  review proof remain separate future boundaries.

## Action items

1. [x] Add the exact guarded D1 durable assessment reload and module-private
   trust registry.
2. [x] Rebuild the assessment from its sealed workflow source and verify every
   immutable assessment row.
3. [x] Derive freshness from the D1 clock and require `CURRENT` for progress
   proof.
4. [x] Replace schema-valid execution JSON and caller time in the assessment
   progress-proof builder.
5. [x] Add adversarial tests for copied trust, missing guards, row drift, source
   drift, and stale database time.
6. [x] Design the separate zero-authority `ASSESSMENT` phase-input adapter in
   ADR 0039, bound to the exact current manifest and parent checkpoint without
   appending progress.
