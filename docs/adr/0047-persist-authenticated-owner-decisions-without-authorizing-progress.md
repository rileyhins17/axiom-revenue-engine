# ADR 0047 — Persist authenticated owner decisions without authorizing progress

**Status:** Accepted
**Date:** 2026-09-02
**Deciders:** Riley Hinsperger and the Revenue Engine integration owner

## Context

ADR 0046 defines a content-addressed owner-decision candidate bound to a current
verified Riley/Aidan session and additive migration 0069 defines its append-only
ledger. The candidate is intentionally process-local: copying its JSON cannot
recreate the private trust required to write it. The schema is intentionally not
enough either because SQLite cannot verify the secret HMAC that binds the owner,
session, proof, and decision.

The next safe boundary must survive a lost Codex task without turning stored
history into current authentication or progress authority. It must also keep the
application incapable of reaching the boundary until verified owner email, MFA,
recovery, CSRF/origin protection, idempotency, staging, rollback, and release
approval exist.

## Decision

Add a disconnected, injected D1-shaped writer/reloader with no Cloudflare,
Better Auth adapter, route, UI, script, Worker, or progress import.

For a fresh commit or exact replay, the boundary:

1. Requires the exact private in-process ADR-0046 decision candidate.
2. Recomputes the subject, session, and decision HMACs from the same current
   verified owner session and versioned secret before any database call.
3. Executes one injected atomic batch that reads the exact migration-0069
   triggers and database clock, conditionally inserts only
   `RevenuePrivateKwOwnerDecision`, and reloads the exact row.
4. SQL-gates the insert on all three stable writer-guard markers and the
   half-open `preparedAt <= databaseNow < sessionExpiresAt` window. Missing or
   drifted guards therefore leave the ledger unchanged even though the batch is
   inspected only after it returns.
5. Reparses canonical JSON, verifies the stored decision HMAC with injected
   versioned key material, compares every mirrored column, and distinguishes
   `FRESH_COMMIT` from mutation-free `EXACT_REPLAY`.

For process-loss reload, the boundary accepts only the content-addressed record
identity, reads the guards/time/row, verifies the stored HMAC and every mirror,
and returns `DURABLE_RELOAD`. This proves historical integrity only. It does not
reauthenticate a current session, does not claim current owner authority, and
cannot create or append progress.

All results are deeply frozen and registered in a module-private trust set.
Copied result JSON is rejected. Every phase, provider, outreach, send,
deployment, and cost authority remains false or zero.

## Threat model

| Threat | Required mitigation |
|---|---|
| Copied candidate is submitted | Require the exact ADR-0046 `WeakSet` candidate before database access. |
| Session changed, expired, unverified, or belongs to another identity | Recompute all bindings from current session context before the batch and recheck session currentness against database time. |
| A request body impersonates Better Auth session context | No route exists. Future activation must obtain session context directly from a server-only Better Auth adapter; the browser may never supply any session field to this boundary. |
| Wrong or rotated secret verifies the wrong record | Require the exact bounded key version and recompute the stored decision HMAC. Rotation must retain old verification material under a later runbook. |
| Migration guards are absent or drifted | Read all three exact trigger names/markers and embed the same `sqlite_master` predicate in the insert SQL. |
| Application clock is forged or ahead of D1 | Use D1 `now` for `recordedAt` and the active-session insert window, then compare the returned database time. |
| Replay creates duplicates | Use content addressing, schema uniqueness, `INSERT OR IGNORE`, exact reload, and conflict rejection. |
| A different row satisfies a uniqueness conflict | Reload by the candidate's exact content-addressed ID and require exact digest/mirror equality. |
| Stored JSON is edited while mirrored columns remain | Verify the HMAC and canonical JSON, then compare every derived mirror. |
| Stored row is treated as a current login | `DURABLE_RELOAD` explicitly reports no current-session recheck and grants no downstream authority. |
| Persistence quietly activates runtime capability | Keep only an injected batch interface and statically forbid Worker, route, page, component, generic progress script, auth adapter, provider, and direct Cloudflare wiring. |

## Options considered

### Trust any schema-valid or digest-valid JSON

Rejected. Zod and an unkeyed digest establish shape and content identity, not
that Riley or Aidan made the decision in a verified current session.

### Add the real route, Better Auth lookup, D1 binding, and progress append now

Rejected. Current email verification is disabled and MFA/recovery have not been
proven. Combining authentication, CSRF, persistence, progress, and UI activation
would hide multiple release decisions inside one change.

### Add a disconnected exact writer/reloader first

Selected. It proves the smallest durable security boundary with synthetic
in-memory SQLite while preserving every activation blocker.

## Consequences

- A process loss no longer requires trusting copied decision JSON: the exact row
  can be reloaded and integrity-checked with the correct versioned key.
- Historical HMAC validity is not current authentication. A future progress
  adapter must independently require a fresh verified owner session and exact
  durable result.
- The only allowed mutation is one insert into the migration-0069 decision
  ledger. Replay and reload are read-only.
- No binding key is configured, no migration has been applied, and no route,
  button, operator command, Worker import, provider call, real-business path,
  deployment, or spend exists.
- The session recheck verifies continuity with the exact original binding; it is
  not itself a Better Auth lookup. A future server-only adapter remains required.
- The rebuild remains on its feature branch. Riley's intended eventual `main`
  cutover is unchanged and is not authorized by this ADR.

## Action items

1. [x] Reuse one HMAC derivation path for candidate creation and current-session
   recheck.
2. [x] Add the disconnected exact D1 writer/reloader with database time and all
   migration-0069 guards.
3. [x] Prove fresh commit, exact replay, process-loss reload, conflict, guard,
   chronology, HMAC, mirror, trust, and zero-authority behaviour synthetically.
4. [ ] Harden owner authentication with verified email, MFA, and recovery.
5. [ ] Design a separate validation-only progress authorization adapter that
   requires a fresh verified owner session plus the exact durable result.
6. [ ] Add a server-only Better Auth adapter and real D1/route/UI wiring only
   after CSRF/idempotency, staging, rollback, security review, and explicit
   release approval. Request-body session fields must be impossible.
