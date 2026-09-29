# ADR 0035 — Persist eligibility without turning history into current proof

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

The current-website-evidence eligibility builder can prove one exact in-process
combination of transaction-sealed D1 completeness and current R2 HEAD receipts.
Its private `WeakSet` correctly prevents copied JSON from impersonating that
execution, but it also means the result disappears when a Codex task or process
ends. A later task needs to verify the exact committed receipt from durable data
without trusting a chat transcript or copied file.

Freshness creates a second risk. The underlying completeness and availability
windows are intentionally short. Keeping the historical receipt is useful, but
reloading it after expiry must not make it current again or silently advance the
ten-business shadow chain.

## Decision

Migration 0068 adds one append-only
`RevenueCurrentWebsiteEvidenceEligibilityReceipt` table. Its insert guard binds
the canonical receipt JSON and mirrored identity to the exact existing business,
workflow run, sealed workflow receipt, terminal artifact set, artifact
manifests, completeness receipts, availability source-set proofs, and R2 HEAD
availability receipts. The database constrains every downstream authority and
cost field to zero.

The private D1 adapter accepts a new receipt only as the exact frozen in-process
result of the eligibility builder. It writes and reloads the row in one injected
`D1Database.batch`, distinguishes a fresh commit from an exact replay, and
returns a separately frozen, module-private trusted result. A later process can
reload the receipt using only its content-derived ID and digest because the
canonical JSON is re-parsed, re-digested, and compared with every mirrored row
field. Every persistence and reload batch first proves that all three exact
migration-0068 lineage and append-only triggers still exist and retain their
stable error markers. A database whose writer guards drifted cannot produce a
trusted reload. The insert statement independently carries the same exact
writer-guard predicate, so a missing or drifted trigger prevents the row from
being written even though batch results are validated only after D1 commits.

Every persistence and reload reads the database clock. Durable results report
one of:

- `NOT_YET_CURRENT` when the database clock precedes the original evaluation;
- `CURRENT` inside the original half-open evidence window; or
- `STALE` at or after the original freshness boundary.

The receipt schema independently re-derives that original boundary as the exact
earliest website-workflow age limit, completeness expiry, R2 availability
valid-through time, or availability retention expiry. Redigesting copied JSON
cannot extend the evidence window.

Stale receipts remain immutable audit history. Only the exact current in-process
D1 reload result can cross the exported current-result guard, and even that guard
creates no phase input or progress receipt.

## Consequences

- A lost Codex task no longer requires trusting copied eligibility JSON.
- Exact replay is idempotent and does not report a second database mutation.
- Stored history never refreshes itself; new current evidence requires new
  completeness and availability work plus a new eligibility receipt.
- Updates and deletes fail with a stable append-only error, and source-lineage
  drift aborts before the row can be committed.
- Forged lineage aborts the complete transaction, a replay-row collision fails
  exact mirrored-row comparison, and missing writer guards fail before durable
  history can be treated as trusted current proof.
- The adapter is not imported by the Worker, API routes, queues, or scripts.
  This persistence decision added no operator command, live Cloudflare D1
  binding, phase-input adapter, Browser/R2 activation, real-business execution,
  provider operation, or spend. ADR 0036 later permits only a separate
  validation-only phase-input derivation from an exact current durable reload;
  it still adds none of those operational capabilities.
- Canonical ignored-local schema is now migrations 0054–0068. Any older local
  file fails closed until migration 0068 is separately reviewed and applied;
  this checkpoint did not mutate an existing database.

## Verification

Synthetic in-memory SQLite tests prove fresh commit, exact replay, process-style
reload by ID/digest, copied-input rejection before D1 access, frozen trusted
reload identity, stale-history classification, current-use rejection,
append-only update/delete guards, required-writer-guard enforcement, atomic
rollback on forged lineage, and replay-row collision rejection. The full
migration, safety, test, type, lint, Cloudflare build, no-upload dry-run, and
owner-browser gates remain required for the checkpoint.
