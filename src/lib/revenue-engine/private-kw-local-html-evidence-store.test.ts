import { createHash } from "node:crypto";
import { lstat, link, readFile, readdir, rename, symlink, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  PRIVATE_KW_EVIDENCE_ROOT,
  createPrivateKwLocalHtmlEvidenceStore,
  type PrivateKwEvidenceMetadataInput,
} from "./private-kw-local-html-evidence-store";
import { preparePrivateKwImport, PRIVATE_KW_IMPORT_VERSION } from "./private-kw-import";
import { buildPrivateKwPersistencePlan } from "./private-kw-persistence-plan";
import { buildPrivateKwShadowSliceManifest, PRIVATE_KW_SHADOW_SLICE_VERSION, PRIVATE_KW_SHADOW_SLICE_SIZE } from "./private-kw-shadow-slice";
import {
  buildPrivateKwM2ExecutionAuthorization,
  buildPrivateKwM2OwnerApprovalCandidate,
  buildPrivateKwM2ResearchPolicy,
  buildPrivateKwM2ResearchPacket,
  privateKwM2Digest,
  PrivateKwM2ExecutionAuthorizationSchema,
  recordPrivateKwM2OwnerApproval,
  type PrivateKwM2ExecutionAuthorization,
} from "./private-kw-m2-authorization";
import { privateKwPublicHttpTransportReceiptDigest } from "./private-kw-public-http-transport";

const HTML = Buffer.from("<!doctype html><html><title>Roofing</title><body>public facts</body></html>");
const NOW = "2026-09-21T12:00:00.000Z";
const PARENT = "a".repeat(64);

const AUTHORITY = {
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
} as const;

function authorizationFor(retention: "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY" | "BLOCKED"): PrivateKwM2ExecutionAuthorization {
  const businessIds = ["business:kw-roof-001", ...Array.from({ length: 9 }, (_, index) => `business:kw-other-${index + 1}`)];
  const core = {
    authorizationVersion: "kw-m2-execution-authorization-v1" as const,
    status: "PENDING" as const,
    researchPacketId: `kw-m2-research:${"1".repeat(64)}`,
    researchPacketDigest: "2".repeat(64),
    manifestId: `kw-shadow-slice:${"3".repeat(64)}`,
    manifestDigest: "4".repeat(64),
    sourcePlanDigest: "5".repeat(64),
    websitePolicyVersion: "source-policy-v1",
    transportPolicyVersion: "kw-m2-address-pinned-node-v1",
    createdAt: "2026-09-20T12:00:00.000Z",
    expiresAt: "2026-09-22T12:00:00.000Z",
    networkRequestCap: 10,
    businessIds,
    sourceDecisions: businessIds.map((businessId, index) => ({
      businessId,
      websiteUrl: `https://example${index === 0 ? "" : `-${index}`}.test/`,
      sourceRights: "PUBLIC_SOURCE_REVIEWED" as const,
      termsDecision: index === 0 && retention === "RAW_HTML_ALLOWED" ? "TERMS_REVIEWED_FOR_FACTS" as const : "PUBLIC_REVIEW_ONLY" as const,
      robotsDecision: index === 0 && retention === "RAW_HTML_ALLOWED" ? "ROBOTS_REVIEWED_PUBLIC_ONLY" as const : "PREFLIGHT_REQUIRED_BEFORE_FETCH" as const,
      evidenceRetention: index === 0 ? retention : "DERIVED_FACTS_ONLY" as const,
      stopConditions: ["ROBOTS_OR_TERMS_UNCLEAR"],
    })),
    authority: AUTHORITY,
  };
  const digest = privateKwM2Digest(core);
  return PrivateKwM2ExecutionAuthorizationSchema.parse({ ...core, authorizationId: `kw-m2-execution:${digest}`, authorizationDigest: digest });
}

function canonicalChain(retention: "RAW_HTML_ALLOWED" | "DERIVED_FACTS_ONLY" | "BLOCKED") {
  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: "m2-task-3-canonical-source",
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic M2 evidence-store authorization",
    filters: { synthetic: true },
    capturedAt: "2026-09-01T15:00:00.000Z",
    costUsd: 0,
    records: Array.from({ length: PRIVATE_KW_SHADOW_SLICE_SIZE }, (_, index) => ({
      sourceOwnedId: `m2-task-3-${index + 1}`,
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
      capturedAt: "2026-09-01T14:00:00.000Z",
      sourcePayload: { synthetic: true },
    })),
  });
  const sourcePlanDigest = buildPrivateKwPersistencePlan(source).sourcePlanDigest;
  const manifest = buildPrivateKwShadowSliceManifest(source, {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION,
    sliceKey: "m2-task-3-canonical-slice",
    sourceImportId: source.importId,
    sourcePlanDigest,
    createdAt: "2026-09-02T15:00:00.000Z",
    selections: source.records.map((record) => ({
      businessId: record.business.id,
      evaluationCandidateId: record.evaluationCandidateId,
      sourceReview: {
        decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE" as const,
        reviewedBy: "RILEY" as const,
        reviewedAt: "2026-09-02T14:00:00.000Z",
        rationale: "Synthetic identity, market, niche, and independence were checked.",
        identityConfirmed: true as const,
        marketAndNicheConfirmed: true as const,
        independenceConfirmed: true as const,
      },
    })),
    mode: "SHADOW" as const,
    authority: {
      planOnly: true as const,
      liveSourceAuthorized: false as const,
      browserCaptureAuthorized: false as const,
      artifactStorageAuthorized: false as const,
      databaseMutationAuthorized: false as const,
      contactDiscoveryExecutionAuthorized: false as const,
      contactVerificationExecutionAuthorized: false as const,
      consentDecisionAuthorized: false as const,
      qualificationAuthorized: false as const,
      mailboxSyncAuthorized: false as const,
      outreachAuthorized: false as const,
      sendAuthorized: false as const,
      deploymentAuthorized: false as const,
      providerOperationsAuthorized: 0 as const,
      costAuthorizedUsd: 0 as const,
    },
  });
  const policyDecisions = source.records.map((record, index) => ({
    businessId: record.business.id,
    sourceRights: index === 0 && retention === "RAW_HTML_ALLOWED" ? "PUBLIC_SOURCE_REVIEWED" as const : "PUBLIC_SOURCE_DERIVED" as const,
    termsDecision: index === 0 && retention === "RAW_HTML_ALLOWED" ? "TERMS_REVIEWED_FOR_FACTS" as const : "PUBLIC_REVIEW_ONLY" as const,
    robotsDecision: index === 0 && retention === "RAW_HTML_ALLOWED" ? "ROBOTS_REVIEWED_PUBLIC_ONLY" as const : "PREFLIGHT_REQUIRED_BEFORE_FETCH" as const,
    evidenceRetention: index === 0 ? retention : "DERIVED_FACTS_ONLY" as const,
    retentionReviewDate: "2026-09-30T15:00:00.000Z",
    stopConditions: ["ROBOTS_OR_TERMS_UNCLEAR" as const],
  }));
  const researchPacket = buildPrivateKwM2ResearchPacket({ manifest, sourcePlan: source, reviewedAt: "2026-09-03T15:00:00.000Z", policyDecisions });
  const researchPolicy = buildPrivateKwM2ResearchPolicy({ manifest, reviewedAt: "2026-09-03T15:00:00.000Z", policyDecisions });
  const authorization = buildPrivateKwM2ExecutionAuthorization({ researchPacket, manifest, sourcePlan: source, researchPolicy, websitePolicy: { version: "kw-m2-website-policy-v1", networkRequestCap: 20, expiresAt: "2026-09-30T15:00:00.000Z" } });
  const candidate = buildPrivateKwM2OwnerApprovalCandidate({ researchPacket, authorization, manifest, sourcePlan: source, researchPolicy });
  const ownerEnvelope = recordPrivateKwM2OwnerApproval(candidate, { approver: "RILEY", reviewedAt: "2026-09-04T15:00:00.000Z", expiresAt: "2026-09-30T15:00:00.000Z", rationale: "Reviewed the exact canonical M2 packet and bounded local route.", dedicatedConfirmation: true });
  return { researchPacket, authorization, ownerEnvelope, manifest, sourcePlan: source, researchPolicy };
}

function sourcePolicyProof(url: string, termsDecision: "PUBLIC_REVIEW_ONLY" | "TERMS_REVIEWED_FOR_FACTS") {
  const robotsUrl = new URL("/robots.txt", url).toString();
  const receiptCore = {
    transportVersion: "kw-m2-public-transport-v1" as const,
    requestId: 1,
    normalizedUrl: robotsUrl,
    method: "GET" as const,
    hostname: new URL(robotsUrl).hostname,
    selectedAddress: "93.184.216.34",
    selectedFamily: 4 as const,
    addressClass: "PUBLIC",
    statusCode: 200,
    startedAt: "2026-09-04T16:00:00.000Z",
    completedAt: "2026-09-04T16:00:01.000Z",
    socketOpened: true,
    networkRequestCount: 1 as const,
    acceptedAddressesDigest: "a".repeat(64),
  };
  const receiptDigest = privateKwPublicHttpTransportReceiptDigest({ ...receiptCore, receiptDigest: "0".repeat(64) });
  const receipt = { ...receiptCore, receiptDigest };
  return {
    sourcePolicyDecision: {
      policyVersion: "kw-m2-source-policy-v1" as const,
      robotsUrl,
      httpStatus: 200,
      contentDigest: "b".repeat(64),
      matchedGroup: "*",
      matchedRule: null,
      allowed: true,
      crawlDelaySeconds: null,
      nextAllowedAt: null,
      termsDecision,
      reason: "robots allows crawl; terms decision reviewed",
      transportReceiptIds: [1],
      transportReceiptDigests: [receiptDigest],
      networkRequestCount: 1,
      providerOperationsAuthorized: 0 as const,
      costAuthorizedUsd: 0 as const,
    },
    transportReceipts: [receipt],
  };
}

function baseMetadata(overrides: Partial<PrivateKwEvidenceMetadataInput> = {}): PrivateKwEvidenceMetadataInput {
  const retention = overrides.retentionDecision ?? "DERIVED_FACTS_ONLY";
  const chain = canonicalChain(retention);
  const authorization = chain.authorization;
  const requestedUrl = authorization.sourceDecisions[0]!.websiteUrl!;
  const proof: Pick<PrivateKwEvidenceMetadataInput, "sourcePolicyDecision" | "transportReceipts"> = retention === "RAW_HTML_ALLOWED"
    ? sourcePolicyProof(requestedUrl, authorization.sourceDecisions[0]!.termsDecision)
    : {};
  const merged = {
    businessId: authorization.businessIds[0]!,
    sourceId: "source:direct-site-001",
    requestedUrl,
    finalUrl: requestedUrl,
    redirectChainDigest: "b".repeat(64),
    captureVersion: "html-capture-v1",
    transportVersion: "public-http-v1",
    sourcePolicyVersion: proof.sourcePolicyDecision?.policyVersion ?? "kw-m2-source-policy-v1",
    capturedAt: NOW,
    parentReceiptDigest: PARENT,
    ...proof,
    ...overrides,
  } as PrivateKwEvidenceMetadataInput;
  return {
    ...merged,
    authorizationDigest: authorization.authorizationDigest,
    authorizationExpiresAt: authorization.expiresAt,
    authorizationChain: chain,
  };
}

function facts() {
  return {
    pageTitle: "Roofing services",
    canonicalUrl: "https://business-1.com/",
    serviceObservations: ["roof repair"],
    locationObservations: ["Kitchener"],
    claimIds: ["claim:service-1"],
    limitations: ["HTML-only; browser claims unknown"],
    confidence: "MEDIUM" as const,
  };
}

async function cleanRoot() {
  await rm(PRIVATE_KW_EVIDENCE_ROOT, { recursive: true, force: true });
}

async function snapshot() {
  return (await readdir(PRIVATE_KW_EVIDENCE_ROOT, { recursive: true })).sort();
}

async function allStoredText() {
  const names = await readdir(PRIVATE_KW_EVIDENCE_ROOT, { recursive: true });
  const values: string[] = [];
  for (const name of names) {
    const full = path.join(PRIVATE_KW_EVIDENCE_ROOT, name);
    if ((await lstat(full)).isFile()) values.push(await readFile(full, "utf8"));
  }
  return values;
}

test.beforeEach(cleanRoot);
test.afterEach(cleanRoot);

test("writes and reloads raw HTML with content and metadata identities", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const result = await store.writePrivateKwHtmlEvidence({
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED",
    contentType: "text/html",
    bytes: HTML,
  });

  assert.equal(result.outcome, "RAW_HTML_ALLOWED");
  assert.equal(result.executionPath, "CREATED");
  assert.match(result.contentRef, /^kw-html:sha256:[a-f0-9]{64}$/);
  assert.match(result.metadataRef, /^kw-html-meta:sha256:[a-f0-9]{64}$/);
  const reloaded = await store.reloadPrivateKwHtmlEvidence(result);
  assert.equal(reloaded.outcome, "RAW_HTML_ALLOWED");
  assert.deepEqual(reloaded.bytes, HTML);
  assert.equal(reloaded.metadata.contentType, "text/html");
});

test("same complete raw parent replays exactly without changing files", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const input = {
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED" as const,
    contentType: "text/html" as const,
    bytes: HTML,
  };
  const first = await store.writePrivateKwHtmlEvidence(input);
  const before = await snapshot();
  const replay = await createPrivateKwLocalHtmlEvidenceStore().writePrivateKwHtmlEvidence(input);
  const after = await snapshot();
  assert.equal(replay.executionPath, "EXACT_REPLAY");
  assert.deepEqual(replay, { ...first, executionPath: "EXACT_REPLAY" });
  assert.deepEqual(after, before);
});

test("does not repair a raw content object left without its metadata pair", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const input = {
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED" as const,
    contentType: "text/html" as const,
    bytes: HTML,
  };
  const first = await store.writePrivateKwHtmlEvidence(input);
  if (first.outcome !== "RAW_HTML_ALLOWED") throw new Error("Expected raw evidence ref.");
  await rm(first.metadataPath);
  await assert.rejects(store.writePrivateKwHtmlEvidence(input), /INCOMPLETE_EXISTING|metadata/i);
});

test("does not repair a raw metadata object left without its content pair", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const input = {
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED" as const,
    contentType: "text/html" as const,
    bytes: HTML,
  };
  const first = await store.writePrivateKwHtmlEvidence(input);
  if (first.outcome !== "RAW_HTML_ALLOWED") throw new Error("Expected raw evidence ref.");
  await rm(first.contentPath);
  await assert.rejects(store.writePrivateKwHtmlEvidence(input), /INCOMPLETE_EXISTING|content/i);
  await assert.rejects(store.reloadPrivateKwHtmlEvidence(first), /ENOENT|content|object/i);
});

test("requires the exact authorized retention decision and authorization identity", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const factsOnlyChain = canonicalChain("DERIVED_FACTS_ONLY");
  const raw = {
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED" as const,
    contentType: "text/html" as const,
    bytes: HTML,
    authorizationChain: factsOnlyChain,
    authorizationDigest: factsOnlyChain.authorization.authorizationDigest,
    authorizationExpiresAt: factsOnlyChain.authorization.expiresAt,
  };
  await assert.rejects(store.writePrivateKwHtmlEvidence(raw), /retention|authorized/i);
  const rawChain = canonicalChain("RAW_HTML_ALLOWED");
  await assert.rejects(store.writePrivateKwHtmlEvidence({ ...raw, authorizationChain: rawChain, authorizationDigest: "d".repeat(64), authorizationExpiresAt: rawChain.authorization.expiresAt }), /identity|authorization/i);
  const selfAsserted = authorizationFor("RAW_HTML_ALLOWED");
  await assert.rejects(store.writePrivateKwHtmlEvidence({
    ...raw,
    authorizationChain: { ...rawChain, authorization: selfAsserted },
    authorizationDigest: selfAsserted.authorizationDigest,
    authorizationExpiresAt: selfAsserted.expiresAt,
  }), /exact|authorization|owner|packet/i);
});

test("raw storage accepts only the exact copied Task2 policy and receipt chain", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const valid = {
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED" as const,
    contentType: "text/html" as const,
    bytes: HTML,
  };
  const policy = valid.sourcePolicyDecision!;
  await assert.rejects(store.writePrivateKwHtmlEvidence({
    ...valid,
    sourcePolicyDecision: { ...policy, policyVersion: "kw-m2-source-policy-v2" } as never,
  }), /policy|source/i);
  const receipt = valid.transportReceipts![0]!;
  await assert.rejects(store.writePrivateKwHtmlEvidence({
    ...valid,
    transportReceipts: [{ ...receipt, receiptDigest: "c".repeat(64) }],
  }), /receipt|transport|chain/i);
  await assert.rejects(store.writePrivateKwHtmlEvidence({ ...valid, rightsDecision: "ALLOWED" } as never), /unrecognized|unknown|strict/i);
  await store.writePrivateKwHtmlEvidence(valid);
});

test("rejects malformed metadata and leaves temp residue untouched", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const result = await store.writePrivateKwHtmlEvidence({
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED",
    contentType: "text/html",
    bytes: HTML,
  });
  if (result.outcome !== "RAW_HTML_ALLOWED") throw new Error("Expected raw evidence ref.");
  const temp = path.join(path.dirname(result.contentPath), ".tmp-crash.part");
  await writeFile(temp, Buffer.from("partial"));
  await writeFile(result.metadataPath, Buffer.from("{}"));
  await assert.rejects(store.reloadPrivateKwHtmlEvidence(result), /metadata|malformed|digest|invalid/i);
  assert.equal(await readFile(temp, "utf8"), "partial");
});

test("rejects either side of a derived-facts pair without repair", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const input = {
    ...baseMetadata({ retentionDecision: "DERIVED_FACTS_ONLY", reviewAt: "2026-09-28T12:00:00.000Z" }),
    outcome: "DERIVED_FACTS_ONLY" as const,
    captureBytes: HTML,
    facts: facts(),
    rawArtifactRef: null,
  };
  const first = await store.writePrivateKwDerivedFacts(input);
  if (first.outcome !== "DERIVED_FACTS_ONLY") throw new Error("Expected facts evidence ref.");
  await rm(first.factsPath);
  await assert.rejects(store.writePrivateKwDerivedFacts(input), /INCOMPLETE_EXISTING|pair/i);
  await rm(first.metadataPath);
  const second = await store.writePrivateKwDerivedFacts(input);
  if (second.outcome !== "DERIVED_FACTS_ONLY") throw new Error("Expected facts evidence ref.");
  await rm(second.metadataPath);
  await assert.rejects(store.writePrivateKwDerivedFacts(input), /INCOMPLETE_EXISTING|pair/i);
});

test("rejects malformed derived facts on reload without replacing it", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const result = await store.writePrivateKwDerivedFacts({
    ...baseMetadata({ retentionDecision: "DERIVED_FACTS_ONLY", reviewAt: "2026-09-28T12:00:00.000Z" }),
    outcome: "DERIVED_FACTS_ONLY",
    captureBytes: HTML,
    facts: facts(),
    rawArtifactRef: null,
  });
  if (result.outcome !== "DERIVED_FACTS_ONLY") throw new Error("Expected facts evidence ref.");
  await writeFile(result.factsPath, Buffer.from("{}"));
  await assert.rejects(store.reloadPrivateKwHtmlEvidence(result), /facts|invalid|identity/i);
});

test("rejects a hard-link substitution at the final content path", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const result = await store.writePrivateKwHtmlEvidence({
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED",
    contentType: "text/html",
    bytes: HTML,
  });
  if (result.outcome !== "RAW_HTML_ALLOWED") throw new Error("Expected raw evidence ref.");
  const substitute = path.join(path.dirname(result.contentPath), "substitute.html");
  await writeFile(substitute, Buffer.from("substituted"));
  await rm(result.contentPath);
  await link(substitute, result.contentPath);
  await assert.rejects(store.reloadPrivateKwHtmlEvidence(result), /digest|mismatch|identity/i);
});

test("rejects a symlink substituted at the final content path when supported", async (context) => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const result = await store.writePrivateKwHtmlEvidence({
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED",
    contentType: "text/html",
    bytes: HTML,
  });
  if (result.outcome !== "RAW_HTML_ALLOWED") throw new Error("Expected raw evidence ref.");
  const target = path.join(path.dirname(result.contentPath), "symlink-target.html");
  await rename(result.contentPath, target);
  try {
    await symlink(target, result.contentPath);
  } catch (error) {
    await rename(target, result.contentPath);
    if ((error as NodeJS.ErrnoException).code === "EPERM" || (error as NodeJS.ErrnoException).code === "EACCES") {
      context.skip("Windows symlink creation is unavailable in this test environment.");
      return;
    }
    throw error;
  }
  await assert.rejects(store.reloadPrivateKwHtmlEvidence(result), /symbolic|unsafe|regular|identity/i);
});

test("same-key concurrent writers preserve one complete immutable pair", async () => {
  const input = {
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED" as const,
    contentType: "text/html" as const,
    bytes: HTML,
  };
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const results = await Promise.allSettled([
    store.writePrivateKwHtmlEvidence(input),
    store.writePrivateKwHtmlEvidence(input),
  ]);
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof store.writePrivateKwHtmlEvidence>>> => result.status === "fulfilled");
  assert.ok(fulfilled.length >= 1);
  assert.ok(fulfilled.every((result) => result.value.outcome === "RAW_HTML_ALLOWED"));
  const replay = await createPrivateKwLocalHtmlEvidenceStore().writePrivateKwHtmlEvidence(input);
  assert.equal(replay.executionPath, "EXACT_REPLAY");
});

test("changed parent reuses verified content but creates a distinct metadata identity", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const first = await store.writePrivateKwHtmlEvidence({
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED",
    contentType: "text/html",
    bytes: HTML,
  });
  const changed = await store.writePrivateKwHtmlEvidence({
    ...baseMetadata({
      retentionDecision: "RAW_HTML_ALLOWED",
      retainUntil: "2026-10-21T12:00:00.000Z",
      parentReceiptDigest: "d".repeat(64),
    }),
    outcome: "RAW_HTML_ALLOWED",
    contentType: "text/html",
    bytes: HTML,
  });
  if (first.outcome !== "RAW_HTML_ALLOWED" || changed.outcome !== "RAW_HTML_ALLOWED") throw new Error("Expected raw evidence refs.");
  assert.equal(changed.executionPath, "CREATED");
  assert.equal(changed.contentRef, first.contentRef);
  assert.notEqual(changed.metadataRef, first.metadataRef);
});

test("derived facts hash the capture without writing the body or personal contact data", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const result = await store.writePrivateKwDerivedFacts({
    ...baseMetadata({ retentionDecision: "DERIVED_FACTS_ONLY", reviewAt: "2026-09-28T12:00:00.000Z" }),
    outcome: "DERIVED_FACTS_ONLY",
    captureBytes: Buffer.from(`${HTML.toString("utf8")} owner@example.test`),
    facts: facts(),
    rawArtifactRef: null,
  });
  assert.equal(result.outcome, "DERIVED_FACTS_ONLY");
  assert.equal(result.rawArtifactRef, null);
  const reloaded = await store.reloadPrivateKwHtmlEvidence(result);
  assert.equal(reloaded.outcome, "DERIVED_FACTS_ONLY");
  assert.equal("bytes" in reloaded, false);
  const files = await allStoredText();
  assert.equal(files.some((value) => value.includes("owner@example.test")), false);
  assert.equal(files.some((value) => value.includes("public facts")), false);
});

test("derived facts reject unknown body-like fields and forged raw references", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  await assert.rejects(
    store.writePrivateKwDerivedFacts({
      ...baseMetadata({ retentionDecision: "DERIVED_FACTS_ONLY", reviewAt: "2026-09-28T12:00:00.000Z" }),
      outcome: "DERIVED_FACTS_ONLY",
      captureBytes: HTML,
      facts: facts(),
      rawArtifactRef: null,
      body: "copied page body",
    } as never),
    /unrecognized|body|unknown/i,
  );
  await assert.rejects(
    store.writePrivateKwDerivedFacts({
      ...baseMetadata({ retentionDecision: "DERIVED_FACTS_ONLY", reviewAt: "2026-09-28T12:00:00.000Z" }),
      outcome: "DERIVED_FACTS_ONLY",
      captureBytes: HTML,
      facts: { ...facts(), body: "copied page body" } as never,
      rawArtifactRef: null,
    }),
    /facts|body|unknown/i,
  );
  await assert.rejects(
    store.writePrivateKwDerivedFacts({
      ...baseMetadata({ retentionDecision: "DERIVED_FACTS_ONLY", reviewAt: "2026-09-28T12:00:00.000Z" }),
      outcome: "DERIVED_FACTS_ONLY",
      captureBytes: HTML,
      facts: facts(),
      rawArtifactRef: "kw-html:sha256:" + "e".repeat(64) as never,
    }),
    /rawArtifactRef|null/i,
  );
});

test("derived facts reject compressed, encoded, aliased, and oversized snippets before publication", async () => {
  const aliases = [
    ["compressedBody", "H4sIAAAAAAA="],
    ["encodedHtml", Buffer.from(HTML).toString("base64")],
    ["htmlSnapshot", "<html>copied body</html>"],
    ["pageSource", "<html>copied body</html>"],
    ["snippet", "x".repeat(400)],
  ] as const;
  for (const [alias, value] of aliases) {
    await cleanRoot();
    const store = createPrivateKwLocalHtmlEvidenceStore();
    const candidate = {
      ...baseMetadata({ retentionDecision: "DERIVED_FACTS_ONLY", reviewAt: "2026-09-28T12:00:00.000Z" }),
      outcome: "DERIVED_FACTS_ONLY" as const,
      captureBytes: HTML,
      facts: { ...facts(), [alias]: value } as never,
      rawArtifactRef: null,
    };
    await assert.rejects(store.writePrivateKwDerivedFacts(candidate), /facts|unknown|unrecognized|large|bounded/i);
    assert.deepEqual(await readdir(PRIVATE_KW_EVIDENCE_ROOT), []);
  }
});

test("blocked writes only a bounded reason receipt and never document evidence", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const result = await store.writePrivateKwHtmlEvidence({
    ...baseMetadata({ retentionDecision: "BLOCKED" }),
    outcome: "BLOCKED",
    blockCode: "ROBOTS_UNRESOLVED",
  });
  assert.equal(result.outcome, "BLOCKED");
  assert.equal(result.blockCode, "ROBOTS_UNRESOLVED");
  const reloaded = await store.reloadPrivateKwHtmlEvidence(result);
  assert.equal(reloaded.outcome, "BLOCKED");
  assert.equal(reloaded.blockCode, result.blockCode);
  assert.equal(reloaded.receipt.receiptRef, result.receiptRef);
  const names = await readdir(PRIVATE_KW_EVIDENCE_ROOT, { recursive: true });
  assert.equal(names.some((name) => name.includes("objects") || name.includes("facts") || name.includes("metadata")), false);
});

test("existing content conflict, tamper, path traversal and identity-unavailable inputs fail closed", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const input = {
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED" as const,
    contentType: "text/html" as const,
    bytes: HTML,
  };
  const first = await store.writePrivateKwHtmlEvidence(input);
  const different = await store.writePrivateKwHtmlEvidence({ ...input, bytes: Buffer.from("different") });
  if (first.outcome !== "RAW_HTML_ALLOWED" || different.outcome !== "RAW_HTML_ALLOWED") throw new Error("Expected raw evidence refs.");
  assert.notEqual(different.contentRef, first.contentRef);
  await writeFile(first.contentPath, Buffer.from("tampered"));
  await assert.rejects(store.reloadPrivateKwHtmlEvidence(first), /digest|mismatch|identity/i);
  assert.throws(
    () => createPrivateKwLocalHtmlEvidenceStore({ rootPath: path.join("data", "kw-evaluation", "..", "outside") }),
    /direct child|root|evidence/i,
  );
  const digest = createHash("sha256").update(HTML).digest("hex");
  assert.equal(digest.length, 64);
});

test("filesystem safety seams fail closed for unknown reparse classification and unavailable identity", async () => {
  const raw = {
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED" as const,
    contentType: "text/html" as const,
    bytes: HTML,
  };
  const unknownReparseStore = createPrivateKwLocalHtmlEvidenceStore({ filesystemSafety: { classifyReparsePoint: () => "UNKNOWN" } });
  await assert.rejects(unknownReparseStore.writePrivateKwHtmlEvidence(raw), /reparse|unsafe/i);
  await cleanRoot();
  const noIdentityStore = createPrivateKwLocalHtmlEvidenceStore({ filesystemSafety: { classifyReparsePoint: () => "SAFE", identityAvailable: () => false } });
  await assert.rejects(noIdentityStore.writePrivateKwHtmlEvidence(raw), /identity|unavailable/i);
});

test("retention classifies raw expiry, derived review, and legal hold without deletion", async () => {
  const store = createPrivateKwLocalHtmlEvidenceStore();
  const raw = await store.writePrivateKwHtmlEvidence({
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-09-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED",
    contentType: "text/html",
    bytes: HTML,
  });
  const derived = await store.writePrivateKwDerivedFacts({
    ...baseMetadata({ retentionDecision: "DERIVED_FACTS_ONLY", reviewAt: "2026-09-22T12:00:00.000Z" }),
    outcome: "DERIVED_FACTS_ONLY",
    captureBytes: HTML,
    facts: facts(),
    rawArtifactRef: null,
  });
  const held = await store.writePrivateKwHtmlEvidence({
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-09-21T12:00:00.000Z", legalHold: true }),
    outcome: "RAW_HTML_ALLOWED",
    contentType: "text/html",
    bytes: Buffer.from("held"),
  });
  assert.equal(await store.assertPrivateKwHtmlEvidenceRetention(raw, new Date(NOW)), "EXPIRED");
  assert.equal(await store.assertPrivateKwHtmlEvidenceRetention(derived, new Date(NOW)), "ACTIVE");
  assert.equal(await store.assertPrivateKwHtmlEvidenceRetention(held, new Date(NOW)), "LEGAL_HOLD");
});
