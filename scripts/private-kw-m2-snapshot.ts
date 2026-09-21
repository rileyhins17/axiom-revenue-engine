import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, rmdirSync, unlinkSync,
} from "node:fs";
import type { BigIntStats } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { privateKwM2SetupDigest } from "../src/lib/revenue-engine/private-kw-m2-setup-release";
import { assertCanonicalPrivateKwRevenueSchema, assertPrivateKwSingleDatabase } from "./private-kw-database";

export type SetupFileIdentity = Readonly<{
  device: string; inode: string; byteLength: number; modificationMarker: string; sha256: string;
}>;
export type SetupSnapshot = Readonly<{
  fileIdentity: SetupFileIdentity;
  schemaDigest: string;
  contentDigest: string;
  rowCounts: Readonly<Record<string, number>>;
}>;

export function sameSetupInode(a: Pick<BigIntStats, "dev" | "ino">, b: Pick<BigIntStats, "dev" | "ino">) {
  return a.dev === b.dev && a.ino === b.ino;
}

export function assertSetupDirectory(directory: string, expected?: BigIntStats) {
  const stats = lstatSync(directory, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(directory) !== directory
    || (expected && !sameSetupInode(stats, expected))) throw new Error("M2 setup directory identity changed.");
  return stats;
}

export function assertSetupAbsent(file: string) {
  try { lstatSync(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("M2 setup requires an absent destination.");
}

export function assertSetupSidecarsAbsent(file: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { assertSetupAbsent(file + suffix); } catch {
      throw new Error("M2 setup database sidecars must be absent.");
    }
  }
}

/** Every hash is read from the same open file whose path and metadata are checked on both sides. */
export function readSetupFile(file: string, maxBytes = 512_000_000) {
  const before = lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || realpathSync(file) !== file
    || before.size > BigInt(maxBytes)) throw new Error("M2 setup requires a bounded regular canonical file.");
  const fd = openSync(file, "r");
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!sameSetupInode(before, opened)) throw new Error("M2 setup file identity changed before read.");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    const final = lstatSync(file, { bigint: true });
    if (!final.isFile() || final.isSymbolicLink() || realpathSync(file) !== file
      || !sameSetupInode(before, after) || !sameSetupInode(after, final)
      || before.size !== after.size || after.size !== final.size || after.size !== BigInt(bytes.length)
      || before.mtimeNs !== after.mtimeNs || after.mtimeNs !== final.mtimeNs
      || before.ctimeNs !== after.ctimeNs || after.ctimeNs !== final.ctimeNs) {
      throw new Error("M2 setup file changed during read.");
    }
    const identity: SetupFileIdentity = Object.freeze({
      device: after.dev.toString(), inode: after.ino.toString(), byteLength: bytes.length,
      modificationMarker: after.mtimeNs.toString(), sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    return { bytes, identity, stats: after };
  } finally { closeSync(fd); }
}

export function assertSetupFileUnchanged(file: string, expected: SetupFileIdentity) {
  const current = readSetupFile(file);
  if (privateKwM2SetupDigest(current.identity) !== privateKwM2SetupDigest(expected)) {
    throw new Error("M2 setup file identity or contents changed.");
  }
  return current;
}

function encodedCell(value: unknown): unknown {
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (Buffer.isBuffer(value)) return ["blob", value.toString("base64")];
  return [value === null ? "null" : typeof value, value];
}

/** Logical snapshot covers ALL tables and schema, including data outside the Revenue partition. */
export function inspectSetupSqlite(database: Database.Database, schema: "PRE_0069") {
  void schema;
  database.pragma("foreign_keys = ON");
  database.pragma("query_only = ON");
  assertPrivateKwSingleDatabase(database);
  if (database.pragma("integrity_check", { simple: true }) !== "ok"
    || (database.pragma("foreign_key_check") as unknown[]).length !== 0) throw new Error("M2 setup SQLite integrity check failed.");
  assertCanonicalPrivateKwRevenueSchema(database);
  const schemaRows = database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name, tbl_name').all() as {
    type: string; name: string; tbl_name: string; sql: string | null;
  }[];
  const revenueSchema = schemaRows.filter((row) => row.name.startsWith("Revenue") || row.tbl_name.startsWith("Revenue"));
  const tables: { name: string; rows: string[] }[] = [];
  const rowCounts: Record<string, number> = {};
  for (const row of schemaRows.filter((entry) => entry.type === "table")) {
    if (/^CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql ?? "")) throw new Error("M2 setup does not accept virtual tables.");
    const quoted = '"' + row.name.replaceAll('"', '""') + '"';
    const values = database.prepare(`SELECT * FROM ${quoted}`).raw().safeIntegers(true);
    const hashes: string[] = [];
    for (const cells of values.iterate() as Iterable<unknown[]>) {
      hashes.push(privateKwM2SetupDigest(cells.map(encodedCell)));
    }
    hashes.sort();
    rowCounts[row.name] = hashes.length;
    tables.push({ name: row.name, rows: hashes });
  }
  return {
    schemaDigest: privateKwM2SetupDigest(revenueSchema),
    contentDigest: privateKwM2SetupDigest({ schemaRows, tables }),
    rowCounts: Object.freeze(rowCounts),
  };
}

export function inspectSetupSnapshot(file: string): SetupSnapshot {
  assertSetupSidecarsAbsent(file);
  const before = readSetupFile(file);
  const database = new Database(file, { readonly: true, fileMustExist: true, timeout: 0 });
  let proof;
  try {
    database.exec("BEGIN");
    proof = inspectSetupSqlite(database, "PRE_0069");
  } finally { database.close(); }
  assertSetupSidecarsAbsent(file);
  assertSetupFileUnchanged(file, before.identity);
  return Object.freeze({ fileIdentity: before.identity, ...proof });
}

export type SetupTemp = Readonly<{ directory: string; file: string; directoryStats: BigIntStats }>;

export function createSetupTemp(root: string): SetupTemp {
  assertSetupDirectory(root);
  const directory = path.join(root, `.m2-setup-${randomBytes(32).toString("hex")}`);
  mkdirSync(directory, { mode: 0o700 }); // exclusive; no recursive creation or reuse
  const directoryStats = assertSetupDirectory(directory);
  const file = path.join(directory, randomBytes(32).toString("hex") + ".sqlite");
  assertSetupAbsent(file);
  return Object.freeze({ directory, file, directoryStats });
}

export function assertSetupTemp(temp: SetupTemp) {
  assertSetupDirectory(temp.directory, temp.directoryStats);
  if (path.dirname(temp.file) !== temp.directory) throw new Error("M2 setup temporary path escaped its private directory.");
}

/** Never recursively delete. On drift/partial backup, preserve files for inspection and fail. */
export function removeSetupTemp(temp: SetupTemp, proof: SetupSnapshot) {
  assertSetupTemp(temp);
  assertSetupSidecarsAbsent(temp.file);
  assertSetupFileUnchanged(temp.file, proof.fileIdentity);
  if (readdirSync(temp.directory).length !== 1) throw new Error("M2 setup temporary directory contains unexpected files.");
  unlinkSync(temp.file);
  assertSetupDirectory(temp.directory, temp.directoryStats);
  rmdirSync(temp.directory); // empty directory only
}
