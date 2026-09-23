import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PRIVATE_KW_M2_OWNER_DECISIONS_VERSION,
  type PrivateKwM2OwnerDecisions,
} from "./private-kw-m2-owner-decisions";
import {
  M2OwnerIdentityLocalStoreError,
  readLatestPrivateKwM2OwnerDecisions,
  savePrivateKwM2OwnerDecisions,
} from "./m2-owner-identity-local-store";

const REVIEW_SHA = "a".repeat(64);

function ledger(overrides: Partial<PrivateKwM2OwnerDecisions> = {}): PrivateKwM2OwnerDecisions {
  return {
    decisionVersion: PRIVATE_KW_M2_OWNER_DECISIONS_VERSION,
    researchReviewSha256: REVIEW_SHA,
    reviewedBy: "RILEY",
    reviewedAt: "2026-09-23T10:00:00.000Z",
    decisions: Array.from({ length: 10 }, (_, index) => ({
      reviewId: `M2-${String(index + 1).padStart(2, "0")}` as `M2-${string}`,
      action: "HOLD" as const,
      rationale: "Synthetic identity review needs more supported evidence.",
    })),
    ...overrides,
  };
}

async function withRoot(run: (rootDir: string) => Promise<void>) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "m2-owner-store-"));
  try {
    await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("saves an immutable private ledger and exact decision replay keeps its original timestamp", async () => {
  await withRoot(async (rootDir) => {
    const first = await savePrivateKwM2OwnerDecisions(ledger(), { rootDir });
    const replay = await savePrivateKwM2OwnerDecisions(ledger({ reviewedAt: "2026-09-24T10:00:00.000Z" }), { rootDir });

    assert.equal(first.status, "SAVED");
    assert.equal(replay.status, "ALREADY_SAVED");
    assert.equal(replay.filename, first.filename);
    assert.equal(replay.reviewedAt, first.reviewedAt);
    assert.deepEqual(await readdir(rootDir), [first.filename]);
    const saved = JSON.parse(await readFile(path.join(rootDir, first.filename), "utf8")) as PrivateKwM2OwnerDecisions;
    assert.equal(saved.reviewedAt, "2026-09-23T10:00:00.000Z");
  });
});

test("changed decisions create a distinct immutable version and latest read restores its exact choices", async () => {
  await withRoot(async (rootDir) => {
    const firstLedger = ledger();
    const changed = ledger({
      reviewedAt: "2026-09-24T10:00:00.000Z",
      decisions: firstLedger.decisions.map((decision, index) => index === 0
        ? { reviewId: decision.reviewId, action: "REJECT", rationale: "Synthetic evidence does not support this identity." }
        : decision),
    });
    const first = await savePrivateKwM2OwnerDecisions(firstLedger, { rootDir });
    const second = await savePrivateKwM2OwnerDecisions(changed, { rootDir });
    await savePrivateKwM2OwnerDecisions(ledger({
      researchReviewSha256: "b".repeat(64),
      reviewedAt: "2026-09-25T10:00:00.000Z",
    }), { rootDir });
    const latest = await readLatestPrivateKwM2OwnerDecisions(REVIEW_SHA, { rootDir });

    assert.notEqual(second.filename, first.filename);
    assert.equal(second.status, "SAVED");
    assert.equal(latest?.filename, second.filename);
    assert.equal(latest?.reviewedAt, changed.reviewedAt);
    assert.deepEqual(latest?.decisions, changed.decisions);
    assert.equal(latest?.reviewedBy, "RILEY");
    assert.equal((await readdir(rootDir)).length, 3);
  });
});

test("rejects invalid ledgers without writing files", async () => {
  await withRoot(async (rootDir) => {
    await assert.rejects(savePrivateKwM2OwnerDecisions({ ...ledger(), reviewedBy: "UNKNOWN" }, { rootDir }));
    assert.deepEqual(await readdir(rootDir), []);
  });
});

test("fails closed when the deterministic destination is replaced by a symlink", async (context) => {
  await withRoot(async (rootDir) => {
    const valid = ledger();
    const first = await savePrivateKwM2OwnerDecisions(valid, { rootDir });
    const target = path.join(rootDir, first.filename);
    await rm(target);
    try {
      await symlink(path.join(rootDir, "elsewhere.json"), target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("Windows symlink creation is not available in this environment.");
        return;
      }
      throw error;
    }

    await assert.rejects(savePrivateKwM2OwnerDecisions(valid, { rootDir }), M2OwnerIdentityLocalStoreError);
  });
});

test("fails closed on a partial or oversized stored record", async (context) => {
  await context.test("partial record", async () => withRoot(async (rootDir) => {
    const first = await savePrivateKwM2OwnerDecisions(ledger(), { rootDir });
    await writeFile(path.join(rootDir, first.filename), "{partial", "utf8");
    await assert.rejects(savePrivateKwM2OwnerDecisions(ledger(), { rootDir }), M2OwnerIdentityLocalStoreError);
    await assert.rejects(readLatestPrivateKwM2OwnerDecisions(REVIEW_SHA, { rootDir }), M2OwnerIdentityLocalStoreError);
  }));

  await context.test("oversized record", async () => withRoot(async (rootDir) => {
    const first = await savePrivateKwM2OwnerDecisions(ledger(), { rootDir });
    await writeFile(path.join(rootDir, first.filename), "x".repeat(200_000), "utf8");
    await assert.rejects(readLatestPrivateKwM2OwnerDecisions(REVIEW_SHA, { rootDir }), M2OwnerIdentityLocalStoreError);
  }));
});
