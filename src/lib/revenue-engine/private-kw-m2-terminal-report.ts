import { z } from "zod";

import { privateKwM2Digest } from "./private-kw-m2-authorization";
import {
  PRIVATE_KW_M2_HTML_ASSESSMENT_AUTHORITY,
  m2AssessmentJson,
  parseM2EvidenceContext,
  type PrivateKwM2HtmlAssessmentContext,
} from "./private-kw-m2-html-assessment";
import { PrivateKwM2HtmlAuditReceiptSchema } from "./private-kw-m2-html-audit";
import {
  PageReceiptSchema,
  PageSelectionSchema,
  PrivateKwM2WebsiteEvidenceReceiptSchema,
  SourceIdentitySchema,
} from "./private-kw-m2-html-evidence-schema";
import { PrivateKwSourcePolicyDecisionSchema } from "./private-kw-source-policy";

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const AuthoritySchema = z.object({
  localOnly: z.literal(true), qualificationAuthorized: z.literal(false), contactAuthorized: z.literal(false),
  consentAuthorized: z.literal(false), outreachAuthorized: z.literal(false), sendAuthorized: z.literal(false),
  browserAuthorized: z.literal(false), r2Authorized: z.literal(false), deploymentAuthorized: z.literal(false),
  runtimeConnected: z.literal(false), remoteDatabaseAuthorized: z.literal(false),
  providerOperationsAuthorized: z.literal(0), costAuthorizedUsd: z.literal(0),
}).strict();

const LineageSchema = z.object({
  sourceMaterializationReceiptId: z.string().regex(/^kw-materialization:[a-f0-9]{64}$/),
  sourceMaterializationDigest: DigestSchema,
  sourcePlanDigest: DigestSchema,
  workflowReceiptId: z.string().regex(/^workflow-receipt:[a-f0-9]{64}$/),
  workflowReceiptDigest: DigestSchema,
  setupReceiptId: z.string().regex(/^kw-m2-database:[a-f0-9]{64}$/),
  setupReceiptDigest: DigestSchema,
  priorM2CheckpointId: z.string().min(1).max(200),
  priorM2CheckpointDigest: DigestSchema,
  manifestId: z.string().min(1).max(200),
  manifestDigest: DigestSchema,
  task1ChainDigest: DigestSchema,
}).strict();

const RowCountsSchema = z.object({
  RevenueWebsiteSnapshot: z.literal(0),
  RevenueEvidenceClaim: z.literal(0),
  RevenueQualificationSnapshot: z.literal(0),
  RevenueLeadAssessmentReceipt: z.literal(0),
  RevenuePrivateKwM2HtmlAssessmentLineage: z.literal(0),
  assessmentRows: z.literal(0),
  progressRows: z.literal(0),
}).strict();

const ResearchReportCoreSchema = z.object({
  reportVersion: z.literal("kw-m2-html-research-report-v1"),
  contextDigest: DigestSchema,
  state: z.literal("RESEARCH_REVIEW"),
  evidenceStatus: z.enum(["PARTIAL", "RESEARCH_REQUIRED"]),
  stopReason: z.string().trim().min(1).max(120).nullable(),
  business: z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(256) }).strict(),
  sourceIdentity: SourceIdentitySchema,
  lineage: LineageSchema,
  operation: z.object({ operationId: z.string().uuid(), operationDigest: DigestSchema }).strict(),
  sourcePolicy: PrivateKwSourcePolicyDecisionSchema,
  pageSelection: PageSelectionSchema,
  pages: z.array(PageReceiptSchema).max(4),
  missingRequiredPageKinds: z.array(z.enum(["SERVICE", "ABOUT", "CONTACT"])).max(3),
  auditVersion: z.literal("kw-m2-html-audit-v1"),
  auditState: z.enum(["HTML_ONLY_PARTIAL", "HTML_ONLY_UNAVAILABLE"]),
  auditLimitations: z.array(z.string().trim().min(1).max(120)).max(20),
  classification: z.object({ value: z.literal("UNKNOWN"), authority: z.literal("NON_QUALIFYING_HTML_ONLY") }).strict(),
  qualification: z.object({
    band: z.literal("RESEARCH"), recommendedChannel: z.literal("RESEARCH"),
    scores: z.object({
      rebuildNeed: z.literal(0), businessFit: z.literal(0), timing: z.literal(0),
      reachability: z.literal(0), evidenceConfidence: z.literal(0),
    }).strict(),
  }).strict(),
  availableChannels: z.array(z.never()).length(0),
  routes: z.array(z.never()).length(0),
  contactReview: z.object({ state: z.literal("NOT_RECORDED"), consentBasis: z.literal("UNASSESSED") }).strict(),
  rowCounts: RowCountsSchema,
  networkRequestCount: z.number().int().nonnegative().max(100),
  reportConstructionNetworkRequestCount: z.literal(0),
  providerOperations: z.literal(0),
  costAuthorizedUsd: z.literal(0),
  authority: AuthoritySchema,
}).strict();

export const PrivateKwM2ResearchReportSchema = ResearchReportCoreSchema.extend({
  reportId: z.string().regex(/^kw-m2-html-research-report:[a-f0-9]{64}$/),
  reportDigest: DigestSchema,
}).strict().superRefine((report, issue) => {
  const { reportId, reportDigest, ...core } = report;
  if (reportDigest !== privateKwM2Digest(core) || reportId !== `kw-m2-html-research-report:${reportDigest}`) {
    issue.addIssue({ code: "custom", message: "Research report digest mismatch." });
  }
});
export type PrivateKwM2ResearchReport = z.infer<typeof PrivateKwM2ResearchReportSchema>;

function reject(message: string): never {
  throw new Error(`M2 research report rejected: ${message}`);
}

function assertTerminalEvidence(context: PrivateKwM2HtmlAssessmentContext) {
  const evidence = PrivateKwM2WebsiteEvidenceReceiptSchema.parse(context.evidence);
  if (evidence.status !== "PARTIAL" && evidence.status !== "RESEARCH_REQUIRED") {
    reject("only PARTIAL or RESEARCH_REQUIRED evidence may enter the terminal report");
  }
  if (!evidence.sourcePolicy || !evidence.pageSelection || !evidence.audit || evidence.blockedEvidence) {
    reject("terminal report requires unblocked source policy, page selection and HTML audit");
  }
  PrivateKwM2HtmlAuditReceiptSchema.parse(evidence.audit);
  const pageSelection = PageSelectionSchema.parse(evidence.pageSelection);
  const pages = evidence.pages.map((page) => PageReceiptSchema.parse(page));
  const { sourceIdentityDigest, ...sourceIdentityCore } = evidence.sourceIdentity;
  if (privateKwM2Digest(sourceIdentityCore) !== sourceIdentityDigest
    || pageSelection.sourceIdentityDigest !== sourceIdentityDigest
    || evidence.audit.availability?.sourceIdentityDigest !== sourceIdentityDigest) {
    reject("source identity digest is not shared by the receipt, selection and audit");
  }
  const selectedByKind = new Map(pageSelection.selectedPages.map((page) => [page.pageKind, page.url]));
  const expectedMissing = (["SERVICE", "ABOUT", "CONTACT"] as const).filter((kind) => !selectedByKind.has(kind));
  if (pageSelection.selectedPages.length !== selectedByKind.size
    || m2AssessmentJson(expectedMissing) !== m2AssessmentJson(pageSelection.missingRequiredPageKinds)
    || pages.some((page) => selectedByKind.get(page.pageKind) !== page.requestedUrl)
    || pages.length !== selectedByKind.size
    || pageSelection.businessId !== evidence.businessId) {
    reject("page selection and page receipts do not describe one canonical set");
  }
  if (pages.some((page) => page.outcome === "CAPTURED"
    ? (!page.finalUrl || !page.contentDigest || !["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY"].includes(page.storageOutcome))
    : (page.storageOutcome === "RAW_HTML_ALLOWED" || page.storageOutcome === "DERIVED_FACTS_ONLY"))) {
    reject("page retention and outcome are inconsistent");
  }
  if (evidence.audit.browserEvidencePresent || evidence.audit.desktopArtifactRef !== null
    || evidence.audit.mobileArtifactRef !== null || evidence.audit.domArtifactRef !== null) {
    reject("terminal report cannot contain browser or rendered artifacts");
  }
  if (evidence.audit.unknownLimitations.some((value) => value.length > 120)) reject("audit limitation is unbounded");
  return { evidence, pageSelection, pages, audit: evidence.audit };
}

/**
 * Pure bounded projection for incomplete HTML research. It does not reload or
 * authenticate durable state; the caller must do that before publication.
 */
export function buildPrivateKwM2ResearchReport(contextValue: unknown): PrivateKwM2ResearchReport {
  const context = parseM2EvidenceContext(contextValue);
  const { evidence, pageSelection, pages, audit } = assertTerminalEvidence(context);
  const contextDigest = privateKwM2Digest(context);
  const authority = PRIVATE_KW_M2_HTML_ASSESSMENT_AUTHORITY;
  const core = ResearchReportCoreSchema.parse({
    reportVersion: "kw-m2-html-research-report-v1",
    contextDigest,
    state: "RESEARCH_REVIEW",
    evidenceStatus: evidence.status,
    stopReason: evidence.stopReason,
    business: { id: context.businessId, name: context.businessName },
    sourceIdentity: evidence.sourceIdentity,
    lineage: {
      sourceMaterializationReceiptId: context.sourceMaterializationReceiptId,
      sourceMaterializationDigest: context.sourceMaterializationDigest,
      sourcePlanDigest: context.sourcePlanDigest,
      workflowReceiptId: context.workflowReceiptId,
      workflowReceiptDigest: context.workflowReceiptDigest,
      setupReceiptId: context.setupReceiptId,
      setupReceiptDigest: context.setupReceiptDigest,
      priorM2CheckpointId: context.priorM2CheckpointId,
      priorM2CheckpointDigest: context.priorM2CheckpointDigest,
      manifestId: context.manifestId,
      manifestDigest: context.manifestDigest,
      task1ChainDigest: context.task1ChainDigest,
    },
    operation: { operationId: evidence.operationId, operationDigest: evidence.operationDigest },
    sourcePolicy: evidence.sourcePolicy,
    pageSelection,
    pages,
    missingRequiredPageKinds: pageSelection.missingRequiredPageKinds,
    auditVersion: audit.auditVersion,
    auditState: audit.state,
    auditLimitations: audit.unknownLimitations,
    classification: { value: "UNKNOWN", authority: "NON_QUALIFYING_HTML_ONLY" },
    qualification: {
      band: "RESEARCH", recommendedChannel: "RESEARCH",
      scores: { rebuildNeed: 0, businessFit: 0, timing: 0, reachability: 0, evidenceConfidence: 0 },
    },
    availableChannels: [],
    routes: [],
    contactReview: { state: "NOT_RECORDED", consentBasis: "UNASSESSED" },
    rowCounts: {
      RevenueWebsiteSnapshot: 0, RevenueEvidenceClaim: 0, RevenueQualificationSnapshot: 0,
      RevenueLeadAssessmentReceipt: 0, RevenuePrivateKwM2HtmlAssessmentLineage: 0,
      assessmentRows: 0, progressRows: 0,
    },
    networkRequestCount: evidence.networkRequestCount,
    reportConstructionNetworkRequestCount: 0,
    providerOperations: 0,
    costAuthorizedUsd: 0,
    authority,
  });
  const reportDigest = privateKwM2Digest(core);
  const report = PrivateKwM2ResearchReportSchema.parse({
    ...core,
    reportId: `kw-m2-html-research-report:${reportDigest}`,
    reportDigest,
  });
  if (new TextEncoder().encode(`${m2AssessmentJson(report)}\n`).byteLength > 2 * 1024 * 1024) {
    reject("canonical report exceeds the 2 MiB bound");
  }
  return report;
}


