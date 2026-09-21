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

async function assertRegularTarget(file: string, required: boolean) {
  try {
    const stats = await lstat(file, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile() || await realpath(file) !== file) throw new Error("M2 setup targets must remain regular canonical files.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !required) return;
    throw error;
  }
}

async function acquireSetupLock() {
  await mkdir(DATA_ROOT, { recursive: true });
  await assertCanonicalDirectory(DATA_ROOT);
  let handle;
  try {
    handle = await open(LOCK_PATH, "wx");
    await handle.writeFile(`${process.pid}\n`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("M2 local setup is already locked by another process.");
    throw error;
  } finally {
    await handle?.close();
  }
  return async () => {
    await assertRegularTarget(LOCK_PATH, true);
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
  await Promise.all([
    assertRegularTarget(paths[0], true),
    assertRegularTarget(paths[1], false),
    assertRegularTarget(paths[2], false),
    assertRegularTarget(paths[3], false),
  ]);
  const releaseLock = await acquireSetupLock();
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
