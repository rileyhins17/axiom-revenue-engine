import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
} from "@/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "@/lib/revenue-engine/private-kw-persistence-plan";
import {
  PRIVATE_KW_SHADOW_SLICE_SIZE,
  PRIVATE_KW_SHADOW_SLICE_VERSION,
  buildPrivateKwShadowSliceManifest,
  type PrivateKwShadowSliceInput,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION,
  PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
  buildPrivateKwSourceWorkflowMaterializationPlan,
  privateKwSourceWorkflowDigest,
  type PrivateKwSourceWorkflowMaterializationInput,
} from "@/lib/revenue-engine/private-kw-source-workflow-materialization";

const CITIES = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
const NICHES = ["ROOFING", "HVAC", "LANDSCAPING"] as const;

export function createPrivateKwShadowSourceWorkflowFixture(options: {
  suffix?: string;
  now?: Date;
  materializationRecordIndex?: number;
} = {}) {
  const suffix = options.suffix ?? "unit";
  const nowMs = (options.now ?? new Date("2026-08-28T16:00:00.000Z")).getTime();
  const at = (minutesBefore: number) => new Date(nowMs - minutesBefore * 60_000).toISOString();
  const sourceCapturedAt = at(6);
  const sourceReviewedAt = at(5);
  const manifestCreatedAt = at(4);
  const auditCapturedAt = at(3);
  const evidenceCompletedAt = at(2);
  const materializationReviewedAt = at(1);

  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: `kw-shadow-progress-${suffix}`,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic bounded source workflow progress fixture",
    filters: { synthetic: true },
    capturedAt: sourceCapturedAt,
    costUsd: 0,
    records: Array.from({ length: 12 }, (_, index) => ({
      sourceOwnedId: `source-workflow-${suffix}-${index + 1}`,
      sourceEvidenceUrl: `https://directory.axiomfixtures.ca/source-workflow-${suffix}-${index + 1}`,
      businessName: `Synthetic Independent Service Business ${index + 1}`,
      city: CITIES[index % CITIES.length],
      region: "ON" as const,
      country: "CA" as const,
      niche: NICHES[index % NICHES.length],
      websiteUrl: null,
      phone: `519555${String(3000 + index)}`,
      addressLine: `${index + 1} Synthetic Street`,
      postalCode: "N2G 1A1",
      independenceStatus: "INDEPENDENT" as const,
      capturedAt: sourceCapturedAt,
      sourcePayload: { synthetic: true },
    })),
  });
  const sourcePlanDigest = buildPrivateKwPersistencePlan(source).sourcePlanDigest;
  const sliceInput: PrivateKwShadowSliceInput = {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION,
    sliceKey: `shadow-progress-${suffix}`,
    sourceImportId: source.importId,
    sourcePlanDigest,
    createdAt: manifestCreatedAt,
    selections: source.records.slice(0, PRIVATE_KW_SHADOW_SLICE_SIZE).map((record) => ({
      businessId: record.business.id,
      evaluationCandidateId: record.evaluationCandidateId,
      sourceReview: {
        decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE",
        reviewedBy: "RILEY",
        reviewedAt: sourceReviewedAt,
        rationale: "Synthetic identity, market, niche, and independence were checked.",
        identityConfirmed: true,
        marketAndNicheConfirmed: true,
        independenceConfirmed: true,
      },
    })),
    mode: "SHADOW",
    authority: {
      planOnly: true,
      liveSourceAuthorized: false,
      browserCaptureAuthorized: false,
      artifactStorageAuthorized: false,
      databaseMutationAuthorized: false,
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
    },
  };
  const manifest = buildPrivateKwShadowSliceManifest(source, sliceInput);
  const selected = source.records[options.materializationRecordIndex ?? 0];
  if (!selected) throw new Error("Synthetic materialization fixture index is out of range.");
  const auditInput = {
    businessId: selected.business.id,
    businessName: selected.business.canonicalName,
    niche: selected.niche.toLocaleLowerCase("en-CA"),
    expectedServices: [selected.niche],
    expectedLocations: [selected.location.city],
    sourceEvidenceUrl: selected.sourceRecord.sourceEvidenceUrl,
    siteState: "NO_SITE" as const,
    requestedUrl: null,
    finalUrl: null,
    statusCode: 0,
    redirectCount: 0,
    capturedAt: auditCapturedAt,
    desktopArtifactRef: null,
    mobileArtifactRef: null,
    domArtifactRef: null,
    pageSetComplete: true,
    pages: [],
    resourceProbes: [],
    mobile: {
      captured: false,
      horizontalOverflow: null,
      navigationUsable: null,
      textReadable: null,
      minimumTapTargetPx: null,
    },
  };
  const materialization: PrivateKwSourceWorkflowMaterializationInput = {
    materializationVersion: PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
    sourceImportId: source.importId,
    sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    auditInputDigest: privateKwSourceWorkflowDigest(auditInput),
    auditInput,
    evidenceCompletedAt,
    approval: {
      decision: "APPROVED_FOR_LOCAL_SOURCE_WORKFLOW_MATERIALIZATION",
      reviewedBy: "RILEY",
      reviewedAt: materializationReviewedAt,
      rationale: "Approved synthetic source and workflow proof for local progress verification.",
      confirmation: PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION,
    },
    mode: "SHADOW",
    executionKind: "IGNORED_LOCAL_SQLITE",
    localDatabaseAccessAuthorized: true,
    localSourceMutationAuthorized: true,
    localWorkflowMutationAuthorized: true,
    localAssessmentMutationAuthorized: false,
    schemaMutationAuthorized: false,
    captureAuthorized: false,
    contactDiscoveryAuthorized: false,
    contactVerificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
  const plan = buildPrivateKwSourceWorkflowMaterializationPlan(source, materialization);
  const exactStoredRecords = plan.records.map((record) => ({
    entity: record.entity,
    recordId: record.recordId,
    rows: [{ ...record.expected }],
  }));

  return {
    source,
    manifest,
    materialization,
    plan,
    exactStoredRecords,
    recordedAt: new Date(nowMs).toISOString(),
  };
}
