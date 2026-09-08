import {
  loadPrivateRevenueLeadAssessmentD1,
  type RevenueLeadAssessmentD1Boundary,
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
  databaseNowOffsetMs?: number;
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
  const databaseNow = new Date(
    Date.parse(assessedAt) + (options.databaseNowOffsetMs ?? 60_000),
  ).toISOString();
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
  const receiptRow = {
    id: assessment.assessmentId,
    assessmentVersion: assessment.assessmentVersion,
    assessmentKey: assessment.assessmentKey,
    businessId: assessment.business.id,
    workflowReceiptId: assessment.workflow.workflowReceiptId,
    websiteSnapshotId: assessment.websiteSnapshotId,
    qualificationSnapshotId: assessment.qualificationSnapshotId,
    auditDigest: assessment.auditDigest,
    qualificationDigest: assessment.qualificationDigest,
    basisDigest: assessment.basisDigest,
    evidenceClaimCount: assessment.audit.claims.length,
    assessmentDigest: assessment.assessmentDigest,
    assessmentJson: revenueLeadAssessmentCanonicalJson(assessment),
    recordedAt: assessment.assessedAt,
    mode: "SHADOW",
    transactionKind: "D1_BATCH",
    outreachAuthorized: 0,
    sendAuthorized: 0,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
  const websiteRow = {
    id: assessment.websiteSnapshotId,
    businessId: assessment.business.id,
    url: assessment.websiteUrl,
    finalUrl: assessment.audit.finalUrl,
    classification: assessment.audit.classification,
    auditVersion: assessment.audit.auditVersion,
    desktopArtifactRef: assessment.audit.desktopArtifactRef,
    mobileArtifactRef: assessment.audit.mobileArtifactRef,
    domArtifactRef: assessment.audit.domArtifactRef,
    deterministicChecksJson: revenueLeadAssessmentCanonicalJson(assessment.audit),
    capturedAt: assessment.audit.capturedAt,
    refreshAfter: assessment.refreshAfter,
  };
  const evidenceRows = assessment.audit.claims.map((claim) => ({
    id: claim.claimId,
    businessId: assessment.business.id,
    websiteSnapshotId: assessment.websiteSnapshotId,
    category: claim.category,
    observation: claim.observation,
    sourceUrl: claim.sourceUrl,
    artifactRef: claim.artifactRef,
    method: claim.method,
    confidence: claim.confidence,
    conversionCritical: claim.conversionCritical ? 1 : 0,
    auditVersion: claim.auditVersion,
    capturedAt: claim.capturedAt,
  }));
  const qualificationRow = {
    id: assessment.qualificationSnapshotId,
    snapshotKey: assessment.qualificationSnapshotKey,
    businessId: assessment.business.id,
    policyVersion: assessment.qualification.policyVersion,
    shadowOnly: 1,
    totalScore: assessment.qualification.totalScore,
    rebuildNeedScore: assessment.qualification.scores.rebuildNeed,
    businessFitScore: assessment.qualification.scores.businessFit,
    reachabilityScore: assessment.qualification.scores.reachability,
    timingScore: assessment.qualification.scores.timing,
    evidenceConfidenceScore: assessment.qualification.scores.evidenceConfidence,
    band: assessment.qualification.band,
    recommendedChannel: assessment.qualification.recommendedChannel,
    supportedObservationCount: assessment.qualification.supportedObservationCount,
    conversionCriticalCount: assessment.qualification.conversionCriticalCount,
    failedGatesJson: revenueLeadAssessmentCanonicalJson(assessment.qualification.failedGates),
    evidenceClaimIdsJson: revenueLeadAssessmentCanonicalJson(assessment.qualification.evidenceClaimIds),
    createdAt: assessment.assessedAt,
  };
  const triggerNames = [
    "RevenueWebsiteSnapshot_assessment_immutable_update",
    "RevenueWebsiteSnapshot_assessment_immutable_delete",
    "RevenueEvidenceClaim_assessment_immutable_update",
    "RevenueEvidenceClaim_assessment_immutable_delete",
    "RevenueQualificationSnapshot_assessment_immutable_update",
    "RevenueQualificationSnapshot_assessment_immutable_delete",
    "RevenueLeadAssessmentReceipt_immutable_update",
    "RevenueLeadAssessmentReceipt_immutable_delete",
  ].sort((left, right) => left.localeCompare(right, "en-CA"));
  const rowByStatementId = new Map<string, readonly Record<string, string | number | null>[]>([
    ["read:assessment_writer_guards", triggerNames.map((name) => ({
      name,
      sql: `CREATE TRIGGER ${name} REVENUE_LEAD_ASSESSMENT_APPEND_ONLY`,
    }))],
    ["read:assessment_database_time", [{ databaseNow }]],
    ["read:durable_assessment_receipt", [receiptRow]],
    ["read:sealed_workflow_receipt", [{
      workflowReceiptId: evidenceProof.workflow.receiptId,
      workflowRunId: current.workflowReceipt.workflowId,
      rowWorkflowVersion: current.workflowReceipt.workflowVersion,
      rowStatus: current.workflowReceipt.status,
      receiptDigest: evidenceProof.workflow.receiptDigest,
      receiptJson,
      recordedAt: current.durableEvidenceRequest.plannedAt,
      closureStatus: "SEALED",
      terminalReceiptId: evidenceProof.workflow.receiptId,
    }]],
    ["read:assessment_business", [{
      id: assessment.business.id,
      canonicalName: assessment.business.canonicalName,
      independenceStatus: assessment.business.independenceStatus,
      status: assessment.business.status,
    }]],
    ["read:complete_assessment_evidence_claims", [...evidenceRows].sort((left, right) => (
      left.id.localeCompare(right.id, "en-CA")
    ))],
    [`select:website_snapshot:${assessment.websiteSnapshotId}`, [websiteRow]],
    [`select:qualification_snapshot:${assessment.qualificationSnapshotId}`, [qualificationRow]],
    [`select:assessment_receipt:${assessment.assessmentId}`, [receiptRow]],
    ...evidenceRows.map((row) => [`select:evidence_claim:${row.id}`, [row]] as const),
  ]);
  const boundary: RevenueLeadAssessmentD1Boundary = {
    async batch(statements) {
      return statements.map((item) => ({
        success: true,
        results: rowByStatementId.get(item.statementId) ?? [],
        changes: 0,
      }));
    },
  };
  const assessmentDurableReload = await loadPrivateRevenueLeadAssessmentD1(boundary, {
    assessmentId: assessment.assessmentId,
    assessmentDigest: assessment.assessmentDigest,
  });

  return {
    ...current,
    evidenceProof,
    currentWebsitePhaseReceipt,
    assessment,
    assessmentBoundary: boundary,
    assessmentDurableReload,
    proofPreparedAt,
  };
}
