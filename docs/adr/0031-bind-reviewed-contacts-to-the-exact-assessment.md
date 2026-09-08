# ADR 0031 — Bind reviewed contacts to the exact persisted assessment

**Status:** Accepted
**Date:** 2026-08-27
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0030 proved that an exact contact discovery/evidence/verification bundle can
be persisted atomically after a dedicated local approval. That executor had no
file or operator invocation, and its completion receipt intentionally knew only
the business and contact bundle. It did not prove which source plan, sealed
website assessment, or human-readable review caused the contact transaction.

An operator command that accepted generated discovery results directly would
make review perfunctory. Persisting the contact rows without a durable assessment
link would also let a future reader show a verified route beside the wrong or
stale website rationale. The missing boundary must remain ignored-local,
fixture-only, owner-approved, zero-cost, and unable to discover or verify a
contact through a live provider.

## Decision

Use two separate ignored-local files and operations:

1. A read-only preparation command opens one canonical local SQLite database in
   read-only mode, proves the exact source plan is already materialized,
   reconstructs the stored lead assessment from its sealed workflow lineage,
   and derives fixture discovery/verification results from reviewed observations.
   It writes a no-overwrite review packet containing plain owner context, the
   complete evidence, individual quality scores, and zero operational authority.
2. A different approval file binds that exact review, source-plan digest,
   assessment receipt/digest, re-derived contact persistence plan, every
   verification result, reviewer, timestamp, rationale, and dedicated
   confirmation. One outer SQLite `IMMEDIATE` transaction revalidates all
   prerequisites, calls the ADR-0030 contact executor, then inserts and reloads
   a separate invocation receipt last.

Migration 0067 adds the immutable
`RevenuePrivateKwContactInvocationReceipt`. Its canonical JSON contains the full
review—not merely its digest—and its insert guard requires the exact assessment,
contact materialization, discovery receipt, reviewer, timestamp, and zero-
authority fields. Exact replay writes nothing. A contact bundle without its
invocation receipt, approval drift, partial history, or final-receipt failure
stops and rolls back rather than being repaired.

## Options Considered

### Option A — One file reviews and persists contacts immediately

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Owner review | Weak; generation and mutation happen in one step |
| Auditability | The saved input may not match what the owner actually saw |
| Maintenance | Simple command, ambiguous decision boundary |

**Pros:** Fewer files and one operator command.

**Cons:** Makes accidental persistence easier and provides no durable pause for
Riley or Aidan to inspect the evidence and route recommendation.

### Option B — Persist the approved contact bundle without assessment lineage

| Dimension | Assessment |
|---|---|
| Complexity | Low to medium |
| Owner review | Contact evidence can be reviewed |
| Auditability | Cannot prove why the business was considered worth contacting |
| Maintenance | Future UI must reconstruct or guess cross-phase lineage |

**Pros:** Reuses ADR 0030 with a thin file wrapper.

**Cons:** A usable email could become detached from the exact business-quality
and website-rebuild evidence that justified researching it.

### Option C — Read-only review, separate approval, and a final lineage receipt

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Owner review | Strong, explicit, and independently saved |
| Auditability | Exact source, assessment, review, and contact bundle are bound |
| Maintenance | One durable packet can feed the dossier and future vertical slice |

**Pros:** Clear human decision point, complete resumable context, write-free
review, exact replay, atomic rollback, and no live provider coupling.

**Cons:** Adds one migration, two commands, and a deliberately explicit approval
file.

This option was selected.

## Trade-off Analysis

The extra review file is justified because lead quality—not contact volume—is
the product. It gives the owner an inspectable artifact before any local contact
row exists and prevents “an email was found” from becoming evidence that a lead
was qualified. Keeping the full review inside the final receipt costs additional
local database space, but the pilot volume is tiny and the durable context is
more valuable than minimizing a few kilobytes.

The command still reconstructs fixture results rather than calling a provider.
This is intentional: the owner acceptance dossier now consumes one
executor-produced bundle, and the project can next define a bounded
real-business shadow slice. Provider selection, CASL evidence, paid
verification, and live runtime wiring retain their own release gates.

## Consequences

- A reviewed contact route can no longer be persisted without exact source and
  assessment lineage.
- Review preparation is database-read-only and writes only a new ignored JSON
  artifact.
- Contact persistence and its invocation receipt commit or roll back together.
- Exact replay is mutation-free; incomplete or unreceipted history is blocked.
- The complete review survives lost task context and can feed a future dossier.
- No live contact discovery, verification, consent decision, qualification
  change, outreach, mailbox, staging/production database, provider operation, or
  spend was authorized.

## Action Items

1. [x] Add the exact source/assessment prerequisite loader and read-only review.
2. [x] Add the separately approved atomic invocation command and migration 0067.
3. [x] Prove no-write review, approval-drift rejection, final-receipt rollback,
   fresh commit, exact replay, full-review persistence, and immutability.
4. [x] Make the owner dossier fixture consume one executor-produced contact
   bundle without adding an owner mutation or send action.
5. [ ] Run a bounded real-business shadow slice only after its source, privacy,
   provider, budget, and owner-review gates are approved.
