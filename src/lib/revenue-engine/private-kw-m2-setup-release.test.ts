import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";

import {
  PRIVATE_KW_M2_DATABASE_RECEIPT_V2,
  PRIVATE_KW_M2_MIGRATION_RANGE,
  PRIVATE_KW_M2_SETUP_RELEASE_VERSION,
  PrivateKwM2DatabaseSetupReceiptSchema,
  PrivateKwM2RollbackReleaseEnvelopeSchema,
  PrivateKwM2SetupReleaseEnvelopeSchema,
  privateKwM2DatabaseSetupReceiptDigest,
  privateKwM2BackupRestoreEvidenceDigest,
  privateKwM2RollbackReleaseEnvelopeDigest,
  privateKwM2SetupReleaseEnvelopeDigest,
  readPrivateKwM2SetupJson,
  loadPrivateKwM2RollbackReleaseEnvelope,
  loadPrivateKwM2SetupReleaseEnvelope,
} from "./private-kw-m2-setup-release";
import { PRIVATE_KW_M2_MIGRATION_FILES } from "../../../scripts/private-kw-m2-database";

const migrationManifest = PRIVATE_KW_M2_MIGRATION_FILES.map((filename) => ({ filename, sha256: createHash("sha256").update(execFileSync("git", ["show", `HEAD:migrations/${filename}`])).digest("hex") }));
const digest = "a".repeat(64);
const identity = { device: "1", inode: "2", byteLength: 10, modificationMarker: "3:4", sha256: digest };
const fixtureToken = randomBytes(16).toString("hex");

function releaseCore() {
  return {
    envelopeVersion: PRIVATE_KW_M2_SETUP_RELEASE_VERSION,
    status: "APPROVED" as const,
    repositoryCommit: "b".repeat(40),
    migrationRange: PRIVATE_KW_M2_MIGRATION_RANGE,
    migrationManifest,
    databasePath: "data/kw-evaluation/m2.sqlite",
    backupPath: "data/kw-evaluation/m2-backup.sqlite",
    receiptPath: "data/kw-evaluation/m2-receipt.json",
    quarantinePath: "data/kw-evaluation/m2-quarantine.sqlite",
    localSchemaMutationAuthorized: true as const,
    remoteMigrationAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    runtimeQualificationAuthorized: false as const,
    runtimeContactAuthorized: false as const,
    runtimeOutreachAuthorized: false as const,
    runtimeSendAuthorized: false as const,
    deploymentAuthorized: false as const,
    costAuthorizedUsd: 0 as const,
    rollbackPolicy: "QUARANTINE_AND_OWNER_APPROVED_RESTORE" as const,
    approvedBy: "RILEY" as const,
    reviewedAt: "2026-09-21T10:00:00.000Z",
    expiresAt: "2026-09-22T10:00:00.000Z",
    rationale: "Bounded local schema setup only; all runtime and provider authority remains disabled.",
    confirmation: "APPROVE_M2_LOCAL_0069_SETUP" as const,
  };
}

function setupEnvelope() {
  const core = releaseCore();
  const envelopeDigest = privateKwM2SetupReleaseEnvelopeDigest(core);
  return PrivateKwM2SetupReleaseEnvelopeSchema.parse({
    ...core,
    envelopeId: `kw-m2-local-0069-release:${envelopeDigest}`,
    envelopeDigest,
  });
}

function backupRestoreCore() {
  const withoutEvidenceDigest = {
    backupPath: "data/kw-evaluation/m2-backup.sqlite",
    backupFileIdentity: identity,
    backupSha256: digest,
    logicalSnapshotDigest: "b".repeat(64),
    restoreDrillFileIdentity: identity,
    restoreDrillSha256: digest,
    restoreDrillVerified: true as const,
  };
  return {
    ...withoutEvidenceDigest,
    evidenceDigest: privateKwM2BackupRestoreEvidenceDigest(withoutEvidenceDigest),
  };
}

function rollbackCore(setup: ReturnType<typeof setupEnvelope>) {
  return {
    envelopeVersion: "kw-m2-local-rollback-v1" as const,
    status: "APPROVED" as const,
    setupReleaseEnvelopeId: setup.envelopeId,
    setupReleaseEnvelopeDigest: setup.envelopeDigest,
    databasePath: setup.databasePath,
    backupPath: setup.backupPath,
    quarantinePath: setup.quarantinePath,
    rollbackReceiptPath: `data/kw-evaluation/m2-rollback-${fixtureToken}.json`,
    suspectFileIdentity: identity,
    backupFileIdentity: identity,
    logicalSnapshotDigest: "b".repeat(64),
    approvedBy: "RILEY" as const,
    reviewedAt: "2026-09-21T11:00:00.000Z",
    expiresAt: "2026-09-21T13:00:00.000Z",
    rationale: "Owner-approved local restore of the immutable pre-migration database.",
    confirmation: "RESTORE_M2_LOCAL_DATABASE_FROM_BACKUP" as const,
  };
}

describe("private KW M2 setup release contract", () => {
  it("requires an exact content-bound APPROVED release and rejects copies or unknown fields", () => {
    const core = releaseCore();
    const expected = privateKwM2SetupReleaseEnvelopeDigest(core);
    const valid = {
      ...core,
      envelopeId: `kw-m2-local-0069-release:${expected}`,
      envelopeDigest: expected,
    };
    assert.equal(PrivateKwM2SetupReleaseEnvelopeSchema.safeParse(valid).success, true);
    assert.equal(PrivateKwM2SetupReleaseEnvelopeSchema.safeParse({ ...valid, status: "PENDING" }).success, false);
    assert.equal(PrivateKwM2SetupReleaseEnvelopeSchema.safeParse({ ...valid, rationale: "tampered" }).success, false);
    assert.equal(PrivateKwM2SetupReleaseEnvelopeSchema.safeParse({ ...valid, unexpected: true }).success, false);
    assert.equal(PrivateKwM2SetupReleaseEnvelopeSchema.safeParse({ ...valid, migrationManifest: [...migrationManifest].reverse() }).success, false);
    assert.equal(PrivateKwM2SetupReleaseEnvelopeSchema.safeParse({ ...valid, quarantinePath: core.backupPath }).success, false);
  });

  it("binds a v2 receipt to the release, ordered manifest, backup, restore drill, and zero authority", () => {
    const core = {
      receiptVersion: PRIVATE_KW_M2_DATABASE_RECEIPT_V2,
      databasePath: "data/kw-evaluation/m2.sqlite",
      fileIdentity: identity,
      setupReleaseEnvelopeId: `kw-m2-local-0069-release:${digest}`,
      setupReleaseEnvelopeDigest: digest,
      migrationRange: PRIVATE_KW_M2_MIGRATION_RANGE,
      migrationManifest,
      migrationsCommit: "b".repeat(40),
      schemaDigest: digest,
      preMigrationFileIdentity: identity,
      backupRestore: backupRestoreCore(),
      authority: {
        localOnly: true as const,
        localSchemaMutationPerformed: true as const,
        setupReleaseEnvelopeId: `kw-m2-local-0069-release:${digest}`,
        setupReleaseEnvelopeDigest: digest,
        remoteMigrationAuthorized: false as const,
        runtimeQualificationAuthorized: false as const,
        runtimeContactAuthorized: false as const,
        runtimeOutreachAuthorized: false as const,
        runtimeSendAuthorized: false as const,
        deploymentAuthorized: false as const,
        providerOperationsAuthorized: 0 as const,
        costAuthorizedUsd: 0 as const,
      },
    };
    const expected = privateKwM2DatabaseSetupReceiptDigest(core);
    const valid = { ...core, receiptId: `kw-m2-database:${expected}`, receiptDigest: expected };
    assert.equal(PrivateKwM2DatabaseSetupReceiptSchema.safeParse(valid).success, true);
    assert.equal(PrivateKwM2DatabaseSetupReceiptSchema.safeParse({ ...valid, setupReleaseEnvelopeDigest: "c".repeat(64) }).success, false);
    assert.equal(PrivateKwM2DatabaseSetupReceiptSchema.safeParse({ ...valid, authority: { ...core.authority, runtimeSendAuthorized: true } }).success, false);
    assert.equal(PrivateKwM2DatabaseSetupReceiptSchema.safeParse({ ...valid, migrationManifest: migrationManifest.slice(0, -1) }).success, false);
    assert.equal(PrivateKwM2DatabaseSetupReceiptSchema.safeParse({ ...valid, backupRestore: { ...core.backupRestore, backupSha256: "c".repeat(64) } }).success, false);
    assert.equal(PrivateKwM2DatabaseSetupReceiptSchema.safeParse({ ...valid, backupRestore: { ...core.backupRestore, restoreDrillSha256: "c".repeat(64) } }).success, false);
    assert.equal(PrivateKwM2DatabaseSetupReceiptSchema.safeParse({ ...valid, backupRestore: { ...core.backupRestore, logicalSnapshotDigest: undefined } }).success, false);
    assert.equal(PrivateKwM2DatabaseSetupReceiptSchema.safeParse({ ...valid, backupRestore: { ...core.backupRestore, evidenceDigest: "c".repeat(64) } }).success, false);
    assert.equal(PrivateKwM2DatabaseSetupReceiptSchema.safeParse({ ...valid, backupRestore: { ...core.backupRestore, backupPath: core.databasePath } }).success, false);
  });

  it("derives the current commit and migration bytes independently and enforces the review window", async () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    const repositoryCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const core = { ...releaseCore(), repositoryCommit, reviewedAt: "2026-09-21T11:00:00.000Z", expiresAt: "2026-09-21T13:00:00.000Z" };
    const digest = privateKwM2SetupReleaseEnvelopeDigest(core);
    const envelope = { ...core, envelopeId: `kw-m2-local-0069-release:${digest}`, envelopeDigest: digest };
    const relative = `data/kw-evaluation/m2-task-8-loader-test-${fixtureToken}.json`;
    await mkdir("data/kw-evaluation", { recursive: true });
    await writeFile(relative, JSON.stringify(envelope), { flag: "wx" });
    try {
      assert.deepEqual(await readPrivateKwM2SetupJson(relative), envelope);
      const loaded = await loadPrivateKwM2SetupReleaseEnvelope(relative, { now });
      assert.equal(loaded.envelopeDigest, digest);
      assert.throws(() => (loaded as { rationale: string }).rationale = "changed", TypeError);
      const futureCore = { ...core, reviewedAt: "2026-09-21T12:00:01.000Z" };
      const futureDigest = privateKwM2SetupReleaseEnvelopeDigest(futureCore);
      await writeFile(relative, JSON.stringify({ ...futureCore, envelopeId: `kw-m2-local-0069-release:${futureDigest}`, envelopeDigest: futureDigest }));
      await assert.rejects(loadPrivateKwM2SetupReleaseEnvelope(relative, { now }), /future/);
      const expiredCore = { ...core, expiresAt: "2026-09-21T12:00:00.000Z" };
      const expiredDigest = privateKwM2SetupReleaseEnvelopeDigest(expiredCore);
      await writeFile(relative, JSON.stringify({ ...expiredCore, envelopeId: `kw-m2-local-0069-release:${expiredDigest}`, envelopeDigest: expiredDigest }));
      await assert.rejects(loadPrivateKwM2SetupReleaseEnvelope(relative, { now }), /expired/);
    } finally {
      try { await unlink(relative); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  });

  it("seals the rollback release and reloads only a matching setup envelope", async () => {
    const setup = setupEnvelope();
    const core = rollbackCore(setup);
    const envelopeDigest = privateKwM2RollbackReleaseEnvelopeDigest(core);
    const valid = { ...core, envelopeId: `kw-m2-local-rollback:${envelopeDigest}`, envelopeDigest };
    assert.equal(PrivateKwM2RollbackReleaseEnvelopeSchema.safeParse(valid).success, true);
    assert.equal(PrivateKwM2RollbackReleaseEnvelopeSchema.safeParse({ ...valid, status: "PENDING" }).success, false);
    assert.equal(PrivateKwM2RollbackReleaseEnvelopeSchema.safeParse({ ...valid, logicalSnapshotDigest: undefined }).success, false);
    assert.equal(PrivateKwM2RollbackReleaseEnvelopeSchema.safeParse({ ...valid, databasePath: core.backupPath }).success, false);
    assert.equal(PrivateKwM2RollbackReleaseEnvelopeSchema.safeParse({ ...valid, envelopeDigest: "c".repeat(64) }).success, false);

    const relative = `data/kw-evaluation/m2-rollback-loader-${fixtureToken}.json`;
    await mkdir("data/kw-evaluation", { recursive: true });
    await writeFile(relative, JSON.stringify(valid), { flag: "wx" });
    try {
      const loaded = await loadPrivateKwM2RollbackReleaseEnvelope(relative, setup, { now: new Date("2026-09-21T12:00:00.000Z") });
      assert.equal(loaded.envelopeDigest, envelopeDigest);
      const mismatchedSetupCore = { ...releaseCore(), rationale: "Different owner-approved setup envelope for mismatch testing." };
      const mismatchedDigest = privateKwM2SetupReleaseEnvelopeDigest(mismatchedSetupCore);
      const mismatchedSetup = PrivateKwM2SetupReleaseEnvelopeSchema.parse({
        ...mismatchedSetupCore,
        envelopeId: `kw-m2-local-0069-release:${mismatchedDigest}`,
        envelopeDigest: mismatchedDigest,
      });
      await assert.rejects(loadPrivateKwM2RollbackReleaseEnvelope(relative, mismatchedSetup, { now: new Date("2026-09-21T12:00:00.000Z") }), /does not match/);
    } finally {
      try { await unlink(relative); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  });
});
