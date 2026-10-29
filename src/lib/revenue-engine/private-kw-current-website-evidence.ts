import { z } from "zod";

import {
  ArtifactManifestAvailabilityReceiptSchema,
  validateArtifactManifestAvailabilityAgainstManifest,
} from "@/lib/revenue-engine/artifact-manifest-availability";
import {
  artifactManifestDigest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import { artifactReferenceDigest } from "@/lib/revenue-engine/artifact-reference-projection";
import {
  DurableEvidencePersistenceRequestSchema,
  buildDurableEvidencePersistencePlan,
} from "@/lib/revenue-engine/durable-evidence-persistence-plan";
import {
  PrivateKwShadowSliceManifestSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PrivateKwShadowSlicePhaseReceiptSchema,
} from "@/lib/revenue-engine/private-kw-shadow-slice-progress";
import { WebsiteClassificationSchema } from "@/lib/revenue-engine/website-audit";

export const PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_VERSION = "kw-current-website-evidence-v1";
export const PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_MAX_AGE_DAYS = 60;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const IdentitySchema = z.string().trim().min(1).max(200);

const CurrentWebsiteEvidenceAuthoritySchema = z.object({
  syntheticContractProofOnly: z.literal(true),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  browserCaptureAuthorized: z.literal(false),
  artifactStorageAuthorized: z.literal(false),
  r2ReadAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const ArtifactEvidenceReferenceSchema = z.object({
  manifestId: z.string().uuid(),
  manifestDigest: Sha256Schema,
  retentionClass: z.literal("SHADOW_30D"),
  availabilityReceiptId: z.string().uuid(),
  availabilityReceiptDigest: Sha256Schema,
  checkerKind: z.literal("FIXTURE"),
  validThrough: TimestampSchema,
  expiresAt: TimestampSchema,
}).strict();

const CurrentWebsiteEvidenceProofCoreSchema = z.object({
  proofVersion: z.literal(PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_VERSION),
  proofKind: z.literal("CURRENT_WEBSITE_EVIDENCE"),
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  businessId: IdentitySchema,
  evaluationCandidateId: IdentitySchema,
  sourceRecordId: IdentitySchema,
  websiteUrl: z.string().url(),
  sourceEvidenceUrl: z.string().url(),
  previousPhaseReceipt: z.object({
    phaseReceiptId: z.string().regex(/^kw-shadow-phase:[a-f0-9]{64}$/),
    phaseReceiptDigest: Sha256Schema,
    completedAt: TimestampSchema,
  }).strict(),
  workflow: z.object({
    workflowId: z.string().uuid(),
    requestedAt: TimestampSchema,
    completedAt: TimestampSchema,
    requestDigest: Sha256Schema,
    receiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/),
    receiptDigest: Sha256Schema,
    durablePlanDigest: Sha256Schema,
    pageSelectionDigest: Sha256Schema,
    auditAssemblyDigest: Sha256Schema,
    auditDigest: Sha256Schema,
    artifactSetDigest: Sha256Schema,
  }).strict(),
  audit: z.object({
    auditVersion: z.string().trim().min(1).max(100),
    classification: WebsiteClassificationSchema,
    rebuildNeedScore: z.number().int().min(0).max(100),
    evidenceConfidence: z.number().int().min(0).max(100),
    finalUrl: z.string().url(),
  }).strict(),
  homeEvidence: z.object({
    pageKind: z.literal("HOME"),
    finalUrl: z.string().url(),
    htmlComplete: z.literal(true),
    capturedProfiles: z.tuple([
      z.literal("DESKTOP_1440X900"),
      z.literal("MOBILE_390X844"),
    ]),
    artifactManifestIds: z.array(z.string().uuid()).length(2),
  }).strict(),
  artifactEvidence: z.array(ArtifactEvidenceReferenceSchema).min(2).max(5),
  evidenceFreshThrough: TimestampSchema,
  preparedAt: TimestampSchema,
  requiredEligibilityReceiptKind: z.literal("CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY"),
  authority: CurrentWebsiteEvidenceAuthoritySchema,
}).strict();

export const PrivateKwCurrentWebsiteEvidenceProofSchema = CurrentWebsiteEvidenceProofCoreSchema.extend({
  proofId: z.string().regex(/^website-evidence:[a-f0-9]{64}$/),
  proofDigest: Sha256Schema,
}).strict().superRefine((proof, context) => {
  const { proofId: _proofId, proofDigest: _proofDigest, ...core } = proof;
  void _proofId;
  void _proofDigest;
  const expectedDigest = artifactReferenceDigest(core);
  if (proof.proofDigest !== expectedDigest || proof.proofId !== `website-evidence:${expectedDigest}`) {
    context.addIssue({
      code: "custom",
      message: "Current website evidence proof identity must bind its exact evidence and lineage.",
      path: ["proofDigest"],
    });
  }
});

export type PrivateKwCurrentWebsiteEvidenceProof = z.infer<
  typeof PrivateKwCurrentWebsiteEvidenceProofSchema
>;

function normalizeComparable(value: string) {
  return value.trim().toLocaleLowerCase("en-CA").replace(/[^a-z0-9]+/g, " ").trim();
}

function earliestTimestamp(values: string[]) {
  return values.reduce((earliest, current) => (
    Date.parse(current) < Date.parse(earliest) ? current : earliest
  ));
}

function exactProfiles(values: string[]) {
  return values.length === 2
    && values[0] === "DESKTOP_1440X900"
    && values[1] === "MOBILE_390X844";
}

export function privateKwCurrentWebsiteEvidenceAuthority() {
  return CurrentWebsiteEvidenceAuthoritySchema.parse({
    syntheticContractProofOnly: true,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    browserCaptureAuthorized: false,
    artifactStorageAuthorized: false,
    r2ReadAuthorized: false,
    databaseMutationAuthorized: false,
    contactDiscoveryAuthorized: false,
    qualificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    deploymentAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
}

export function buildPrivateKwCurrentWebsiteEvidenceProof(input: {
  manifestValue: unknown;
  previousPhaseReceiptValue: unknown;
  durableEvidenceRequestValue: unknown;
  availabilityReceiptValues: readonly unknown[];
  preparedAt: string;
}): PrivateKwCurrentWebsiteEvidenceProof {
  const manifest = PrivateKwShadowSliceManifestSchema.parse(input.manifestValue);
  const previous = PrivateKwShadowSlicePhaseReceiptSchema.parse(input.previousPhaseReceiptValue);
  const persistenceRequest = DurableEvidencePersistenceRequestSchema.parse(input.durableEvidenceRequestValue);
  const preparedAt = TimestampSchema.parse(input.preparedAt);
  const persistencePlan = buildDurableEvidencePersistencePlan(persistenceRequest);
  const request = persistenceRequest.workflowRequest;
  const receipt = persistenceRequest.workflowReceipt;

  if (
    previous.phase !== "SOURCE_WORKFLOW"
    || previous.completedCheckpoint !== "SOURCE_WORKFLOW_PERSISTED"
    || previous.manifestId !== manifest.manifestId
    || previous.manifestDigest !== manifest.manifestDigest
  ) {
    throw new Error("Current website evidence requires the exact completed source/workflow predecessor.");
  }
  const manifestRecord = manifest.records.find((record) => record.businessId === previous.businessId);
  if (
    !manifestRecord
    || manifestRecord.evaluationCandidateId !== previous.evaluationCandidateId
    || manifestRecord.websiteUrl === null
  ) {
    throw new Error("Current website evidence must identify one exact website-bearing manifest business.");
  }
  if (
    request.businessId !== manifestRecord.businessId
    || request.businessName !== manifestRecord.businessName
    || request.websiteUrl !== manifestRecord.websiteUrl
    || request.sourceEvidenceUrl !== manifestRecord.sourceEvidenceUrl
    || normalizeComparable(request.niche) !== normalizeComparable(manifestRecord.niche)
    || !request.expectedLocations.some((location) => normalizeComparable(location) === normalizeComparable(manifestRecord.city))
    || !request.expectedServices.some((service) => normalizeComparable(service).includes(normalizeComparable(manifestRecord.niche)))
  ) {
    throw new Error("Website workflow identity and market facts must match the exact reviewed manifest record.");
  }
  if (
    Date.parse(request.requestedAt) < Date.parse(previous.completedAt)
    || Date.parse(receipt.completedAt) < Date.parse(request.requestedAt)
    || Date.parse(persistenceRequest.plannedAt) < Date.parse(receipt.completedAt)
    || Date.parse(preparedAt) < Date.parse(persistenceRequest.plannedAt)
  ) {
    throw new Error("Source/workflow completion, website evidence, persistence planning, and proof preparation must be ordered.");
  }
  if (
    receipt.status !== "COMPLETED"
    || receipt.sitePath !== "CAPTURED"
    || receipt.steps.some((step) => step.status !== "SUCCEEDED")
    || receipt.pageSelection?.status !== "READY"
    || receipt.auditAssembly?.status !== "READY"
    || !receipt.audit
    || receipt.audit.siteState !== "CAPTURED"
    || receipt.audit.businessId !== manifestRecord.businessId
    || !receipt.audit.finalUrl
  ) {
    throw new Error("Current website evidence requires one complete captured workflow with a ready deterministic audit.");
  }
  const home = receipt.pages.find((page) => page.pageKind === "HOME");
  if (
    !home
    || home.captureOutcome !== "CAPTURED"
    || home.finalUrl !== receipt.audit.finalUrl
    || !home.htmlComplete
    || !exactProfiles(home.browserProfilesAttempted)
    || !exactProfiles(home.browserProfilesCaptured)
    || home.artifactReceiptIds.length !== 2
  ) {
    throw new Error("Current website evidence requires complete desktop and mobile homepage proof.");
  }

  const parsedAvailability = input.availabilityReceiptValues.map((value) => (
    ArtifactManifestAvailabilityReceiptSchema.parse(value)
  ));
  const manifestIds = new Set(receipt.artifactManifests.map((item) => item.manifestId));
  if (
    receipt.artifactManifests.length < 2
    || parsedAvailability.length !== receipt.artifactManifests.length
    || new Set(parsedAvailability.map((item) => item.manifestId)).size !== parsedAvailability.length
    || parsedAvailability.some((item) => !manifestIds.has(item.manifestId))
  ) {
    throw new Error("Website evidence availability must cover the exact complete artifact manifest set.");
  }

  const artifactEvidence = receipt.artifactManifests.map((artifactManifest) => {
    const artifactKinds = [...artifactManifest.items.map((item) => item.kind)].sort();
    if (
      artifactManifest.retentionClass !== "SHADOW_30D"
      || artifactManifest.items.length !== 2
      || artifactKinds[0] !== "BROWSER_MEASUREMENT"
      || artifactKinds[1] !== "BROWSER_SCREENSHOT"
    ) {
      throw new Error("Synthetic current website evidence requires exact screenshot and measurement manifests.");
    }
    const availability = parsedAvailability.find((candidate) => candidate.manifestId === artifactManifest.manifestId);
    if (!availability || availability.checkerKind !== "FIXTURE" || availability.state !== "VERIFIED_PRESENT" || !availability.expiresAt) {
      throw new Error("Synthetic current website evidence requires one verified fixture availability receipt per manifest.");
    }
    const validated = validateArtifactManifestAvailabilityAgainstManifest({
      receipt: availability,
      manifest: artifactManifest,
      snapshotCapturedAt: preparedAt,
    });
    return ArtifactEvidenceReferenceSchema.parse({
      manifestId: artifactManifest.manifestId,
      manifestDigest: artifactManifestDigest(artifactManifest),
      retentionClass: artifactManifest.retentionClass,
      availabilityReceiptId: validated.receiptId,
      availabilityReceiptDigest: validated.receiptDigest,
      checkerKind: validated.checkerKind,
      validThrough: validated.validThrough,
      expiresAt: validated.expiresAt,
    });
  }).sort((left, right) => left.manifestId.localeCompare(right.manifestId, "en-CA"));

  const websiteFreshThrough = new Date(
    Date.parse(receipt.completedAt) + PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const evidenceFreshThrough = earliestTimestamp([
    websiteFreshThrough,
    ...artifactEvidence.flatMap((artifact) => [artifact.validThrough, artifact.expiresAt]),
  ]);
  if (Date.parse(preparedAt) > Date.parse(evidenceFreshThrough)) {
    throw new Error("Current website evidence is stale at proof preparation time.");
  }

  const core = CurrentWebsiteEvidenceProofCoreSchema.parse({
    proofVersion: PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_VERSION,
    proofKind: "CURRENT_WEBSITE_EVIDENCE",
    manifestId: manifest.manifestId,
    manifestDigest: manifest.manifestDigest,
    businessId: manifestRecord.businessId,
    evaluationCandidateId: manifestRecord.evaluationCandidateId,
    sourceRecordId: manifestRecord.sourceRecordId,
    websiteUrl: manifestRecord.websiteUrl,
    sourceEvidenceUrl: manifestRecord.sourceEvidenceUrl,
    previousPhaseReceipt: {
      phaseReceiptId: previous.phaseReceiptId,
      phaseReceiptDigest: previous.phaseReceiptDigest,
      completedAt: previous.completedAt,
    },
    workflow: {
      workflowId: request.workflowId,
      requestedAt: request.requestedAt,
      completedAt: receipt.completedAt,
      requestDigest: persistencePlan.requestDigest,
      receiptId: `workflow-receipt:${persistencePlan.receiptDigest}`,
      receiptDigest: persistencePlan.receiptDigest,
      durablePlanDigest: artifactReferenceDigest(persistencePlan),
      pageSelectionDigest: artifactReferenceDigest(receipt.pageSelection),
      auditAssemblyDigest: artifactReferenceDigest(receipt.auditAssembly),
      auditDigest: artifactReferenceDigest(receipt.audit),
      artifactSetDigest: artifactReferenceDigest(artifactEvidence),
    },
    audit: {
      auditVersion: receipt.audit.auditVersion,
      classification: receipt.audit.classification,
      rebuildNeedScore: receipt.audit.rebuildNeedScore,
      evidenceConfidence: receipt.audit.evidenceConfidence,
      finalUrl: receipt.audit.finalUrl,
    },
    homeEvidence: {
      pageKind: "HOME",
      finalUrl: home.finalUrl,
      htmlComplete: home.htmlComplete,
      capturedProfiles: ["DESKTOP_1440X900", "MOBILE_390X844"],
      artifactManifestIds: [...home.artifactReceiptIds].sort((left, right) => left.localeCompare(right, "en-CA")),
    },
    artifactEvidence,
    evidenceFreshThrough,
    preparedAt,
    requiredEligibilityReceiptKind: "CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY",
    authority: privateKwCurrentWebsiteEvidenceAuthority(),
  });
  const proofDigest = artifactReferenceDigest(core);
  return PrivateKwCurrentWebsiteEvidenceProofSchema.parse({
    ...core,
    proofId: `website-evidence:${proofDigest}`,
    proofDigest,
  });
}
