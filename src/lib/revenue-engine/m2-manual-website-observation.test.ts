import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  M2ManualWebsiteObservationStoreError,
  listM2ManualWebsiteObservations,
  saveM2ManualWebsiteObservation,
} from "./m2-manual-website-observation-local-store";
import {
  buildM2ManualWebsiteObservation,
  M2_MANUAL_WEBSITE_AUDIT_VERSION,
  M2ManualWebsiteObservationCommandSchema,
} from "./m2-manual-website-observation";
import { assertM2CodexManualObservationAuthorization } from "./m2-codex-manual-observation-authorization";

const TARGET = {
  reviewId: "M2-01" as const,
  businessName: "Synthetic Example HVAC",
  approvedWebsiteUrl: "https://synthetic.example.invalid/",
  businessIdentityDigest: "a".repeat(64),
};

function command(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "cd019946-3c26-4c6c-9d57-577f9eaf50b7",
    reviewId: TARGET.reviewId,
    observedUrl: "https://synthetic.example.invalid/services",
    confidence: "MEDIUM",
    evidenceState: "OBSERVED",
    observation: "The service categories are grouped in a single narrow column.",
    noCopiedOrPersonalData: true,
    ...overrides,
  };
}

async function withRoot(run: (rootDir: string) => Promise<void>) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "m2-manual-observation-"));
  try { await run(rootDir); } finally { await rm(rootDir, { recursive: true, force: true }); }
}

test("manual notes retain exact source and audit provenance while remaining UNKNOWN / RESEARCH", () => {
  const result = buildM2ManualWebsiteObservation(command(), TARGET, "RILEY", "2026-09-23T14:30:00.000Z");
  assert.equal(result.observation, "The service categories are grouped in a single narrow column.");
  assert.equal(result.observedUrl, "https://synthetic.example.invalid/services");
  assert.equal(result.observedAt, "2026-09-23T14:30:00.000Z");
  assert.equal(result.method, "MANUAL");
  assert.equal(result.auditVersion, M2_MANUAL_WEBSITE_AUDIT_VERSION);
  assert.deepEqual(result.assessment, {
    websiteNeed: "UNKNOWN",
    qualification: "RESEARCH",
    scores: { rebuildNeed: 0, businessFit: 0, timing: 0, reachability: 0, evidenceConfidence: 0 },
  });
});

test("Codex attribution is accepted without impersonating an owner", () => {
  const result = buildM2ManualWebsiteObservation(command(), TARGET, "CODEX", "2026-09-23T14:30:00.000Z", {
    sourceAuthorizationDigest: "b".repeat(64), retentionReviewDate: "2026-09-24T14:00:00.000Z",
  });
  assert.equal(result.recordedBy, "CODEX");
});

test("Codex saving requires a current delegated source decision for the exact identity and page", () => {
  const authorization = {
    authorizationId: "b5a3558e-804c-4db1-90b1-4bde074b82ce",
    status: "APPROVED",
    authorizedBy: "CODEX",
    delegationBasis: "OWNER_DELEGATION",
    delegationVersion: "M2_CODEX_LOCAL_MANUAL_FACTS_ONLY_V1",
    delegatedBy: "RILEY",
    scope: "LOCAL_MANUAL_OBSERVATION_ONLY",
    commandId: "cd019946-3c26-4c6c-9d57-577f9eaf50b7",
    reviewId: TARGET.reviewId,
    businessName: TARGET.businessName,
    businessIdentityDigest: TARGET.businessIdentityDigest,
    websiteOrigin: "https://synthetic.example.invalid",
    pageUrl: "https://synthetic.example.invalid/services",
    method: "MANUAL",
    authorizedAt: "2026-09-23T14:00:00.000Z",
    expiresAt: "2026-09-24T14:00:00.000Z",
    retentionReviewDate: "2026-09-25T14:00:00.000Z",
    retention: "DERIVED_FACTS_ONLY",
    rawHtmlRetentionAuthorized: false,
    copiedTextRetentionAuthorized: false,
    personalOrContactDataAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedCad: 0,
  };
  const now = new Date("2026-09-23T15:00:00.000Z");
  const parsedCommand = M2ManualWebsiteObservationCommandSchema.parse(command());
  const validated = assertM2CodexManualObservationAuthorization(authorization, TARGET, parsedCommand, now);
  assert.match(validated.authorizationDigest, /^[a-f0-9]{64}$/);
  assert.equal(validated.authorization.retentionReviewDate, "2026-09-25T14:00:00.000Z");
  assert.throws(() => assertM2CodexManualObservationAuthorization({ ...authorization, pageUrl: "https://synthetic.example.invalid/other" }, TARGET, parsedCommand, now), /exact current identity and page/);
  assert.throws(() => assertM2CodexManualObservationAuthorization({ ...authorization, expiresAt: "2026-09-23T14:59:00.000Z" }, TARGET, parsedCommand, now), /not currently valid/);
  assert.throws(() => assertM2CodexManualObservationAuthorization({ ...authorization, rawHtmlRetentionAuthorized: true }, TARGET, parsedCommand, now));
  assert.throws(() => assertM2CodexManualObservationAuthorization({ ...authorization, commandId: "7e6074c4-fc81-4648-b0e6-82cab1319e59" }, TARGET, parsedCommand, now), /exact current identity and page/);
});

test("Codex authorization digest and retention review date persist in the immutable note", async () => {
  await withRoot(async (rootDir) => {
    const authorizationProof = { sourceAuthorizationDigest: "b".repeat(64), retentionReviewDate: "2026-09-24T14:00:00.000Z" };
    const saved = await saveM2ManualWebsiteObservation(command(), TARGET, "CODEX", { rootDir, authorizationProof });
    const loaded = await listM2ManualWebsiteObservations(TARGET, { rootDir });
    assert.equal(loaded[0]?.sourceAuthorizationDigest, authorizationProof.sourceAuthorizationDigest);
    assert.equal(loaded[0]?.retentionReviewDate, authorizationProof.retentionReviewDate);
    assert.equal((await saveM2ManualWebsiteObservation(command(), TARGET, "CODEX", { rootDir, authorizationProof })).observationId, saved.observationId);
    await assert.rejects(saveM2ManualWebsiteObservation(command(), TARGET, "CODEX", { rootDir, authorizationProof: { ...authorizationProof, sourceAuthorizationDigest: "c".repeat(64) } }), M2ManualWebsiteObservationStoreError);
    const filename = (await readdir(rootDir)).find((name) => name.endsWith(".json"));
    assert.ok(filename);
    const record = JSON.parse(await readFile(path.join(rootDir, filename), "utf8")) as { sourceAuthorizationDigest: string };
    record.sourceAuthorizationDigest = "c".repeat(64);
    await writeFile(path.join(rootDir, filename), JSON.stringify(record), "utf8");
    await assert.rejects(listM2ManualWebsiteObservations(TARGET, { rootDir }), M2ManualWebsiteObservationStoreError);
  });
});

test("insufficient evidence persists an explicit UNKNOWN / RESEARCH state without inventing a note", () => {
  const result = buildM2ManualWebsiteObservation(command({
    evidenceState: "INSUFFICIENT",
    confidence: "LOW",
    observation: "",
  }), TARGET, "AIDAN", "2026-09-23T14:30:00.000Z");
  assert.equal(result.evidenceState, "INSUFFICIENT");
  assert.equal(result.observation, null);
  assert.equal(result.assessment.websiteNeed, "UNKNOWN");
  assert.equal(result.assessment.qualification, "RESEARCH");
});

test("rejects copied-content, contact-data, off-site, and unconfirmed observations", () => {
  for (const invalid of [
    command({ observation: "Email us at hello@example.com for service." }),
    command({ observation: "Call 519-555-0199 for service options." }),
    command({ observedUrl: "https://synthetic.example.invalid/services?email=owner@example.invalid" }),
    command({ observation: "This is a copied phrase from the website." , noCopiedOrPersonalData: false }),
    command({ observedUrl: "https://another.example.invalid/services" }),
    command({ evidenceState: "INSUFFICIENT", observation: "There is not enough evidence yet." }),
  ]) {
    assert.throws(() => buildM2ManualWebsiteObservation(invalid, TARGET, "RILEY", "2026-09-23T14:30:00.000Z"));
  }
});

test("append-only save survives reload and same-key retry preserves original timestamp", async () => {
  await withRoot(async (rootDir) => {
    let now = "2026-09-23T14:30:00.000Z";
    const first = await saveM2ManualWebsiteObservation(command(), TARGET, "RILEY", { rootDir, clock: () => new Date(now) });
    now = "2026-09-23T15:00:00.000Z";
    const retry = await saveM2ManualWebsiteObservation(command(), TARGET, "RILEY", { rootDir, clock: () => new Date(now) });
    const reloaded = await listM2ManualWebsiteObservations(TARGET, { rootDir });
    assert.equal(first.status, "SAVED");
    assert.equal(retry.status, "ALREADY_SAVED");
    assert.equal(retry.observationId, first.observationId);
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0]?.observedAt, "2026-09-23T14:30:00.000Z");
    assert.equal((await readdir(rootDir)).filter((name) => name.endsWith(".json")).length, 1);
  });
});

test("same idempotency key with changed facts conflicts, while a different key appends", async () => {
  await withRoot(async (rootDir) => {
    await saveM2ManualWebsiteObservation(command(), TARGET, "RILEY", { rootDir });
    await assert.rejects(
      saveM2ManualWebsiteObservation(command({ observation: "The service categories are grouped across the page." }), TARGET, "RILEY", { rootDir }),
      M2ManualWebsiteObservationStoreError,
    );
    await saveM2ManualWebsiteObservation(command({ commandId: "7e6074c4-fc81-4648-b0e6-82cab1319e59" }), TARGET, "AIDAN", { rootDir });
    assert.equal((await listM2ManualWebsiteObservations(TARGET, { rootDir })).length, 2);
  });
});

test("reload rejects changed immutable content even when its filename and schema still look valid", async () => {
  await withRoot(async (rootDir) => {
    await saveM2ManualWebsiteObservation(command(), TARGET, "RILEY", { rootDir });
    const filename = (await readdir(rootDir)).find((name) => name.endsWith(".json"));
    assert.ok(filename);
    const record = JSON.parse(await readFile(path.join(rootDir, filename), "utf8")) as { observation: string };
    record.observation = "The top level service navigation has a different arrangement.";
    await writeFile(path.join(rootDir, filename), JSON.stringify(record), "utf8");
    await assert.rejects(listM2ManualWebsiteObservations(TARGET, { rootDir }), M2ManualWebsiteObservationStoreError);
  });
});
