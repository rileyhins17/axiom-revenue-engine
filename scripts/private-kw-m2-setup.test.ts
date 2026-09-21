import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { describe, it, mock } from "node:test";
import path from "node:path";
import Database from "better-sqlite3";

import { PRIVATE_KW_M2_MIGRATION_FILES } from "./private-kw-m2-database";
import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import { privateKwM2SetupReleaseEnvelopeDigest } from "../src/lib/revenue-engine/private-kw-m2-setup-release";
import { backupPrivateKwM2Database, PRIVATE_KW_M2_SETUP_LOCK_PATH, preflightPrivateKwM2Setup } from "./private-kw-m2-setup";

const root = path.resolve("data/kw-evaluation");
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
  for (const file of [envelopePath, databasePath, backupPath, receiptPath, quarantinePath, sidecarPath, backupFixtureEnvelopePath, backupFixtureDatabasePath, backupFixturePath, backupFixtureReceiptPath, backupFixtureQuarantinePath, backupFixtureSidecarPath, backupFixtureShmPath]) {
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

describe("private KW M2 setup preflight", () => {
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
