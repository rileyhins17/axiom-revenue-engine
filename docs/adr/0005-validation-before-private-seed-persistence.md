# ADR 0005 — Validate identity and drift before private seed persistence

- Status: accepted
- Date: 2026-08-22

## Decision

Separate private KW seed preparation from database mutation. The local planner
accepts only the versioned, already-validated import plan and emits a second
ignored artifact bound to migration `0054_revenue_shadow_kernel`.

For each source run, business, location, and source record, the artifact contains
an expected row fingerprint, a bounded preflight, and an insert-if-absent
statement. A missing row is eligible for a future insert, an exact existing row
is idempotent, and any different row or alternate identity collision is a hard
conflict. The artifact itself is always `mutationAuthorized: false` and no
database executor exists in this checkpoint.

A future loader must not blindly execute a saved plan. It must revalidate the
original import, reproduce the canonical plan using trusted versioned code,
compare its source digest, pass every exact preflight, and require a separate
release gate before a staging-only write.

## Why

Stable IDs alone do not make imports safe. The same domain, phone, or
source-owned identifier can already belong to another row, while an existing ID
can contain different facts. `INSERT OR IGNORE` by itself would hide those
collisions and make a partial import appear successful. Exact preflights make the
difference between a safe repeat and contradictory data explicit.

Keeping planning separate from execution also allows Riley and Codex to review
the exact scope without giving a local data file authority to mutate D1.

## Consequences

- The plan can cover only `RevenueSourceRun`, `RevenueBusiness`,
  `RevenueLocation`, and `RevenueSourceRecord` rows.
- Qualification, evidence, contacts, consent, outreach, and cost rows remain out
  of scope and at zero.
- Input and output remain direct, non-overwriting JSON files inside the ignored
  `data/kw-evaluation/` directory.
- SQL/schema compatibility, exact repeats, drift, domain collisions, and source
  identity collisions are tested against an in-memory migration-0054 database.
- Staging and production D1 remain untouched until a separately designed,
  approved, backed-up, and rollback-tested executor exists.
