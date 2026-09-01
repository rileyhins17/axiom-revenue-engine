# Owner-Dossier Acceptance Proof and Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind one explicit read-only owner-dossier declaration to the exact
trusted dossier and guarded contact-review parent, then derive one frozen
zero-authority `OWNER_DOSSIER` phase input without appending or persisting it.

**Architecture:** The SELECT-only dossier reader will deep-freeze and register
its exact result. A separate proof module will content-address that exact dossier,
the four-receipt contact checkpoint, and a bounded explicit declaration. A
separate input module will regenerate proof internally, bind the input privately
to its unchanged parent, and remain unable to append progress or access files,
databases, providers, runtimes, UI actions, or live resources.

**Tech Stack:** TypeScript, Zod, Node test runner through `tsx`, SHA-256 canonical
digests, private `WeakSet`/`WeakMap` trust, Cloudflare safety scan, Next/OpenNext
release gate.

---

### Task 1: Prove exact owner-dossier read provenance

**Files:**

- Modify: `src/lib/revenue-engine/owner-lead-detail-read-model.test.ts`
- Modify later: `src/lib/revenue-engine/owner-lead-detail-read-model.ts`

- [x] **Step 1: Write the failing exact-object trust test**

Import `requireInProcessOwnerLeadDetailResponse`, read a normal dossier, and
assert the exact result passes, every nested decision surface is frozen, and a
`structuredClone` fails with an exact-in-process error.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx tsx --test src/lib/revenue-engine/owner-lead-detail-read-model.test.ts
```

Expected: failure because the exact-object guard is not implemented.

- [x] **Step 3: Add minimal reader-owned trust**

Add one private `WeakSet`, recursive freeze helper, and exported guard. Parse the
response, freeze it, register it, and return it; retain `null` for missing leads.

- [x] **Step 4: Re-run the focused test and verify GREEN**

Run the same command and require all dossier tests to pass.

### Task 2: Specify owner-dossier proof and input test-first

**Files:**

- Create: `src/lib/revenue-engine/private-kw-owner-dossier-progress.test.ts`
- Create later: `src/lib/revenue-engine/private-kw-owner-dossier-progress-proof.ts`
- Create later: `src/lib/revenue-engine/private-kw-owner-dossier-progress.ts`
- Create later: `src/lib/revenue-engine/test-support/private-kw-owner-dossier-progress-fixture.ts`

- [x] **Step 1: Write the failing success test**

Build the existing synthetic contact-review fixture through its guarded append,
read the matching exact dossier, declare acceptance using the content digest,
and assert the wished-for proof/input APIs produce:

```ts
assert.equal(proof.proofId, `owner-dossier-acceptance:${proof.proofDigest}`);
assert.equal(proof.ownerDossier.dossierDigest, acceptance.dossierDigest);
assert.equal(input.phase, "OWNER_DOSSIER");
assert.equal(input.proof.primaryReceiptId, proof.proofId);
assert.deepEqual(input.proof.supportingReceipts, []);
assert.equal(input.previousPhaseReceipt?.phaseReceiptId, contactReceipt.phaseReceiptId);
```

Also require frozen outputs, all zero authorities, the parent checkpoint to stay
unchanged, and no `OWNER_DOSSIER_ACCEPTED` checkpoint to exist.

- [x] **Step 2: Write failing adversarial tests**

Reject a copied dossier, copied proof, copied input, changed parent, another
manifest, stale data quality/contact review, wrong invocation/snapshot lineage,
acceptance before dossier generation, acceptance over five minutes later, wrong
digest, and wrong confirmation.

- [x] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
npx tsx --test src/lib/revenue-engine/owner-lead-detail-read-model.test.ts src/lib/revenue-engine/private-kw-owner-dossier-progress.test.ts
```

Expected: missing owner-dossier proof/input behavior.

### Task 3: Implement the minimal proof and input boundaries

**Files:**

- Create: `src/lib/revenue-engine/private-kw-owner-dossier-progress-proof.ts`
- Create: `src/lib/revenue-engine/private-kw-owner-dossier-progress.ts`
- Create: `src/lib/revenue-engine/test-support/private-kw-owner-dossier-progress-fixture.ts`
- Test: `src/lib/revenue-engine/private-kw-owner-dossier-progress.test.ts`

- [x] **Step 1: Build the synthetic exact-dossier fixture**

Map the existing assessment, source, contact point, verification, and invocation
receipt into the real four-query owner reader. Derive the exact trusted contact
checkpoint through `buildPrivateKwContactReviewProgressInput` and
`appendPrivateKwContactReviewProgress`; do not manufacture checkpoint trust.

- [x] **Step 2: Implement the declaration and proof contract**

Use strict schemas, a five-minute acceptance window, canonical SHA-256 proof ID,
deep freeze, and a private proof trust set. Bind the exact manifest/checkpoint,
dossier digest and versions, current snapshots/contact review, declaration, and
all-false/zero authority. Explicitly record that session authentication and
durable decision storage are not proven by this layer.

- [x] **Step 3: Implement the zero-authority phase-input adapter**

Require exact contact checkpoint and dossier trust, regenerate proof internally,
derive `completedAt`/`recordedAt` from the declaration, set no supporting
receipts, and register the frozen input plus exact manifest/parent context in a
private `WeakSet`/`WeakMap`. Do not import an appender or receipt builder.

- [x] **Step 4: Re-run focused tests and verify GREEN**

Run the Task 2 command and require all tests to pass.

### Task 4: Make the boundary durable in repository policy

**Files:**

- Modify: `scripts/check-safety-config.mjs`
- Create: `docs/adr/0044-bind-owner-dossier-acceptance-to-exact-read-proof.md`
- Modify: `docs/adr/0032-bound-the-first-real-business-shadow-slice.md`
- Modify: `docs/adr/0042-derive-contact-review-progress-input-from-current-durable-proof.md`
- Modify: `docs/adr/0043-append-contact-review-progress-only-against-its-exact-parent.md`
- Modify: `README.md`
- Modify: `docs/RUNBOOK.md`
- Modify: `docs/DATA_DICTIONARY.md`
- Modify: `docs/STATUS.md`

- [x] **Step 1: Add static safety assertions**

Require reader exact-object trust/deep freeze, proof/input private trust, internal
proof regeneration, full manifest/parent checks, five-minute chronology, and
zero authority. Forbid appender/receipt-builder, operator, Worker, UI, file,
database, runtime, provider, network, mutation, and real-business imports in the
new proof/input modules.

- [x] **Step 2: Record ADR 0044 and update predecessor decisions**

Use Context, Decision, Options Considered, Trade-off Analysis, Consequences, and
Action Items. State clearly that owner-session authentication, durable decision
storage, append, operator wiring, real data, and live resources remain separate.

- [x] **Step 3: Update owner/handoff documentation**

Describe the exact proof/input boundary in README, runbook, and data dictionary.
Update STATUS with the previous verified commit, changed behavior, checks,
production/automation state, C$0 spend, no owner action, Riley's eventual-main
direction, and exactly three next actions.

- [x] **Step 4: Run focused safety, tests, typecheck, and lint**

```powershell
npm run check:safety
npx tsx --test src/lib/revenue-engine/owner-lead-detail-read-model.test.ts src/lib/revenue-engine/private-kw-owner-dossier-progress.test.ts
npm run typecheck
npm run lint
```

Expected: every command exits zero with no source lint warning.

### Task 5: Verify and checkpoint the milestone

**Files:** all files above; no unrelated changes.

- [x] **Step 1: Run the complete release gate sequentially**

```powershell
npm run check:safety
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
npx wrangler deploy --env="" --dry-run --autoconfig false
npm run test:owner-ui
```

Run the browser gate only after build and dry run exit. Require zero external
requests, no deployment upload, and no real prospect/provider operation.

- [x] **Step 2: Review the complete diff and changed-file safety**

Run `git diff --check`, inspect every changed file, confirm no secret-like or
owner-data file is staged, verify the remote branch has not moved, and ensure the
OneDrive repository was never used.

- [x] **Step 3: Commit and push one atomic checkpoint**

```powershell
git commit -m "feat: bind owner dossier acceptance proof"
git push origin RileyHinsperger/axiom-revenue-engine-rebuild
```

Expected: local and remote rebuild branches resolve to the same new commit and
the local non-synced worktree is clean. Do not merge to `main` in this milestone.
