import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import path from "node:path";

import { PRIVATE_KW_M2_MIGRATION_FILES } from "./private-kw-m2-database";
import { privateKwM2SetupReleaseEnvelopeDigest } from "../src/lib/revenue-engine/private-kw-m2-setup-release";
import { PRIVATE_KW_M2_SETUP_LOCK_PATH, preflightPrivateKwM2Setup } from "./private-kw-m2-setup";

const root = path.resolve("data/kw-evaluation");
const token = `${process.pid}-${Date.now()}`;
const envelopePath = `data/kw-evaluation/m2-preflight-test-${token}.json`;
const databasePath = path.join(root, `m2-preflight-database-${token}.sqlite`);
const backupPath = path.join(root, `m2-preflight-backup-${token}.sqlite`);
const receiptPath = path.join(root, `m2-preflight-receipt-${token}.json`);
const quarantinePath = path.join(root, `m2-preflight-quarantine-${token}.sqlite`);
const sidecarPath = `${databasePath}-wal`;
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const manifest = PRIVATE_KW_M2_MIGRATION_FILES.map((filename) => ({ filename, sha256: sha(execFileSync("git", ["show", `HEAD:migrations/${filename}`])) }));
const createdIdentities = new Map<string, { dev: bigint; ino: bigint }>();

async function rememberCreated(file: string) {
  const stats = await lstat(file, { bigint: true });
  createdIdentities.set(file, { dev: stats.dev, ino: stats.ino });
}

function envelope(overrides: Record<string, unknown> = {}) {
  const core = {
    envelopeVersion: "kw-m2-local-0069-release-v1", status: "APPROVED", repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), migrationRange: "0054-0069", migrationManifest: manifest,
    databasePath: `data/kw-evaluation/${path.basename(databasePath)}`, backupPath: `data/kw-evaluation/${path.basename(backupPath)}`, receiptPath: `data/kw-evaluation/${path.basename(receiptPath)}`, quarantinePath: `data/kw-evaluation/${path.basename(quarantinePath)}`, localSchemaMutationAuthorized: true, remoteMigrationAuthorized: false, providerOperationsAuthorized: 0, runtimeQualificationAuthorized: false, runtimeContactAuthorized: false, runtimeOutreachAuthorized: false, runtimeSendAuthorized: false, deploymentAuthorized: false, costAuthorizedUsd: 0, rollbackPolicy: "QUARANTINE_AND_OWNER_APPROVED_RESTORE", approvedBy: "RILEY", reviewedAt: "2026-09-21T10:00:00.000Z", expiresAt: "2099-09-22T00:00:00.000Z", rationale: "Bounded local preflight fixture only.", confirmation: "APPROVE_M2_LOCAL_0069_SETUP",
    ...overrides,
  };
  const digest = privateKwM2SetupReleaseEnvelopeDigest(core as never);
  return { ...core, envelopeId: `kw-m2-local-0069-release:${digest}`, envelopeDigest: digest };
}

async function prepare() {
  await mkdir(root, { recursive: true });
  await writeFile(databasePath, Buffer.from("synthetic preflight database", "utf8"), { flag: "wx" });
  await rememberCreated(databasePath);
  await writeFile(envelopePath, JSON.stringify(envelope()), { flag: "wx" });
  await rememberCreated(envelopePath);
}

async function cleanupFixture() {
  for (const file of [envelopePath, databasePath, backupPath, receiptPath, quarantinePath, sidecarPath]) {
    try {
      const opened = await lstat(file, { bigint: true });
      const owned = createdIdentities.get(file);
      if (!owned || (!opened.isFile() && !opened.isSymbolicLink()) || opened.dev !== owned.dev || opened.ino !== owned.ino) continue;
      await unlink(file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  createdIdentities.clear();
}

describe("private KW M2 setup preflight", () => {
  it("loads the envelope, acquires/releases the lock, and performs no database write", async () => {
    await prepare();
    try {
      const before = await readFile(databasePath);
      const result = await preflightPrivateKwM2Setup(envelopePath, new Date("2026-09-21T12:00:00.000Z"));
      assert.deepEqual(await readFile(databasePath), before);
      assert.equal(result.databasePath, databasePath);
      await result.releaseLock();
      await assert.rejects(readFile(PRIVATE_KW_M2_SETUP_LOCK_PATH), { code: "ENOENT" });
    } finally { await cleanupFixture(); }
  });

  it("fails closed for missing, invalid, expired, colliding, and symlink targets", async () => {
    await prepare();
    try {
      await unlink(envelopePath); await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /ENOENT|release/);
      await writeFile(envelopePath, JSON.stringify(envelope({ status: "PENDING" }))); await rememberCreated(envelopePath); await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /APPROVED|Invalid/);
      await unlink(envelopePath); await writeFile(envelopePath, JSON.stringify(envelope({ expiresAt: "2020-01-01T00:00:00.000Z" }))); await rememberCreated(envelopePath); await assert.rejects(preflightPrivateKwM2Setup(envelopePath, new Date("2026-09-21T12:00:00.000Z")), /expire/);
      await unlink(envelopePath); await writeFile(envelopePath, JSON.stringify(envelope({ backupPath: `data/kw-evaluation/${path.basename(databasePath)}` }))); await rememberCreated(envelopePath); await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /distinct/);
      await unlink(envelopePath); await writeFile(envelopePath, JSON.stringify(envelope())); await rememberCreated(envelopePath);
      await writeFile(sidecarPath, "wal", { flag: "wx" }); await rememberCreated(sidecarPath);
      await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /sidecars/);
      await assert.rejects(readFile(PRIVATE_KW_M2_SETUP_LOCK_PATH), { code: "ENOENT" });
      await unlink(sidecarPath); createdIdentities.delete(sidecarPath);
      try {
        await symlink(databasePath, backupPath);
        await rememberCreated(backupPath);
        await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /regular canonical|symbolic/);
      } catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "EPERM"); }
    } finally { await cleanupFixture(); }
  });

  it("rejects lock contention and permits only the owning lock release", async () => {
    await prepare();
    try {
      try { await lstat(PRIVATE_KW_M2_SETUP_LOCK_PATH); return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await writeFile(PRIVATE_KW_M2_SETUP_LOCK_PATH, "other-process\n", { flag: "wx" });
      const ownedLock = await lstat(PRIVATE_KW_M2_SETUP_LOCK_PATH, { bigint: true });
      await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /already locked/);
      const currentLock = await lstat(PRIVATE_KW_M2_SETUP_LOCK_PATH, { bigint: true });
      if (currentLock.dev === ownedLock.dev && currentLock.ino === ownedLock.ino) await unlink(PRIVATE_KW_M2_SETUP_LOCK_PATH);
    } finally { await cleanupFixture(); }
  });
});
