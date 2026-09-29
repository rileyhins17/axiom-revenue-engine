# ADR 0017 — Define atomic artifact-reference snapshot contracts before execution

- Status: accepted
- Date: 2026-08-24

## Context

ADR 0016 deliberately keeps reference projections fixture-asserted and
incomplete. A caller can calculate a digest for any JSON it supplies, so a
schema-valid object or digest cannot prove that every relevant database row was
read. Sequentially consistent reads are also not the same proof as one atomic
database snapshot.

Cloudflare documents `D1Database.batch()` as a transaction whose statements run
sequentially and whose complete sequence rolls back when one statement fails.
Cloudflare documents Sessions and bookmarks as providing sequential consistency,
not an interactive transaction that can remain open while application code
computes a projection. See the official [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
and [Sessions/read-replication guidance](https://developers.cloudflare.com/d1/best-practices/read-replication/).

Artifact availability is another boundary. The fixture availability object in
ADR 0016 is content-bound but not durable provider evidence. A complete D1
snapshot needs persisted availability observations, while the eventual trusted
executor must require a fresh, unambiguous R2 HEAD result for every manifest.

## Decision

Add migration `0059_atomic_artifact_reference_snapshots.sql` and a validation-only
atomic transaction plan.

### Append-only records

- `RevenueArtifactReferenceSnapshotAttempt` combines one immutable attempt with
  its bounded lease claim. Attempt numbers are contiguous, fencing tokens are
  strictly increasing, and both identities are unique per lineage root. Absence
  of a completeness receipt means the attempt is unsealed. Exact expiry is
  stale, so a later attempt may take over.
- `RevenueArtifactManifestAvailabilityReceipt` stores content-bound fixture or
  R2 HEAD observations. A future complete receipt must use one fresh,
  unambiguous `R2_HEAD` winner per manifest; fixture observations cannot satisfy
  that assurance.
- `RevenueArtifactReferenceCompletenessReceipt` binds one exact attempt/fence,
  query contract, snapshot window, all source-set proofs, and normalized source
  facts. It records `D1_ATOMIC_RECHECK_AND_RELOAD` and
  `R2_HEAD_PER_MANIFEST`, but grants no projection, retention, release,
  deletion, provider-operation, or cost authority.
- `RevenueArtifactReferenceSourceSetProof` stores the stable row identities,
  row count, predicate version, set digest, and proof digest for each source
  set. Proof digests are indexed but not globally unique because two valid
  snapshots can contain an identical set.

Migration 0058 remains unchanged. Its schemas still require
`FIXTURE_ASSERTED`, `snapshotComplete=false`, and cannot produce
`NO_CURRENT_REFERENCES`.

### Exact source sets

The versioned query contract reads these 15 sets in stable-ID order:

1. Workflow runs, including the alternate workflow/idempotency identity.
2. Workflow definitions.
3. Deliveries.
4. Attempts.
5. Leases.
6. Receipt revisions.
7. Attempt closures.
8. Every manifest for the workflow.
9. Every item for those manifests.
10. Every promotion declared for the workflow or touching one of its manifests.
11. Every use attached to those promotions.
12. Every manifest-use link touching the lineage or scoped promotions.
13. Every referenced evidence use, including a recursively referenced
    replacement use.
14. Every ending for that derived use set.
15. Every persisted availability candidate for the lineage manifests.

The broad, bidirectional predicates deliberately expose malformed cross-workflow
or cross-lineage rows so validation blocks them instead of silently omitting
them. No query truncates alternate collision candidates. Canonical proofs bind
every returned column, stable ID, count, query version, bindings through the
plan digest, and aggregate source digest. Counts alone are insufficient.

### Required transaction sequence

The future executor must follow this sequence:

1. In one D1 prepare/snapshot batch, inspect every attempt identity, return an
   exact sealed replay when one exists, conditionally claim the next contiguous
   attempt and higher fence, select the winner by every identity, and execute all
   15 source reads.
2. Reject a missing, multiple, expired, lower, or divergent winning attempt.
3. Outside provider operations, decode every canonical row, validate the full
   fenced workflow and lineage closure, select one fresh R2 availability receipt
   per manifest, and compute the deterministic projection.
4. In one commit batch, re-check the half-open lease, absence of a higher fence,
   and every source predicate/digest; collision-preflight every base and target
   identity; insert parents before children; insert the completeness receipt
   last; and select every result back exactly.
5. Reload the committed completeness row before returning a trusted result.

A crash after the claim leaves an expiring unsealed attempt. A failure inside
the commit batch rolls back the sequence. A post-commit retry returns the exact
sealed receipt. A source change between the first read and commit aborts.

### Trust boundary

The current module can build SQL artifacts and canonical row proofs, but every
caller-supplied observation remains:

- `transactionallyTrusted=false`
- `snapshotComplete=false`
- blocked by `TRUSTED_D1_COMMIT_AND_RELOAD_EXECUTOR_NOT_IMPLEMENTED`

The structural completeness-receipt schema is not an authorization API. Its
inspection function always reports untrusted. Only a future private executor
that performs the exact D1 transaction and reload can construct the trusted
runtime type. No such executor, binding, signing shortcut, or mutation function
exists in this checkpoint.

## Options considered

| Option | Benefit | Rejected cost or risk |
|---|---|---|
| Trust a caller-supplied digest | Small and easy | A caller can digest an omitted or invented row set |
| Use several D1 Session reads | Monotonic/sequential consistency | Does not prove one immutable snapshot while application code computes |
| Treat the fixture availability object as provider proof | Reuses v1 | Cannot prove current R2 object state |
| Mint a complete receipt in pure TypeScript | Easy tests | A fixture could impersonate the trusted database boundary |
| Versioned atomic plan plus untrusted proofs now; executor later | Exact and fail-closed | More explicit phases and a later staging implementation; selected |

## Consequences

- Generated SQL executes successfully in isolated SQLite and tests exact-expiry
  takeover, active-lease waiting, query drift, missing/duplicate source sets,
  wrong fences, forged receipt digests, and direct migration constraints.
- All 59 migrations replay from zero in isolated local D1.
- The source-writer guard is explicitly still incomplete. A fence protects only
  actors that honor it; therefore execution and completeness-receipt creation
  remain unauthorized.
- Migration 0059 is not applied to staging or production.
- No D1/R2/Browser binding, provider read, workflow runner, deployment,
  production write, retention conclusion, release, or deletion path is added.

## Follow-up

1. Implement a fixture/in-memory decoder that validates every raw base row,
   alternate identity, sealed workflow history, lineage closure, and latest
   availability winner against the existing domain schemas.
2. Design the trusted D1 executor and all source-writer fence guards; stage it
   only after an explicit backup, rollback, migration, and binding gate.
3. Add projection v2 only after the executor can reload a committed receipt;
   keep retention review and provider deletion behind later owner/compliance
   gates.
