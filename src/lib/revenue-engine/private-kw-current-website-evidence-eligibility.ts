import { z } from "zod";

import {
  artifactManifestDigest,
} from "@/lib/revenue-engine/artifact-lifecycle";
import {
  type ArtifactReferenceFreshMaterializedD1Execution,
  requireFreshMaterializedArtifactReferenceD1Execution,
} from "@/lib/revenue-engine/artifact-reference-d1-executor";
import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "@/lib/revenue-engine/artifact-reference-projection";
import {
  PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_MAX_AGE_DAYS,
  PrivateKwCurrentWebsiteEvidenceProofSchema,
} from "@/lib/revenue-engine/private-kw-current-website-evidence";

export const PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY_VERSION =
  "kw-current-website-evidence-eligibility-v1";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const IdentitySchema = z.string().trim().min(1).max(200);

const WebsiteEvidenceEligibilityAuthoritySchema = z.object({
  validationOnly: z.literal(true),
  exactTrustedExecutionInstancesRequired: z.literal(true),
  phaseInputCreationAuthorized: z.literal(false),
  progressReceiptCreationAuthorized: z.literal(false),
  phaseAdvancementAuthorized: z.literal(false),
  browserCaptureAuthorized: z.literal(false),
  artifactStorageAuthorized: z.literal(false),
  r2ReadAuthorized: z.literal(false),
  databaseReadAuthorized: z.literal(false),
  databaseMutationAuthorized: z.literal(false),
  contactDiscoveryAuthorized: z.literal(false),
  qualificationAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const EligibleArtifactSchema = z.object({
  manifestId: z.string().uuid(),
  manifestDigest: Sha256Schema,
  retentionClass: z.literal("SHADOW_30D"),
  completeness: z.object({
    executionDigest: Sha256Schema,
    receiptId: z.string().uuid(),
    receiptDigest: Sha256Schema,
    snapshotAttemptId: z.string().uuid(),
    snapshotCapturedAt: TimestampSchema,
    recordedAt: TimestampSchema,
    freshUntil: TimestampSchema,
    sourceFactsDigest: Sha256Schema,
    sourceSetProofsDigest: Sha256Schema,
    availabilitySourceSetProofDigest: Sha256Schema,
    completenessAssurance: z.literal("D1_ATOMIC_RECHECK_AND_RELOAD"),
    availabilityAssurance: z.literal("R2_HEAD_PER_MANIFEST"),
    transactionApi: z.literal("D1Database.batch"),
    executionPath: z.literal("FRESH_COMMIT"),
  }).strict(),
  availability: z.object({
    receiptId: z.string().uuid(),
    receiptDigest: Sha256Schema,
    checkedAt: TimestampSchema,
    validThrough: TimestampSchema,
    expiresAt: TimestampSchema,
    checkerKind: z.literal("R2_HEAD"),
    objectSetDigest: Sha256Schema,
    providerReadPerformed: z.literal(true),
  }).strict(),
}).strict();

const WebsiteEvidenceEligibilityCoreSchema = z.object({
  eligibilityVersion: z.literal(PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY_VERSION),
  receiptKind: z.literal("CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY"),
  manifestId: z.string().regex(/^kw-shadow-slice:[a-f0-9]{64}$/),
  manifestDigest: Sha256Schema,
  businessId: IdentitySchema,
  evaluationCandidateId: IdentitySchema,
  sourceRecordId: IdentitySchema,
  websiteEvidence: z.object({
    proofId: z.string().regex(/^website-evidence:[a-f0-9]{64}$/),
    proofDigest: Sha256Schema,
    preparedAt: TimestampSchema,
    workflowId: z.string().uuid(),
    requestDigest: Sha256Schema,
    workflowReceiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/),
    workflowReceiptDigest: Sha256Schema,
    auditDigest: Sha256Schema,
    artifactSetDigest: Sha256Schema,
  }).strict(),
  persistedWorkflow: z.object({
    workflowId: z.string().uuid(),
    businessId: IdentitySchema,
    requestDigest: Sha256Schema,
    workflowReceiptDigest: Sha256Schema,
    workflowForestDigest: Sha256Schema,
    terminalCompletedAt: TimestampSchema,
  }).strict(),
  artifacts: z.array(EligibleArtifactSchema).min(2).max(5),
  evidenceFreshThrough: TimestampSchema,
  evaluatedAt: TimestampSchema,
  authority: WebsiteEvidenceEligibilityAuthoritySchema,
}).strict();

export const PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema =
  WebsiteEvidenceEligibilityCoreSchema.extend({
    receiptId: z.string().regex(/^website-evidence-eligibility:[a-f0-9]{64}$/),
    receiptDigest: Sha256Schema,
  }).strict().superRefine((receipt, context) => {
    const { receiptId: _receiptId, receiptDigest: _receiptDigest, ...core } = receipt;
    void _receiptId;
    void _receiptDigest;
    const expectedDigest = artifactReferenceDigest(core);
    if (
      receipt.receiptDigest !== expectedDigest
      || receipt.receiptId !== `website-evidence-eligibility:${expectedDigest}`
    ) {
      context.addIssue({
        code: "custom",
        message: "Website evidence eligibility identity must bind its exact trusted workflow and artifact evidence.",
        path: ["receiptDigest"],
      });
    }
    const artifactIds = receipt.artifacts.map((artifact) => artifact.manifestId);
    const sortedArtifactIds = [...artifactIds].sort((left, right) => left.localeCompare(right, "en-CA"));
    if (
      new Set(artifactIds).size !== artifactIds.length
      || artifactIds.some((id, index) => id !== sortedArtifactIds[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "Eligible artifacts must be unique and canonically ordered by manifest identity.",
        path: ["artifacts"],
      });
    }
    if (Date.parse(receipt.evaluatedAt) >= Date.parse(receipt.evidenceFreshThrough)) {
      context.addIssue({
        code: "custom",
        message: "Website evidence eligibility must be evaluated inside its half-open freshness window.",
        path: ["evidenceFreshThrough"],
      });
    }
  });

export type PrivateKwCurrentWebsiteEvidenceEligibilityReceipt = z.infer<
  typeof PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema
>;

const trustedEligibilityReceiptInstances = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Keeps a copied or hand-addressed JSON receipt outside the private in-process
 * trust boundary. A future durable consumer must establish its own exact D1
 * persistence-and-reload boundary instead of treating schema validity as
 * authenticity.
 */
export function requireInProcessPrivateKwCurrentWebsiteEvidenceEligibilityReceipt(
  value: unknown,
): PrivateKwCurrentWebsiteEvidenceEligibilityReceipt {
  PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema.parse(value);
  if (!value || typeof value !== "object" || !trustedEligibilityReceiptInstances.has(value)) {
    throw new Error("Website evidence eligibility must be the exact in-process result of the trusted eligibility builder.");
  }
  return value as PrivateKwCurrentWebsiteEvidenceEligibilityReceipt;
}

export function privateKwCurrentWebsiteEvidenceEligibilityAuthority() {
  return WebsiteEvidenceEligibilityAuthoritySchema.parse({
    validationOnly: true,
    exactTrustedExecutionInstancesRequired: true,
    phaseInputCreationAuthorized: false,
    progressReceiptCreationAuthorized: false,
    phaseAdvancementAuthorized: false,
    browserCaptureAuthorized: false,
    artifactStorageAuthorized: false,
    r2ReadAuthorized: false,
    databaseReadAuthorized: false,
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

function exactSet(values: Iterable<string>) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en-CA"));
}

function sameExactSet(left: Iterable<string>, right: Iterable<string>) {
  return artifactReferenceCanonicalJson(exactSet(left)) === artifactReferenceCanonicalJson(exactSet(right));
}

function earliestTimestamp(values: readonly string[]) {
  const first = values[0];
  if (!first) throw new Error("Website evidence eligibility requires at least one freshness boundary.");
  return values.slice(1).reduce((earliest, current) => (
    Date.parse(current) < Date.parse(earliest) ? current : earliest
  ), first);
}

function requireCurrentWindow(evaluatedAt: string, start: string, end: string, label: string) {
  if (Date.parse(evaluatedAt) < Date.parse(start) || Date.parse(evaluatedAt) >= Date.parse(end)) {
    throw new Error(`${label} is outside its current half-open freshness window.`);
  }
}

function verifyWorkflowProof(
  evidence: z.infer<typeof PrivateKwCurrentWebsiteEvidenceProofSchema>,
  execution: ArtifactReferenceFreshMaterializedD1Execution,
) {
  const decoded = execution.decodedSnapshot;
  const request = decoded.workflowHistory.request;
  const terminal = decoded.workflowHistory.terminalReceipt;
  const home = terminal.pages.find((page) => page.pageKind === "HOME");
  if (
    request.workflowId !== evidence.workflow.workflowId
    || request.businessId !== evidence.businessId
    || request.websiteUrl !== evidence.websiteUrl
    || request.sourceEvidenceUrl !== evidence.sourceEvidenceUrl
    || request.requestedAt !== evidence.workflow.requestedAt
    || artifactReferenceDigest(request) !== evidence.workflow.requestDigest
    || artifactReferenceDigest(terminal) !== evidence.workflow.receiptDigest
    || evidence.workflow.receiptId !== `workflow-receipt:${evidence.workflow.receiptDigest}`
    || terminal.completedAt !== evidence.workflow.completedAt
    || artifactReferenceDigest(terminal.pageSelection) !== evidence.workflow.pageSelectionDigest
    || artifactReferenceDigest(terminal.auditAssembly) !== evidence.workflow.auditAssemblyDigest
    || artifactReferenceDigest(terminal.audit) !== evidence.workflow.auditDigest
    || !terminal.audit
    || terminal.audit.auditVersion !== evidence.audit.auditVersion
    || terminal.audit.classification !== evidence.audit.classification
    || terminal.audit.rebuildNeedScore !== evidence.audit.rebuildNeedScore
    || terminal.audit.evidenceConfidence !== evidence.audit.evidenceConfidence
    || terminal.audit.finalUrl !== evidence.audit.finalUrl
    || !home
    || home.finalUrl !== evidence.homeEvidence.finalUrl
    || home.htmlComplete !== evidence.homeEvidence.htmlComplete
    || artifactReferenceCanonicalJson(home.browserProfilesCaptured) !== artifactReferenceCanonicalJson(evidence.homeEvidence.capturedProfiles)
    || !sameExactSet(home.artifactReceiptIds, evidence.homeEvidence.artifactManifestIds)
  ) {
    throw new Error("Website evidence proof does not match the exact persisted terminal workflow, audit, and homepage evidence.");
  }
  if (
    execution.receipt.workflowRunId !== evidence.workflow.workflowId
    || execution.receipt.businessId !== evidence.businessId
    || decoded.selectedLineage.facts.workflowRun.workflowRunId !== evidence.workflow.workflowId
    || decoded.selectedLineage.facts.workflowRun.businessId !== evidence.businessId
    || decoded.selectedLineage.facts.workflowRun.requestDigest !== evidence.workflow.requestDigest
  ) {
    throw new Error("Trusted completeness execution does not match the website evidence workflow and business.");
  }
}

export function buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt(input: {
  websiteEvidenceProofValue: unknown;
  trustedExecutionValues: readonly unknown[];
  evaluatedAt: string;
}): PrivateKwCurrentWebsiteEvidenceEligibilityReceipt {
  const evidence = PrivateKwCurrentWebsiteEvidenceProofSchema.parse(input.websiteEvidenceProofValue);
  const evaluatedAt = TimestampSchema.parse(input.evaluatedAt);
  const executions = input.trustedExecutionValues.map((value) => (
    requireFreshMaterializedArtifactReferenceD1Execution(value)
  ));
  if (executions.length !== evidence.artifactEvidence.length) {
    throw new Error("Website evidence eligibility requires one exact trusted completeness execution per artifact manifest.");
  }
  if (evidence.workflow.artifactSetDigest !== artifactReferenceDigest(evidence.artifactEvidence)) {
    throw new Error("Website evidence proof artifact-set digest does not bind its exact artifact references.");
  }

  const expectedManifestIds = evidence.artifactEvidence.map((artifact) => artifact.manifestId);
  const executionRootIds = executions.map((execution) => execution.receipt.lineageRootManifestId);
  if (
    new Set(executionRootIds).size !== executionRootIds.length
    || !sameExactSet(executionRootIds, expectedManifestIds)
  ) {
    throw new Error("Trusted completeness executions must cover the exact website evidence artifact manifest set once.");
  }

  const firstExecution = executions[0];
  if (!firstExecution) throw new Error("Website evidence eligibility requires trusted artifact executions.");
  verifyWorkflowProof(evidence, firstExecution);
  const firstForestDigest = firstExecution.decodedSnapshot.workflowForest.forestDigest;
  const terminalManifestIds = firstExecution.decodedSnapshot.workflowHistory.terminalReceipt.artifactManifests
    .map((manifest) => manifest.manifestId);
  if (!sameExactSet(terminalManifestIds, expectedManifestIds)) {
    throw new Error("Persisted terminal workflow manifest set does not exactly match the website evidence proof.");
  }

  const artifacts = executions.map((execution) => {
    verifyWorkflowProof(evidence, execution);
    const decoded = execution.decodedSnapshot;
    const rootId = execution.receipt.lineageRootManifestId;
    const proofArtifact = evidence.artifactEvidence.find((artifact) => artifact.manifestId === rootId);
    const rootManifest = decoded.selectedLineage.facts.manifests.find((manifest) => manifest.manifestId === rootId);
    const availability = decoded.selectedLineage.facts.availability.find((receipt) => receipt.manifestId === rootId);
    const availabilityProof = execution.receipt.sourceSetProofs.find((proof) => proof.setName === "AVAILABILITY");
    if (
      !proofArtifact
      || !rootManifest
      || !availability
      || !availabilityProof
      || decoded.selectedLineage.rootManifestId !== rootId
      || decoded.workflowForest.forestDigest !== firstForestDigest
      || rootManifest.retentionClass !== "SHADOW_30D"
      || proofArtifact.retentionClass !== "SHADOW_30D"
      || artifactManifestDigest(rootManifest) !== proofArtifact.manifestDigest
      || availability.manifestDigest !== proofArtifact.manifestDigest
      || availability.state !== "VERIFIED_PRESENT"
      || availability.checkerKind !== "R2_HEAD"
      || !availability.providerReadPerformed
      || availability.expiresAt === null
    ) {
      throw new Error("Trusted completeness execution lacks the exact current R2-backed website artifact evidence.");
    }
    if (
      Date.parse(execution.receipt.snapshotCapturedAt) < Date.parse(evidence.preparedAt)
      || execution.receipt.snapshotCapturedAt !== decoded.snapshotCapturedAt
      || Date.parse(execution.receipt.recordedAt) < Date.parse(execution.receipt.snapshotCapturedAt)
    ) {
      throw new Error("Trusted website artifact snapshot must follow proof preparation and preserve its exact capture boundary.");
    }
    requireCurrentWindow(
      evaluatedAt,
      execution.receipt.recordedAt,
      execution.receipt.freshUntil,
      `Artifact completeness receipt ${execution.receipt.receiptId}`,
    );

    return EligibleArtifactSchema.parse({
      manifestId: rootManifest.manifestId,
      manifestDigest: artifactManifestDigest(rootManifest),
      retentionClass: rootManifest.retentionClass,
      completeness: {
        executionDigest: execution.executionDigest,
        receiptId: execution.receipt.receiptId,
        receiptDigest: execution.receipt.receiptDigest,
        snapshotAttemptId: execution.receipt.snapshotAttemptId,
        snapshotCapturedAt: execution.receipt.snapshotCapturedAt,
        recordedAt: execution.receipt.recordedAt,
        freshUntil: execution.receipt.freshUntil,
        sourceFactsDigest: execution.receipt.sourceFactsDigest,
        sourceSetProofsDigest: execution.receipt.sourceSetProofsDigest,
        availabilitySourceSetProofDigest: availabilityProof.proofDigest,
        completenessAssurance: execution.receipt.completenessAssurance,
        availabilityAssurance: execution.receipt.availabilityAssurance,
        transactionApi: execution.transactionApi,
        executionPath: execution.executionPath,
      },
      availability: {
        receiptId: availability.receiptId,
        receiptDigest: availability.receiptDigest,
        checkedAt: availability.checkedAt,
        validThrough: availability.validThrough,
        expiresAt: availability.expiresAt,
        checkerKind: availability.checkerKind,
        objectSetDigest: availability.objectSetDigest,
        providerReadPerformed: availability.providerReadPerformed,
      },
    });
  }).sort((left, right) => left.manifestId.localeCompare(right.manifestId, "en-CA"));

  const websiteFreshThrough = new Date(
    Date.parse(evidence.workflow.completedAt)
      + PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const evidenceFreshThrough = earliestTimestamp([
    websiteFreshThrough,
    ...artifacts.flatMap((artifact) => [
      artifact.completeness.freshUntil,
      artifact.availability.validThrough,
      artifact.availability.expiresAt,
    ]),
  ]);
  requireCurrentWindow(evaluatedAt, evidence.preparedAt, evidenceFreshThrough, "Website evidence eligibility");

  const core = WebsiteEvidenceEligibilityCoreSchema.parse({
    eligibilityVersion: PRIVATE_KW_CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY_VERSION,
    receiptKind: "CURRENT_WEBSITE_EVIDENCE_ELIGIBILITY",
    manifestId: evidence.manifestId,
    manifestDigest: evidence.manifestDigest,
    businessId: evidence.businessId,
    evaluationCandidateId: evidence.evaluationCandidateId,
    sourceRecordId: evidence.sourceRecordId,
    websiteEvidence: {
      proofId: evidence.proofId,
      proofDigest: evidence.proofDigest,
      preparedAt: evidence.preparedAt,
      workflowId: evidence.workflow.workflowId,
      requestDigest: evidence.workflow.requestDigest,
      workflowReceiptId: evidence.workflow.receiptId,
      workflowReceiptDigest: evidence.workflow.receiptDigest,
      auditDigest: evidence.workflow.auditDigest,
      artifactSetDigest: evidence.workflow.artifactSetDigest,
    },
    persistedWorkflow: {
      workflowId: evidence.workflow.workflowId,
      businessId: evidence.businessId,
      requestDigest: evidence.workflow.requestDigest,
      workflowReceiptDigest: evidence.workflow.receiptDigest,
      workflowForestDigest: firstForestDigest,
      terminalCompletedAt: evidence.workflow.completedAt,
    },
    artifacts,
    evidenceFreshThrough,
    evaluatedAt,
    authority: privateKwCurrentWebsiteEvidenceEligibilityAuthority(),
  });
  const receiptDigest = artifactReferenceDigest(core);
  const receipt = PrivateKwCurrentWebsiteEvidenceEligibilityReceiptSchema.parse({
    ...core,
    receiptId: `website-evidence-eligibility:${receiptDigest}`,
    receiptDigest,
  });
  const trustedReceipt = deepFreeze(receipt);
  trustedEligibilityReceiptInstances.add(trustedReceipt);
  return trustedReceipt;
}
