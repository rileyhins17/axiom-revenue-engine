# Durable Authenticated Owner-Decision Boundary Implementation Plan

**Goal:** Persist and exactly reload one authenticated owner-dossier decision
through an injected D1-shaped boundary without adding a route, UI action,
progress bridge, runtime binding, real-business path, or live migration.

**Architecture:** Extend the existing decision contract with reusable
HMAC/session-binding verification, then add a separate module that accepts only
the exact in-process decision candidate, rechecks the same verified owner
session before database access, uses database time and all migration-0069 writer
guards inside one batch, inserts only the owner-decision ledger, and exactly
reloads the durable row. Process-loss reload verifies the stored decision HMAC
with injected key material but remains historical, zero-authority proof until a
future separately authenticated progress bridge exists.

**Execution mode:** Inline on the non-synced canonical checkout and rebuild
branch. Tests use synthetic fixtures and in-memory SQLite only. No subagent,
provider, Cloudflare resource, real owner session, migration application,
deployment, outreach, send, or spend.

---

### Task 1: Confirm predecessor and reference boundaries

- [x] Read the operating contract, owner context, status, master plan, gotchas,
  runbook, ADR 0046, migration 0069, the authenticated decision contract, and
  the existing durable eligibility D1 pattern.
- [x] Verify clean local/upstream/remote equality at
  `e743f4a5f0a5486b2408f82b06edd4e488e923ce` on the rebuild branch.
- [x] Run the existing authenticated-decision baseline and require 5/5 tests.

### Task 2: Specify the durable boundary test-first

- [x] Add focused tests for fresh commit, mutation-free exact replay, process-
  style exact reload, frozen in-process trust, and zero downstream authority.
- [x] Prove a changed/unverified/unauthorized/expired session, wrong HMAC key or
  version, copied candidate, missing/drifted writer guard, mirrored-row drift,
  ambiguous/missing row, and invalid database chronology fail closed.
- [x] Require wrong session binding and copied candidate rejection before the
  injected database boundary is called; require failed guard/time checks to
  leave the decision table unchanged.
- [x] Run the focused test and witness RED before implementation exists.

### Task 3: Reuse exact session and HMAC verification

- [x] Refactor the decision contract so building and rechecking use one HMAC
  derivation path.
- [x] Add a verified-session binding recheck that requires the exact trusted
  candidate, fixed owner allowlist, verified email, matching session and key
  version, and no raw authentication persistence.
- [x] Add a stored-decision binding verifier that can validate the decision HMAC
  from opaque subject/session digests plus injected versioned key material.
- [x] Keep all operation, persistence, progress, provider, outreach, send,
  deployment, and cost authority false or zero.

### Task 4: Implement the disconnected D1 writer/reloader

- [x] Create `private-kw-authenticated-owner-decision-d1.ts` with only an
  injected batch interface; do not add a Cloudflare adapter or runtime import.
- [x] Verify the three exact migration-0069 triggers and stable markers, read
  database time, SQL-gate the insert on those guards and active-session bounds,
  insert only `RevenuePrivateKwOwnerDecision`, and exactly reload the row.
- [x] Distinguish `FRESH_COMMIT`, `EXACT_REPLAY`, and `DURABLE_RELOAD`; only the
  fresh path may report one mutation.
- [x] Reparse canonical JSON, compare every mirrored column, verify HMAC key
  ownership, deep-freeze/register results, and reject copied durable results.
- [x] Keep runtime, UI, progress, providers, outreach, send, deployment, and
  cost disconnected and unauthorized.

### Task 5: Enforce safety and document the decision

- [x] Extend `npm run check:safety` to require exact candidate/session/HMAC and
  writer-guard checks, owner-decision-only SQL, database clock, private result
  trust, and zero authority while forbidding Worker/route/UI/script wiring.
- [x] Add ADR 0047 with alternatives, threat model, consequences, and explicit
  auth-hardening/activation blockers.
- [x] Update README, data dictionary, runbook, ADR 0046 action items, and STATUS
  with current state, C$0 spend, blockers, owner decisions, eventual-main
  direction, and exactly three next actions.

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
  for high-signal secrets and sensitive local data, and reverify the remote did
  not move.
- [ ] Commit one atomic checkpoint, push only the rebuild branch, and verify
  exact local/upstream/remote equality plus a clean worktree. Do not merge
  `main`.
