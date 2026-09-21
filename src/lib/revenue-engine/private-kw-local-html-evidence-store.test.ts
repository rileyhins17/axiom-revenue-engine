import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  PRIVATE_KW_EVIDENCE_ROOT,
  createPrivateKwLocalHtmlEvidenceStore,
  type PrivateKwEvidenceMetadataInput,
} from "./private-kw-local-html-evidence-store";

const HTML = Buffer.from("<!doctype html><html><title>Roofing</title><body>public facts</body></html>");
const NOW = "2026-09-21T12:00:00.000Z";
const PARENT = "a".repeat(64);

function baseMetadata(overrides: Partial<PrivateKwEvidenceMetadataInput> = {}): PrivateKwEvidenceMetadataInput {
  return {
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
    authorizationDigest: "c".repeat(64),
    authorizationExpiresAt: "2026-09-22T12:00:00.000Z",
    ...overrides,
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
