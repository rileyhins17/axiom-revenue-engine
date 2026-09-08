# Owner-Dossier Progress Append Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Advance one exact trusted `OWNER_DOSSIER` input to one frozen in-memory
shadow-progress checkpoint without allowing copied trust, parent drift,
unrelated-business changes, durable writes, live resources, or outbound action.

**Architecture:** Add a small final-phase boundary parallel to the existing
guarded contact-review append. It accepts only the module-private owner-dossier
input and its content-addressed contact parent, delegates the deterministic
append to the canonical progress kernel, then independently proves the complete
one-receipt final transition. Exact retries reuse the same frozen object;
changed parents fail closed.

**Tech stack:** TypeScript, Zod contracts, Node test runner through `tsx`, private
`WeakSet`/`WeakMap` trust, SHA-256-derived progress identities, Cloudflare safety
scan, Next/OpenNext release gate.

**Execution mode:** Inline execution on the owner-designated non-synced checkout
and rebuild branch; no subagent writes and no live or external operation.

---

### Task 1: Establish the exact predecessor and baseline

- [x] Read AGENTS, owner context, status, master plan, gotchas, runbook, ADRs
  0032/0043/0044, canonical progress, and predecessor append boundaries.
- [x] Verify the non-synced repository, branch, local/remote equality, and clean
  working tree at `be77afabbabafeb111d74d15642e070a0796bc5c`.
- [x] Run the owner-dossier plus canonical-progress baseline and require 10/10
  tests to pass.

### Task 2: Specify the final append contract test-first

**Files:**

- Modify: `src/lib/revenue-engine/private-kw-owner-dossier-progress.test.ts`
- Create later: `src/lib/revenue-engine/private-kw-owner-dossier-progress-append.ts`

- [x] Add a success/retry test that derives the real trusted input, builds the
  canonical expected receipt, appends against a cloned content-equivalent
  manifest/parent, and proves the exact final transition, next-incomplete pointer,
  unchanged other nine records, deep freeze, exact-result trust, clone rejection,
  and same-object retry.
- [x] Add adversarial tests for copied input, another manifest, a parent changed
  by another business, a re-digested parent, and replay against the completed
  child.
- [x] Run the focused test and require RED because the append module does not yet
  exist.

### Task 3: Implement the minimal guarded boundary

**Files:**

- Create: `src/lib/revenue-engine/private-kw-owner-dossier-progress-append.ts`
- Modify: `scripts/check-safety-config.mjs`

- [x] Require exact owner-dossier input/parent trust and exact manifest/phase.
- [x] Cache only exact input plus parent ID/digest retries.
- [x] Delegate to the canonical receipt builder/appender, then independently
  verify parent, authority, one-receipt mutation, final summary/pointer, prior
  prefix, target index, complete manifest-bound source identity, and unchanged
  other businesses.
- [x] Deep-freeze/register the result and reject schema-valid clones.
- [x] Extend static safety to require those invariants and forbid all operator,
  Worker, UI/API, file, database, runtime, provider, network, mutation, deployment,
  outreach, send, cost, and real-data paths.
- [x] Run focused tests and safety checks to GREEN, including an explicit
  canonical-kernel regression proving that final completion advances the
  next-incomplete cohort pointer.

### Task 4: Record the architecture and handoff state

**Files:**

- Create: `docs/adr/0045-append-owner-dossier-progress-only-against-its-exact-parent.md`
- Modify: `docs/adr/0032-bound-the-first-real-business-shadow-slice.md`
- Modify: `docs/adr/0044-bind-owner-dossier-acceptance-to-exact-read-proof.md`
- Modify: `README.md`
- Modify: `docs/RUNBOOK.md`
- Modify: `docs/DATA_DICTIONARY.md`
- Modify: `docs/STATUS.md`

- [x] Record the exact trust boundary, options, trade-offs, consequences, and
  remaining authentication/durable/operator work in ADR 0045.
- [x] Update predecessor action lists and correct any completed checkpoint whose
  plan still says its push is pending.
- [x] Update README, runbook, data dictionary, and STATUS with owner-readable
  impact, production/automation state, C$0 spend, owner decisions, eventual-main
  direction, and exactly three next actions.

### Task 5: Verify and checkpoint

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

- [x] Review every changed file, run `git diff --check`, scan staged additions for
  secret-like values and sensitive owner-data files, and verify the remote branch
  has not moved.
- [ ] Commit one atomic checkpoint with
  `feat: guard owner dossier progress append`, push only the rebuild branch, and
  verify exact local/remote equality plus a clean worktree. Do not merge `main`.
