# Contact-Review Progress Append Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Advance one exact trusted `CONTACT_REVIEW` input to one frozen
in-memory shadow-progress checkpoint without allowing copied trust, parent drift,
unrelated-business changes, durable writes, live resources, or outbound action.

**Architecture:** Add a small boundary parallel to the existing guarded
assessment append. It accepts only the module-private contact-review input and
its content-addressed assessment parent, delegates the deterministic append to
the canonical progress kernel, then independently proves the one-receipt state
transition before granting in-process checkpoint trust. Exact retries reuse the
same frozen object; changed parents fail closed.

**Tech Stack:** TypeScript, Zod contracts, Node test runner through `tsx`, private
`WeakSet`/`WeakMap` trust, SHA-256-derived progress identities, Cloudflare safety
scan, Next/OpenNext release gate.

**Execution mode:** Inline execution on the owner-designated local branch
`RileyHinsperger/axiom-revenue-engine-rebuild`; no subagent writes and no live or
external operation.

---

### Task 1: Specify the exact append contract test-first

**Files:**

- Modify: `src/lib/revenue-engine/private-kw-contact-review-progress.test.ts`
- Create later: `src/lib/revenue-engine/private-kw-contact-review-progress-append.ts`

- [x] **Step 1: Write the failing success/retry test**

Add imports for the not-yet-created append boundary and canonical receipt
builder. The test must derive the real trusted input from the existing synthetic
durable fixture, call the wished-for API, and assert:

```ts
const phaseInput = buildInput(fixture);
const expectedReceipt = buildPrivateKwShadowSlicePhaseReceipt(
  fixture.manifest,
  phaseInput,
);
const nextProgress = appendPrivateKwContactReviewProgress({
  manifestValue: structuredClone(fixture.manifest),
  previousProgressValue: structuredClone(fixture.assessmentCheckpoint),
  phaseInputValue: phaseInput,
});

assert.equal(targetAfter?.currentCheckpoint, "CONTACT_REVIEW_PERSISTED");
assert.equal(targetAfter?.nextRequiredGate, "OWNER_DOSSIER_ACCEPTANCE");
assert.deepEqual(targetAfter?.phaseReceipts.at(-1), expectedReceipt);
assert.deepEqual(otherAfter, otherBefore);
assert.equal(requireInProcessPrivateKwContactReviewProgressCheckpoint(
  nextProgress,
), nextProgress);
assert.equal(appendPrivateKwContactReviewProgress({
  manifestValue: structuredClone(fixture.manifest),
  previousProgressValue: structuredClone(fixture.assessmentCheckpoint),
  phaseInputValue: phaseInput,
}), nextProgress);
```

- [x] **Step 2: Write the failing trust/parent rejection test**

Exercise the public API with a copied phase input, a different manifest, a
checkpoint advanced for another business, and the already-completed child:

```ts
assert.throws(() => appendPrivateKwContactReviewProgress({
  manifestValue: fixture.manifest,
  previousProgressValue: fixture.assessmentCheckpoint,
  phaseInputValue: structuredClone(phaseInput),
}), /exact in-process result/i);

assert.throws(() => appendPrivateKwContactReviewProgress({
  manifestValue: fixture.manifest,
  previousProgressValue: changedParent,
  phaseInputValue: phaseInput,
}), /exact unchanged manifest and assessment parent checkpoint/i);
```

- [x] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npx tsx --test src/lib/revenue-engine/private-kw-contact-review-progress.test.ts
```

Expected: module-resolution or missing-export failure for
`private-kw-contact-review-progress-append`; the existing four tests remain
otherwise valid.

### Task 2: Implement the minimal guarded in-memory append

**Files:**

- Create: `src/lib/revenue-engine/private-kw-contact-review-progress-append.ts`
- Test: `src/lib/revenue-engine/private-kw-contact-review-progress.test.ts`

- [x] **Step 1: Add exact input/parent and exact-retry guards**

The module must expose only the trusted-checkpoint guard and the append function:

```ts
const trustedContactReviewCheckpoints = new WeakSet<object>();
const contactReviewCheckpointsByInput = new WeakMap<object, {
  parentCheckpointId: string;
  parentCheckpointDigest: string;
  checkpoint: PrivateKwShadowSliceProgressCheckpoint;
}>();

export function requireInProcessPrivateKwContactReviewProgressCheckpoint(
  value: unknown,
): PrivateKwShadowSliceProgressCheckpoint;

export function appendPrivateKwContactReviewProgress(input: {
  manifestValue: unknown;
  previousProgressValue: unknown;
  phaseInputValue: unknown;
}): PrivateKwShadowSliceProgressCheckpoint;
```

Require
`requireInProcessPrivateKwContactReviewProgressInputForParent(...)`, reject any
phase other than `CONTACT_REVIEW`, and return a cached checkpoint only when the
exact parent ID/digest still matches.

- [x] **Step 2: Use the canonical appender and independently verify the result**

Build the expected receipt, call `appendPrivateKwShadowSliceProgress`, and reject
unless every invariant holds:

```ts
nextProgress.summary.completedPhaseReceipts
  === previousProgress.summary.completedPhaseReceipts + 1;
nextProgress.summary.countsByCheckpoint.ASSESSMENT_PERSISTED
  === previousProgress.summary.countsByCheckpoint.ASSESSMENT_PERSISTED - 1;
nextProgress.summary.countsByCheckpoint.CONTACT_REVIEW_PERSISTED
  === previousProgress.summary.countsByCheckpoint.CONTACT_REVIEW_PERSISTED + 1;
nextRecord.currentCheckpoint === "CONTACT_REVIEW_PERSISTED";
nextRecord.nextRequiredGate === "OWNER_DOSSIER_ACCEPTANCE";
privateKwShadowSliceProgressDigest(nextRecord.phaseReceipts.slice(0, -1))
  === privateKwShadowSliceProgressDigest(previousRecord.phaseReceipts);
privateKwShadowSliceProgressDigest(appendedReceipt)
  === privateKwShadowSliceProgressDigest(expectedReceipt);
privateKwShadowSliceProgressDigest(nextOtherRecords)
  === privateKwShadowSliceProgressDigest(previousOtherRecords);
```

Also require unchanged progress version, manifest/slice/source identities,
authority, parent link, fully completed count, next-incomplete business, and all
checkpoint counts other than the one assessment-to-contact transition.

- [x] **Step 3: Freeze and register the verified checkpoint**

Deep-freeze the entire result, register its exact object in the private trust
set, cache it by exact input plus parent identity, and return it. Do not add a
file, database, runtime, provider, operator, real-data, or network dependency.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npx tsx --test src/lib/revenue-engine/private-kw-contact-review-progress.test.ts src/lib/revenue-engine/private-kw-contact-review-progress-proof.test.ts
```

Expected: all existing and two new append tests pass.

### Task 3: Make the trust boundary durable in repository policy

**Files:**

- Modify: `scripts/check-safety-config.mjs`
- Create: `docs/adr/0043-append-contact-review-progress-only-against-its-exact-parent.md`
- Modify: `docs/adr/0032-bound-the-first-real-business-shadow-slice.md`
- Modify: `docs/adr/0042-derive-contact-review-progress-input-from-current-durable-proof.md`
- Modify: `README.md`
- Modify: `docs/RUNBOOK.md`
- Modify: `docs/DATA_DICTIONARY.md`
- Modify: `docs/STATUS.md`

- [x] **Step 1: Add static safety assertions**

Require the new module to call the exact contact input parent guard, canonical
appender, canonical receipt builder, private retry cache, expected contact-review
state transition, deep freeze, and exact checkpoint trust. Forbid imports from
the generic operator recorder or inert Worker and forbid file/database/runtime/
provider/network/mutation APIs.

- [x] **Step 2: Record ADR 0043**

Use the accepted ADR format: Context, Decision, Options Considered, Trade-off
Analysis, Consequences, and Action Items. Explicitly document that this boundary
is in-memory only and that durable/operator progress is still unimplemented and
separately approval-gated.

- [x] **Step 3: Update owner and handoff documentation**

Update README, runbook, data dictionary, ADR action lists, and STATUS so the
repository says the exact input can now advance once in memory, but still has no
operator command, file/database output, live resource, real-business path,
contact action, deployment, or spend. STATUS must retain current production and
automation state, C$0 spend impact, owner decisions, and exactly three next
actions.

- [x] **Step 4: Run focused safety and tests**

Run:

```powershell
npm run check:safety
npx tsx --test src/lib/revenue-engine/private-kw-contact-review-progress.test.ts src/lib/revenue-engine/private-kw-contact-review-progress-proof.test.ts
npm run typecheck
npm run lint
```

Expected: every command exits zero with no lint warnings.

### Task 4: Verify and checkpoint the milestone

**Files:** all files above, with no unrelated changes.

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

The browser gate runs only after both build/dry-run processes exit. Expected:
zero failures, zero real prospect/provider requests, and no deployment upload.

- [x] **Step 2: Review the complete diff and secret-safe changed-file scan**

Require a clean `git diff --check`, no secret-like changed file, no unexpected
generated file, and no unrelated worktree change.

- [x] **Step 3: Commit and push one atomic checkpoint**

```powershell
git commit -m "feat: guard contact review progress append"
git push origin RileyHinsperger/axiom-revenue-engine-rebuild
```

Expected: local HEAD and the remote rebuild branch resolve to the same new
commit; the working tree is clean.
