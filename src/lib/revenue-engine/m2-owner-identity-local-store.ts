import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import {
  PrivateKwM2OwnerDecisionsSchema,
  type PrivateKwM2OwnerDecisions,
} from "./private-kw-m2-owner-decisions";

// Use the same local workspace root as the exact-packet reader. Next bundles
// server modules under .next, so import.meta.url is not a stable repo path.
const DEFAULT_ROOT = path.join(process.cwd(), "data", "kw-evaluation");
const FILE_PREFIX = "m2-owner-decisions-";
const MAX_LEDGER_BYTES = 64 * 1024;
const FILE_PATTERN = /^m2-owner-decisions-([a-f0-9]{64})-(riley|aidan)-([a-f0-9]{64})\.json$/;

export type M2OwnerIdentityLocalStoreStatus = "SAVED" | "ALREADY_SAVED" | "LATEST";
export type M2OwnerIdentityLocalStoreSummary = {
  status: M2OwnerIdentityLocalStoreStatus;
  filename: string;
  reviewedBy: "RILEY" | "AIDAN";
  reviewedAt: string;
  researchReviewSha256: string;
  decisionDigest: string;
};

export class M2OwnerIdentityLocalStoreError extends Error {
  constructor(readonly code: "CONFLICT" | "UNAVAILABLE", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "M2OwnerIdentityLocalStoreError";
  }
}

export type M2OwnerIdentityLocalStoreOptions = { rootDir?: string };

function fail(code: "CONFLICT" | "UNAVAILABLE", message: string, cause?: unknown): never {
  throw new M2OwnerIdentityLocalStoreError(code, message, cause === undefined ? undefined : { cause });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function decisionDigest(ledger: PrivateKwM2OwnerDecisions): string {
  const { reviewedAt: ignoredReviewTime, ...stableLedger } = ledger;
  void ignoredReviewTime;
  return createHash("sha256").update(canonicalJson(stableLedger)).digest("hex");
}

function filenameFor(ledger: PrivateKwM2OwnerDecisions): string {
  return `${FILE_PREFIX}${ledger.researchReviewSha256}-${ledger.reviewedBy.toLocaleLowerCase("en-CA")}-${decisionDigest(ledger)}.json`;
}

function summary(ledger: PrivateKwM2OwnerDecisions, filename: string, status: M2OwnerIdentityLocalStoreStatus): M2OwnerIdentityLocalStoreSummary {
  return {
    status,
    filename,
    reviewedBy: ledger.reviewedBy,
    reviewedAt: ledger.reviewedAt,
    researchReviewSha256: ledger.researchReviewSha256,
    decisionDigest: decisionDigest(ledger),
  };
}

async function ensureSafeRoot(rootDir: string) {
  try {
    await mkdir(rootDir, { recursive: true });
    const root = await lstat(rootDir);
    if (root.isSymbolicLink() || !root.isDirectory()) fail("UNAVAILABLE", "Private owner-decision storage root is unsafe.");
  } catch (error) {
    if (error instanceof M2OwnerIdentityLocalStoreError) throw error;
    fail("UNAVAILABLE", "Private owner-decision storage is unavailable.", error);
  }
}

async function readStoredFile(rootDir: string, filename: string): Promise<PrivateKwM2OwnerDecisions> {
  const file = path.join(rootDir, filename);
  try {
    const before = await lstat(file);
    if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_LEDGER_BYTES) {
      fail("CONFLICT", "A conflicting owner-decision file already occupies the saved version.");
    }
    const handle = await open(file, constants.O_RDONLY);
    try {
      const opened = await handle.stat();
      const after = await lstat(file);
      if (!opened.isFile() || after.isSymbolicLink() || !after.isFile()
        || opened.dev !== after.dev || opened.ino !== after.ino
        || opened.size > MAX_LEDGER_BYTES) {
        fail("CONFLICT", "A conflicting owner-decision file already occupies the saved version.");
      }
      const bytes = await handle.readFile();
      if (bytes.byteLength > MAX_LEDGER_BYTES) fail("CONFLICT", "The saved owner-decision file exceeds its size limit.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      } catch (error) {
        fail("CONFLICT", "The saved owner-decision file is incomplete or invalid.", error);
      }
      const result = PrivateKwM2OwnerDecisionsSchema.safeParse(parsed);
      if (!result.success || filenameFor(result.data) !== filename) {
        fail("CONFLICT", "The saved owner-decision file does not match its immutable filename.");
      }
      return result.data;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof M2OwnerIdentityLocalStoreError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("CONFLICT", "An expected saved owner-decision file is missing.", error);
    fail("UNAVAILABLE", "Private owner-decision storage could not be read.", error);
  }
}

/** Saves an already validated M2 owner-decision ledger under a private, immutable deterministic filename. */
export async function savePrivateKwM2OwnerDecisions(
  input: unknown,
  options: M2OwnerIdentityLocalStoreOptions = {},
): Promise<M2OwnerIdentityLocalStoreSummary> {
  const parsed = PrivateKwM2OwnerDecisionsSchema.safeParse(input);
  if (!parsed.success) fail("UNAVAILABLE", "The owner-decision ledger is invalid.", parsed.error);
  const ledger = parsed.data;
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_ROOT);
  await ensureSafeRoot(rootDir);
  const filename = filenameFor(ledger);
  const file = path.join(rootDir, filename);

  try {
    const handle = await open(file, "wx", 0o600);
    try {
      const bytes = Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`, "utf8");
      if (bytes.byteLength > MAX_LEDGER_BYTES) fail("UNAVAILABLE", "The owner-decision ledger exceeds its size limit.");
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return summary(ledger, filename, "SAVED");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const existing = await readStoredFile(rootDir, filename);
      if (decisionDigest(existing) !== decisionDigest(ledger)) {
        fail("CONFLICT", "A conflicting owner-decision version already exists.");
      }
      return summary(existing, filename, "ALREADY_SAVED");
    }
    if (error instanceof M2OwnerIdentityLocalStoreError) throw error;
    fail("UNAVAILABLE", "The owner-decision ledger could not be saved.", error);
  }
}

/** Reads only the latest valid saved ledger for the current exact research packet, returning summary metadata only. */
export async function readLatestPrivateKwM2OwnerDecisions(
  packetSha256: string,
  options: M2OwnerIdentityLocalStoreOptions = {},
): Promise<M2OwnerIdentityLocalStoreSummary | null> {
  if (!/^[a-f0-9]{64}$/.test(packetSha256)) fail("UNAVAILABLE", "The current research packet digest is invalid.");
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_ROOT);
  await ensureSafeRoot(rootDir);
  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch (error) {
    fail("UNAVAILABLE", "Private owner-decision storage could not be listed.", error);
  }
  const prefix = `${FILE_PREFIX}${packetSha256}-`;
  const matches = entries.filter((entry) => entry.startsWith(prefix));
  const records: M2OwnerIdentityLocalStoreSummary[] = [];
  for (const filename of matches) {
    if (!FILE_PATTERN.test(filename)) fail("CONFLICT", "A malformed owner-decision version exists for the current research packet.");
    const ledger = await readStoredFile(rootDir, filename);
    records.push(summary(ledger, filename, "LATEST"));
  }
  records.sort((left, right) => Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt) || left.filename.localeCompare(right.filename, "en"));
  return records[0] ?? null;
}
