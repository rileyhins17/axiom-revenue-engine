import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
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
  db.exec("INSERT INTO RevenueBusiness VALUES ('business:test'); INSERT INTO RevenuePrivateKwMaterializationReceipt VALUES ('materialization:test'); INSERT INTO RevenueWorkflowReceiptRevision VALUES ('workflow:test'); INSERT INTO RevenueWebsiteSnapshot VALUES ('website:test','business:test','M2_HTML_ONLY'); INSERT INTO RevenueQualificationSnapshot VALUES ('qualification:test','business:test','M2_HTML_ONLY'); INSERT INTO RevenueLeadAssessmentReceipt VALUES ('assessment:test','business:test','WEBSITE_FIT_EVIDENCE')");
  const core = {
    lineageVersion: "kw-m2-html-lineage-v1", assessmentKind: "WEBSITE_FIT_EVIDENCE", businessId: "business:test", sourceMaterializationReceiptId: "materialization:test", sourcePlanDigest: digest("a"), workflowReceiptId: "workflow:test", htmlOperationId: "operation:test", htmlOperationDigest: digest("b"), mappingId: "mapping:test", mappingDigest: digest("c"), websiteSnapshotId: "website:test", qualificationSnapshotId: "qualification:test", assessmentReceiptId: "assessment:test", assessmentReceiptDigest: digest("d"), websiteProgressId: "progress:website", websiteProgressDigest: digest("e"), assessmentProgressId: "progress:assessment", assessmentProgressDigest: digest("f"), lineageSeedDigest: digest("a"), sourcePolicyDigest: digest("b"), transportChainDigest: digest("c"), pageSetDigest: digest("d"), htmlClassification: "UNKNOWN", retentionDisposition: "DERIVED_FACTS_ONLY", authority: { localOnly: 1, qualificationAuthorized: 0, contactAuthorized: 0, consentAuthorized: 0, outreachAuthorized: 0, sendAuthorized: 0, browserAuthorized: 0, r2Authorized: 0, deploymentAuthorized: 0, providerOperationsAuthorized: 0, costAuthorizedUsd: 0 },
  };
  const row = { id: `kw-m2-html-lineage:${digest("1")}`, lineageDigest: digest("1"), ...core, lineageJson: JSON.stringify(core), recordedAt: "2026-09-21T12:00:00.000Z", ...core.authority };
  delete (row as { authority?: unknown }).authority;
  return { db, core, row, insert: db.prepare(`INSERT INTO RevenuePrivateKwM2HtmlAssessmentLineage (${Object.keys(row).map((key) => `"${key}"`).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`) };
}

describe("0069 lineage trigger", () => {
  it("accepts the acyclic canonical row and rejects direct SQL tampering", () => {
    const { db, core, row, insert } = fixture();
    try {
      assert.doesNotThrow(() => insert.run(...Object.keys(row).map((key) => (row as Record<string, unknown>)[key])));
      assert.equal((db.prepare("SELECT count(*) AS count FROM RevenuePrivateKwM2HtmlAssessmentLineage").get() as { count: number }).count, 1);
      assert.throws(() => insert.run(...Object.keys({ ...row, lineageJson: JSON.stringify({ ...core, sourcePlanDigest: digest("z") }) }).map((key) => ({ ...row, lineageJson: JSON.stringify({ ...core, sourcePlanDigest: digest("z") }) } as Record<string, unknown>)[key])));
      assert.throws(() => insert.run(...Object.keys({ ...row, businessId: "business:copied" }).map((key) => ({ ...row, businessId: "business:copied" } as Record<string, unknown>)[key])));
      for (const field of ["qualificationAuthorized", "contactAuthorized", "consentAuthorized", "outreachAuthorized", "sendAuthorized", "browserAuthorized", "r2Authorized", "deploymentAuthorized", "providerOperationsAuthorized", "costAuthorizedUsd"]) {
        const tampered = { ...row, lineageJson: JSON.stringify({ ...core, authority: { ...core.authority, [field]: 1 } }) };
        assert.throws(() => insert.run(...Object.keys(tampered).map((key) => (tampered as Record<string, unknown>)[key])));
      }
    } finally { db.close(); }
  });
});
