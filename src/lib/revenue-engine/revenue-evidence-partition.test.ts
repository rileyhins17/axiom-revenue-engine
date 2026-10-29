import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import { classifyRevenueEvidencePartitions } from "@/lib/revenue-engine/revenue-evidence-partition";
import { applyCanonicalPrivateKwMigrations } from "../../../scripts/private-kw-database";
import { PRIVATE_KW_M2_MIGRATION_FILES } from "../../../scripts/private-kw-m2-database";

const absent = (table: string, column: "evidenceMode" | "assessmentKind") => ({ table, column, rows: [{ name: "id", type: "TEXT", notnull: 1, dflt_value: null }] });
const present = (table: string, column: "evidenceMode" | "assessmentKind") => ({ table, column, rows: [{ name: "id", type: "TEXT", notnull: 1, dflt_value: null }, { name: column, type: "TEXT", notnull: 1, dflt_value: "'LEGACY'" }] });

test("classifies complete legacy and 0069 partition metadata", () => {
  const tables = [
    ["RevenueWebsiteSnapshot", "evidenceMode"], ["RevenueEvidenceClaim", "evidenceMode"],
    ["RevenueQualificationSnapshot", "evidenceMode"], ["RevenueContactPoint", "evidenceMode"],
    ["RevenueVerificationResult", "evidenceMode"], ["RevenueLeadAssessmentReceipt", "assessmentKind"],
    ["RevenuePrivateKwContactInvocationReceipt", "assessmentKind"],
  ] as const;
  assert.equal(classifyRevenueEvidencePartitions(tables.map(([table, column]) => absent(table, column))), false);
  assert.equal(classifyRevenueEvidencePartitions(tables.map(([table, column]) => present(table, column))), true);
});

test("rejects partial, malformed, duplicate, and invalid partition metadata", () => {
  const base = absent("RevenueWebsiteSnapshot", "evidenceMode");
  assert.throws(() => classifyRevenueEvidencePartitions([base, present("RevenueEvidenceClaim", "evidenceMode")]), /partial or mixed/);
  assert.throws(() => classifyRevenueEvidencePartitions([{ ...base, rows: [] }]), /could not inspect/);
  assert.throws(() => classifyRevenueEvidencePartitions([{ ...base, rows: [{ name: "id" }, { name: "id" }] }]), /duplicate/);
  assert.throws(() => classifyRevenueEvidencePartitions([{ table: base.table, column: base.column, rows: [{ name: "id" }, { name: "evidenceMode", type: "INTEGER", notnull: 0, dflt_value: "0" }] }]), /invalid/);
});

test("classifies actual 0068 and 0069 SQLite schemas", () => {
  const database = new Database(":memory:");
  try {
    applyCanonicalPrivateKwMigrations(database);
    const requests = [
      ["RevenueWebsiteSnapshot", "evidenceMode"], ["RevenueQualificationSnapshot", "evidenceMode"],
      ["RevenueContactPoint", "evidenceMode"], ["RevenueVerificationResult", "evidenceMode"],
      ["RevenueLeadAssessmentReceipt", "assessmentKind"], ["RevenuePrivateKwContactInvocationReceipt", "assessmentKind"],
    ] as const;
    const rows = (table: string) => database.prepare(`PRAGMA table_info("${table}")`).all();
    assert.equal(classifyRevenueEvidencePartitions(requests.map(([table, column]) => ({ table, column, rows: rows(table) }))), false);
    database.exec(readFileSync(`migrations/${PRIVATE_KW_M2_MIGRATION_FILES.at(-1)}`, "utf8"));
    assert.equal(classifyRevenueEvidencePartitions(requests.map(([table, column]) => ({ table, column, rows: rows(table) }))), true);
  } finally { database.close(); }
});
