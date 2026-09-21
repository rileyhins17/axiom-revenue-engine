import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

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

function operationPath(root: string, operationId: string) {
  return path.join(root, "sealed", "sha256", operationId.slice(0, 2), operationId + ".json");
}

function parseReceipt(bytes: Buffer) {
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { operationId?: unknown }).operationId !== "string") {
    throw new Error("SEALED_RECEIPT_INVALID");
  }
  return parsed;
}

export type PrivateKwM2HtmlEvidenceReceiptStore = {
  loadSealed: (operationId: string) => Promise<unknown | null>;
  publishSealed: (receipt: unknown) => Promise<"CREATED" | "EXACT_REPLAY">;
};

export function createPrivateKwM2HtmlEvidenceReceiptStore(options: { rootPath: string }): PrivateKwM2HtmlEvidenceReceiptStore {
  const root = path.resolve(options.rootPath);
  return {
    async loadSealed(operationId) {
      const file = operationPath(root, operationId);
      try {
        return parseReceipt(await readFile(file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async publishSealed(receipt) {
      if (!receipt || typeof receipt !== "object" || typeof (receipt as { operationId?: unknown }).operationId !== "string") {
        throw new Error("SEALED_RECEIPT_INVALID");
      }
      const operationId = (receipt as { operationId: string }).operationId;
      const bytes = Buffer.from(canonicalize(receipt) + "\n", "utf8");
      const file = operationPath(root, operationId);
      await mkdir(path.dirname(file), { recursive: true });
      try {
        const handle = await open(file, "wx");
        try {
          await handle.writeFile(bytes);
        } finally {
          await handle.close();
        }
        return "CREATED";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = parseReceipt(await readFile(file));
        if (canonicalize(existing) !== canonicalize(receipt)) throw new Error("SEALED_RECEIPT_CONFLICT");
        return "EXACT_REPLAY";
      }
    },
  };
}

export function privateKwM2ReceiptCanonicalDigest(value: unknown) {
  return digest(canonicalize(value));
}
