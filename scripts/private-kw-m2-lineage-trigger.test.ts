import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const migration = readFileSync(new URL("../migrations/0069_private_kw_m2_html_assessment_lineage.sql", import.meta.url), "utf8");
const tableSql = migration.match(/CREATE TABLE "RevenuePrivateKwM2HtmlAssessmentLineage" \([\s\S]*?\n\);/)?.[0];
const triggerSql = migration.match(/CREATE TRIGGER "RevenuePrivateKwM2HtmlAssessmentLineage_lineage_insert"[\s\S]*?\nBEGIN SELECT RAISE\(ABORT, 'REVENUE_PRIVATE_KW_M2_HTML_LINEAGE_MISMATCH'\); END;/)?.[0];
if (!tableSql || !triggerSql) throw new Error("0069 table or trigger was not found");

const digest = (letter: string) => letter.repeat(64);

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE RevenueBusiness (id TEXT PRIMARY KEY); CREATE TABLE RevenuePrivateKwMaterializationReceipt (id TEXT PRIMARY KEY); CREATE TABLE RevenueWorkflowReceiptRevision (id TEXT PRIMARY KEY); CREATE TABLE RevenueWebsiteSnapshot (id TEXT PRIMARY KEY, businessId TEXT, evidenceMode TEXT); CREATE TABLE RevenueQualificationSnapshot (id TEXT PRIMARY KEY, businessId TEXT, evidenceMode TEXT); CREATE TABLE RevenueLeadAssessmentReceipt (id TEXT PRIMARY KEY, businessId TEXT, assessmentKind TEXT);`);
  db.exec(tableSql!);
  db.exec(triggerSql!);
  db.exec("INSERT INTO RevenueBusiness VALUES ('business:test'); INSERT INTO RevenueBusiness VALUES ('business:copied'); INSERT INTO RevenuePrivateKwMaterializationReceipt VALUES ('materialization:test'); INSERT INTO RevenueWorkflowReceiptRevision VALUES ('workflow:test'); INSERT INTO RevenueWebsiteSnapshot VALUES ('website:test','business:test','M2_HTML_ONLY'); INSERT INTO RevenueWebsiteSnapshot VALUES ('website:copied','business:copied','M2_HTML_ONLY'); INSERT INTO RevenueQualificationSnapshot VALUES ('qualification:test','business:test','M2_HTML_ONLY'); INSERT INTO RevenueLeadAssessmentReceipt VALUES ('assessment:test','business:test','WEBSITE_FIT_EVIDENCE')");
  const core = {
    lineageVersion: "kw-m2-html-lineage-v1", assessmentKind: "WEBSITE_FIT_EVIDENCE", businessId: "business:test", sourceMaterializationReceiptId: "materialization:test", sourcePlanDigest: digest("a"), workflowReceiptId: "workflow:test", htmlOperationId: "operation:test", htmlOperationDigest: digest("b"), mappingId: "mapping:test", mappingDigest: digest("c"), websiteSnapshotId: "website:test", qualificationSnapshotId: "qualification:test", assessmentReceiptId: "assessment:test", assessmentReceiptDigest: digest("d"), websiteProgressId: "progress:website", websiteProgressDigest: digest("e"), assessmentProgressId: "progress:assessment", assessmentProgressDigest: digest("f"), lineageSeedDigest: digest("a"), sourcePolicyDigest: digest("b"), transportChainDigest: digest("c"), pageSetDigest: digest("d"), htmlClassification: "UNKNOWN", retentionDisposition: "DERIVED_FACTS_ONLY", authority: { localOnly: 1, qualificationAuthorized: 0, contactAuthorized: 0, consentAuthorized: 0, outreachAuthorized: 0, sendAuthorized: 0, browserAuthorized: 0, r2Authorized: 0, deploymentAuthorized: 0, providerOperationsAuthorized: 0, costAuthorizedUsd: 0 },
  };
  const lineageJson = JSON.stringify(core);
  const lineageDigest = createHash("sha256").update(lineageJson).digest("hex");
  const row = { id: `kw-m2-html-lineage:${lineageDigest}`, lineageDigest, ...core, lineageJson, recordedAt: "2026-09-21T12:00:00.000Z", ...core.authority };
  delete (row as { authority?: unknown }).authority;
  return { db, core, row, insert: db.prepare(`INSERT INTO RevenuePrivateKwM2HtmlAssessmentLineage (${Object.keys(row).map((key) => `"${key}"`).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`) };
}

describe("0069 lineage trigger", () => {
  it("accepts the acyclic canonical row with an actual core digest", () => {
    const { db, row, insert } = fixture();
    try {
      assert.doesNotThrow(() => insert.run(...Object.keys(row).map((key) => (row as Record<string, unknown>)[key])));
      assert.equal((db.prepare("SELECT count(*) AS count FROM RevenuePrivateKwM2HtmlAssessmentLineage").get() as { count: number }).count, 1);
    } finally { db.close(); }
  });

  function rejectsCandidate(
    change: (row: Record<string, unknown>, core: Record<string, unknown>, authority: Record<string, number>) => void,
    reason: RegExp,
  ) {
    const { db, core, row, insert } = fixture();
    try {
      const candidate = { ...row } as Record<string, unknown>;
      const authority = { ...core.authority } as Record<string, number>;
      const updatedCore = { ...core, authority } as Record<string, unknown>;
      change(candidate, updatedCore, authority);
      candidate.lineageJson = JSON.stringify(updatedCore);
      candidate.lineageDigest = createHash("sha256").update(String(candidate.lineageJson)).digest("hex");
      candidate.id = `kw-m2-html-lineage:${candidate.lineageDigest}`;
      assert.throws(() => insert.run(...Object.keys(row).map((key) => candidate[key])), reason);
    } finally { db.close(); }
  }

  it("rejects a scalar source-plan mismatch and an existing parent from another business", () => {
    rejectsCandidate((row) => { row.sourcePlanDigest = digest("9"); }, /REVENUE_PRIVATE_KW_M2_HTML_LINEAGE_MISMATCH/);
    rejectsCandidate((row, core) => {
      row.websiteSnapshotId = "website:copied";
      core.websiteSnapshotId = "website:copied";
    }, /REVENUE_PRIVATE_KW_M2_HTML_LINEAGE_MISMATCH/);
  });

  it("rejects every nonzero authority field even when JSON agrees with the column", () => {
    for (const field of ["qualificationAuthorized", "contactAuthorized", "consentAuthorized", "outreachAuthorized", "sendAuthorized", "browserAuthorized", "r2Authorized", "deploymentAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd"]) {
      rejectsCandidate((row, _core, authority) => {
        row[field] = 1;
        authority[field] = 1;
      }, /REVENUE_PRIVATE_KW_M2_HTML_LINEAGE_MISMATCH|CHECK constraint failed/);
    }
    rejectsCandidate((row, _core, authority) => {
      row.localOnly = 0;
      authority.localOnly = 0;
    }, /REVENUE_PRIVATE_KW_M2_HTML_LINEAGE_MISMATCH|CHECK constraint failed/);
  });
});
