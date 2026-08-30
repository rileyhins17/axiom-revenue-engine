import {
  REVENUE_LEAD_ASSESSMENT_D1_EXECUTOR_VERSION,
  REVENUE_LEAD_ASSESSMENT_TARGET_SCHEMA_VERSION,
  RevenueLeadAssessmentD1ExecutionSchema,
} from "@/lib/revenue-engine/lead-assessment-d1";
import {
  REVENUE_LEAD_ASSESSMENT_VERSION,
  buildRevenueLeadAssessment,
  revenueLeadAssessmentCanonicalJson,
} from "@/lib/revenue-engine/lead-assessment";
import {
  buildPrivateKwCurrentWebsiteEvidenceProof,
} from "@/lib/revenue-engine/private-kw-current-website-evidence";
import {
  PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
  buildPrivateKwShadowSlicePhaseReceipt,
  privateKwShadowSliceProgressAuthority,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import { createPrivateKwCurrentWebsiteEvidenceFixture } from "@/lib/revenue-engine/test-support/private-kw-current-website-evidence-fixture";

export async function createPrivateKwAssessmentProgressProofFixture(options: {
  suffix?: string;
  now?: Date;
} = {}) {
  const current = await createPrivateKwCurrentWebsiteEvidenceFixture(options);
  const evidenceProof = buildPrivateKwCurrentWebsiteEvidenceProof({
    manifestValue: current.manifest,
    previousPhaseReceiptValue: current.previousPhaseReceipt,
    durableEvidenceRequestValue: current.durableEvidenceRequest,
    availabilityReceiptValues: current.availabilityReceipts,
    preparedAt: current.preparedAt,
  });
  const eligibilityReceiptDigest = evidenceProof.proofDigest;
  const currentWebsitePhaseReceipt = buildPrivateKwShadowSlicePhaseReceipt(current.manifest, {
    receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
    manifestId: current.manifest.manifestId,
    manifestDigest: current.manifest.manifestDigest,
    businessId: current.manifestRecord.businessId,
    evaluationCandidateId: current.manifestRecord.evaluationCandidateId,
    phase: "CURRENT_WEBSITE_EVIDENCE",
    completedAt: evidenceProof.workflow.completedAt,
    proof: {
      proofKind: "CURRENT_WEBSITE_EVIDENCE",
      primaryReceiptId: evidenceProof.proofId,
      primaryReceiptDigest: evidenceProof.proofDigest,
      supportingReceipts: [{
        receiptId: `website-evidence-eligibility:${eligibilityReceiptDigest}`,
        receiptDigest: eligibilityReceiptDigest,
      }],
    },
    previousPhaseReceipt: {
      phaseReceiptId: current.previousPhaseReceipt.phaseReceiptId,
      phaseReceiptDigest: current.previousPhaseReceipt.phaseReceiptDigest,
    },
    recordedBy: "CODEX_INTEGRATION_OWNER",
    recordedAt: current.preparedAt,
    authority: privateKwShadowSliceProgressAuthority(),
  });
  const assessedAt = new Date(Date.parse(current.preparedAt) + 60_000).toISOString();
  const proofPreparedAt = new Date(Date.parse(assessedAt) + 60_000).toISOString();
  if (current.workflowReceipt.status !== "COMPLETED") {
    throw new Error("Synthetic assessment progress fixture requires a completed website workflow.");
  }
  const receiptJson = revenueLeadAssessmentCanonicalJson(current.workflowReceipt);
  const assessment = buildRevenueLeadAssessment({
    request: {
      assessmentVersion: REVENUE_LEAD_ASSESSMENT_VERSION,
      idempotencyKey: `kw-assessment-progress:${options.suffix ?? "fixture"}`,
      workflowReceiptId: evidenceProof.workflow.receiptId,
      assessedAt,
      mode: "SHADOW",
      businessFitScore: 80,
      timingScore: 25,
      basisClaims: [{
        basisId: "basis:business-fit",
        dimension: "BUSINESS_FIT",
        observation: "The reviewed synthetic source identifies an independent local roofing operator.",
        sourceUrl: current.manifestRecord.sourceEvidenceUrl,
        capturedAt: current.workflowReceipt.audit?.capturedAt ?? current.workflowReceipt.completedAt,
        method: "owner_review",
        confidence: 100,
      }, {
        basisId: "basis:timing",
        dimension: "TIMING",
        observation: "No synthetic timing event is supported, so timing remains conservative.",
        sourceUrl: current.manifestRecord.sourceEvidenceUrl,
        capturedAt: current.workflowReceipt.audit?.capturedAt ?? current.workflowReceipt.completedAt,
        method: "owner_review",
        confidence: 100,
      }],
      policyBlocks: [],
    },
    business: {
      id: current.manifestRecord.businessId,
      canonicalName: current.manifestRecord.businessName,
      independenceStatus: "INDEPENDENT",
      status: "RESEARCH_ONLY",
    },
    sealedReceipt: {
      workflowReceiptId: evidenceProof.workflow.receiptId,
      workflowRunId: current.workflowReceipt.workflowId,
      rowWorkflowVersion: current.workflowReceipt.workflowVersion,
      rowStatus: current.workflowReceipt.status,
      receiptDigest: evidenceProof.workflow.receiptDigest,
      receiptJson,
      recordedAt: current.durableEvidenceRequest.plannedAt,
      closureStatus: "SEALED",
      terminalReceiptId: evidenceProof.workflow.receiptId,
    },
  });
  const assessmentExecution = RevenueLeadAssessmentD1ExecutionSchema.parse({
    executorVersion: REVENUE_LEAD_ASSESSMENT_D1_EXECUTOR_VERSION,
    targetSchemaVersion: REVENUE_LEAD_ASSESSMENT_TARGET_SCHEMA_VERSION,
    executionPath: "FRESH_COMMIT",
    transactionApi: "D1Database.batch",
    assessment,
    insertedRows: {
      websiteSnapshots: 1,
      evidenceClaims: assessment.audit.claims.length,
      qualificationSnapshots: 1,
      assessmentReceipts: 1,
    },
    committedAndReloaded: true,
    runtimeConnected: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });

  return {
    ...current,
    evidenceProof,
    currentWebsitePhaseReceipt,
    assessment,
    assessmentExecution,
    proofPreparedAt,
  };
}
