import { createHash } from "node:crypto";

export function privateKwM2Canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(privateKwM2Canonicalize).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => JSON.stringify(key) + ":" + privateKwM2Canonicalize(object[key])).join(",") + "}";
}

export function privateKwM2Sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function privateKwM2ReceiptCanonicalDigest(value: unknown) {
  return privateKwM2Sha256(privateKwM2Canonicalize(value));
}
