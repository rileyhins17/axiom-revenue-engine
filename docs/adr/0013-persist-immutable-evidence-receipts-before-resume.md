# ADR 0013 — Persist immutable evidence receipts before authorizing resume

- Status: accepted
- Date: 2026-08-23

## Context

The fixture website-evidence workflow now proves eight business checkpoints, but
its result existed only in process memory. A retry could reproduce the same
content-addressed result, yet another worker could not inspect prior attempts,
detect stored drift, or distinguish a failed attempt from a later successful
attempt using durable records.

Persisting only one mutable workflow row would erase attempt history. Persisting
only one opaque JSON blob would make owner-facing status, provenance checks, and
safe resume decisions difficult to query and constrain. Connecting a live D1
executor now would also combine schema design with production mutation authority.

## Decision

Add migration `0056_durable_evidence_receipts.sql` and a fixture-only,
validation-only persistence planner.

- A workflow run is the stable request identity. Each attempt produces a
  separate immutable workflow-receipt revision.
- Step receipts belong to the exact receipt revision, not only to the workflow
  run. A failed attempt and a later successful attempt can therefore coexist.
- Page selection, candidate decisions, audit assembly, artifact manifests,
  manifest items, promotion/release receipts, and evidence-use relationships are
  normalized for owner queries while their exact versioned JSON and SHA-256
  digest are retained.
- The aggregate workflow receipt carries the exact manifest derived from every
  successful artifact write. A promotion source must already exist in that
  workflow's receipt or an earlier ordered promotion; a release cannot introduce
  a new manifest.
- Each proposed `INSERT OR IGNORE` has one exact preflight. An existing row is
  accepted only when every expected stored field matches; alternate idempotency
  collisions or drift stop the plan.
- The plan is bounded, shadow-only, fixture-only, zero-cost, and explicitly emits
  `mutationAuthorized: false` and `resumeAuthorized: false`. It has no D1 client,
  executor, provider import, network access, update, or delete path.

Migration 0056 is additive and is verified only against isolated local stores in
this checkpoint. It is not applied to staging or production.

## Options considered

| Option | Benefit | Rejected cost or risk |
|---|---|---|
| Mutate one current workflow row | Small schema and simple reads | Loses failed-attempt history and makes duplicate delivery ambiguous |
| Store only opaque receipt JSON | Fastest write path | Weak owner queries, weak relational provenance, and fewer database constraints |
| Normalized immutable records plus exact JSON | Queryable status and strong replay/audit evidence | More tables and careful insertion ordering; selected |
| Wire a live D1 executor immediately | Proves runtime writes sooner | Couples contract mistakes to live state and grants authority too early |

## Consequences

- A future operator screen can explain the exact attempt, step, page decision,
  manifest, evidence use, promotion, and release record without parsing logs.
- Exact retries are idempotent; a changed row or reused identity with different
  content becomes an explicit conflict instead of being silently ignored.
- A step `outputDigest` proves identity but is not a replay payload or artifact
  locator. Durable resume remains prohibited until a separate planner defines
  checkpoint payloads, compatibility, leases, and duplicate-delivery behavior.
- Evidence-use rows currently represent known active references. They do not yet
  record a use ending, so no current reference count or deletion decision may be
  inferred from these tables.
- A future executor must reproduce and revalidate the canonical plan, require all
  exact preflights, use a transaction where supported, and pass a separate
  release gate before it can mutate any environment.

## Follow-up

1. Define versioned checkpoint payload/locator records and a deterministic resume
   planner covering version drift, stale leases, duplicate delivery, partial
   writes, and deployment interruption.
2. Add evidence-use ending/current-reference semantics before any retention
   cleanup planner can calculate whether an artifact remains referenced.
3. Keep Browser, R2, D1 execution, Workflow deployment, and provider operations
   behind their own staging release gates.
