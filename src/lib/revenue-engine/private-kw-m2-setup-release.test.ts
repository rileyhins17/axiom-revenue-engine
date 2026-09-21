import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";

import {
  PRIVATE_KW_M2_DATABASE_RECEIPT_V2,
  PRIVATE_KW_M2_MIGRATION_RANGE,
  PRIVATE_KW_M2_MIGRATION_FILES,
  PRIVATE_KW_M2_SETUP_RELEASE_VERSION,
  PrivateKwM2DatabaseSetupReceiptSchema,
  PrivateKwM2SetupReleaseEnvelopeSchema,
  privateKwM2DatabaseSetupReceiptDigest,
  privateKwM2SetupReleaseEnvelopeDigest,
  loadPrivateKwM2SetupReleaseEnvelope,
} from "./private-kw-m2-setup-release";

const migrationManifest = PRIVATE_KW_M2_MIGRATION_FILES.map((filename) => ({ filename, sha256: createHash("sha256").update(execFileSync("git", ["show", `HEAD:migrations/${filename}`])).digest("hex") }));
const digest = "a".repeat(64);
const identity = { device: "1", inode: "2", byteLength: 10, modificationMarker: "3:4", sha256: digest };

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
      backupRestore: {
        backupPath: "data/kw-evaluation/m2-backup.sqlite",
        backupFileIdentity: identity,
        backupSha256: digest,
        restoreDrillFileIdentity: identity,
        restoreDrillSha256: digest,
        restoreDrillVerified: true as const,
        evidenceDigest: digest,
      },
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
  });

  it("derives the current commit and migration bytes independently and enforces the review window", async () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    const repositoryCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const core = { ...releaseCore(), repositoryCommit, reviewedAt: "2026-09-21T11:00:00.000Z", expiresAt: "2026-09-21T13:00:00.000Z" };
    const digest = privateKwM2SetupReleaseEnvelopeDigest(core);
    const envelope = { ...core, envelopeId: `kw-m2-local-0069-release:${digest}`, envelopeDigest: digest };
    const relative = "data/kw-evaluation/m2-task-8-loader-test.json";
    await mkdir("data/kw-evaluation", { recursive: true });
    await writeFile(relative, JSON.stringify(envelope));
    try {
      const loaded = await loadPrivateKwM2SetupReleaseEnvelope(relative, { now });
      assert.equal(loaded.envelopeDigest, digest);
      assert.throws(() => (loaded as { rationale: string }).rationale = "changed", TypeError);
      await assert.rejects(loadPrivateKwM2SetupReleaseEnvelope(relative, { now }), /clean migration working tree|Git HEAD blobs/);
      const futureCore = { ...core, reviewedAt: "2026-09-21T12:00:01.000Z" };
      const futureDigest = privateKwM2SetupReleaseEnvelopeDigest(futureCore);
      await writeFile(relative, JSON.stringify({ ...futureCore, envelopeId: `kw-m2-local-0069-release:${futureDigest}`, envelopeDigest: futureDigest }));
      await assert.rejects(loadPrivateKwM2SetupReleaseEnvelope(relative, { now }), /future/);
      const expiredCore = { ...core, expiresAt: "2026-09-21T12:00:00.000Z" };
      const expiredDigest = privateKwM2SetupReleaseEnvelopeDigest(expiredCore);
      await writeFile(relative, JSON.stringify({ ...expiredCore, envelopeId: `kw-m2-local-0069-release:${expiredDigest}`, envelopeDigest: expiredDigest }));
      await assert.rejects(loadPrivateKwM2SetupReleaseEnvelope(relative, { now }), /expired/);
    } finally {
      await rm(relative, { force: true });
    }
  });
});
