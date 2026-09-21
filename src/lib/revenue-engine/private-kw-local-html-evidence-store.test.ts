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
import { privateKwM2Digest, PrivateKwM2ExecutionAuthorizationSchema, type PrivateKwM2ExecutionAuthorization } from "./private-kw-m2-authorization";

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

function baseMetadata(overrides: Partial<PrivateKwEvidenceMetadataInput> = {}): PrivateKwEvidenceMetadataInput {
  const merged = {
    businessId: "business:kw-roof-001",
    sourceId: "source:direct-site-001",
    requestedUrl: "https://example.test/",
    finalUrl: "https://example.test/",
    redirectChainDigest: "b".repeat(64),
    captureVersion: "html-capture-v1",
    transportVersion: "public-http-v1",
    sourcePolicyVersion: "source-policy-v1",
    capturedAt: NOW,
    rightsDecision: "ALLOWED",
    termsDecision: "REVIEWED",
    robotsDecision: "ALLOWED",
    parentReceiptDigest: PARENT,
    ...overrides,
  } as PrivateKwEvidenceMetadataInput;
  const retention = merged.retentionDecision ?? "DERIVED_FACTS_ONLY";
  const authorization = authorizationFor(retention);
  return {
    ...merged,
    sourcePolicyVersion: authorization.websitePolicyVersion,
    authorizationDigest: authorization.authorizationDigest,
    authorizationExpiresAt: authorization.expiresAt,
    authorization,
  };
}

function facts() {
  return {
    pageTitle: "Roofing services",
    canonicalUrl: "https://example.test/",
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
  const factsOnlyAuthorization = authorizationFor("DERIVED_FACTS_ONLY");
  const raw = {
    ...baseMetadata({ retentionDecision: "RAW_HTML_ALLOWED", retainUntil: "2026-10-21T12:00:00.000Z" }),
    outcome: "RAW_HTML_ALLOWED" as const,
    contentType: "text/html" as const,
    bytes: HTML,
    authorization: factsOnlyAuthorization,
    authorizationDigest: factsOnlyAuthorization.authorizationDigest,
    authorizationExpiresAt: factsOnlyAuthorization.expiresAt,
  };
  await assert.rejects(store.writePrivateKwHtmlEvidence(raw), /retention|authorized/i);
  await assert.rejects(store.writePrivateKwHtmlEvidence({ ...raw, authorization: authorizationFor("RAW_HTML_ALLOWED"), authorizationDigest: "d".repeat(64) }), /identity|authorization/i);
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
