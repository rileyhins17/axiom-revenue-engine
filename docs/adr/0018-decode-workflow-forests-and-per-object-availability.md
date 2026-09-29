# ADR 0018 — Decode workflow forests and per-object availability before trust

- Status: accepted
- Date: 2026-08-24

## Context

ADR 0017 defined 15 complete source queries, but two details were still too
ambiguous for a safe decoder.

First, one website-evidence workflow can legitimately produce several
independent `ARTIFACT_WRITE` manifests: for example, separate desktop and mobile
evidence for several pages. The atomic queries intentionally load every manifest
for the workflow, while the existing reference projector reasons from one
lineage root. Treating the whole workflow as one lineage would reject valid
evidence; silently filtering rows would hide collisions and make the source-set
proof disagree with the projected facts.

Second, migration 0059 had columns for an availability receipt but no domain
contract for its JSON. A digest of expected object keys proves only what the
caller hoped to find. It does not prove that R2 returned matching objects.

## Decision

### Validate a workflow forest, then select one explicit root

The raw-row decoder validates the complete workflow-wide source set as a forest:

- Every `ARTIFACT_WRITE` manifest must appear exactly in the sealed terminal
  workflow receipt.
- Every promoted manifest must have one exact completed promotion parent and
  matching promotion provenance.
- Every manifest row, embedded manifest, and manifest-item row must agree.
- Cycles, multiple parents, disconnected non-root manifests, cross-workflow
  promotions, missing rows, and surplus rows block validation.
- The decoded result records every forest root and a digest of the complete
  validated forest.

One `lineageRootManifestId` then selects one connected component for projection.
Other valid roots remain explicit as `disconnectedRootManifestIds`; they are not
silently discarded. Source-set proofs and counts continue to cover all raw
workflow rows, while the selected source-facts digest covers the chosen lineage.
Future projections run once per root rather than pretending a workflow forest is
one lineage.

### Availability v2 binds exact HEAD observations

`artifact-manifest-availability-v2` now contains one canonically ordered object
observation for every manifest item. Each observation binds:

- artifact kind, reference, object key, expected length, expected SHA-256, and
  expected ETag;
- `PRESENT`, `MISSING`, or `UNKNOWN` state; and
- complete observed length, SHA-256 metadata, and ETag for `PRESENT` objects.

The object-set digest covers the full observation array, not only expected keys.
The receipt digest covers the complete receipt, including manifest digest,
checker, timestamps, derived aggregate state, provider-read fact, and all
zero-authority fields.

A snapshot winner must be the only latest receipt for its manifest, use
`R2_HEAD`, report a provider read, derive `VERIFIED_PRESENT` from every exact
object, occur no earlier than manifest verification and no later than the
snapshot, and remain valid through the snapshot. Equal-time candidates are
ambiguous even when one is a fixture. `SHADOW_30D` manifests require a future
expiry and protected retention classes forbid one; claimed validity cannot pass
the expiry boundary.

### Strict raw-row decoding

All 15 source sets use exact-column schemas. The decoder parses every stored JSON
document with its existing domain schema, requires canonical serialization,
recomputes every digest, and compares every denormalized column. It also checks
alternate identities, contiguous attempts and monotonically increasing fences,
one lease per attempt, immutable closures, one sealed terminal business result,
promotion/use/link equality, recursive replacement-use closure, and availability
winners.

The decoder has no database, provider, Worker binding, persistence function, or
executor. Its successful result remains:

- `transactionallyTrusted=false`
- `snapshotComplete=false`
- blocked by `TRUSTED_D1_COMMIT_AND_RELOAD_EXECUTOR_NOT_IMPLEMENTED`
- zero authority for projection persistence, retention conclusions, release,
  deletion, provider operations, and cost

## Options considered

| Option | Benefit | Rejected cost or risk |
|---|---|---|
| Treat every workflow manifest as one lineage | Simple projection input | Rejects valid multi-page workflows and invents parent relationships |
| Filter to one root before validating rows | Small selected payload | Hides malformed boundary rows and breaks raw-proof/count correspondence |
| Create one projection per validated forest root | Exact lineage meaning and complete collision visibility | Requires explicit forest and selected-facts digests; selected |
| Digest only expected R2 keys | Small receipt | Does not prove provider observations or object integrity |
| Bind every expected and observed object fact | Reproducible provider evidence | Larger receipts and stricter adapter requirements; selected |

## Consequences

- A real in-memory D1 integration fixture now persists sealed workflow history,
  multiple independent manifests, manifest items, and availability receipts,
  executes all 15 generated source queries, and decodes the results.
- Tests cover order independence, denormalized drift, missing closure, wrong
  root, unexpected schema columns, missing manifest items, fixture/stale/future
  availability, and ambiguous latest receipts.
- Existing replacement, promotion-lineage, exact-expiry fence, and migration
  tests remain part of the full gate.
- Migration 0059 is unchanged and remains unapplied to staging and production.
- No R2 HEAD adapter, D1 executor, completeness-receipt issuer, source-writer
  guard, live binding, provider call, deployment, or cost path exists.

## Follow-up

1. Design the private D1 executor contract and fence every source writer before
   any completeness receipt can be issued.
2. Add a fixture-only projection-v2 adapter from one selected decoded lineage;
   keep persistence and retention conclusions disabled.
3. Design the R2 HEAD staging adapter and smoke-test gate separately; do not add
   a live binding until backup, rollback, budget, and owner approval are recorded.
