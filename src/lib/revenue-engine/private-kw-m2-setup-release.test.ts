import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PRIVATE_KW_M2_DATABASE_RECEIPT_V2,
  PRIVATE_KW_M2_MIGRATION_RANGE,
  PRIVATE_KW_M2_SETUP_RELEASE_VERSION,
  PrivateKwM2DatabaseSetupReceiptSchema,
  PrivateKwM2SetupReleaseEnvelopeSchema,
  privateKwM2DatabaseSetupReceiptDigest,
  privateKwM2SetupReleaseEnvelopeDigest,
} from "./private-kw-m2-setup-release";
import { privateKwM2MigrationManifest } from "../../../scripts/private-kw-m2-database";

const migrationManifest = privateKwM2MigrationManifest();
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
});
