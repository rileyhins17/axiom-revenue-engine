import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractHtmlPageFacts } from "@/lib/revenue-engine/html-page-facts";
import { WEBSITE_CAPTURE_VERSION, type WebsiteCaptureResult } from "@/lib/revenue-engine/website-capture";
import { buildPrivateKwM2HtmlAuditReceipt, PrivateKwM2HtmlAuditReceiptSchema } from "@/lib/revenue-engine/private-kw-m2-html-audit";
import { createPrivateKwM2HtmlEvidenceReceiptStore } from "@/lib/revenue-engine/private-kw-m2-html-evidence-receipt";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "kw-m2-receipt-"));
  try {
    const store = createPrivateKwM2HtmlEvidenceReceiptStore({ rootPath: root });
    const receipt = { operationId: "11111111-1111-4111-8111-111111111111", status: "COMPLETE", pages: [] };
    assert.equal(await store.loadSealed(receipt.operationId), null);
    assert.equal(await store.publishSealed(receipt), "CREATED");
    assert.deepEqual(await store.loadSealed(receipt.operationId), receipt);
    assert.equal(await store.publishSealed({ ...receipt }), "EXACT_REPLAY");
    await assert.rejects(store.publishSealed({ ...receipt, status: "FAILED" }), /SEALED_RECEIPT_CONFLICT/);
  } finally {
    await rm(root, { recursive: true, force: true });
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

function fakeEvidenceStore() {
  const refs = (outcome: "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY") => outcome === "RAW_HTML_ALLOWED"
    ? { outcome, contentRef: "kw-html:sha256:" + "c".repeat(64), metadataRef: "kw-html-meta:sha256:" + "d".repeat(64), contentPath: "sealed/content.html", metadataPath: "sealed/metadata.json", executionPath: "CREATED" as const }
    : { outcome, contentRef: "kw-html:sha256:" + "c".repeat(64), metadataRef: "kw-html-meta:sha256:" + "d".repeat(64), factsRef: "kw-html-facts:sha256:" + "e".repeat(64), metadataPath: "sealed/metadata.json", factsPath: "sealed/facts.json", rawArtifactRef: null, executionPath: "CREATED" as const };
  return {
    writePrivateKwHtmlEvidence: async (input: Parameters<ReturnType<typeof createPrivateKwLocalHtmlEvidenceStore>["writePrivateKwHtmlEvidence"]>[0]) => input.outcome === "BLOCKED"
      ? { outcome: "BLOCKED" as const, receiptRef: "kw-html-receipt:sha256:" + "f".repeat(64), receiptPath: "sealed/blocked.json", blockCode: input.blockCode, executionPath: "CREATED" as const }
      : refs("RAW_HTML_ALLOWED"),
    writePrivateKwDerivedFacts: async (input: Parameters<ReturnType<typeof createPrivateKwLocalHtmlEvidenceStore>["writePrivateKwDerivedFacts"]>[0]) => { void input; return refs("DERIVED_FACTS_ONLY"); },
  };
}

test("fresh workflow seals a bounded local receipt and exact replay performs zero requests", async () => {
  const chain = approvedChain();
  const root = await mkdtemp(path.join(os.tmpdir(), "kw-m2-workflow-"));
  let requests = 0;
  try {
    const request = { requestId: "22222222-2222-4222-8222-222222222222", requestedAt: "2026-09-21T15:00:00.000Z", businessId: chain.sourcePlan.records[0]!.business.id,
      researchPacket: chain.researchPacket, authorization: chain.authorization, ownerEnvelope: chain.ownerEnvelope, manifest: chain.manifest, sourcePlan: chain.sourcePlan, researchPolicy: chain.researchPolicy };
    const fresh = await executePrivateKwM2HtmlEvidence(request, { transport: fakeTransport(() => { requests += 1; }), store: fakeEvidenceStore(), rootPath: root, clock: () => new Date("2026-09-21T15:00:00.000Z") });
    assert.equal(fresh.status, "COMPLETE");
    assert(fresh.networkRequestCount >= 2);
    assert(fresh.pages.filter((page) => page.outcome === "CAPTURED").every((page) => page.storageOutcome === "RAW_HTML_ALLOWED"));
    assert.equal(JSON.stringify(fresh).includes("NOT_PERSISTED_SUBPAGE"), false);
    assert.equal(fresh.providerOperations, 0);
    assert.equal(fresh.costAuthorizedUsd, 0);
    assert(fresh.pages.every((page) => !JSON.stringify(page).match(/tel:|mailto:|@/i)));
    const beforeReplay = requests;
    const replay = await executePrivateKwM2HtmlEvidence({ ...request, replayMode: "EXACT_REPLAY" }, { transport: fakeTransport(() => { requests += 1; }), rootPath: root, clock: () => new Date("2026-09-21T15:00:00.000Z") });
    assert.deepEqual(replay, fresh);
    assert.equal(requests, beforeReplay);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exact replay fails closed when the sealed receipt is missing and the shared cap stops nested requests", async () => {
  const chain = approvedChain(1);
  const root = await mkdtemp(path.join(os.tmpdir(), "kw-m2-replay-"));
  let requests = 0;
  try {
    const request = { requestId: "33333333-3333-4333-8333-333333333333", requestedAt: "2026-09-21T15:00:00.000Z", businessId: chain.sourcePlan.records[0]!.business.id,
      researchPacket: chain.researchPacket, authorization: chain.authorization, ownerEnvelope: chain.ownerEnvelope, manifest: chain.manifest, sourcePlan: chain.sourcePlan, researchPolicy: chain.researchPolicy, replayMode: "EXACT_REPLAY" as const };
    const missing = await executePrivateKwM2HtmlEvidence(request, { rootPath: root, transport: fakeTransport(() => { requests += 1; }), clock: () => new Date("2026-09-21T15:00:00.000Z") });
    assert.equal(missing.status, "FAILED");
    assert.equal(missing.stopReason, "REPLAY_MISSING");
    assert.equal(requests, 0);
    const fresh = await executePrivateKwM2HtmlEvidence({ ...request, replayMode: "NEW" }, { rootPath: root, store: fakeEvidenceStore(), transport: fakeTransport(() => { requests += 1; }), clock: () => new Date("2026-09-21T15:00:00.000Z") });
    assert.equal(fresh.status, "FAILED");
    assert.match(fresh.stopReason ?? "", /HOMEPAGE_CAPTURE_FAILED|CAP/);
    assert.equal(fresh.networkRequestCount, 1);
    assert.equal(requests, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
