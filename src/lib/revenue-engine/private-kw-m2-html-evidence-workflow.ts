import { createHash } from "node:crypto";
import path from "node:path";
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
import { createPrivateKwLocalHtmlEvidenceStore, PRIVATE_KW_EVIDENCE_ROOT, type PrivateKwFacts, type PrivateKwHtmlEvidenceRef } from "@/lib/revenue-engine/private-kw-local-html-evidence-store";
import { createPrivateKwPublicHttpTransport, privateKwPublicHttpTransportReceiptDigest } from "@/lib/revenue-engine/private-kw-public-http-transport";
import { evaluatePrivateKwRobotsPolicy, PrivateKwSourcePolicyDecisionSchema, type PrivateKwSourcePolicyDecision } from "@/lib/revenue-engine/private-kw-source-policy";
import { PrivateKwPublicHttpTransportReceiptSchema } from "@/lib/revenue-engine/private-kw-public-http-transport";
import { capturePublicWebsiteDocument, WebsiteCaptureResultSchema, type WebsiteCaptureResult } from "@/lib/revenue-engine/website-capture";
import { extractHtmlPageFacts, type HtmlPageFacts } from "@/lib/revenue-engine/html-page-facts";
import { defaultWebsitePageSelectionPolicy, planWebsitePages, WebsitePageSelectionPlanSchema, type WebsitePageSelectionPlan } from "@/lib/revenue-engine/website-page-selection";
import { buildPrivateKwM2HtmlAuditReceipt, type PrivateKwM2HtmlAuditReceipt } from "@/lib/revenue-engine/private-kw-m2-html-audit";
import { createPrivateKwM2HtmlEvidenceReceiptStore, privateKwM2ReceiptCanonicalDigest, type PrivateKwM2HtmlEvidenceReceiptStore } from "@/lib/revenue-engine/private-kw-m2-html-evidence-receipt";
import {
  BlockedEvidenceSchema, PageReceiptSchema, PageSelectionSchema, PrivateKwM2HtmlEvidenceRequestSchema,
  PrivateKwM2WebsiteEvidenceReceiptSchema, PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION, SourceIdentitySchema, StatusSchema,
  type PrivateKwM2HtmlEvidenceRequest, type PrivateKwM2WebsiteEvidenceReceipt,
} from "@/lib/revenue-engine/private-kw-m2-html-evidence-schema";
export {
  PrivateKwM2HtmlEvidenceRequestSchema, PrivateKwM2WebsiteEvidenceReceiptSchema, PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION,
} from "@/lib/revenue-engine/private-kw-m2-html-evidence-schema";
export type { PrivateKwM2HtmlEvidenceRequest, PrivateKwM2WebsiteEvidenceReceipt } from "@/lib/revenue-engine/private-kw-m2-html-evidence-schema";
type Store = Pick<ReturnType<typeof createPrivateKwLocalHtmlEvidenceStore>, "writePrivateKwHtmlEvidence" | "writePrivateKwDerivedFacts" | "reloadPrivateKwHtmlEvidence">;
export type PrivateKwM2HtmlEvidenceDependencies = {
  transport?: ReturnType<typeof createPrivateKwPublicHttpTransport>;
  store?: Store; receiptStore?: PrivateKwM2HtmlEvidenceReceiptStore; clock?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
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
function operationIdFor(request: PrivateKwM2HtmlEvidenceRequest, identity: Identity) {
  const hex = digest({ requestId: request.requestId, requestedAt: request.requestedAt, businessId: identity.businessId, sourceIdentityDigest: identity.sourceIdentityDigest, authorizationDigest: identity.chain.authorization.authorizationDigest, workflowVersion: PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION }).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
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
  return PageReceiptSchema.parse({ pageKind, requestedUrl: capture.requestedUrl ?? "https://invalid.invalid/", finalUrl: capture.finalUrl, capturedAt: capture.capturedAt, outcome: capture.outcome, statusCode: capture.statusCode, redirectCount: capture.redirectCount, bodyBytes: capture.bodyBytes, contentDigest: capture.outcome === "CAPTURED" ? capture.contentDigest : null, factsDigest: facts ? digest(projectFacts(facts, [], [])) : null, storageOutcome, storageRefs, failureCode: capture.failure?.code ?? null });
}
function sourcePolicySummary(policy: PrivateKwSourcePolicyDecision | null) {
  return policy ? PrivateKwSourcePolicyDecisionSchema.parse(policy) : null;
}
function sourcePolicyTransportReceipts(policy: PrivateKwSourcePolicyDecision, transport: ReturnType<typeof createPrivateKwPublicHttpTransport>) {
  const ids = new Set(policy.transportReceiptIds);
  return transport.takeReceipts().filter((receipt) => ids.has(receipt.requestId));
}
function blockedParentReceiptDigest(identity: Identity, reason: string, policy: PrivateKwSourcePolicyDecision, transport: ReturnType<typeof createPrivateKwPublicHttpTransport>) {
  return digest({ sourceIdentityDigest: identity.sourceIdentityDigest, stopReason: reason, sourcePolicyDigest: digest(policy), transportReceiptDigests: transport.takeReceipts().map((receipt) => receipt.receiptDigest) });
}
function blockedEvidenceValue(ref: PrivateKwHtmlEvidenceRef | null, parentReceiptDigest: string | null) {
  if (!ref || ref.outcome !== "BLOCKED" || !parentReceiptDigest) return null;
  return { outcome: "BLOCKED" as const, receiptRef: ref.receiptRef, blockCode: ref.blockCode, executionPath: ref.executionPath, parentReceiptDigest };
}
function validateTransportLedger(receipts: readonly unknown[], attempts: number, cap: number, policy: PrivateKwSourcePolicyDecision | null) {
  if (!Number.isSafeInteger(attempts) || attempts !== receipts.length || attempts > cap) throw new Error("TRANSPORT_LEDGER_COUNT_MISMATCH");
  const parsed = receipts.map((value) => PrivateKwPublicHttpTransportReceiptSchema.parse(value));
  const ids = parsed.map((receipt) => receipt.requestId);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && id <= ids[index - 1]!)) throw new Error("TRANSPORT_LEDGER_ORDER_MISMATCH");
  parsed.forEach((receipt) => {
    if (receipt.networkRequestCount !== 1 || privateKwPublicHttpTransportReceiptDigest(receipt) !== receipt.receiptDigest) throw new Error("TRANSPORT_LEDGER_DIGEST_MISMATCH");
  });
  if (policy) {
    if (policy.networkRequestCount !== policy.transportReceiptIds.length || policy.networkRequestCount !== policy.transportReceiptDigests.length || policy.networkRequestCount > attempts) throw new Error("SOURCE_POLICY_LEDGER_COUNT_MISMATCH");
    policy.transportReceiptIds.forEach((id, index) => {
      const receipt = parsed[index];
      if (!receipt || receipt.requestId !== id || receipt.receiptDigest !== policy.transportReceiptDigests[index]) throw new Error("SOURCE_POLICY_LEDGER_MISMATCH");
    });
  }
  return parsed;
}
function buildReceipt(input: { request: PrivateKwM2HtmlEvidenceRequest; identity: Identity; authorization: PrivateKwM2ExecutionAuthorization; status: z.infer<typeof StatusSchema>; stopReason: string | null; policy: PrivateKwSourcePolicyDecision | null; plan: z.infer<typeof PageSelectionSchema> | null; pages: z.infer<typeof PageReceiptSchema>[]; audit: PrivateKwM2HtmlAuditReceipt | null; blockedEvidence?: z.infer<typeof BlockedEvidenceSchema> | null; transport: ReturnType<typeof createPrivateKwPublicHttpTransport> | undefined; attempts: number; operationId?: string }) {
  const transportReceipts = input.transport?.takeReceipts() ?? [];
  const parsedTransportReceipts = validateTransportLedger(transportReceipts, input.attempts, input.authorization.networkRequestCap, input.policy);
  const transportIds = parsedTransportReceipts.map((receipt) => receipt.requestId);
  const transportDigests = parsedTransportReceipts.map((receipt) => receipt.receiptDigest);
  const core = { receiptVersion: PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION, operationId: input.operationId ?? operationIdFor(input.request, input.identity), requestId: input.request.requestId, requestedAt: input.request.requestedAt, status: input.status, stopReason: input.stopReason, businessId: input.identity.businessId, sourceIdentity: { businessId: input.identity.businessId, evaluationCandidateId: input.identity.evaluationCandidateId, sourceRecordId: input.identity.sourceRecordId, sourceRunId: input.identity.sourceRunId, sourcePlanDigest: input.identity.sourcePlanDigest, manifestDigest: input.identity.manifestDigest, sourceEvidenceUrl: input.identity.sourceEvidenceUrl, approvedWebsiteUrl: input.identity.approvedWebsiteUrl, sourceCapturedAt: input.identity.sourceCapturedAt, sourceIdentityDigest: input.identity.sourceIdentityDigest }, authorizationDigest: input.authorization.authorizationDigest, authorizationExpiresAt: input.authorization.expiresAt, sourcePolicy: sourcePolicySummary(input.policy), pageSelection: input.plan, pages: input.pages, audit: input.audit, blockedEvidence: input.blockedEvidence ?? null, transportReceipts: parsedTransportReceipts, transportReceiptIds: transportIds, transportReceiptDigests: transportDigests, networkRequestCount: input.attempts, networkRequestCap: input.authorization.networkRequestCap, providerOperations: 0 as const, costAuthorizedUsd: 0 as const, authority: input.authorization.authority };
  return PrivateKwM2WebsiteEvidenceReceiptSchema.parse({ ...core, operationDigest: digest(core) });
}
async function failReceipt(input: { request: PrivateKwM2HtmlEvidenceRequest; identity: Identity; authorization: PrivateKwM2ExecutionAuthorization; reason: string; policy: PrivateKwSourcePolicyDecision | null; transport?: ReturnType<typeof createPrivateKwPublicHttpTransport>; attempts: number; capture?: WebsiteCaptureResult | null; storage?: PrivateKwHtmlEvidenceRef | null; blockedEvidence?: z.infer<typeof BlockedEvidenceSchema> | null }) {
  const pages = input.capture ? [makePage("HOME", input.capture, null, input.storage?.outcome ?? "NONE", input.storage ? refs(input.storage) : { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null })] : [];
  return buildReceipt({ request: input.request, identity: input.identity, authorization: input.authorization, status: "FAILED", stopReason: input.reason, policy: input.policy, plan: null, pages, audit: null, blockedEvidence: input.blockedEvidence, transport: input.transport, attempts: input.attempts });
}
function safeCapture(value: unknown) { const parsed = WebsiteCaptureResultSchema.safeParse(value); return parsed.success ? parsed.data : null; }
function isAuthorizationExpired(error: unknown, authorization: PrivateKwM2ExecutionAuthorization, clock: () => Date) {
  return (error instanceof Error && (error.message.includes("AUTHORIZATION_EXPIRED") || /expired/i.test(error.message))) || Date.parse(authorization.expiresAt) <= clock().getTime();
}
function replayReference(page: z.infer<typeof PageReceiptSchema>) {
  const refs = page.storageRefs;
  if (page.storageOutcome === "RAW_HTML_ALLOWED") {
    if (!refs.contentRef || !refs.metadataRef) throw new Error("REPLAY_STORAGE_REFERENCE_MISSING");
    const contentDigest = refs.contentRef.slice(-64); const metadataDigest = refs.metadataRef.slice(-64);
    return { outcome: "RAW_HTML_ALLOWED" as const, contentRef: refs.contentRef, metadataRef: refs.metadataRef, contentPath: path.join(PRIVATE_KW_EVIDENCE_ROOT, "objects", "sha256", contentDigest.slice(0, 2), `${contentDigest}.html`), metadataPath: path.join(PRIVATE_KW_EVIDENCE_ROOT, "metadata", "sha256", metadataDigest.slice(0, 2), `${metadataDigest}.json`), executionPath: "EXACT_REPLAY" as const };
  }
  if (page.storageOutcome === "DERIVED_FACTS_ONLY") {
    if (!refs.contentRef || !refs.metadataRef || !refs.factsRef) throw new Error("REPLAY_STORAGE_REFERENCE_MISSING");
    const metadataDigest = refs.metadataRef.slice(-64); const factsDigest = refs.factsRef.slice(-64);
    return { outcome: "DERIVED_FACTS_ONLY" as const, contentRef: refs.contentRef, metadataRef: refs.metadataRef, factsRef: refs.factsRef, metadataPath: path.join(PRIVATE_KW_EVIDENCE_ROOT, "metadata", "sha256", metadataDigest.slice(0, 2), `${metadataDigest}.json`), factsPath: path.join(PRIVATE_KW_EVIDENCE_ROOT, "facts", "sha256", factsDigest.slice(0, 2), `${factsDigest}.json`), rawArtifactRef: null, executionPath: "EXACT_REPLAY" as const };
  }
  if (page.storageOutcome === "BLOCKED") {
    if (!refs.receiptRef) throw new Error("REPLAY_STORAGE_REFERENCE_MISSING");
    const receiptDigest = refs.receiptRef.slice(-64);
    return { outcome: "BLOCKED" as const, receiptRef: refs.receiptRef, receiptPath: path.join(PRIVATE_KW_EVIDENCE_ROOT, "receipts", "sha256", receiptDigest.slice(0, 2), `${receiptDigest}.json`), blockCode: page.failureCode ?? "REPLAY_BLOCKED", executionPath: "EXACT_REPLAY" as const };
  }
  return null;
}
function replayBlockedReference(value: z.infer<typeof BlockedEvidenceSchema>) {
  const receiptDigest = value.receiptRef.slice(-64);
  return {
    outcome: "BLOCKED" as const,
    receiptRef: value.receiptRef,
    receiptPath: path.join(PRIVATE_KW_EVIDENCE_ROOT, "receipts", "sha256", receiptDigest.slice(0, 2), `${receiptDigest}.json`),
    blockCode: value.blockCode,
    executionPath: "EXACT_REPLAY" as const,
  };
}
function validateReplayShape(receipt: PrivateKwM2WebsiteEvidenceReceipt, authorization: PrivateKwM2ExecutionAuthorization, transport: ReturnType<typeof createPrivateKwPublicHttpTransport>) {
  if (receipt.networkRequestCap !== authorization.networkRequestCap || receipt.networkRequestCount !== transport.takeReceipts().length || receipt.networkRequestCount !== receipt.transportReceipts.length || receipt.transportReceiptIds.length !== receipt.transportReceipts.length || receipt.transportReceiptDigests.length !== receipt.transportReceipts.length) throw new Error("REPLAY_COUNT_OR_CAP_MISMATCH");
  const pages = receipt.pages;
  const selection = receipt.pageSelection;
  if (selection) {
    if (selection.selectedPages.length !== pages.length || new Set(selection.selectedPages.map((page) => page.pageKind)).size !== selection.selectedPages.length) throw new Error("REPLAY_PAGE_SET_MISMATCH");
    selection.selectedPages.forEach((selected, index) => {
      const page = pages[index];
      if (!page || page.pageKind !== selected.pageKind || page.requestedUrl !== selected.url) throw new Error("REPLAY_PAGE_ORDER_MISMATCH");
    });
  } else if (receipt.status !== "FAILED" && pages.length > 0) throw new Error("REPLAY_PAGE_SELECTION_MISSING");
  pages.forEach((page) => {
    const refs = page.storageRefs;
    const refsEmpty = Object.values(refs).every((value) => value === null);
    if (page.outcome === "CAPTURED") {
      if (!page.contentDigest || page.bodyBytes <= 0 || page.failureCode !== null || page.finalUrl === null || page.storageOutcome === "NONE" || page.storageOutcome === "BLOCKED") throw new Error("REPLAY_CAPTURE_BRANCH_MISMATCH");
      if (page.storageOutcome === "RAW_HTML_ALLOWED" && (!refs.contentRef || !refs.metadataRef || refs.factsRef !== null || refs.receiptRef !== null)) throw new Error("REPLAY_RAW_REFERENCE_MISMATCH");
      if (page.storageOutcome === "DERIVED_FACTS_ONLY" && (!refs.contentRef || !refs.metadataRef || !refs.factsRef || refs.receiptRef !== null)) throw new Error("REPLAY_DERIVED_REFERENCE_MISMATCH");
    } else if (page.storageOutcome !== "NONE" || page.contentDigest !== null || page.factsDigest !== null || page.failureCode === null || !refsEmpty) throw new Error("REPLAY_FAILED_BRANCH_MISMATCH");
  });
  const captured = pages.filter((page) => page.outcome === "CAPTURED");
  const blockedReason = receipt.stopReason === "ROBOTS_OR_TERMS_BLOCKED" || receipt.stopReason === "RETENTION_BLOCKED";
  if (blockedReason !== (receipt.blockedEvidence !== null) || (receipt.blockedEvidence && (receipt.status !== "FAILED" || receipt.pages.length !== 0 || receipt.pageSelection !== null || receipt.audit !== null))) throw new Error("REPLAY_BLOCKED_WITNESS_MISMATCH");
  if (receipt.status === "FAILED" ? !receipt.stopReason : receipt.stopReason !== null) throw new Error("REPLAY_STATUS_REASON_MISMATCH");
  if (receipt.status === "COMPLETE" && (!selection || selection.status !== "READY" || captured.length !== pages.length || !receipt.audit)) throw new Error("REPLAY_COMPLETE_STATUS_MISMATCH");
  if (receipt.status === "RESEARCH_REQUIRED" && (!selection || selection.status !== "PARTIAL")) throw new Error("REPLAY_RESEARCH_STATUS_MISMATCH");
  if (receipt.status === "PARTIAL" && (!selection || captured.length === pages.length)) throw new Error("REPLAY_PARTIAL_STATUS_MISMATCH");
  if (selection?.status === "READY" && (receipt.status !== "COMPLETE" || captured.length !== pages.length)) throw new Error("REPLAY_READY_SELECTION_MISMATCH");
  if (selection?.status === "PARTIAL" && receipt.status !== "RESEARCH_REQUIRED" && receipt.status !== "PARTIAL") throw new Error("REPLAY_PARTIAL_SELECTION_MISMATCH");
  if (receipt.status === "FAILED" && !receipt.stopReason) throw new Error("REPLAY_FAILURE_REASON_MISSING");
  if (receipt.audit) {
    if (receipt.audit.pages.length !== captured.length || receipt.audit.browserEvidencePresent || receipt.audit.assemblerKind !== "HTML_ONLY") throw new Error("REPLAY_AUDIT_PAGE_SET_MISMATCH");
    receipt.audit.pages.forEach((auditPage, index) => {
      const page = captured[index];
      if (!page || auditPage.pageKind !== page.pageKind || auditPage.requestedUrl !== page.requestedUrl || auditPage.finalUrl !== page.finalUrl || auditPage.capturedAt !== page.capturedAt || auditPage.statusCode !== page.statusCode || auditPage.contentComplete) throw new Error("REPLAY_AUDIT_PAGE_MISMATCH");
    });
    const limitations = ["BROWSER_EVIDENCE_UNKNOWN", "MOBILE_EVIDENCE_UNKNOWN", "ABOVE_FOLD_EVIDENCE_UNKNOWN", "HTML_ONLY_STRUCTURAL_FACTS", "QUALIFICATION_NOT_PERFORMED", "CONTACT_DATA_DISCARDED"];
    if (receipt.audit.state !== "HTML_ONLY_PARTIAL" || receipt.audit.unknownLimitations.join("|") !== limitations.join("|")) throw new Error("REPLAY_AUDIT_LIMITATIONS_MISMATCH");
    const checks = receipt.audit.availability?.checks ?? [];
    if (checks.length !== 3 || checks.map((check) => check.checkId).join("|") !== "website_availability|redirect_chain|https" || checks.some((check) => check.category !== "availability" || check.method !== "http_probe" || check.confidence !== 0 || check.conversionCritical !== false || check.artifactRef !== null)) throw new Error("REPLAY_AUDIT_CHECKS_MISMATCH");
    const availability = receipt.audit.availability;
    const home = captured.find((page) => page.pageKind === "HOME");
    if (!availability || !home || availability.sourceIdentityDigest !== receipt.sourceIdentity.sourceIdentityDigest || availability.requestedUrl !== home.requestedUrl || availability.finalUrl !== home.finalUrl || availability.statusCode !== home.statusCode || availability.capturedAt !== home.capturedAt || availability.contentDigest !== home.contentDigest || availability.checks.some((check) => check.category !== "availability" || check.method !== "http_probe" || check.confidence !== 0 || check.conversionCritical !== false || check.artifactRef !== null)) throw new Error("REPLAY_AUDIT_AVAILABILITY_MISMATCH");
  }
}
async function validateSealedReplay(receipt: PrivateKwM2WebsiteEvidenceReceipt, input: { request: PrivateKwM2HtmlEvidenceRequest; identity: Identity; authorization: PrivateKwM2ExecutionAuthorization; clock: () => Date; store: Store }) {
  const { operationDigest, ...core } = receipt;
  if (digest(core) !== operationDigest) throw new Error("REPLAY_OPERATION_DIGEST_MISMATCH");
  const operationId = operationIdFor(input.request, input.identity);
  if (receipt.operationId !== operationId || receipt.requestId !== input.request.requestId || receipt.businessId !== input.identity.businessId || receipt.authorizationDigest !== input.authorization.authorizationDigest || receipt.authorizationExpiresAt !== input.authorization.expiresAt || receipt.sourceIdentity.sourceIdentityDigest !== input.identity.sourceIdentityDigest) throw new Error("REPLAY_IDENTITY_MISMATCH");
  assertPrivateKwM2ApprovalChain({ ...input.identity.chain, phase: "GET", now: input.clock().toISOString() });
  if (Date.parse(input.authorization.expiresAt) <= input.clock().getTime()) throw new Error("AUTHORIZATION_EXPIRED");
  const decision = input.authorization.sourceDecisions.find((entry) => entry.businessId === input.identity.businessId)!;
  const policy = receipt.sourcePolicy ? PrivateKwSourcePolicyDecisionSchema.parse(receipt.sourcePolicy) : null;
  if (policy && (policy.robotsUrl !== new URL("/robots.txt", input.identity.approvedWebsiteUrl).toString() || policy.termsDecision !== decision.termsDecision || policy.providerOperationsAuthorized !== 0 || policy.costAuthorizedUsd !== 0)) throw new Error("REPLAY_SOURCE_POLICY_MISMATCH");
  const transport = validateTransportLedger(receipt.transportReceipts, receipt.networkRequestCount, receipt.networkRequestCap, policy);
  if (transport.map((entry) => entry.requestId).join(",") !== receipt.transportReceiptIds.join(",") || transport.map((entry) => entry.receiptDigest).join(",") !== receipt.transportReceiptDigests.join(",")) throw new Error("REPLAY_TRANSPORT_SET_MISMATCH");
  validateReplayShape(receipt, input.authorization, { takeReceipts: () => transport } as unknown as ReturnType<typeof createPrivateKwPublicHttpTransport>);
  if (!policy || (receipt.pageSelection && receipt.pageSelection.sourceIdentityDigest !== input.identity.sourceIdentityDigest) || (receipt.audit?.availability && receipt.audit.availability.sourceIdentityDigest !== input.identity.sourceIdentityDigest)) throw new Error("REPLAY_CANONICAL_RECEIPT_MISMATCH");
  if (receipt.blockedEvidence) {
    const expectedParent = blockedParentReceiptDigest(input.identity, receipt.stopReason!, policy, { takeReceipts: () => transport } as unknown as ReturnType<typeof createPrivateKwPublicHttpTransport>);
    if (receipt.blockedEvidence.parentReceiptDigest !== expectedParent) throw new Error("REPLAY_BLOCKED_PARENT_MISMATCH");
    const reference = replayBlockedReference(receipt.blockedEvidence);
    const reloaded = await input.store.reloadPrivateKwHtmlEvidence(reference);
    if (reloaded.outcome !== "BLOCKED" || reloaded.blockCode !== receipt.blockedEvidence.blockCode || reloaded.receipt.receiptRef !== receipt.blockedEvidence.receiptRef || reloaded.receipt.businessId !== receipt.businessId || reloaded.receipt.sourceId !== input.identity.sourceRecordId || reloaded.receipt.parentReceiptDigest !== expectedParent || reloaded.receipt.blockCode !== receipt.stopReason) throw new Error("REPLAY_BLOCKED_WITNESS_MISMATCH");
  }
  if (receipt.pages.length > 4) throw new Error("REPLAY_PAGE_COUNT_MISMATCH");
  let homepageWitness: { statusCode: number; redirectCount: number; finalUrl: string; capturedAt: string; contentDigest: string } | null = null;
  for (const page of receipt.pages) {
    if (page.outcome === "CAPTURED") {
      const reference = replayReference(page);
      if (!reference) throw new Error("REPLAY_STORAGE_REFERENCE_MISSING");
      const reloaded = await input.store.reloadPrivateKwHtmlEvidence(reference);
      if (reloaded.outcome === "BLOCKED" || reloaded.outcome !== page.storageOutcome) throw new Error("REPLAY_DURABLE_METADATA_MISMATCH");
      const metadata = reloaded.metadata;
      if (metadata.businessId !== receipt.businessId || metadata.sourceId !== input.identity.sourceRecordId || metadata.requestedUrl !== page.requestedUrl || metadata.finalUrl !== page.finalUrl || metadata.sourcePageUrl !== input.identity.approvedWebsiteUrl || metadata.capturedAt !== page.capturedAt || metadata.statusCode !== page.statusCode || metadata.redirectCount !== page.redirectCount || metadata.authorizationDigest !== receipt.authorizationDigest || metadata.authorizationExpiresAt !== receipt.authorizationExpiresAt || metadata.sourcePolicyVersion !== policy.policyVersion || digest(metadata.sourcePolicyDecision) !== digest(policy) || digest(metadata.transportReceipts) !== digest(transport.slice(0, policy.networkRequestCount)) || metadata.retentionDecision !== page.storageOutcome || metadata.contentRef !== page.storageRefs.contentRef || metadata.metadataRef !== page.storageRefs.metadataRef || (page.storageOutcome === "DERIVED_FACTS_ONLY" && reloaded.outcome === "DERIVED_FACTS_ONLY" && reloaded.facts.factsRef !== page.storageRefs.factsRef)) throw new Error("REPLAY_DURABLE_METADATA_MISMATCH");
      if (reloaded.outcome === "RAW_HTML_ALLOWED" && createHash("sha256").update(reloaded.bytes).digest("hex") !== page.contentDigest) throw new Error("REPLAY_CONTENT_DIGEST_MISMATCH");
      if (reloaded.outcome === "DERIVED_FACTS_ONLY" && digest(reloaded.facts.facts) !== page.factsDigest) throw new Error("REPLAY_FACTS_DIGEST_MISMATCH");
      if (reloaded.metadata.parentReceiptDigest !== digest({ identity: receipt.sourceIdentity.sourceIdentityDigest, page: page.pageKind, contentDigest: page.contentDigest, pageSelectionDigest: digest(receipt.pageSelection) })) throw new Error("REPLAY_PARENT_DIGEST_MISMATCH");
      if (page.pageKind === "HOME") homepageWitness = { statusCode: reloaded.metadata.statusCode ?? page.statusCode, redirectCount: reloaded.metadata.redirectCount ?? page.redirectCount, finalUrl: page.finalUrl!, capturedAt: page.capturedAt, contentDigest: page.contentDigest! };
    } else if (page.storageOutcome !== "NONE") throw new Error("REPLAY_FAILED_PAGE_STORAGE");
  }
  if (receipt.audit?.availability && homepageWitness) {
    const expectedOutcomes = [homepageWitness.statusCode >= 200 && homepageWitness.statusCode < 400 ? "PASS" : "FAIL", homepageWitness.redirectCount <= 3 ? "PASS" : "FAIL", homepageWitness.finalUrl.startsWith("https://") ? "PASS" : "FAIL"];
    const checks = receipt.audit.availability.checks;
    if (receipt.audit.availability.redirectCount !== homepageWitness.redirectCount || checks.some((check, index) => check.outcome !== expectedOutcomes[index] || check.sourceUrl !== homepageWitness!.finalUrl || check.capturedAt !== homepageWitness!.capturedAt)) throw new Error("REPLAY_AUDIT_CHECKS_MISMATCH");
  }
  return receipt;
}

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
  const operationId = operationIdFor(request, identity);
  try {
    assertPrivateKwM2ApprovalChain({ researchPacket: packet, authorization, ownerEnvelope, manifest, sourcePlan, phase: "GET", now: clock().toISOString(), researchPolicy: policy });
  } catch (error) {
    if (request.replayMode === "EXACT_REPLAY") {
      const reason = error instanceof Error && (error.message.includes("expired") || Date.parse(authorization.expiresAt) <= clock().getTime()) ? "AUTHORIZATION_EXPIRED" : "REPLAY_MISMATCH";
      return buildReceipt({ request, identity, authorization, status: "FAILED", stopReason: reason, policy: null, plan: null, pages: [], audit: null, transport: undefined, attempts: 0, operationId });
    }
    throw error;
  }
  const receiptStore = dependencies.receiptStore ?? createPrivateKwM2HtmlEvidenceReceiptStore();
  const replayStore = dependencies.store ?? createPrivateKwLocalHtmlEvidenceStore({ clock });
  const existing = await receiptStore.loadSealed(operationId);
  if (existing) {
    const parsed = PrivateKwM2WebsiteEvidenceReceiptSchema.parse(existing);
    try { return await validateSealedReplay(parsed, { request, identity, authorization, clock, store: replayStore }); }
    catch (error) {
      const reason = error instanceof Error && error.message === "AUTHORIZATION_EXPIRED" ? "AUTHORIZATION_EXPIRED" : "REPLAY_MISMATCH";
      return buildReceipt({ request, identity, authorization, status: "FAILED", stopReason: reason, policy: null, plan: null, pages: [], audit: null, transport: undefined, attempts: 0, operationId });
    }
  }
  if (request.replayMode === "EXACT_REPLAY") {
    return buildReceipt({ request, identity, authorization, status: "FAILED", stopReason: "REPLAY_MISSING", policy: null, plan: null, pages: [], audit: null, transport: undefined, attempts: 0, operationId });
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
      const previousId = base.takeReceipts().at(-1)?.requestId ?? 0;
      try { return await base.request(value, init); }
      finally {
        const receipts = base.takeReceipts();
        if (receipts.length !== before + 1) throw new Error("TRANSPORT_RECEIPT_RECONCILIATION_FAILED");
        const receipt = receipts.at(-1)!;
        if (receipt.requestId <= previousId) throw new Error("TRANSPORT_RECEIPT_ORDER_RECONCILIATION_FAILED");
        validateTransportLedger([receipt], 1, authorization.networkRequestCap, null);
      }
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
    const durableAttempts = budget.takeReceipts().length;
    if (isAuthorizationExpired(error, authorization, clock)) return failReceipt({ request, identity, authorization, reason: "AUTHORIZATION_EXPIRED", policy: sourcePolicy, transport: budget, attempts: durableAttempts });
    if (!sourcePolicy) return failReceipt({ request, identity, authorization, reason: "ROBOTS_POLICY_FAILED", policy: null, transport: budget, attempts: durableAttempts });
    const reason = "ROBOTS_POLICY_FAILED";
    const receipt = await failReceipt({ request, identity, authorization, reason, policy: sourcePolicy, transport: budget, attempts: durableAttempts });
    await receiptStore.publishSealed(receipt);
    return receipt;
  }
  if (!sourcePolicy.allowed) {
    const durableAttempts = budget.takeReceipts().length;
    let blockedRef: PrivateKwHtmlEvidenceRef | null = null;
    const blockedParent = blockedParentReceiptDigest(identity, "ROBOTS_OR_TERMS_BLOCKED", sourcePolicy, budget);
    const decision = authorization.sourceDecisions.find((entry) => entry.businessId === identity.businessId)!;
    if (decision.evidenceRetention === "BLOCKED" && Date.parse(authorization.expiresAt) > clock().getTime()) {
      const store = dependencies.store ?? createPrivateKwLocalHtmlEvidenceStore({ clock });
      try {
        blockedRef = await store.writePrivateKwHtmlEvidence({
          outcome: "BLOCKED", blockCode: "ROBOTS_OR_TERMS_BLOCKED", businessId: identity.businessId, sourceId: identity.sourceRecordId,
          requestedUrl: identity.approvedWebsiteUrl, finalUrl: identity.approvedWebsiteUrl, redirectChainDigest: digest([identity.approvedWebsiteUrl]),
          captureVersion: "website-capture-v1", transportVersion: "kw-m2-public-transport-v1", sourcePolicyVersion: sourcePolicy.policyVersion,
          capturedAt: clock().toISOString(), parentReceiptDigest: blockedParent,
          authorizationDigest: authorization.authorizationDigest, authorizationExpiresAt: authorization.expiresAt, authorizationChain: identity.chain,
          sourcePolicyDecision: sourcePolicy, transportReceipts: sourcePolicyTransportReceipts(sourcePolicy, budget), retentionDecision: "BLOCKED", legalHold: false,
        });
      } catch (error) {
        if (isAuthorizationExpired(error, authorization, clock)) return failReceipt({ request, identity, authorization, reason: "AUTHORIZATION_EXPIRED", policy: sourcePolicy, transport: budget, attempts: durableAttempts });
        blockedRef = null;
      }
    }
    if (!blockedRef) return failReceipt({ request, identity, authorization, reason: "ROBOTS_OR_TERMS_BLOCKED", policy: sourcePolicy, transport: budget, attempts: durableAttempts });
    const receipt = await failReceipt({ request, identity, authorization, reason: "ROBOTS_OR_TERMS_BLOCKED", policy: sourcePolicy, transport: budget, attempts: durableAttempts, blockedEvidence: blockedEvidenceValue(blockedRef, blockedParent) });
    await receiptStore.publishSealed(receipt);
    return receipt;
  }
  const decision = authorization.sourceDecisions.find((entry) => entry.businessId === identity.businessId)!;
  const retention = decision.evidenceRetention;
  const store = dependencies.store ?? createPrivateKwLocalHtmlEvidenceStore({ clock });
  if (retention === "BLOCKED") {
    let blockedRef: PrivateKwHtmlEvidenceRef | null = null;
    const blockedParent = blockedParentReceiptDigest(identity, "RETENTION_BLOCKED", sourcePolicy, budget);
    try {
      blockedRef = await store.writePrivateKwHtmlEvidence({
        outcome: "BLOCKED", blockCode: "RETENTION_BLOCKED", businessId: identity.businessId, sourceId: identity.sourceRecordId,
        requestedUrl: identity.approvedWebsiteUrl, finalUrl: identity.approvedWebsiteUrl, redirectChainDigest: digest([identity.approvedWebsiteUrl]),
        captureVersion: "website-capture-v1", transportVersion: "kw-m2-public-transport-v1", sourcePolicyVersion: sourcePolicy.policyVersion,
        capturedAt: clock().toISOString(), parentReceiptDigest: blockedParent,
        authorizationDigest: authorization.authorizationDigest, authorizationExpiresAt: authorization.expiresAt, authorizationChain: identity.chain,
        sourcePolicyDecision: sourcePolicy, transportReceipts: sourcePolicyTransportReceipts(sourcePolicy, budget), retentionDecision: "BLOCKED", legalHold: false,
      });
    } catch (error) {
      if (isAuthorizationExpired(error, authorization, clock)) return failReceipt({ request, identity, authorization, reason: "AUTHORIZATION_EXPIRED", policy: sourcePolicy, transport: budget, attempts });
      blockedRef = null;
    }
    if (!blockedRef) return failReceipt({ request, identity, authorization, reason: "RETENTION_BLOCKED", policy: sourcePolicy, transport: budget, attempts });
    const receipt = await failReceipt({ request, identity, authorization, reason: "RETENTION_BLOCKED", policy: sourcePolicy, transport: budget, attempts, blockedEvidence: blockedEvidenceValue(blockedRef, blockedParent) });
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
    return failReceipt({ request, identity, authorization, reason, policy: sourcePolicy, transport: budget, attempts, capture: safeCapture(error) });
  }
  if (homeCapture.outcome !== "CAPTURED" || !homeCapture.finalUrl || host(homeCapture.finalUrl) !== host(identity.approvedWebsiteUrl)) {
    return failReceipt({ request, identity, authorization, reason: "HOMEPAGE_CAPTURE_FAILED", policy: sourcePolicy, transport: budget, attempts, capture: homeCapture });
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
    businessId: identity.businessId, sourceId: identity.sourceRecordId, requestedUrl: homeCapture.requestedUrl!, sourcePageUrl: identity.approvedWebsiteUrl, finalUrl: homeCapture.finalUrl!, statusCode: homeCapture.statusCode, redirectCount: homeCapture.redirectCount,
    redirectChainDigest: digest(homeCapture.redirectChain), captureVersion: homeCapture.captureVersion, transportVersion: "kw-m2-public-transport-v1",
    sourcePolicyVersion: sourcePolicy.policyVersion, capturedAt: homeCapture.capturedAt, parentReceiptDigest: digest({ identity: identity.sourceIdentityDigest, page: "HOME", contentDigest: homeCapture.contentDigest, pageSelectionDigest: digest(plan) }),
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
  } catch (error) {
    if (isAuthorizationExpired(error, authorization, clock)) return failReceipt({ request, identity, authorization, reason: "AUTHORIZATION_EXPIRED", policy: sourcePolicy, transport: budget, attempts, capture: homeCapture });
    return failReceipt({ request, identity, authorization, reason: "STORE_CONFLICT", policy: sourcePolicy, transport: budget, attempts, capture: homeCapture });
  }
  const pageResults: z.infer<typeof PageReceiptSchema>[] = [makePage("HOME", homeCapture, homeFacts, homeRef?.outcome ?? "NONE", homeRef ? refs(homeRef) : { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null })];
  const capturedPages: Array<{ pageKind: "HOME" | "SERVICE" | "ABOUT" | "CONTACT"; capture: WebsiteCaptureResult; facts: HtmlPageFacts }> = [{ pageKind: "HOME", capture: homeCapture, facts: homeFacts }];
  let unsealedFailure = false;
  for (const selected of plan.selectedPages.filter((page) => page.pageKind !== "HOME")) {
    let capture: WebsiteCaptureResult | null = null;
    try {
      capture = await capturePublicWebsiteDocument(selected.url, { fetch: (value, init) => budget.request(value, init), now: clock });
      if (Date.parse(authorization.expiresAt) <= clock().getTime()) throw new Error("AUTHORIZATION_EXPIRED");
    } catch (error) {
      if (error instanceof Error && (error.message.includes("AUTHORIZATION_EXPIRED") || Date.parse(authorization.expiresAt) <= clock().getTime())) {
        return failReceipt({ request, identity, authorization, reason: "AUTHORIZATION_EXPIRED", policy: sourcePolicy, transport: budget, attempts, capture });
      }
      unsealedFailure = true;
      pageResults.push(PageReceiptSchema.parse({ pageKind: selected.pageKind, requestedUrl: selected.url, finalUrl: null, capturedAt: clock().toISOString(), outcome: "FAILED", statusCode: 0, redirectCount: 0, bodyBytes: 0, contentDigest: null, factsDigest: null, storageOutcome: "NONE", storageRefs: { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null }, failureCode: "SUBPAGE_CAPTURE_FAILED" }));
      continue;
    }
    if (!capture) {
      unsealedFailure = true;
      pageResults.push(PageReceiptSchema.parse({ pageKind: selected.pageKind, requestedUrl: selected.url, finalUrl: null, capturedAt: clock().toISOString(), outcome: "FAILED", statusCode: 0, redirectCount: 0, bodyBytes: 0, contentDigest: null, factsDigest: null, storageOutcome: "NONE", storageRefs: { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null }, failureCode: "SUBPAGE_CAPTURE_FAILED" }));
      continue;
    }
    if (capture.outcome !== "CAPTURED" || !capture.finalUrl || host(capture.finalUrl) !== host(identity.approvedWebsiteUrl)) {
      unsealedFailure = true;
      pageResults.push(makePage(selected.pageKind, capture, null, "NONE", { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null }));
      continue;
    }
    const facts = await extractHtmlPageFacts(capture, selected.pageKind);
    capturedPages.push({ pageKind: selected.pageKind, capture, facts });
    let pageRef: PrivateKwHtmlEvidenceRef | null = null;
    try {
      assertBefore();
      const pageMetadata = { ...metadata, requestedUrl: selected.url, sourcePageUrl: identity.approvedWebsiteUrl, finalUrl: capture.finalUrl!, statusCode: capture.statusCode, redirectCount: capture.redirectCount, parentReceiptDigest: digest({ identity: identity.sourceIdentityDigest, page: selected.pageKind, contentDigest: capture.contentDigest, pageSelectionDigest: digest(plan) }) };
      if (retention === "RAW_HTML_ALLOWED") pageRef = await store.writePrivateKwHtmlEvidence({ ...pageMetadata, outcome: "RAW_HTML_ALLOWED", contentType: "text/html", bytes: capture.rawBytes });
      else pageRef = await store.writePrivateKwDerivedFacts({ ...pageMetadata, outcome: "DERIVED_FACTS_ONLY", captureBytes: capture.rawBytes, facts: projectFacts(facts, expectedServices, expectedLocations), rawArtifactRef: null });
    } catch (error) {
      if (isAuthorizationExpired(error, authorization, clock)) return failReceipt({ request, identity, authorization, reason: "AUTHORIZATION_EXPIRED", policy: sourcePolicy, transport: budget, attempts, capture });
      storageFailure = true;
      unsealedFailure = true;
    }
    pageResults.push(makePage(selected.pageKind, capture, facts, pageRef?.outcome ?? "NONE", pageRef ? refs(pageRef) : { contentRef: null, metadataRef: null, factsRef: null, receiptRef: null }));
  }
  const audit = buildPrivateKwM2HtmlAuditReceipt({ sourceIdentityDigest: identity.sourceIdentityDigest, businessId: identity.businessId, businessName: identity.record.businessName, niche: identity.record.niche, expectedServices, expectedLocations, sourceEvidenceUrl: identity.record.sourceEvidenceUrl, pages: capturedPages });
  const failedSubpage = pageResults.some((page) => page.pageKind !== "HOME" && page.outcome !== "CAPTURED");
  const status = storageFailure ? "FAILED" : failedSubpage ? "PARTIAL" : plan.status === "PARTIAL" ? "RESEARCH_REQUIRED" : "COMPLETE";
  const receipt = buildReceipt({ request, identity, authorization, status, stopReason: storageFailure ? "STORE_CONFLICT" : null, policy: sourcePolicy, plan, pages: pageResults, audit, transport: budget, attempts });
  if (unsealedFailure) return receipt;
  await receiptStore.publishSealed(receipt);
  return receipt;
}

export function privateKwM2HtmlEvidenceReceiptDigest(value: PrivateKwM2WebsiteEvidenceReceipt) {
  return privateKwM2ReceiptCanonicalDigest(value);
}
