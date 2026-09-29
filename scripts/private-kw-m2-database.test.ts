import Database from "better-sqlite3";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyCanonicalPrivateKwM2Migrations,
  assertCanonicalPrivateKwM2RevenueSchema,
  PRIVATE_KW_M2_CANONICAL_MIGRATION_RANGE,
  PRIVATE_KW_M2_MIGRATION_FILES,
  privateKwM2MigrationManifest,
} from "./private-kw-m2-database.js";

describe("private KW M2 database setup contract", () => {
  it("applies exactly the additive 0054-0069 schema and preserves legacy defaults", () => {
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys = ON");
      applyCanonicalPrivateKwM2Migrations(database);
      assertCanonicalPrivateKwM2RevenueSchema(database);
      assert.equal(PRIVATE_KW_M2_CANONICAL_MIGRATION_RANGE, "0054-0069");
      assert.equal(PRIVATE_KW_M2_MIGRATION_FILES.length, 16);
      for (const table of ["RevenueWebsiteSnapshot", "RevenueEvidenceClaim", "RevenueQualificationSnapshot", "RevenueContactPoint", "RevenueVerificationResult"]) {
        const column = database.prepare(`PRAGMA table_info("${table}")`).all().find((entry) => (entry as { name: string }).name === "evidenceMode") as { dflt_value: string; notnull: number };
        assert.deepEqual({ dflt_value: column.dflt_value, notnull: column.notnull }, { dflt_value: "'LEGACY'", notnull: 1 });
      }
      const assessmentColumn = database.prepare('PRAGMA table_info("RevenueLeadAssessmentReceipt")').all().find((entry) => (entry as { name: string }).name === "assessmentKind") as { dflt_value: string; notnull: number };
      assert.deepEqual({ dflt_value: assessmentColumn.dflt_value, notnull: assessmentColumn.notnull }, { dflt_value: "'LEGACY'", notnull: 1 });
      assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'RevenuePrivateKwM2HtmlAssessmentLineage'").get());
      assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'RevenuePrivateKwM2HtmlAssessmentLineage_lineage_insert'").get());
    } finally {
      database.close();
    }
  });

  it("binds the setup manifest to all sixteen migration bytes", () => {
    const manifest = privateKwM2MigrationManifest();
    assert.equal(manifest.length, 16);
    assert.deepEqual(manifest.map((entry) => entry.filename), PRIVATE_KW_M2_MIGRATION_FILES);
    assert.ok(manifest.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
  });
});
