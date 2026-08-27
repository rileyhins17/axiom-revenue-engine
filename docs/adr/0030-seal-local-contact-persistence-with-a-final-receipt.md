# ADR 0030 — Seal local contact persistence with a final receipt

**Status:** Accepted
**Date:** 2026-08-27
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0028 established collision-complete, validation-only SQL for append-only
contact discovery and verification history. ADR 0029 then proved the local
source/workflow prerequisite with a separately approved SQLite transaction.
The contact planner still granted no database authority and there was no trusted
transaction boundary that could persist its records.

The existing discovery receipt cannot prove transaction completion. Contact
points must find it before their insert triggers can accept them, so the receipt
has to be inserted near the start of a fresh bundle. A crash or direct SQL write
could therefore leave that parent beside missing contact, evidence-use, or
verification children. Silently filling those rows on a retry would turn a
partial history into an apparently complete one.

This checkpoint must remain ignored-local, owner-approved, zero-cost, and unable
to run discovery, verification, consent, qualification, outreach, or sending.
The separate file/CLI invocation that may later construct fixture results is not
part of this decision.

## Decision

Add a separate local contact-persistence approval and trusted plan. The approval
binds the exact business, discovery result ID/digest, re-derived validation-plan
digest, every verification result ID/digest, reviewer, time, rationale, and a
contact-specific confirmation phrase.

Trusted code parses the original discovery and verification results and calls
`buildRevenueContactPersistencePlan` itself. It does not accept saved SQL or a
saved persistence plan as authority. The local executor verifies the complete
canonical migration 0054–0066 schema, opens one SQLite `IMMEDIATE` transaction,
checks every primary/alternate identity without `LIMIT 1`, and allows only:

1. a fresh bundle where every discovery-owned row is absent and any globally
   reusable evidence is either absent or exactly equal; or
2. an exact replay where the complete bundle and final receipt already match.

Migration 0065 adds `RevenuePrivateKwContactPersistenceReceipt`; migration 0066
hardens its content-derived identity and exact verification set. The receipt is
inserted last, requires the exact discovery/contact/evidence/verification set to exist,
binds the approval and zero-authority policy, and is immutable. The executor
reloads every exact row before commit. A partial discovery-owned history, an
exact bundle without this receipt, a receipt with missing rows, drift, collision,
or stale approval stops; the executor never repairs it.

The executor is a typed local function only. It has no CLI, file reader, Worker,
route, queue, Cloudflare binding, provider, or production/staging database path.

## Options Considered

### Option A — Treat the discovery receipt as the transaction seal

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Atomic proof | Weak; the parent must be inserted before children |
| Replay safety | Cannot distinguish complete from interrupted history |
| Maintenance | Simple but misleading |

**Pros:** No new table or approval type.

**Cons:** A parent row could exist without its full evidence and verification
bundle, so “receipt exists” would be false proof of completion.

### Option B — Fill missing children on retry

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Atomic proof | Weak; prior writer and intent remain unknown |
| Replay safety | Repairs can hide corruption or approval drift |
| Maintenance | Requires increasingly complex repair rules |

**Pros:** Can recover some interrupted/manual writes automatically.

**Cons:** Converts ambiguous partial state into trusted history and breaks the
repository's fail-closed append-only rule.

### Option C — Re-derived plan plus a separate final transaction receipt

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Atomic proof | Strong; final receipt requires the complete exact bundle |
| Replay safety | Exact replay is write-free; partial state is blocked |
| Maintenance | One narrow executor and durable receipt contract |

**Pros:** Least authority, content-bound approval, deterministic replay, direct-
SQL lineage enforcement, complete rollback, and no provider/runtime coupling.

**Cons:** Adds migrations 0065–0066 and deliberately refuses automatic repair.

This option was selected.

## Trade-off Analysis

Refusing to repair partial rows may require a developer to investigate and
recreate a disposable local database. That inconvenience is appropriate: the
system is about evidence Riley can trust, not maximizing ingestion throughput.
The extra final receipt cleanly separates “this discovery result exists” from
“this approved persistence transaction completed.”

Keeping the executor below any file/CLI layer also prevents this checkpoint from
quietly becoming contact discovery execution. The next invocation milestone can
decide how ignored inputs are constructed and reviewed without broadening this
transaction's authority.

## Consequences

- One separately approved synthetic contact bundle can now commit atomically in
  a disposable or ignored local SQLite database.
- Exact replay writes nothing; reusable global evidence need not be duplicated.
- Receipt insertion failure rolls back discovery, contact, evidence-use, and
  verification rows together.
- Partial or unreceipted history is an investigation condition, not repair work.
- The validation-only schema-0063 planner remains zero-authority.
- No provider was connected, no real contact was discovered or verified, and no
  consent, qualification, outreach, send, staging, production, or cost authority
  was added.

## Action Items

1. [x] Add the content-bound approval, re-derived trusted plan, and final receipt.
2. [x] Add the SQLite `IMMEDIATE` executor with full preflight and post-verify.
3. [x] Prove fresh commit, exact replay, rollback, partial-history rejection,
   reusable evidence, stale approval, and direct-SQL lineage enforcement.
4. [ ] Design a separate ignored-local contact invocation and owner procedure;
   do not add a live provider or infer consent.
5. [ ] Add runtime/provider persistence only after its own owner, privacy, budget,
   deployment, and production release gates.
