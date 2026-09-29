# ADR 0019 — Freeze atomic source writers inside D1

- Status: accepted
- Date: 2026-08-24

## Context

The atomic snapshot plan can read all 15 source sets in one D1 batch, but the
future executor must leave that transaction to decode rows and build the exact
receipt. A source write during that gap could make a valid first read stale.
Rechecking row counts in application code is not enough, and an application-only
lock protects the database only when every old, retrying, or future writer
remembers to call it.

The source sets are wider than one artifact root. They include the whole workflow
forest, alternate workflow identity, promotions touching any workflow manifest,
manifest and promotion use links, recursively replaced evidence uses, use endings,
and persisted availability. A guard on only the selected root would therefore be
incorrect.

## Decision

Migration `0060_artifact_reference_source_writer_guards.sql` installs database
triggers with two separate guarantees.

### Source records are append-only

All 15 source tables reject every `UPDATE` and `DELETE`. The snapshot attempt,
completeness receipt, and source-set proof tables are also immutable. Corrections
are new records with new identities; they never rewrite the history that an
earlier receipt claims to have observed.

### An active attempt freezes its complete workflow source set

Each source table has a scoped `BEFORE INSERT` trigger. It aborts with the stable
`ARTIFACT_REFERENCE_SOURCE_FROZEN` code when the insert would alter the source set
of any unsealed snapshot attempt whose database-time window is:

`acquiredAt <= now < expiresAt`

The trigger scope follows the exact query contract:

- direct workflow records use `workflowRunId`;
- workflow identity also covers the alternate kind/idempotency pair;
- items and availability follow their manifest's workflow;
- promotions follow their declared workflow plus source and result manifests;
- promotion and manifest-use links follow those promotion/manifest scopes; and
- evidence uses and endings follow the recursive replacement closure.

The claim and first source read remain one D1 batch. D1 serializes a concurrent
writer either before that batch, in which case the read sees it, or after the
claim, in which case the database trigger rejects it. A writer may proceed after
the exact expiry boundary or after the attempt is sealed. The future commit still
must reject an expired or superseded fence and reload the committed receipt.

R2 HEAD observations are provider work and cannot occur while D1 holds a
transaction open. They must be collected and persisted before claiming the
snapshot. Availability inserts are frozen with every other source after claim.

The atomic plan now targets schema 0060 and records
`allSourceWritersGuarded=true`. This means the schema precondition is satisfied;
it does **not** mean a trusted executor exists. Completeness receipt creation,
execution, projection persistence, retention conclusions, release, deletion,
provider operations, and cost remain unauthorized.

## Options considered

| Option | Benefit | Rejected cost or risk |
|---|---|---|
| Re-read counts in TypeScript | Easy | Counts miss same-size drift and do not freeze concurrent writers |
| Require every writer to call an application lock | Small migration | One forgotten or old writer defeats the snapshot |
| Keep a D1 transaction open during decoding/provider work | Simple mental model | D1 batch does not expose an interactive transaction across application work |
| Database append-only and scoped freeze triggers | Enforced for every writer and retry | More trigger SQL and exact scope tests; selected |

## Consequences

- The guarded schema has 51 triggers: three for each of 15 source tables and two
  immutability triggers for each of three transaction-control tables.
- In-memory integration tests enumerate every required trigger, attempt update
  and delete against every source table, and exercise direct, manifest,
  promotion, recursive-use, and availability insert freezes.
- Unrelated evidence-use inserts remain possible because they do not change the
  active workflow source set.
- A sealed attempt unlocks new inserts while all existing rows remain immutable.
- Migration 0060 is local-only. It has not been applied to staging or production.
- No D1 binding, executor, completeness issuer, projection writer, provider call,
  deployment, runtime cost, or outreach action is added.

## Follow-up

1. Implement the private transaction executor against an injected D1 batch
   boundary and prove claim/read, exact recheck, ordered commit, post-verification,
   and committed-row reload in disposable databases only.
2. Add a fixture-only projection-v2 adapter from one selected decoded lineage;
   do not persist it until the committed completeness receipt is trusted.
3. Design and separately gate the staging R2 HEAD adapter, which must run before
   the snapshot claim and remain inside the approved budget.
