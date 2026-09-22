import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import { executePrivateKwSourceWorkflowPlanForLocalDatabase } from "./materialize-private-kw-source-workflow";
import { reloadPrivateKwM2SourceMaterialization } from "./private-kw-m2-source-reload";
import { privateKwM2Digest } from "../src/lib/revenue-engine/private-kw-m2-authorization";
import {
  buildPrivateKwM2HtmlAssessmentCandidate,
  buildPrivateKwM2HtmlAssessmentPlan,
  parseM2AssessmentContext,
  recordPrivateKwM2HtmlAssessmentApproval,
} from "../src/lib/revenue-engine/private-kw-m2-html-assessment";
import { reloadPrivateKwM2WebsiteEvidenceReceipt } from "../src/lib/revenue-engine/private-kw-m2-html-evidence-workflow";
import { privateKwM2ReceiptCanonicalDigest } from "../src/lib/revenue-engine/private-kw-m2-html-evidence-receipt";
import {
  buildPrivateKwSourceWorkflowMaterializationPlan,
  privateKwSourceWorkflowDigest,
} from "../src/lib/revenue-engine/private-kw-source-workflow-materialization";
import { createPrivateKwM2AssessmentFixture } from "../src/lib/revenue-engine/test-support/private-kw-m2-assessment-fixture";
import { createPrivateKwShadowSourceWorkflowFixture } from "../src/lib/revenue-engine/test-support/private-kw-shadow-source-workflow-fixture";

async function fixture(retention: "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY", businessIndex = 0) {
  const capture = await createPrivateKwM2AssessmentFixture({ retention, businessIndex });
  const { sourcePlan, manifest } = capture.chain;
  const record = sourcePlan.records[businessIndex]!;
  // Synthetic source prerequisites only; this old audit is not HTML assessment evidence.
  const template = createPrivateKwShadowSourceWorkflowFixture({
    now: capture.clock(), selectedWebsiteUrl: record.sourceRecord.websiteUrl,
  }).materialization;
  const auditInput = { ...template.auditInput, businessId: record.business.id,
    businessName: record.business.canonicalName, niche: record.niche.toLowerCase(),
    expectedServices: [record.niche], expectedLocations: [record.location.city],
    sourceEvidenceUrl: record.sourceRecord.sourceEvidenceUrl, requestedUrl: record.sourceRecord.websiteUrl };
  const materialization = { ...template, sourceImportId: sourcePlan.importId,
    sourcePlanDigest: manifest.sourcePlanDigest, businessId: record.business.id,
    evaluationCandidateId: record.evaluationCandidateId, auditInput,
    auditInputDigest: privateKwSourceWorkflowDigest(auditInput) };
  const source = buildPrivateKwSourceWorkflowMaterializationPlan(sourcePlan, materialization);
  const context = parseM2AssessmentContext({
    businessId: record.business.id, businessName: record.business.canonicalName,
    evaluationCandidateId: record.evaluationCandidateId, sourceRecordId: record.sourceRecord.id,
    sourceEvidenceUrl: record.sourceRecord.sourceEvidenceUrl, sourceCapturedAt: record.sourceRecord.capturedAt,
    sourceMaterializationReceiptId: source.materializationId, sourceMaterializationDigest: source.materializationDigest,
    sourcePlanDigest: source.sourcePlanDigest, workflowReceiptId: source.workflowReceiptId,
    workflowReceiptDigest: source.records.find((row) => row.entity === "WORKFLOW_RECEIPT")!.expected.receiptDigest,
    manifestId: manifest.manifestId, manifestDigest: manifest.manifestDigest,
    task1ChainDigest: privateKwM2Digest(capture.chain),
    // Pure planning test values, never accepted as a setup release or file write capability.
    setupReceiptId: `kw-m2-database:${"a".repeat(64)}`, setupReceiptDigest: "a".repeat(64),
    priorM2CheckpointId: `kw-m2-database:${"a".repeat(64)}`, priorM2CheckpointDigest: "a".repeat(64),
    approvalExpiresAt: capture.chain.ownerEnvelope.expiresAt, evidence: capture.receipt,
  });
  const candidate = buildPrivateKwM2HtmlAssessmentCandidate(context, capture.clock().toISOString());
  const approval = recordPrivateKwM2HtmlAssessmentApproval(candidate, context, {
    approvedBy: "RILEY", reviewedAt: capture.clock().toISOString(),
    rationale: "Synthetic separate assessment decision for the database compatibility test.",
    confirmation: "RECORD_LOCAL_HTML_WEBSITE_FIT_ASSESSMENT",
  }, capture.clock());
  return { capture, source, materialization, context, candidate, approval };
}

for (const retention of ["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY"] as const) {
  test(`HTML plan inserts through all canonical 0069 constraints: ${retention}`, async () => {
    const input = await fixture(retention, retention === "DERIVED_FACTS_ONLY" ? 1 : 0);
    const { capture, source, context, approval, materialization } = input;
    const database = new Database(":memory:");
    try {
      database.pragma("foreign_keys = ON");
      applyCanonicalPrivateKwMigrations(database);
      database.exec(readFileSync("migrations/0069_private_kw_m2_html_assessment_lineage.sql", "utf8"));
      // Keep the real source executor's freshness check on the fixture's fixed clock.
      database.function("strftime", (format, instant) => {
        assert.equal(format, "%Y-%m-%dT%H:%M:%fZ");
        assert.equal(instant, "now");
        return capture.clock().toISOString();
      });
      executePrivateKwSourceWorkflowPlanForLocalDatabase(database, source);
      const reloadInput = { sourceValue: capture.chain.sourcePlan, manifestValue: capture.chain.manifest,
        materializationValue: materialization, businessId: context.businessId };
      const before = database.serialize();
      reloadPrivateKwM2SourceMaterialization(database, reloadInput);
      const evidence = await reloadPrivateKwM2WebsiteEvidenceReceipt({ request: capture.request,
        evidenceStore: capture.evidenceStore, receiptStore: capture.receiptStore }, { clock: capture.clock });
      reloadPrivateKwM2SourceMaterialization(database, reloadInput);
      assert.deepEqual(evidence, context.evidence);
      assert.deepEqual(database.serialize(), before);
      const plan = buildPrivateKwM2HtmlAssessmentPlan(context, approval, capture.clock());
      // Direct SQL is intentional here: this is a row/trigger compatibility test, not writer proof.
      database.transaction(() => {
        for (const entry of plan.rows) {
          const columns = Object.keys(entry.row);
          database.prepare(`INSERT INTO "${entry.table}" (${columns.map((name) => `"${name}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
            .run(...columns.map((name) => entry.row[name]));
        }
      }).immediate();
      for (const entry of plan.rows) {
        const stored = database.prepare(`SELECT * FROM "${entry.table}" WHERE "id" = ?`).get(entry.row.id);
        assert.deepEqual(stored, entry.row);
      }
      assert.deepEqual(database.pragma("foreign_key_check"), []);
      const storedQualification = database.prepare('SELECT "band", "totalScore", "supportedObservationCount" FROM "RevenueQualificationSnapshot"').get();
      assert.deepEqual(storedQualification, { band: "RESEARCH", totalScore: 0, supportedObservationCount: 0 });
      assert.equal(plan.assessment.htmlClassification, "UNKNOWN");
      assert.equal(plan.assessment.authority.qualificationAuthorized, false);
      assert.equal(plan.mapping.contactReview, "NOT_RECORDED");
      const snapshot = JSON.parse(String(plan.rows[0]!.row.deterministicChecksJson));
      assert.equal(snapshot.snapshotVersion, "kw-m2-html-website-snapshot-v1");
      assert.equal(snapshot.retentionDisposition, retention);
      assert.deepEqual(snapshot.pages, context.evidence.pages);
      assert.equal(snapshot.htmlOperationDigest, context.evidence.operationDigest);
      assert.equal(plan.rows.at(-1)!.table, "RevenuePrivateKwM2HtmlAssessmentLineage");
      assert.throws(() => database.prepare('UPDATE "RevenuePrivateKwM2HtmlAssessmentLineage" SET "recordedAt" = ?').run("altered"), /APPEND_ONLY/);
      assert.deepEqual(buildPrivateKwM2HtmlAssessmentPlan(JSON.parse(JSON.stringify(context)), JSON.parse(JSON.stringify(approval)), capture.clock()), plan);
    } finally { database.close(); }
  });
}

test("planning rejects pending, expired, changed-source and non-complete evidence", async () => {
  const { capture, context, candidate, approval } = await fixture("RAW_HTML_ALLOWED");
  assert.throws(() => buildPrivateKwM2HtmlAssessmentPlan(context, candidate, capture.clock()), /separate HTML assessment approval/);
  assert.throws(() => buildPrivateKwM2HtmlAssessmentPlan(context, approval, new Date(approval.expiresAt)), /expired/);
  assert.throws(() => buildPrivateKwM2HtmlAssessmentPlan({ ...context, sourceRecordId: "another-source" }, approval, capture.clock()), /lineage mismatch/);
  const { operationDigest, ...evidence } = context.evidence;
  assert.equal(privateKwM2ReceiptCanonicalDigest(evidence), operationDigest);
  const partial = { ...evidence, status: "PARTIAL" };
  assert.throws(() => parseM2AssessmentContext({ ...context,
    evidence: { ...partial, operationDigest: privateKwM2ReceiptCanonicalDigest(partial) } }), /complete retained HTML evidence/);
  const mixed = { ...evidence, pages: evidence.pages.map((page, index) => index === 1
    ? { ...page, storageOutcome: "DERIVED_FACTS_ONLY" } : page) };
  assert.throws(() => parseM2AssessmentContext({ ...context,
    evidence: { ...mixed, operationDigest: privateKwM2ReceiptCanonicalDigest(mixed) } }), /uniform retention/);
});
