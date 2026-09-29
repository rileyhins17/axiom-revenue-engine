import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { PRIVATE_KW_EVIDENCE_ROOT } from "@/lib/revenue-engine/private-kw-local-html-evidence-store";
import { PrivateKwM2WebsiteEvidenceReceiptSchema, type PrivateKwM2WebsiteEvidenceReceipt } from "@/lib/revenue-engine/private-kw-m2-html-evidence-schema";
import { privateKwM2Canonicalize, privateKwM2ReceiptCanonicalDigest } from "@/lib/revenue-engine/private-kw-m2-canonical";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_ROOT = /^m2-receipt-test-[a-z0-9-]+$/;
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

async function readVerifiedReceipt(file: string) {
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat();
    const before = await lstat(file);
    if (!opened.isFile() || !before.isFile() || before.isSymbolicLink() || opened.dev !== before.dev || opened.ino !== before.ino || await realpath(file) !== path.resolve(file)) {
      throw new Error("UNSAFE_SEALED_RECEIPT_FILE_IDENTITY");
    }
    const bytes = await handle.readFile();
    const after = await lstat(file);
    if (!after.isFile() || after.isSymbolicLink() || opened.dev !== after.dev || opened.ino !== after.ino || await realpath(file) !== path.resolve(file)) {
      throw new Error("UNSAFE_SEALED_RECEIPT_FILE_IDENTITY");
    }
    return { bytes, parsed: parseReceipt(bytes) };
  } finally {
    await handle.close();
  }
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

function parseReceipt(bytes: Buffer) {
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { operationId?: unknown }).operationId !== "string") {
    throw new Error("SEALED_RECEIPT_INVALID");
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.operationDigest !== "string") throw new Error("SEALED_RECEIPT_DIGEST_MISSING");
  const { operationDigest, ...core } = value;
  if (privateKwM2ReceiptCanonicalDigest(core) !== operationDigest) throw new Error("SEALED_RECEIPT_DIGEST_MISMATCH");
  return PrivateKwM2WebsiteEvidenceReceiptSchema.parse(parsed);
}

export type PrivateKwM2HtmlEvidenceReceiptStore = {
  loadSealed: (operationId: string) => Promise<PrivateKwM2WebsiteEvidenceReceipt | null>;
  publishSealed: (receipt: PrivateKwM2WebsiteEvidenceReceipt) => Promise<"CREATED" | "EXACT_REPLAY">;
};

export function createPrivateKwM2HtmlEvidenceReceiptStore(options: { rootPath?: string } = {}): PrivateKwM2HtmlEvidenceReceiptStore {
  const root = resolveReceiptRoot(options.rootPath);
  return {
    async loadSealed(operationId) {
      if (!await assertSafeRoot(root, false)) return null;
      const file = operationPath(root, operationId);
      try {
        if (!await ensureSafeDirectoryChain(root, path.dirname(file), false)) return null;
        const { bytes, parsed } = await readVerifiedReceipt(file);
        if (privateKwM2Canonicalize(parsed) + "\n" !== bytes.toString("utf8")) throw new Error("SEALED_RECEIPT_BYTES_MISMATCH");
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
      const bytes = Buffer.from(privateKwM2Canonicalize(receipt) + "\n", "utf8");
      parseReceipt(bytes);
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
        const { bytes: publishedBytes, parsed: published } = await readVerifiedReceipt(file);
        if (privateKwM2Canonicalize(published) + "\n" !== publishedBytes.toString("utf8") || publishedBytes.toString("utf8") !== bytes.toString("utf8")) throw new Error("SEALED_RECEIPT_BYTES_MISMATCH");
        return "CREATED";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const { parsed: existing } = await readVerifiedReceipt(file);
        if (privateKwM2Canonicalize(existing) !== privateKwM2Canonicalize(receipt)) throw new Error("SEALED_RECEIPT_CONFLICT");
        return "EXACT_REPLAY";
      }
    },
  };
}

export { privateKwM2ReceiptCanonicalDigest } from "@/lib/revenue-engine/private-kw-m2-canonical";
