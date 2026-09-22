import { z } from "zod";

import { privateKwM2Digest } from "@/lib/revenue-engine/private-kw-m2-authorization";
import {
  PRIVATE_KW_M2_HTML_ASSESSMENT_AUTHORITY,
  PRIVATE_KW_M2_HTML_ASSESSMENT_MAPPING,
  PrivateKwM2HtmlAssessmentContextSchema,
  type PrivateKwM2HtmlAssessmentPlan,
  m2AssessmentJson,
} from "@/lib/revenue-engine/private-kw-m2-html-assessment";
import { privateKwM2ReceiptCanonicalDigest } from "@/lib/revenue-engine/private-kw-m2-canonical";
import { PrivateKwM2WebsiteEvidenceReceiptSchema } from "@/lib/revenue-engine/private-kw-m2-html-evidence-schema";

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const AuthoritySchema = z.object({
  localOnly: z.literal(true),
  qualificationAuthorized: z.literal(false),
  contactAuthorized: z.literal(false),
  consentAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  browserAuthorized: z.literal(false),
  r2Authorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  runtimeConnected: z.literal(false),
  remoteDatabaseAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0),
  costAuthorizedUsd: z.literal(0),
}).strict();

const PageSchema = z.object({
  pageKind: z.enum(["HOME", "SERVICE", "ABOUT", "CONTACT"]),
  requestedUrl: z.string().url(),
  finalUrl: z.string().url(),
  capturedAt: TimestampSchema,
  statusCode: z.number().int().min(0).max(599),
  redirectCount: z.number().int().nonnegative().max(20),
  bodyBytes: z.number().int().nonnegative().max(1_048_576),
  contentDigest: DigestSchema,
  factsDigest: DigestSchema.nullable(),
  storageOutcome: z.enum(["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY"]),
  storageRefs: z.object({
    contentRef: z.string().nullable(),
    metadataRef: z.string().nullable(),
    factsRef: z.string().nullable(),
    receiptRef: z.string().nullable(),
  }).strict(),
}).strict();

export const PrivateKwM2OwnerLeadDetailResponseSchema = z.object({
  responseVersion: z.literal("kw-m2-html-owner-lead-detail-v1"),
  business: z.object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(256),
    evaluationCandidateId: z.string().min(1).max(128),
    sourceRecordId: z.string().min(1).max(128),
  }).strict(),
  htmlEvidence: z.object({
    operationId: z.string().uuid(),
    operationDigest: DigestSchema,
    lineageId: z.string().regex(/^kw-m2-html-lineage:[a-f0-9]{64}$/),
    lineageDigest: DigestSchema,
    mappingId: z.string().regex(/^kw-m2-html-assessment-mapping:[a-f0-9]{64}$/),
    mappingDigest: DigestSchema,
    assessmentId: z.string().regex(/^assessment:[a-f0-9]{64}$/),
    assessmentDigest: DigestSchema,
    websiteSnapshotId: z.string().regex(/^website:[a-f0-9]{64}$/),
    qualificationSnapshotId: z.string().regex(/^qualification:[a-f0-9]{64}$/),
    sourceEvidenceUrl: z.string().url(),
    approvedWebsiteUrl: z.string().url(),
    sourceCapturedAt: TimestampSchema,
    manifestId: z.string().min(1).max(200),
    manifestDigest: DigestSchema,
    task1ChainDigest: DigestSchema,
    sourcePlanDigest: DigestSchema,
    sourceMaterializationReceiptId: z.string().regex(/^kw-materialization:[a-f0-9]{64}$/),
    sourceMaterializationDigest: DigestSchema,
    workflowReceiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/),
    workflowReceiptDigest: DigestSchema,
    priorM2CheckpointId: z.string().min(1).max(200),
    priorM2CheckpointDigest: DigestSchema,
    sourceUrl: z.string().url(),
    finalUrl: z.string().url(),
    capturedAt: TimestampSchema,
    retentionDisposition: z.enum(["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY"]),
    pages: z.array(PageSchema).length(4),
    unknownLimitations: z.array(z.string().trim().min(1).max(120)).max(20),
    browserEvidence: z.literal(false),
    desktopArtifactRef: z.null(),
    mobileArtifactRef: z.null(),
    domArtifactRef: z.null(),
  }).strict(),
  classification: z.object({
    value: z.literal("UNKNOWN"),
    authority: z.literal("NON_QUALIFYING_HTML_ONLY"),
  }).strict(),
  qualification: z.object({
    band: z.literal("RESEARCH"),
    recommendedChannel: z.literal("RESEARCH"),
    scores: z.object({
      rebuildNeed: z.literal(0),
      businessFit: z.literal(0),
      timing: z.literal(0),
      reachability: z.literal(0),
      evidenceConfidence: z.literal(0),
    }).strict(),
  }).strict(),
  availableChannels: z.array(z.never()).length(0),
  routes: z.array(z.never()).length(0),
  contactReview: z.object({
    state: z.literal("NOT_RECORDED"),
    consentBasis: z.literal("UNASSESSED"),
    authority: AuthoritySchema,
  }).strict(),
  authority: AuthoritySchema,
}).strict();

export type PrivateKwM2OwnerLeadDetailResponse = z.infer<typeof PrivateKwM2OwnerLeadDetailResponseSchema>;

function reject(message: string): never {
  throw new Error(`M2 owner projection rejected: ${message}`);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (m2AssessmentJson(actual) !== m2AssessmentJson(expected)) reject(message);
}

function assertPlanIsBounded(plan: PrivateKwM2HtmlAssessmentPlan) {
  const context = PrivateKwM2HtmlAssessmentContextSchema.parse(plan.context);
  const evidence = PrivateKwM2WebsiteEvidenceReceiptSchema.parse(context.evidence);
  const { operationDigest, ...operationCore } = evidence;
  if (privateKwM2ReceiptCanonicalDigest(operationCore) !== operationDigest) reject("HTML operation digest mismatch");
  if (evidence.status !== "COMPLETE" || !evidence.audit || evidence.blockedEvidence || evidence.pages.length !== 4) {
    reject("only complete HTML evidence may enter the owner projection");
  }
  const home = evidence.pages.find((page) => page.pageKind === "HOME");
  if (!home || !home.finalUrl || home.storageOutcome === "BLOCKED" || home.storageOutcome === "NONE") reject("homepage evidence is incomplete");
  if (evidence.pages.some((page) => page.outcome !== "CAPTURED" || !page.finalUrl || !page.contentDigest
    || !["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY"].includes(page.storageOutcome))) reject("a selected page is not fully retained");
  if (new Set(evidence.pages.map((page) => page.storageOutcome)).size !== 1) reject("mixed retention is not an owner projection");
  if (plan.mapping.mappingId !== PRIVATE_KW_M2_HTML_ASSESSMENT_MAPPING.mappingId
    || plan.mapping.mappingDigest !== PRIVATE_KW_M2_HTML_ASSESSMENT_MAPPING.mappingDigest
    || m2AssessmentJson(plan.mapping) !== m2AssessmentJson(PRIVATE_KW_M2_HTML_ASSESSMENT_MAPPING)) reject("assessment mapping is not the approved HTML-only mapping");
  const { assessmentId, assessmentDigest, ...assessmentCore } = plan.assessment;
  if (assessmentId !== `assessment:${assessmentDigest}` || privateKwM2Digest(assessmentCore) !== assessmentDigest) reject("assessment digest mismatch");
  if (plan.assessment.htmlClassification !== "UNKNOWN" || plan.assessment.band !== "RESEARCH" || plan.assessment.recommendedChannel !== "RESEARCH") reject("qualification projection is not fixed to research");
  if (Object.values(plan.assessment.scores).some((value) => value !== 0)) reject("HTML evidence cannot provide qualification scores");
  assertEqual(plan.assessment.authority, PRIVATE_KW_M2_HTML_ASSESSMENT_AUTHORITY, "assessment authority is not zero-authority");
  if (plan.lineageId !== `kw-m2-html-lineage:${plan.lineageDigest}` || privateKwM2Digest(plan.lineage) !== plan.lineageDigest) reject("lineage digest mismatch");
  assertEqual(plan.lineage.authority, PRIVATE_KW_M2_HTML_ASSESSMENT_AUTHORITY, "lineage authority is not zero-authority");
  if (plan.lineage.htmlOperationId !== evidence.operationId || plan.lineage.htmlOperationDigest !== evidence.operationDigest
    || plan.lineage.mappingId !== plan.mapping.mappingId || plan.lineage.mappingDigest !== plan.mapping.mappingDigest
    || plan.lineage.assessmentReceiptId !== plan.assessment.assessmentId || plan.lineage.assessmentReceiptDigest !== plan.assessment.assessmentDigest
    || plan.lineage.websiteSnapshotId !== plan.assessment.websiteSnapshotId || plan.lineage.qualificationSnapshotId !== plan.assessment.qualificationSnapshotId
    || plan.lineage.sourcePlanDigest !== context.sourcePlanDigest || plan.lineage.workflowReceiptId !== context.workflowReceiptId) reject("lineage does not bind the current HTML assessment");
  return { context, evidence, home };
}

/** Pure owner-facing projection. It does not authenticate durable state or grant any execution capability. */
export function projectPrivateKwM2OwnerLeadDetail(plan: PrivateKwM2HtmlAssessmentPlan): PrivateKwM2OwnerLeadDetailResponse {
  const { context, evidence, home } = assertPlanIsBounded(plan);
  const authority = PRIVATE_KW_M2_HTML_ASSESSMENT_AUTHORITY;
  return PrivateKwM2OwnerLeadDetailResponseSchema.parse({
    responseVersion: "kw-m2-html-owner-lead-detail-v1",
    business: {
      id: context.businessId,
      name: context.businessName,
      evaluationCandidateId: context.evaluationCandidateId,
      sourceRecordId: context.sourceRecordId,
    },
    htmlEvidence: {
      operationId: evidence.operationId,
      operationDigest: evidence.operationDigest,
      lineageId: plan.lineageId,
      lineageDigest: plan.lineageDigest,
      mappingId: plan.mapping.mappingId,
      mappingDigest: plan.mapping.mappingDigest,
      assessmentId: plan.assessment.assessmentId,
      assessmentDigest: plan.assessment.assessmentDigest,
      websiteSnapshotId: plan.assessment.websiteSnapshotId,
      qualificationSnapshotId: plan.assessment.qualificationSnapshotId,
      sourceEvidenceUrl: context.sourceEvidenceUrl,
      approvedWebsiteUrl: evidence.sourceIdentity.approvedWebsiteUrl,
      sourceCapturedAt: context.sourceCapturedAt,
      manifestId: context.manifestId,
      manifestDigest: context.manifestDigest,
      task1ChainDigest: context.task1ChainDigest,
      sourcePlanDigest: context.sourcePlanDigest,
      sourceMaterializationReceiptId: context.sourceMaterializationReceiptId,
      sourceMaterializationDigest: context.sourceMaterializationDigest,
      workflowReceiptId: context.workflowReceiptId,
      workflowReceiptDigest: context.workflowReceiptDigest,
      priorM2CheckpointId: context.priorM2CheckpointId,
      priorM2CheckpointDigest: context.priorM2CheckpointDigest,
      sourceUrl: home.requestedUrl,
      finalUrl: home.finalUrl,
      capturedAt: home.capturedAt,
      retentionDisposition: home.storageOutcome,
      pages: evidence.pages.map(({ pageKind, requestedUrl, finalUrl, capturedAt, statusCode, redirectCount, bodyBytes, contentDigest, factsDigest, storageOutcome, storageRefs }) => ({
        pageKind, requestedUrl, finalUrl: finalUrl!, capturedAt, statusCode, redirectCount, bodyBytes, contentDigest: contentDigest!, factsDigest, storageOutcome: storageOutcome as "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY", storageRefs,
      })),
      unknownLimitations: evidence.audit!.unknownLimitations,
      browserEvidence: false,
      desktopArtifactRef: null,
      mobileArtifactRef: null,
      domArtifactRef: null,
    },
    classification: { value: "UNKNOWN", authority: "NON_QUALIFYING_HTML_ONLY" },
    qualification: {
      band: "RESEARCH",
      recommendedChannel: "RESEARCH",
      scores: { rebuildNeed: 0, businessFit: 0, timing: 0, reachability: 0, evidenceConfidence: 0 },
    },
    availableChannels: [],
    routes: [],
    contactReview: { state: "NOT_RECORDED", consentBasis: "UNASSESSED", authority },
    authority,
  });
}
