/**
 * Keys for the Claude connector (/api/mcp). A founder's Claude signs in with a private key, not the sign-in
 * cookie. Each founder can hold one key of each kind (migration 0092, EngineConnectorKey):
 *
 * - header: "axe_..." sent as `Authorization: Bearer axe_...` (Claude Code);
 * - link: "axel_..." that is part of the address `/api/mcp/k/<key>` (claude.ai custom connectors, which
 *   can't send a header).
 *
 * A link key is refused in the header and a header key is refused in the address. Only the SHA-256 of a key
 * is stored, so a key is seen once, when it is made. Making a new one replaces the old one of that kind at
 * once; turning it off deletes the row. Web Crypto only, so it runs the same on Workers and in Node tests.
 */
import { FOUNDERS } from "@/lib/outreach/outreach-model";
import type { ProspectDb } from "@/lib/revenue-engine/engine-prospects-d1";

export type Founder = (typeof FOUNDERS)[number];
export type KeyKind = "header" | "link";
export const KEY_KINDS: KeyKind[] = ["header", "link"];
export const KEY_PREFIX: Record<KeyKind, string> = { header: "axe_", link: "axel_" };
/** How often a key's "last used" time is written, at most. */
export const LAST_USED_EVERY_MS = 10 * 60_000;

export type KeyStatus = { exists: boolean; lastFour: string | null; createdAt: string | null; lastUsedAt: string | null };
export type KeysStatus = Record<KeyKind, KeyStatus>;

const KEY_SHAPE = /^axel?_[A-Za-z0-9_-]{24,128}$/;
export const isFounder = (name: unknown): name is Founder => typeof name === "string" && (FOUNDERS as readonly string[]).includes(name);

/** SHA-256 of a text, as 64 hex characters. */
export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 32 random URL-safe characters (24 random bytes). */
function randomPart() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Which kind a key claims to be, by its prefix, or null when it isn't shaped like a key at all. */
export function kindOfKey(key: string): KeyKind | null {
  if (!KEY_SHAPE.test(key)) return null;
  return key.startsWith(KEY_PREFIX.link) ? "link" : "header";
}

/** The key in an `Authorization: Bearer ...` header, or null. */
export function bearerKey(authorization: string | null | undefined) {
  return authorization?.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? null;
}

/** Makes a founder's key of one kind, replacing the old one at once. The key is returned this one time only. */
export async function makeKey(db: ProspectDb, founder: Founder, kind: KeyKind, now = new Date()) {
  const key = `${KEY_PREFIX[kind]}${randomPart()}`;
  await db.prepare(`INSERT INTO "EngineConnectorKey" ("founder","kind","keyHash","lastFour","createdAt","lastUsedAt") VALUES (?,?,?,?,?,NULL)
    ON CONFLICT("founder","kind") DO UPDATE SET "keyHash" = excluded."keyHash", "lastFour" = excluded."lastFour", "createdAt" = excluded."createdAt", "lastUsedAt" = NULL`)
    .bind(founder, kind, await sha256Hex(key), key.slice(-4), now.toISOString()).run();
  return key;
}

/**
 * The founder a key belongs to, or null. `kind` is where the key arrived (the header or the address): a key of
 * the other kind is refused without a look at the database.
 */
export async function founderForKey(db: ProspectDb, key: string | null | undefined, kind: KeyKind, now = new Date()): Promise<Founder | null> {
  if (!key || kindOfKey(key) !== kind) return null;
  const row = await db.prepare(`SELECT "founder","lastUsedAt" FROM "EngineConnectorKey" WHERE "keyHash" = ? AND "kind" = ?`).bind(await sha256Hex(key), kind)
    .first<{ founder: string; lastUsedAt: string | null }>();
  if (!row || !isFounder(row.founder)) return null;
  // For Settings: when the key was last used, written at most every 10 minutes.
  if (!row.lastUsedAt || Date.parse(row.lastUsedAt) < now.getTime() - LAST_USED_EVERY_MS) {
    await db.prepare(`UPDATE "EngineConnectorKey" SET "lastUsedAt" = ? WHERE "founder" = ? AND "kind" = ?`).bind(now.toISOString(), row.founder, kind).run();
  }
  return row.founder;
}

/** What Settings shows for a founder's two keys. Never the key or its hash. */
export async function keysStatus(db: ProspectDb, founder: Founder): Promise<KeysStatus> {
  const { results } = await db.prepare(`SELECT "kind","lastFour","createdAt","lastUsedAt" FROM "EngineConnectorKey" WHERE "founder" = ?`).bind(founder)
    .all<{ kind: string; lastFour: string | null; createdAt: string; lastUsedAt: string | null }>();
  const status = (kind: KeyKind): KeyStatus => {
    const row = results.find((item) => item.kind === kind);
    return { exists: Boolean(row), lastFour: row?.lastFour ?? null, createdAt: row?.createdAt ?? null, lastUsedAt: row?.lastUsedAt ?? null };
  };
  return { header: status("header"), link: status("link") };
}

/** Turns a founder's key of one kind off: the row is deleted, so the key stops working at once. */
export async function turnOffKey(db: ProspectDb, founder: Founder, kind: KeyKind) {
  await db.prepare(`DELETE FROM "EngineConnectorKey" WHERE "founder" = ? AND "kind" = ?`).bind(founder, kind).run();
}
