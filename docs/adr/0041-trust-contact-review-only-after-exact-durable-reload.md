# ADR 0041 — Trust contact review only after exact durable reload

**Status:** Accepted
**Date:** 2026-08-31
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0031 stores one complete owner-reviewed contact invocation after the exact
contact bundle and its final materialization receipt commit atomically. ADR 0040
then advances one business to an exact in-memory `ASSESSMENT_PERSISTED`
checkpoint. The remaining gap was provenance after an interruption: the contact
writer returns a schema-valid invocation object, but serialization cannot prove
that the invocation receipt, final materialization receipt, every child contact
row, and their database guards still exist unchanged.

Treating that object as progress proof would repeat the failure already fixed for
assessment persistence: valid data shape and content-derived digests are not the
same as durable transaction provenance. The boundary must remain read-only,
ignored-local, synthetic-only, zero-cost, and unable to create a phase input,
append progress, connect a live database, call a provider, or contact anyone.

## Decision

Add a separate durable contact-invocation reload and a separate contact-review
progress-proof builder.

The reload starts from only the invocation ID and digest through an injected
read-only SQL batch boundary. It:

- verifies the exact migration 0062–0067 source-materialization, contact-contract,
  lineage, append-only, final-receipt, and invocation-receipt guards;
- reloads the exact canonical invocation receipt;
- reloads and deterministically rebuilds the exact assessment through the
  existing durable assessment boundary;
- reloads the exact source-materialization receipt for the source plan/business;
- re-derives the complete contact persistence plan from the stored reviewed
  evidence and approval, then collision-completely reloads every expected row;
- requires the final contact materialization receipt as the plan's last exact
  row; and
- reads database time only after every durable row check, rejects a clock that
  precedes the nested assessment reload, and classifies `NOT_YET_CURRENT`,
  `CURRENT`, or `STALE` from that final clock, the assessment refresh deadline,
  and the earliest verification expiry.

Only the exact deeply frozen `CURRENT` result registered in a module-private
`WeakSet` may feed proof. A copied or hand-built object is untrusted even when it
passes every public schema and digest check.

The proof builder additionally requires the exact in-process assessment
checkpoint created by ADR 0040. It binds one manifest business to:

- the original source/workflow materialization receipt already recorded in the
  business's phase prefix;
- the exact assessment receipt and its separate `assessment-proof:*` reference;
- the reviewed `kw-contact-invocation:*` receipt;
- the final `kw-contact-persistence:*` materialization receipt and discovery
  result; and
- the durable reload's database clock, freshness window, row counts, and guard
  verification.

The resulting `contact-review-proof:*` becomes the mandatory supporting receipt
shape for a future `CONTACT_REVIEW` phase input. This milestone deliberately does
not create that input or append a checkpoint.

## Options Considered

### Option A — Trust the writer response or saved invocation JSON

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Crash recovery | Weak; serialized shape replaces database provenance |
| Tamper resistance | Digest-valid copied JSON can impersonate completion |
| Maintenance | Simple but repeats a proven trust-boundary failure |

**Pros:** Reuses the current return value with no new read path.

**Cons:** Cannot prove the final receipt, complete child set, immutable guards,
or current verification evidence after process loss.

### Option B — Let the future phase-input adapter query rows directly

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Separation of authority | Weak; persistence proof and progress input combine |
| Testability | Larger boundary with database and progress concerns mixed |
| Operational risk | Easier for a read helper to become an operator path |

**Pros:** Fewer modules and one fewer intermediate contract.

**Cons:** Makes it difficult to prove that database reads, trust, proof, and
progress mutation remain separate.

### Option C — Exact durable reload, then a zero-authority proof

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Crash recovery | Strong; trust is rebuilt from exact durable state |
| Tamper resistance | Strong; exact object identity plus complete row reload |
| Maintenance | Reuses the assessment loader and contact persistence plan |

**Pros:** Preserves least authority, validates real SQLite queries, detects row
or guard drift, keeps stale history visible, and makes the next phase-input
boundary small and deterministic.

**Cons:** A resumed task must rerun the bounded read-only reload and recreate the
trusted assessment checkpoint in memory.

Option C was selected.

## Trade-off Analysis

Module-private trust intentionally does not survive serialization. This adds a
small amount of bounded read-only work after a lost Codex task, but avoids ever
turning a JSON file into transaction authority. Rechecking 27 contact/source
guards plus the existing eight assessment guards is stricter than trusting the
schema version string; that cost is negligible for a ten-business shadow slice.

The loader verifies the source materialization recorded by the first progress
phase rather than assuming it is the same workflow receipt later used by the
assessment. Website evidence may legitimately be refreshed in a newer workflow.
The progress proof therefore binds both exact receipts explicitly instead of
inventing a false one-workflow invariant.

## Consequences

- A valid-looking invocation can no longer impersonate durable contact-review
  completion after a crash or task restart.
- Missing/ambiguous invocation receipts, missing final materialization receipts,
  row drift, missing guards, stale verification, source drift, assessment drift,
  and cross-manifest use fail closed.
- `CONTACT_REVIEW` now requires a separate `contact-review-proof:*` supporting
  receipt in addition to the invocation receipt.
- The read-only result and proof authorize no database mutation, contact
  discovery/verification execution, consent decision, qualification, outreach,
  send, deployment, provider operation, or spend.
- No operator command, file writer, Worker import, live binding, migration,
  production/staging action, real-business operation, or prospect contact was
  added.
- The next integration gap is a validation-only `CONTACT_REVIEW` phase-input
  adapter derived from this exact proof and unchanged assessment parent.

## Action Items

1. [x] Share one canonical invocation receipt-row contract between writer and
   reload.
2. [x] Add the read-only durable reload with a final non-regressing database
   clock, exact assessment, source receipt, complete contact plan, final receipt,
   and writer-guard checks.
3. [x] Require exact in-process current trust and reject copied JSON and stale
   history.
4. [x] Add the content-addressed proof bound to the exact assessment checkpoint
   and source/contact receipts.
5. [x] Make the proof a required future `CONTACT_REVIEW` supporting receipt and
   enforce isolation in the static safety gate.
6. [ ] Add the separate validation-only `CONTACT_REVIEW` phase-input adapter;
   do not append progress or create an operator/live-data path in that change.
