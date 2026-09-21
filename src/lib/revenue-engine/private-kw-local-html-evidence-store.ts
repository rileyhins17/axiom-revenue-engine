import { createHash, randomUUID } from "node:crypto";
import { lstat, link, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PRIVATE_KW_EVIDENCE_PARENT = path.resolve(REPOSITORY_ROOT, "data", "kw-evaluation");
export const PRIVATE_KW_EVIDENCE_ROOT = path.join(PRIVATE_KW_EVIDENCE_PARENT, "m2-evidence");
const MAX_HTML_BYTES = 1_048_576;
const MAX_JSON_BYTES = 32_768;
const MAX_FACTS_BYTES = 8_192;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^kw-html:sha256:([a-f0-9]{64})$/;
const META_REF = /^kw-html-meta:sha256:([a-f0-9]{64})$/;
const FACTS_REF = /^kw-html-facts:sha256:([a-f0-9]{64})$/;
const RECEIPT_REF = /^kw-html-receipt:sha256:([a-f0-9]{64})$/;

const IsoDateSchema = z.string().datetime({ offset: true });
const UrlSchema = z.string().url().refine((value) => /^https?:\/\//i.test(value), "Only HTTP(S) URLs are allowed.");
const DigestSchema = z.string().regex(HASH);

const FactsSchema = z.object({
  pageTitle: z.string().max(200).optional(),
  canonicalUrl: UrlSchema.optional(),
  serviceObservations: z.array(z.string().max(200)).max(20),
  locationObservations: z.array(z.string().max(200)).max(20),
  claimIds: z.array(z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/)).max(50),
  limitations: z.array(z.string().max(200)).max(20),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
}).strict();

export type PrivateKwFacts = z.infer<typeof FactsSchema>;

export interface PrivateKwEvidenceMetadataInput {
  businessId: string;
  sourceId: string;
  requestedUrl: string;
  finalUrl: string;
  redirectChainDigest: string;
  captureVersion: string;
  transportVersion: string;
  sourcePolicyVersion: string;
  capturedAt: string;
  rightsDecision: "ALLOWED";
  termsDecision: "REVIEWED";
  robotsDecision: "ALLOWED";
  parentReceiptDigest: string;
  authorizationDigest: string;
  authorizationExpiresAt: string;
  retentionDecision?: "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY" | "BLOCKED";
  retainUntil?: string;
  reviewAt?: string;
  legalHold?: boolean;
}

type RawEvidenceInput = PrivateKwEvidenceMetadataInput & {
  outcome: "RAW_HTML_ALLOWED";
  contentType: "text/html";
  bytes: Uint8Array;
};

type BlockedEvidenceInput = PrivateKwEvidenceMetadataInput & {
  outcome: "BLOCKED";
  blockCode: string;
};

type DerivedFactsInput = PrivateKwEvidenceMetadataInput & {
  outcome: "DERIVED_FACTS_ONLY";
  captureBytes: Uint8Array;
  facts: PrivateKwFacts;
  rawArtifactRef: null;
};

export type RawOrBlockedInput = RawEvidenceInput | BlockedEvidenceInput;

const CommonMetadataSchema = z.object({
  metadataVersion: z.literal("private-kw-html-metadata-v1"),
  outcome: z.enum(["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY"]),
  contentRef: z.string().regex(REF),
  contentByteLength: z.number().int().positive().max(MAX_HTML_BYTES),
  contentType: z.literal("text/html"),
  businessId: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(200),
  requestedUrl: UrlSchema,
  finalUrl: UrlSchema,
  redirectChainDigest: DigestSchema,
  captureVersion: z.string().min(1).max(120),
  transportVersion: z.string().min(1).max(120),
  sourcePolicyVersion: z.string().min(1).max(120),
  capturedAt: IsoDateSchema,
  rightsDecision: z.literal("ALLOWED"),
  termsDecision: z.literal("REVIEWED"),
  robotsDecision: z.literal("ALLOWED"),
  parentReceiptDigest: DigestSchema,
  authorizationDigest: DigestSchema,
  authorizationExpiresAt: IsoDateSchema,
  retentionDecision: z.enum(["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY"]),
  retainUntil: IsoDateSchema.optional(),
  reviewAt: IsoDateSchema.optional(),
  legalHold: z.boolean(),
}).strict();

const StoredMetadataSchema = z.discriminatedUnion("outcome", [
  CommonMetadataSchema.extend({
    outcome: z.literal("RAW_HTML_ALLOWED"),
    retentionDecision: z.literal("RAW_HTML_ALLOWED"),
    retainUntil: IsoDateSchema,
    reviewAt: z.undefined().optional(),
    metadataRef: z.string().regex(META_REF),
  }).strict(),
  CommonMetadataSchema.extend({
    outcome: z.literal("DERIVED_FACTS_ONLY"),
    retentionDecision: z.literal("DERIVED_FACTS_ONLY"),
    retainUntil: z.undefined().optional(),
    reviewAt: IsoDateSchema,
    metadataRef: z.string().regex(META_REF),
  }).strict(),
]);

const StoredFactsSchema = z.object({
  factsVersion: z.literal("private-kw-html-facts-v1"),
  contentRef: z.string().regex(REF),
  metadataRef: z.string().regex(META_REF),
  rawArtifactRef: z.null(),
  facts: FactsSchema,
  factsRef: z.string().regex(FACTS_REF),
}).strict();

const StoredReceiptSchema = z.object({
  receiptVersion: z.literal("private-kw-html-blocked-receipt-v1"),
  outcome: z.literal("BLOCKED"),
  blockCode: z.string().regex(/^[A-Z0-9_:-]{1,120}$/),
  businessId: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(200),
  parentReceiptDigest: DigestSchema,
  capturedAt: IsoDateSchema,
  receiptRef: z.string().regex(RECEIPT_REF),
}).strict();

type StoredMetadata = z.infer<typeof StoredMetadataSchema>;
type StoredFacts = z.infer<typeof StoredFactsSchema>;
type StoredReceipt = z.infer<typeof StoredReceiptSchema>;

export type PrivateKwHtmlEvidenceRef =
  | {
      outcome: "RAW_HTML_ALLOWED";
      contentRef: string;
      metadataRef: string;
      contentPath: string;
      metadataPath: string;
      executionPath: "CREATED" | "EXACT_REPLAY";
    }
  | {
      outcome: "DERIVED_FACTS_ONLY";
      contentRef: string;
      metadataRef: string;
      factsRef: string;
      metadataPath: string;
      factsPath: string;
      rawArtifactRef: null;
      executionPath: "CREATED" | "EXACT_REPLAY";
    }
  | {
      outcome: "BLOCKED";
      receiptRef: string;
      receiptPath: string;
      blockCode: string;
      executionPath: "CREATED" | "EXACT_REPLAY";
    };

export type ReloadedEvidence =
  | { outcome: "RAW_HTML_ALLOWED"; bytes: Buffer; metadata: StoredMetadata }
  | { outcome: "DERIVED_FACTS_ONLY"; facts: StoredFacts; metadata: StoredMetadata }
  | { outcome: "BLOCKED"; blockCode: string; receipt: StoredReceipt };

export type PrivateKwEvidenceRetentionState = "ACTIVE" | "REVIEW_DUE" | "EXPIRED" | "LEGAL_HOLD" | "INVALID_RETENTION";

function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function contentRef(digest: string) { return `kw-html:sha256:${digest}`; }
function metadataRef(digest: string) { return `kw-html-meta:sha256:${digest}`; }
function factsRef(digest: string) { return `kw-html-facts:sha256:${digest}`; }
function receiptRef(digest: string) { return `kw-html-receipt:sha256:${digest}`; }

function shard(digest: string) { return digest.slice(0, 2); }

function expectedArtifactPath(root: string, category: "objects" | "metadata" | "facts" | "receipts", digest: string, extension: string) {
  return path.join(root, category, "sha256", shard(digest), `${digest}.${extension}`);
}

function assertExpectedArtifactPath(candidate: string, expected: string, label: string) {
  if (!samePath(path.resolve(candidate), expected)) throw new Error(`${label} path does not match its content reference.`);
}

function samePath(left: string, right: string) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase("en-CA") === normalizedRight.toLocaleLowerCase("en-CA")
    : normalizedLeft === normalizedRight;
}

function assertDigest(value: string, label: string) {
  if (!HASH.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
}

function assertBranchInput(input: PrivateKwEvidenceMetadataInput & { outcome: string }, nowMs = Date.now()) {
  const parsed = z.object({
    businessId: z.string().trim().min(1).max(200),
    sourceId: z.string().trim().min(1).max(200),
    requestedUrl: UrlSchema,
    finalUrl: UrlSchema,
    redirectChainDigest: DigestSchema,
    captureVersion: z.string().trim().min(1).max(120),
    transportVersion: z.string().trim().min(1).max(120),
    sourcePolicyVersion: z.string().trim().min(1).max(120),
    capturedAt: IsoDateSchema,
    rightsDecision: z.literal("ALLOWED"),
    termsDecision: z.literal("REVIEWED"),
    robotsDecision: z.literal("ALLOWED"),
    parentReceiptDigest: DigestSchema,
    authorizationDigest: DigestSchema,
    authorizationExpiresAt: IsoDateSchema,
    retentionDecision: z.enum(["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY", "BLOCKED"]),
    retainUntil: IsoDateSchema.optional(),
    reviewAt: IsoDateSchema.optional(),
    legalHold: z.boolean().optional(),
    outcome: z.string(),
  }).passthrough().parse(input);
  if (parsed.retentionDecision !== parsed.outcome) {
    throw new Error("Retention decision must exactly match the evidence outcome.");
  }
  if (Date.parse(parsed.authorizationExpiresAt) <= nowMs) {
    throw new Error("The evidence authorization is expired.");
  }
  assertDigest(parsed.parentReceiptDigest, "parentReceiptDigest");
  assertDigest(parsed.authorizationDigest, "authorizationDigest");
  return parsed;
}

export function resolvePrivateKwEvidenceRoot(value = "data/kw-evaluation/m2-evidence") {
  const resolved = path.resolve(REPOSITORY_ROOT, value);
  if (!samePath(path.dirname(resolved), PRIVATE_KW_EVIDENCE_PARENT) || path.basename(resolved) !== "m2-evidence") {
    throw new Error("Private KW evidence root must be the direct child data/kw-evaluation/m2-evidence.");
  }
  return resolved;
}

async function assertDirectory(directory: string, expected: string) {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("Private KW evidence paths cannot be symbolic links or non-directories.");
  const canonical = await realpath(directory);
  if (!samePath(canonical, expected)) throw new Error("Private KW evidence path resolves outside its approved root.");
}

async function ensureSafeRoot(root: string) {
  await assertDirectory(REPOSITORY_ROOT, REPOSITORY_ROOT);
  let current = REPOSITORY_ROOT;
  for (const segment of ["data", "kw-evaluation"]) {
    current = path.join(current, segment);
    try { await mkdir(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await assertDirectory(current, current);
  }
  await assertDirectory(PRIVATE_KW_EVIDENCE_PARENT, PRIVATE_KW_EVIDENCE_PARENT);
  try { await mkdir(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await assertDirectory(root, root);
}

async function ensureShardDirectory(root: string, category: "objects" | "metadata" | "facts" | "receipts", digest: string) {
  const directory = path.join(root, category, "sha256", shard(digest));
  let current = root;
  for (const segment of [category, "sha256", shard(digest)]) {
    current = path.join(current, segment);
    try { await mkdir(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await assertDirectory(current, current);
  }
  return directory;
}

function assertRegularIdentity(pathStats: { isFile(): boolean; isSymbolicLink(): boolean; dev: bigint; ino: bigint }, handleStats: { isFile(): boolean; dev: bigint; ino: bigint }) {
  if (pathStats.isSymbolicLink() || !pathStats.isFile() || !handleStats.isFile()) throw new Error("UNSAFE_PATH: evidence must remain a regular file.");
  if (pathStats.dev === BigInt(0) || pathStats.ino === BigInt(0) || handleStats.dev === BigInt(0) || handleStats.ino === BigInt(0)) throw new Error("IDENTITY_UNAVAILABLE: stable file identity is required.");
  if (pathStats.dev !== handleStats.dev || pathStats.ino !== handleStats.ino) throw new Error("IDENTITY_CHANGED: evidence file identity changed.");
}

async function readVerifiedFile(file: string, expectedDigest?: string, expectedLength?: number, maxLength?: number) {
  const handle = await open(file, "r");
  try {
    const handleStats = await handle.stat({ bigint: true });
    const before = await lstat(file, { bigint: true });
    assertRegularIdentity(before, handleStats);
    if (expectedLength !== undefined && handleStats.size !== BigInt(expectedLength)) throw new Error("LENGTH_MISMATCH: evidence length changed.");
    if (maxLength !== undefined && handleStats.size > BigInt(maxLength)) throw new Error("LENGTH_MISMATCH: evidence exceeds its bound.");
    const bytes = await handle.readFile();
    const after = await lstat(file, { bigint: true });
    assertRegularIdentity(after, handleStats);
    if (after.size !== BigInt(bytes.byteLength)) throw new Error("LENGTH_MISMATCH: evidence length changed during read.");
    if (expectedDigest !== undefined && sha256(bytes) !== expectedDigest) throw new Error("DIGEST_MISMATCH: evidence bytes do not match their content reference.");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function publishExclusive(file: string, bytes: Uint8Array, digest: string, maxBytes: number) {
  if (bytes.byteLength <= 0 || bytes.byteLength > maxBytes) throw new Error("Evidence bytes exceed the bounded store limit.");
  const directory = path.dirname(file);
  const temp = path.join(directory, `.tmp-${process.pid}-${randomUUID()}.part`);
  const handle = await open(temp, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await readVerifiedFile(temp, digest, bytes.byteLength);
  try {
    await link(temp, file);
    await unlink(temp);
    return "CREATED" as const;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readVerifiedFile(file, digest, bytes.byteLength);
    if (!existing.equals(Buffer.from(bytes))) throw new Error("EXISTING_OBJECT_MISMATCH: immutable object differs.");
    await unlink(temp);
    return "REUSED" as const;
  }
}

function metadataCore(input: PrivateKwEvidenceMetadataInput, outcome: "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY", digest: string, byteLength: number) {
  const core = {
    metadataVersion: "private-kw-html-metadata-v1" as const,
    outcome,
    contentRef: contentRef(digest),
    contentByteLength: byteLength,
    contentType: "text/html" as const,
    businessId: input.businessId,
    sourceId: input.sourceId,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    redirectChainDigest: input.redirectChainDigest,
    captureVersion: input.captureVersion,
    transportVersion: input.transportVersion,
    sourcePolicyVersion: input.sourcePolicyVersion,
    capturedAt: input.capturedAt,
    rightsDecision: input.rightsDecision,
    termsDecision: input.termsDecision,
    robotsDecision: input.robotsDecision,
    parentReceiptDigest: input.parentReceiptDigest,
    authorizationDigest: input.authorizationDigest,
    authorizationExpiresAt: input.authorizationExpiresAt,
    retentionDecision: outcome,
    ...(outcome === "RAW_HTML_ALLOWED" ? { retainUntil: input.retainUntil } : { reviewAt: input.reviewAt }),
    legalHold: input.legalHold ?? false,
  };
  const parsed = CommonMetadataSchema.parse(core);
  if (outcome === "RAW_HTML_ALLOWED" && !parsed.retainUntil) throw new Error("RAW_HTML_ALLOWED requires retainUntil.");
  if (outcome === "DERIVED_FACTS_ONLY" && !parsed.reviewAt) throw new Error("DERIVED_FACTS_ONLY requires reviewAt.");
  return parsed;
}

function assertFactsSafe(value: PrivateKwFacts, captureByteLength: number) {
  const serialized = canonicalize(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_FACTS_BYTES || (captureByteLength > 256 && Buffer.byteLength(serialized, "utf8") > captureByteLength * 0.75)) {
    throw new Error("Facts payload is too large to be a bounded derived-facts record.");
  }
  const strings: string[] = [];
  const visit = (entry: unknown) => {
    if (typeof entry === "string") strings.push(entry);
    else if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry && typeof entry === "object") Object.values(entry).forEach(visit);
  };
  visit(value);
  for (const string of strings) {
    if (/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(string)) throw new Error("Facts cannot retain personal contact addresses.");
    if (/^data:/i.test(string) || /(?:[A-Za-z0-9+/]{80,}={0,2})/.test(string)) throw new Error("Facts cannot retain encoded or copied body content.");
  }
  return serialized;
}

export function createPrivateKwLocalHtmlEvidenceStore(options: { rootPath?: string; clock?: () => Date } = {}) {
  const root = resolvePrivateKwEvidenceRoot(options.rootPath ?? "data/kw-evaluation/m2-evidence");
  const clock = options.clock ?? (() => new Date());

  async function writeMetadata(core: Record<string, unknown>, ref: string) {
    const metadataDirectory = await ensureShardDirectory(root, "metadata", ref.slice(-64));
    const file = path.join(metadataDirectory, `${ref.slice(-64)}.json`);
    const bytes = Buffer.from(`${JSON.stringify({ ...core, metadataRef: ref }, null, 2)}\n`, "utf8");
    const operation = await publishExclusive(file, bytes, sha256(bytes), MAX_JSON_BYTES);
    return { file, operation };
  }

  async function writeRaw(input: RawEvidenceInput) {
    assertBranchInput(input, clock().getTime());
    if (input.contentType !== "text/html") throw new Error("RAW_HTML_ALLOWED requires text/html.");
    const bytes = Buffer.from(input.bytes);
    const digest = sha256(bytes);
    const core = metadataCore(input, "RAW_HTML_ALLOWED", digest, bytes.byteLength);
    const parsedCore = CommonMetadataSchema.parse(core);
    const metadataDigest = sha256(canonicalize(parsedCore));
    const rawDirectory = await ensureShardDirectory(root, "objects", digest);
    const contentPath = path.join(rawDirectory, `${digest}.html`);
    const metadataDirectory = await ensureShardDirectory(root, "metadata", metadataDigest);
    const metadataPath = path.join(metadataDirectory, `${metadataDigest}.json`);
    const existingContent = await optionalFileExists(contentPath);
    const existingMetadata = await optionalFileExists(metadataPath);
    if (existingContent && !existingMetadata && !(await hasMetadataForContent(contentRef(digest)))) {
      throw new Error("INCOMPLETE_EXISTING: raw content exists without a complete metadata pair.");
    }
    const contentOperation = await publishExclusive(contentPath, bytes, digest, MAX_HTML_BYTES);
    const metadata = await writeMetadata(parsedCore, metadataRef(metadataDigest));
    return {
      outcome: "RAW_HTML_ALLOWED" as const,
      contentRef: contentRef(digest),
      metadataRef: metadataRef(metadataDigest),
      contentPath,
      metadataPath: metadata.file,
      executionPath: contentOperation === "REUSED" && metadata.operation === "REUSED" ? "EXACT_REPLAY" as const : "CREATED" as const,
    };
  }

  async function hasMetadataForContent(ref: string) {
    const metadataRoot = path.join(root, "metadata");
    const found = { value: false };
    async function walk(directory: string): Promise<void> {
      let children: string[];
      try { children = await readdir(directory); } catch { return; }
      for (const child of children) {
        const full = path.join(directory, child);
        const stats = await lstat(full);
        if (stats.isDirectory()) {
          await walk(full);
        } else if (path.extname(child).toLowerCase() === ".json") {
          const bytes = await readVerifiedFile(full, undefined, undefined, MAX_JSON_BYTES);
          const metadata = StoredMetadataSchema.parse(JSON.parse(bytes.toString("utf8")));
          if (metadata.contentRef === ref) found.value = true;
        }
        if (found.value) return;
      }
    }
    await walk(metadataRoot);
    return found.value;
  }

  async function writeDerived(input: DerivedFactsInput) {
    assertBranchInput(input, clock().getTime());
    if (input.rawArtifactRef !== null) throw new Error("Derived facts must set rawArtifactRef to null.");
    const captureBytes = Buffer.from(input.captureBytes);
    const parsedFacts = FactsSchema.parse(input.facts);
    const factsJson = assertFactsSafe(parsedFacts, captureBytes.byteLength);
    const digest = sha256(captureBytes);
    const core = metadataCore(input, "DERIVED_FACTS_ONLY", digest, captureBytes.byteLength);
    const parsedCore = CommonMetadataSchema.parse(core);
    const metadataDigest = sha256(canonicalize(parsedCore));
    const metadataDirectory = await ensureShardDirectory(root, "metadata", metadataDigest);
    const metadataFile = path.join(metadataDirectory, `${metadataDigest}.json`);
    const factsCore = {
      factsVersion: "private-kw-html-facts-v1" as const,
      contentRef: contentRef(digest),
      metadataRef: metadataRef(metadataDigest),
      rawArtifactRef: null,
      facts: parsedFacts,
    };
    const factsDigest = sha256(canonicalize(factsCore));
    const factsDirectory = await ensureShardDirectory(root, "facts", factsDigest);
    const factsFile = path.join(factsDirectory, `${factsDigest}.json`);
    const existingMetadata = await optionalFileExists(metadataFile);
    const existingFacts = await optionalFileExists(factsFile);
    if (existingMetadata !== existingFacts) throw new Error("INCOMPLETE_EXISTING: derived facts pair is incomplete.");
    const metadata = await writeMetadata(parsedCore, metadataRef(metadataDigest));
    const factsBytes = Buffer.from(`${JSON.stringify({ ...factsCore, factsRef: factsRef(factsDigest) }, null, 2)}\n`);
    const facts = await publishExclusive(factsFile, factsBytes, sha256(factsBytes), MAX_JSON_BYTES);
    void factsJson;
    return {
      outcome: "DERIVED_FACTS_ONLY" as const,
      contentRef: contentRef(digest),
      metadataRef: metadataRef(metadataDigest),
      factsRef: factsRef(factsDigest),
      metadataPath: metadata.file,
      factsPath: factsFile,
      rawArtifactRef: null,
      executionPath: metadata.operation === "REUSED" && facts === "REUSED" ? "EXACT_REPLAY" as const : "CREATED" as const,
    };
  }

  async function writeBlocked(input: BlockedEvidenceInput) {
    assertBranchInput(input, clock().getTime());
    if (!/^[A-Z0-9_:-]{1,120}$/.test(input.blockCode)) throw new Error("Blocked evidence reason must be bounded.");
    const receiptCore = {
      receiptVersion: "private-kw-html-blocked-receipt-v1" as const,
      outcome: "BLOCKED" as const,
      blockCode: input.blockCode,
      businessId: input.businessId,
      sourceId: input.sourceId,
      parentReceiptDigest: input.parentReceiptDigest,
      capturedAt: input.capturedAt,
    };
    const digest = sha256(canonicalize(receiptCore));
    const ref = receiptRef(digest);
    const directory = await ensureShardDirectory(root, "receipts", digest);
    const file = path.join(directory, `${digest}.json`);
    const bytes = Buffer.from(`${JSON.stringify({ ...receiptCore, receiptRef: ref }, null, 2)}\n`);
    const operation = await publishExclusive(file, bytes, sha256(bytes), MAX_JSON_BYTES);
    return { outcome: "BLOCKED" as const, receiptRef: ref, receiptPath: file, blockCode: input.blockCode, executionPath: operation === "REUSED" ? "EXACT_REPLAY" as const : "CREATED" as const };
  }

  async function writePrivateKwHtmlEvidence(input: RawOrBlockedInput): Promise<PrivateKwHtmlEvidenceRef> {
    await ensureSafeRoot(root);
    return input.outcome === "RAW_HTML_ALLOWED" ? writeRaw(input) : writeBlocked(input);
  }

  async function writePrivateKwDerivedFacts(input: DerivedFactsInput): Promise<PrivateKwHtmlEvidenceRef> {
    await ensureSafeRoot(root);
    return writeDerived(input);
  }

  async function reloadPrivateKwHtmlEvidence(reference: unknown): Promise<ReloadedEvidence> {
    await ensureSafeRoot(root);
    const parsed = z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("RAW_HTML_ALLOWED"), contentRef: z.string().regex(REF), metadataRef: z.string().regex(META_REF), contentPath: z.string(), metadataPath: z.string(), executionPath: z.enum(["CREATED", "EXACT_REPLAY"]) }).strict(),
      z.object({ outcome: z.literal("DERIVED_FACTS_ONLY"), contentRef: z.string().regex(REF), metadataRef: z.string().regex(META_REF), factsRef: z.string().regex(FACTS_REF), metadataPath: z.string(), factsPath: z.string(), rawArtifactRef: z.null(), executionPath: z.enum(["CREATED", "EXACT_REPLAY"]) }).strict(),
      z.object({ outcome: z.literal("BLOCKED"), receiptRef: z.string().regex(RECEIPT_REF), receiptPath: z.string(), blockCode: z.string(), executionPath: z.enum(["CREATED", "EXACT_REPLAY"]) }).strict(),
    ]).parse(reference);
    if (parsed.outcome === "BLOCKED") {
      const digest = parsed.receiptRef.slice(-64);
      const expectedReceiptPath = expectedArtifactPath(root, "receipts", digest, "json");
      assertExpectedArtifactPath(parsed.receiptPath, expectedReceiptPath, "Blocked receipt");
      const bytes = await readVerifiedFile(expectedReceiptPath, undefined, undefined, MAX_JSON_BYTES);
      const receipt = StoredReceiptSchema.parse(JSON.parse(bytes.toString("utf8")));
      const { receiptRef: storedReceiptRef, ...receiptCore } = receipt;
      if (storedReceiptRef !== parsed.receiptRef || receipt.blockCode !== parsed.blockCode || receiptRef(digest) !== parsed.receiptRef || sha256(canonicalize(receiptCore)) !== digest) throw new Error("BLOCKED receipt identity mismatch.");
      return { outcome: "BLOCKED", blockCode: receipt.blockCode, receipt };
    }
    const metadataDigest = parsed.metadataRef.slice(-64);
    const expectedMetadataPath = expectedArtifactPath(root, "metadata", metadataDigest, "json");
    assertExpectedArtifactPath(parsed.metadataPath, expectedMetadataPath, "Metadata");
    const metadataBytes = await readVerifiedFile(expectedMetadataPath, undefined, undefined, MAX_JSON_BYTES);
    const metadata = StoredMetadataSchema.parse(JSON.parse(metadataBytes.toString("utf8")));
    const { metadataRef: storedMetadataRef, ...metadataCoreValue } = metadata;
    if (storedMetadataRef !== parsed.metadataRef || sha256(canonicalize(metadataCoreValue)) !== metadataDigest) throw new Error("MALFORMED_METADATA: metadata digest mismatch.");
    const contentDigest = parsed.contentRef.slice(-64);
    if (metadata.contentRef !== parsed.contentRef) throw new Error("Metadata content reference mismatch.");
    if (parsed.outcome === "RAW_HTML_ALLOWED") {
      const expectedContentPath = expectedArtifactPath(root, "objects", contentDigest, "html");
      assertExpectedArtifactPath(parsed.contentPath, expectedContentPath, "Raw content");
      const bytes = await readVerifiedFile(expectedContentPath, contentDigest, metadata.contentByteLength);
      if (metadata.outcome !== "RAW_HTML_ALLOWED") throw new Error("Metadata outcome mismatch.");
      return { outcome: "RAW_HTML_ALLOWED", bytes, metadata };
    }
    if (metadata.outcome !== "DERIVED_FACTS_ONLY") throw new Error("Metadata outcome mismatch.");
    const factsDigest = parsed.factsRef.slice(-64);
    const expectedFactsPath = expectedArtifactPath(root, "facts", factsDigest, "json");
    assertExpectedArtifactPath(parsed.factsPath, expectedFactsPath, "Facts");
    const factsBytes = await readVerifiedFile(expectedFactsPath, undefined, undefined, MAX_JSON_BYTES);
    const facts = StoredFactsSchema.parse(JSON.parse(factsBytes.toString("utf8")));
    const { factsRef: storedFactsRef, ...factsCoreValue } = facts;
    if (storedFactsRef !== parsed.factsRef || facts.contentRef !== parsed.contentRef || facts.metadataRef !== parsed.metadataRef || sha256(canonicalize(factsCoreValue)) !== factsDigest) throw new Error("Facts identity mismatch.");
    assertFactsSafe(facts.facts, metadata.contentByteLength);
    return { outcome: "DERIVED_FACTS_ONLY", facts, metadata };
  }

  async function assertPrivateKwHtmlEvidenceRetention(reference: unknown, now: Date): Promise<PrivateKwEvidenceRetentionState> {
    const reloaded = await reloadPrivateKwHtmlEvidence(reference);
    if (reloaded.outcome === "BLOCKED") return "ACTIVE";
    if (reloaded.metadata.legalHold) return "LEGAL_HOLD";
    if (reloaded.outcome === "RAW_HTML_ALLOWED") return now.getTime() >= Date.parse(reloaded.metadata.retainUntil ?? "") ? "EXPIRED" : "ACTIVE";
    return now.getTime() >= Date.parse(reloaded.metadata.reviewAt ?? "") ? "REVIEW_DUE" : "ACTIVE";
  }

  return { writePrivateKwHtmlEvidence, writePrivateKwDerivedFacts, reloadPrivateKwHtmlEvidence, assertPrivateKwHtmlEvidenceRetention };
}

async function optionalFileExists(file: string) {
  try { await lstat(file); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
