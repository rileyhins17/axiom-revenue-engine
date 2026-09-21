import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
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
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const manifest = PRIVATE_KW_M2_MIGRATION_FILES.map((filename) => ({ filename, sha256: sha(execFileSync("git", ["show", `HEAD:migrations/${filename}`])) }));

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
  await writeFile(envelopePath, JSON.stringify(envelope()), { flag: "wx" });
}

async function cleanupFixture() {
  for (const file of [envelopePath, databasePath, backupPath, receiptPath, quarantinePath]) {
    try {
      const opened = await lstat(file, { bigint: true });
      if (!opened.isFile() || opened.isSymbolicLink()) continue;
      await rm(file, { force: true });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
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
      await rm(envelopePath); await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /ENOENT|release/);
      await writeFile(envelopePath, JSON.stringify(envelope({ status: "PENDING" }))); await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /APPROVED|Invalid/);
      await writeFile(envelopePath, JSON.stringify(envelope({ expiresAt: "2020-01-01T00:00:00.000Z" }))); await assert.rejects(preflightPrivateKwM2Setup(envelopePath, new Date("2026-09-21T12:00:00.000Z")), /expire/);
      await writeFile(envelopePath, JSON.stringify(envelope({ backupPath: `data/kw-evaluation/${path.basename(databasePath)}` }))); await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /distinct/);
      await writeFile(envelopePath, JSON.stringify(envelope()));
      try { await symlink(databasePath, backupPath); await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /regular canonical|symbolic/); } catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "EPERM"); }
    } finally { await cleanupFixture(); }
  });

  it("rejects lock contention and permits only the owning lock release", async () => {
    await prepare();
    try {
      try { await lstat(PRIVATE_KW_M2_SETUP_LOCK_PATH); return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await writeFile(PRIVATE_KW_M2_SETUP_LOCK_PATH, "other-process\n", { flag: "wx" });
      await assert.rejects(preflightPrivateKwM2Setup(envelopePath), /already locked/);
      await unlink(PRIVATE_KW_M2_SETUP_LOCK_PATH);
    } finally { await cleanupFixture(); }
  });
});
