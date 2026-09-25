import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  lstatSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, symlinkSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import {
  assertSetupAbsent, assertSetupSidecarsAbsent, assertSetupTemp, createSetupTemp,
  inspectSetupSnapshot, readSetupFile, removeSetupTemp,
} from "./private-kw-m2-snapshot";

const osRoot = realpathSync(tmpdir());
const tempRootPrefix = `${osRoot}${path.sep}codex-m2-snapshot-`;

function createOwnedRoot() {
  const root = realpathSync(mkdtempSync(tempRootPrefix));
  if (!root.startsWith(osRoot + path.sep)) throw new Error("Snapshot test root escaped the OS temporary directory.");
  return root;
}

function removeOwnedRoot(root: string) {
  const resolved = realpathSync(root);
  if (!resolved.startsWith(osRoot + path.sep)) throw new Error("Snapshot test cleanup root escaped the OS temporary directory.");
  rmdirSync(resolved);
}

function makeCanonicalDatabase(file: string) {
  writeFileSync(file, Buffer.alloc(0), { flag: "wx" });
    const database = new Database(file, { fileMustExist: true });
    try {
      applyCanonicalPrivateKwMigrations(database);
      const lineageTable = database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'RevenuePrivateKwM2HtmlAssessmentLineage'").get() as { count: number };
      assert.equal(lineageTable.count, 0, "snapshot fixture must use the pre-0069 schema");
      database.exec("CREATE TABLE \"AuditLog\" (\"id\" INTEGER PRIMARY KEY, \"message\" TEXT NOT NULL)");
    database.prepare("INSERT INTO \"AuditLog\" (\"message\") VALUES (?)").run("initial");
  } finally { database.close(); }
}

function cleanupTemp(root: string, temp: ReturnType<typeof createSetupTemp>, proof?: ReturnType<typeof inspectSetupSnapshot>) {
  if (proof) removeSetupTemp(temp, proof);
  else {
    try { unlinkSync(temp.file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    rmdirSync(temp.directory);
  }
  removeOwnedRoot(root);
}

describe("private KW M2 snapshot helpers", () => {
  it("creates an absent exclusive private temp directory and removes its owned file", () => {
    const root = createOwnedRoot();
    const temp = createSetupTemp(root);
    try {
      assert.equal(path.dirname(temp.file), temp.directory);
      assertSetupTemp(temp);
      assertSetupAbsent(temp.file);
      assertSetupSidecarsAbsent(temp.file);
    } finally { cleanupTemp(root, temp); }
  });

  it("rejects unexpected files or sidecars and preserves the temp directory", () => {
    const root = createOwnedRoot();
    const temp = createSetupTemp(root);
    makeCanonicalDatabase(temp.file);
    const proof = inspectSetupSnapshot(temp.file);
    try {
      writeFileSync(path.join(temp.directory, "unexpected.sqlite"), "extra", { flag: "wx" });
      assert.throws(() => removeSetupTemp(temp, proof), /unexpected files/);
      unlinkSync(path.join(temp.directory, "unexpected.sqlite"));
      writeFileSync(`${temp.file}-wal`, "wal", { flag: "wx" });
      assert.throws(() => removeSetupTemp(temp, proof), /sidecars/);
      unlinkSync(`${temp.file}-wal`);
    } finally { cleanupTemp(root, temp, proof); }
  });

  it("rejects substituted temp file identity without deleting the replacement", () => {
    const root = createOwnedRoot();
    const temp = createSetupTemp(root);
    makeCanonicalDatabase(temp.file);
    const proof = inspectSetupSnapshot(temp.file);
    const replacement = path.join(temp.directory, `${randomBytes(16).toString("hex")}.replacement`);
    try {
      writeFileSync(replacement, "replacement", { flag: "wx" });
      unlinkSync(temp.file);
      writeFileSync(temp.file, readFileSync(replacement), { flag: "wx" });
      assert.throws(() => removeSetupTemp(temp, proof), /identity or contents changed/);
      assert.equal(lstatSync(temp.file).isFile(), true);
    } finally {
      try { unlinkSync(replacement); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      try { unlinkSync(temp.file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      rmdirSync(temp.directory);
      removeOwnedRoot(root);
    }
  });

  it("rejects a symlink destination without following or deleting its target", (testContext) => {
    const root = createOwnedRoot();
    const temp = createSetupTemp(root);
    const target = path.join(root, "target.sqlite");
    writeFileSync(target, "target", { flag: "wx" });
    try {
      try {
        symlinkSync(target, temp.file);
        assert.throws(() => readSetupFile(temp.file), /regular canonical/);
        assert.throws(() => removeSetupTemp(temp, { fileIdentity: readSetupFile(target).identity }), /regular canonical|identity/);
        assert.equal(readFileSync(target, "utf8"), "target");
        assert.equal(lstatSync(temp.file).isSymbolicLink(), true);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") { testContext.skip("symlinks are unavailable on this host"); return; }
        throw error;
      }
    } finally {
      try { unlinkSync(temp.file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      unlinkSync(target);
      rmdirSync(temp.directory);
      removeOwnedRoot(root);
    }
  });

  it("detects logical row changes and includes nonRevenue tables", () => {
    const root = createOwnedRoot();
    const temp = createSetupTemp(root);
    makeCanonicalDatabase(temp.file);
    try {
      const first = inspectSetupSnapshot(temp.file);
      assert.equal(first.rowCounts.AuditLog, 1);
      const database = new Database(temp.file);
      try { database.prepare("INSERT INTO \"AuditLog\" (\"message\") VALUES (?)").run("changed"); } finally { database.close(); }
      const second = inspectSetupSnapshot(temp.file);
      assert.equal(second.rowCounts.AuditLog, 2);
      assert.notEqual(second.contentDigest, first.contentDigest);
      removeSetupTemp(temp, second);
    } finally {
      try { rmdirSync(temp.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      removeOwnedRoot(root);
    }
  });
});
