import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { PRIVATE_KW_M2_MIGRATION_FILES } from "../../../scripts/private-kw-m2-database.js";

export const PRIVATE_KW_M2_SETUP_RELEASE_VERSION = "kw-m2-local-0069-release-v1" as const;
export const PRIVATE_KW_M2_DATABASE_RECEIPT_V2 = "kw-m2-database-receipt-v2" as const;
export const PRIVATE_KW_M2_MIGRATION_RANGE = "0054-0069" as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const CommitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const RelativeDataPathSchema = z.string().regex(/^data\/kw-evaluation\/[A-Za-z0-9._-]+\.(?:sqlite|json)$/);
const MigrationEntrySchema = z.object({ filename: z.string(), sha256: Sha256Schema }).strict();

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function privateKwM2SetupDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

const ReleaseCoreSchema = z.object({
  envelopeVersion: z.literal(PRIVATE_KW_M2_SETUP_RELEASE_VERSION),
  status: z.literal("APPROVED"),
  repositoryCommit: CommitSchema,
  migrationRange: z.literal(PRIVATE_KW_M2_MIGRATION_RANGE),
  migrationManifest: z.array(MigrationEntrySchema).length(PRIVATE_KW_M2_MIGRATION_FILES.length),
  databasePath: RelativeDataPathSchema.refine((value) => value.endsWith(".sqlite")),
  backupPath: RelativeDataPathSchema.refine((value) => value.endsWith(".sqlite")),
  receiptPath: RelativeDataPathSchema.refine((value) => value.endsWith(".json")),
  quarantinePath: RelativeDataPathSchema.refine((value) => value.endsWith(".sqlite")),
  localSchemaMutationAuthorized: z.literal(true),
  remoteMigrationAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  runtimeQualificationAuthorized: z.literal(false),
  runtimeContactAuthorized: z.literal(false),
  runtimeOutreachAuthorized: z.literal(false),
  runtimeSendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  costAuthorizedUsd: z.literal(0),
  rollbackPolicy: z.literal("QUARANTINE_AND_OWNER_APPROVED_RESTORE"),
  approvedBy: z.enum(["RILEY", "AIDAN"]),
  reviewedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  rationale: z.string().trim().min(10).max(1000),
  confirmation: z.literal("APPROVE_M2_LOCAL_0069_SETUP"),
});

export const PrivateKwM2SetupReleaseEnvelopeSchema = ReleaseCoreSchema.extend({
  envelopeId: z.string().regex(/^kw-m2-local-0069-release:[a-f0-9]{64}$/),
  envelopeDigest: Sha256Schema,
}).strict().superRefine((envelope, context) => {
  const { envelopeId: _id, envelopeDigest: _digest, ...core } = envelope;
  void _id;
  void _digest;
  const expected = privateKwM2SetupDigest(core);
  if (envelope.envelopeDigest !== expected || envelope.envelopeId !== `kw-m2-local-0069-release:${expected}`) {
    context.addIssue({ code: "custom", path: ["envelopeDigest"], message: "The release envelope identity must bind its exact contents." });
  }
  const names = envelope.migrationManifest.map((entry) => entry.filename);
  if (JSON.stringify(names) !== JSON.stringify(PRIVATE_KW_M2_MIGRATION_FILES)) {
    context.addIssue({ code: "custom", path: ["migrationManifest"], message: "The release envelope must enumerate the exact ordered 0054-0069 migration manifest." });
  }
  if (new Set([envelope.databasePath, envelope.backupPath, envelope.receiptPath, envelope.quarantinePath]).size !== 4) {
    context.addIssue({ code: "custom", path: ["databasePath"], message: "Database, backup, quarantine, and receipt paths must be distinct." });
  }
  if (Date.parse(envelope.expiresAt) <= Date.parse(envelope.reviewedAt)) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "The release envelope must expire after review." });
  }
});

export type PrivateKwM2SetupReleaseEnvelope = z.infer<typeof PrivateKwM2SetupReleaseEnvelopeSchema>;

const FileIdentitySchema = z.object({
  device: z.string().min(1),
  inode: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  modificationMarker: z.string().min(1),
  sha256: Sha256Schema,
}).strict();

const AuthoritySchema = z.object({
  localOnly: z.literal(true),
  localSchemaMutationPerformed: z.literal(true),
  setupReleaseEnvelopeId: z.string().regex(/^kw-m2-local-0069-release:[a-f0-9]{64}$/),
  setupReleaseEnvelopeDigest: Sha256Schema,
  remoteMigrationAuthorized: z.literal(false),
  runtimeQualificationAuthorized: z.literal(false),
  runtimeContactAuthorized: z.literal(false),
  runtimeOutreachAuthorized: z.literal(false),
  runtimeSendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const BackupRestoreSchema = z.object({
  backupPath: RelativeDataPathSchema,
  backupFileIdentity: FileIdentitySchema,
  backupSha256: Sha256Schema,
  restoreDrillFileIdentity: FileIdentitySchema,
  restoreDrillSha256: Sha256Schema,
  restoreDrillVerified: z.literal(true),
  evidenceDigest: Sha256Schema,
}).strict();

export const PrivateKwM2DatabaseSetupReceiptSchema = z.object({
  receiptVersion: z.literal(PRIVATE_KW_M2_DATABASE_RECEIPT_V2),
  receiptId: z.string().regex(/^kw-m2-database:[a-f0-9]{64}$/),
  receiptDigest: Sha256Schema,
  databasePath: RelativeDataPathSchema.refine((value) => value.endsWith(".sqlite")),
  fileIdentity: FileIdentitySchema,
  setupReleaseEnvelopeId: z.string().regex(/^kw-m2-local-0069-release:[a-f0-9]{64}$/),
  setupReleaseEnvelopeDigest: Sha256Schema,
  migrationRange: z.literal(PRIVATE_KW_M2_MIGRATION_RANGE),
  migrationManifest: z.array(MigrationEntrySchema).length(PRIVATE_KW_M2_MIGRATION_FILES.length),
  migrationsCommit: CommitSchema,
  schemaDigest: Sha256Schema,
  preMigrationFileIdentity: FileIdentitySchema,
  backupRestore: BackupRestoreSchema,
  authority: AuthoritySchema,
}).strict().superRefine((receipt, context) => {
  const { receiptId: _id, receiptDigest: _digest, ...core } = receipt;
  void _id;
  void _digest;
  const expected = privateKwM2SetupDigest(core);
  if (receipt.receiptDigest !== expected || receipt.receiptId !== `kw-m2-database:${expected}`) {
    context.addIssue({ code: "custom", path: ["receiptDigest"], message: "The setup receipt identity must bind its exact contents." });
  }
  const names = receipt.migrationManifest.map((entry) => entry.filename);
  if (JSON.stringify(names) !== JSON.stringify(PRIVATE_KW_M2_MIGRATION_FILES)) {
    context.addIssue({ code: "custom", path: ["migrationManifest"], message: "The setup receipt must enumerate the exact ordered 0054-0069 migration manifest." });
  }
  if (receipt.authority.setupReleaseEnvelopeId !== receipt.setupReleaseEnvelopeId) {
    context.addIssue({ code: "custom", path: ["authority", "setupReleaseEnvelopeId"], message: "Receipt authority must bind the exact release envelope." });
  }
  if (receipt.authority.setupReleaseEnvelopeDigest !== receipt.setupReleaseEnvelopeDigest) {
    context.addIssue({ code: "custom", path: ["authority", "setupReleaseEnvelopeDigest"], message: "Receipt authority must bind the exact release envelope digest." });
  }
});

export type PrivateKwM2DatabaseSetupReceipt = z.infer<typeof PrivateKwM2DatabaseSetupReceiptSchema>;

export function privateKwM2SetupReleaseEnvelopeDigest(core: Omit<PrivateKwM2SetupReleaseEnvelope, "envelopeId" | "envelopeDigest">) {
  return privateKwM2SetupDigest(core);
}

export function privateKwM2DatabaseSetupReceiptDigest(core: Omit<PrivateKwM2DatabaseSetupReceipt, "receiptId" | "receiptDigest">) {
  return privateKwM2SetupDigest(core);
}

type LoaderOptions = {
  now?: Date;
};

const CANONICAL_REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

function currentRepositoryManifest() {
      const repositoryCommit = execFileSync("git", ["-C", CANONICAL_REPOSITORY_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const dirty = execFileSync("git", ["-C", CANONICAL_REPOSITORY_ROOT, "status", "--porcelain", "--", "migrations"], { encoding: "utf8" }).trim();
      if (dirty) throw new Error("The setup release requires a clean migration working tree.");
      const committed = PRIVATE_KW_M2_MIGRATION_FILES.map((filename) => ({
        filename,
        sha256: createHash("sha256").update(execFileSync("git", ["-C", CANONICAL_REPOSITORY_ROOT, "show", `HEAD:migrations/${filename}`])).digest("hex"),
      }));
      for (const filename of PRIVATE_KW_M2_MIGRATION_FILES) {
        const expectedBlob = execFileSync("git", ["-C", CANONICAL_REPOSITORY_ROOT, "rev-parse", `HEAD:migrations/${filename}`], { encoding: "utf8" }).trim();
        const workingBlob = execFileSync("git", ["-C", CANONICAL_REPOSITORY_ROOT, "hash-object", "--path", `migrations/${filename}`, path.join(CANONICAL_REPOSITORY_ROOT, "migrations", filename)], { encoding: "utf8" }).trim();
        if (workingBlob !== expectedBlob) throw new Error("Migration bytes do not match the exact Git HEAD blobs.");
      }
      return { repositoryCommit, migrationManifest: committed };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function sameIdentity(left: { dev: bigint; ino: bigint }, right: { dev: bigint; ino: bigint }) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readStableJson(file: string) {
  const absolute = path.resolve(file);
  const handle = await open(absolute, "r");
  try {
    const handleBefore = await handle.stat({ bigint: true });
    const beforePath = await lstat(absolute, { bigint: true });
    const beforeReal = await realpath(absolute);
    if (!handleBefore.isFile() || !beforePath.isFile() || beforeReal !== absolute || !sameIdentity(handleBefore, beforePath)) throw new Error("The setup release file must be a regular direct file with stable identity.");
    const bytes = await handle.readFile();
    const handleAfter = await handle.stat({ bigint: true });
    const afterPath = await lstat(absolute, { bigint: true });
    const afterReal = await realpath(absolute);
    if (!handleAfter.isFile() || !afterPath.isFile() || afterReal !== absolute || !sameIdentity(handleBefore, handleAfter) || !sameIdentity(handleAfter, afterPath) || afterPath.size !== BigInt(bytes.byteLength)) {
      throw new Error("The setup release file changed identity during read.");
    }
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}

export async function loadPrivateKwM2SetupReleaseEnvelope(file: string, options: LoaderOptions) {
  if (!/^data[\\/]kw-evaluation[\\/][A-Za-z0-9._-]+\.json$/.test(file)) throw new Error("M2 setup release must be a direct-child data/kw-evaluation JSON file.");
  const absolute = path.resolve(CANONICAL_REPOSITORY_ROOT, file);
  const expectedRoot = path.join(CANONICAL_REPOSITORY_ROOT, "data", "kw-evaluation");
  if (path.dirname(absolute) !== expectedRoot) throw new Error("M2 setup release must reside under the canonical repository data/kw-evaluation root.");
  const parent = await lstat(expectedRoot, { bigint: true });
  const parentReal = await realpath(expectedRoot);
  if (!parent.isDirectory() || parentReal !== expectedRoot) throw new Error("The setup release root must be a canonical directory.");
  const parsed = PrivateKwM2SetupReleaseEnvelopeSchema.parse(await readStableJson(absolute));
  const now = options.now ?? new Date();
  const current = currentRepositoryManifest();
  if (Date.parse(parsed.reviewedAt) > now.getTime()) throw new Error("The M2 setup release envelope is dated in the future.");
  if (Date.parse(parsed.expiresAt) <= now.getTime()) throw new Error("The M2 setup release envelope has expired.");
  if (parsed.repositoryCommit !== current.repositoryCommit) throw new Error("The M2 setup release commit does not match the current repository.");
  if (JSON.stringify(parsed.migrationManifest) !== JSON.stringify(current.migrationManifest)) throw new Error("The M2 setup release migration manifest does not match the current repository.");
  return deepFreeze(parsed);
}
