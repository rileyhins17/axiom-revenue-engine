import { z } from "zod";

import {
  requireInProcessPrivateKwAssessmentProgressCheckpoint,
} from "@/lib/revenue-engine/private-kw-assessment-progress-append";
import {
  requireCurrentPrivateKwContactInvocationDurableReload,
} from "@/lib/revenue-engine/private-kw-contact-invocation-durable";
import {
  contactDiscoveryDigest,
} from "@/lib/revenue-engine/contact-discovery";
import {
  PrivateKwShadowSliceManifestSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  privateKwShadowSliceProgressDigest,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";

export const PRIVATE_KW_CONTACT_REVIEW_PROGRESS_PROOF_VERSION =
  "kw-contact-review-progress-proof-v1";

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IdentitySchema = z.string().trim().min(1).max(200);

const ContactReviewProgressAuthoritySchema = z.object({
  syntheticContractProofOnly: z.literal(true),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  databaseReadAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  contactDiscoveryExecutionAuthorized: z.literal(false),
  contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const ContactReviewProgressProofCoreSchema = z.object({
  proofVersion: z.literal(PRIVATE_KW_CONTACT_REVIEW_PROGRESS_PROOF_VERSION),
  proofKind: z.literal("CONTACT_REVIEW_PROGRESS_PROOF"),
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  sourceImportId: IdentitySchema,
  sourcePlanDigest: Sha256Schema,
  businessId: IdentitySchema,
  evaluationCandidateId: IdentitySchema,
  sourceRecordId: IdentitySchema,
  previousPhaseReceipt: z.object({
    phaseReceiptId: z.string().regex(/^kw-shadow-phase:[a-f0-9]{64}$/),
    phaseReceiptDigest: Sha256Schema,
    assessmentReceiptId: z.string().regex(/^assessment:[a-f0-9]{64}$/),
    assessmentDigest: Sha256Schema,
    assessmentProofId: z.string().regex(/^assessment-proof:[a-f0-9]{64}$/),
    assessmentProofDigest: Sha256Schema,
    completedAt: TimestampSchema,
    recordedAt: TimestampSchema,
  }).strict(),
  sourceMaterialization: z.object({
    materializationId: z.string().regex(/^kw-materialization:[a-f0-9]{64}$/),
    materializationDigest: Sha256Schema,
    workflowReceiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/),
    workflowRunId: z.string().uuid(),
    recordedAt: TimestampSchema,
  }).strict(),
  contactInvocation: z.object({
    invocationId: z.string().regex(/^kw-contact-invocation:[a-f0-9]{64}$/),
    invocationDigest: Sha256Schema,
    reviewId: z.string().regex(/^kw-contact-review:[a-f0-9]{64}$/),
    reviewDigest: Sha256Schema,
    contactMaterializationId: z.string().regex(/^kw-contact-persistence:[a-f0-9]{64}$/),
    contactMaterializationDigest: Sha256Schema,
    discoveryReceiptId: z.string().regex(/^contact-discovery-result:[a-f0-9]{64}$/),
    discoveryResultDigest: Sha256Schema,
    invocationReceiptRecordedAt: TimestampSchema,
    evidenceFreshThrough: TimestampSchema,
  }).strict(),
  persistence: z.object({
    durableVersion: IdentitySchema,
    targetSchemaVersion: IdentitySchema,
    executionPath: z.literal("DURABLE_RELOAD"),
    transactionApi: z.literal("RevenueLeadAssessmentD1Boundary.batch"),
    databaseNow: TimestampSchema,
    freshnessState: z.literal("CURRENT"),
    reloadedRows: z.object({
      sourceMaterializationReceipts: z.literal(1),
      assessmentReceipts: z.literal(1),
      discoveryReceipts: z.literal(1),
      contactPointVersions: z.number().int().min(0).max(25),
      evidenceClaims: z.number().int().min(0).max(500),
      evidenceUses: z.number().int().min(0).max(500),
      verificationResults: z.number().int().min(0).max(250),
      contactMaterializationReceipts: z.literal(1),
      contactInvocationReceipts: z.literal(1),
    }).strict(),
    exactAssessmentReloaded: z.literal(true),
    exactContactPlanRebuilt: z.literal(true),
    immutableWriterGuardsVerified: z.literal(true),
    committedAndReloaded: z.literal(true),
    databaseReadPerformed: z.literal(true),
    databaseMutationPerformed: z.literal(false),
  }).strict(),
  preparedAt: TimestampSchema,
  requiredProgressPrimaryReceiptKind: z.literal("OWNER_REVIEWED_CONTACT_INVOCATION"),
  requiredProgressSupportingReceiptKind: z.literal("CONTACT_REVIEW_PROOF"),
  authority: ContactReviewProgressAuthoritySchema,
}).strict();

export const PrivateKwContactReviewProgressProofSchema =
  ContactReviewProgressProofCoreSchema.extend({
    proofId: z.string().regex(/^contact-review-proof:[a-f0-9]{64}$/),
    proofDigest: Sha256Schema,
  }).strict().superRefine((proof, context) => {
    const { proofId: _proofId, proofDigest: _proofDigest, ...core } = proof;
    void _proofId;
    void _proofDigest;
    const expected = contactDiscoveryDigest(core);
    if (
      proof.proofDigest !== expected
      || proof.proofId !== `contact-review-proof:${expected}`
    ) {
      context.addIssue({
        code: "custom",
        message: "Contact-review progress proof identity must bind the exact assessment predecessor and durable contact invocation.",
        path: ["proofDigest"],
      });
    }
  });

export type PrivateKwContactReviewProgressProof = z.infer<
  typeof PrivateKwContactReviewProgressProofSchema
>;

export function privateKwContactReviewProgressAuthority() {
  return ContactReviewProgressAuthoritySchema.parse({
    syntheticContractProofOnly: true,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    databaseReadAuthorized: false,
    databaseMutationAuthorized: false,
    contactDiscoveryExecutionAuthorized: false,
    contactVerificationExecutionAuthorized: false,
    consentDecisionAuthorized: false,
    qualificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

function exactScope(value: readonly {
  businessId: string;
  evaluationCandidateId: string;
  sourceRecordId: string;
}[]) {
  return value.map((record) => ({
    businessId: record.businessId,
    evaluationCandidateId: record.evaluationCandidateId,
    sourceRecordId: record.sourceRecordId,
  }));
}

/**
 * Builds a content-addressed CONTACT_REVIEW proof from one exact trusted
 * assessment checkpoint and one exact current durable invocation reload. It
 * creates no phase input, progress receipt, checkpoint, or operational action.
 */
export function buildPrivateKwContactReviewProgressProof(input: {
  manifestValue: unknown;
  assessmentProgressCheckpointValue: unknown;
  currentContactInvocationResultValue: unknown;
}): PrivateKwContactReviewProgressProof {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const checkpoint = requireInProcessPrivateKwAssessmentProgressCheckpoint(
    input.assessmentProgressCheckpointValue,
  );
  const durable = requireCurrentPrivateKwContactInvocationDurableReload(
    input.currentContactInvocationResultValue,
  );
  const invocation = durable.invocation;

  if (
    checkpoint.manifestId !== manifest.manifestId
    || checkpoint.manifestDigest !== manifest.manifestDigest
    || checkpoint.sliceKey !== manifest.sliceKey
    || checkpoint.sourcePlanDigest !== manifest.sourcePlanDigest
    || privateKwShadowSliceProgressDigest(exactScope(checkpoint.records))
      !== privateKwShadowSliceProgressDigest(exactScope(manifest.records))
  ) {
    throw new Error("Contact-review proof requires the exact manifest-bound assessment checkpoint.");
  }

  const manifestRecord = manifest.records.find(
    (record) => record.businessId === invocation.businessId,
  );
  const progressRecord = checkpoint.records.find(
    (record) => record.businessId === invocation.businessId,
  );
  const sourcePhase = progressRecord?.phaseReceipts[0];
  const predecessor = progressRecord?.phaseReceipts.at(-1);
  const assessmentProof = predecessor?.proof.supportingReceipts[0];
  if (
    !manifestRecord
    || !progressRecord
    || progressRecord.phaseReceipts.length !== 3
    || progressRecord.currentCheckpoint !== "ASSESSMENT_PERSISTED"
    || progressRecord.nextRequiredGate !== "CONTACT_REVIEW_APPROVAL"
    || !sourcePhase
    || sourcePhase.phase !== "SOURCE_WORKFLOW"
    || sourcePhase.completedCheckpoint !== "SOURCE_WORKFLOW_PERSISTED"
    || sourcePhase.proof.primaryReceiptId
      !== durable.sourceMaterialization.materializationId
    || sourcePhase.proof.primaryReceiptDigest
      !== durable.sourceMaterialization.materializationDigest
    || sourcePhase.proof.supportingReceipts.length !== 1
    || sourcePhase.proof.supportingReceipts[0]?.receiptId
      !== durable.sourceMaterialization.workflowReceiptId
    || !predecessor
    || predecessor.phase !== "ASSESSMENT"
    || predecessor.completedCheckpoint !== "ASSESSMENT_PERSISTED"
    || predecessor.proof.proofKind !== "IMMUTABLE_ASSESSMENT"
    || predecessor.proof.primaryReceiptId !== durable.assessment.assessmentId
    || predecessor.proof.primaryReceiptDigest !== durable.assessment.assessmentDigest
    || predecessor.proof.supportingReceipts.length !== 1
    || !assessmentProof
    || !assessmentProof.receiptId.startsWith("assessment-proof:")
  ) {
    throw new Error("Contact-review proof requires the business's exact completed assessment predecessor.");
  }

  if (
    manifest.sourceImportId !== invocation.sourceImportId
    || manifest.sourcePlanDigest !== invocation.sourcePlanDigest
    || durable.sourceMaterialization.sourceImportId !== manifest.sourceImportId
    || durable.sourceMaterialization.sourcePlanDigest !== manifest.sourcePlanDigest
    || durable.sourceMaterialization.businessId !== manifestRecord.businessId
    || durable.sourceMaterialization.evaluationCandidateId !== manifestRecord.evaluationCandidateId
    || invocation.review.draft.evaluationCandidateId !== manifestRecord.evaluationCandidateId
    || invocation.review.business.id !== manifestRecord.businessId
    || invocation.review.business.canonicalName !== manifestRecord.businessName
    || invocation.review.business.city !== manifestRecord.city
    || invocation.review.business.niche !== manifestRecord.niche
    || invocation.review.discovery.businessId !== manifestRecord.businessId
  ) {
    throw new Error("Contact-review proof must bind one exact reviewed manifest business and source materialization.");
  }

  if (
    invocation.assessment.assessmentReceiptId !== predecessor.proof.primaryReceiptId
    || invocation.assessment.assessmentDigest !== predecessor.proof.primaryReceiptDigest
    || invocation.assessment.assessmentReceiptId !== durable.assessment.assessmentId
    || invocation.assessment.assessmentDigest !== durable.assessment.assessmentDigest
    || invocation.contactMaterializationId !== durable.contactMaterialization.materializationId
    || invocation.review.discovery.discoveryResultId
      !== durable.contactMaterialization.discoveryReceiptId
    || invocation.review.discovery.discoveryResultDigest
      !== durable.contactMaterialization.discoveryResultDigest
  ) {
    throw new Error("Contact-review proof must bind the exact assessment, invocation, and final contact materialization receipt.");
  }

  if (
    Date.parse(durable.sourceMaterialization.recordedAt)
      > Date.parse(durable.assessment.assessedAt)
    || Date.parse(durable.assessment.assessedAt)
      > Date.parse(durable.invocationReceiptRecordedAt)
    || Date.parse(checkpoint.createdAt) > Date.parse(durable.databaseNow)
    || Date.parse(durable.invocationReceiptRecordedAt) > Date.parse(durable.databaseNow)
    || Date.parse(durable.databaseNow) >= Date.parse(durable.evidenceFreshThrough)
  ) {
    throw new Error("Contact-review proof chronology must remain ordered and inside the exact current evidence window.");
  }

  const core = ContactReviewProgressProofCoreSchema.parse({
    proofVersion: PRIVATE_KW_CONTACT_REVIEW_PROGRESS_PROOF_VERSION,
    proofKind: "CONTACT_REVIEW_PROGRESS_PROOF",
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    sourceImportId: manifest.sourceImportId,
    sourcePlanDigest: manifest.sourcePlanDigest,
    businessId: manifestRecord.businessId,
    evaluationCandidateId: manifestRecord.evaluationCandidateId,
    sourceRecordId: manifestRecord.sourceRecordId,
    previousPhaseReceipt: {
      phaseReceiptId: predecessor.phaseReceiptId,
      phaseReceiptDigest: predecessor.phaseReceiptDigest,
      assessmentReceiptId: predecessor.proof.primaryReceiptId,
      assessmentDigest: predecessor.proof.primaryReceiptDigest,
      assessmentProofId: assessmentProof.receiptId,
      assessmentProofDigest: assessmentProof.receiptDigest,
      completedAt: predecessor.completedAt,
      recordedAt: predecessor.recordedAt,
    },
    sourceMaterialization: {
      materializationId: durable.sourceMaterialization.materializationId,
      materializationDigest: durable.sourceMaterialization.materializationDigest,
      workflowReceiptId: durable.sourceMaterialization.workflowReceiptId,
      workflowRunId: durable.sourceMaterialization.workflowRunId,
      recordedAt: durable.sourceMaterialization.recordedAt,
    },
    contactInvocation: {
      invocationId: invocation.invocationId,
      invocationDigest: invocation.invocationDigest,
      reviewId: invocation.reviewId,
      reviewDigest: invocation.reviewDigest,
      contactMaterializationId: durable.contactMaterialization.materializationId,
      contactMaterializationDigest: durable.contactMaterialization.materializationDigest,
      discoveryReceiptId: durable.contactMaterialization.discoveryReceiptId,
      discoveryResultDigest: durable.contactMaterialization.discoveryResultDigest,
      invocationReceiptRecordedAt: durable.invocationReceiptRecordedAt,
      evidenceFreshThrough: durable.evidenceFreshThrough,
    },
    persistence: {
      durableVersion: durable.durableVersion,
      targetSchemaVersion: durable.targetSchemaVersion,
      executionPath: durable.executionPath,
      transactionApi: durable.transactionApi,
      databaseNow: durable.databaseNow,
      freshnessState: durable.freshnessState,
      reloadedRows: durable.reloadedRows,
      exactAssessmentReloaded: durable.exactAssessmentReloaded,
      exactContactPlanRebuilt: durable.exactContactPlanRebuilt,
      immutableWriterGuardsVerified: durable.immutableWriterGuardsVerified,
      committedAndReloaded: durable.committedAndReloaded,
      databaseReadPerformed: durable.databaseReadPerformed,
      databaseMutationPerformed: durable.databaseMutationPerformed,
    },
    preparedAt: durable.databaseNow,
    requiredProgressPrimaryReceiptKind: "OWNER_REVIEWED_CONTACT_INVOCATION",
    requiredProgressSupportingReceiptKind: "CONTACT_REVIEW_PROOF",
    authority: privateKwContactReviewProgressAuthority(),
  });
  const proofDigest = contactDiscoveryDigest(core);
  return PrivateKwContactReviewProgressProofSchema.parse({
    ...core,
    proofId: `contact-review-proof:${proofDigest}`,
    proofDigest,
  });
}
