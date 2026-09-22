import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPrivateKwM2HtmlAssessmentCandidate,
  buildPrivateKwM2HtmlAssessmentPlan,
  parseM2AssessmentContext,
  recordPrivateKwM2HtmlAssessmentApproval,
} from "@/lib/revenue-engine/private-kw-m2-html-assessment";
import { createPrivateKwM2AssessmentFixture } from "@/lib/revenue-engine/test-support/private-kw-m2-assessment-fixture";
import { createPrivateKwShadowSourceWorkflowFixture } from "@/lib/revenue-engine/test-support/private-kw-shadow-source-workflow-fixture";
import {
  buildPrivateKwSourceWorkflowMaterializationPlan,
  privateKwSourceWorkflowDigest,
} from "@/lib/revenue-engine/private-kw-source-workflow-materialization";
import {
  PrivateKwM2OwnerLeadDetailResponseSchema,
  projectPrivateKwM2OwnerLeadDetail,
} from "@/lib/revenue-engine/private-kw-m2-owner-projection";

async function assessmentPlan(retention: "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY" = "RAW_HTML_ALLOWED") {
  const capture = await createPrivateKwM2AssessmentFixture({ retention });
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
  const context = parseM2AssessmentContext({
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
    workflowReceiptDigest: source.records.find((row) => row.entity === "WORKFLOW_RECEIPT")!.expected.receiptDigest,
    manifestId: capture.chain.manifest.manifestId,
    manifestDigest: capture.chain.manifest.manifestDigest,
    task1ChainDigest: "a".repeat(64),
    setupReceiptId: `kw-m2-database:${"a".repeat(64)}`,
    setupReceiptDigest: "a".repeat(64),
    priorM2CheckpointId: `kw-m2-database:${"a".repeat(64)}`,
    priorM2CheckpointDigest: "a".repeat(64),
    approvalExpiresAt: capture.chain.ownerEnvelope.expiresAt,
    evidence: capture.receipt,
  });
  const candidate = buildPrivateKwM2HtmlAssessmentCandidate(context, capture.clock().toISOString());
  const approval = recordPrivateKwM2HtmlAssessmentApproval(candidate, context, {
    approvedBy: "RILEY",
    reviewedAt: capture.clock().toISOString(),
    rationale: "Synthetic separate HTML assessment decision for owner projection.",
    confirmation: "RECORD_LOCAL_HTML_WEBSITE_FIT_ASSESSMENT",
  }, capture.clock());
  return buildPrivateKwM2HtmlAssessmentPlan(context, approval, capture.clock());
}

test("projects the current HTML assessment plan into a non-qualifying owner dossier", async () => {
  const plan = await assessmentPlan("DERIVED_FACTS_ONLY");
  const result = projectPrivateKwM2OwnerLeadDetail(plan);
  const parsed = PrivateKwM2OwnerLeadDetailResponseSchema.parse(result);

  assert.equal(parsed.business.id, plan.context.businessId);
  assert.equal(parsed.business.name, plan.context.businessName);
  assert.equal(parsed.htmlEvidence.operationId, plan.context.evidence.operationId);
  assert.equal(parsed.htmlEvidence.operationDigest, plan.context.evidence.operationDigest);
  assert.equal(parsed.htmlEvidence.lineageId, plan.lineageId);
  assert.equal(parsed.htmlEvidence.lineageDigest, plan.lineageDigest);
  assert.equal(parsed.htmlEvidence.mappingId, plan.mapping.mappingId);
  assert.equal(parsed.htmlEvidence.mappingDigest, plan.mapping.mappingDigest);
  assert.equal(parsed.htmlEvidence.sourceEvidenceUrl, plan.context.sourceEvidenceUrl);
  assert.equal(parsed.htmlEvidence.approvedWebsiteUrl, plan.context.evidence.sourceIdentity.approvedWebsiteUrl);
  assert.equal(parsed.htmlEvidence.sourceCapturedAt, plan.context.sourceCapturedAt);
  assert.equal(parsed.htmlEvidence.browserEvidence, false);
  assert.equal(parsed.htmlEvidence.desktopArtifactRef, null);
  assert.equal(parsed.htmlEvidence.mobileArtifactRef, null);
  assert.equal(parsed.htmlEvidence.domArtifactRef, null);
  assert.deepEqual(parsed.htmlEvidence.unknownLimitations, plan.context.evidence.audit!.unknownLimitations);
  assert.equal(parsed.htmlEvidence.pages.length, 4);
  assert.equal(parsed.classification.value, "UNKNOWN");
  assert.equal(parsed.classification.authority, "NON_QUALIFYING_HTML_ONLY");
  assert.equal(parsed.qualification.band, "RESEARCH");
  assert.deepEqual(parsed.qualification.scores, {
    rebuildNeed: 0,
    businessFit: 0,
    timing: 0,
    reachability: 0,
    evidenceConfidence: 0,
  });
  assert.deepEqual(parsed.availableChannels, []);
  assert.deepEqual(parsed.routes, []);
  assert.equal(parsed.contactReview.state, "NOT_RECORDED");
  assert.equal(parsed.contactReview.consentBasis, "UNASSESSED");
  assert.equal(parsed.authority.qualificationAuthorized, false);
  assert.equal(parsed.authority.contactAuthorized, false);
  assert.equal(parsed.authority.outreachAuthorized, false);
  assert.equal(parsed.authority.sendAuthorized, false);
  assert.equal(parsed.authority.providerOperationsAuthorized, 0);
  assert.equal(parsed.authority.costAuthorizedUsd, 0);
  assert.deepEqual(projectPrivateKwM2OwnerLeadDetail(JSON.parse(JSON.stringify(plan))), parsed);
});

test("rejects a planner result that attempts to expose qualification or contact authority", async () => {
  const plan = await assessmentPlan();
  const tampered = structuredClone(plan) as typeof plan;
  tampered.assessment.scores.businessFit = 1;
  await assert.rejects(async () => projectPrivateKwM2OwnerLeadDetail(tampered), /digest|non-qualifying|zero|authority/i);
});
