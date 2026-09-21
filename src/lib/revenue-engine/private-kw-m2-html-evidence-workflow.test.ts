import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { extractHtmlPageFacts } from "@/lib/revenue-engine/html-page-facts";
import { WEBSITE_CAPTURE_VERSION, type WebsiteCaptureResult } from "@/lib/revenue-engine/website-capture";
import { buildPrivateKwM2HtmlAuditReceipt, PrivateKwM2HtmlAuditReceiptSchema } from "@/lib/revenue-engine/private-kw-m2-html-audit";
import { createPrivateKwM2HtmlEvidenceReceiptStore, privateKwM2ReceiptCanonicalDigest } from "@/lib/revenue-engine/private-kw-m2-html-evidence-receipt";
import { createPrivateKwPublicHttpTransport } from "@/lib/revenue-engine/private-kw-public-http-transport";
import { createPrivateKwLocalHtmlEvidenceStore } from "@/lib/revenue-engine/private-kw-local-html-evidence-store";
import {
  buildPrivateKwM2ExecutionAuthorization,
  buildPrivateKwM2OwnerApprovalCandidate,
  buildPrivateKwM2ResearchPacket,
  buildPrivateKwM2ResearchPolicy,
  recordPrivateKwM2OwnerApproval,
  type ResearchPolicyDecisionInput,
} from "@/lib/revenue-engine/private-kw-m2-authorization";
import { preparePrivateKwImport, PRIVATE_KW_IMPORT_VERSION } from "@/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "@/lib/revenue-engine/private-kw-persistence-plan";
import { buildPrivateKwShadowSliceManifest, PRIVATE_KW_SHADOW_SLICE_SIZE, PRIVATE_KW_SHADOW_SLICE_VERSION } from "@/lib/revenue-engine/private-kw-shadow-slice";
import { executePrivateKwM2HtmlEvidence } from "@/lib/revenue-engine/private-kw-m2-html-evidence-workflow";

import {
  PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION,
  PrivateKwM2HtmlEvidenceRequestSchema,
  PrivateKwM2WebsiteEvidenceReceiptSchema,
} from "@/lib/revenue-engine/private-kw-m2-html-evidence-workflow";

test("exposes a strict HTML-only workflow request and receipt contract", () => {
  assert.equal(PRIVATE_KW_M2_HTML_EVIDENCE_WORKFLOW_VERSION, "kw-m2-html-evidence-workflow-v1");
  assert.throws(() => PrivateKwM2HtmlEvidenceRequestSchema.parse({}), /required|invalid/i);
  assert.equal(typeof PrivateKwM2WebsiteEvidenceReceiptSchema.parse, "function");
});

function captured(html: string, url = "https://synthetic-business.example/"): WebsiteCaptureResult {
  const rawBytes = new TextEncoder().encode(html);
  return {
    captureVersion: WEBSITE_CAPTURE_VERSION,
    policy: { maxRedirects: 5, maxResponseBytes: 1_048_576, timeoutMs: 10_000 },
    capturedAt: "2026-09-21T15:00:00.000Z",
    requestedUrl: url,
    finalUrl: url,
    statusCode: 200,
    redirectCount: 0,
    redirectChain: [url],
    outcome: "CAPTURED",
    contentType: "text/html",
    bodyBytes: rawBytes.byteLength,
    rawBytes,
    contentDigest: createHash("sha256").update(rawBytes).digest("hex"),
    html,
    failure: null,
  };
}

test("HTML-only projection discards contact and qualification material", async () => {
  const capture = captured(`<!doctype html><html><head><title>Local roof repair</title>
    <script type="application/ld+json">{"@type":"LocalBusiness"}</script></head><body>
    <h1>Roof repair in Kitchener</h1><a href="tel:+15195550123">Call us</a>
    <a href="mailto:owner@example.test">Email</a><form action="/contact"><input name="email"></form>
    <p>Five-star reviews and guaranteed results.</p></body></html>`);
  const facts = await extractHtmlPageFacts(capture, "HOME");
  const receipt = buildPrivateKwM2HtmlAuditReceipt({
    sourceIdentityDigest: "a".repeat(64), businessId: "business:one", businessName: "Synthetic Roofs",
    niche: "ROOFING", expectedServices: ["ROOFING"], expectedLocations: ["KITCHENER"],
    sourceEvidenceUrl: "https://directory.example/business-one", pages: [{ pageKind: "HOME", capture, facts }],
  });
  const serialized = JSON.stringify(receipt);
  assert.equal(receipt.assemblerKind, "HTML_ONLY");
  assert.equal(receipt.browserEvidencePresent, false);
  assert.equal(receipt.classification, undefined);
  assert.equal(receipt.rebuildNeedScore, undefined);
  assert.equal(receipt.evidenceConfidence, undefined);
  assert(receipt.availability?.checks.every((check) => check.conversionCritical === false));
  assert.equal(serialized.includes("+15195550123"), false);
  assert.equal(serialized.includes("owner@example.test"), false);
  assert.equal(serialized.includes("Five-star"), false);
  assert.throws(() => PrivateKwM2HtmlAuditReceiptSchema.parse({ ...receipt, classification: "REBUILD" }), /expected undefined|unrecognized/i);
});

test("sealed receipt store is content addressed, exclusive, and tamper rejecting", async () => {
  const operationId = "11111111-1111-5111-8111-111111111111";
  const file = path.join(process.cwd(), "data", "kw-evaluation", "m2-evidence", "sealed", "sha256", operationId.slice(0, 2), operationId + ".json");
  await rm(path.dirname(file), { recursive: true, force: true });
  try {
    const store = createPrivateKwM2HtmlEvidenceReceiptStore();
    const core = { operationId, status: "COMPLETE", pages: [] };
    const receipt = { ...core, operationDigest: privateKwM2ReceiptCanonicalDigest(core) };
    assert.equal(await store.loadSealed(receipt.operationId), null);
    assert.equal(await store.publishSealed(receipt), "CREATED");
    assert.deepEqual(await store.loadSealed(receipt.operationId), receipt);
    assert.equal(await store.publishSealed({ ...receipt }), "EXACT_REPLAY");
    await assert.rejects(store.publishSealed({ ...receipt, status: "FAILED" }), /SEALED_RECEIPT_CONFLICT|SEALED_RECEIPT_DIGEST_MISMATCH/);
    await assert.rejects(store.loadSealed("../escape"), /SEALED_RECEIPT_OPERATION_ID_INVALID/);
    await writeFile(file, JSON.stringify({ ...receipt, status: "FAILED" }) + "\n", "utf8");
    await assert.rejects(store.loadSealed(operationId), /SEALED_RECEIPT_DIGEST_MISMATCH|SEALED_RECEIPT_BYTES_MISMATCH/);
  } finally {
    await rm(path.dirname(file), { recursive: true, force: true });
  }
});

test("workflow request rejects unbounded CLI-shaped extras", () => {
  const valid = {
    requestId: "11111111-1111-4111-8111-111111111111",
    requestedAt: "2026-09-21T15:00:00.000Z",
    businessId: "business:one",
    researchPacket: {}, authorization: {}, ownerEnvelope: {}, manifest: {}, sourcePlan: {},
  };
  assert.throws(() => PrivateKwM2HtmlEvidenceRequestSchema.parse({ ...valid, sql: "SELECT 1" }), /unrecognized/i);
  assert.throws(() => PrivateKwM2HtmlEvidenceRequestSchema.parse({ ...valid, clock: "2020-01-01T00:00:00.000Z" }), /unrecognized/i);
  assert.throws(() => PrivateKwM2HtmlEvidenceRequestSchema.parse({ ...valid, websiteUrl: "https://attacker.example/" }), /unrecognized/i);
});

function approvedChain(networkRequestCap = 8) {
  const sourcePlan = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION, importId: "m2-task-4-test-source", adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic Task4 website evidence", filters: { synthetic: true }, capturedAt: "2026-09-01T15:00:00.000Z", costUsd: 0,
    records: Array.from({ length: PRIVATE_KW_SHADOW_SLICE_SIZE }, (_, index) => ({
      sourceOwnedId: `m2-task-4-${index + 1}`, sourceEvidenceUrl: `https://directory-${index + 1}.com/business-${index + 1}`,
      businessName: `Synthetic Business ${index + 1}`, city: (["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const)[index % 3], region: "ON" as const, country: "CA" as const,
      niche: (["ROOFING", "HVAC", "LANDSCAPING"] as const)[index % 3], websiteUrl: `https://business-${index + 1}.com/`, phone: null,
      addressLine: `${index + 1} Example Street`, postalCode: "N2G 1A1", independenceStatus: "INDEPENDENT" as const,
      capturedAt: "2026-09-01T14:00:00.000Z", sourcePayload: { synthetic: true },
    })),
  });
  const sourcePlanDigest = buildPrivateKwPersistencePlan(sourcePlan).sourcePlanDigest;
  const manifest = buildPrivateKwShadowSliceManifest(sourcePlan, {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION, sliceKey: "m2-task-4-test-slice", sourceImportId: sourcePlan.importId,
    sourcePlanDigest, createdAt: "2026-09-02T15:00:00.000Z", mode: "SHADOW",
    selections: sourcePlan.records.map((record) => ({ businessId: record.business.id, evaluationCandidateId: record.evaluationCandidateId, sourceReview: {
      decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE" as const, reviewedBy: "RILEY" as const, reviewedAt: "2026-09-02T14:00:00.000Z",
      rationale: "Synthetic identity and source chain reviewed.", identityConfirmed: true as const, marketAndNicheConfirmed: true as const, independenceConfirmed: true as const,
    }})),
    authority: { planOnly: true, liveSourceAuthorized: false, browserCaptureAuthorized: false, artifactStorageAuthorized: false, databaseMutationAuthorized: false,
      contactDiscoveryExecutionAuthorized: false, contactVerificationExecutionAuthorized: false, consentDecisionAuthorized: false, qualificationAuthorized: false,
      mailboxSyncAuthorized: false, outreachAuthorized: false, sendAuthorized: false, deploymentAuthorized: false, providerOperationsAuthorized: 0, costAuthorizedUsd: 0 },
  });
  const policyDecisions: ResearchPolicyDecisionInput[] = sourcePlan.records.map((record, index) => ({
    businessId: record.business.id, sourceRights: "PUBLIC_SOURCE_REVIEWED" as const, termsDecision: "TERMS_REVIEWED_FOR_FACTS" as const,
    robotsDecision: "ROBOTS_REVIEWED_PUBLIC_ONLY" as const, evidenceRetention: index === 0 ? "RAW_HTML_ALLOWED" : "DERIVED_FACTS_ONLY",
    retentionReviewDate: "2026-09-30T15:00:00.000Z", stopConditions: ["ROBOTS_OR_TERMS_UNCLEAR" as const],
  }));
  const researchPacket = buildPrivateKwM2ResearchPacket({ manifest, sourcePlan, reviewedAt: "2026-09-03T15:00:00.000Z", policyDecisions });
  const researchPolicy = buildPrivateKwM2ResearchPolicy({ manifest, reviewedAt: "2026-09-03T15:00:00.000Z", policyDecisions });
  const authorization = buildPrivateKwM2ExecutionAuthorization({ manifest, sourcePlan, researchPacket, researchPolicy, websitePolicy: { version: "kw-m2-website-policy-v1", networkRequestCap, expiresAt: "2026-09-30T15:00:00.000Z" } });
  const candidate = buildPrivateKwM2OwnerApprovalCandidate({ manifest, sourcePlan, researchPacket, authorization, researchPolicy });
  const ownerEnvelope = recordPrivateKwM2OwnerApproval(candidate, { approver: "RILEY", reviewedAt: "2026-09-04T15:00:00.000Z", expiresAt: "2026-09-30T15:00:00.000Z", rationale: "Approved synthetic bounded local review.", dedicatedConfirmation: true });
  return { sourcePlan, manifest, researchPacket, authorization, ownerEnvelope, researchPolicy };
}

function fakeTransport(onRequest: () => void) {
  return createPrivateKwPublicHttpTransport({
    resolveDns: async () => [{ address: "93.184.216.34", family: 4 as const }],
    executeConnection: async (request) => {
      onRequest();
      const url = new URL(request.url);
      const body = url.pathname === "/robots.txt"
        ? "User-agent: *\\nAllow: /\\n"
        : "<!doctype html><html><head><title>Roof repair</title></head><body><h1>Roof repair in Kitchener</h1><a href=\"/roofing\">Services</a><a href=\"/about\">About</a><a href=\"/contact\">Contact</a><a href=\"tel:+15195550123\">Call</a></body></html>";
      const bytes = new TextEncoder().encode(body);
      return { statusCode: 200, headers: { "content-type": url.pathname === "/robots.txt" ? "text/plain" : "text/html" }, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }), abort() {} };
    },
    now: () => new Date("2026-09-21T15:00:00.000Z"),
  });
}

function fakeEvidenceStore(writes: Array<{ requestedUrl: string; sourcePageUrl?: string }> = []) {
  type PersistedInput = Parameters<ReturnType<typeof createPrivateKwLocalHtmlEvidenceStore>["writePrivateKwHtmlEvidence"]>[0] | Parameters<ReturnType<typeof createPrivateKwLocalHtmlEvidenceStore>["writePrivateKwDerivedFacts"]>[0];
  const persisted: Array<{ outcome: "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY"; input: PersistedInput }> = [];
  const refs = (outcome: "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY") => outcome === "RAW_HTML_ALLOWED"
    ? { outcome, contentRef: "kw-html:sha256:" + "c".repeat(64), metadataRef: "kw-html-meta:sha256:" + "d".repeat(64), contentPath: "sealed/content.html", metadataPath: "sealed/metadata.json", executionPath: "CREATED" as const }
    : { outcome, contentRef: "kw-html:sha256:" + "c".repeat(64), metadataRef: "kw-html-meta:sha256:" + "d".repeat(64), factsRef: "kw-html-facts:sha256:" + "e".repeat(64), metadataPath: "sealed/metadata.json", factsPath: "sealed/facts.json", rawArtifactRef: null, executionPath: "CREATED" as const };
  return {
    writePrivateKwHtmlEvidence: async (input: Parameters<ReturnType<typeof createPrivateKwLocalHtmlEvidenceStore>["writePrivateKwHtmlEvidence"]>[0]) => { writes.push({ requestedUrl: input.requestedUrl, sourcePageUrl: input.sourcePageUrl }); return input.outcome === "BLOCKED"
      ? { outcome: "BLOCKED" as const, receiptRef: "kw-html-receipt:sha256:" + "f".repeat(64), receiptPath: "sealed/blocked.json", blockCode: input.blockCode, executionPath: "CREATED" as const }
      : (persisted.push({ outcome: "RAW_HTML_ALLOWED", input }), refs("RAW_HTML_ALLOWED")); },
    writePrivateKwDerivedFacts: async (input: Parameters<ReturnType<typeof createPrivateKwLocalHtmlEvidenceStore>["writePrivateKwDerivedFacts"]>[0]) => { writes.push({ requestedUrl: input.requestedUrl, sourcePageUrl: input.sourcePageUrl }); persisted.push({ outcome: "DERIVED_FACTS_ONLY", input }); return refs("DERIVED_FACTS_ONLY"); },
    reloadPrivateKwHtmlEvidence: async (reference: unknown) => {
      void reference;
      const entry = persisted.shift()!;
      const bytes = entry.outcome === "RAW_HTML_ALLOWED" ? Buffer.from((entry.input as Extract<PersistedInput, { outcome: "RAW_HTML_ALLOWED" }>).bytes) : Buffer.from((entry.input as Extract<PersistedInput, { outcome: "DERIVED_FACTS_ONLY" }>).captureBytes);
      const contentDigest = createHash("sha256").update(bytes).digest("hex");
      const metadata = { ...entry.input, metadataVersion: "private-kw-html-metadata-v1", contentRef: "kw-html:sha256:" + contentDigest, contentByteLength: bytes.byteLength, contentType: "text/html", rightsDecision: "ALLOWED", termsDecision: "REVIEWED", robotsDecision: "ALLOWED", retentionDecision: entry.outcome, legalHold: false, metadataRef: "kw-html-meta:sha256:" + "d".repeat(64) };
      return entry.outcome === "RAW_HTML_ALLOWED" ? { outcome: entry.outcome, bytes, metadata } as never : { outcome: entry.outcome, facts: { factsVersion: "private-kw-html-facts-v1", contentRef: metadata.contentRef, metadataRef: metadata.metadataRef, rawArtifactRef: null, facts: (entry.input as Extract<PersistedInput, { outcome: "DERIVED_FACTS_ONLY" }>).facts, factsRef: "kw-html-facts:sha256:" + "e".repeat(64) }, metadata } as never;
    },
  };
}

function memoryReceiptStore() {
  const values = new Map<string, unknown>();
  return {
    values,
    async loadSealed(operationId: string) { return values.get(operationId) ?? null; },
    async publishSealed(receipt: unknown) {
      const operationId = (receipt as { operationId: string }).operationId;
      const existing = values.get(operationId);
      if (!existing) { values.set(operationId, receipt); return "CREATED" as const; }
      if (JSON.stringify(existing) !== JSON.stringify(receipt)) throw new Error("SEALED_RECEIPT_CONFLICT");
      return "EXACT_REPLAY" as const;
    },
  };
}

test("fresh workflow seals a bounded local receipt and exact replay performs zero requests", async () => {
  const chain = approvedChain();
  const receiptStore = memoryReceiptStore();
  const writes: Array<{ requestedUrl: string; sourcePageUrl?: string }> = [];
  const evidenceStore = fakeEvidenceStore(writes);
  let requests = 0;
  const request = { requestId: "22222222-2222-4222-8222-222222222222", requestedAt: "2026-09-21T15:00:00.000Z", businessId: chain.sourcePlan.records[0]!.business.id,
      researchPacket: chain.researchPacket, authorization: chain.authorization, ownerEnvelope: chain.ownerEnvelope, manifest: chain.manifest, sourcePlan: chain.sourcePlan, researchPolicy: chain.researchPolicy };
    const fresh = await executePrivateKwM2HtmlEvidence(request, { transport: fakeTransport(() => { requests += 1; }), store: evidenceStore, receiptStore, clock: () => new Date("2026-09-21T15:00:00.000Z") });
    assert.equal(fresh.status, "COMPLETE");
    assert(fresh.networkRequestCount >= 2);
    assert(fresh.pages.filter((page) => page.outcome === "CAPTURED").every((page) => page.storageOutcome === "RAW_HTML_ALLOWED"));
    assert.equal(JSON.stringify(fresh).includes("NOT_PERSISTED_SUBPAGE"), false);
    assert.deepEqual(writes.map((write) => write.requestedUrl), fresh.pages.filter((page) => page.outcome === "CAPTURED").map((page) => page.requestedUrl));
    assert(writes.every((write) => write.sourcePageUrl === chain.sourcePlan.records[0]!.sourceRecord.websiteUrl));
    assert.equal(fresh.providerOperations, 0);
    assert.equal(fresh.costAuthorizedUsd, 0);
    assert.equal(fresh.sourcePolicy?.robotsUrl, "https://business-1.com/robots.txt");
    assert.equal(fresh.sourcePolicy?.networkRequestCount, fresh.sourcePolicy?.transportReceiptIds.length);
    assert.equal(fresh.sourcePolicy?.transportReceiptDigests.length, fresh.sourcePolicy?.transportReceiptIds.length);
    assert.equal(fresh.sourcePolicy?.providerOperationsAuthorized, 0);
    assert.equal(fresh.sourcePolicy?.costAuthorizedUsd, 0);
    assert(fresh.pages.every((page) => !JSON.stringify(page).match(/tel:|mailto:|@/i)));
    const beforeReplay = requests;
    const replay = await executePrivateKwM2HtmlEvidence({ ...request, replayMode: "EXACT_REPLAY" }, { transport: fakeTransport(() => { requests += 1; }), store: evidenceStore, receiptStore, clock: () => new Date("2026-09-21T15:00:00.000Z") });
    assert.deepEqual(replay, fresh);
    assert.equal(requests, beforeReplay);
    const tamperedPolicy = structuredClone(fresh) as unknown as { sourcePolicy: { reason: string }; operationDigest?: string } & Record<string, unknown>;
    tamperedPolicy.sourcePolicy.reason = "schema-valid but untrusted replacement";
    const tamperedCore = { ...tamperedPolicy };
    delete tamperedCore.operationDigest;
    tamperedPolicy.operationDigest = privateKwM2ReceiptCanonicalDigest(tamperedCore);
    receiptStore.values.set(fresh.operationId, tamperedPolicy);
    const rejectedPolicy = await executePrivateKwM2HtmlEvidence({ ...request, replayMode: "EXACT_REPLAY" }, { transport: fakeTransport(() => { requests += 1; }), store: evidenceStore, receiptStore, clock: () => new Date("2026-09-21T15:00:00.000Z") });
    assert.equal(rejectedPolicy.status, "FAILED");
    assert.equal(rejectedPolicy.stopReason, "REPLAY_MISMATCH");
    assert.equal(requests, beforeReplay);
    receiptStore.values.set(fresh.operationId, fresh);
    const expiredReplay = await executePrivateKwM2HtmlEvidence({ ...request, replayMode: "EXACT_REPLAY" }, { transport: fakeTransport(() => { requests += 1; }), store: evidenceStore, receiptStore, clock: () => new Date("2026-10-01T15:00:00.000Z") });
    assert.equal(expiredReplay.status, "FAILED");
    assert.equal(expiredReplay.stopReason, "AUTHORIZATION_EXPIRED");
    assert.equal(requests, beforeReplay);
    const tampered = receiptStore.values.get(fresh.operationId) as Record<string, unknown>;
    tampered.operationDigest = "a".repeat(64);
    const rejected = await executePrivateKwM2HtmlEvidence({ ...request, replayMode: "EXACT_REPLAY" }, { transport: fakeTransport(() => { requests += 1; }), store: fakeEvidenceStore(), receiptStore, clock: () => new Date("2026-09-21T15:00:00.000Z") });
    assert.equal(rejected.status, "FAILED");
    assert.equal(rejected.stopReason, "REPLAY_MISMATCH");
    assert.equal(requests, beforeReplay);
});

test("exact replay fails closed when the sealed receipt is missing and the shared cap stops nested requests", async () => {
  const chain = approvedChain(1);
  const receiptStore = memoryReceiptStore();
  let requests = 0;
  const request = { requestId: "33333333-3333-4333-8333-333333333333", requestedAt: "2026-09-21T15:00:00.000Z", businessId: chain.sourcePlan.records[0]!.business.id,
      researchPacket: chain.researchPacket, authorization: chain.authorization, ownerEnvelope: chain.ownerEnvelope, manifest: chain.manifest, sourcePlan: chain.sourcePlan, researchPolicy: chain.researchPolicy, replayMode: "EXACT_REPLAY" as const };
    const missing = await executePrivateKwM2HtmlEvidence(request, { receiptStore, store: fakeEvidenceStore(), transport: fakeTransport(() => { requests += 1; }), clock: () => new Date("2026-09-21T15:00:00.000Z") });
    assert.equal(missing.status, "FAILED");
    assert.equal(missing.stopReason, "REPLAY_MISSING");
    assert.equal(requests, 0);
    const fresh = await executePrivateKwM2HtmlEvidence({ ...request, replayMode: "NEW" }, { receiptStore, store: fakeEvidenceStore(), transport: fakeTransport(() => { requests += 1; }), clock: () => new Date("2026-09-21T15:00:00.000Z") });
    assert.equal(fresh.status, "FAILED");
    assert.match(fresh.stopReason ?? "", /HOMEPAGE_CAPTURE_FAILED|CAP/);
    assert.equal(fresh.networkRequestCount, 1);
    assert.equal(requests, 1);
});

test("expiry after a selected-page body returns in-memory failure without later storage or sealing", async () => {
  const chain = approvedChain();
  const receiptStore = memoryReceiptStore();
  const store = fakeEvidenceStore();
  let now = new Date("2026-09-21T15:00:00.000Z");
  let requests = 0;
  const request = { requestId: "44444444-4444-4444-8444-444444444444", requestedAt: "2026-09-21T15:00:00.000Z", businessId: chain.sourcePlan.records[0]!.business.id,
    researchPacket: chain.researchPacket, authorization: chain.authorization, ownerEnvelope: chain.ownerEnvelope, manifest: chain.manifest, sourcePlan: chain.sourcePlan, researchPolicy: chain.researchPolicy };
  const result = await executePrivateKwM2HtmlEvidence(request, {
    receiptStore, store, clock: () => now,
    transport: fakeTransport(() => { requests += 1; if (requests === 3) now = new Date("2026-10-01T00:00:00.000Z"); }),
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.stopReason, "AUTHORIZATION_EXPIRED");
  assert.equal(requests, 3);
  assert.equal(receiptStore.values.size, 0);
});

test("transport ledger rejects a duplicate receipt instead of laundering the global count", async () => {
  const chain = approvedChain();
  const base = fakeTransport(() => {});
  const take = base.takeReceipts;
  base.takeReceipts = () => {
    const receipts = take();
    const last = receipts.at(-1);
    return last ? [...receipts, last] : receipts;
  };
  const request = { requestId: "55555555-5555-4555-8555-555555555555", requestedAt: "2026-09-21T15:00:00.000Z", businessId: chain.sourcePlan.records[0]!.business.id,
    researchPacket: chain.researchPacket, authorization: chain.authorization, ownerEnvelope: chain.ownerEnvelope, manifest: chain.manifest, sourcePlan: chain.sourcePlan, researchPolicy: chain.researchPolicy };
  await assert.rejects(executePrivateKwM2HtmlEvidence(request, { transport: base, store: fakeEvidenceStore(), receiptStore: memoryReceiptStore(), clock: () => new Date("2026-09-21T15:00:00.000Z") }), /TRANSPORT_RECEIPT_RECONCILIATION_FAILED|TRANSPORT_LEDGER_COUNT_MISMATCH/);
});
