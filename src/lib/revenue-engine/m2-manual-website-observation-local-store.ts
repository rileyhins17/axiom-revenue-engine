import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  buildM2ManualWebsiteObservation,
  M2ManualWebsiteObservationCommandSchema,
  M2ManualWebsiteObservationTargetSchema,
  M2ManualWebsiteObservationSchema,
  sealM2ManualWebsiteObservation,
  type M2ManualWebsiteObservation,
  type M2ManualWebsiteObservationTarget,
} from "./m2-manual-website-observation";

const DEFAULT_ROOT = path.join(process.cwd(), "data", "kw-evaluation", "m2-manual-observations");
const MAX_RECORD_BYTES = 8_192;

export type M2ManualWebsiteObservationStoreOptions = {
  rootDir?: string;
  clock?: () => Date;
};
export type M2ManualWebsiteObservationSave = {
  status: "SAVED" | "ALREADY_SAVED";
  observationId: string;
  observedAt: string;
};

export class M2ManualWebsiteObservationStoreError extends Error {
  constructor(readonly code: "CONFLICT" | "UNAVAILABLE", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "M2ManualWebsiteObservationStoreError";
  }
}

function fail(code: "CONFLICT" | "UNAVAILABLE", message: string, cause?: unknown): never {
  throw new M2ManualWebsiteObservationStoreError(code, message, cause === undefined ? undefined : { cause });
}

function recordPrefixFields(reviewId: string, businessIdentityDigest: string) {
  return `m2-manual-observation-${reviewId}-${businessIdentityDigest}-`;
}

function recordPrefix(target: M2ManualWebsiteObservationTarget) {
  return recordPrefixFields(target.reviewId, target.businessIdentityDigest);
}

function filenameFor(record: M2ManualWebsiteObservation) {
  return `${recordPrefixFields(record.reviewId, record.businessIdentityDigest)}${record.observationId.slice("m2-manual-observation:".length)}.json`;
}

async function ensureSafeRoot(rootDir: string) {
  try {
    await mkdir(rootDir, { recursive: true });
    const root = await lstat(rootDir);
    if (root.isSymbolicLink() || !root.isDirectory()) fail("UNAVAILABLE", "Private manual-observation storage is unsafe.");
  } catch (error) {
    if (error instanceof M2ManualWebsiteObservationStoreError) throw error;
    fail("UNAVAILABLE", "Private manual-observation storage is unavailable.", error);
  }
}

async function readRecord(rootDir: string, filename: string, target: M2ManualWebsiteObservationTarget) {
  if (!filename.startsWith(recordPrefix(target)) || !/^[A-Za-z0-9-]+-[a-f0-9]{64}\.json$/.test(filename.slice("m2-manual-observation-".length))) {
    fail("CONFLICT", "A malformed manual-observation filename exists for this business.");
  }
  const file = path.join(rootDir, filename);
  try {
    const before = await lstat(file);
    if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_RECORD_BYTES) fail("CONFLICT", "A manual-observation record is unsafe or oversized.");
    const handle = await open(file, constants.O_RDONLY);
    try {
      const opened = await handle.stat();
      const after = await lstat(file);
      if (!opened.isFile() || after.isSymbolicLink() || !after.isFile() || opened.dev !== after.dev || opened.ino !== after.ino || opened.size > MAX_RECORD_BYTES) {
        fail("CONFLICT", "A manual-observation record changed while it was being read.");
      }
      const bytes = await handle.readFile();
      if (bytes.byteLength > MAX_RECORD_BYTES) fail("CONFLICT", "A manual-observation record is oversized.");
      let parsed: unknown;
      try { parsed = JSON.parse(bytes.toString("utf8")) as unknown; }
      catch (error) { fail("CONFLICT", "A manual-observation record is incomplete or invalid.", error); }
      const result = M2ManualWebsiteObservationSchema.safeParse(parsed);
      if (!result.success || filenameFor(result.data) !== filename
        || result.data.reviewId !== target.reviewId
        || result.data.businessIdentityDigest !== target.businessIdentityDigest
        || result.data.businessName !== target.businessName) {
        fail("CONFLICT", "A manual-observation record does not match its identity-bound filename.");
      }
      const { observationId, ...recordCore } = result.data;
      if (sealM2ManualWebsiteObservation(recordCore).observationId !== observationId) {
        fail("CONFLICT", "A manual-observation record does not match its content digest.");
      }
      return result.data;
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof M2ManualWebsiteObservationStoreError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("CONFLICT", "A listed manual-observation record disappeared.", error);
    fail("UNAVAILABLE", "A manual-observation record could not be read.", error);
  }
}

async function listUnlocked(target: M2ManualWebsiteObservationTarget, rootDir: string) {
  const names = await readdir(rootDir);
  const prefix = recordPrefix(target);
  const records: M2ManualWebsiteObservation[] = [];
  for (const filename of names.filter((name) => name.startsWith(prefix) && name.endsWith(".json"))) {
    records.push(await readRecord(rootDir, filename, target));
  }
  records.sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt) || left.observationId.localeCompare(right.observationId, "en"));
  return records;
}

/** Reads immutable manual notes for one exact, current identity decision. */
export async function listM2ManualWebsiteObservations(
  targetInput: M2ManualWebsiteObservationTarget,
  options: M2ManualWebsiteObservationStoreOptions = {},
): Promise<M2ManualWebsiteObservation[]> {
  const parsedTarget = M2ManualWebsiteObservationTargetSchema.parse(targetInput);
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_ROOT);
  await ensureSafeRoot(rootDir);
  try { return await listUnlocked(parsedTarget, rootDir); }
  catch (error) {
    if (error instanceof M2ManualWebsiteObservationStoreError) throw error;
    return fail("UNAVAILABLE", "Manual website observations could not be listed.", error);
  }
}

/** Serializes one local append; exact idempotent retries reload their first receipt. */
export async function saveM2ManualWebsiteObservation(
  commandInput: unknown,
  targetInput: M2ManualWebsiteObservationTarget,
  recordedBy: "RILEY" | "AIDAN",
  options: M2ManualWebsiteObservationStoreOptions = {},
): Promise<M2ManualWebsiteObservationSave> {
  const command = M2ManualWebsiteObservationCommandSchema.parse(commandInput);
  const target = M2ManualWebsiteObservationTargetSchema.parse(targetInput);
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_ROOT);
  await ensureSafeRoot(rootDir);
  const lockPath = path.join(rootDir, `${recordPrefix(target)}lock`);
  let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
  let lockIdentity: { dev: number; ino: number } | undefined;
  try {
    lockHandle = await open(lockPath, "wx", 0o600);
    const lockStat = await lockHandle.stat();
    const pathStat = await lstat(lockPath);
    if (!lockStat.isFile() || pathStat.isSymbolicLink() || !pathStat.isFile() || lockStat.dev !== pathStat.dev || lockStat.ino !== pathStat.ino) {
      fail("CONFLICT", "The manual-observation operation lock could not be verified.");
    }
    lockIdentity = { dev: lockStat.dev, ino: lockStat.ino };
    await lockHandle.sync();

    const prior = await listUnlocked(target, rootDir);
    const sameCommandId = prior.find((record) => record.commandId === command.commandId);
    if (sameCommandId) {
      const sameCommand = sameCommandId.reviewId === command.reviewId
        && sameCommandId.observedUrl === command.observedUrl
        && sameCommandId.confidence === command.confidence
        && sameCommandId.evidenceState === command.evidenceState
        && sameCommandId.observation === (command.evidenceState === "OBSERVED" ? command.observation.trim().replace(/\s+/g, " ") : null)
        && sameCommandId.recordedBy === recordedBy;
      if (!sameCommand) fail("CONFLICT", "This retry key already belongs to a different manual observation.");
      return { status: "ALREADY_SAVED", observationId: sameCommandId.observationId, observedAt: sameCommandId.observedAt };
    }

    const now = options.clock?.() ?? new Date();
    if (!Number.isFinite(now.getTime())) fail("UNAVAILABLE", "The manual-observation clock is invalid.");
    const record = sealM2ManualWebsiteObservation(buildM2ManualWebsiteObservation(command, target, recordedBy, now.toISOString()));
    const targetPath = path.join(rootDir, filenameFor(record));
    const tempPath = path.join(rootDir, `.m2-observation-${randomUUID()}.partial`);
    const temp = await open(tempPath, "wx", 0o600);
    try {
      await temp.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await temp.sync();
    } finally { await temp.close(); }
    try {
      await link(tempPath, targetPath);
      await unlink(tempPath);
    } catch (error) {
      try { await unlink(tempPath); } catch { /* Keep the primary publication error. */ }
      fail("CONFLICT", "The immutable manual-observation destination already exists or could not be published.", error);
    }
    return { status: "SAVED", observationId: record.observationId, observedAt: record.observedAt };
  } catch (error) {
    if (error instanceof M2ManualWebsiteObservationStoreError) throw error;
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return fail("CONFLICT", "Another manual observation is being saved for this business. Reload and retry with the same key.", error);
    return fail("UNAVAILABLE", "The manual website observation could not be saved.", error);
  } finally {
    if (lockHandle) {
      await lockHandle.close();
      try {
        const current = await lstat(lockPath);
        if (lockIdentity && current.isFile() && !current.isSymbolicLink() && current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) await unlink(lockPath);
      } catch { /* A held or replaced lock is never removed by this operation. */ }
    }
  }
}
