import assert from "node:assert/strict";
import test from "node:test";

import {
  parseM2EvidenceContext,
  type PrivateKwM2HtmlAssessmentContext,
} from "@/lib/revenue-engine/private-kw-m2-html-assessment";
import { buildPrivateKwM2ResearchReport, PrivateKwM2ResearchReportSchema } from "@/lib/revenue-engine/private-kw-m2-terminal-report";
import { privateKwM2ReceiptCanonicalDigest } from "@/lib/revenue-engine/private-kw-m2-html-evidence-receipt";
import { createPrivateKwM2AssessmentFixture } from "@/lib/revenue-engine/test-support/private-kw-m2-assessment-fixture";
import { createPrivateKwShadowSourceWorkflowFixture } from "@/lib/revenue-engine/test-support/private-kw-shadow-source-workflow-fixture";
import {
  buildPrivateKwSourceWorkflowMaterializationPlan,
  privateKwSourceWorkflowDigest,
} from "@/lib/revenue-engine/private-kw-source-workflow-materialization";

async function terminalContext(outcome: "PARTIAL" | "RESEARCH_REQUIRED") {
  const capture = await createPrivateKwM2AssessmentFixture({ outcome });
  const record = capture.chain.sourcePlan.records[0]!;
  const template = createPrivateKwShadowSourceWorkflowFixture({
    now: capture.clock(),
    selectedWebsiteUrl: record.sourceRecord.websiteUrl,
  }).materialization;
  const auditInput = {
    ...template.auditInput,
    businessId: record.business.id,
    businessName: record.business.canonicalName,
    niche: record.niche.toLowerCase(),
    expectedServices: [record.niche],
    expectedLocations: [record.location.city],
    sourceEvidenceUrl: record.sourceRecord.sourceEvidenceUrl,
    requestedUrl: record.sourceRecord.websiteUrl,
  };
  const materialization = {
    ...template,
    sourceImportId: capture.chain.sourcePlan.importId,
    sourcePlanDigest: capture.chain.manifest.sourcePlanDigest,
    businessId: record.business.id,
    evaluationCandidateId: record.evaluationCandidateId,
    auditInput,
    auditInputDigest: privateKwSourceWorkflowDigest(auditInput),
  };
  const source = buildPrivateKwSourceWorkflowMaterializationPlan(capture.chain.sourcePlan, materialization);
  const context: PrivateKwM2HtmlAssessmentContext = {
    businessId: record.business.id,
    businessName: record.business.canonicalName,
    evaluationCandidateId: record.evaluationCandidateId,
    sourceRecordId: record.sourceRecord.id,
    sourceEvidenceUrl: record.sourceRecord.sourceEvidenceUrl,
    sourceCapturedAt: record.sourceRecord.capturedAt,
    sourceMaterializationReceiptId: source.materializationId,
    sourceMaterializationDigest: source.materializationDigest,
    sourcePlanDigest: source.sourcePlanDigest,
    workflowReceiptId: source.workflowReceiptId,
    workflowReceiptDigest: source.records.find((row) => row.entity === "WORKFLOW_RECEIPT")!.expected.receiptDigest as string,
    manifestId: capture.chain.manifest.manifestId,
    manifestDigest: capture.chain.manifest.manifestDigest,
    task1ChainDigest: "a".repeat(64),
    setupReceiptId: `kw-m2-database:${"a".repeat(64)}`,
    setupReceiptDigest: "a".repeat(64),
    priorM2CheckpointId: `kw-m2-database:${"a".repeat(64)}`,
    priorM2CheckpointDigest: "a".repeat(64),
    approvalExpiresAt: capture.chain.ownerEnvelope.expiresAt,
    evidence: capture.receipt,
  };
  return { capture, context: parseM2EvidenceContext(context) };
}

for (const outcome of ["PARTIAL", "RESEARCH_REQUIRED"] as const) {
  test(`builds a deterministic bounded research report for ${outcome}`, async () => {
    const { context } = await terminalContext(outcome);
    const report = buildPrivateKwM2ResearchReport(context);
    const replay = buildPrivateKwM2ResearchReport(JSON.parse(JSON.stringify(context)));

    assert.equal(report.reportVersion, "kw-m2-html-research-report-v1");
    assert.equal(report.state, "RESEARCH_REVIEW");
    assert.equal(report.evidenceStatus, outcome);
    assert.equal(report.reportId, `kw-m2-html-research-report:${report.reportDigest}`);
    assert.equal(report.contextDigest.length, 64);
    assert.equal(report.operation.operationId, context.evidence.operationId);
    assert.equal(report.operation.operationDigest, context.evidence.operationDigest);
    assert.equal(report.business.id, context.businessId);
    assert.equal(report.business.name, context.businessName);
    assert.deepEqual(report.sourceIdentity, context.evidence.sourceIdentity);
    assert.deepEqual(report.pages, context.evidence.pages);
    assert.deepEqual(report.lineage, {
      sourceMaterializationReceiptId: context.sourceMaterializationReceiptId,
      sourceMaterializationDigest: context.sourceMaterializationDigest,
      sourcePlanDigest: context.sourcePlanDigest,
      workflowReceiptId: context.workflowReceiptId,
      workflowReceiptDigest: context.workflowReceiptDigest,
      setupReceiptId: context.setupReceiptId,
      setupReceiptDigest: context.setupReceiptDigest,
      priorM2CheckpointId: context.priorM2CheckpointId,
      priorM2CheckpointDigest: context.priorM2CheckpointDigest,
      manifestId: context.manifestId,
      manifestDigest: context.manifestDigest,
      task1ChainDigest: context.task1ChainDigest,
    });
    assert.deepEqual(report.authority, {
      localOnly: true, qualificationAuthorized: false, contactAuthorized: false, consentAuthorized: false,
      outreachAuthorized: false, sendAuthorized: false, browserAuthorized: false, r2Authorized: false,
      deploymentAuthorized: false, runtimeConnected: false, remoteDatabaseAuthorized: false,
      providerOperationsAuthorized: 0, costAuthorizedUsd: 0,
    });
    assert.deepEqual(report.qualification.scores, {
      rebuildNeed: 0, businessFit: 0, timing: 0, reachability: 0, evidenceConfidence: 0,
    });
    assert.deepEqual(report.availableChannels, []);
    assert.deepEqual(report.routes, []);
    assert.equal(report.contactReview.state, "NOT_RECORDED");
    assert.equal(report.contactReview.consentBasis, "UNASSESSED");
    assert.deepEqual(report.rowCounts, {
      RevenueWebsiteSnapshot: 0,
      RevenueEvidenceClaim: 0,
      RevenueQualificationSnapshot: 0,
      RevenueLeadAssessmentReceipt: 0,
      RevenuePrivateKwM2HtmlAssessmentLineage: 0,
      assessmentRows: 0,
      progressRows: 0,
    });
    assert.equal(report.reportConstructionNetworkRequestCount, 0);
    assert.equal(report.providerOperations, 0);
    assert.equal(report.costAuthorizedUsd, 0);
    assert.equal(JSON.stringify(report).includes("rawHTML"), false);
    assert.deepEqual(replay, report);
    assert.throws(() => PrivateKwM2ResearchReportSchema.parse({ ...report, reportDigest: "0".repeat(64) }), /digest/i);
  });
}

test("rejects complete or failed evidence from the research report projection", async () => {
  for (const outcome of ["COMPLETE", "FAILED"] as const) {
    const { context } = await terminalContext("RESEARCH_REQUIRED");
    const tampered = structuredClone(context) as typeof context;
    tampered.evidence.status = outcome;
    const operation = structuredClone(tampered.evidence) as { operationDigest?: string };
    delete operation.operationDigest;
    tampered.evidence.operationDigest = privateKwM2ReceiptCanonicalDigest(operation);
    assert.throws(() => buildPrivateKwM2ResearchReport(tampered), /PARTIAL|RESEARCH_REQUIRED|terminal|digest/i);
  }
});

test("rejects a changed source identity even when the report input is re-digested by a caller", async () => {
  const { context } = await terminalContext("RESEARCH_REQUIRED");
  const tampered = structuredClone(context) as typeof context;
  tampered.evidence.sourceIdentity.sourceEvidenceUrl = "https://changed.example/";
  const operation = structuredClone(tampered.evidence) as { operationDigest?: string };
  delete operation.operationDigest;
  tampered.evidence.operationDigest = privateKwM2ReceiptCanonicalDigest(operation);
  assert.throws(() => buildPrivateKwM2ResearchReport(tampered), /digest|lineage|identity/i);
});

test("rejects a schema-valid captured page with blocked retention", async () => {
  const { context } = await terminalContext("RESEARCH_REQUIRED");
  const tampered = structuredClone(context) as typeof context;
  tampered.evidence.pages[0]!.storageOutcome = "BLOCKED";
  const operation = structuredClone(tampered.evidence) as { operationDigest?: string };
  delete operation.operationDigest;
  tampered.evidence.operationDigest = privateKwM2ReceiptCanonicalDigest(operation);
  assert.throws(() => buildPrivateKwM2ResearchReport(tampered), /retention|outcome/i);
});

