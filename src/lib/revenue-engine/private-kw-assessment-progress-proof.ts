import { z } from "zod";

import {
  RevenueLeadAssessmentD1DurableReloadSchema,
  requireCurrentRevenueLeadAssessmentD1DurableReload,
} from "@/lib/revenue-engine/lead-assessment-d1";
import {
  revenueLeadAssessmentDigest,
} from "@/lib/revenue-engine/lead-assessment";
import {
  PrivateKwCurrentWebsiteEvidenceProofSchema,
} from "@/lib/revenue-engine/private-kw-current-website-evidence";
import {
  requireCurrentPrivateKwWebsiteEvidenceEligibilityD1Result,
} from "@/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1";
import {
  PrivateKwShadowSliceManifestSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PrivateKwShadowSlicePhaseReceiptSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";

export const PRIVATE_KW_ASSESSMENT_PROGRESS_PROOF_VERSION = "kw-assessment-progress-proof-v1";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const IdentitySchema = z.string().trim().min(1).max(200);

const AssessmentProgressAuthoritySchema = z.object({
  syntheticContractProofOnly: z.literal(true),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  databaseReadAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  websiteCaptureAuthorized: z.literal(false),
  artifactStorageAuthorized: z.literal(false),
  qualificationExecutionAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  contactVerificationAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const AssessmentProgressProofCoreSchema = z.object({
  proofVersion: z.literal(PRIVATE_KW_ASSESSMENT_PROGRESS_PROOF_VERSION),
  proofKind: z.literal("ASSESSMENT_PROGRESS_PROOF"),
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  businessId: IdentitySchema,
  evaluationCandidateId: IdentitySchema,
  sourceRecordId: IdentitySchema,
  previousPhaseReceipt: z.object({
    phaseReceiptId: z.string().regex(/^kw-shadow-phase:[a-f0-9]{64}$/),
    phaseReceiptDigest: Sha256Schema,
    completedAt: TimestampSchema,
    recordedAt: TimestampSchema,
  }).strict(),
  currentWebsiteEvidence: z.object({
    proofId: z.string().regex(/^website-evidence:[a-f0-9]{64}$/),
    proofDigest: Sha256Schema,
    eligibilityReceiptId: z.string().regex(/^website-evidence-eligibility:[a-f0-9]{64}$/),
    eligibilityReceiptDigest: Sha256Schema,
    workflowReceiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/),
    workflowReceiptDigest: Sha256Schema,
    workflowId: z.string().uuid(),
    auditDigest: Sha256Schema,
    evidenceFreshThrough: TimestampSchema,
  }).strict(),
  assessment: z.object({
    assessmentId: z.string().regex(/^assessment:[a-f0-9]{64}$/),
    assessmentKey: IdentitySchema,
    assessmentDigest: Sha256Schema,
    websiteSnapshotId: z.string().regex(/^website:[a-f0-9]{64}$/),
    qualificationSnapshotId: z.string().regex(/^qualification:[a-f0-9]{64}$/),
    qualificationSnapshotKey: z.string().regex(/^qualification-key:[a-f0-9]{64}$/),
    auditDigest: Sha256Schema,
    qualificationDigest: Sha256Schema,
    basisDigest: Sha256Schema,
    qualificationBand: z.enum(["PRIORITY", "REVIEW", "RESEARCH", "DISQUALIFIED"]),
    totalScore: z.number().int().min(0).max(100),
    supportedObservationCount: z.number().int().nonnegative().max(100),
    conversionCriticalCount: z.number().int().nonnegative().max(100),
    assessedAt: TimestampSchema,
    refreshAfter: TimestampSchema,
  }).strict(),
  persistence: z.object({
    executorVersion: IdentitySchema,
    targetSchemaVersion: IdentitySchema,
    executionPath: z.literal("DURABLE_RELOAD"),
    transactionApi: z.literal("D1Database.batch"),
    reloadedRows: z.object({
      websiteSnapshots: z.literal(1),
      evidenceClaims: z.number().int().min(0).max(100),
      qualificationSnapshots: z.literal(1),
      assessmentReceipts: z.literal(1),
    }).strict(),
    assessmentReceiptRecordedAt: TimestampSchema,
    databaseNow: TimestampSchema,
    freshnessState: z.literal("CURRENT"),
    exactSourceRebuilt: z.literal(true),
    immutableWriterGuardsVerified: z.literal(true),
    committedAndReloaded: z.literal(true),
  }).strict(),
  preparedAt: TimestampSchema,
  requiredProgressSupportingReceiptKind: z.literal("ASSESSMENT_PROOF"),
  authority: AssessmentProgressAuthoritySchema,
}).strict();

export const PrivateKwAssessmentProgressProofSchema = AssessmentProgressProofCoreSchema.extend({
  proofId: z.string().regex(/^assessment-proof:[a-f0-9]{64}$/),
  proofDigest: Sha256Schema,
}).strict().superRefine((proof, context) => {
  const { proofId: _proofId, proofDigest: _proofDigest, ...core } = proof;
  void _proofId;
  void _proofDigest;
  const expectedDigest = revenueLeadAssessmentDigest(core);
  if (proof.proofDigest !== expectedDigest || proof.proofId !== `assessment-proof:${expectedDigest}`) {
    context.addIssue({
      code: "custom",
      message: "Assessment progress proof identity must bind its exact assessment, persistence, evidence, and phase lineage.",
      path: ["proofDigest"],
    });
  }
});

export type PrivateKwAssessmentProgressProof = z.infer<
  typeof PrivateKwAssessmentProgressProofSchema
>;

export function privateKwAssessmentProgressAuthority() {
  return AssessmentProgressAuthoritySchema.parse({
    syntheticContractProofOnly: true,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    databaseReadAuthorized: false,
    databaseMutationAuthorized: false,
    websiteCaptureAuthorized: false,
    artifactStorageAuthorized: false,
    qualificationExecutionAuthorized: false,
    contactDiscoveryAuthorized: false,
    contactVerificationAuthorized: false,
    consentDecisionAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

function assertAssessmentIdentity(assessment: z.infer<typeof RevenueLeadAssessmentD1DurableReloadSchema>["assessment"]) {
  if (assessment.assessmentId !== `assessment:${revenueLeadAssessmentDigest(assessment.assessmentKey)}`) {
    throw new Error("Assessment identity must bind its exact idempotency key.");
  }
  const auditDigest = revenueLeadAssessmentDigest(assessment.audit);
  const qualificationDigest = revenueLeadAssessmentDigest(assessment.qualification);
  const basisDigest = revenueLeadAssessmentDigest({
    basisClaims: assessment.basisClaims,
    businessFitScore: assessment.qualification.scores.businessFit,
    timingScore: assessment.qualification.scores.timing,
    policyBlocks: assessment.policyBlocks,
  });
  const qualificationSnapshotId = `qualification:${revenueLeadAssessmentDigest({
    idempotencyKey: assessment.assessmentKey,
    qualificationDigest,
  })}`;
  if (
    assessment.auditDigest !== auditDigest
    || assessment.qualificationDigest !== qualificationDigest
    || assessment.basisDigest !== basisDigest
    || assessment.websiteSnapshotId !== `website:${auditDigest}`
    || assessment.qualificationSnapshotId !== qualificationSnapshotId
    || assessment.qualificationSnapshotKey !== `qualification-key:${revenueLeadAssessmentDigest(assessment.assessmentKey)}`
  ) {
    throw new Error("Assessment snapshots and digests must derive from the exact persisted assessment content.");
  }
  const { assessmentDigest: _assessmentDigest, ...core } = assessment;
  void _assessmentDigest;
  if (assessment.assessmentDigest !== revenueLeadAssessmentDigest(core)) {
    throw new Error("Assessment digest must bind the exact persisted assessment.");
  }
  const auditClaims = [...assessment.audit.claims.map((claim) => claim.claimId)].sort();
  const qualificationClaims = [...assessment.qualification.evidenceClaimIds].sort();
  if (
    auditClaims.length !== qualificationClaims.length
    || auditClaims.some((claimId, index) => claimId !== qualificationClaims[index])
  ) {
    throw new Error("Assessment qualification must retain the exact deterministic audit claim set.");
  }
}

type AssessmentProgressProofInput = {
  manifestValue: unknown;
  previousPhaseReceiptValue: unknown;
  currentWebsiteEvidenceProofValue: unknown;
  assessmentDurableReloadValue: unknown;
};

function buildPrivateKwAssessmentProgressProofInternal(
  input: AssessmentProgressProofInput,
  expectedPreviousCompletionAt: string,
): PrivateKwAssessmentProgressProof {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const previous = PrivateKwShadowSlicePhaseReceiptSchema.parse(input.previousPhaseReceiptValue);
  const evidence = PrivateKwCurrentWebsiteEvidenceProofSchema.parse(input.currentWebsiteEvidenceProofValue);
  const execution = requireCurrentRevenueLeadAssessmentD1DurableReload(input.assessmentDurableReloadValue);
  const preparedAt = execution.databaseNow;
  const assessment = execution.assessment;

  if (
    previous.phase !== "CURRENT_WEBSITE_EVIDENCE"
    || previous.completedCheckpoint !== "CURRENT_WEBSITE_EVIDENCE_PERSISTED"
    || previous.manifestId !== manifest.manifestId
    || previous.manifestDigest !== manifest.manifestDigest
  ) {
    throw new Error("Assessment progress proof requires the exact completed current-website-evidence predecessor.");
  }
  const manifestRecord = manifest.records.find((record) => record.businessId === previous.businessId);
  if (
    !manifestRecord
    || manifestRecord.evaluationCandidateId !== previous.evaluationCandidateId
    || manifestRecord.businessId !== evidence.businessId
    || manifestRecord.evaluationCandidateId !== evidence.evaluationCandidateId
    || manifestRecord.sourceRecordId !== evidence.sourceRecordId
    || evidence.manifestId !== manifest.manifestId
    || evidence.manifestDigest !== manifest.manifestDigest
  ) {
    throw new Error("Assessment, evidence, and predecessor must identify one exact reviewed manifest business.");
  }
  const eligibility = previous.proof.supportingReceipts[0];
  if (
    previous.proof.primaryReceiptId !== evidence.proofId
    || previous.proof.primaryReceiptDigest !== evidence.proofDigest
    || previous.proof.supportingReceipts.length !== 1
    || !eligibility
    || !eligibility.receiptId.startsWith("website-evidence-eligibility:")
  ) {
    throw new Error("Assessment predecessor must bind the exact website evidence proof and separate eligibility receipt.");
  }
  if (
    previous.previousPhaseReceipt?.phaseReceiptId !== evidence.previousPhaseReceipt.phaseReceiptId
    || previous.previousPhaseReceipt.phaseReceiptDigest !== evidence.previousPhaseReceipt.phaseReceiptDigest
  ) {
    throw new Error("Assessment predecessor must preserve the website evidence proof's exact source/workflow lineage.");
  }
  if (
    assessment.business.id !== manifestRecord.businessId
    || assessment.business.canonicalName !== manifestRecord.businessName
    || assessment.business.independenceStatus !== "INDEPENDENT"
    || assessment.business.status !== "RESEARCH_ONLY"
  ) {
    throw new Error("Assessment business identity and shadow status must match the exact reviewed manifest record.");
  }
  if (
    assessment.workflow.workflowReceiptId !== evidence.workflow.receiptId
    || assessment.workflow.receiptDigest !== evidence.workflow.receiptDigest
    || assessment.workflow.workflowRunId !== evidence.workflow.workflowId
    || assessment.workflow.completedAt !== evidence.workflow.completedAt
    || assessment.auditDigest !== evidence.workflow.auditDigest
    || assessment.websiteUrl !== evidence.audit.finalUrl
    || assessment.audit.classification !== evidence.audit.classification
    || assessment.audit.rebuildNeedScore !== evidence.audit.rebuildNeedScore
    || assessment.audit.evidenceConfidence !== evidence.audit.evidenceConfidence
  ) {
    throw new Error("Assessment must bind the exact current website workflow, audit, and evidence proof.");
  }
  if (
    previous.completedAt !== expectedPreviousCompletionAt
    || Date.parse(previous.recordedAt) < Date.parse(evidence.preparedAt)
    || Date.parse(assessment.assessedAt) < Date.parse(previous.recordedAt)
    || Date.parse(execution.assessmentReceiptRecordedAt) < Date.parse(assessment.assessedAt)
    || Date.parse(preparedAt) < Date.parse(execution.assessmentReceiptRecordedAt)
    || Date.parse(preparedAt) >= Date.parse(evidence.evidenceFreshThrough)
    || Date.parse(preparedAt) >= Date.parse(assessment.refreshAfter)
  ) {
    throw new Error("Website evidence, phase recording, assessment, and proof preparation must be ordered and fresh.");
  }

  assertAssessmentIdentity(assessment);

  const core = AssessmentProgressProofCoreSchema.parse({
    proofVersion: PRIVATE_KW_ASSESSMENT_PROGRESS_PROOF_VERSION,
    proofKind: "ASSESSMENT_PROGRESS_PROOF",
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    businessId: manifestRecord.businessId,
    evaluationCandidateId: manifestRecord.evaluationCandidateId,
    sourceRecordId: manifestRecord.sourceRecordId,
    previousPhaseReceipt: {
      phaseReceiptId: previous.phaseReceiptId,
      phaseReceiptDigest: previous.phaseReceiptDigest,
      completedAt: previous.completedAt,
      recordedAt: previous.recordedAt,
    },
    currentWebsiteEvidence: {
      proofId: evidence.proofId,
      proofDigest: evidence.proofDigest,
      eligibilityReceiptId: eligibility.receiptId,
      eligibilityReceiptDigest: eligibility.receiptDigest,
      workflowReceiptId: evidence.workflow.receiptId,
      workflowReceiptDigest: evidence.workflow.receiptDigest,
      workflowId: evidence.workflow.workflowId,
      auditDigest: evidence.workflow.auditDigest,
      evidenceFreshThrough: evidence.evidenceFreshThrough,
    },
    assessment: {
      assessmentId: assessment.assessmentId,
      assessmentKey: assessment.assessmentKey,
      assessmentDigest: assessment.assessmentDigest,
      websiteSnapshotId: assessment.websiteSnapshotId,
      qualificationSnapshotId: assessment.qualificationSnapshotId,
      qualificationSnapshotKey: assessment.qualificationSnapshotKey,
      auditDigest: assessment.auditDigest,
      qualificationDigest: assessment.qualificationDigest,
      basisDigest: assessment.basisDigest,
      qualificationBand: assessment.qualification.band,
      totalScore: assessment.qualification.totalScore,
      supportedObservationCount: assessment.qualification.supportedObservationCount,
      conversionCriticalCount: assessment.qualification.conversionCriticalCount,
      assessedAt: assessment.assessedAt,
      refreshAfter: assessment.refreshAfter,
    },
    persistence: {
      executorVersion: execution.executorVersion,
      targetSchemaVersion: execution.targetSchemaVersion,
      executionPath: execution.executionPath,
      transactionApi: execution.transactionApi,
      reloadedRows: execution.reloadedRows,
      assessmentReceiptRecordedAt: execution.assessmentReceiptRecordedAt,
      databaseNow: execution.databaseNow,
      freshnessState: execution.freshnessState,
      exactSourceRebuilt: execution.exactSourceRebuilt,
      immutableWriterGuardsVerified: execution.immutableWriterGuardsVerified,
      committedAndReloaded: execution.committedAndReloaded,
    },
    preparedAt,
    requiredProgressSupportingReceiptKind: "ASSESSMENT_PROOF",
    authority: privateKwAssessmentProgressAuthority(),
  });
  const proofDigest = revenueLeadAssessmentDigest(core);
  return PrivateKwAssessmentProgressProofSchema.parse({
    ...core,
    proofId: `assessment-proof:${proofDigest}`,
    proofDigest,
  });
}

export function buildPrivateKwAssessmentProgressProof(input: AssessmentProgressProofInput): PrivateKwAssessmentProgressProof {
  return buildPrivateKwAssessmentProgressProofInternal(input, PrivateKwCurrentWebsiteEvidenceProofSchema.parse(input.currentWebsiteEvidenceProofValue).workflow.completedAt);
}

/**
 * Rebuilds assessment proof for the persisted Task 4B1 website checkpoint.
 * That checkpoint's phase completion is the durable eligibility receipt
 * timestamp, while the ordinary proof path binds completion to workflow
 * completion. The caller must supply the exact trusted durable eligibility
 * reload; its receipt timestamp is derived internally and the existing
 * workflow-equality path remains unchanged.
 */
export function buildPrivateKwAssessmentProgressProofForPersistedWebsiteCheckpoint(input: AssessmentProgressProofInput & {
  currentWebsiteEligibilityResultValue: unknown;
}): PrivateKwAssessmentProgressProof {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const previous = PrivateKwShadowSlicePhaseReceiptSchema.parse(input.previousPhaseReceiptValue);
  const evidence = PrivateKwCurrentWebsiteEvidenceProofSchema.parse(input.currentWebsiteEvidenceProofValue);
  const eligibility = requireCurrentPrivateKwWebsiteEvidenceEligibilityD1Result(input.currentWebsiteEligibilityResultValue);
  const supportingEligibility = previous.proof.supportingReceipts[0];
  if (
    eligibility.executionPath !== "DURABLE_RELOAD"
    || !supportingEligibility
    || eligibility.receipt.receiptId !== supportingEligibility.receiptId
    || eligibility.receipt.receiptDigest !== supportingEligibility.receiptDigest
    || eligibility.receipt.manifestId !== manifest.manifestId
    || eligibility.receipt.manifestDigest !== manifest.manifestDigest
    || eligibility.receipt.businessId !== evidence.businessId
    || eligibility.receipt.evaluationCandidateId !== evidence.evaluationCandidateId
    || eligibility.receipt.sourceRecordId !== evidence.sourceRecordId
    || eligibility.receipt.websiteEvidence.proofId !== evidence.proofId
    || eligibility.receipt.websiteEvidence.proofDigest !== evidence.proofDigest
    || eligibility.receipt.websiteEvidence.workflowReceiptId !== evidence.workflow.receiptId
    || eligibility.receipt.persistedWorkflow.workflowReceiptDigest !== evidence.workflow.receiptDigest
  ) {
    throw new Error("Persisted website checkpoint completion must come from its exact durable eligibility reload.");
  }
  return buildPrivateKwAssessmentProgressProofInternal(input, TimestampSchema.parse(eligibility.receiptRecordedAt));
}
