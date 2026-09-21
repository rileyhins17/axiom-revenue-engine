import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { PRIVATE_KW_EVIDENCE_ROOT } from "@/lib/revenue-engine/private-kw-local-html-evidence-store";
import type { PrivateKwM2WebsiteEvidenceReceipt } from "@/lib/revenue-engine/private-kw-m2-html-evidence-workflow";

function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => JSON.stringify(key) + ":" + canonicalize(object[key])).join(",") + "}";
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_ROOT = /^m2-receipt-test-[a-z0-9-]+$/;
type ReceiptValidator = (value: unknown) => PrivateKwM2WebsiteEvidenceReceipt;
function resolveReceiptRoot(rootPath?: string) {
  if (rootPath === undefined) return PRIVATE_KW_EVIDENCE_ROOT;
  const resolved = path.resolve(rootPath);
  if (path.dirname(resolved) !== path.dirname(PRIVATE_KW_EVIDENCE_ROOT) || !TEST_ROOT.test(path.basename(resolved))) throw new Error("UNSAFE_SEALED_RECEIPT_ROOT");
  return resolved;
}
function operationPath(root: string, operationId: string) {
  if (!UUID.test(operationId)) throw new Error("SEALED_RECEIPT_OPERATION_ID_INVALID");
  return path.join(root, "sealed", "sha256", operationId.slice(0, 2), operationId + ".json");
}

async function assertSafeRoot(root: string, create = true) {
  const parent = path.dirname(root);
  const parentStats = await lstat(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || await realpath(parent) !== path.resolve(parent)) throw new Error("UNSAFE_SEALED_RECEIPT_ROOT");
  if (!create) {
    try { const rootStats = await lstat(root); if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || await realpath(root) !== path.resolve(root)) throw new Error("UNSAFE_SEALED_RECEIPT_ROOT"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
    return true;
  }
  await mkdir(root, { recursive: true });
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("UNSAFE_SEALED_RECEIPT_ROOT");
  if (await realpath(root) !== path.resolve(root)) throw new Error("UNSAFE_SEALED_RECEIPT_ROOT");
  return true;
}

async function assertSafeFile(file: string) {
  const stats = await lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink() || await realpath(file) !== path.resolve(file)) throw new Error("UNSAFE_SEALED_RECEIPT_FILE");
}
async function ensureSafeDirectoryChain(root: string, directory: string, create = true) {
  const relative = path.relative(root, directory);
  if (path.isAbsolute(relative) || relative.startsWith("..")) throw new Error("UNSAFE_SEALED_RECEIPT_PATH");
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (create) await mkdir(current, { recursive: false }).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
    else { try { await lstat(current); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
    const stats = await lstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink() || await realpath(current) !== path.resolve(current)) throw new Error("UNSAFE_SEALED_RECEIPT_PATH");
  }
  return true;
}

function parseReceipt(bytes: Buffer, validateReceipt: ReceiptValidator) {
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { operationId?: unknown }).operationId !== "string") {
    throw new Error("SEALED_RECEIPT_INVALID");
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.operationDigest !== "string") throw new Error("SEALED_RECEIPT_DIGEST_MISSING");
  const { operationDigest, ...core } = value;
  if (digest(canonicalize(core)) !== operationDigest) throw new Error("SEALED_RECEIPT_DIGEST_MISMATCH");
  return validateReceipt(parsed);
}

export type PrivateKwM2HtmlEvidenceReceiptStore = {
  loadSealed: (operationId: string) => Promise<PrivateKwM2WebsiteEvidenceReceipt | null>;
  publishSealed: (receipt: PrivateKwM2WebsiteEvidenceReceipt) => Promise<"CREATED" | "EXACT_REPLAY">;
};

export function createPrivateKwM2HtmlEvidenceReceiptStore(options: { validateReceipt: ReceiptValidator; rootPath?: string }): PrivateKwM2HtmlEvidenceReceiptStore {
  const root = resolveReceiptRoot(options.rootPath);
  return {
    async loadSealed(operationId) {
      if (!await assertSafeRoot(root, false)) return null;
      const file = operationPath(root, operationId);
      try {
        if (!await ensureSafeDirectoryChain(root, path.dirname(file), false)) return null;
        await assertSafeFile(file);
        const bytes = await readFile(file);
        const parsed = parseReceipt(bytes, options.validateReceipt);
        if (canonicalize(parsed) + "\n" !== bytes.toString("utf8")) throw new Error("SEALED_RECEIPT_BYTES_MISMATCH");
        if ((parsed as { operationId: string }).operationId !== operationId) throw new Error("SEALED_RECEIPT_OPERATION_ID_MISMATCH");
        return parsed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async publishSealed(receipt) {
      if (!receipt || typeof receipt !== "object" || typeof (receipt as { operationId?: unknown }).operationId !== "string" || typeof (receipt as { operationDigest?: unknown }).operationDigest !== "string") {
        throw new Error("SEALED_RECEIPT_INVALID");
      }
      const operationId = (receipt as { operationId: string }).operationId;
      operationPath(root, operationId);
      const bytes = Buffer.from(canonicalize(receipt) + "\n", "utf8");
      parseReceipt(bytes, options.validateReceipt);
      await assertSafeRoot(root, true);
      const file = operationPath(root, operationId);
      await ensureSafeDirectoryChain(root, path.dirname(file), true);
      try {
        const handle = await open(file, "wx");
        try {
          const opened = await handle.stat();
          const onPath = await lstat(file);
          if (opened.dev !== onPath.dev || opened.ino !== onPath.ino || !onPath.isFile()) throw new Error("UNSAFE_SEALED_RECEIPT_FILE_IDENTITY");
          await handle.writeFile(bytes);
        } finally {
          await handle.close();
        }
        await assertSafeFile(file);
        const published = parseReceipt(await readFile(file), options.validateReceipt);
        if (canonicalize(published) + "\n" !== bytes.toString("utf8")) throw new Error("SEALED_RECEIPT_BYTES_MISMATCH");
        return "CREATED";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await assertSafeFile(file);
        const existing = parseReceipt(await readFile(file), options.validateReceipt);
        if (canonicalize(existing) !== canonicalize(receipt)) throw new Error("SEALED_RECEIPT_CONFLICT");
        return "EXACT_REPLAY";
      }
    },
  };
}

export function privateKwM2ReceiptCanonicalDigest(value: unknown) {
  return digest(canonicalize(value));
}
