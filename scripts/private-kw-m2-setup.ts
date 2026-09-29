import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import {
  loadPrivateKwM2SetupReleaseEnvelope, loadPrivateKwM2RollbackReleaseEnvelope, PrivateKwM2DatabaseSetupReceiptAnySchema,
  PrivateKwM2TimedDatabaseSetupReceiptSchema,
  privateKwM2SetupDigest, readPrivateKwM2SetupJson,
  type PrivateKwM2SetupReleaseEnvelope, type PrivateKwM2DatabaseSetupReceiptAny,
} from "../src/lib/revenue-engine/private-kw-m2-setup-release";
import {
  assertSetupAbsent, assertSetupDirectory, assertSetupFileUnchanged, assertSetupSidecarsAbsent,
  assertSetupTemp, createSetupTemp, inspectSetupSnapshot, inspectSetupSqlite, readSetupFile,
  removeSetupTemp, sameSetupInode, type SetupFileIdentity, type SetupSnapshot, type SetupTemp,
} from "./private-kw-m2-snapshot";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const DATA_ROOT = path.join(REPOSITORY_ROOT, "data", "kw-evaluation");
export const PRIVATE_KW_M2_SETUP_LOCK_PATH = path.join(DATA_ROOT, ".m2-0069-setup.lock");

export type PrivateKwM2SetupPreflight = Readonly<{
  envelope: PrivateKwM2SetupReleaseEnvelope;
  databasePath: string; backupPath: string; receiptPath: string; quarantinePath: string;
  releaseLock: () => Promise<void>;
}>;
type Session = {
  envelopePath: string;
  fd: number;
  lockIdentity: SetupFileIdentity;
  directories: { path: string; stats: BigIntStats }[];
  sourceIdentity: SetupFileIdentity;
  released: boolean;
  busy: boolean;
  poisoned: boolean;
  rollbackEnvelopeDigest?: string;
};
// An approved JSON object or copied preflight object is not a live filesystem capability.
const sessions = new WeakMap<PrivateKwM2SetupPreflight, Session>();

function targetStats(file: string, required: boolean) {
  try {
    const stats = lstatSync(file, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || realpathSync(file) !== file) {
      throw new Error("M2 setup targets must remain regular canonical files.");
    }
    return stats;
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function validateTargets(paths: string[], requiredSource = true, allowedAlias?: readonly [string, string]) {
  if (new Set(paths.map((file) => process.platform === "win32" ? file.toLowerCase() : file)).size !== paths.length) {
    throw new Error("M2 setup target paths must be distinct.");
  }
  const identities = paths.map((file, index) => targetStats(file, index === 0 && requiredSource));
  for (let index = 0; index < identities.length; index++) {
    for (let other = index + 1; other < identities.length; other++) {
      const left = identities[index];
      const right = identities[other];
      if (left && right && sameSetupInode(left, right)) {
        if (allowedAlias?.includes(paths[index]) && allowedAlias.includes(paths[other])) continue;
        throw new Error("M2 setup targets cannot share file identity.");
      }
    }
  }
  return identities;
}

function liveSession(preflight: PrivateKwM2SetupPreflight) {
  const state = sessions.get(preflight);
  if (!state || state.released) throw new Error("M2 backup requires a live canonical preflight capability.");
  if (state.poisoned) throw new Error("M2 setup requires a fresh preflight after incomplete output or cleanup failure.");
  for (const directory of state.directories) assertSetupDirectory(directory.path, directory.stats);
  const held = fstatSync(state.fd, { bigint: true });
  const current = assertSetupFileUnchanged(PRIVATE_KW_M2_SETUP_LOCK_PATH, state.lockIdentity);
  if (!sameSetupInode(held, current.stats)) throw new Error("M2 setup lock identity changed.");
  if (Date.parse(preflight.envelope.expiresAt) <= Date.now()) throw new Error("The M2 setup release envelope has expired.");
  return state;
}

async function reloadSessionApproval(preflight: PrivateKwM2SetupPreflight) {
  const state = liveSession(preflight);
  const current = await loadPrivateKwM2SetupReleaseEnvelope(state.envelopePath, {});
  if (current.envelopeDigest !== preflight.envelope.envelopeDigest) throw new Error("M2 setup release changed after preflight.");
  liveSession(preflight);
}

export async function preflightPrivateKwM2Setup(envelopePath: string, now = new Date()): Promise<PrivateKwM2SetupPreflight> {
  return preflightSetup(envelopePath, now);
}

export async function preflightPrivateKwM2Rollback(envelopePath: string, rollbackEnvelopePath: string): Promise<PrivateKwM2SetupPreflight> {
  return preflightSetup(envelopePath, new Date(), rollbackEnvelopePath);
}

async function preflightSetup(envelopePath: string, now: Date, rollbackEnvelopePath?: string): Promise<PrivateKwM2SetupPreflight> {
  const envelope = await loadPrivateKwM2SetupReleaseEnvelope(envelopePath, { now });
  const rollback = rollbackEnvelopePath ? await loadPrivateKwM2RollbackReleaseEnvelope(rollbackEnvelopePath, envelope) : undefined;
  const paths = [envelope.databasePath, envelope.backupPath, envelope.receiptPath, envelope.quarantinePath]
    .map((value) => path.resolve(REPOSITORY_ROOT, value));
  if (paths.includes(path.resolve(REPOSITORY_ROOT, envelopePath))) throw new Error("M2 setup output cannot replace its release envelope.");
  const directories = [REPOSITORY_ROOT, path.join(REPOSITORY_ROOT, "data"), DATA_ROOT]
    .map((directory) => ({ path: directory, stats: assertSetupDirectory(directory) }));
  const allowedAlias: [string, string] | undefined = rollback ? [paths[0], paths[3]] : undefined;
  validateTargets(paths, !rollback, allowedAlias);
  const sourcePath = targetStats(paths[0], false) ? paths[0] : paths[3];
  const beforeLock = readSetupFile(sourcePath).identity;
  if (rollback) {
    assertSetupFileUnchanged(paths[1], rollback.backupFileIdentity);
    if (sourcePath === paths[3]) assertSetupFileUnchanged(sourcePath, rollback.suspectFileIdentity);
  }
  let fd: number;
  try { fd = openSync(PRIVATE_KW_M2_SETUP_LOCK_PATH, "wx", 0o600); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("M2 local setup is already locked by another process.");
    throw error;
  }
  const owned = fstatSync(fd, { bigint: true });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const current = lstatSync(PRIVATE_KW_M2_SETUP_LOCK_PATH, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || !sameSetupInode(owned, current)) {
        throw new Error("M2 setup lock identity changed before release.");
      }
      // Held handle + exact identity; cooperative local processes must never replace a live lock.
      unlinkSync(PRIVATE_KW_M2_SETUP_LOCK_PATH);
    } finally { closeSync(fd); }
  };
  try {
    writeFileSync(fd, `${process.pid}:${randomBytes(32).toString("hex")}\n`);
    const lockIdentity = readSetupFile(PRIVATE_KW_M2_SETUP_LOCK_PATH, 1024).identity;
    for (const directory of directories) assertSetupDirectory(directory.path, directory.stats);
    validateTargets(paths, !rollback, allowedAlias);
    assertSetupFileUnchanged(sourcePath, beforeLock);
    assertSetupSidecarsAbsent(sourcePath);
    const state: Session = { envelopePath, fd, lockIdentity, directories, sourceIdentity: beforeLock, released: false, busy: false, poisoned: false, rollbackEnvelopeDigest: rollback?.envelopeDigest };
    const preflight: PrivateKwM2SetupPreflight = Object.freeze({
      envelope, databasePath: paths[0], backupPath: paths[1], receiptPath: paths[2], quarantinePath: paths[3],
      releaseLock: async () => {
        if (state.busy) throw new Error("M2 setup operation is still running; retain the lock.");
        state.released = true;
        release();
      },
    });
    sessions.set(preflight, state);
    return preflight;
  } catch (error) {
    try { release(); } catch { /* leave any replacement untouched; preserve initial failure */ }
    throw error;
  }
}

export type PrivateKwM2BackupResult = Readonly<{
  source: SetupSnapshot; backup: SetupSnapshot; restoreDrill: SetupSnapshot;
  backupPath: string; published: boolean;
}>;

async function snapshotIntoTemp(preflight: PrivateKwM2SetupPreflight, file: string, expected: SetupSnapshot, temp: SetupTemp) {
  liveSession(preflight);
  assertSetupTemp(temp);
  assertSetupAbsent(temp.file);
  assertSetupSidecarsAbsent(file);
  assertSetupFileUnchanged(file, expected.fileIdentity);
  const source = new Database(file, { readonly: true, fileMustExist: true, timeout: 0 });
  try {
    source.exec("BEGIN"); // hold a read snapshot during the asynchronous SQLite backup
    const logical = inspectSetupSqlite(source, "PRE_0069");
    if (logical.contentDigest !== expected.contentDigest) throw new Error("M2 setup source contents changed before backup.");
    const completed = await source.backup(temp.file);
    if (completed.remainingPages !== 0) throw new Error("M2 setup backup did not complete.");
  } finally { source.close(); }
  liveSession(preflight);
  assertSetupTemp(temp);
  assertSetupSidecarsAbsent(file);
  assertSetupFileUnchanged(file, expected.fileIdentity);
  const output = inspectSetupSnapshot(temp.file);
  if (output.contentDigest !== expected.contentDigest || output.schemaDigest !== expected.schemaDigest) {
    throw new Error("M2 setup backup does not preserve the source logical snapshot.");
  }
  return output;
}

/** Local backup + separate restore drill only. No schema mutation, setup receipt, or CLI execution mode. */
async function withSetupOperation<T>(preflight: PrivateKwM2SetupPreflight, operation: (state: Session) => Promise<T>): Promise<T> {
  const state = liveSession(preflight);
  if (state.busy) throw new Error("M2 setup operation is already running.");
  state.busy = true;
  try { return await operation(state); } finally { state.busy = false; }
}

export async function backupPrivateKwM2Database(preflight: PrivateKwM2SetupPreflight): Promise<PrivateKwM2BackupResult> {
  return withSetupOperation(preflight, (state) => backupUnderLock(preflight, state));
}

async function backupUnderLock(preflight: PrivateKwM2SetupPreflight, state: Session): Promise<PrivateKwM2BackupResult> {
  if (state.rollbackEnvelopeDigest) throw new Error("M2 rollback-only preflight cannot authorize setup or backup.");
  let temp: SetupTemp | undefined;
  let tempProof: SetupSnapshot | undefined;
  let restore: SetupTemp | undefined;
  let restoreProof: SetupSnapshot | undefined;
  try {
    await reloadSessionApproval(preflight);
    validateTargets([preflight.databasePath, preflight.backupPath, preflight.receiptPath, preflight.quarantinePath]);
    assertSetupFileUnchanged(preflight.databasePath, state.sourceIdentity);
    const source = inspectSetupSnapshot(preflight.databasePath);
    temp = createSetupTemp(DATA_ROOT);
    tempProof = await snapshotIntoTemp(preflight, preflight.databasePath, source, temp);
    await reloadSessionApproval(preflight);
    assertSetupFileUnchanged(preflight.databasePath, source.fileIdentity);
    assertSetupTemp(temp);
    const verifiedTemp = assertSetupFileUnchanged(temp.file, tempProof.fileIdentity);
    let published = false;
    try { linkSync(temp.file, preflight.backupPath); published = true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = readSetupFile(preflight.backupPath);
      if (!existing.bytes.equals(verifiedTemp.bytes)) throw new Error("M2 setup backup destination contains conflicting bytes.");
    }
    const backup = inspectSetupSnapshot(preflight.backupPath);
    if (backup.fileIdentity.sha256 !== tempProof.fileIdentity.sha256
      || backup.contentDigest !== source.contentDigest) throw new Error("M2 setup published backup verification failed.");
    restore = createSetupTemp(DATA_ROOT);
    restoreProof = await snapshotIntoTemp(preflight, preflight.backupPath, backup, restore);
    await reloadSessionApproval(preflight);
    assertSetupFileUnchanged(preflight.databasePath, source.fileIdentity);
    assertSetupFileUnchanged(preflight.backupPath, backup.fileIdentity);
    return Object.freeze({ source, backup, restoreDrill: restoreProof, backupPath: preflight.backupPath, published });
  } finally {
    if ((temp && !tempProof) || (restore && !restoreProof)) state.poisoned = true;
    try {
      if (restore && restoreProof) removeSetupTemp(restore, restoreProof);
      if (temp && tempProof) removeSetupTemp(temp, tempProof);
      // Partial/unverified temp files are deliberately retained; never adopt/delete an unknown identity.
    } catch (error) {
      state.poisoned = true;
      throw error;
    }
  }
}

function migration0069(preflight: PrivateKwM2SetupPreflight) {
  const entry = preflight.envelope.migrationManifest.at(-1)!;
  const bytes = execFileSync("git", ["-C", REPOSITORY_ROOT, "show", `${preflight.envelope.repositoryCommit}:migrations/${entry.filename}`]);
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("M2 migration bytes differ from release.");
  return bytes.toString("utf8");
}

function expectedMigratedSnapshot(preflight: PrivateKwM2SetupPreflight, backup: SetupSnapshot) {
  const original = assertSetupFileUnchanged(preflight.backupPath, backup.fileIdentity);
  const reference = new Database(original.bytes);
  try {
    reference.pragma("foreign_keys = ON");
    reference.exec(migration0069(preflight));
    return inspectSetupSqlite(reference, "POST_0069");
  } finally { reference.close(); }
}

function sameLogicalSnapshot(actual: Pick<SetupSnapshot, "schemaDigest" | "contentDigest">, expected: Pick<SetupSnapshot, "schemaDigest" | "contentDigest">) {
  if (actual.schemaDigest !== expected.schemaDigest || actual.contentDigest !== expected.contentDigest) {
    throw new Error("M2 setup logical snapshot does not match the approved migration result.");
  }
}

async function publishSetupJson(preflight: PrivateKwM2SetupPreflight, target: string, value: unknown, beforePublish: () => void) {
  const state = liveSession(preflight);
  const temp = createSetupTemp(DATA_ROOT);
  let identity: SetupFileIdentity | undefined;
  try {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    const fd = openSync(temp.file, "wx", 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    identity = readSetupFile(temp.file).identity;
    await reloadSessionApproval(preflight);
    assertSetupTemp(temp);
    assertSetupFileUnchanged(temp.file, identity);
    beforePublish();
    try { linkSync(temp.file, target); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!readSetupFile(target).bytes.equals(bytes)) throw new Error("M2 setup receipt destination contains conflicting bytes.");
    }
    if (!readSetupFile(target).bytes.equals(bytes)) throw new Error("M2 setup receipt publication verification failed.");
  } finally {
    try {
      if (identity) removeSetupTemp(temp, { fileIdentity: identity });
      else state.poisoned = true;
    } catch (error) { state.poisoned = true; throw error; }
  }
}

async function verifySetupUnderLock(preflight: PrivateKwM2SetupPreflight) {
  await reloadSessionApproval(preflight);
  const receipt = PrivateKwM2DatabaseSetupReceiptAnySchema.parse(await readPrivateKwM2SetupJson(preflight.envelope.receiptPath));
  const envelope = preflight.envelope;
  if (receipt.receiptVersion === "kw-m2-database-receipt-v3") {
    const completedAt = Date.parse(receipt.completedAt);
    if (completedAt < Date.parse(envelope.reviewedAt) || completedAt >= Date.parse(envelope.expiresAt) || completedAt > Date.now()) {
      throw new Error("M2 setup receipt completion is outside the approved release window.");
    }
  }
  if (receipt.databasePath !== envelope.databasePath || receipt.backupRestore.backupPath !== envelope.backupPath
    || receipt.setupReleaseEnvelopeId !== envelope.envelopeId || receipt.setupReleaseEnvelopeDigest !== envelope.envelopeDigest
    || receipt.migrationsCommit !== envelope.repositoryCommit
    || privateKwM2SetupDigest(receipt.migrationManifest) !== privateKwM2SetupDigest(envelope.migrationManifest)) {
    throw new Error("M2 setup receipt is not bound to this exact release and its paths.");
  }
  assertSetupFileUnchanged(preflight.databasePath, receipt.fileIdentity);
  assertSetupFileUnchanged(preflight.backupPath, receipt.backupRestore.backupFileIdentity);
  const backup = inspectSetupSnapshot(preflight.backupPath);
  if (backup.contentDigest !== receipt.backupRestore.logicalSnapshotDigest) throw new Error("M2 setup backup logical proof changed.");
  const post = inspectSetupSnapshot(preflight.databasePath, "POST_0069");
  if (post.schemaDigest !== receipt.schemaDigest) throw new Error("M2 setup receipt schema proof changed.");
  sameLogicalSnapshot(post, expectedMigratedSnapshot(preflight, backup));
  liveSession(preflight);
  return receipt;
}

export async function verifyPrivateKwM2Setup(preflight: PrivateKwM2SetupPreflight): Promise<PrivateKwM2DatabaseSetupReceiptAny> {
  return withSetupOperation(preflight, () => verifySetupUnderLock(preflight));
}

export async function applyPrivateKwM2Setup(preflight: PrivateKwM2SetupPreflight) {
  return withSetupOperation(preflight, async (state) => {
    if (state.rollbackEnvelopeDigest) throw new Error("M2 rollback-only preflight cannot authorize setup.");
    await reloadSessionApproval(preflight);
    if (targetStats(preflight.receiptPath, false)) return { status: "REPLAYED" as const, receipt: await verifySetupUnderLock(preflight) };
    assertSetupAbsent(preflight.quarantinePath);
    const backup = await backupUnderLock(preflight, state);
    const expected = expectedMigratedSnapshot(preflight, backup.backup);
    await reloadSessionApproval(preflight);
    assertSetupFileUnchanged(preflight.databasePath, backup.source.fileIdentity);
    assertSetupAbsent(preflight.receiptPath);
    assertSetupSidecarsAbsent(preflight.databasePath);
    let attempted = false;
    let committed = false;
    try {
      const database = new Database(preflight.databasePath, { fileMustExist: true, timeout: 0 });
      try {
        database.pragma("foreign_keys = ON");
        database.pragma("synchronous = FULL");
        if (database.pragma("journal_mode", { simple: true }) !== "delete") throw new Error("M2 migration requires DELETE journal mode.");
        assertSetupFileUnchanged(preflight.databasePath, backup.source.fileIdentity);
        const sql = migration0069(preflight);
        attempted = true;
        database.transaction(() => {
          database.exec(sql);
          sameLogicalSnapshot(inspectSetupSqlite(database, "POST_0069"), expected);
        }).immediate();
        committed = true;
      } finally { database.close(); }
      const post = inspectSetupSnapshot(preflight.databasePath, "POST_0069");
      sameLogicalSnapshot(post, expected);
      if (post.fileIdentity.device !== backup.source.fileIdentity.device || post.fileIdentity.inode !== backup.source.fileIdentity.inode) {
        throw new Error("M2 setup database identity changed during migration.");
      }
      state.sourceIdentity = post.fileIdentity;
      const drillTemp = createSetupTemp(DATA_ROOT);
      let drill: SetupSnapshot | undefined;
      try { drill = await snapshotIntoTemp(preflight, preflight.backupPath, backup.backup, drillTemp); }
      finally {
        if (drill) removeSetupTemp(drillTemp, drill);
        else state.poisoned = true;
      }
      const proof = {
        backupPath: preflight.envelope.backupPath,
        backupFileIdentity: backup.backup.fileIdentity, backupSha256: backup.backup.fileIdentity.sha256,
        restoreDrillFileIdentity: drill.fileIdentity, restoreDrillSha256: drill.fileIdentity.sha256,
        restoreDrillVerified: true as const, logicalSnapshotDigest: backup.source.contentDigest,
      };
      const envelope = preflight.envelope;
      await reloadSessionApproval(preflight);
      const completedAt = new Date().toISOString();
      if (Date.parse(completedAt) < Date.parse(envelope.reviewedAt) || Date.parse(completedAt) >= Date.parse(envelope.expiresAt) || Date.parse(completedAt) > Date.now()) {
        throw new Error("M2 setup completion is outside the approved release window.");
      }
      const core = {
        receiptVersion: "kw-m2-database-receipt-v3" as const,
        completedAt,
        databasePath: envelope.databasePath, fileIdentity: post.fileIdentity,
        setupReleaseEnvelopeId: envelope.envelopeId, setupReleaseEnvelopeDigest: envelope.envelopeDigest,
        migrationRange: envelope.migrationRange, migrationManifest: envelope.migrationManifest,
        migrationsCommit: envelope.repositoryCommit, schemaDigest: post.schemaDigest,
        preMigrationFileIdentity: backup.source.fileIdentity,
        backupRestore: { ...proof, evidenceDigest: privateKwM2SetupDigest(proof) },
        authority: {
          localOnly: true, localSchemaMutationPerformed: true,
          setupReleaseEnvelopeId: envelope.envelopeId, setupReleaseEnvelopeDigest: envelope.envelopeDigest,
          remoteMigrationAuthorized: false, runtimeQualificationAuthorized: false, runtimeContactAuthorized: false,
          runtimeOutreachAuthorized: false, runtimeSendAuthorized: false, deploymentAuthorized: false,
          providerOperationsAuthorized: 0, costAuthorizedUsd: 0,
        },
      };
      const receiptDigest = privateKwM2SetupDigest(core);
      const receipt = PrivateKwM2TimedDatabaseSetupReceiptSchema.parse({ ...core, receiptId: `kw-m2-database:${receiptDigest}`, receiptDigest });
      assertSetupFileUnchanged(preflight.databasePath, post.fileIdentity);
      assertSetupFileUnchanged(preflight.backupPath, backup.backup.fileIdentity);
      await publishSetupJson(preflight, preflight.receiptPath, receipt, () => {
        assertSetupFileUnchanged(preflight.databasePath, post.fileIdentity);
        assertSetupFileUnchanged(preflight.backupPath, backup.backup.fileIdentity);
      });
      return { status: "APPLIED" as const, receipt: await verifySetupUnderLock(preflight) };
    } catch (error) {
      if (attempted) state.poisoned = true;
      if (attempted && !committed) {
        const rolledBack = inspectSetupSnapshot(preflight.databasePath);
        sameLogicalSnapshot(rolledBack, backup.source);
        if (rolledBack.fileIdentity.sha256 !== backup.source.fileIdentity.sha256
          || rolledBack.fileIdentity.device !== backup.source.fileIdentity.device
          || rolledBack.fileIdentity.inode !== backup.source.fileIdentity.inode) {
          throw new Error("M2 failed migration did not preserve the original database; retain backup for recovery.", { cause: error });
        }
      }
      throw error;
    }
  });
}

/** A second recorded owner decision authorizes restoring the exact inspected suspect file. */
export async function rollbackPrivateKwM2Setup(preflight: PrivateKwM2SetupPreflight, rollbackEnvelopePath: string) {
  return withSetupOperation(preflight, async (state) => {
    await reloadSessionApproval(preflight);
    const release = await loadPrivateKwM2RollbackReleaseEnvelope(rollbackEnvelopePath, preflight.envelope);
    if (state.rollbackEnvelopeDigest && state.rollbackEnvelopeDigest !== release.envelopeDigest) throw new Error("M2 rollback preflight binds a different approval.");
    const receiptPath = path.resolve(REPOSITORY_ROOT, release.rollbackReceiptPath);
    validateTargets([preflight.databasePath, preflight.backupPath, preflight.quarantinePath, preflight.receiptPath, receiptPath,
      path.resolve(REPOSITORY_ROOT, rollbackEnvelopePath), path.resolve(REPOSITORY_ROOT, state.envelopePath)], false,
    [preflight.databasePath, preflight.quarantinePath]);
    const backup = inspectSetupSnapshot(preflight.backupPath);
    assertSetupFileUnchanged(preflight.backupPath, release.backupFileIdentity);
    if (backup.contentDigest !== release.logicalSnapshotDigest) throw new Error("M2 rollback backup logical proof differs from approval.");
    const reloadRollbackApproval = async () => {
      const current = await loadPrivateKwM2RollbackReleaseEnvelope(rollbackEnvelopePath, preflight.envelope);
      if (current.envelopeDigest !== release.envelopeDigest) throw new Error("M2 rollback approval changed during restore.");
      await reloadSessionApproval(preflight);
    };
    const buildReceipt = () => {
      const restored = inspectSetupSnapshot(preflight.databasePath);
      sameLogicalSnapshot(restored, backup);
      const quarantine = assertSetupFileUnchanged(preflight.quarantinePath, release.suspectFileIdentity);
      assertSetupSidecarsAbsent(preflight.quarantinePath);
      assertSetupFileUnchanged(preflight.backupPath, release.backupFileIdentity);
      const core = {
        receiptVersion: "kw-m2-local-rollback-receipt-v1",
        rollbackReleaseEnvelopeId: release.envelopeId, rollbackReleaseEnvelopeDigest: release.envelopeDigest,
        setupReleaseEnvelopeId: preflight.envelope.envelopeId,
        databasePath: release.databasePath, backupPath: release.backupPath, quarantinePath: release.quarantinePath,
        fileIdentity: restored.fileIdentity, backupFileIdentity: backup.fileIdentity,
        quarantineFileIdentity: quarantine.identity, logicalSnapshotDigest: restored.contentDigest,
        localOnly: true, runtimeAuthorized: false, providerOperations: 0, costUsd: 0,
      };
      const receiptDigest = privateKwM2SetupDigest(core);
      return { ...core, receiptId: `kw-m2-local-rollback-receipt:${receiptDigest}`, receiptDigest };
    };
    if (targetStats(receiptPath, false)) {
      const expected = buildReceipt();
      const recorded = await readPrivateKwM2SetupJson(release.rollbackReceiptPath);
      if (privateKwM2SetupDigest(recorded) !== privateKwM2SetupDigest(expected)) throw new Error("M2 rollback receipt differs from current evidence.");
      return { status: "REPLAYED" as const, receipt: expected };
    }
    const publishRollbackReceipt = async () => {
      await reloadRollbackApproval();
      const receipt = buildReceipt();
      await publishSetupJson(preflight, receiptPath, receipt, () => {
        if (Date.parse(release.expiresAt) <= Date.now()) throw new Error("M2 rollback approval expired before receipt publication.");
        if (privateKwM2SetupDigest(buildReceipt()) !== privateKwM2SetupDigest(receipt)) throw new Error("M2 rollback evidence changed before publication.");
      });
      state.sourceIdentity = receipt.fileIdentity;
      return receipt;
    };
    const quarantined = targetStats(preflight.quarantinePath, false);
    const current = targetStats(preflight.databasePath, false);
    if (quarantined) {
      assertSetupFileUnchanged(preflight.quarantinePath, release.suspectFileIdentity);
      // A restored copy can resume receipt publication; the original inode resumes replacement.
      if (current && !sameSetupInode(current, quarantined)) {
        return { status: "RECOVERED" as const, receipt: await publishRollbackReceipt() };
      }
    } else if (!current) {
      throw new Error("M2 rollback requires the approved source or its verified quarantine.");
    }
    if (current) assertSetupFileUnchanged(preflight.databasePath, release.suspectFileIdentity);
    assertSetupSidecarsAbsent(preflight.databasePath);
    const temp = createSetupTemp(DATA_ROOT);
    let restored: SetupSnapshot | undefined;
    let completed = false;
    try {
      restored = await snapshotIntoTemp(preflight, preflight.backupPath, backup, temp);
      await reloadRollbackApproval();
      assertSetupTemp(temp);
      assertSetupFileUnchanged(temp.file, restored.fileIdentity);
      if (current) assertSetupFileUnchanged(preflight.databasePath, release.suspectFileIdentity);
      else assertSetupAbsent(preflight.databasePath);
      assertSetupSidecarsAbsent(preflight.databasePath);
      if (!quarantined) {
        assertSetupAbsent(preflight.quarantinePath);
        linkSync(preflight.databasePath, preflight.quarantinePath);
      }
      assertSetupFileUnchanged(preflight.quarantinePath, release.suspectFileIdentity);
      if (current) {
        assertSetupFileUnchanged(preflight.databasePath, release.suspectFileIdentity);
        unlinkSync(preflight.databasePath);
      }
      linkSync(temp.file, preflight.databasePath);
      assertSetupFileUnchanged(preflight.databasePath, restored.fileIdentity);
      const receipt = await publishRollbackReceipt();
      completed = true;
      return { status: "RESTORED" as const, receipt };
    } catch (error) {
      state.poisoned = true;
      throw error;
    } finally {
      if (completed && restored) {
        try { removeSetupTemp(temp, restored); } catch (error) { state.poisoned = true; throw error; }
      }
      // Failed replacement retains both quarantine and the validated restore candidate for recovery.
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [envelopePath, mode, rollbackPath, ...extra] = process.argv.slice(2);
  const valid = envelopePath && extra.length === 0 && (
    (mode === undefined && rollbackPath === undefined)
    || ((mode === "--apply" || mode === "--verify") && rollbackPath === undefined)
    || (mode === "--rollback" && rollbackPath));
  const run = async () => {
    if (!valid) throw new Error("Usage: kw:prepare-m2-database -- <recorded-setup-envelope> [--apply | --verify | --rollback <recorded-rollback-envelope>]");
    const session = mode === "--rollback"
      ? await preflightPrivateKwM2Rollback(envelopePath, rollbackPath!)
      : await preflightPrivateKwM2Setup(envelopePath);
    try {
      if (mode === "--apply") return await applyPrivateKwM2Setup(session);
      if (mode === "--verify") return { status: "VERIFIED", receipt: await verifyPrivateKwM2Setup(session) };
      if (mode === "--rollback") return await rollbackPrivateKwM2Setup(session, rollbackPath!);
      return { status: "PREFLIGHT_OK", databasePath: session.databasePath };
    } finally { await session.releaseLock(); }
  };
  run().then((result) => process.stdout.write(JSON.stringify(result))).catch((error: unknown) => {
    process.stderr.write(JSON.stringify({ status: "EXTERNAL_BLOCKER", error: error instanceof Error ? error.message : String(error) }) + "\n");
    process.exitCode = 1;
  });
}
