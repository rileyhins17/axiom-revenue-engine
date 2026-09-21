import { randomBytes } from "node:crypto";
import { closeSync, fstatSync, linkSync, lstatSync, openSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { loadPrivateKwM2SetupReleaseEnvelope, type PrivateKwM2SetupReleaseEnvelope } from "../src/lib/revenue-engine/private-kw-m2-setup-release";
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

function validateTargets(paths: string[]) {
  if (new Set(paths.map((file) => process.platform === "win32" ? file.toLowerCase() : file)).size !== paths.length) {
    throw new Error("M2 setup target paths must be distinct.");
  }
  const identities = paths.map((file, index) => targetStats(file, index === 0));
  for (let index = 0; index < identities.length; index++) {
    for (let other = index + 1; other < identities.length; other++) {
      const left = identities[index];
      const right = identities[other];
      if (left && right && sameSetupInode(left, right)) {
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
  const envelope = await loadPrivateKwM2SetupReleaseEnvelope(envelopePath, { now });
  const paths = [envelope.databasePath, envelope.backupPath, envelope.receiptPath, envelope.quarantinePath]
    .map((value) => path.resolve(REPOSITORY_ROOT, value));
  if (paths.includes(path.resolve(REPOSITORY_ROOT, envelopePath))) throw new Error("M2 setup output cannot replace its release envelope.");
  const directories = [REPOSITORY_ROOT, path.join(REPOSITORY_ROOT, "data"), DATA_ROOT]
    .map((directory) => ({ path: directory, stats: assertSetupDirectory(directory) }));
  validateTargets(paths);
  const beforeLock = readSetupFile(paths[0]).identity;
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
    validateTargets(paths);
    assertSetupFileUnchanged(paths[0], beforeLock);
    assertSetupSidecarsAbsent(paths[0]);
    const state: Session = { envelopePath, fd, lockIdentity, directories, sourceIdentity: beforeLock, released: false, busy: false, poisoned: false };
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
export async function backupPrivateKwM2Database(preflight: PrivateKwM2SetupPreflight): Promise<PrivateKwM2BackupResult> {
  const state = liveSession(preflight);
  if (state.busy) throw new Error("M2 setup operation is already running.");
  state.busy = true;
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
    } finally { state.busy = false; }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const envelopePath = process.argv[2];
  if (!envelopePath || process.argv.length !== 3) throw new Error("Usage: tsx scripts/private-kw-m2-setup.ts <recorded-envelope-path>");
  preflightPrivateKwM2Setup(envelopePath).then(async (result) => {
    await result.releaseLock();
    process.stdout.write(JSON.stringify({ status: "PREFLIGHT_OK", databasePath: result.databasePath }));
  }).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
