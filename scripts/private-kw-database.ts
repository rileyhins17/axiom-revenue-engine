import { readFileSync, readdirSync } from "node:fs";

import Database from "better-sqlite3";

export const PRIVATE_KW_CANONICAL_MIGRATION_RANGE = "0054-0064";
const PRIVATE_KW_MIGRATION_PATTERN = /^(0054|0055|0056|0057|0058|0059|0060|0061|0062|0063|0064)_.*\.sql$/;
const PRIVATE_KW_MIGRATION_COUNT = 11;

type SqliteSchemaRow = {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
};

function revenueSchemaRows(database: Database.Database) {
  return database.prepare(`
    SELECT "type", "name", "tbl_name", "sql"
    FROM "sqlite_master"
    WHERE "name" LIKE 'Revenue%' OR "tbl_name" LIKE 'Revenue%'
    ORDER BY "type", "name", "tbl_name"
  `).all() as SqliteSchemaRow[];
}

export function applyCanonicalPrivateKwMigrations(database: Database.Database) {
  const migrationRoot = new URL("../migrations/", import.meta.url);
  const migrationFiles = readdirSync(migrationRoot)
    .filter((name) => PRIVATE_KW_MIGRATION_PATTERN.test(name))
    .sort();
  if (migrationFiles.length !== PRIVATE_KW_MIGRATION_COUNT) {
    throw new Error(`Canonical private KW migrations ${PRIVATE_KW_CANONICAL_MIGRATION_RANGE} are incomplete.`);
  }
  for (const migrationFile of migrationFiles) {
    database.exec(readFileSync(new URL(migrationFile, migrationRoot), "utf8"));
  }
}

export function assertCanonicalPrivateKwRevenueSchema(database: Database.Database) {
  const reference = new Database(":memory:");
  try {
    reference.pragma("foreign_keys = ON");
    applyCanonicalPrivateKwMigrations(reference);
    if (JSON.stringify(revenueSchemaRows(database)) !== JSON.stringify(revenueSchemaRows(reference))) {
      throw new Error(`Private KW database Revenue schema differs from canonical migrations ${PRIVATE_KW_CANONICAL_MIGRATION_RANGE}.`);
    }
  } finally {
    reference.close();
  }
}

export function assertPrivateKwRequiredTables(
  database: Database.Database,
  requiredTables: readonly string[],
  operation: string,
) {
  const rows = database.prepare(
    `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" IN (${requiredTables.map(() => "?").join(", ")})`,
  ).all(...requiredTables) as { name: string }[];
  const present = new Set(rows.map((row) => row.name));
  const missing = requiredTables.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new Error(`Private KW database has not applied the required local ${operation} schema.`);
  }
}

export function assertPrivateKwSingleDatabase(database: Database.Database) {
  const attached = database.pragma("database_list") as { name: string; file: string }[];
  if (attached.length !== 1 || attached[0]?.name !== "main") {
    throw new Error("Private KW execution requires one unattached local SQLite database.");
  }
}
