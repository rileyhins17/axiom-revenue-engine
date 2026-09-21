import { createHash } from "node:crypto";
import { z } from "zod";

import {
  assertPrivateKwM2ApprovalChain,
  PrivateKwM2ExecutionAuthorizationSchema,
  PrivateKwM2OwnerApprovalEnvelopeSchema,
  PrivateKwM2ResearchPacketSchema,
  PrivateKwM2ResearchPolicySchema,
  type PrivateKwM2ExecutionAuthorization,
  type PrivateKwM2OwnerApprovalEnvelope,
  type PrivateKwM2ResearchPacket,
  type PrivateKwM2ResearchPolicy,
} from "@/lib/revenue-engine/private-kw-m2-authorization";
import { PrivateKwImportPlanSchema, type PrivateKwImportPlan } from "@/lib/revenue-engine/private-kw-import";
import { PrivateKwShadowSliceManifestSchema, type PrivateKwShadowSliceManifest } from "@/lib/revenue-engine/private-kw-shadow-slice";
import { createPrivateKwLocalHtmlEvidenceStore, type PrivateKwFacts, type PrivateKwHtmlEvidenceRef } from "@/lib/revenue-engine/private-kw-local-html-evidence-store";
import { createPrivateKwPublicHttpTransport, privateKwPublicHttpTransportReceiptDigest } from "@/lib/revenue-engine/private-kw-public-http-transport";
import { evaluatePrivateKwRobotsPolicy, type PrivateKwSourcePolicyDecision } from "@/lib/revenue-engine/private-kw-source-policy";
import { capturePublicWebsiteDocument, WebsiteCaptureResultSchema, type WebsiteCaptureResult } from "@/lib/revenue-engine/website-capture";
import { extractHtmlPageFacts, type HtmlPageFacts } from "@/lib/revenue-engine/html-page-facts";
import { defaultWebsitePageSelectionPolicy, planWebsitePages, WebsitePageSelectionPlanSchema, type WebsitePageSelectionPlan } from "@/lib/revenue-engine/website-page-selection";
import { buildPrivateKwM2HtmlAuditReceipt, PrivateKwM2HtmlAuditReceiptSchema, type PrivateKwM2HtmlAuditReceipt } from "@/lib/revenue-engine/private-kw-m2-html-audit";
import { createPrivateKwM2HtmlEvidenceReceiptStore, privateKwM2ReceiptCanonicalDigest, type PrivateKwM2HtmlEvidenceReceiptStore } from "@/lib/revenue-engine/private-kw-m2-html-evidence-receipt";

export const PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION = "kw-m2-html-evidence-workflow-v1";
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const IsoDateSchema = z.string().datetime({ offset: true });
const StatusSchema = z.enum(["COMPLETE", "PARTIAL", "FAILED", "RESEARCH_REQUIRED"]);
const AuthoritySchema = z.object({
  liveSourceAuthorized: z.literal(false), browserCaptureAuthorized: z.literal(false),
  artifactStorageAuthorized: z.literal(false), databaseMutationAuthorized: z.literal(false),
  contactDiscoveryExecutionAuthorized: z.literal(false), contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false), qualificationAuthorized: z.literal(false),
  mailboxSyncAuthorized: z.literal(false), outreachAuthorized: z.literal(false), sendAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false), providerOperationsAuthorized: z.literal(0), costAuthorizedUsd: z.literal(0),
}).strict();
const SourceIdentitySchema = z.object({
  businessId: z.string().trim().min(1).max(128), evaluationCandidateId: z.string().trim().min(1).max(128),
  sourceRecordId: z.string().trim().min(1).max(128), sourceRunId: z.string().trim().min(1).max(128),
  sourcePlanDigest: DigestSchema, manifestDigest: DigestSchema, sourceEvidenceUrl: z.string().url(),
  approvedWebsiteUrl: z.string().url(), sourceCapturedAt: IsoDateSchema, sourceIdentityDigest: DigestSchema,
}).strict();
const PageReceiptSchema = z.object({
  pageKind: z.enum(["HOME", "SERVICE", "ABOUT", "CONTACT"]), requestedUrl: z.string().url(),
  finalUrl: z.string().url().nullable(), capturedAt: IsoDateSchema,
  outcome: z.enum(["CAPTURED", "FAILED", "REJECTED"]), statusCode: z.number().int().min(0).max(599),
  bodyBytes: z.number().int().nonnegative().max(1_048_576), contentDigest: DigestSchema.nullable(),
  factsDigest: DigestSchema.nullable(),
  storageOutcome: z.enum(["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY", "BLOCKED", "NOT_PERSISTED_SUBPAGE", "NONE"]),
  storageRefs: z.object({ contentRef: z.string().nullable(), metadataRef: z.string().nullable(), factsRef: z.string().nullable(), receiptRef: z.string().nullable() }).strict(),
  failureCode: z.string().trim().min(1).max(120).nullable(),
}).strict();
const PageSelectionSchema = z.object({
  selectionVersion: z.literal("kw-m2-html-page-selection-v1"), selectionKind: z.literal("HTML_ONLY_DETERMINISTIC"),
  businessId: z.string().trim().min(1).max(128), sourceIdentityDigest: DigestSchema,
  status: z.enum(["READY", "PARTIAL"]),
  selectedPages: z.array(z.object({ pageKind: z.enum(["HOME", "SERVICE", "ABOUT", "CONTACT"]), url: z.string().url() }).strict()).min(1).max(4),
  missingRequiredPageKinds: z.array(z.enum(["SERVICE", "ABOUT", "CONTACT"])).max(3),
}).strict();

export const PrivateKwM2HtmlEvidenceRequestSchema = z.object({
  requestId: z.string().uuid(), requestedAt: IsoDateSchema, replayMode: z.enum(["NEW", "EXACT_REPLAY"]).default("NEW"),
  businessId: z.string().trim().min(1).max(128), researchPacket: z.unknown(), authorization: z.unknown(),
  ownerEnvelope: z.unknown(), manifest: z.unknown(), sourcePlan: z.unknown(), researchPolicy: z.unknown().optional(),
}).strict();
export const PrivateKwM2WebsiteEvidenceReceiptSchema = z.object({
  receiptVersion: z.literal(PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION), operationId: z.string().uuid(),
  requestId: z.string().uuid(), requestedAt: IsoDateSchema, status: StatusSchema, stopReason: z.string().trim().min(1).max(120).nullable(),
  businessId: z.string().trim().min(1).max(128), sourceIdentity: SourceIdentitySchema, authorizationDigest: DigestSchema,
  authorizationExpiresAt: IsoDateSchema,
  sourcePolicy: z.object({ policyVersion: z.string().min(1), allowed: z.boolean(), reason: z.string().min(1).max(240), transportReceiptIds: z.array(z.number().int().positive()), transportReceiptDigests: z.array(DigestSchema) }).strict().nullable(),
  pageSelection: PageSelectionSchema.nullable(), pages: z.array(PageReceiptSchema).max(4),
  audit: PrivateKwM2HtmlAuditReceiptSchema.nullable(), transportReceiptIds: z.array(z.number().int().positive()),
  transportReceiptDigests: z.array(DigestSchema), networkRequestCount: z.number().int().nonnegative().max(100),
  networkRequestCap: z.number().int().positive().max(100), providerOperations: z.literal(0), costAuthorizedUsd: z.literal(0),
  authority: AuthoritySchema, operationDigest: DigestSchema,
}).strict();
export type PrivateKwM2HtmlEvidenceRequest = z.infer<typeof PrivateKwM2HtmlEvidenceRequestSchema>;
export type PrivateKwM2WebsiteEvidenceReceipt = z.infer<typeof PrivateKwM2WebsiteEvidenceReceiptSchema>;
type Store = Pick<ReturnType<typeof createPrivateKwLocalHtmlEvidenceStore>, "writePrivateKwHtmlEvidence" | "writePrivateKwDerivedFacts">;
export type PrivateKwM2HtmlEvidenceDependencies = {
  transport?: ReturnType<typeof createPrivateKwPublicHttpTransport>;
  store?: Store; receiptStore?: PrivateKwM2HtmlEvidenceReceiptStore; clock?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>; rootPath?: string;
};
type Identity = z.infer<typeof SourceIdentitySchema> & {
  record: PrivateKwShadowSliceManifest["records"][number]; sourcePlan: PrivateKwImportPlan;
  chain: { researchPacket: PrivateKwM2ResearchPacket; authorization: PrivateKwM2ExecutionAuthorization; ownerEnvelope: PrivateKwM2OwnerApprovalEnvelope; manifest: PrivateKwShadowSliceManifest; sourcePlan: PrivateKwImportPlan; researchPolicy?: PrivateKwM2ResearchPolicy };
};
function canonicalize(value: unknown): string {
  if (value === undefined) return "null"; if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => JSON.stringify(key) + ":" + canonicalize(object[key])).join(",") + "}";
}
function digest(value: unknown) { return createHash("sha256").update(canonicalize(value), "utf8").digest("hex"); }
function host(value: string) { return new URL(value).hostname.toLocaleLowerCase("en-CA"); }
function assertAuthority(auth: PrivateKwM2ExecutionAuthorization) {
  const a = auth.authority;
  if (Object.entries(a).some(([key, value]) => key === "providerOperationsAuthorized" ? value !== 0 : key === "costAuthorizedUsd" ? value !== 0 : value !== false)) throw new Error("M2 HTML workflow contains disallowed authority.");
}
function deriveIdentity(input: { businessId: string; researchPacket: PrivateKwM2ResearchPacket; authorization: PrivateKwM2ExecutionAuthorization; manifest: PrivateKwShadowSliceManifest; sourcePlan: PrivateKwImportPlan; ownerEnvelope: PrivateKwM2OwnerApprovalEnvelope; researchPolicy?: PrivateKwM2ResearchPolicy }): Identity {
  const record = input.manifest.records.find((entry) => entry.businessId === input.businessId);
  const source = input.sourcePlan.records.find((entry) => entry.business.id === input.businessId);
  if (!record || !source || !record.websiteUrl || source.sourceRecord.id !== record.sourceRecordId || source.sourceRecord.businessId !== record.businessId || source.sourceRecord.websiteUrl !== record.websiteUrl || source.sourceRecord.sourceEvidenceUrl !== record.sourceEvidenceUrl || source.sourceRecord.capturedAt !== record.sourceCapturedAt || source.evaluationCandidateId !== record.evaluationCandidateId) throw new Error("M2 HTML workflow source identity mismatch.");
  const run = input.sourcePlan.sourceRuns.find((entry) => entry.id === source.sourceRecord.sourceRunId);
  if (!run || run.city !== record.city || run.niche !== record.niche) throw new Error("M2 HTML workflow source-run mismatch.");
  if (input.manifest.sourcePlanDigest !== input.authorization.sourcePlanDigest) throw new Error("M2 HTML workflow source-plan digest mismatch.");
  const decision = input.authorization.sourceDecisions.find((entry) => entry.businessId === input.businessId);
  if (!decision || decision.websiteUrl !== record.websiteUrl) throw new Error("M2 HTML workflow authorization source mismatch.");
  const tuple = { businessId: record.businessId, evaluationCandidateId: record.evaluationCandidateId, sourceRecordId: record.sourceRecordId, sourceRunId: source.sourceRecord.sourceRunId, sourcePlanDigest: input.manifest.sourcePlanDigest, manifestDigest: input.manifest.manifestDigest, sourceEvidenceUrl: record.sourceEvidenceUrl, approvedWebsiteUrl: record.websiteUrl, sourceCapturedAt: record.sourceCapturedAt };
  return { ...tuple, sourceIdentityDigest: digest(tuple), record, sourcePlan: input.sourcePlan, chain: { researchPacket: input.researchPacket, authorization: input.authorization, ownerEnvelope: input.ownerEnvelope, manifest: input.manifest, sourcePlan: input.sourcePlan, researchPolicy: input.researchPolicy } };
}
function projectPlan(plan: WebsitePageSelectionPlan, identity: Identity) {
  const parsed = WebsitePageSelectionPlanSchema.parse(plan);
  if (parsed.plannerKind !== "DETERMINISTIC_FIXTURE" || parsed.businessId !== identity.businessId) throw new Error("M2 HTML workflow rejected its page plan.");
  return PageSelectionSchema.parse({ selectionVersion: "kw-m2-html-page-selection-v1", selectionKind: "HTML_ONLY_DETERMINISTIC", businessId: identity.businessId, sourceIdentityDigest: identity.sourceIdentityDigest, status: parsed.status, selectedPages: parsed.selectedPages.map((page) => ({ pageKind: page.pageKind, url: page.url })), missingRequiredPageKinds: parsed.missingRequiredPageKinds });
}
function projectFacts(facts: HtmlPageFacts, expectedServices: string[], expectedLocations: string[]): PrivateKwFacts {
  void expectedServices;
  void expectedLocations;
  return { canonicalUrl: facts.url, serviceObservations: [], locationObservations: [], claimIds: ["html:page-kind:" + facts.pageKind.toLocaleLowerCase("en-CA"), facts.complete ? "html:facts-complete" : "html:facts-incomplete"], limitations: ["HTML_ONLY", "VISUAL_UNKNOWN", "CONTACT_DATA_DISCARDED"], confidence: facts.complete ? "HIGH" : "UNKNOWN" };
}
function refs(value: PrivateKwHtmlEvidenceRef) {
  return { contentRef: "contentRef" in value ? value.contentRef : null, metadataRef: "metadataRef" in value ? value.metadataRef : null, factsRef: "factsRef" in value ? value.factsRef : null, receiptRef: "receiptRef" in value ? value.receiptRef : null };
}
function makePage(pageKind: "HOME" | "SERVICE" | "ABOUT" | "CONTACT", capture: WebsiteCaptureResult, facts: HtmlPageFacts | null, storageOutcome: z.infer<typeof PageReceiptSchema>["storageOutcome"], storageRefs: z.infer<typeof PageReceiptSchema>["storageRefs"]) {
  return PageReceiptSchema.parse({ pageKind, requestedUrl: capture.requestedUrl ?? "https://invalid.invalid/", finalUrl: capture.finalUrl, capturedAt: capture.capturedAt, outcome: capture.outcome, statusCode: capture.statusCode, bodyBytes: capture.bodyBytes, contentDigest: capture.outcome === "CAPTURED" ? capture.contentDigest : null, factsDigest: facts ? digest(projectFacts(facts, [], [])) : null, storageOutcome, storageRefs, failureCode: capture.failure?.code ?? null });
}
function sourcePolicySummary(policy: PrivateKwSourcePolicyDecision | null) {
  return policy ? { policyVersion: policy.policyVersion, allowed: policy.allowed, reason: policy.reason, transportReceiptIds: policy.transportReceiptIds, transportReceiptDigests: policy.transportReceiptDigests } : null;
}
function sourcePolicyTransportReceipts(policy: PrivateKwSourcePolicyDecision, transport: ReturnType<typeof createPrivateKwPublicHttpTransport>) {
  const ids = new Set(policy.transportReceiptIds);
  return transport.takeReceipts().filter((receipt) => ids.has(receipt.requestId));
}
function buildReceipt(input: { request: PrivateKwM2HtmlEvidenceRequest; identity: Identity; authorization: PrivateKwM2ExecutionAuthorization; status: z.infer<typeof StatusSchema>; stopReason: string | null; policy: PrivateKwSourcePolicyDecision | null; plan: z.infer<typeof PageSelectionSchema> | null; pages: z.infer<typeof PageReceiptSchema>[]; audit: PrivateKwM2HtmlAuditReceipt | null; transport: ReturnType<typeof createPrivateKwPublicHttpTransport> | undefined; attempts: number }) {
  const transportReceipts = input.transport?.takeReceipts() ?? [];
  const transportIds = transportReceipts.map((receipt) => receipt.requestId);
  const transportDigests = transportReceipts.map((receipt) => {
    const expected = privateKwPublicHttpTransportReceiptDigest(receipt);
    if (expected !== receipt.receiptDigest) throw new Error("Transport receipt digest mismatch.");
    return receipt.receiptDigest;
  });
  const core = { receiptVersion: PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION, operationId: input.request.requestId, requestId: input.request.requestId, requestedAt: input.request.requestedAt, status: input.status, stopReason: input.stopReason, businessId: input.identity.businessId, sourceIdentity: { businessId: input.identity.businessId, evaluationCandidateId: input.identity.evaluationCandidateId, sourceRecordId: input.identity.sourceRecordId, sourceRunId: input.identity.sourceRunId, sourcePlanDigest: input.identity.sourcePlanDigest, manifestDigest: input.identity.manifestDigest, sourceEvidenceUrl: input.identity.sourceEvidenceUrl, approvedWebsiteUrl: input.identity.approvedWebsiteUrl, sourceCapturedAt: input.identity.sourceCapturedAt, sourceIdentityDigest: input.identity.sourceIdentityDigest }, authorizationDigest: input.authorization.authorizationDigest, authorizationExpiresAt: input.authorization.expiresAt, sourcePolicy: sourcePolicySummary(input.policy), pageSelection: input.plan, pages: input.pages, audit: input.audit, transportReceiptIds: transportIds, transportReceiptDigests: transportDigests, networkRequestCount: input.attempts, networkRequestCap: input.authorization.networkRequestCap, providerOperations: 0 as const, costAuthorizedUsd: 0 as const, authority: input.authorization.authority };
  return PrivateKwM2WebsiteEvidenceReceiptSchema.parse({ ...core, operationDigest: digest(core) });
}
async function failReceipt(input: { request: PrivateKwM2HtmlEvidenceRequest; identity: Identity; authorization: PrivateKwM2ExecutionAuthorization; reason: string; policy: PrivateKwSourcePolicyDecision | null; transport?: ReturnType<typeof createPrivateKwPublicHttpTransport>; attempts: number; capture?: WebsiteCaptureResult | null; storage?: PrivateKwHtmlEvidenceRef | null }) {
  const pages = input.capture ? [makePage("HOME", input.capture, null, input.storage?.outcome ?? "NONE", input.storage ? refs(input.storage) : { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null })] : [];
  return buildReceipt({ request: input.request, identity: input.identity, authorization: input.authorization, status: "FAILED", stopReason: input.reason, policy: input.policy, plan: null, pages, audit: null, transport: input.transport, attempts: input.attempts });
}
function safeCapture(value: unknown) { const parsed = WebsiteCaptureResultSchema.safeParse(value); return parsed.success ? parsed.data : null; }

export async function executePrivateKwM2HtmlEvidence(input: unknown, dependencies: PrivateKwM2HtmlEvidenceDependencies = {}): Promise<PrivateKwM2WebsiteEvidenceReceipt> {
  const request = PrivateKwM2HtmlEvidenceRequestSchema.parse(input);
  const clock = dependencies.clock ?? (() => new Date());
  const packet = PrivateKwM2ResearchPacketSchema.parse(request.researchPacket);
  const authorization = PrivateKwM2ExecutionAuthorizationSchema.parse(request.authorization);
  const ownerEnvelope = PrivateKwM2OwnerApprovalEnvelopeSchema.parse(request.ownerEnvelope);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(request.manifest);
  const sourcePlan = PrivateKwImportPlanSchema.parse(request.sourcePlan);
  const policy = request.researchPolicy === undefined ? undefined : PrivateKwM2ResearchPolicySchema.parse(request.researchPolicy);
  assertAuthority(authorization);
  const identity = deriveIdentity({ businessId: request.businessId, researchPacket: packet, authorization, manifest, sourcePlan, ownerEnvelope, researchPolicy: policy });
  const receiptStore = dependencies.receiptStore ?? createPrivateKwM2HtmlEvidenceReceiptStore({ rootPath: dependencies.rootPath ?? "data/kw-evaluation/m2-evidence" });
  const existing = await receiptStore.loadSealed(request.requestId);
  if (existing) {
    const parsed = PrivateKwM2WebsiteEvidenceReceiptSchema.parse(existing);
    if (parsed.operationId !== request.requestId || parsed.sourceIdentity.sourceIdentityDigest !== identity.sourceIdentityDigest) throw new Error("SEALED_RECEIPT_MISMATCH");
    return parsed;
  }
  if (request.replayMode === "EXACT_REPLAY") {
    return buildReceipt({ request, identity, authorization, status: "FAILED", stopReason: "REPLAY_MISSING", policy: null, plan: null, pages: [], audit: null, transport: undefined, attempts: 0 });
  }
  const base = dependencies.transport ?? createPrivateKwPublicHttpTransport({ now: clock });
  let stage: "ROBOTS" | "GET" = "ROBOTS";
  let attempts = 0;
  const assertBefore = () => {
    assertPrivateKwM2ApprovalChain({ researchPacket: packet, authorization, ownerEnvelope, manifest, sourcePlan, phase: stage, now: clock().toISOString(), researchPolicy: policy });
    const current = deriveIdentity({ businessId: request.businessId, researchPacket: packet, authorization, manifest, sourcePlan, ownerEnvelope, researchPolicy: policy });
    if (current.sourceIdentityDigest !== identity.sourceIdentityDigest) throw new Error("M2 HTML workflow source identity changed.");
  };
  const budget: ReturnType<typeof createPrivateKwPublicHttpTransport> = {
    async request(value, init) {
      assertBefore();
      if (attempts >= authorization.networkRequestCap) throw new Error("NETWORK_REQUEST_CAP_EXCEEDED");
      attempts += 1;
      const before = base.takeReceipts().length;
      try { return await base.request(value, init); }
      finally { if (base.takeReceipts().length !== before + 1) throw new Error("TRANSPORT_RECEIPT_RECONCILIATION_FAILED"); }
    },
    takeReceipts: () => base.takeReceipts(),
  };
  let sourcePolicy: PrivateKwSourcePolicyDecision | null = null;
  try {
    sourcePolicy = await evaluatePrivateKwRobotsPolicy({
      approvedSourceUrl: identity.approvedWebsiteUrl,
      auditUserAgent: "AxiomRevenueEngineWebsiteAudit/0.1",
      termsDecision: authorization.sourceDecisions.find((entry) => entry.businessId === identity.businessId)!.termsDecision,
      transport: budget,
      now: clock,
      sleep: async (milliseconds) => {
        if (Date.parse(authorization.expiresAt) <= clock().getTime() + milliseconds) throw new Error("AUTHORIZATION_EXPIRED");
        await (dependencies.sleep ?? ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay))))(milliseconds);
        assertBefore();
      },
      policyDeadlineAt: new Date(authorization.expiresAt),
    });
  } catch (error) {
    const reason = error instanceof Error && (error.message.includes("AUTHORIZATION_EXPIRED") || Date.parse(authorization.expiresAt) <= clock().getTime()) ? "AUTHORIZATION_EXPIRED" : "ROBOTS_POLICY_FAILED";
    const receipt = await failReceipt({ request, identity, authorization, reason, policy: sourcePolicy, transport: budget, attempts });
    await receiptStore.publishSealed(receipt);
    return receipt;
  }
  if (!sourcePolicy.allowed) {
    let blockedRef: PrivateKwHtmlEvidenceRef | null = null;
    const decision = authorization.sourceDecisions.find((entry) => entry.businessId === identity.businessId)!;
    if (decision.evidenceRetention === "BLOCKED" && Date.parse(authorization.expiresAt) > clock().getTime()) {
      const store = dependencies.store ?? createPrivateKwLocalHtmlEvidenceStore({ clock });
      try {
        blockedRef = await store.writePrivateKwHtmlEvidence({
          outcome: "BLOCKED", blockCode: "ROBOTS_OR_TERMS_BLOCKED", businessId: identity.businessId, sourceId: identity.sourceRecordId,
          requestedUrl: identity.approvedWebsiteUrl, finalUrl: identity.approvedWebsiteUrl, redirectChainDigest: digest([identity.approvedWebsiteUrl]),
          captureVersion: "website-capture-v1", transportVersion: "kw-m2-public-transport-v1", sourcePolicyVersion: sourcePolicy.policyVersion,
          capturedAt: clock().toISOString(), parentReceiptDigest: digest({ sourceIdentity: identity.sourceIdentityDigest, reason: "ROBOTS_OR_TERMS_BLOCKED" }),
          authorizationDigest: authorization.authorizationDigest, authorizationExpiresAt: authorization.expiresAt, authorizationChain: identity.chain,
          sourcePolicyDecision: sourcePolicy, transportReceipts: sourcePolicyTransportReceipts(sourcePolicy, budget), retentionDecision: "BLOCKED", legalHold: false,
        });
      } catch {
        blockedRef = null;
      }
    }
    const receipt = await failReceipt({ request, identity, authorization, reason: "ROBOTS_OR_TERMS_BLOCKED", policy: sourcePolicy, transport: budget, attempts, storage: blockedRef });
    await receiptStore.publishSealed(receipt);
    return receipt;
  }
  const decision = authorization.sourceDecisions.find((entry) => entry.businessId === identity.businessId)!;
  const retention = decision.evidenceRetention;
  const store = dependencies.store ?? createPrivateKwLocalHtmlEvidenceStore({ clock });
  if (retention === "BLOCKED") {
    let blockedRef: PrivateKwHtmlEvidenceRef | null = null;
    try {
      blockedRef = await store.writePrivateKwHtmlEvidence({
        outcome: "BLOCKED", blockCode: "RETENTION_BLOCKED", businessId: identity.businessId, sourceId: identity.sourceRecordId,
        requestedUrl: identity.approvedWebsiteUrl, finalUrl: identity.approvedWebsiteUrl, redirectChainDigest: digest([identity.approvedWebsiteUrl]),
        captureVersion: "website-capture-v1", transportVersion: "kw-m2-public-transport-v1", sourcePolicyVersion: sourcePolicy.policyVersion,
        capturedAt: clock().toISOString(), parentReceiptDigest: digest({ sourceIdentity: identity.sourceIdentityDigest, reason: "RETENTION_BLOCKED" }),
        authorizationDigest: authorization.authorizationDigest, authorizationExpiresAt: authorization.expiresAt, authorizationChain: identity.chain,
        sourcePolicyDecision: sourcePolicy, transportReceipts: sourcePolicyTransportReceipts(sourcePolicy, budget), retentionDecision: "BLOCKED", legalHold: false,
      });
    } catch {
      blockedRef = null;
    }
    const receipt = await failReceipt({ request, identity, authorization, reason: "RETENTION_BLOCKED", policy: sourcePolicy, transport: budget, attempts, storage: blockedRef });
    await receiptStore.publishSealed(receipt);
    return receipt;
  }
  stage = "GET";
  let homeCapture: WebsiteCaptureResult;
  try {
    homeCapture = await capturePublicWebsiteDocument(identity.approvedWebsiteUrl, { fetch: (value, init) => budget.request(value, init), now: clock });
    if (Date.parse(authorization.expiresAt) <= clock().getTime()) throw new Error("AUTHORIZATION_EXPIRED");
  } catch (error) {
    const reason = error instanceof Error && (error.message.includes("AUTHORIZATION_EXPIRED") || Date.parse(authorization.expiresAt) <= clock().getTime()) ? "AUTHORIZATION_EXPIRED" : "HOMEPAGE_CAPTURE_FAILED";
    const receipt = await failReceipt({ request, identity, authorization, reason, policy: sourcePolicy, transport: budget, attempts, capture: safeCapture(error) });
    await receiptStore.publishSealed(receipt);
    return receipt;
  }
  if (homeCapture.outcome !== "CAPTURED" || !homeCapture.finalUrl || host(homeCapture.finalUrl) !== host(identity.approvedWebsiteUrl)) {
    const receipt = await failReceipt({ request, identity, authorization, reason: "HOMEPAGE_CAPTURE_FAILED", policy: sourcePolicy, transport: budget, attempts, capture: homeCapture });
    await receiptStore.publishSealed(receipt);
    return receipt;
  }
  const homeFacts = await extractHtmlPageFacts(homeCapture, "HOME");
  const expectedServices = [identity.record.niche];
  const expectedLocations = [identity.record.city];
  const plan = projectPlan(planWebsitePages({
    selectionVersion: "website-page-selection-v1", selectionId: request.requestId, businessId: identity.businessId,
    businessName: identity.record.businessName, niche: identity.record.niche, expectedServices, plannedAt: clock().toISOString(),
    mode: "SHADOW", plannerKind: "DETERMINISTIC_FIXTURE", maxCostUsd: 0, policy: defaultWebsitePageSelectionPolicy(), homepageFacts: homeFacts,
  }), identity);
  let homeRef: PrivateKwHtmlEvidenceRef | null = null;
  const retentionReviewDate = identity.chain.researchPolicy?.decisions.find((entry) => entry.businessId === identity.businessId)?.retentionReviewDate ?? authorization.expiresAt;
  const metadata = {
    businessId: identity.businessId, sourceId: identity.sourceRecordId, requestedUrl: homeCapture.requestedUrl!, finalUrl: homeCapture.finalUrl!,
    redirectChainDigest: digest(homeCapture.redirectChain), captureVersion: homeCapture.captureVersion, transportVersion: "kw-m2-public-transport-v1",
    sourcePolicyVersion: sourcePolicy.policyVersion, capturedAt: homeCapture.capturedAt, parentReceiptDigest: digest({ identity: identity.sourceIdentityDigest, page: "HOME", contentDigest: homeCapture.contentDigest }),
    authorizationDigest: authorization.authorizationDigest, authorizationExpiresAt: authorization.expiresAt, authorizationChain: identity.chain,
    sourcePolicyDecision: sourcePolicy, transportReceipts: sourcePolicyTransportReceipts(sourcePolicy, budget), retentionDecision: retention,
    retainUntil: retention === "RAW_HTML_ALLOWED" ? retentionReviewDate : undefined,
    reviewAt: retention === "DERIVED_FACTS_ONLY" ? retentionReviewDate : undefined,
    legalHold: false,
  };
  let storageFailure = false;
  try {
    assertBefore();
    if (retention === "RAW_HTML_ALLOWED") homeRef = await store.writePrivateKwHtmlEvidence({ ...metadata, outcome: "RAW_HTML_ALLOWED", contentType: "text/html", bytes: homeCapture.rawBytes });
    else if (retention === "DERIVED_FACTS_ONLY") homeRef = await store.writePrivateKwDerivedFacts({ ...metadata, outcome: "DERIVED_FACTS_ONLY", captureBytes: homeCapture.rawBytes, facts: projectFacts(homeFacts, expectedServices, expectedLocations), rawArtifactRef: null });
  } catch {
    const receipt = await failReceipt({ request, identity, authorization, reason: "STORE_CONFLICT", policy: sourcePolicy, transport: budget, attempts, capture: homeCapture });
    await receiptStore.publishSealed(receipt);
    return receipt;
  }
  const pageResults: z.infer<typeof PageReceiptSchema>[] = [makePage("HOME", homeCapture, homeFacts, homeRef?.outcome ?? "NONE", homeRef ? refs(homeRef) : { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null })];
  const capturedPages: Array<{ pageKind: "HOME" | "SERVICE" | "ABOUT" | "CONTACT"; capture: WebsiteCaptureResult; facts: HtmlPageFacts }> = [{ pageKind: "HOME", capture: homeCapture, facts: homeFacts }];
  for (const selected of plan.selectedPages.filter((page) => page.pageKind !== "HOME")) {
    let capture: WebsiteCaptureResult;
    try {
      capture = await capturePublicWebsiteDocument(selected.url, { fetch: (value, init) => budget.request(value, init), now: clock });
      if (Date.parse(authorization.expiresAt) <= clock().getTime()) throw new Error("AUTHORIZATION_EXPIRED");
    } catch {
      pageResults.push(PageReceiptSchema.parse({ pageKind: selected.pageKind, requestedUrl: selected.url, finalUrl: null, capturedAt: clock().toISOString(), outcome: "FAILED", statusCode: 0, bodyBytes: 0, contentDigest: null, factsDigest: null, storageOutcome: "NONE", storageRefs: { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null }, failureCode: "SUBPAGE_CAPTURE_FAILED" }));
      continue;
    }
    if (capture.outcome !== "CAPTURED" || !capture.finalUrl || host(capture.finalUrl) !== host(identity.approvedWebsiteUrl)) {
      pageResults.push(makePage(selected.pageKind, capture, null, "NONE", { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null }));
      continue;
    }
    const facts = await extractHtmlPageFacts(capture, selected.pageKind);
    capturedPages.push({ pageKind: selected.pageKind, capture, facts });
    let pageRef: PrivateKwHtmlEvidenceRef | null = null;
    try {
      assertBefore();
      const pageMetadata = { ...metadata, requestedUrl: identity.approvedWebsiteUrl, finalUrl: capture.finalUrl!, parentReceiptDigest: digest({ identity: identity.sourceIdentityDigest, page: selected.pageKind, contentDigest: capture.contentDigest }) };
      if (retention === "RAW_HTML_ALLOWED") pageRef = await store.writePrivateKwHtmlEvidence({ ...pageMetadata, outcome: "RAW_HTML_ALLOWED", contentType: "text/html", bytes: capture.rawBytes });
      else pageRef = await store.writePrivateKwDerivedFacts({ ...pageMetadata, outcome: "DERIVED_FACTS_ONLY", captureBytes: capture.rawBytes, facts: projectFacts(facts, expectedServices, expectedLocations), rawArtifactRef: null });
    } catch {
      storageFailure = true;
    }
    pageResults.push(makePage(selected.pageKind, capture, facts, pageRef?.outcome ?? "NONE", pageRef ? refs(pageRef) : { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null }));
  }
  const audit = buildPrivateKwM2HtmlAuditReceipt({ sourceIdentityDigest: identity.sourceIdentityDigest, businessId: identity.businessId, businessName: identity.record.businessName, niche: identity.record.niche, expectedServices, expectedLocations, sourceEvidenceUrl: identity.record.sourceEvidenceUrl, pages: capturedPages });
  const failedSubpage = pageResults.some((page) => page.pageKind !== "HOME" && page.outcome !== "CAPTURED");
  const status = storageFailure ? "FAILED" : failedSubpage ? "PARTIAL" : plan.status === "PARTIAL" ? "RESEARCH_REQUIRED" : "COMPLETE";
  const receipt = buildReceipt({ request, identity, authorization, status, stopReason: storageFailure ? "STORE_CONFLICT" : null, policy: sourcePolicy, plan, pages: pageResults, audit, transport: budget, attempts });
  await receiptStore.publishSealed(receipt);
  return receipt;
}

export function privateKwM2HtmlEvidenceReceiptDigest(value: PrivateKwM2WebsiteEvidenceReceipt) {
  return privateKwM2ReceiptCanonicalDigest(value);
}
