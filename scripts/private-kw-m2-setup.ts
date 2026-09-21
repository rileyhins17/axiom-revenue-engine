import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPrivateKwM2SetupReleaseEnvelope, type PrivateKwM2SetupReleaseEnvelope } from "../src/lib/revenue-engine/private-kw-m2-setup-release.js";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const DATA_ROOT = path.join(REPOSITORY_ROOT, "data", "kw-evaluation");
const LOCK_PATH = path.join(DATA_ROOT, ".m2-0069-setup.lock");
export const PRIVATE_KW_M2_SETUP_LOCK_PATH = LOCK_PATH;

async function assertCanonicalDirectory(directory: string) {
  const stats = await lstat(directory, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("M2 setup paths require a canonical non-reparse directory.");
}

type FileIdentity = { dev: bigint; ino: bigint };

async function assertRegularTarget(file: string, required: boolean): Promise<FileIdentity | null> {
  try {
    const stats = await lstat(file, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile() || await realpath(file) !== file) throw new Error("M2 setup targets must remain regular canonical files.");
    return { dev: stats.dev, ino: stats.ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !required) return null;
    throw error;
  }
}

function assertDistinctFileIdentities(stats: Array<FileIdentity | null>) {
  const existing = stats.filter((value): value is FileIdentity => value !== null);
  for (let index = 0; index < existing.length; index += 1) {
    for (let other = index + 1; other < existing.length; other += 1) {
      if (existing[index].dev === existing[other].dev && existing[index].ino === existing[other].ino) {
        throw new Error("M2 setup targets cannot share file identity.");
      }
    }
  }
}

async function acquireSetupLock() {
  await mkdir(DATA_ROOT, { recursive: true });
  await assertCanonicalDirectory(DATA_ROOT);
  let handle;
  let created = false;
  let createdIdentity: FileIdentity | null = null;
  let failure: unknown;
  try {
    handle = await open(LOCK_PATH, "wx");
    created = true;
    const stats = await handle.stat({ bigint: true });
    createdIdentity = { dev: stats.dev, ino: stats.ino };
    await handle.writeFile(`${process.pid}\n`, "utf8");
  } catch (error) {
    failure = error;
  } finally {
    await handle?.close();
  }
  if (failure) {
    if (created && createdIdentity) {
      try {
        const current = await lstat(LOCK_PATH, { bigint: true });
        if (!current.isSymbolicLink() && current.dev === createdIdentity.dev && current.ino === createdIdentity.ino) await unlink(LOCK_PATH);
      } catch { /* preserve the original failure */ }
    }
    if ((failure as NodeJS.ErrnoException).code === "EEXIST") throw new Error("M2 local setup is already locked by another process.");
    throw failure;
  }
  const identity = await lstat(LOCK_PATH, { bigint: true });
  return async () => {
    const current = await lstat(LOCK_PATH, { bigint: true });
    if (current.dev !== identity.dev || current.ino !== identity.ino || current.isSymbolicLink()) throw new Error("M2 setup lock identity changed before release.");
    await unlink(LOCK_PATH);
  };
}

export type PrivateKwM2SetupPreflight = {
  envelope: PrivateKwM2SetupReleaseEnvelope;
  databasePath: string;
  backupPath: string;
  receiptPath: string;
  quarantinePath: string;
  releaseLock: () => Promise<void>;
};

export async function preflightPrivateKwM2Setup(envelopePath: string, now = new Date()): Promise<PrivateKwM2SetupPreflight> {
  const envelope = await loadPrivateKwM2SetupReleaseEnvelope(envelopePath, { now });
  const paths = [envelope.databasePath, envelope.backupPath, envelope.receiptPath, envelope.quarantinePath].map((value) => path.resolve(REPOSITORY_ROOT, value));
  if (new Set(paths).size !== paths.length) throw new Error("M2 setup database, backup, receipt, and quarantine paths must be distinct.");
  await assertCanonicalDirectory(DATA_ROOT);
  const initialStats = await Promise.all([
    assertRegularTarget(paths[0], true),
    assertRegularTarget(paths[1], false),
    assertRegularTarget(paths[2], false),
    assertRegularTarget(paths[3], false),
  ]);
  assertDistinctFileIdentities(initialStats);
  const releaseLock = await acquireSetupLock();
  try {
    const lockedStats = await Promise.all([
      assertRegularTarget(paths[0], true),
      assertRegularTarget(paths[1], false),
      assertRegularTarget(paths[2], false),
      assertRegularTarget(paths[3], false),
    ]);
    assertDistinctFileIdentities(lockedStats);
    for (const sidecar of [`${paths[0]}-wal`, `${paths[0]}-shm`]) {
      try {
        await lstat(sidecar);
        throw new Error("M2 setup database sidecars must be absent.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  } catch (error) {
    try { await releaseLock(); } catch { /* preserve the validation failure */ }
    throw error;
  }
  return { envelope, databasePath: paths[0], backupPath: paths[1], receiptPath: paths[2], quarantinePath: paths[3], releaseLock };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const envelopePath = process.argv[2];
  if (!envelopePath) throw new Error("Usage: tsx scripts/private-kw-m2-setup.ts <recorded-envelope-path>");
  preflightPrivateKwM2Setup(envelopePath).then(async (result) => {
    await result.releaseLock();
    process.stdout.write(JSON.stringify({ status: "PREFLIGHT_OK", databasePath: result.databasePath }));
  }).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
