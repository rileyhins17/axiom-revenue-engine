# Authenticated Owner-Decision Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define one authenticated, content-addressed owner-dossier acceptance
contract and an inactive append-only database schema without creating a route,
operator action, database executor, progress append, real-business path, or live
authority.

**Architecture:** A small server-side domain module will accept the exact
in-process dossier, exact guarded contact-review parent, a declaration containing
no identity or client-selected time, and current Better Auth session context. It
will derive the authorized owner and decision time, HMAC-bind the subject/session
without retaining raw authentication identifiers, reuse the exact dossier proof,
and emit one deeply frozen zero-authority record candidate. Additive migration
0069 will define the mirrored append-only ledger and database constraints, but no
application code will be able to insert or load it in this milestone.

**Tech Stack:** TypeScript, Zod, Node `crypto` HMAC-SHA-256, Better Auth session
contract, better-sqlite3 migration tests, Cloudflare safety scan, Next/OpenNext
release gate.

**Execution mode:** Inline execution on the owner-designated non-synced checkout
and rebuild branch; no subagent writes and no live or external operation.

---

### Task 1: Establish the exact predecessor and baseline

- [x] Read AGENTS, owner context, status, master plan, gotchas, runbook, ADRs
  0025/0026/0033/0044/0045, current session helpers, dossier proof, and durable
  receipt patterns.
- [x] Verify the non-synced repository, rebuild branch, local/remote equality,
  and clean working tree at `5a25ffb7bf3e00de38faa2638201978226a437c2`.
- [x] Run the owner-dossier and full-migration detail-reader baseline and require
  13/13 tests to pass.

### Task 2: Specify the authenticated contract test-first

**Files:**

- Create: `src/lib/revenue-engine/private-kw-authenticated-owner-decision.test.ts`
- Create later: `src/lib/revenue-engine/private-kw-authenticated-owner-decision.ts`

- [x] Test that the contract derives Riley or Aidan from the normalized current
  session email, derives decision time from the injected server clock, binds the
  exact dossier/contact proof, retains no raw auth identifiers, and stays deeply
  frozen with every operational authority false.
- [x] Test fail-closed behavior for copied dossiers/parents, unauthorized or
  mismatched owners, inactive sessions, dossier-window drift, weak binding keys,
  another manifest, and tampered record identities.
- [x] Run the focused test and require RED because the contract module does not
  exist.

### Task 3: Implement the minimal authenticated record candidate

**Files:**

- Create: `src/lib/revenue-engine/private-kw-authenticated-owner-decision.ts`
- Modify: `scripts/check-safety-config.mjs`

- [x] Validate a narrow Better Auth session snapshot and allow only the two
  explicit Axiom owner identities.
- [x] Accept a declaration with no reviewer or timestamp fields; derive both
  from current session context and the server clock.
- [x] HMAC-bind subject/session identity with an injected minimum-32-byte key
  and explicit key version while excluding raw user, session, and email values.
- [x] Reuse the exact in-process dossier acceptance proof, produce a
  content-addressed deeply frozen candidate, and reject schema-valid clones.
- [x] Keep durable recording, database access, phase advancement, providers,
  deployment, outreach, send, and cost at zero authority.
- [x] Extend the safety scan to require those properties and forbid imports from
  routes, UI, Worker, scripts, runtime adapters, or provider code.
- [x] Run the focused test and safety check to GREEN.

### Task 4: Define and verify inactive append-only schema 0069

**Files:**

- Create: `migrations/0069_authenticated_owner_dossier_decisions.sql`
- Extend: `src/lib/revenue-engine/private-kw-authenticated-owner-decision.test.ts`
- Modify: `scripts/private-kw-database.ts`
- Modify: `scripts/execute-private-kw-assessment.test.ts`
- Modify: `src/lib/revenue-engine/owner-lead-detail-read-model.test.ts`
- Modify: `scripts/check-safety-config.mjs`

- [x] Add a mirrored content-addressed ledger with one decision per exact
  acceptance proof, append-only update/delete triggers, session-binding fields,
  explicit future reauthentication/exact-reload requirements, and zero
  progress/outreach/send/provider/deployment/cost authority.
- [x] Prove the complete 0054-0069 migration chain applies, one exact synthetic
  candidate satisfies the schema, JSON/column drift and conflicting identity
  fail, and update/delete are rejected.
- [x] Advance only the ignored-local canonical schema range and affected tests
  from 0054-0068 to 0054-0069; do not apply any migration.
- [x] Run focused migration, owner-dossier, local-schema, and safety tests to
  GREEN.

### Task 5: Record the threat model and handoff state

**Files:**

- Create: `docs/adr/0046-define-authenticated-owner-decisions-without-activating-recording.md`
- Modify: `docs/adr/0044-bind-owner-dossier-acceptance-to-exact-read-proof.md`
- Modify: `docs/adr/0045-append-owner-dossier-progress-only-against-its-exact-parent.md`
- Modify: `README.md`
- Modify: `docs/RUNBOOK.md`
- Modify: `docs/DATA_DICTIONARY.md`
- Modify: `docs/GOTCHAS.md` only if a new recurring trap is proven
- Modify: `docs/STATUS.md`

- [x] Record session forgery/fixation, replay, identity substitution,
  dossier/parent substitution, stale evidence, copied trust, raw-secret leakage,
  direct-SQL forgery, duplicate/conflicting decisions, CSRF, clock, and authority
  creep threats with explicit mitigations and remaining release gates.
- [x] State plainly that migration 0069 is source-only and inactive: no D1
  executor, route, UI action, database write/read, real owner decision, or phase
  advancement exists yet.
- [x] Update owner-facing documentation, exact migration range, production and
  automation state, C$0 spend, owner decisions, eventual-main direction, and
  exactly three next actions.

### Task 6: Verify and checkpoint

- [x] Run sequentially:

  ```powershell
  npm run check:safety
  npm test
  npm run typecheck
  npm run lint
  npm run build:cloudflare
  npx wrangler deploy --env="" --dry-run --autoconfig false
  npm run test:owner-ui
  ```

- [x] Review every changed file, run `git diff --check`, scan staged additions
  for secret-like values and sensitive owner-data files, and verify the remote
  branch has not moved.
- [ ] Commit one atomic checkpoint with
  `feat: define authenticated owner decisions`, push only the rebuild branch,
  and verify exact local/remote equality plus a clean worktree. Do not merge
  `main`.
