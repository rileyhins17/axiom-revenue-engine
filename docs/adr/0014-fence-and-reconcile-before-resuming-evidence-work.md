# ADR 0014 — Fence and reconcile before resuming evidence work

- Status: accepted
- Date: 2026-08-23

## Context

Migration 0056 can retain immutable workflow and step receipts, but a step
`outputDigest` is only a summary identity. It is not enough information to
reconstruct page captures, HTML facts, Browser evidence, artifact write plans,
or the exact dependency chain after a crash or deployment.

Time-based leases alone are also unsafe. A slow worker can continue after its
lease expires and overwrite work started by a replacement unless every attempt
and write is rejected when a higher fencing token exists. Artifact storage adds
another boundary: a worker can create one or more immutable objects before its
checkpoint is committed.

## Decision

Define a fixture-only, validation-only resume contract for the website-evidence
workflow.

- A definition descriptor binds the exact workflow graph, checkpoint codec, and
  component versions. Version 1 has no implicit compatibility map: drift blocks.
- A delivery binds one exact request digest. Repeated copies with the same ID and
  content are visible duplicates; the same ID with different content blocks.
- Attempt numbers come from contiguous durable history. Each attempt owns one
  monotonically increasing fencing token and one exact lease claim.
- Every checkpoint has a full, bounded, schema-validated payload plus a
  content-addressed locator, full payload digest, byte length, output digest,
  direct committed dependencies, attempt, fence, and timestamps.
- Checkpoint validity requires the exact active lease at commit time and no
  higher fence acquired before the write. Dependencies must close on the current
  graph and reproduce the deterministic business result.
- Every artifact attempt retains the exact write plan and receipt. Store errors
  and completed-but-uncommitted side effects become explicit reconciliation
  work. Object-identity conflicts block. Immutable orphans are never rollback
  deleted.
- `COMPLETED`, `PARTIAL`, and unreachable completed audit receipts are terminal
  business results after their exact attempt seals them. A sealed result wins
  over later or still-unexpired lease state.
- An active running lease produces `WAIT_ACTIVE_LEASE`. Exact expiry is stale.
  An interrupted run may only propose the next attempt number and a strictly
  higher fencing token.
- A committed Browser-measurement checkpoint without a storage checkpoint falls
  back to the captured-subpage checkpoint and reconciles artifacts before
  measuring again. A final audit checkpoint can only continue to receipt
  finalization.
- Planner output is deterministic and content-digested. It always emits
  `mutationAuthorized: false`, `executionAuthorized: false`, zero provider
  operations, zero cost, and no deletion authority.

The fixture workflow exposes a fixture-only observation sink so tests can prove
that all eight full checkpoint outputs and every artifact attempt are retained.
This is not a database sink and cannot accept a non-fixture implementation.

## Decision precedence

The planner uses this order:

1. Validate snapshot time, request identity, exact definitions, and version
   metadata.
2. Validate attempt identity and any receipt revisions.
3. Return an exact sealed terminal result if one exists.
4. Validate lease history and wait for an active fenced owner.
5. Validate full checkpoint payloads, dependency closure, stale-worker fences,
   and deterministic cross-step reproduction.
6. Reconcile exact artifact plans or require all deterministic plans when a
   prepared side-effect boundary lacks a receipt.
7. Propose—but do not create—the next fenced attempt and continuation point.

## Options considered

| Option | Benefit | Rejected cost or risk |
|---|---|---|
| Resume from the latest step output digest | Small record | Digest cannot reconstruct state and can hide different full payloads |
| Resume from the latest array entry | Simple lookup | Interleaved attempts and branches make “latest” unsafe |
| Use lease expiry without fencing | Familiar lock model | A stale worker can still commit after takeover |
| Delete partial artifact writes before retry | Appears clean | Immutable content may be shared; deletion can destroy valid evidence |
| Full payloads, dependency closure, fencing, and reconciliation | Exact and testable continuation | More explicit records and validation; selected |

## Consequences

- A process restart can now be planned from exact evidence instead of chat or
  log reconstruction.
- Full payload divergence is detected even when legacy summary digests agree.
- Duplicate delivery, exact-expiry, stale-fence, deployment-interruption,
  prepared checkpoint, partial write, object-integrity, terminal partial result,
  and created-versus-reused artifact cases have deterministic tests.
- The new module has no D1/R2/Browser/Workflow executor, provider binding,
  network call, mutation path, or production authority.
- Migration 0056 does not yet contain these delivery, attempt, lease, locator,
  payload, and recovery records. A later additive persistence milestone must
  model and validate them before a real executor is designed.

## Follow-up

1. Add additive records and a validation-only persistence plan for deliveries,
   attempts, fenced leases, checkpoint payload locators, and artifact recoveries.
2. Add evidence-use ending and current-reference projections before retention
   cleanup can reason about live references.
3. Keep D1 execution, Cloudflare Browser/R2 adapters, Workflow deployment, and
   provider activity behind separate staging release gates.
