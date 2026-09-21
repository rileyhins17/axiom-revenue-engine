import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";

export const PRIVATE_KW_M2_CANONICAL_MIGRATION_RANGE = "0054-0069" as const;

export const PRIVATE_KW_M2_MIGRATION_FILES = [
  "0054_revenue_shadow_kernel.sql",
  "0055_outreach_human_approval.sql",
  "0056_durable_evidence_receipts.sql",
  "0057_fenced_evidence_resume_records.sql",
  "0058_artifact_reference_projections.sql",
  "0059_atomic_artifact_reference_snapshots.sql",
  "0060_artifact_reference_source_writer_guards.sql",
  "0061_shadow_lead_assessment_receipts.sql",
  "0062_append_only_contact_verification_records.sql",
  "0063_harden_contact_record_lineage.sql",
  "0064_local_source_workflow_materializations.sql",
  "0065_local_contact_persistence_receipts.sql",
  "0066_harden_local_contact_persistence_receipts.sql",
  "0067_local_contact_invocation_receipts.sql",
  "0068_current_website_evidence_eligibility_receipts.sql",
  "0069_private_kw_m2_html_assessment_lineage.sql",
] as const;

type SqliteSchemaRow = {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
};

export type PrivateKwM2MigrationManifestEntry = {
  filename: (typeof PRIVATE_KW_M2_MIGRATION_FILES)[number];
  sha256: string;
};

export function privateKwM2MigrationManifest(migrationRoot: URL | string = new URL("../migrations/", import.meta.url)) {
  const root = migrationRoot instanceof URL ? migrationRoot : pathToFileURL(path.resolve(migrationRoot.endsWith("/") ? migrationRoot : `${migrationRoot}/`));
  return PRIVATE_KW_M2_MIGRATION_FILES.map((filename) => ({
    filename,
    sha256: createHash("sha256").update(readFileSync(new URL(filename, root))).digest("hex"),
  }));
}

export function applyCanonicalPrivateKwM2Migrations(database: Database.Database, migrationRoot = new URL("../migrations/", import.meta.url)) {
  const available = new Set(readdirSync(migrationRoot).filter((name) => /^00(5[4-9]|6[0-9])_.*\.sql$/.test(name)));
  if (available.size !== PRIVATE_KW_M2_MIGRATION_FILES.length || PRIVATE_KW_M2_MIGRATION_FILES.some((filename) => !available.has(filename))) {
    throw new Error(`Canonical private KW M2 migrations ${PRIVATE_KW_M2_CANONICAL_MIGRATION_RANGE} are incomplete.`);
  }
  for (const migrationFile of PRIVATE_KW_M2_MIGRATION_FILES) {
    database.exec(readFileSync(new URL(migrationFile, migrationRoot), "utf8"));
  }
}

function revenueSchemaRows(database: Database.Database) {
  return database.prepare(`
    SELECT "type", "name", "tbl_name", "sql"
    FROM "sqlite_master"
    WHERE "name" LIKE 'Revenue%' OR "tbl_name" LIKE 'Revenue%'
    ORDER BY "type", "name", "tbl_name"
  `).all() as SqliteSchemaRow[];
}

export function assertCanonicalPrivateKwM2RevenueSchema(database: Database.Database) {
  const reference = new Database(":memory:");
  try {
    reference.pragma("foreign_keys = ON");
    applyCanonicalPrivateKwM2Migrations(reference);
    if (JSON.stringify(revenueSchemaRows(database)) !== JSON.stringify(revenueSchemaRows(reference))) {
      throw new Error(`Private KW database Revenue schema differs from canonical migrations ${PRIVATE_KW_M2_CANONICAL_MIGRATION_RANGE}.`);
    }
  } finally {
    reference.close();
  }
}

export function assertPrivateKwM2SingleDatabase(database: Database.Database) {
  const attached = database.pragma("database_list") as { name: string; file: string }[];
  if (attached.length !== 1 || attached[0]?.name !== "main") {
    throw new Error("Private KW M2 setup requires one unattached local SQLite database.");
  }
}
