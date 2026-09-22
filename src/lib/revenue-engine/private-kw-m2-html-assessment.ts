import { z } from "zod";

import { privateKwM2Digest } from "./private-kw-m2-authorization";
import { PrivateKwM2HtmlAuditReceiptSchema } from "./private-kw-m2-html-audit";
import { PageReceiptSchema, SourceIdentitySchema, PrivateKwM2WebsiteEvidenceReceiptSchema } from "./private-kw-m2-html-evidence-schema";
import { privateKwM2ReceiptCanonicalDigest } from "./private-kw-m2-html-evidence-receipt";

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.string().min(1).max(200);
const Time = z.string().datetime({ offset: true });
export const PRIVATE_KW_M2_HTML_ASSESSMENT_VERSION = "kw-m2-html-assessment-v1";

export function freezeM2<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeM2(child);
    Object.freeze(value);
  }
  return value;
}
export function m2AssessmentJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(m2AssessmentJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en-CA"))
    .map(([key, child]) => `${JSON.stringify(key)}:${m2AssessmentJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

const mappingCore = {
  mappingVersion: "kw-m2-html-assessment-mapping-v1", writerVersion: PRIVATE_KW_M2_HTML_ASSESSMENT_VERSION,
  assessmentKind: "WEBSITE_FIT_EVIDENCE", evidenceMode: "M2_HTML_ONLY", htmlClassification: "UNKNOWN",
  legacyClassification: "NO_OPPORTUNITY", scores: "ALL_ZERO", band: "RESEARCH", channel: "RESEARCH",
  methods: ["http_probe"], categories: ["availability"], confidence: 0, conversionCritical: false,
  sourceBasisMethod: "owner_review", sourceBasisConfidence: 80, sourceBasisState: "UNASSESSED",
  artifactRefs: "ALL_NULL", contactReview: "NOT_RECORDED", refreshDays: 60,
  requiredCaptureState: "COMPLETE", qualificationAuthorized: false,
} as const;
export const PRIVATE_KW_M2_HTML_ASSESSMENT_MAPPING = freezeM2({
  ...mappingCore, mappingDigest: privateKwM2Digest(mappingCore),
  mappingId: `kw-m2-html-assessment-mapping:${privateKwM2Digest(mappingCore)}`,
});
export const PRIVATE_KW_M2_HTML_ASSESSMENT_AUTHORITY = freezeM2({
  localOnly: true, qualificationAuthorized: false, contactAuthorized: false, consentAuthorized: false,
  outreachAuthorized: false, sendAuthorized: false, browserAuthorized: false, r2Authorized: false,
  deploymentAuthorized: false, runtimeConnected: false, remoteDatabaseAuthorized: false,
  providerOperationsAuthorized: 0, costAuthorizedUsd: 0,
} as const);
const Authority = z.object({
  localOnly: z.literal(true), qualificationAuthorized: z.literal(false), contactAuthorized: z.literal(false),
  consentAuthorized: z.literal(false), outreachAuthorized: z.literal(false), sendAuthorized: z.literal(false),
  browserAuthorized: z.literal(false), r2Authorized: z.literal(false), deploymentAuthorized: z.literal(false),
  runtimeConnected: z.literal(false), remoteDatabaseAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0), costAuthorizedUsd: z.literal(0),
}).strict();

/** Parsed data for deterministic planning only. This object is not a write capability. */
export const PrivateKwM2HtmlAssessmentContextSchema = z.object({
  businessId: Id, businessName: z.string().min(1).max(256), evaluationCandidateId: Id,
  sourceRecordId: Id, sourceEvidenceUrl: z.string().url(), sourceCapturedAt: Time,
  sourceMaterializationReceiptId: z.string().regex(/^kw-materialization:[a-f0-9]{64}$/),
  sourceMaterializationDigest: Digest, sourcePlanDigest: Digest,
  workflowReceiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/), workflowReceiptDigest: Digest,
  manifestId: Id, manifestDigest: Digest, task1ChainDigest: Digest,
  setupReceiptId: z.string().regex(/^kw-m2-database:[a-f0-9]{64}$/), setupReceiptDigest: Digest,
  priorM2CheckpointId: Id, priorM2CheckpointDigest: Digest,
  approvalExpiresAt: Time, evidence: PrivateKwM2WebsiteEvidenceReceiptSchema,
}).strict();
export type PrivateKwM2HtmlAssessmentContext = z.infer<typeof PrivateKwM2HtmlAssessmentContextSchema>;

export const PrivateKwM2HtmlWebsiteSnapshotSchema = z.object({
  snapshotVersion: z.literal("kw-m2-html-website-snapshot-v1"), evidenceMode: z.literal("M2_HTML_ONLY"),
  htmlOperationId: z.string().uuid(), htmlOperationDigest: Digest, sourceIdentity: SourceIdentitySchema,
  retentionDisposition: z.enum(["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY"]),
  pages: z.array(PageReceiptSchema).length(4), audit: PrivateKwM2HtmlAuditReceiptSchema,
  browserEvidence: z.literal(false), desktopArtifactRef: z.null(), mobileArtifactRef: z.null(), domArtifactRef: z.null(),
}).strict();

export function parseM2AssessmentContext(value: unknown) {
  const context = PrivateKwM2HtmlAssessmentContextSchema.parse(value);
  const { evidence } = context;
  const { operationDigest, ...operation } = evidence;
  if (privateKwM2ReceiptCanonicalDigest(operation) !== operationDigest) throw new Error("HTML operation digest mismatch.");
  if (evidence.status !== "COMPLETE" || !evidence.audit || !evidence.sourcePolicy || evidence.blockedEvidence
    || evidence.pages.length !== 4 || evidence.pages.some((page) => page.outcome !== "CAPTURED"
      || !["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY"].includes(page.storageOutcome) || !page.finalUrl || !page.contentDigest)
    || new Set(evidence.pages.map((page) => page.pageKind)).size !== 4) {
    throw new Error("Only complete retained HTML evidence can enter assessment planning.");
  }
  if (new Set(evidence.pages.map((page) => page.storageOutcome)).size !== 1) {
    throw new Error("HTML assessment requires uniform retention across its four pages.");
  }
  const identity = evidence.sourceIdentity;
  if (context.businessId !== evidence.businessId || context.businessId !== identity.businessId
    || context.evaluationCandidateId !== identity.evaluationCandidateId || context.sourceRecordId !== identity.sourceRecordId
    || context.sourceEvidenceUrl !== identity.sourceEvidenceUrl || context.sourceCapturedAt !== identity.sourceCapturedAt
    || context.sourcePlanDigest !== identity.sourcePlanDigest || context.manifestDigest !== identity.manifestDigest
    || Date.parse(context.approvalExpiresAt) > Date.parse(evidence.authorizationExpiresAt)) {
    throw new Error("HTML assessment source and authorization lineage mismatch.");
  }
  return freezeM2(context);
}

const ApprovalCore = z.object({
  approvalVersion: z.literal("kw-m2-html-assessment-approval-v1"), status: z.enum(["PENDING", "APPROVED"]),
  contextDigest: Digest, mappingId: Id, mappingDigest: Digest, assessedAt: Time, expiresAt: Time,
  approvedBy: z.enum(["RILEY", "AIDAN"]).nullable(), reviewedAt: Time.nullable(),
  rationale: z.string().min(10).max(1000).nullable(),
  confirmation: z.literal("RECORD_LOCAL_HTML_WEBSITE_FIT_ASSESSMENT").nullable(), authority: Authority,
});
export const PrivateKwM2HtmlAssessmentApprovalSchema = ApprovalCore.extend({ approvalId: Id, approvalDigest: Digest })
  .strict().superRefine((value, issue) => {
    const { approvalId, approvalDigest, ...core } = value;
    if (privateKwM2Digest(core) !== approvalDigest || approvalId !== `kw-m2-html-assessment-approval:${approvalDigest}`) {
      issue.addIssue({ code: "custom", message: "Assessment approval digest mismatch." });
    }
    if (value.mappingId !== PRIVATE_KW_M2_HTML_ASSESSMENT_MAPPING.mappingId
      || value.mappingDigest !== PRIVATE_KW_M2_HTML_ASSESSMENT_MAPPING.mappingDigest) {
      issue.addIssue({ code: "custom", message: "Unsupported HTML assessment mapping." });
    }
    const reviewed = [value.approvedBy, value.reviewedAt, value.rationale, value.confirmation];
    if (value.status === "APPROVED" ? reviewed.some((item) => item === null) : reviewed.some((item) => item !== null)) {
      issue.addIssue({ code: "custom", message: "Assessment requires its separate complete owner decision." });
    }
    if (Date.parse(value.expiresAt) <= Date.parse(value.assessedAt)
      || (value.reviewedAt && (Date.parse(value.reviewedAt) < Date.parse(value.assessedAt)
        || Date.parse(value.reviewedAt) >= Date.parse(value.expiresAt)))) {
      issue.addIssue({ code: "custom", message: "Invalid assessment approval time window." });
    }
  });
export type PrivateKwM2HtmlAssessmentApproval = z.infer<typeof PrivateKwM2HtmlAssessmentApprovalSchema>;
function sealApproval(core: z.infer<typeof ApprovalCore>) {
  const approvalDigest = privateKwM2Digest(core);
  return freezeM2(PrivateKwM2HtmlAssessmentApprovalSchema.parse({ ...core, approvalDigest,
    approvalId: `kw-m2-html-assessment-approval:${approvalDigest}` }));
}
export function buildPrivateKwM2HtmlAssessmentCandidate(contextValue: unknown, assessedAt: string) {
  const context = parseM2AssessmentContext(contextValue);
  Time.parse(assessedAt);
  if (context.evidence.pages.some((page) => Date.parse(page.capturedAt) > Date.parse(assessedAt))) {
    throw new Error("Assessment cannot predate its HTML evidence.");
  }
  return sealApproval({ approvalVersion: "kw-m2-html-assessment-approval-v1", status: "PENDING",
    contextDigest: privateKwM2Digest(context), mappingId: PRIVATE_KW_M2_HTML_ASSESSMENT_MAPPING.mappingId,
    mappingDigest: PRIVATE_KW_M2_HTML_ASSESSMENT_MAPPING.mappingDigest, assessedAt,
    expiresAt: context.approvalExpiresAt, approvedBy: null, reviewedAt: null, rationale: null, confirmation: null,
    authority: PRIVATE_KW_M2_HTML_ASSESSMENT_AUTHORITY });
}

/** Records an explicit decision; callers must persist/reload it separately before execution. */
export function recordPrivateKwM2HtmlAssessmentApproval(candidateValue: unknown, contextValue: unknown, decision: {
  approvedBy: "RILEY" | "AIDAN"; reviewedAt: string; rationale: string;
  confirmation: "RECORD_LOCAL_HTML_WEBSITE_FIT_ASSESSMENT";
}, now = new Date()) {
  const candidate = PrivateKwM2HtmlAssessmentApprovalSchema.parse(candidateValue);
  const expected = buildPrivateKwM2HtmlAssessmentCandidate(contextValue, candidate.assessedAt);
  if (candidate.status !== "PENDING" || privateKwM2Digest(candidate) !== privateKwM2Digest(expected)) {
    throw new Error("Owner decision must bind the exact pending assessment candidate.");
  }
  const core = ApprovalCore.parse(candidate);
  const approved = sealApproval({ ...core, ...decision, status: "APPROVED" });
  assertPrivateKwM2HtmlAssessmentApproval(approved, contextValue, now);
  return approved;
}
export function assertPrivateKwM2HtmlAssessmentApproval(value: unknown, contextValue: unknown, now: Date) {
  const context = parseM2AssessmentContext(contextValue);
  const approval = PrivateKwM2HtmlAssessmentApprovalSchema.parse(value);
  const expected = buildPrivateKwM2HtmlAssessmentCandidate(context, approval.assessedAt);
  if (approval.status !== "APPROVED" || approval.contextDigest !== expected.contextDigest
    || approval.expiresAt !== expected.expiresAt || !Number.isFinite(now.getTime())
    || now.getTime() < Date.parse(approval.reviewedAt!) || now.getTime() >= Date.parse(approval.expiresAt)) {
    throw new Error("Missing, mismatched or expired separate HTML assessment approval.");
  }
  return freezeM2(approval);
}

export type M2HtmlSqlValue = string | number | null;
export type M2HtmlRowPlan = Readonly<{ table: string; row: Readonly<Record<string, M2HtmlSqlValue>>;
  keys: readonly string[] }>;

/** Pure deterministic plan. Execution requires the runner's independent durable reloads. */
export function buildPrivateKwM2HtmlAssessmentPlan(contextValue: unknown, approvalValue: unknown, at: Date) {
  const context = parseM2AssessmentContext(contextValue);
  const approval = assertPrivateKwM2HtmlAssessmentApproval(approvalValue, context, at);
  const { evidence } = context;
  const mapping = PRIVATE_KW_M2_HTML_ASSESSMENT_MAPPING;
  const recordedAt = at.toISOString();
  const seed = privateKwM2Digest({ context, mapping, approval });
  const home = evidence.pages.find((page) => page.pageKind === "HOME")!;
  const websiteId = `website:${privateKwM2Digest({ seed, entity: "WEBSITE" })}`;
  const qualificationId = `qualification:${privateKwM2Digest({ seed, entity: "QUALIFICATION" })}`;
  const snapshot = PrivateKwM2HtmlWebsiteSnapshotSchema.parse({
    snapshotVersion: "kw-m2-html-website-snapshot-v1", evidenceMode: "M2_HTML_ONLY",
    htmlOperationId: evidence.operationId, htmlOperationDigest: evidence.operationDigest,
    sourceIdentity: evidence.sourceIdentity, retentionDisposition: home.storageOutcome,
    pages: evidence.pages, audit: evidence.audit, browserEvidence: false,
    desktopArtifactRef: null, mobileArtifactRef: null, domArtifactRef: null,
  });
  const website = {
    id: websiteId, businessId: context.businessId, url: evidence.sourceIdentity.approvedWebsiteUrl,
    finalUrl: home.finalUrl!, classification: "NO_OPPORTUNITY", auditVersion: evidence.audit!.auditVersion,
    desktopArtifactRef: null, mobileArtifactRef: null, domArtifactRef: null,
    deterministicChecksJson: m2AssessmentJson(snapshot), capturedAt: home.capturedAt,
    refreshAfter: new Date(Date.parse(home.capturedAt) + mapping.refreshDays * 86_400_000).toISOString(),
    createdAt: recordedAt, evidenceMode: "M2_HTML_ONLY",
  };
  const claims = evidence.pages.map((page) => ({
    id: `evidence:${privateKwM2Digest({ seed, page })}`, businessId: context.businessId, websiteSnapshotId: websiteId,
    category: "availability", observation: `${page.pageKind}: HTTP ${page.statusCode}; ${page.bodyBytes} response bytes; ${page.redirectCount} redirects. HTML capture only; rendered usability is unassessed.`,
    sourceUrl: page.finalUrl!, artifactRef: null, method: "http_probe", confidence: 0, conversionCritical: 0,
    auditVersion: evidence.audit!.auditVersion, capturedAt: page.capturedAt, createdAt: recordedAt,
    evidenceMode: "M2_HTML_ONLY",
  }));
  const qualification = {
    id: qualificationId, snapshotKey: `kw-m2-html:${seed}`, businessId: context.businessId,
    policyVersion: mapping.mappingVersion, shadowOnly: 1, totalScore: 0, rebuildNeedScore: 0,
    businessFitScore: 0, reachabilityScore: 0, timingScore: 0, evidenceConfidenceScore: 0,
    band: "RESEARCH", recommendedChannel: "RESEARCH", supportedObservationCount: 0, conversionCriticalCount: 0,
    failedGatesJson: "[]", evidenceClaimIdsJson: "[]", createdAt: recordedAt, evidenceMode: "M2_HTML_ONLY",
  };
  const basis = (["BUSINESS_FIT", "TIMING"] as const).map((kind) => ({
    id: `basis:${privateKwM2Digest({ kind, sourceRecordId: context.sourceRecordId, mapping })}`, kind,
    observation: kind === "BUSINESS_FIT" ? "Website fit and qualification are unassessed." : "Purchase timing is unassessed.",
    sourceUrl: context.sourceEvidenceUrl, capturedAt: context.sourceCapturedAt, method: "owner_review", confidence: 80,
  }));
  const assessmentCore = {
    assessmentVersion: PRIVATE_KW_M2_HTML_ASSESSMENT_VERSION, assessmentKind: "WEBSITE_FIT_EVIDENCE", mode: "SHADOW",
    businessId: context.businessId, contextDigest: privateKwM2Digest(context), approvalId: approval.approvalId,
    approvalDigest: approval.approvalDigest, mapping, websiteSnapshotId: websiteId, qualificationSnapshotId: qualificationId,
    htmlClassification: "UNKNOWN", audit: evidence.audit, basis, assessedAt: approval.assessedAt,
    scores: { rebuildNeed: 0, businessFit: 0, timing: 0, reachability: 0, evidenceConfidence: 0 },
    band: "RESEARCH", recommendedChannel: "RESEARCH", authority: PRIVATE_KW_M2_HTML_ASSESSMENT_AUTHORITY,
  };
  const assessmentDigest = privateKwM2Digest(assessmentCore);
  const assessmentId = `assessment:${assessmentDigest}`;
  const assessment = { ...assessmentCore, assessmentId, assessmentDigest };
  const assessmentRow = {
    id: assessmentId, assessmentVersion: PRIVATE_KW_M2_HTML_ASSESSMENT_VERSION, assessmentKind: "WEBSITE_FIT_EVIDENCE",
    assessmentKey: `kw-m2-html:${seed}`, businessId: context.businessId, workflowReceiptId: context.workflowReceiptId,
    websiteSnapshotId: websiteId, qualificationSnapshotId: qualificationId, auditDigest: privateKwM2Digest(evidence.audit),
    qualificationDigest: privateKwM2Digest(qualification), basisDigest: privateKwM2Digest(basis), evidenceClaimCount: claims.length,
    assessmentDigest, assessmentJson: m2AssessmentJson(assessment), recordedAt, createdAt: recordedAt,
    mode: "SHADOW", transactionKind: "D1_BATCH", outreachAuthorized: 0, sendAuthorized: 0, providerOperationsAuthorized: 0, costAuthorizedUsd: 0,
  };
  const websiteProgressDigest = privateKwM2Digest({ parent: context.sourceMaterializationDigest, evidence, mapping });
  const websiteProgress = { id: `kw-m2-html-website-evidence:${websiteProgressDigest}`, digest: websiteProgressDigest,
    parent: context.sourceMaterializationReceiptId, completion: "HTML_WEBSITE_EVIDENCE_PERSISTED" };
  const assessmentRows: M2HtmlRowPlan[] = [
    { table: "RevenueWebsiteSnapshot", row: website, keys: ["id"] },
    ...claims.map((row) => ({ table: "RevenueEvidenceClaim", row, keys: ["id"] })),
    { table: "RevenueQualificationSnapshot", row: qualification, keys: ["id", "snapshotKey"] },
    { table: "RevenueLeadAssessmentReceipt", row: assessmentRow, keys: ["id", "assessmentKey", "qualificationSnapshotId"] },
  ];
  const progressSeed = {
    sourceMaterializationReceiptId: context.sourceMaterializationReceiptId,
    sourceMaterializationDigest: context.sourceMaterializationDigest,
    businessId: context.businessId, evaluationCandidateId: context.evaluationCandidateId, sourceRecordId: context.sourceRecordId,
    htmlOperationId: evidence.operationId, htmlOperationDigest: evidence.operationDigest, pages: evidence.pages,
    mapping, approval, websiteProgress, assessmentId, assessmentDigest,
    priorM2CheckpointId: context.priorM2CheckpointId, priorM2CheckpointDigest: context.priorM2CheckpointDigest,
    rowDigests: assessmentRows.map(({ table, row }) => ({ table, id: row.id, digest: privateKwM2Digest(row) })),
  };
  const lineageSeedDigest = privateKwM2Digest(progressSeed);
  const progressCore = { progressVersion: "kw-m2-html-assessment-progress-v1", ...progressSeed,
    lineageSeedDigest, completion: "ASSESSMENT_PERSISTED" };
  const assessmentProgressDigest = privateKwM2Digest(progressCore);
  const assessmentProgress = { ...progressCore, id: `kw-m2-html-progress:${assessmentProgressDigest}`, digest: assessmentProgressDigest };
  const columns = {
    lineageVersion: "kw-m2-html-lineage-v1", lineageSeedDigest, assessmentKind: "WEBSITE_FIT_EVIDENCE",
    businessId: context.businessId, sourceMaterializationReceiptId: context.sourceMaterializationReceiptId,
    sourcePlanDigest: context.sourcePlanDigest, workflowReceiptId: context.workflowReceiptId,
    htmlOperationId: evidence.operationId, htmlOperationDigest: evidence.operationDigest,
    mappingId: mapping.mappingId, mappingDigest: mapping.mappingDigest, websiteSnapshotId: websiteId,
    qualificationSnapshotId: qualificationId, assessmentReceiptId: assessmentId, assessmentReceiptDigest: assessmentDigest,
    websiteProgressId: websiteProgress.id, websiteProgressDigest, assessmentProgressId: assessmentProgress.id, assessmentProgressDigest,
    sourcePolicyDigest: privateKwM2Digest(evidence.sourcePolicy), transportChainDigest: privateKwM2Digest(evidence.transportReceipts),
    pageSetDigest: privateKwM2Digest(evidence.pages), htmlClassification: "UNKNOWN",
    retentionDisposition: home.storageOutcome,
  };
  const lineageCore = {
    ...columns,
    authority: PRIVATE_KW_M2_HTML_ASSESSMENT_AUTHORITY,
  };
  const lineageDigest = privateKwM2Digest(lineageCore);
  const lineageRow = { ...columns, id: `kw-m2-html-lineage:${lineageDigest}`, lineageDigest,
    lineageJson: m2AssessmentJson(lineageCore), recordedAt,
    localOnly: 1, qualificationAuthorized: 0, contactAuthorized: 0, consentAuthorized: 0,
    outreachAuthorized: 0, sendAuthorized: 0, browserAuthorized: 0, r2Authorized: 0, deploymentAuthorized: 0,
    providerOperationsAuthorized: 0, costAuthorizedUsd: 0 };
  const rows: M2HtmlRowPlan[] = [
    ...assessmentRows,
    { table: "RevenuePrivateKwM2HtmlAssessmentLineage", row: lineageRow,
      keys: ["id", "htmlOperationId", "assessmentReceiptId", "websiteProgressId", "assessmentProgressId", "lineageDigest"] },
  ];
  return freezeM2({ seed, context, approval, mapping, rows, assessment, lineage: lineageCore,
    lineageId: lineageRow.id, lineageDigest, websiteProgress, assessmentProgress });
}
export type PrivateKwM2HtmlAssessmentPlan = ReturnType<typeof buildPrivateKwM2HtmlAssessmentPlan>;
