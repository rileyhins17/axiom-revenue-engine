import { createHash } from "node:crypto";

import {
  buildPrivateKwM2ExecutionAuthorization,
  buildPrivateKwM2OwnerApprovalCandidate,
  buildPrivateKwM2ResearchPacket,
  buildPrivateKwM2ResearchPolicy,
  recordPrivateKwM2OwnerApproval,
  type ResearchPolicyDecisionInput,
} from "@/lib/revenue-engine/private-kw-m2-authorization";
import { executePrivateKwM2HtmlEvidence } from "@/lib/revenue-engine/private-kw-m2-html-evidence-workflow";
import type { PrivateKwM2WebsiteEvidenceReceipt } from "@/lib/revenue-engine/private-kw-m2-html-evidence-schema";
import {
  PRIVATE_KW_EVIDENCE_ROOT,
  createPrivateKwLocalHtmlEvidenceStore,
  type PrivateKwHtmlEvidenceRef,
  type PrivateKwEvidenceMetadataInput,
  type PrivateKwFacts,
  type ReloadedEvidence,
} from "@/lib/revenue-engine/private-kw-local-html-evidence-store";
import { createPrivateKwPublicHttpTransport, type PrivateKwPublicHttpTransportReceipt } from "@/lib/revenue-engine/private-kw-public-http-transport";
import type { PrivateKwSourcePolicyDecision } from "@/lib/revenue-engine/private-kw-source-policy";
import { preparePrivateKwImport, PRIVATE_KW_IMPORT_VERSION } from "@/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "@/lib/revenue-engine/private-kw-persistence-plan";
import { buildPrivateKwShadowSliceManifest, PRIVATE_KW_SHADOW_SLICE_SIZE, PRIVATE_KW_SHADOW_SLICE_VERSION } from "@/lib/revenue-engine/private-kw-shadow-slice";

const NOW = "2026-09-21T15:00:00.000Z";
const RETENTION_WINDOW_MS = 9 * 24 * 60 * 60 * 1000;
const SOURCE_CAPTURE_OFFSET_MS = -20 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;
const SOURCE_REVIEW_OFFSET_MS = -19 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;
const MANIFEST_CREATED_OFFSET_MS = -19 * 24 * 60 * 60 * 1000;
const PACKET_REVIEW_OFFSET_MS = -18 * 24 * 60 * 60 * 1000;
const OWNER_REVIEW_OFFSET_MS = -17 * 24 * 60 * 60 * 1000;

type FixtureRetention = "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY";

function fixtureClock(now: Date | undefined): Date {
  const value = new Date(now ?? NOW);
  if (!Number.isFinite(value.getTime())) throw new Error("Fixture now must be a valid date.");
  return value;
}

function relativeIso(now: Date, offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function approvedChain(now: Date, retention: FixtureRetention) {
  const records = Array.from({ length: PRIVATE_KW_SHADOW_SLICE_SIZE }, (_, index) => ({
    sourceOwnedId: `m2-task-5-${index + 1}`,
    sourceEvidenceUrl: `https://directory-${index + 1}.com/business-${index + 1}`,
    businessName: `Synthetic Business ${index + 1}`,
    city: (["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const)[index % 3],
    region: "ON" as const,
    country: "CA" as const,
    niche: (["ROOFING", "HVAC", "LANDSCAPING"] as const)[index % 3],
    websiteUrl: `https://business-${index + 1}.com/`,
    phone: null,
    addressLine: `${index + 1} Example Street`,
    postalCode: "N2G 1A1",
    independenceStatus: "INDEPENDENT" as const,
    capturedAt: relativeIso(now, SOURCE_CAPTURE_OFFSET_MS),
    sourcePayload: { synthetic: true },
  }));
  const sourcePlan = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: "m2-task-5-assessment-fixture",
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic Task5 HTML assessment",
    filters: { synthetic: true },
    capturedAt: relativeIso(now, SOURCE_CAPTURE_OFFSET_MS + 60 * 60 * 1000),
    costUsd: 0,
    records,
  });
  const sourcePlanDigest = buildPrivateKwPersistencePlan(sourcePlan).sourcePlanDigest;
  const manifest = buildPrivateKwShadowSliceManifest(sourcePlan, {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION,
    sliceKey: "m2-task-5-assessment-fixture",
    sourceImportId: sourcePlan.importId,
    sourcePlanDigest,
    createdAt: relativeIso(now, MANIFEST_CREATED_OFFSET_MS),
    mode: "SHADOW",
    selections: sourcePlan.records.map((record) => ({
      businessId: record.business.id,
      evaluationCandidateId: record.evaluationCandidateId,
      sourceReview: {
        decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE" as const,
        reviewedBy: "RILEY" as const,
        reviewedAt: relativeIso(now, SOURCE_REVIEW_OFFSET_MS),
        rationale: "Synthetic identity and source chain reviewed.",
        identityConfirmed: true as const,
        marketAndNicheConfirmed: true as const,
        independenceConfirmed: true as const,
      },
    })),
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
  });
  const policyDecisions: ResearchPolicyDecisionInput[] = sourcePlan.records.map((record) => ({
    businessId: record.business.id,
    sourceRights: "PUBLIC_SOURCE_REVIEWED" as const,
    termsDecision: "TERMS_REVIEWED_FOR_FACTS" as const,
    robotsDecision: "ROBOTS_REVIEWED_PUBLIC_ONLY" as const,
    evidenceRetention: retention,
    retentionReviewDate: relativeIso(now, RETENTION_WINDOW_MS),
    stopConditions: ["ROBOTS_OR_TERMS_UNCLEAR" as const],
  }));
  const researchPacket = buildPrivateKwM2ResearchPacket({ manifest, sourcePlan, reviewedAt: relativeIso(now, PACKET_REVIEW_OFFSET_MS), policyDecisions });
  const researchPolicy = buildPrivateKwM2ResearchPolicy({ manifest, reviewedAt: relativeIso(now, PACKET_REVIEW_OFFSET_MS), policyDecisions });
  const authorization = buildPrivateKwM2ExecutionAuthorization({
    manifest, sourcePlan, researchPacket, researchPolicy,
    websitePolicy: { version: "kw-m2-website-policy-v1", networkRequestCap: 16, expiresAt: relativeIso(now, RETENTION_WINDOW_MS) },
  });
  const candidate = buildPrivateKwM2OwnerApprovalCandidate({ manifest, sourcePlan, researchPacket, authorization, researchPolicy });
  const ownerEnvelope = recordPrivateKwM2OwnerApproval(candidate, {
    approver: "RILEY", reviewedAt: relativeIso(now, OWNER_REVIEW_OFFSET_MS), expiresAt: relativeIso(now, RETENTION_WINDOW_MS),
    rationale: "Approved synthetic bounded local review.", dedicatedConfirmation: true,
  });
  return { sourcePlan, manifest, researchPacket, authorization, ownerEnvelope, researchPolicy };
}

function fakeTransport(now: Date) {
  return createPrivateKwPublicHttpTransport({
    resolveDns: async () => [{ address: "93.184.216.34", family: 4 as const }],
    executeConnection: async (request) => {
      const url = new URL(request.url);
      const body = url.pathname === "/robots.txt"
        ? "User-agent: *\nAllow: /\n"
        : "<!doctype html><html><head><title>Synthetic local business</title></head><body><h1>Synthetic local business</h1><a href=\"/service\">Service</a><a href=\"/about\">About</a><a href=\"/contact\">Contact</a></body></html>";
      const bytes = new TextEncoder().encode(body);
      return {
        statusCode: 200,
        headers: { "content-type": url.pathname === "/robots.txt" ? "text/plain" : "text/html" },
        body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
        abort() {},
      };
    },
    now: () => new Date(now),
  });
}

type Store = ReturnType<typeof createPrivateKwLocalHtmlEvidenceStore>;
type FixtureStore = Pick<Store, "writePrivateKwHtmlEvidence" | "writePrivateKwDerivedFacts" | "reloadPrivateKwHtmlEvidenceReadOnly">;
type RawInput = Extract<Parameters<Store["writePrivateKwHtmlEvidence"]>[0], { outcome: "RAW_HTML_ALLOWED" }>;
type DerivedInput = Parameters<Store["writePrivateKwDerivedFacts"]>[0];
type Entry = { reference: PrivateKwHtmlEvidenceRef; reloaded: ReloadedEvidence };

type MemoryMetadataBase = {
  metadataVersion: "private-kw-html-metadata-v1";
  contentRef: string;
  contentByteLength: number;
  contentType: "text/html";
  businessId: string;
  sourceId: string;
  requestedUrl: string;
  sourcePageUrl?: string;
  finalUrl: string;
  redirectChainDigest: string;
  captureVersion: string;
  transportVersion: string;
  sourcePolicyVersion: string;
  capturedAt: string;
  statusCode?: number;
  redirectCount?: number;
  rightsDecision: "ALLOWED";
  termsDecision: "REVIEWED";
  robotsDecision: "ALLOWED";
  parentReceiptDigest: string;
  authorizationDigest: string;
  authorizationExpiresAt: string;
  sourcePolicyDecision?: PrivateKwSourcePolicyDecision;
  transportReceipts?: PrivateKwPublicHttpTransportReceipt[];
  legalHold: boolean;
};
type MemoryMetadata = (MemoryMetadataBase & { outcome: "RAW_HTML_ALLOWED"; retentionDecision: "RAW_HTML_ALLOWED"; retainUntil: string; reviewAt?: undefined; metadataRef: string })
  | (MemoryMetadataBase & { outcome: "DERIVED_FACTS_ONLY"; retentionDecision: "DERIVED_FACTS_ONLY"; reviewAt: string; retainUntil?: undefined; metadataRef: string });
type MemoryFacts = { factsVersion: "private-kw-html-facts-v1"; contentRef: string; metadataRef: string; rawArtifactRef: null; facts: PrivateKwFacts; factsRef: string };

function metadataCore(input: PrivateKwEvidenceMetadataInput, outcome: "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY", contentDigest: string, contentByteLength: number): Omit<MemoryMetadata, "metadataRef"> {
  return {
    metadataVersion: "private-kw-html-metadata-v1" as const,
    outcome,
    contentRef: `kw-html:sha256:${contentDigest}`,
    contentByteLength,
    contentType: "text/html" as const,
    businessId: input.businessId,
    sourceId: input.sourceId,
    requestedUrl: input.requestedUrl,
    ...(input.sourcePageUrl ? { sourcePageUrl: input.sourcePageUrl } : {}),
    finalUrl: input.finalUrl,
    redirectChainDigest: input.redirectChainDigest,
    captureVersion: input.captureVersion,
    transportVersion: input.transportVersion,
    sourcePolicyVersion: outcome === "RAW_HTML_ALLOWED" && input.sourcePolicyDecision
      ? (input.sourcePolicyDecision as { policyVersion: string }).policyVersion
      : input.sourcePolicyVersion,
    capturedAt: input.capturedAt,
    ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
    ...(input.redirectCount !== undefined ? { redirectCount: input.redirectCount } : {}),
    rightsDecision: "ALLOWED" as const,
    termsDecision: "REVIEWED" as const,
    robotsDecision: "ALLOWED" as const,
    parentReceiptDigest: input.parentReceiptDigest,
    authorizationDigest: input.authorizationChain.authorization.authorizationDigest,
    authorizationExpiresAt: input.authorizationChain.authorization.expiresAt,
    ...(input.sourcePolicyDecision ? { sourcePolicyDecision: input.sourcePolicyDecision } : {}),
    ...(input.transportReceipts ? { transportReceipts: [...input.transportReceipts] } : {}),
    retentionDecision: outcome,
    ...(outcome === "RAW_HTML_ALLOWED" ? { retainUntil: input.retainUntil } : { reviewAt: input.reviewAt }),
    legalHold: input.legalHold ?? false,
  } as Omit<MemoryMetadata, "metadataRef">;
}

function memoryEvidenceStore() {
  const entries = new Map<string, Entry>();
  const rawRef = (digest: string) => `kw-html:sha256:${digest}`;
  const metadataRef = (digest: string) => `kw-html-meta:sha256:${digest}`;
  const factsRef = (digest: string) => `kw-html-facts:sha256:${digest}`;
  const writeRaw = async (input: RawInput) => {
    if (input.outcome !== "RAW_HTML_ALLOWED") throw new Error("fixture received a non-raw input");
    const bytes = Buffer.from(input.bytes);
    const contentDigest = sha256(bytes);
    const core = metadataCore(input, "RAW_HTML_ALLOWED", contentDigest, bytes.byteLength);
    const meta = { ...core, metadataRef: metadataRef(sha256(canonicalize(core))) } as MemoryMetadata;
    const reference: Extract<PrivateKwHtmlEvidenceRef, { outcome: "RAW_HTML_ALLOWED" }> = { outcome: "RAW_HTML_ALLOWED", contentRef: rawRef(contentDigest), metadataRef: meta.metadataRef, contentPath: "memory/content.html", metadataPath: "memory/metadata.json", executionPath: "CREATED" };
    entries.set(`${reference.outcome}:${reference.contentRef}:${reference.metadataRef}`, { reference, reloaded: { outcome: "RAW_HTML_ALLOWED", bytes, metadata: meta } });
    return reference;
  };
  const writeDerived = async (input: DerivedInput) => {
    if (input.outcome !== "DERIVED_FACTS_ONLY") throw new Error("fixture received a non-derived input");
    const captureBytes = Buffer.from(input.captureBytes);
    const contentDigest = sha256(captureBytes);
    const core = metadataCore(input, "DERIVED_FACTS_ONLY", contentDigest, captureBytes.byteLength);
    const meta = { ...core, metadataRef: metadataRef(sha256(canonicalize(core))) } as MemoryMetadata;
    const factsCore = { factsVersion: "private-kw-html-facts-v1" as const, contentRef: rawRef(contentDigest), metadataRef: meta.metadataRef, rawArtifactRef: null, facts: input.facts };
    const factsDigest = sha256(canonicalize(factsCore));
    const facts: MemoryFacts = { ...factsCore, factsRef: factsRef(factsDigest) };
    const reference: Extract<PrivateKwHtmlEvidenceRef, { outcome: "DERIVED_FACTS_ONLY" }> = { outcome: "DERIVED_FACTS_ONLY", contentRef: rawRef(contentDigest), metadataRef: meta.metadataRef, factsRef: facts.factsRef, rawArtifactRef: null, metadataPath: "memory/metadata.json", factsPath: "memory/facts.json", executionPath: "CREATED" };
    entries.set(`${reference.outcome}:${reference.contentRef}:${reference.metadataRef}:${reference.factsRef}`, { reference, reloaded: { outcome: "DERIVED_FACTS_ONLY", facts, metadata: meta } });
    return reference;
  };
  const reload = async (reference: unknown): Promise<ReloadedEvidence> => {
    const parsed = reference as { outcome?: string; contentRef?: string; metadataRef?: string; factsRef?: string };
    const key = parsed.outcome === "DERIVED_FACTS_ONLY"
      ? `${parsed.outcome}:${parsed.contentRef}:${parsed.metadataRef}:${parsed.factsRef}`
      : `${parsed.outcome}:${parsed.contentRef}:${parsed.metadataRef}`;
    const entry = entries.get(key);
    if (!entry) throw new Error("MISSING_MEMORY_EVIDENCE");
    return entry.reloaded;
  };
  const writeHtml: Store["writePrivateKwHtmlEvidence"] = async (input) => {
    if (input.outcome !== "RAW_HTML_ALLOWED") throw new Error("memory fixture does not persist blocked evidence");
    return writeRaw(input);
  };
  const store: FixtureStore = {
    writePrivateKwHtmlEvidence: writeHtml,
    writePrivateKwDerivedFacts: writeDerived,
    reloadPrivateKwHtmlEvidenceReadOnly: reload,
  };
  return store;
}

function memoryReceiptStore() {
  const values = new Map<string, PrivateKwM2WebsiteEvidenceReceipt>();
  return {
    values,
    async loadSealed(operationId: string) { return values.get(operationId) ?? null; },
    async publishSealed(receipt: PrivateKwM2WebsiteEvidenceReceipt) {
      const existing = values.get(receipt.operationId);
      if (!existing) { values.set(receipt.operationId, receipt); return "CREATED" as const; }
      if (canonicalize(existing) !== canonicalize(receipt)) throw new Error("SEALED_RECEIPT_CONFLICT");
      return "EXACT_REPLAY" as const;
    },
  };
}

export async function createPrivateKwM2AssessmentFixture(options: { retention?: FixtureRetention; businessIndex?: number; now?: Date } = {}) {
  const retention = options.retention ?? "RAW_HTML_ALLOWED";
  const businessIndex = options.businessIndex ?? 0;
  if (!Number.isInteger(businessIndex) || businessIndex < 0 || businessIndex >= PRIVATE_KW_SHADOW_SLICE_SIZE) throw new Error("Fixture businessIndex is outside the approved ten-business slice.");
  const now = fixtureClock(options.now);
  const expiresAt = relativeIso(now, RETENTION_WINDOW_MS);
  const chain = approvedChain(now, retention);
  const request = {
    requestId: `00000000-0000-4000-8000-${String(businessIndex + 1).padStart(12, "0")}`,
    requestedAt: now.toISOString(),
    replayMode: "NEW" as const,
    businessId: chain.sourcePlan.records[businessIndex]!.business.id,
    researchPacket: chain.researchPacket,
    authorization: chain.authorization,
    ownerEnvelope: chain.ownerEnvelope,
    manifest: chain.manifest,
    sourcePlan: chain.sourcePlan,
    researchPolicy: chain.researchPolicy,
  };
  const receiptStore = memoryReceiptStore();
  const evidenceStore = memoryEvidenceStore();
  const receipt = await executePrivateKwM2HtmlEvidence(request, {
    transport: fakeTransport(now),
    store: evidenceStore,
    receiptStore,
    clock: () => new Date(now),
  });
  return { chain, request, receipt, receiptStore, evidenceStore, clock: () => new Date(now), now, expiresAt, evidenceRoot: PRIVATE_KW_EVIDENCE_ROOT };
}
