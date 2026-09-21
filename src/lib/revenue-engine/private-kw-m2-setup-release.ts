import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { PRIVATE_KW_M2_MIGRATION_FILES, type PrivateKwM2MigrationManifestEntry } from "../../../scripts/private-kw-m2-database.js";

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
  repositoryCommit: string;
  migrationManifest: readonly PrivateKwM2MigrationManifestEntry[];
};

async function readStableJson(file: string) {
  const absolute = path.resolve(file);
  const handle = await open(absolute, "r");
  try {
    const beforePath = await lstat(absolute, { bigint: true });
    const beforeReal = await realpath(absolute);
    if (!beforePath.isFile() || beforeReal !== absolute) throw new Error("The setup release file must be a regular direct file.");
    const bytes = await handle.readFile();
    const afterPath = await lstat(absolute, { bigint: true });
    const afterReal = await realpath(absolute);
    if (!afterPath.isFile() || afterReal !== absolute || beforePath.dev !== afterPath.dev || beforePath.ino !== afterPath.ino) {
      throw new Error("The setup release file changed identity during read.");
    }
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}

export async function loadPrivateKwM2SetupReleaseEnvelope(file: string, options: LoaderOptions) {
  if (!/^data[\\/]kw-evaluation[\\/][A-Za-z0-9._-]+\.json$/.test(file)) throw new Error("M2 setup release must be a direct-child data/kw-evaluation JSON file.");
  const parsed = PrivateKwM2SetupReleaseEnvelopeSchema.parse(await readStableJson(file));
  const now = options.now ?? new Date();
  if (Date.parse(parsed.expiresAt) <= now.getTime()) throw new Error("The M2 setup release envelope has expired.");
  if (parsed.repositoryCommit !== options.repositoryCommit) throw new Error("The M2 setup release commit does not match the current repository.");
  if (JSON.stringify(parsed.migrationManifest) !== JSON.stringify(options.migrationManifest)) throw new Error("The M2 setup release migration manifest does not match the current repository.");
  return parsed;
}
