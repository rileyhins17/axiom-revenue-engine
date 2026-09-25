import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { lstat, mkdir, readFile, readdir, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { describe, it, mock } from "node:test";
import path from "node:path";
import Database from "better-sqlite3";
import { registerM2AssessmentAcceptanceTests } from "./private-kw-m2-html-assessment.acceptance";

import { PRIVATE_KW_M2_MIGRATION_FILES } from "./private-kw-m2-database";
import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import { privateKwM2SetupDigest, privateKwM2SetupReleaseEnvelopeDigest } from "../src/lib/revenue-engine/private-kw-m2-setup-release";
import { applyPrivateKwM2Setup, backupPrivateKwM2Database, PRIVATE_KW_M2_SETUP_LOCK_PATH, preflightPrivateKwM2Setup, preflightPrivateKwM2Rollback, rollbackPrivateKwM2Setup, verifyPrivateKwM2Setup } from "./private-kw-m2-setup";
import { inspectSetupSnapshot, readSetupFile } from "./private-kw-m2-snapshot";

const root = path.resolve("data/kw-evaluation");
registerM2AssessmentAcceptanceTests();
const token = `${process.pid}-${Date.now()}`;
const envelopePath = `data/kw-evaluation/m2-preflight-test-${token}.json`;
const databasePath = path.join(root, `m2-preflight-database-${token}.sqlite`);
const backupPath = path.join(root, `m2-preflight-backup-${token}.sqlite`);
const receiptPath = path.join(root, `m2-preflight-receipt-${token}.json`);
const quarantinePath = path.join(root, `m2-preflight-quarantine-${token}.sqlite`);
const sidecarPath = `${databasePath}-wal`;
const backupFixtureEnvelopePath = path.join(root, `m2-backup-envelope-${token}.json`);
const backupFixtureEnvelopeRelative = `data/kw-evaluation/m2-backup-envelope-${token}.json`;
const backupFixtureDatabasePath = path.join(root, `m2-backup-database-${token}.sqlite`);
const backupFixturePath = path.join(root, `m2-backup-output-${token}.sqlite`);
const backupFixtureReceiptPath = path.join(root, `m2-backup-receipt-${token}.json`);
const backupFixtureQuarantinePath = path.join(root, `m2-backup-quarantine-${token}.sqlite`);
const backupFixtureSidecarPath = `${backupFixtureDatabasePath}-wal`;
const backupFixtureShmPath = `${backupFixtureDatabasePath}-shm`;
const rollbackEnvelopePath = `data/kw-evaluation/m2-rollback-envelope-${token}.json`;
const rollbackReceiptPath = `data/kw-evaluation/m2-rollback-receipt-${token}.json`;
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const manifest = PRIVATE_KW_M2_MIGRATION_FILES.map((filename) => ({ filename, sha256: sha(execFileSync("git", ["show", `HEAD:migrations/${filename}`])) }));
const createdIdentities = new Map<string, { dev: bigint; ino: bigint }>();

async function rememberCreated(file: string) {
  const stats = await lstat(file, { bigint: true });
  createdIdentities.set(file, { dev: stats.dev, ino: stats.ino });
}

function envelope(overrides: Record<string, unknown> = {}) {
  const reviewedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const core = {
    envelopeVersion: "kw-m2-local-0069-release-v1", status: "APPROVED", repositoryCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), migrationRange: "0054-0069", migrationManifest: manifest,
    databasePath: `data/kw-evaluation/${path.basename(databasePath)}`, backupPath: `data/kw-evaluation/${path.basename(backupPath)}`, receiptPath: `data/kw-evaluation/${path.basename(receiptPath)}`, quarantinePath: `data/kw-evaluation/${path.basename(quarantinePath)}`, localSchemaMutationAuthorized: true, remoteMigrationAuthorized: false, providerOperationsAuthorized: 0, runtimeQualificationAuthorized: false, runtimeContactAuthorized: false, runtimeOutreachAuthorized: false, runtimeSendAuthorized: false, deploymentAuthorized: false, costAuthorizedUsd: 0, rollbackPolicy: "QUARANTINE_AND_OWNER_APPROVED_RESTORE", approvedBy: "RILEY", reviewedAt, expiresAt, rationale: "Bounded local preflight fixture only.", confirmation: "APPROVE_M2_LOCAL_0069_SETUP",
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
  for (const file of [envelopePath, databasePath, backupPath, receiptPath, quarantinePath, sidecarPath, backupFixtureEnvelopePath, backupFixtureDatabasePath, backupFixturePath, backupFixtureReceiptPath, backupFixtureQuarantinePath, backupFixtureSidecarPath, backupFixtureShmPath, rollbackEnvelopePath, rollbackReceiptPath]) {
    try {
      const opened = await lstat(file, { bigint: true });
      const owned = createdIdentities.get(file);
      if (!owned || (!opened.isFile() && !opened.isSymbolicLink()) || opened.dev !== owned.dev || opened.ino !== owned.ino) continue;
      await unlink(file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  createdIdentities.clear();
}

async function prepareBackupFixture() {
  try {
    await mkdir(root, { recursive: true });
    await writeFile(backupFixtureDatabasePath, Buffer.alloc(0), { flag: "wx" });
    await rememberCreated(backupFixtureDatabasePath);
    const database = new Database(backupFixtureDatabasePath, { fileMustExist: true });
    try {
      applyCanonicalPrivateKwMigrations(database);
      database.exec(`CREATE TABLE "BackupProbe" (id INTEGER PRIMARY KEY, amount REAL, note TEXT, payload BLOB, optional TEXT);
        INSERT INTO "BackupProbe" VALUES (9007199254740993, 1.25, 'preserve every table', X'00FF10', NULL);
        INSERT INTO "BackupProbe" VALUES (2, -0.75, 'second row', X'', 'present');`);
      const lineageTable = database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'RevenuePrivateKwM2HtmlAssessmentLineage'").get() as { count: number };
      assert.equal(lineageTable.count, 0, "backup fixture must use the pre-0069 schema");
    } finally { database.close(); }
    await writeFile(backupFixtureEnvelopePath, JSON.stringify(envelope({
      databasePath: `data/kw-evaluation/${path.basename(backupFixtureDatabasePath)}`,
      backupPath: `data/kw-evaluation/${path.basename(backupFixturePath)}`,
      receiptPath: `data/kw-evaluation/${path.basename(backupFixtureReceiptPath)}`,
      quarantinePath: `data/kw-evaluation/${path.basename(backupFixtureQuarantinePath)}`,
    })), { flag: "wx" });
    await rememberCreated(backupFixtureEnvelopePath);
  } catch (error) {
    await cleanupFixture();
    throw error;
  }
}

async function prepareRollbackRelease(session: Awaited<ReturnType<typeof preflightPrivateKwM2Setup>>, receipt: Awaited<ReturnType<typeof applyPrivateKwM2Setup>>["receipt"]) {
  const core = {
    envelopeVersion: "kw-m2-local-rollback-v1", status: "APPROVED",
    setupReleaseEnvelopeId: session.envelope.envelopeId, setupReleaseEnvelopeDigest: session.envelope.envelopeDigest,
    databasePath: session.envelope.databasePath, backupPath: session.envelope.backupPath,
    quarantinePath: session.envelope.quarantinePath, rollbackReceiptPath,
    suspectFileIdentity: receipt.fileIdentity, backupFileIdentity: receipt.backupRestore.backupFileIdentity,
    logicalSnapshotDigest: receipt.backupRestore.logicalSnapshotDigest,
    approvedBy: "RILEY", reviewedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
    rationale: "Synthetic rollback acceptance fixture only.", confirmation: "RESTORE_M2_LOCAL_DATABASE_FROM_BACKUP",
  };
  const envelopeDigest = privateKwM2SetupDigest(core);
  await writeFile(rollbackEnvelopePath, JSON.stringify({ ...core, envelopeId: `kw-m2-local-rollback:${envelopeDigest}`, envelopeDigest }), { flag: "wx" });
  await rememberCreated(rollbackEnvelopePath);
  return core;
}

describe("private KW M2 setup preflight", () => {
  it("requires separate rollback approval, quarantines the migrated file, restores and replays", async () => {
    await prepareBackupFixture();
    try {
      const session = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
      try {
        const setup = await applyPrivateKwM2Setup(session);
        await rememberCreated(backupFixturePath); await rememberCreated(backupFixtureReceiptPath);
        await assert.rejects(rollbackPrivateKwM2Setup(session, rollbackEnvelopePath), /ENOENT/);
        const core = await prepareRollbackRelease(session, setup.receipt);
        const result = await rollbackPrivateKwM2Setup(session, rollbackEnvelopePath);
        await rememberCreated(backupFixtureDatabasePath); await rememberCreated(backupFixtureQuarantinePath); await rememberCreated(rollbackReceiptPath);
        assert.equal(result.status, "RESTORED");
        assert.equal(readSetupFile(backupFixtureQuarantinePath).identity.sha256, setup.receipt.fileIdentity.sha256);
        assert.equal(inspectSetupSnapshot(backupFixtureDatabasePath).contentDigest, core.logicalSnapshotDigest);
        const restored = await readFile(backupFixtureDatabasePath);
        assert.equal((await rollbackPrivateKwM2Setup(session, rollbackEnvelopePath)).status, "REPLAYED");
        assert.deepEqual(await readFile(backupFixtureDatabasePath), restored);
        await unlink(rollbackReceiptPath);
        assert.equal((await rollbackPrivateKwM2Setup(session, rollbackEnvelopePath)).status, "RECOVERED");
        await rememberCreated(rollbackReceiptPath);
        assert.deepEqual(await readFile(backupFixtureDatabasePath), restored);
        await assert.rejects(verifyPrivateKwM2Setup(session), /identity or contents changed/);
      } finally { await session.releaseLock(); }
    } finally { await cleanupFixture(); }
  });

  for (const failurePoint of ["quarantine", "restore", "receipt"] as const) {
    it(`resumes an approved rollback interrupted at ${failurePoint} publication`, async () => {
      await prepareBackupFixture();
      const retained = new Map<string, { dev: bigint; ino: bigint; files: Map<string, { dev: bigint; ino: bigint }> }>();
      let injected: ReturnType<typeof mock.method<typeof fs, "linkSync">> | undefined;
      let stopObservingBackup = () => {};
      const rememberTemp = (sourcePath: string) => {
        const directory = path.dirname(sourcePath);
        if (path.dirname(directory) !== root || !path.basename(directory).startsWith(".m2-setup-")) return;
        const dirStats = fs.lstatSync(directory, { bigint: true });
        const owned = retained.get(directory) ?? { dev: dirStats.dev, ino: dirStats.ino, files: new Map() };
        const fileStats = fs.lstatSync(sourcePath, { bigint: true });
        owned.files.set(sourcePath, { dev: fileStats.dev, ino: fileStats.ino }); retained.set(directory, owned);
      };
      try {
        const session = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
        let logicalDigest: string;
        try {
          const setup = await applyPrivateKwM2Setup(session);
          await rememberCreated(backupFixturePath); await rememberCreated(backupFixtureReceiptPath);
          logicalDigest = (await prepareRollbackRelease(session, setup.receipt)).logicalSnapshotDigest;
          const originalBackup = Database.prototype.backup;
          const observed = mock.method(Database.prototype, "backup", async function (this: Database.Database, destination: string) {
            const result = await originalBackup.call(this, destination);
            rememberTemp(destination);
            return result;
          });
          stopObservingBackup = () => observed.mock.restore();
          const originalLink = fs.linkSync;
          injected = mock.method(fs, "linkSync", (source, destination) => {
            const sourcePath = source.toString(), destinationPath = destination.toString();
            rememberTemp(sourcePath);
            if ((failurePoint === "restore" && destinationPath === backupFixtureDatabasePath)
              || (failurePoint === "receipt" && destinationPath === path.resolve(rollbackReceiptPath))) throw new Error("Injected rollback publication failure");
            originalLink(source, destination);
            if (failurePoint === "quarantine" && destinationPath === backupFixtureQuarantinePath) throw new Error("Injected rollback publication failure");
          });
          await assert.rejects(rollbackPrivateKwM2Setup(session, rollbackEnvelopePath), /Injected rollback publication failure/);
          await rememberCreated(backupFixtureQuarantinePath);
          await assert.rejects(readFile(rollbackReceiptPath), { code: "ENOENT" });
          if (failurePoint === "restore") await assert.rejects(readFile(backupFixtureDatabasePath), { code: "ENOENT" });
        } finally { injected?.mock.restore(); await session.releaseLock(); }
        const recovery = await preflightPrivateKwM2Rollback(backupFixtureEnvelopeRelative, rollbackEnvelopePath);
        try {
          await assert.rejects(applyPrivateKwM2Setup(recovery), /rollback-only/);
          const result = await rollbackPrivateKwM2Setup(recovery, rollbackEnvelopePath);
          await rememberCreated(backupFixtureDatabasePath); await rememberCreated(rollbackReceiptPath);
          assert.ok(result.status === "RESTORED" || result.status === "RECOVERED");
          assert.equal(inspectSetupSnapshot(backupFixtureDatabasePath).contentDigest, logicalDigest);
        } finally { await recovery.releaseLock(); }
      } finally {
        injected?.mock.restore();
        stopObservingBackup();
        for (const [directory, owned] of retained) {
          try {
            const current = await lstat(directory, { bigint: true });
            assert.ok(current.isDirectory() && !current.isSymbolicLink());
            assert.equal(current.dev, owned.dev); assert.equal(current.ino, owned.ino);
            for (const [file, identity] of owned.files) {
              try {
                const stat = await lstat(file, { bigint: true });
                assert.equal(stat.dev, identity.dev); assert.equal(stat.ino, identity.ino);
                await unlink(file);
              } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
            }
            await rmdir(directory);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
        await cleanupFixture();
      }
    });
  }

  it("applies 0069 transactionally, publishes the verified receipt last, and replays without writes", async () => {
    await prepareBackupFixture();
    try {
      const firstRun = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/private-kw-m2-setup.ts", backupFixtureEnvelopeRelative, "--apply"], { encoding: "utf8" }));
      await rememberCreated(backupFixturePath);
      await rememberCreated(backupFixtureReceiptPath);
      const session = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
      try {
        const result = firstRun;
        assert.equal(result.status, "APPLIED");
        assert.equal(result.receipt.receiptVersion, "kw-m2-database-receipt-v3");
        assert.ok(Date.parse(result.receipt.completedAt) >= Date.parse(session.envelope.reviewedAt));
        assert.ok(Date.parse(result.receipt.completedAt) <= Date.parse(session.envelope.expiresAt));
        assert.equal(result.receipt.migrationRange, "0054-0069");
        assert.equal(result.receipt.authority.runtimeSendAuthorized, false);
        const after = await readFile(backupFixtureDatabasePath);
        const receiptBytes = await readFile(backupFixtureReceiptPath);
        assert.deepEqual(await verifyPrivateKwM2Setup(session), result.receipt);
        assert.equal((await applyPrivateKwM2Setup(session)).status, "REPLAYED");
        assert.deepEqual(await readFile(backupFixtureDatabasePath), after);
        assert.deepEqual(await readFile(backupFixtureReceiptPath), receiptBytes);
        const missingTimestamp = JSON.parse(receiptBytes.toString("utf8")) as Record<string, unknown>;
        delete missingTimestamp.completedAt;
        await unlink(backupFixtureReceiptPath);
        await writeFile(backupFixtureReceiptPath, JSON.stringify(missingTimestamp), { flag: "wx" });
        await assert.rejects(verifyPrivateKwM2Setup(session), /Invalid|receipt|completed/i);
        await unlink(backupFixtureReceiptPath);
        const forged = JSON.parse(receiptBytes.toString("utf8")) as Record<string, unknown>;
        forged.completedAt = "2020-01-01T00:00:00.000Z";
        delete forged.receiptId;
        delete forged.receiptDigest;
        const forgedDigest = privateKwM2SetupDigest(forged);
        await writeFile(backupFixtureReceiptPath, JSON.stringify({ ...forged, receiptId: `kw-m2-database:${forgedDigest}`, receiptDigest: forgedDigest }), { flag: "wx" });
        await assert.rejects(verifyPrivateKwM2Setup(session), /outside the approved release window/);
        await unlink(backupFixtureReceiptPath);
        await writeFile(backupFixtureReceiptPath, receiptBytes, { flag: "wx" });
        await rememberCreated(backupFixtureReceiptPath);
        const database = new Database(backupFixtureDatabasePath, { readonly: true });
        try {
          assert.equal((database.prepare('SELECT count(*) AS count FROM "BackupProbe"').get() as { count: number }).count, 2);
          assert.equal((database.prepare('SELECT count(*) AS count FROM "RevenuePrivateKwM2HtmlAssessmentLineage"').get() as { count: number }).count, 0);
        } finally { database.close(); }
        await unlink(backupFixtureReceiptPath);
        await assert.rejects(applyPrivateKwM2Setup(session), /schema differs/);
        assert.deepEqual(await readFile(backupFixtureDatabasePath), after);
        await assert.rejects(readFile(backupFixtureReceiptPath), { code: "ENOENT" });
        await writeFile(backupFixtureReceiptPath, receiptBytes, { flag: "wx" }); await rememberCreated(backupFixtureReceiptPath);
        const edited = new Database(backupFixtureDatabasePath);
        try { edited.prepare('UPDATE "BackupProbe" SET note = ? WHERE id = 2').run("post-setup drift"); } finally { edited.close(); }
        await assert.rejects(verifyPrivateKwM2Setup(session), /identity or contents changed/);
      } finally { await session.releaseLock(); }
    } finally { await cleanupFixture(); }
  });

  it("rolls back an injected migration failure without issuing a receipt or losing source rows", async () => {
    await prepareBackupFixture();
    const originalExec = Database.prototype.exec;
    const injected = mock.method(Database.prototype, "exec", function (this: Database.Database, sql: string) {
      if (this.name === backupFixtureDatabasePath && sql.includes('ALTER TABLE "RevenueWebsiteSnapshot"')) {
        originalExec.call(this, sql.slice(0, sql.indexOf(";") + 1));
        throw new Error("Injected failure after first schema mutation");
      }
      return originalExec.call(this, sql);
    });
    try {
      const before = await readFile(backupFixtureDatabasePath);
      const session = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
      try {
        await assert.rejects(applyPrivateKwM2Setup(session), /Injected failure/);
        await rememberCreated(backupFixturePath);
        assert.deepEqual(await readFile(backupFixtureDatabasePath), before);
        assert.equal(inspectSetupSnapshot(backupFixtureDatabasePath).rowCounts.BackupProbe, 2);
        await assert.rejects(readFile(backupFixtureReceiptPath), { code: "ENOENT" });
        await assert.rejects(applyPrivateKwM2Setup(session), /fresh preflight/);
      } finally { await session.releaseLock(); }
    } finally { injected.mock.restore(); await cleanupFixture(); }
  });

  it("rejects a conflicting receipt before modifying the source or publishing a backup", async () => {
    await prepareBackupFixture();
    try {
      await writeFile(backupFixtureReceiptPath, "conflicting receipt", { flag: "wx" }); await rememberCreated(backupFixtureReceiptPath);
      const before = await readFile(backupFixtureDatabasePath);
      const session = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
      try { await assert.rejects(applyPrivateKwM2Setup(session), /JSON|Unexpected token/); }
      finally { await session.releaseLock(); }
      assert.deepEqual(await readFile(backupFixtureDatabasePath), before);
      await assert.rejects(readFile(backupFixturePath), { code: "ENOENT" });
    } finally { await cleanupFixture(); }
  });

  it("preserves a post-commit failure for separately approved recovery and issues no setup receipt", async () => {
    await prepareBackupFixture();
    const originalBackup = Database.prototype.backup;
    let calls = 0;
    let retainedDirectory: { path: string; dev: bigint; ino: bigint } | undefined;
    const injected = mock.method(Database.prototype, "backup", async function (this: Database.Database, destination: string) {
      if (++calls === 3) {
        const directory = path.dirname(destination);
        assert.equal(path.dirname(directory), root);
        const stat = await lstat(directory, { bigint: true });
        retainedDirectory = { path: directory, dev: stat.dev, ino: stat.ino };
        throw new Error("Injected post-commit restore-drill failure");
      }
      return originalBackup.call(this, destination);
    });
    try {
      const session = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
      try {
        await assert.rejects(applyPrivateKwM2Setup(session), /Injected post-commit/);
        await rememberCreated(backupFixturePath);
        assert.equal(inspectSetupSnapshot(backupFixtureDatabasePath, "POST_0069").rowCounts.BackupProbe, 2);
        assert.equal(inspectSetupSnapshot(backupFixturePath).rowCounts.BackupProbe, 2);
        await assert.rejects(readFile(backupFixtureReceiptPath), { code: "ENOENT" });
        await assert.rejects(applyPrivateKwM2Setup(session), /fresh preflight/);
      } finally { await session.releaseLock(); }
    } finally {
      injected.mock.restore();
      if (retainedDirectory) {
        const stat = await lstat(retainedDirectory.path, { bigint: true });
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
        assert.equal(stat.dev, retainedDirectory.dev); assert.equal(stat.ino, retainedDirectory.ino);
        await rmdir(retainedDirectory.path);
      }
      await cleanupFixture();
    }
  });

  it("loads the envelope, acquires/releases the lock, and performs no database write", async () => {
    await prepare();
    try {
      const before = await readFile(databasePath);
      const result = await preflightPrivateKwM2Setup(envelopePath, new Date());
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

  it("backs up and restore-drills a canonical database under the held preflight lock", async () => {
    await prepareBackupFixture();
    try {
      const tempDirectoriesBefore = (await readdir(root)).filter((entry) => entry.startsWith(".m2-setup-")).sort();
      const before = await readFile(backupFixtureDatabasePath);
      const session = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
      try {
        const running = backupPrivateKwM2Database(session);
        await assert.rejects(session.releaseLock(), /still running/);
        await assert.rejects(backupPrivateKwM2Database(session), /already running/);
        const first = await running;
        await rememberCreated(backupFixturePath);
        assert.equal(first.published, true);
        assert.equal(first.source.schemaDigest, first.backup.schemaDigest);
        assert.equal(first.source.contentDigest, first.backup.contentDigest);
        assert.equal(first.backup.contentDigest, first.restoreDrill.contentDigest);
        assert.equal(first.source.fileIdentity.sha256, sha(before));
        assert.equal(first.backup.fileIdentity.sha256, sha(await readFile(backupFixturePath)));
        // SQLite's backup changes this fixture's schema cookie while preserving its logical data.
        assert.notEqual(first.source.fileIdentity.sha256, first.backup.fileIdentity.sha256);
        assert.equal(first.source.rowCounts.BackupProbe, 2);
        assert.equal(first.restoreDrill.rowCounts.BackupProbe, 2);
        assert.deepEqual(await readFile(backupFixtureDatabasePath), before);
        await assert.rejects(readFile(backupFixtureReceiptPath), { code: "ENOENT" });
        const second = await backupPrivateKwM2Database(session);
        assert.equal(second.published, false);
        assert.equal(second.backup.contentDigest, first.backup.contentDigest);
        assert.deepEqual((await readdir(root)).filter((entry) => entry.startsWith(".m2-setup-")).sort(), tempDirectoriesBefore);
        const backupReader = new Database(backupFixturePath, { readonly: true, fileMustExist: true });
        try {
          const payload = backupReader.prepare('SELECT * FROM "BackupProbe" WHERE id = ?').safeIntegers(true).get(BigInt("9007199254740993")) as { id: bigint; amount: number; note: string; payload: Buffer; optional: null };
          assert.equal(payload.id, BigInt("9007199254740993"));
          assert.equal(payload.amount, 1.25);
          assert.deepEqual(payload.payload, Buffer.from([0, 255, 16]));
          assert.equal(payload.optional, null);
        } finally { backupReader.close(); }
      } finally { await session.releaseLock(); }
    } finally { await cleanupFixture(); }
  });

  it("rejects forged or released backup sessions and WAL sidecars", async () => {
    await prepareBackupFixture();
    try {
      const session = await preflightPrivateKwM2Setup(`data/kw-evaluation/${path.basename(backupFixtureEnvelopePath)}`);
      const forged = { ...session };
      await assert.rejects(backupPrivateKwM2Database(forged), /canonical preflight capability|live/);
      await session.releaseLock();
      await assert.rejects(backupPrivateKwM2Database(session), /canonical preflight capability|live/);
      const sidecarSession = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
      try {
        await writeFile(backupFixtureSidecarPath, "wal", { flag: "wx" }); await rememberCreated(backupFixtureSidecarPath);
        await assert.rejects(backupPrivateKwM2Database(sidecarSession), /sidecars/);
        await unlink(backupFixtureSidecarPath); createdIdentities.delete(backupFixtureSidecarPath);
        await writeFile(backupFixtureShmPath, "shm", { flag: "wx" }); await rememberCreated(backupFixtureShmPath);
        await assert.rejects(backupPrivateKwM2Database(sidecarSession), /sidecars/);
      } finally { await sidecarSession.releaseLock(); }
    } finally { await cleanupFixture(); }
  });

  it("rejects a conflicting existing backup without changing it", async () => {
    await prepareBackupFixture();
    try {
      const conflicting = Buffer.from("pre-existing conflicting backup", "utf8");
      await writeFile(backupFixturePath, conflicting, { flag: "wx" }); await rememberCreated(backupFixturePath);
      const session = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
      try { await assert.rejects(backupPrivateKwM2Database(session), /backup|integrity|schema/i); } finally { await session.releaseLock(); }
      assert.deepEqual(await readFile(backupFixturePath), conflicting);
    } finally { await cleanupFixture(); }
  });

  it("rechecks approval and source bytes after preflight before creating backup output", async () => {
    await prepareBackupFixture();
    try {
      const session = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
      const originalApproval = await readFile(backupFixtureEnvelopePath);
      try {
        const edited = JSON.parse(originalApproval.toString("utf8"));
        edited.status = "PENDING";
        await writeFile(backupFixtureEnvelopePath, JSON.stringify(edited));
        await assert.rejects(backupPrivateKwM2Database(session), /APPROVED|Invalid|identity/);
        await assert.rejects(readFile(backupFixturePath), { code: "ENOENT" });
        await writeFile(backupFixtureEnvelopePath, originalApproval);
        const db = new Database(backupFixtureDatabasePath, { fileMustExist: true });
        try { db.prepare('UPDATE "BackupProbe" SET note = ? WHERE id = 2').run("changed after approval"); } finally { db.close(); }
        await assert.rejects(backupPrivateKwM2Database(session), /identity or contents changed/);
        await assert.rejects(readFile(backupFixturePath), { code: "ENOENT" });
      } finally { await session.releaseLock(); }
    } finally { await cleanupFixture(); }
  });

  for (const failure of ["unexpected residue", "incomplete backup"] as const) {
  it(`preserves ${failure} and requires a fresh session`, async () => {
    await prepareBackupFixture();
    const temporary = new Map<string, { dev: bigint; ino: bigint; files: Map<string, { dev: bigint; ino: bigint }> }>();
    const originalBackup = Database.prototype.backup;
    let calls = 0;
    const observed = mock.method(Database.prototype, "backup", async function (this: Database.Database, destination: string) {
      const directory = path.dirname(destination);
      assert.equal(path.dirname(directory), root);
      const directoryStats = await lstat(directory, { bigint: true });
      const owned = { dev: directoryStats.dev, ino: directoryStats.ino, files: new Map<string, { dev: bigint; ino: bigint }>() };
      temporary.set(directory, owned);
      await assert.rejects(lstat(destination), { code: "ENOENT" });
      const result = failure === "incomplete backup"
        ? await writeFile(destination, "incomplete SQLite backup", { flag: "wx" })
        : await originalBackup.call(this, destination);
      const fileStats = await lstat(destination, { bigint: true });
      owned.files.set(destination, { dev: fileStats.dev, ino: fileStats.ino });
      if (failure === "incomplete backup") throw new Error("Injected incomplete backup failure");
      if (++calls === 2) {
        const unexpected = path.join(directory, "unexpected-owned-test.txt");
        await writeFile(unexpected, "retain this failure witness", { flag: "wx" });
        const extraStats = await lstat(unexpected, { bigint: true });
        owned.files.set(unexpected, { dev: extraStats.dev, ino: extraStats.ino });
      }
      return result;
    });
    try {
      const session = await preflightPrivateKwM2Setup(backupFixtureEnvelopeRelative);
      try {
        await assert.rejects(backupPrivateKwM2Database(session), /unexpected files|Injected incomplete backup failure/);
        if (failure === "unexpected residue") {
          await rememberCreated(backupFixturePath);
          const residue = [...temporary.keys()][1];
          assert.ok((await readdir(residue)).includes("unexpected-owned-test.txt"));
        } else {
          await assert.rejects(readFile(backupFixturePath), { code: "ENOENT" });
          const partial = [...temporary.values()][0].files.keys().next().value;
          assert.equal((await readFile(partial!)).toString(), "incomplete SQLite backup");
        }
        await assert.rejects(backupPrivateKwM2Database(session), /fresh preflight|cleanup failure/);
      } finally { await session.releaseLock(); }
    } finally {
      observed.mock.restore();
      // Test owns these exact paths from the observed API calls; never recursive cleanup.
      for (const [directory, owned] of temporary) {
        try {
          const currentDir = await lstat(directory, { bigint: true });
          assert.ok(currentDir.isDirectory() && !currentDir.isSymbolicLink());
          assert.equal(currentDir.dev, owned.dev); assert.equal(currentDir.ino, owned.ino);
          for (const [file, identity] of owned.files) {
            const current = await lstat(file, { bigint: true });
            assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
            await unlink(file);
          }
          await rmdir(directory);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      await cleanupFixture();
    }
  });
  }
});
