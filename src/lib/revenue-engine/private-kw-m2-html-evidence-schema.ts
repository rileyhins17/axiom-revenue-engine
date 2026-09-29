import { z } from "zod";

import { PrivateKwM2HtmlAuditReceiptSchema } from "@/lib/revenue-engine/private-kw-m2-html-audit";
import { PrivateKwPublicHttpTransportReceiptSchema } from "@/lib/revenue-engine/private-kw-public-http-transport";
import { PrivateKwSourcePolicyDecisionSchema } from "@/lib/revenue-engine/private-kw-source-policy";
import { PrivateKwHtmlStructureSchema } from "@/lib/revenue-engine/private-kw-html-structure";

export const PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION = "kw-m2-html-evidence-workflow-v1";
export const PRIVATE_KW_M2_HTML_EVIDENCE_PARTIAL_WORKFLOW_VERSION = "kw-m2-html-evidence-workflow-v2";
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const IsoDateSchema = z.string().datetime({ offset: true });
export const StatusSchema = z.enum(["COMPLETE", "PARTIAL", "FAILED", "RESEARCH_REQUIRED"]);
const AuthoritySchema = z.object({
  liveSourceAuthorized: z.literal(false), browserCaptureAuthorized: z.literal(false),
  artifactStorageAuthorized: z.literal(false), databaseMutationAuthorized: z.literal(false),
  contactDiscoveryExecutionAuthorized: z.literal(false), contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false), qualificationAuthorized: z.literal(false),
  mailboxSyncAuthorized: z.literal(false), outreachAuthorized: z.literal(false), sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false), providerOperationsAuthorized: z.literal(0), costAuthorizedUsd: z.literal(0),
}).strict();
export const SourceIdentitySchema = z.object({
  businessId: z.string().trim().min(1).max(128), evaluationCandidateId: z.string().trim().min(1).max(128),
  sourceRecordId: z.string().trim().min(1).max(128), sourceRunId: z.string().trim().min(1).max(128),
  sourcePlanDigest: DigestSchema, manifestDigest: DigestSchema, sourceEvidenceUrl: z.string().url(),
  approvedWebsiteUrl: z.string().url(), sourceCapturedAt: IsoDateSchema, sourceIdentityDigest: DigestSchema,
}).strict();
export const PageReceiptSchema = z.object({
  pageKind: z.enum(["HOME", "SERVICE", "ABOUT", "CONTACT"]), requestedUrl: z.string().url(),
  finalUrl: z.string().url().nullable(), capturedAt: IsoDateSchema,
  outcome: z.enum(["CAPTURED", "FAILED", "REJECTED"]), statusCode: z.number().int().min(0).max(599), redirectCount: z.number().int().nonnegative().max(20),
  bodyBytes: z.number().int().nonnegative().max(1_048_576), contentDigest: DigestSchema.nullable(),
  factsDigest: DigestSchema.nullable(),
  structure: PrivateKwHtmlStructureSchema.optional(),
  storageOutcome: z.enum(["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY", "BLOCKED", "NOT_PERSISTED_SUBPAGE", "NONE"]),
  storageRefs: z.object({ contentRef: z.string().nullable(), metadataRef: z.string().nullable(), factsRef: z.string().nullable(), receiptRef: z.string().nullable() }).strict(),
  failureCode: z.string().trim().min(1).max(120).nullable(),
  failedPageTransportReceiptIds: z.array(z.number().int().positive()).min(1).max(100).optional(),
}).strict().superRefine((page, context) => {
  if (page.structure && (page.outcome !== "CAPTURED" || page.storageOutcome !== "DERIVED_FACTS_ONLY")) {
    context.addIssue({ code: "custom", path: ["structure"], message: "Structural facts require captured derived-only evidence." });
  }
});
export const PageSelectionSchema = z.object({
  selectionVersion: z.literal("kw-m2-html-page-selection-v1"), selectionKind: z.literal("HTML_ONLY_DETERMINISTIC"),
  businessId: z.string().trim().min(1).max(128), sourceIdentityDigest: DigestSchema,
  status: z.enum(["READY", "PARTIAL"]),
  selectedPages: z.array(z.object({ pageKind: z.enum(["HOME", "SERVICE", "ABOUT", "CONTACT"]), url: z.string().url() }).strict()).min(1).max(4),
  missingRequiredPageKinds: z.array(z.enum(["SERVICE", "ABOUT", "CONTACT"])).max(3),
}).strict();
export const BlockedEvidenceSchema = z.object({
  outcome: z.literal("BLOCKED"), receiptRef: z.string().regex(/^kw-html-receipt:sha256:[a-f0-9]{64}$/), blockCode: z.string().trim().min(1).max(120), executionPath: z.enum(["CREATED", "EXACT_REPLAY"]), parentReceiptDigest: DigestSchema,
}).strict();

export const PrivateKwM2HtmlEvidenceRequestSchema = z.object({
  requestId: z.string().uuid(), requestedAt: IsoDateSchema, replayMode: z.enum(["NEW", "EXACT_REPLAY"]).default("NEW"),
  businessId: z.string().trim().min(1).max(128), researchPacket: z.unknown(), authorization: z.unknown(),
  ownerEnvelope: z.unknown(), manifest: z.unknown(), sourcePlan: z.unknown(), researchPolicy: z.unknown().optional(),
}).strict();
export const PrivateKwM2WebsiteEvidenceReceiptSchema = z.object({
  receiptVersion: z.enum([PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION, PRIVATE_KW_M2_HTML_EVIDENCE_PARTIAL_WORKFLOW_VERSION]), operationId: z.string().uuid(),
  requestId: z.string().uuid(), requestedAt: IsoDateSchema, status: StatusSchema, stopReason: z.string().trim().min(1).max(120).nullable(),
  businessId: z.string().trim().min(1).max(128), sourceIdentity: SourceIdentitySchema, authorizationDigest: DigestSchema,
  authorizationExpiresAt: IsoDateSchema, sourcePolicy: PrivateKwSourcePolicyDecisionSchema.nullable(),
  pageSelection: PageSelectionSchema.nullable(), pages: z.array(PageReceiptSchema).max(4),
  audit: PrivateKwM2HtmlAuditReceiptSchema.nullable(), blockedEvidence: BlockedEvidenceSchema.nullable(), transportReceipts: z.array(PrivateKwPublicHttpTransportReceiptSchema), transportReceiptIds: z.array(z.number().int().positive()),
  transportReceiptDigests: z.array(DigestSchema), networkRequestCount: z.number().int().nonnegative().max(100),
  networkRequestCap: z.number().int().positive().max(100), providerOperations: z.literal(0), costAuthorizedUsd: z.literal(0),
  authority: AuthoritySchema, operationDigest: DigestSchema,
}).strict().superRefine((receipt, context) => {
  const failedPages = receipt.pages.filter((page) => page.outcome !== "CAPTURED");
  if (receipt.status === "PARTIAL" && receipt.receiptVersion !== PRIVATE_KW_M2_HTML_EVIDENCE_PARTIAL_WORKFLOW_VERSION) {
    context.addIssue({ code: "custom", path: ["receiptVersion"], message: "Partial receipts require the v2 durable failure witness contract." });
  }
  if (receipt.receiptVersion === PRIVATE_KW_M2_HTML_EVIDENCE_PARTIAL_WORKFLOW_VERSION && receipt.status !== "PARTIAL") {
    context.addIssue({ code: "custom", path: ["receiptVersion"], message: "The v2 receipt contract is reserved for partial receipts." });
  }
  if (receipt.status === "PARTIAL" && failedPages.some((page) => !page.failedPageTransportReceiptIds?.length)) {
    context.addIssue({ code: "custom", path: ["pages"], message: "Every failed partial page must bind an ordered transport failure witness." });
  }
  if (receipt.status !== "PARTIAL" && receipt.pages.some((page) => page.failedPageTransportReceiptIds !== undefined)) {
    context.addIssue({ code: "custom", path: ["pages"], message: "Failed-page transport witnesses are only valid on partial receipts." });
  }
});

export type PrivateKwM2HtmlEvidenceRequest = z.infer<typeof PrivateKwM2HtmlEvidenceRequestSchema>;
export type PrivateKwM2WebsiteEvidenceReceipt = z.infer<typeof PrivateKwM2WebsiteEvidenceReceiptSchema>;
