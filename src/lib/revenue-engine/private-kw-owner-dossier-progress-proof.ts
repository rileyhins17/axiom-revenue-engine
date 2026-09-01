import { z } from "zod";

import {
  OWNER_LEAD_DETAIL_READ_MODEL_VERSION,
  requireInProcessOwnerLeadDetailResponse,
  type OwnerLeadDetailResponse,
} from "@/lib/revenue-engine/owner-lead-detail-read-model";
import {
  requireInProcessPrivateKwContactReviewProgressCheckpoint,
} from "@/lib/revenue-engine/private-kw-contact-review-progress-append";
import {
  PrivateKwShadowSliceManifestSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  privateKwShadowSliceProgressDigest,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";

export const PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_PROOF_VERSION =
  "kw-owner-dossier-acceptance-proof-v1";
export const PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_DECISION_VERSION =
  "kw-owner-dossier-acceptance-decision-v1";
export const PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_CONFIRMATION =
  "I ACCEPT THIS EXACT READ-ONLY OWNER DOSSIER FOR SHADOW PROGRESS ONLY";
export const PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_WINDOW_MS = 5 * 60_000;

const TimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IdentitySchema = z.string().trim().min(1).max(300);

export const PrivateKwOwnerDossierAcceptanceSchema = z.object({
  decisionVersion: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_DECISION_VERSION),
  dossierDigest: Sha256Schema,
  businessId: IdentitySchema,
  decision: z.literal("ACCEPTED_FOR_READ_ONLY_SHADOW_PROGRESS"),
  acceptedBy: z.enum(["RILEY", "AIDAN"]),
  acceptedAt: TimestampSchema,
  rationale: z.string().trim().min(1).max(1_000),
  confirmation: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_CONFIRMATION),
  mode: z.literal("SHADOW"),
}).strict();

export type PrivateKwOwnerDossierAcceptance = z.infer<
  typeof PrivateKwOwnerDossierAcceptanceSchema
>;

const OwnerDossierAcceptanceAuthoritySchema = z.object({
  contractValidationOnly: z.literal(true),
  ownerSessionAuthenticationProven: z.literal(false),
  durableDecisionRecorded: z.literal(false),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  fileReadAuthorized: z.literal(false),
  fileMutationAuthorized: z.literal(false),
  databaseReadAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  browserCaptureAuthorized: z.literal(false),
  contactDiscoveryExecutionAuthorized: z.literal(false),
  contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  mailboxSyncAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const OwnerDossierAcceptanceProofCoreSchema = z.object({
  proofVersion: z.literal(PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_PROOF_VERSION),
  proofKind: z.literal("OWNER_DOSSIER_ACCEPTANCE_PROOF"),
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  sourceImportId: IdentitySchema,
  sourcePlanDigest: Sha256Schema,
  businessId: IdentitySchema,
  evaluationCandidateId: IdentitySchema,
  sourceRecordId: IdentitySchema,
  parentCheckpoint: z.object({
    checkpointId: z.string().regex(/^kw-shadow-progress:[a-f0-9]{64}$/),
    checkpointDigest: Sha256Schema,
    createdAt: TimestampSchema,
    completedPhaseReceipts: z.number().int().min(0).max(50),
  }).strict(),
  previousPhaseReceipt: z.object({
    phaseReceiptId: z.string().regex(/^kw-shadow-phase:[a-f0-9]{64}$/),
    phaseReceiptDigest: Sha256Schema,
    contactInvocationId: z.string().regex(/^kw-contact-invocation:[a-f0-9]{64}$/),
    contactInvocationDigest: Sha256Schema,
    contactReviewProofId: z.string().regex(/^contact-review-proof:[a-f0-9]{64}$/),
    contactReviewProofDigest: Sha256Schema,
    completedAt: TimestampSchema,
    recordedAt: TimestampSchema,
  }).strict(),
  ownerDossier: z.object({
    readModelVersion: z.literal(OWNER_LEAD_DETAIL_READ_MODEL_VERSION),
    dossierDigest: Sha256Schema,
    generatedAt: TimestampSchema,
    projectionKey: IdentitySchema,
    businessId: IdentitySchema,
    websiteSnapshotId: IdentitySchema,
    qualificationSnapshotId: IdentitySchema,
    contactInvocationId: z.string().regex(/^kw-contact-invocation:[a-f0-9]{64}$/),
    contactReviewId: z.string().regex(/^kw-contact-review:[a-f0-9]{64}$/),
    dataQualityState: z.literal("CURRENT"),
    contactReviewState: z.literal("CURRENT"),
    routeCount: z.number().int().min(0).max(100),
    evidenceCount: z.number().int().min(0).max(250),
    findingCount: z.number().int().min(0).max(100),
    historyEventCount: z.number().int().min(0).max(100),
  }).strict(),
  acceptance: PrivateKwOwnerDossierAcceptanceSchema,
  preparedAt: TimestampSchema,
  authority: OwnerDossierAcceptanceAuthoritySchema,
}).strict();

export const PrivateKwOwnerDossierAcceptanceProofSchema =
  OwnerDossierAcceptanceProofCoreSchema.extend({
    proofId: z.string().regex(/^owner-dossier-acceptance:[a-f0-9]{64}$/),
    proofDigest: Sha256Schema,
  }).strict().superRefine((proof, context) => {
    const { proofId: _proofId, proofDigest: _proofDigest, ...core } = proof;
    void _proofId;
    void _proofDigest;
    const expected = privateKwShadowSliceProgressDigest(core);
    if (
      proof.proofDigest !== expected
      || proof.proofId !== `owner-dossier-acceptance:${expected}`
    ) {
      context.addIssue({
        code: "custom",
        message: "Owner-dossier acceptance proof identity must bind its exact dossier, parent, and declaration.",
        path: ["proofDigest"],
      });
    }
  });

export type PrivateKwOwnerDossierAcceptanceProof = z.infer<
  typeof PrivateKwOwnerDossierAcceptanceProofSchema
>;

const trustedOwnerDossierAcceptanceProofs = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
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

export function privateKwOwnerDossierAcceptanceAuthority() {
  return OwnerDossierAcceptanceAuthoritySchema.parse({
    contractValidationOnly: true,
    ownerSessionAuthenticationProven: false,
    durableDecisionRecorded: false,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    fileReadAuthorized: false,
    fileMutationAuthorized: false,
    databaseReadAuthorized: false,
    databaseMutationAuthorized: false,
    browserCaptureAuthorized: false,
    contactDiscoveryExecutionAuthorized: false,
    contactVerificationExecutionAuthorized: false,
    consentDecisionAuthorized: false,
    qualificationAuthorized: false,
    mailboxSyncAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

export function privateKwOwnerDossierDigest(
  value: unknown,
): string {
  const dossier = requireInProcessOwnerLeadDetailResponse(value);
  return privateKwShadowSliceProgressDigest(dossier);
}

export function requireInProcessPrivateKwOwnerDossierAcceptanceProof(
  value: unknown,
): PrivateKwOwnerDossierAcceptanceProof {
  PrivateKwOwnerDossierAcceptanceProofSchema.parse(value);
  if (
    !value
    || typeof value !== "object"
    || !trustedOwnerDossierAcceptanceProofs.has(value)
  ) {
    throw new Error(
      "An exact in-process owner-dossier acceptance proof is required.",
    );
  }
  return value as PrivateKwOwnerDossierAcceptanceProof;
}

function assertCurrentDossierLineage(input: {
  dossier: OwnerLeadDetailResponse;
  businessId: string;
  invocationId: string;
}) {
  const { dossier } = input;
  if (dossier.lead.dataQuality.state !== "CURRENT") {
    throw new Error("Owner-dossier acceptance requires current owner dossier data quality.");
  }
  if (
    dossier.contactReview.state !== "CURRENT"
    || dossier.contactReview.invocationId !== input.invocationId
    || dossier.contactReview.assessment.websiteSnapshotId !== dossier.website.snapshotId
    || dossier.contactReview.assessment.qualificationSnapshotId
      !== dossier.lead.qualification.snapshotId
  ) {
    throw new Error(
      "Owner-dossier acceptance requires a current contact review and exact snapshot lineage.",
    );
  }
  if (
    dossier.lead.business.businessId !== input.businessId
    || dossier.lead.audit.capturedAt !== dossier.website.capturedAt
    || dossier.lead.audit.auditVersion !== dossier.website.auditVersion
    || dossier.lead.audit.classification !== dossier.website.classification
    || dossier.lead.projectedAt !== dossier.generatedAt
  ) {
    throw new Error("Owner-dossier acceptance requires one exact current business projection.");
  }
}

/**
 * Builds one in-memory, validation-only proof. It authenticates no owner,
 * persists no decision, appends no progress, and authorizes no operation.
 */
export function buildPrivateKwOwnerDossierAcceptanceProof(input: {
  manifestValue: unknown;
  contactReviewProgressCheckpointValue: unknown;
  ownerDossierValue: unknown;
  acceptanceValue: unknown;
}): PrivateKwOwnerDossierAcceptanceProof {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const checkpoint = requireInProcessPrivateKwContactReviewProgressCheckpoint(
    input.contactReviewProgressCheckpointValue,
  );
  const dossier = requireInProcessOwnerLeadDetailResponse(input.ownerDossierValue);
  const acceptance = PrivateKwOwnerDossierAcceptanceSchema.parse(input.acceptanceValue);

  if (
    checkpoint.manifestId !== manifest.manifestId
    || checkpoint.manifestDigest !== manifest.manifestDigest
    || checkpoint.sliceKey !== manifest.sliceKey
    || checkpoint.sourcePlanDigest !== manifest.sourcePlanDigest
    || privateKwShadowSliceProgressDigest(exactScope(checkpoint.records))
      !== privateKwShadowSliceProgressDigest(exactScope(manifest.records))
  ) {
    throw new Error(
      "Owner-dossier acceptance requires the exact manifest-bound contact-review checkpoint.",
    );
  }

  const businessId = dossier.lead.business.businessId;
  const manifestRecord = manifest.records.find((record) => record.businessId === businessId);
  const progressRecord = checkpoint.records.find((record) => record.businessId === businessId);
  const predecessor = progressRecord?.phaseReceipts.at(-1);
  const contactProof = predecessor?.proof.supportingReceipts[0];
  if (
    !manifestRecord
    || !progressRecord
    || progressRecord.phaseReceipts.length !== 4
    || progressRecord.currentCheckpoint !== "CONTACT_REVIEW_PERSISTED"
    || progressRecord.nextRequiredGate !== "OWNER_DOSSIER_ACCEPTANCE"
    || !predecessor
    || predecessor.phase !== "CONTACT_REVIEW"
    || predecessor.completedCheckpoint !== "CONTACT_REVIEW_PERSISTED"
    || predecessor.proof.proofKind !== "OWNER_REVIEWED_CONTACT_INVOCATION"
    || predecessor.proof.supportingReceipts.length !== 1
    || !contactProof
    || !contactProof.receiptId.startsWith("contact-review-proof:")
  ) {
    throw new Error(
      "Owner-dossier acceptance requires the business's exact completed contact-review predecessor.",
    );
  }

  assertCurrentDossierLineage({
    dossier,
    businessId,
    invocationId: predecessor.proof.primaryReceiptId,
  });
  if (
    manifestRecord.businessName !== dossier.lead.business.canonicalName
    || manifestRecord.city !== dossier.lead.business.location.city
    || manifestRecord.niche !== dossier.lead.business.niche
    || manifestRecord.sourceEvidenceUrl !== dossier.lead.business.sourceEvidenceUrl
    || manifestRecord.sourceCapturedAt !== dossier.lead.business.sourceCapturedAt
    || manifestRecord.websiteUrl !== dossier.lead.business.websiteUrl
    || manifestRecord.independenceStatus !== dossier.lead.business.independenceStatus
  ) {
    throw new Error("Owner-dossier acceptance requires exact manifest business identity.");
  }

  const dossierDigest = privateKwOwnerDossierDigest(dossier);
  if (
    acceptance.dossierDigest !== dossierDigest
    || acceptance.businessId !== businessId
  ) {
    throw new Error("Owner-dossier acceptance must cite the exact owner dossier digest and business.");
  }
  const generatedAtMs = Date.parse(dossier.generatedAt);
  const acceptedAtMs = Date.parse(acceptance.acceptedAt);
  if (acceptedAtMs < generatedAtMs) {
    throw new Error("Owner-dossier acceptance cannot predate the dossier generation time.");
  }
  if (acceptedAtMs - generatedAtMs > PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_WINDOW_MS) {
    throw new Error("Owner-dossier acceptance must occur within five minutes of dossier generation.");
  }
  if (
    generatedAtMs < Date.parse(checkpoint.createdAt)
    || acceptedAtMs < Date.parse(predecessor.recordedAt)
  ) {
    throw new Error("Owner-dossier acceptance chronology must follow its exact contact-review parent.");
  }

  const contactReview = dossier.contactReview;
  if (contactReview.state !== "CURRENT") {
    throw new Error("Owner-dossier acceptance lost current contact review state.");
  }
  const core = OwnerDossierAcceptanceProofCoreSchema.parse({
    proofVersion: PRIVATE_KW_OWNER_DOSSIER_ACCEPTANCE_PROOF_VERSION,
    proofKind: "OWNER_DOSSIER_ACCEPTANCE_PROOF",
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    sourceImportId: manifest.sourceImportId,
    sourcePlanDigest: manifest.sourcePlanDigest,
    businessId,
    evaluationCandidateId: manifestRecord.evaluationCandidateId,
    sourceRecordId: manifestRecord.sourceRecordId,
    parentCheckpoint: {
      checkpointId: checkpoint.checkpointId,
      checkpointDigest: checkpoint.checkpointDigest,
      createdAt: checkpoint.createdAt,
      completedPhaseReceipts: checkpoint.summary.completedPhaseReceipts,
    },
    previousPhaseReceipt: {
      phaseReceiptId: predecessor.phaseReceiptId,
      phaseReceiptDigest: predecessor.phaseReceiptDigest,
      contactInvocationId: predecessor.proof.primaryReceiptId,
      contactInvocationDigest: predecessor.proof.primaryReceiptDigest,
      contactReviewProofId: contactProof.receiptId,
      contactReviewProofDigest: contactProof.receiptDigest,
      completedAt: predecessor.completedAt,
      recordedAt: predecessor.recordedAt,
    },
    ownerDossier: {
      readModelVersion: dossier.readModelVersion,
      dossierDigest,
      generatedAt: dossier.generatedAt,
      projectionKey: dossier.lead.projectionKey,
      businessId,
      websiteSnapshotId: dossier.website.snapshotId,
      qualificationSnapshotId: dossier.lead.qualification.snapshotId,
      contactInvocationId: contactReview.invocationId,
      contactReviewId: contactReview.reviewId,
      dataQualityState: dossier.lead.dataQuality.state,
      contactReviewState: contactReview.state,
      routeCount: dossier.routes.length,
      evidenceCount: dossier.website.evidence.length,
      findingCount: dossier.website.findings.length,
      historyEventCount: dossier.history.events.length,
    },
    acceptance,
    preparedAt: acceptance.acceptedAt,
    authority: privateKwOwnerDossierAcceptanceAuthority(),
  });
  const proofDigest = privateKwShadowSliceProgressDigest(core);
  const proof = deepFreeze(PrivateKwOwnerDossierAcceptanceProofSchema.parse({
    ...core,
    proofId: `owner-dossier-acceptance:${proofDigest}`,
    proofDigest,
  }));
  trustedOwnerDossierAcceptanceProofs.add(proof);
  return proof;
}
