import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Database from "better-sqlite3";

type RehearsalInput = { exportPath: string; expectedSha256: string; repositoryRoot: string };
type RehearsalResult = Record<string, unknown>;
async function rehearseStagingSqlExport(input: RehearsalInput) {
  const modulePath = "./rehearse-staging-sql-export";
  const loaded = await import(modulePath).catch(() => undefined) as
    | { rehearseStagingSqlExport?: (input: RehearsalInput) => Promise<RehearsalResult> }
    | undefined;
  assert.equal(typeof loaded?.rehearseStagingSqlExport, "function", "the offline staging export rehearsal API must exist");
  return loaded!.rehearseStagingSqlExport!(input);
}

const migrationRoot = new URL("../migrations/", import.meta.url);
const migrationsDirectory = fileURLToPath(migrationRoot);
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

function sqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value));
    return String(value);
  }
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  throw new Error(`Unsupported fixture SQLite value: ${typeof value}`);
}

function syntheticStagingExport(stopEnabled = 0) {
  const database = new Database(":memory:");
  try {
    database.pragma("foreign_keys = ON");
    const baseline = migrationFiles.filter((name) => name.slice(0, 4) <= "0055");
    assert.equal(baseline.length, 55);
    for (const name of baseline) database.exec(readFileSync(path.join(migrationsDirectory, name), "utf8"));

    database.exec(`
      CREATE TABLE "d1_migrations" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT UNIQUE,
        "applied_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
    const addMigration = database.prepare(`INSERT INTO "d1_migrations" ("name") VALUES (?)`);
    for (const name of baseline) addMigration.run(name);
    database.exec(`
      INSERT INTO "User" ("id", "name", "email", "role", "updatedAt")
      VALUES ('fixture-admin', 'Fixture Admin', 'owner@example.test', 'admin', '2026-09-23T00:00:00.000Z');
      UPDATE "OutreachAutomationSetting"
      SET "enabled" = ${stopEnabled}, "globalPaused" = 1, "emergencyPaused" = 1, "intakePaused" = 1, "followUpsPaused" = 1
      WHERE "id" = 'global';
      INSERT INTO "RevenueBusiness" ("id", "canonicalName", "normalizedDomain")
      VALUES ('fixture-business-1', 'Fixture Heating', 'example.test'),
             ('fixture-business-2', 'Fixture Roofing', 'example.org');
      INSERT INTO "RevenueContactPoint"
        ("id", "businessId", "channel", "value", "sourceUrl", "sourceCapturedAt", "automationPermitted")
      VALUES ('fixture-contact-1', 'fixture-business-1', 'EMAIL', 'info@example.test',
              'https://example.test/contact', '2026-09-23T00:00:00.000Z', 0),
             ('fixture-contact-2', 'fixture-business-2', 'EMAIL', 'info@example.org',
              'https://example.org/contact', '2026-09-23T00:00:00.000Z', 0);
      INSERT INTO "RevenueVerificationResult"
        ("id", "contactPointId", "provider", "status", "verifiedAt")
      VALUES ('fixture-verification', 'fixture-contact-1', 'FIXTURE', 'UNKNOWN', '2026-09-23T00:00:00.000Z');
      INSERT INTO "RevenueWebsiteSnapshot"
        ("id", "businessId", "url", "classification", "auditVersion", "capturedAt", "refreshAfter")
      VALUES ('fixture-website', 'fixture-business-1', 'https://example.test/', 'UNKNOWN', 'fixture-v1',
              '2026-09-23T00:00:00.000Z', '2026-10-23T00:00:00.000Z');
      INSERT INTO "RevenueEvidenceClaim"
        ("id", "businessId", "websiteSnapshotId", "category", "observation", "sourceUrl", "method", "confidence", "auditVersion", "capturedAt")
      VALUES ('fixture-claim', 'fixture-business-1', 'fixture-website', 'WEBSITE', 'Fixture observation',
              'https://example.test/', 'OWNER_REVIEW', 50, 'fixture-v1', '2026-09-23T00:00:00.000Z');
      INSERT INTO "RevenueQualificationSnapshot"
        ("id", "snapshotKey", "businessId", "policyVersion", "totalScore", "rebuildNeedScore", "businessFitScore", "reachabilityScore", "timingScore", "evidenceConfidenceScore", "band", "recommendedChannel", "supportedObservationCount", "conversionCriticalCount")
      VALUES ('fixture-qualification', 'fixture-key', 'fixture-business-1', 'fixture-v1',
              0, 0, 0, 0, 0, 0, 'UNKNOWN', 'NONE', 0, 0);
    `);
    assert.deepEqual(database.pragma("foreign_key_check"), []);

    const objects = database.prepare(`
      SELECT "type", "name", "sql" FROM "sqlite_master"
      WHERE "type" IN ('table','index','view','trigger')
        AND "name" NOT LIKE 'sqlite_%' AND "sql" IS NOT NULL
      ORDER BY CASE "type" WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, "name"
    `).all() as Array<{ type: string; name: string; sql: string }>;
    const tableNames = objects.filter((object) => object.type === "table").map((object) => object.name);
    const statements = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;", ...objects
      .filter((object) => object.type === "table" || object.type === "view")
      .map((object) => `${object.sql};`)];
    for (const tableName of tableNames) {
      const columns = database.pragma(`table_info(${JSON.stringify(tableName)})`) as Array<{ name: string }>;
      const columnSql = columns.map((column) => `"${column.name.replaceAll('"', '""')}"`).join(", ");
      const rows = database.prepare(`SELECT ${columnSql} FROM "${tableName.replaceAll('"', '""')}"`).all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        statements.push(`INSERT INTO "${tableName.replaceAll('"', '""')}" (${columnSql}) VALUES (${columns.map((column) => sqlLiteral(row[column.name])).join(",")});`);
      }
    }
    statements.push(...objects
      .filter((object) => object.type === "index" || object.type === "trigger")
      .map((object) => `${object.sql};`));
    statements.push("COMMIT;", "PRAGMA foreign_keys=ON;");
    return statements.join("\n");
  } finally {
    database.close();
  }
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

async function withSyntheticExport(sql: string, callback: (input: { repositoryRoot: string; exportPath: string; directory: string }) => Promise<void> | void) {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "staging-sql-rehearsal-"));
  writeFileSync(path.join(repositoryRoot, ".gitignore"), "/backups/\n", { flag: "wx" });
  cpSync(migrationsDirectory, path.join(repositoryRoot, "migrations"), { recursive: true });
  const directory = path.join(repositoryRoot, "backups", "staging");
  mkdirSync(directory, { recursive: true });
  const exportPath = path.join(directory, "synthetic-export.sql");
  writeFileSync(exportPath, sql, { flag: "wx" });
  try {
    await callback({ repositoryRoot, exportPath, directory });
  } finally {
    const resolvedRoot = path.resolve(repositoryRoot);
    const tempRoot = path.resolve(tmpdir());
    assert.ok(path.relative(tempRoot, resolvedRoot) && !path.relative(tempRoot, resolvedRoot).startsWith(".."));
    rmSync(resolvedRoot, { recursive: true, force: true });
  }
}

test("rehearses the exact staging export offline and reports metadata without writing output", async () => {
  const sql = syntheticStagingExport();
  await withSyntheticExport(sql, async ({ repositoryRoot, exportPath, directory }) => {
    const before = readdirSync(directory).sort();
    const result = await rehearseStagingSqlExport({ exportPath, expectedSha256: sha256(sql), repositoryRoot });
    assert.equal(result.status, "PASS");
    assert.equal(result.exportSha256, sha256(sql));
    assert.equal(result.baselineMigrationCount, 55);
    assert.equal(result.finalMigrationCount, 74);
    assert.equal(result.appliedMigrationCount, 19);
    assert.equal(result.originalRowsPreserved, true);
    assert.equal(result.stopsEngaged, true);
    assert.equal(result.foreignKeyViolationsBefore, 0);
    assert.equal(result.foreignKeyViolationsAfter, 0);
    assert.equal(result.integrityBefore, "ok");
    assert.equal(result.integrityAfter, "ok");
    assert.deepEqual(readdirSync(directory).sort(), before, "the rehearsal must not create or overwrite an output file");
  });
});

test("rejects an export whose bytes do not match the supplied SHA-256 before SQL execution", async () => {
  await withSyntheticExport("THIS IS NOT SQL", async ({ repositoryRoot, exportPath }) => {
    await assert.rejects(
      rehearseStagingSqlExport({ exportPath, expectedSha256: "0".repeat(64), repositoryRoot }),
      (error: unknown) => (error as { code?: string }).code === "EXPORT_SHA256_MISMATCH",
    );
  });
});

test("rejects a non-exact 0055 migration ledger", async () => {
  const sql = syntheticStagingExport().replace("0055_outreach_human_approval.sql", "0055_wrong_migration.sql");
  await withSyntheticExport(sql, async ({ repositoryRoot, exportPath }) => {
    await assert.rejects(
      rehearseStagingSqlExport({ exportPath, expectedSha256: sha256(sql), repositoryRoot }),
      (error: unknown) => (error as { code?: string }).code === "MIGRATION_LEDGER_MISMATCH",
    );
  });
});

test("rejects staging databases whose required stop flags are not engaged", async () => {
  const sql = syntheticStagingExport(1);
  await withSyntheticExport(sql, async ({ repositoryRoot, exportPath }) => {
    await assert.rejects(
      rehearseStagingSqlExport({ exportPath, expectedSha256: sha256(sql), repositoryRoot }),
      (error: unknown) => (error as { code?: string }).code === "STAGING_STOPS_NOT_ENGAGED",
    );
  });
});

test("rejects export paths outside ignored backups/staging", async () => {
  const sql = syntheticStagingExport();
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "staging-sql-rehearsal-outside-"));
  writeFileSync(path.join(repositoryRoot, ".gitignore"), "/backups/\n", { flag: "wx" });
  const exportPath = path.join(repositoryRoot, "elsewhere.sql");
  writeFileSync(exportPath, sql, { flag: "wx" });
  try {
    await assert.rejects(
      rehearseStagingSqlExport({ exportPath, expectedSha256: sha256(sql), repositoryRoot }),
      (error: unknown) => (error as { code?: string }).code === "EXPORT_PATH_OUTSIDE_STAGING_BACKUPS",
    );
  } finally {
    const resolvedRoot = path.resolve(repositoryRoot);
    const tempRoot = path.resolve(tmpdir());
    assert.ok(path.relative(tempRoot, resolvedRoot) && !path.relative(tempRoot, resolvedRoot).startsWith(".."));
    rmSync(resolvedRoot, { recursive: true, force: true });
  }
});

test("rejects a symlinked SQL export", async (t) => {
  const sql = syntheticStagingExport();
  await withSyntheticExport(sql, async ({ repositoryRoot, exportPath, directory }) => {
    const linkPath = path.join(directory, "linked-export.sql");
    try {
      symlinkSync(exportPath, linkPath, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM" || (error as NodeJS.ErrnoException).code === "ENOTSUP") {
        t.skip("the current Windows host does not permit creating a file symlink");
        return;
      }
      throw error;
    }
    await assert.rejects(
      rehearseStagingSqlExport({ exportPath: linkPath, expectedSha256: sha256(sql), repositoryRoot }),
      (error: unknown) => (error as { code?: string }).code === "EXPORT_PATH_SYMLINK",
    );
  });
});
