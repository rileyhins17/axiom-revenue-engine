# ADR 0029 — Separate local source/workflow materialization from assessment

**Status:** Accepted
**Date:** 2026-08-27
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0026 allowed one owner-approved local assessment only after every source row
and one sealed workflow receipt already existed exactly. That was intentionally
fail-closed, but there was no trusted command that could create those prerequisite
rows. Tests manually seeded them with loose SQL, which was not an acceptable path
for a real reviewed KW evaluation record.

Using the assessment approval to fill the missing rows would silently broaden one
decision into source import, audit acceptance, workflow history, and qualification.
Executing the older validation-only persistence JSON would also turn untrusted
ignored data carrying `mutationAuthorized: false` into database authority.

The gate must remain local, owner-approved, zero-cost, deterministic, retry-safe,
collision-complete, independently auditable, and incapable of touching staging,
production, providers, prospects, capture, contacts, or outreach.

## Decision

Add a distinct source/workflow materialization contract, approval, command, and
append-only receipt. The approval binds the exact source-plan digest, one candidate,
the complete deterministic audit input/digest, evidence-completion time, reviewer,
rationale, and a source/workflow-specific confirmation phrase.

Trusted code re-parses the original source plan, re-derives persistence plan v2,
and re-runs the deterministic website audit. It derives stable workflow, delivery,
attempt, terminal receipt, and closure identities from that exact content. It does
not accept caller SQL, a saved persistence plan, an audit result, or an assessment
approval as authority.

The local command:

1. accepts only direct-child ignored JSON and `.sqlite` files;
2. opens one existing unattached local database and never runs migrations;
3. requires the complete Revenue schema to equal migrations 0054–0064;
4. acquires one `better-sqlite3` `IMMEDIATE` transaction before preflight;
5. reads every primary and alternate identity with no `LIMIT 1`;
6. rejects drift, multiple matches, stale approval, and an incomplete existing
   materialization receipt;
7. inserts only missing exact source and six workflow rows, then the
   materialization receipt last; and
8. reloads every exact row before allowing the transaction to commit.

Migration 0064 stores the immutable transaction receipt and independently rejects
a receipt whose terminal workflow lineage is missing, unsealed, cross-business,
non-shadow, or cost-bearing. Database constraints grant only the named local source
and workflow mutations. Assessment, schema mutation, capture, contact discovery or
verification, outreach, send, provider operations, and cost stay false or zero.

## Options Considered

### Option A — Let assessment approval import its prerequisites

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Safety | Poor; one approval gains unrelated authority |
| Replay | Ambiguous across three persistence domains |
| Maintenance | Simple command, difficult audit trail |

**Pros:** Fewer files and one command.

**Cons:** Violates least authority, makes missing state a hidden side effect, and
cannot prove that Riley separately accepted the source and workflow evidence.

### Option B — Execute saved validation-only SQL plans

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Safety | Poor; untrusted artifacts become executable |
| Replay | Depends on stale caller SQL |
| Maintenance | Contracts can drift from trusted code |

**Pros:** Reuses already generated SQL.

**Cons:** A modified or stale ignored artifact could change the write boundary,
and its explicit `mutationAuthorized: false` would cease to mean anything.

### Option C — Re-derived plan plus separate approval and atomic local receipt

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Safety | Strong, local-only and least-authority |
| Replay | Exact replay is mutation-free |
| Maintenance | One canonical builder and one owner procedure |

**Pros:** Content-bound, collision-complete, transactionally atomic, independently
approved, and directly proves the prerequisite needed by the assessment command.

**Cons:** Adds one migration, approval contract, command, and owner/developer step.

This option was selected.

## Trade-off Analysis

The extra approval is deliberate friction at a high-trust boundary. Riley should
not have to understand SQL, but the system must distinguish “I accept this source
and evidence” from “I accept this qualification.” An owner UI can later present
both decisions cleanly; combining them in local development would make that future
separation harder, not easier.

The command imports a locally reviewed, zero-provider workflow receipt instead of
pretending that a live Cloudflare Workflow executed. This is appropriate for the
private 50-lead evaluation but cannot be promoted into runtime execution authority.

## Consequences

- A reviewed source and deterministic audit can now reach the existing assessment
  command without manual SQL.
- Assessment approval still cannot create or repair source/workflow state.
- Source/workflow exact replay writes nothing; a final-receipt failure rolls back
  every preceding insert.
- Hidden alternate-phone collisions stop even when the primary row is exact.
- Migration 0064 is applied only to ignored local/disposable databases in this
  checkpoint. Staging and production remain unchanged.
- The current source materialization imports the exact approved plan, which may
  contain up to 50 records, but seals a workflow for only the explicitly selected
  candidate.
- A future owner UI and runtime source adapter need separate authorization,
  idempotency, deployment, and provider gates.

## Action Items

1. [x] Add the content-bound approval and deterministic source/workflow plan.
2. [x] Add migration 0064, the local transaction executor, CLI, and atomic replay,
   rollback, collision, schema-drift, and assessment-bridge tests.
3. [x] Document the private procedure and keep the engine Worker disconnected.
4. [x] Build the separately approved contact-persistence executor without adding
   provider, consent, qualification, outreach, send, or cost authority. See ADR
   0030.
