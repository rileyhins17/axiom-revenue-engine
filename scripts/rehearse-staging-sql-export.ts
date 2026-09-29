import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const MIGRATION_START = 56;
const MIGRATION_END = 74;
const EXPECTED_BASELINE_COUNT = 55;
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const EXPECTED_STOPS = {
  enabled: 0,
  globalPaused: 1,
  emergencyPaused: 1,
  intakePaused: 1,
  followUpsPaused: 1,
} as const;

export class StagingRehearsalError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StagingRehearsalError";
  }
}

export type StagingSqlRehearsalResult = {
  schema: "staging-d1-upgrade-rehearsal/v1";
  status: "PASS";
  exportSha256: string;
  exportBytes: number;
  baselineMigrationCount: number;
  baselineLastMigration: string;
  appliedMigrationCount: number;
  finalMigrationCount: number;
  finalLastMigration: string;
  migrationHashes: ReadonlyArray<{ name: string; sha256: string }>;
  originalTableCount: number;
  originalRowCount: number;
  originalRowsPreserved: true;
  stopsEngaged: true;
  foreignKeyViolationsBefore: 0;
  foreignKeyViolationsAfter: 0;
  integrityBefore: "ok";
  integrityAfter: "ok";
};

type ExportPathOptions = {
  exportPath: string;
  expectedSha256: string;
  /** Test-only repository root override; CLI callers always use this script's repository. */
  repositoryRoot?: string;
};

type MigrationFile = { name: string; sql: string; sha256: string };
type SqlStatement = { kind: "table" | "insert" | "index" | "trigger"; sql: string };
type SnapshotTable = { name: string; columns: string[]; rows: string[]; count: number };

function fail(code: string): never {
  throw new StagingRehearsalError(code);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function repositoryRootFromScript(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function assertIgnoredStagingExportPath(exportPathValue: string, repositoryRoot: string): string {
  if (!path.isAbsolute(exportPathValue)) fail("EXPORT_PATH_MUST_BE_ABSOLUTE");
  const root = path.resolve(repositoryRoot);
  const stagingDirectory = path.resolve(root, "backups", "staging");
  const exportPath = path.resolve(exportPathValue);
  if (!isWithin(stagingDirectory, exportPath)) fail("EXPORT_PATH_OUTSIDE_STAGING_BACKUPS");

  const ignoreFile = path.join(root, ".gitignore");
  let ignoreText: string;
  try {
    ignoreText = readFileSync(ignoreFile, "utf8");
  } catch {
    fail("STAGING_BACKUPS_NOT_CONFIRMED_IGNORED");
  }
  if (!/^\s*\/backups\/\s*$/m.test(ignoreText)) fail("STAGING_BACKUPS_NOT_CONFIRMED_IGNORED");

  const relative = path.relative(root, exportPath).split(path.sep).filter(Boolean);
  let current = root;
  for (const [index, component] of relative.entries()) {
    current = path.join(current, component);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      fail(index === relative.length - 1 ? "EXPORT_FILE_NOT_FOUND" : "EXPORT_DIRECTORY_NOT_FOUND");
    }
    if (stat.isSymbolicLink()) fail("EXPORT_PATH_SYMLINK");
    if (index < relative.length - 1 && !stat.isDirectory()) fail("EXPORT_PATH_NOT_DIRECTORY");
    if (index === relative.length - 1 && !stat.isFile()) fail("EXPORT_FILE_NOT_REGULAR");
  }

  let resolvedExport: string;
  try {
    resolvedExport = realpathSync.native(exportPath);
  } catch {
    fail("EXPORT_FILE_NOT_FOUND");
  }
  if (path.resolve(resolvedExport) !== exportPath) fail("EXPORT_PATH_SYMLINK");
  return exportPath;
}

function readPinnedExport(exportPath: string, expectedSha256: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) fail("EXPECTED_SHA256_INVALID");
  let initialStat;
  try {
    initialStat = lstatSync(exportPath);
  } catch {
    fail("EXPORT_FILE_NOT_FOUND");
  }
  if (initialStat.isSymbolicLink()) fail("EXPORT_PATH_SYMLINK");
  if (!initialStat.isFile()) fail("EXPORT_FILE_NOT_REGULAR");
  if (initialStat.size < 1 || initialStat.size > MAX_EXPORT_BYTES) fail("EXPORT_SIZE_OUT_OF_RANGE");

  let descriptor: number;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    descriptor = openSync(exportPath, constants.O_RDONLY | noFollow);
  } catch {
    fail("EXPORT_FILE_OPEN_FAILED");
  }
  let content: Buffer;
  try {
    const openedStat = fstatSync(descriptor);
    if (!openedStat.isFile() || openedStat.dev !== initialStat.dev || openedStat.ino !== initialStat.ino) {
      fail("EXPORT_FILE_IDENTITY_CHANGED");
    }
    content = readFileSync(descriptor);
    const completedStat = fstatSync(descriptor);
    const pathStat = lstatSync(exportPath);
    if (completedStat.size !== initialStat.size || completedStat.mtimeMs !== initialStat.mtimeMs
      || completedStat.ino !== initialStat.ino || pathStat.isSymbolicLink()
      || pathStat.dev !== initialStat.dev || pathStat.ino !== initialStat.ino) {
      fail("EXPORT_FILE_CHANGED_DURING_READ");
    }
  } catch (error) {
    if (error instanceof StagingRehearsalError) throw error;
    fail("EXPORT_FILE_READ_FAILED");
  } finally {
    closeSync(descriptor);
  }
  if (sha256(content) !== expectedSha256.toLowerCase()) fail("EXPORT_SHA256_MISMATCH");
  return content;
}

function skipSpaceAndComments(source: string, initial: number): number {
  let index = initial;
  while (index < source.length) {
    if (/\s/.test(source[index]!)) {
      index++;
      continue;
    }
    if (source.startsWith("--", index)) {
      const newline = source.indexOf("\n", index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) fail("EXPORT_SQL_INVALID");
      index = end + 2;
      continue;
    }
    break;
  }
  return index;
}

function statementStartsWithTrigger(source: string, start: number): boolean {
  const index = skipSpaceAndComments(source, start);
  return /^CREATE\s+TRIGGER\b/i.test(source.slice(index));
}

function splitExportStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "single" | "double" | "backtick" | "bracket" | null = null;
  let lineComment = false;
  let blockComment = false;
  let triggerStatement = false;
  let triggerDepth = 0;
  let caseDepth = 0;

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      const closing = quote === "single" ? "'" : quote === "double" ? '"' : quote === "backtick" ? "`" : "]";
      if (char === closing) {
        if (next === closing && quote !== "bracket") index++;
        else quote = null;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === "'") { quote = "single"; continue; }
    if (char === '"') { quote = "double"; continue; }
    if (char === "`") { quote = "backtick"; continue; }
    if (char === "[") { quote = "bracket"; continue; }

    if (index === skipSpaceAndComments(source, start)) triggerStatement = statementStartsWithTrigger(source, start);
    if (triggerStatement && /[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z_0-9]/.test(source[end]!)) end++;
      const word = source.slice(index, end).toUpperCase();
      if (word === "BEGIN") triggerDepth++;
      else if (word === "CASE") caseDepth++;
      else if (word === "END") {
        if (caseDepth > 0) caseDepth--;
        else if (triggerDepth > 0) triggerDepth--;
      }
      index = end - 1;
      continue;
    }
    if (char === ";" && (!triggerStatement || (triggerDepth === 0 && caseDepth === 0))) {
      const statement = source.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
      triggerStatement = false;
    }
  }
  if (quote || blockComment) fail("EXPORT_SQL_INVALID");
  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function stripLeadingComments(statement: string): string {
  const index = skipSpaceAndComments(statement, 0);
  return statement.slice(index).trim();
}

function maskStringsAndComments(statement: string): string {
  let output = "";
  let quote: "single" | "double" | "backtick" | "bracket" | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < statement.length; index++) {
    const char = statement[index]!;
    const next = statement[index + 1];
    if (lineComment) {
      output += char === "\n" ? "\n" : " ";
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      output += " ";
      if (char === "*" && next === "/") {
        output += " ";
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      output += " ";
      const closing = quote === "single" ? "'" : quote === "double" ? '"' : quote === "backtick" ? "`" : "]";
      if (char === closing) {
        if (next === closing && quote !== "bracket") {
          output += " ";
          index++;
        } else quote = null;
      }
      continue;
    }
    if (char === "-" && next === "-") { output += "  "; lineComment = true; index++; continue; }
    if (char === "/" && next === "*") { output += "  "; blockComment = true; index++; continue; }
    if (char === "'") { output += " "; quote = "single"; continue; }
    if (char === '"') { output += " "; quote = "double"; continue; }
    if (char === "`") { output += " "; quote = "backtick"; continue; }
    if (char === "[") { output += " "; quote = "bracket"; continue; }
    output += char;
  }
  return output;
}

function classifyExportStatement(statementValue: string): SqlStatement | null {
  const statement = stripLeadingComments(statementValue);
  if (!statement) return null;
  const code = maskStringsAndComments(statement).trim();
  if (/^PRAGMA\s+(?:foreign_keys|defer_foreign_keys)\s*=\s*(?:ON|OFF|TRUE|FALSE|0|1)\s*;?$/i.test(code)) return null;
  if (/^(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|END)\s*;?$/i.test(code)) return null;
  if (/^CREATE\s+VIRTUAL\s+TABLE\b/i.test(code)) fail("EXPORT_SQL_UNSUPPORTED_STATEMENT");
  if (/^CREATE\s+TABLE\b/i.test(code)) return { kind: "table", sql: statement };
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(code)) return { kind: "index", sql: statement };
  if (/^CREATE\s+TRIGGER\b/i.test(code)) return { kind: "trigger", sql: statement };
  if (/^INSERT(?:\s+OR\s+(?:ABORT|FAIL|IGNORE|REPLACE|ROLLBACK))?\s+INTO\b/i.test(code)) {
    if (/\b(?:SELECT|WITH|RETURNING|ATTACH|DETACH|VACUUM|LOAD_EXTENSION|READFILE|WRITEFILE)\b/i.test(code)) {
      fail("EXPORT_SQL_UNSUPPORTED_STATEMENT");
    }
    return { kind: "insert", sql: statement };
  }
  fail("EXPORT_SQL_UNSUPPORTED_STATEMENT");
}

function parseSafeExportStatements(sql: string): SqlStatement[] {
  if (sql.includes("\u0000")) fail("EXPORT_SQL_INVALID");
  return splitExportStatements(sql).map(classifyExportStatement).filter((statement): statement is SqlStatement => statement !== null);
}

function migrationFiles(repositoryRoot: string): MigrationFile[] {
  const directory = path.join(repositoryRoot, "migrations");
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name));
  } catch {
    fail("MIGRATIONS_NOT_FOUND");
  }
  const byNumber = new Map<number, string>();
  for (const name of names) {
    const number = Number(name.slice(0, 4));
    if (number >= MIGRATION_START && number <= MIGRATION_END) {
      if (byNumber.has(number)) fail("MIGRATION_SET_NOT_CANONICAL");
      byNumber.set(number, name);
    }
  }
  if (byNumber.size !== MIGRATION_END - MIGRATION_START + 1) fail("MIGRATION_SET_NOT_CANONICAL");

  const files: MigrationFile[] = [];
  for (let number = MIGRATION_START; number <= MIGRATION_END; number++) {
    const name = byNumber.get(number);
    if (!name) fail("MIGRATION_SET_NOT_CANONICAL");
    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(directory, name));
    } catch {
      fail("MIGRATION_READ_FAILED");
    }
    files.push({ name, sql: bytes.toString("utf8"), sha256: sha256(bytes) });
  }
  return files;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableNames(database: Database.Database): string[] {
  return (database.prepare(`
    SELECT "name" FROM "sqlite_master"
    WHERE "type" = 'table' AND "name" NOT LIKE 'sqlite_%'
    ORDER BY "name"
  `).all() as Array<{ name: string }>).map(({ name }) => name);
}

function rowFingerprint(rows: Array<Record<string, unknown>>, columns: string[]): string[] {
  const encoded = rows.map((row) => JSON.stringify(columns.map((column) => {
    const value = row[column];
    if (value === null) return ["null", null];
    if (typeof value === "bigint") return ["integer", value.toString()];
    if (typeof value === "number") return [Number.isInteger(value) ? "integer-number" : "real", value];
    if (typeof value === "string") return ["text", value];
    if (Buffer.isBuffer(value)) return ["blob", value.toString("hex")];
    fail("DATABASE_VALUE_TYPE_UNSUPPORTED");
  })));
  return encoded.sort();
}

function snapshotTables(database: Database.Database): Map<string, SnapshotTable> {
  const snapshots = new Map<string, SnapshotTable>();
  for (const name of tableNames(database)) {
    const columns = (database.pragma(`table_info(${quoteIdentifier(name)})`) as Array<{ name: string }>).map(({ name: column }) => column);
    if (columns.length === 0) fail("DATABASE_TABLE_HAS_NO_COLUMNS");
    const rows = database.prepare(`SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(name)}`).all() as Array<Record<string, unknown>>;
    snapshots.set(name, { name, columns, rows: rowFingerprint(rows, columns), count: rows.length });
  }
  return snapshots;
}

function assertOriginalRowsPreserved(database: Database.Database, snapshots: Map<string, SnapshotTable>): number {
  let total = 0;
  for (const snapshot of snapshots.values()) {
    const currentColumns = (database.pragma(`table_info(${quoteIdentifier(snapshot.name)})`) as Array<{ name: string }>).map(({ name }) => name);
    if (!snapshot.columns.every((column) => currentColumns.includes(column))) fail("ORIGINAL_TABLE_COLUMNS_CHANGED");
    const rows = database.prepare(
      `SELECT ${snapshot.columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(snapshot.name)}`,
    ).all() as Array<Record<string, unknown>>;
    const currentFingerprints = rowFingerprint(rows, snapshot.columns);
    if (snapshot.name === "d1_migrations") {
      if (rows.length !== snapshot.count + (MIGRATION_END - MIGRATION_START + 1)
        || snapshot.rows.some((row) => !currentFingerprints.includes(row))) fail("ORIGINAL_MIGRATION_RECEIPTS_CHANGED");
    } else if (currentFingerprints.length !== snapshot.rows.length
      || currentFingerprints.some((row, index) => row !== snapshot.rows[index])) {
      fail("ORIGINAL_ROWS_CHANGED");
    }
    total += snapshot.count;
  }
  return total;
}

function migrationLedger(database: Database.Database): string[] {
  const columns = database.pragma('table_info("d1_migrations")') as Array<{ name: string }>;
  const columnNames = new Set(columns.map(({ name }) => name));
  if (!columnNames.has("id") || !columnNames.has("name")) fail("MIGRATION_LEDGER_INVALID");
  const rows = database.prepare(`SELECT "name" FROM "d1_migrations" ORDER BY "id"`).all() as Array<{ name: unknown }>;
  if (rows.some((row) => typeof row.name !== "string")) fail("MIGRATION_LEDGER_INVALID");
  return rows.map(({ name }) => name as string);
}

function assertStopsEngaged(database: Database.Database): void {
  const columns = database.pragma('table_info("OutreachAutomationSetting")') as Array<{ name: string }>;
  const columnNames = new Set(columns.map(({ name }) => name));
  if (Object.keys(EXPECTED_STOPS).some((name) => !columnNames.has(name))) fail("STAGING_STOP_SETTINGS_INVALID");
  const rows = database.prepare(`
    SELECT "enabled", "globalPaused", "emergencyPaused", "intakePaused", "followUpsPaused"
    FROM "OutreachAutomationSetting"
  `).all() as Array<Record<keyof typeof EXPECTED_STOPS, unknown>>;
  if (rows.length !== 1 || Object.entries(EXPECTED_STOPS).some(([name, expected]) => {
    const actual = rows[0]?.[name as keyof typeof EXPECTED_STOPS];
    if (rows.length !== 1) return true;
    return actual !== expected && actual !== BigInt(expected);
  })) {
    fail("STAGING_STOPS_NOT_ENGAGED");
  }
}

function integrityCheck(database: Database.Database): "ok" {
  const rows = database.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
  if (rows.length !== 1 || Object.values(rows[0] ?? {})[0] !== "ok") fail("DATABASE_INTEGRITY_FAILED");
  return "ok";
}

function foreignKeyViolationCount(database: Database.Database): number {
  return (database.prepare("PRAGMA foreign_key_check").all() as unknown[]).length;
}

function applyMigrations(database: Database.Database, migrations: MigrationFile[]): void {
  const recordApplied = database.prepare(`INSERT INTO "d1_migrations" ("name") VALUES (?)`);
  for (const migration of migrations) {
    try {
      database.transaction(() => {
        database.exec(migration.sql);
        recordApplied.run(migration.name);
      }).immediate();
    } catch {
      fail("MIGRATION_REHEARSAL_FAILED");
    }
  }
}

/**
 * Replays one checksum-pinned Cloudflare D1 SQL export in disposable in-memory
 * SQLite. The export is read-only on disk; this API creates no files and has
 * no Cloudflare, network, provider, stdout, or database-binding dependency.
 */
export async function rehearseStagingSqlExport(options: ExportPathOptions): Promise<StagingSqlRehearsalResult> {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? repositoryRootFromScript());
  const exportPath = assertIgnoredStagingExportPath(options.exportPath, repositoryRoot);
  const exportBytes = readPinnedExport(exportPath, options.expectedSha256);
  const exportSql = exportBytes.toString("utf8");
  const parsedExport = parseSafeExportStatements(exportSql);
  const migrations = migrationFiles(repositoryRoot);
  const baseline = migrationFilesBefore55(repositoryRoot);
  if (baseline.length !== EXPECTED_BASELINE_COUNT
    || baseline.some((migration, index) => Number(migration.name.slice(0, 4)) !== index + 1)
    || baseline.at(-1)?.name !== "0055_outreach_human_approval.sql") {
    fail("BASELINE_MIGRATION_SET_NOT_CANONICAL");
  }

  const database = new Database(":memory:");
  try {
    database.defaultSafeIntegers(true);
    database.pragma("trusted_schema = OFF");
    database.pragma("foreign_keys = OFF");
    for (const statement of parsedExport.filter(({ kind }) => kind === "table")) database.exec(statement.sql);
    for (const statement of parsedExport.filter(({ kind }) => kind === "insert")) database.exec(statement.sql);
    for (const statement of parsedExport.filter(({ kind }) => kind === "index" || kind === "trigger")) database.exec(statement.sql);
    database.pragma("foreign_keys = ON");

    const ledgerBefore = migrationLedger(database);
    if (ledgerBefore.length !== EXPECTED_BASELINE_COUNT
      || ledgerBefore.some((name, index) => name !== baseline[index]?.name)) fail("MIGRATION_LEDGER_MISMATCH");
    assertStopsEngaged(database);
    const integrityBefore = integrityCheck(database);
    const foreignKeyViolationsBefore = foreignKeyViolationCount(database);
    if (foreignKeyViolationsBefore !== 0) fail("FOREIGN_KEY_CHECK_FAILED_BEFORE");
    const snapshots = snapshotTables(database);
    const originalRowCount = [...snapshots.values()].reduce((sum, table) => sum + table.count, 0);

    applyMigrations(database, migrations);

    const ledgerAfter = migrationLedger(database);
    if (ledgerAfter.length !== MIGRATION_END || ledgerAfter.at(-1) !== "0074_revenue_owner_observed_replies.sql"
      || ledgerAfter.some((name, index) => name !== [...baseline, ...migrations][index]?.name)) fail("MIGRATION_LEDGER_AFTER_MISMATCH");
    const integrityAfter = integrityCheck(database);
    const foreignKeyViolationsAfter = foreignKeyViolationCount(database);
    if (foreignKeyViolationsAfter !== 0) fail("FOREIGN_KEY_CHECK_FAILED_AFTER");
    assertStopsEngaged(database);
    assertOriginalRowsPreserved(database, snapshots);

    return {
      schema: "staging-d1-upgrade-rehearsal/v1",
      status: "PASS",
      exportSha256: sha256(exportBytes),
      exportBytes: exportBytes.length,
      baselineMigrationCount: ledgerBefore.length,
      baselineLastMigration: ledgerBefore.at(-1)!,
      appliedMigrationCount: migrations.length,
      finalMigrationCount: ledgerAfter.length,
      finalLastMigration: ledgerAfter.at(-1)!,
      migrationHashes: migrations.map(({ name, sha256: digest }) => ({ name, sha256: digest })),
      originalTableCount: snapshots.size,
      originalRowCount,
      originalRowsPreserved: true,
      stopsEngaged: true,
      foreignKeyViolationsBefore,
      foreignKeyViolationsAfter,
      integrityBefore,
      integrityAfter,
    };
  } catch (error) {
    if (error instanceof StagingRehearsalError) throw error;
    fail("STAGING_EXPORT_REHEARSAL_FAILED");
  } finally {
    database.close();
  }
}

function migrationFilesBefore55(repositoryRoot: string): MigrationFile[] {
  const directory = path.join(repositoryRoot, "migrations");
  const names = readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 55).sort();
  return names.map((name) => {
    const bytes = readFileSync(path.join(directory, name));
    return { name, sql: bytes.toString("utf8"), sha256: sha256(bytes) };
  });
}

function parseCliArgs(argv: string[]): { exportPath: string; expectedSha256: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index]!;
    if (option === "--help") {
      console.log("Usage: npx tsx scripts/rehearse-staging-sql-export.ts --export <absolute backups/staging SQL path> --sha256 <64-hex SHA-256>");
      process.exit(0);
    }
    if (option !== "--export" && option !== "--sha256") fail("CLI_ARGUMENT_INVALID");
    const value = argv[index + 1];
    if (!value || values.has(option)) fail("CLI_ARGUMENT_INVALID");
    values.set(option, value);
    index++;
  }
  const exportPath = values.get("--export");
  const expectedSha256 = values.get("--sha256");
  if (!exportPath || !expectedSha256) fail("CLI_ARGUMENT_INVALID");
  return { exportPath, expectedSha256 };
}

async function runCli(): Promise<void> {
  try {
    const result = await rehearseStagingSqlExport(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof StagingRehearsalError ? error.code : "STAGING_EXPORT_REHEARSAL_FAILED";
    process.stderr.write(`${JSON.stringify({ status: "REJECTED", code })}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  void runCli();
}
