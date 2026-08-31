import {
  REVENUE_CONTACT_EVIDENCE_VERSION,
} from "@/lib/revenue-engine/contact-discovery";
import {
  buildRevenueContactPersistencePlan,
} from "@/lib/revenue-engine/contact-persistence-plan";
import type {
  RevenueLeadAssessmentD1Boundary,
} from "@/lib/revenue-engine/lead-assessment-d1";
import {
  buildPrivateKwAssessmentProgressInput,
} from "@/lib/revenue-engine/private-kw-assessment-progress";
import {
  appendPrivateKwAssessmentProgress,
} from "@/lib/revenue-engine/private-kw-assessment-progress-append";
import {
  PRIVATE_KW_CONTACT_INVOCATION_APPROVAL_VERSION,
  PRIVATE_KW_CONTACT_REVIEW_VERSION,
  buildPrivateKwContactInvocation,
  buildPrivateKwContactInvocationReceiptRow,
  buildPrivateKwContactReview,
  type PrivateKwContactInvocationApproval,
  type PrivateKwContactReviewDraft,
} from "@/lib/revenue-engine/private-kw-contact-invocation";
import {
  PRIVATE_KW_CONTACT_INVOCATION_REQUIRED_TRIGGER_MARKERS,
  loadPrivateKwContactInvocationDurable,
} from "@/lib/revenue-engine/private-kw-contact-invocation-durable";
import {
  PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION,
  PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
  buildPrivateKwContactPersistencePlan,
} from "@/lib/revenue-engine/private-kw-contact-persistence";
import {
  PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
  appendPrivateKwShadowSliceProgress,
  buildInitialPrivateKwShadowSliceProgress,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import {
  buildPrivateKwSourceWorkflowProgressReceiptInput,
} from "@/lib/revenue-engine/private-kw-source-workflow-progress";
import {
  createPrivateKwAssessmentProgressProofFixture,
} from "@/lib/revenue-engine/test-support/private-kw-assessment-progress-proof-fixture";

type SqlRows = readonly Record<string, string | number | null>[];

export async function createPrivateKwContactReviewProgressProofFixture(options: {
  suffix?: string;
  now?: Date;
  contactDatabaseNowOffsetMs?: number;
} = {}) {
  const assessmentFixture = await createPrivateKwAssessmentProgressProofFixture({
    suffix: options.suffix ?? "contact-review-proof",
    now: options.now,
  });
  const target = assessmentFixture.source.records.find(
    (record) => record.business.id === assessmentFixture.assessment.business.id,
  );
  if (!target || !target.sourceRecord.websiteUrl) {
    throw new Error("Synthetic contact-review proof fixture lost its assessed source record.");
  }

  const sourceProgressInput = buildPrivateKwSourceWorkflowProgressReceiptInput({
    manifestValue: assessmentFixture.manifest,
    sourceValue: assessmentFixture.source,
    materializationValue: assessmentFixture.materialization,
    storedRecords: assessmentFixture.exactStoredRecords,
    recordedAt: assessmentFixture.recordedAt,
  });
  const sourceProgress = appendPrivateKwShadowSliceProgress(
    assessmentFixture.manifest,
    buildInitialPrivateKwShadowSliceProgress(assessmentFixture.manifest),
    sourceProgressInput,
  );
  const websiteReceipt = assessmentFixture.currentWebsitePhaseReceipt;
  const websiteProgress = appendPrivateKwShadowSliceProgress(
    assessmentFixture.manifest,
    sourceProgress,
    {
      receiptVersion: PRIVATE_KW_SHADOW_PHASE_RECEIPT_VERSION,
      manifestId: websiteReceipt.manifestId,
      manifestDigest: websiteReceipt.manifestDigest,
      businessId: websiteReceipt.businessId,
      evaluationCandidateId: websiteReceipt.evaluationCandidateId,
      phase: websiteReceipt.phase,
      completedAt: websiteReceipt.completedAt,
      proof: websiteReceipt.proof,
      previousPhaseReceipt: websiteReceipt.previousPhaseReceipt,
      recordedBy: websiteReceipt.recordedBy,
      recordedAt: websiteReceipt.recordedAt,
      authority: websiteReceipt.authority,
    },
  );
  const assessmentProgressInput = buildPrivateKwAssessmentProgressInput({
    manifestValue: assessmentFixture.manifest,
    previousProgressValue: websiteProgress,
    currentWebsiteEvidenceProofValue: assessmentFixture.evidenceProof,
    currentAssessmentResultValue: assessmentFixture.assessmentDurableReload,
  });
  const assessmentCheckpoint = appendPrivateKwAssessmentProgress({
    manifestValue: assessmentFixture.manifest,
    previousProgressValue: websiteProgress,
    phaseInputValue: assessmentProgressInput,
  });

  const assessedAtMs = Date.parse(assessmentFixture.assessment.assessedAt);
  const at = (offsetMs: number) => new Date(assessedAtMs + offsetMs).toISOString();
  const discoveryRequestedAt = at(70_000);
  const contactCapturedAt = at(80_000);
  const discoveryCompletedAt = at(90_000);
  const verificationRequestedAt = at(100_000);
  const verifiedAt = at(110_000);
  const verificationCompletedAt = at(120_000);
  const contactReviewedAt = at(150_000);
  const contactDatabaseNow = at(options.contactDatabaseNowOffsetMs ?? 180_000);
  const assessmentReference = {
    assessmentReceiptId: assessmentFixture.assessment.assessmentId,
    assessmentDigest: assessmentFixture.assessment.assessmentDigest,
    workflowReceiptId: assessmentFixture.assessment.workflow.workflowReceiptId,
    websiteSnapshotId: assessmentFixture.assessment.websiteSnapshotId,
    qualificationSnapshotId: assessmentFixture.assessment.qualificationSnapshotId,
  };
  const contactPageUrl = new URL("/contact", target.sourceRecord.websiteUrl).toString();
  const draft: PrivateKwContactReviewDraft = {
    reviewVersion: PRIVATE_KW_CONTACT_REVIEW_VERSION,
    sourceImportId: assessmentFixture.source.importId,
    sourcePlanDigest: assessmentFixture.manifest.sourcePlanDigest,
    businessId: target.business.id,
    evaluationCandidateId: target.evaluationCandidateId,
    assessment: assessmentReference,
    discovery: {
      requestedAt: discoveryRequestedAt,
      completedAt: discoveryCompletedAt,
      observations: [{
        channel: "EMAIL",
        value: "estimator@current-evidence.axiomfixtures.ca",
        label: "Published estimator address",
        personName: null,
        role: "Estimator",
        recipientKind: "ROLE",
        socialPlatform: null,
        evidence: {
          evidenceVersion: REVENUE_CONTACT_EVIDENCE_VERSION,
          sourceUrl: contactPageUrl,
          capturedAt: contactCapturedAt,
          method: "HTML_MAILTO",
          observation: "The synthetic contact page publishes one role-based estimator address.",
          confidence: 99,
          publication: {
            publiclyPublished: true,
            contraryContactStatement: "NOT_OBSERVED",
            roleRelevance: "RELEVANT",
            consentBasis: "UNASSESSED",
          },
        },
      }],
    },
    verifications: [{
      candidate: {
        channel: "EMAIL",
        value: "estimator@current-evidence.axiomfixtures.ca",
        socialPlatform: null,
      },
      requestedAt: verificationRequestedAt,
      completedAt: verificationCompletedAt,
      observation: {
        channel: "EMAIL",
        status: "DELIVERABLE",
        catchAll: false,
        provider: "FIXTURE",
        method: "FIXTURE_RECEIPT",
        evidenceReceiptId: `fixture-verification:${options.suffix ?? "contact-review-proof"}`,
        sourceUrl: `https://verification.axiomfixtures.ca/receipts/${options.suffix ?? "contact-review-proof"}`,
        verifiedAt,
        staleAfter: at(29 * 24 * 60 * 60_000),
        confidence: 99,
      },
    }],
    mode: "SHADOW",
    reviewOnly: true,
    databaseMutationAuthorized: false,
    contactDiscoveryExecutionAuthorized: false,
    contactVerificationExecutionAuthorized: false,
    consentDecisionAuthorized: false,
    qualificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
  const review = buildPrivateKwContactReview(
    assessmentFixture.source,
    assessmentFixture.assessment,
    draft,
  );
  const persistencePlan = buildRevenueContactPersistencePlan({
    discovery: review.discovery,
    verifications: review.verifications,
  });
  const approval: PrivateKwContactInvocationApproval = {
    approvalVersion: PRIVATE_KW_CONTACT_INVOCATION_APPROVAL_VERSION,
    reviewId: review.reviewId,
    reviewDigest: review.reviewDigest,
    sourcePlanDigest: assessmentFixture.manifest.sourcePlanDigest,
    businessId: target.business.id,
    assessment: assessmentReference,
    persistenceApproval: {
      materializationVersion: PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
      businessId: target.business.id,
      discoveryResultId: review.discovery.discoveryResultId,
      discoveryResultDigest: review.discovery.discoveryResultDigest,
      persistencePlanDigest: persistencePlan.planDigest,
      verificationResults: review.verifications.map((verification) => ({
        verificationResultId: verification.verificationResultId,
        verificationResultDigest: verification.verificationResultDigest,
      })),
      approval: {
        decision: "APPROVED_FOR_LOCAL_CONTACT_PERSISTENCE",
        reviewedBy: "RILEY",
        reviewedAt: contactReviewedAt,
        rationale: "Approved the exact synthetic contact evidence for durable proof verification.",
        confirmation: PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION,
      },
      mode: "SHADOW",
      executionKind: "IGNORED_LOCAL_SQLITE",
      localDatabaseAccessAuthorized: true,
      localContactMutationAuthorized: true,
      localVerificationMutationAuthorized: true,
      sourceMutationAuthorized: false,
      workflowMutationAuthorized: false,
      assessmentMutationAuthorized: false,
      schemaMutationAuthorized: false,
      captureAuthorized: false,
      contactDiscoveryAuthorized: false,
      contactVerificationAuthorized: false,
      consentDecisionAuthorized: false,
      qualificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
    localInvocationReceiptAuthorized: true,
    consentDecisionAuthorized: false,
    qualificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
  const invocation = buildPrivateKwContactInvocation(
    assessmentFixture.source,
    assessmentFixture.assessment,
    review,
    approval,
  );
  const contactPlan = buildPrivateKwContactPersistencePlan({
    discovery: review.discovery,
    verifications: review.verifications,
    approval: approval.persistenceApproval,
  });
  const sourceMaterializationRecord = assessmentFixture.plan.records.find(
    (record) => record.entity === "MATERIALIZATION_RECEIPT",
  );
  if (!sourceMaterializationRecord) {
    throw new Error("Synthetic contact-review proof fixture lost its source materialization receipt.");
  }

  const guardRows = Object.entries(PRIVATE_KW_CONTACT_INVOCATION_REQUIRED_TRIGGER_MARKERS)
    .sort(([left], [right]) => left.localeCompare(right, "en-CA"))
    .map(([name, marker]) => ({ name, sql: `CREATE TRIGGER ${name} ${marker}` }));
  const rowByStatementId = new Map<string, SqlRows>([
    ["read:contact_invocation_writer_guards", guardRows],
    ["read:contact_invocation_database_time", [{ databaseNow: contactDatabaseNow }]],
    ["read:durable_contact_invocation_receipt", [
      buildPrivateKwContactInvocationReceiptRow(invocation),
    ]],
    ["read:durable_contact_source_materialization", [sourceMaterializationRecord.expected]],
    ...contactPlan.records.map((record, index) => ([
      `read:durable_contact_plan:${index}:${record.entity}:${record.recordId}`,
      [record.expected],
    ] as const)),
  ]);

  function createContactBoundary(overrides: ReadonlyMap<string, SqlRows> = new Map()) {
    const boundary: RevenueLeadAssessmentD1Boundary = {
      async batch(statements) {
        const base = await assessmentFixture.assessmentBoundary.batch(statements);
        return statements.map((statement, index) => {
          const rows = overrides.has(statement.statementId)
            ? overrides.get(statement.statementId)!
            : rowByStatementId.get(statement.statementId);
          if (rows) return { success: true, results: rows, changes: 0 };
          return base[index];
        });
      },
    };
    return boundary;
  }

  const contactBoundary = createContactBoundary();
  const contactDurableReload = await loadPrivateKwContactInvocationDurable(
    contactBoundary,
    {
      invocationId: invocation.invocationId,
      invocationDigest: invocation.invocationDigest,
    },
  );

  return {
    ...assessmentFixture,
    sourceProgress,
    websiteProgress,
    assessmentProgressInput,
    assessmentCheckpoint,
    draft,
    review,
    approval,
    invocation,
    contactPlan,
    contactDatabaseNow,
    contactBoundary,
    contactDurableReload,
    rowByStatementId,
    createContactBoundary,
  };
}
