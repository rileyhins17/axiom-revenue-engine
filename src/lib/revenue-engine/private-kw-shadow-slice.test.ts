import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
  type PrivateKwImportInput,
} from "@/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "@/lib/revenue-engine/private-kw-persistence-plan";
import {
  PRIVATE_KW_SHADOW_SLICE_SIZE,
  PRIVATE_KW_SHADOW_SLICE_VERSION,
  PrivateKwShadowSliceManifestSchema,
  buildPrivateKwShadowSliceManifest,
  privateKwShadowSliceDigest,
  type PrivateKwShadowSliceInput,
} from "@/lib/revenue-engine/private-kw-shadow-slice";

const CITIES = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
const NICHES = ["ROOFING", "HVAC", "LANDSCAPING"] as const;

function sourceInput(options: { count?: number; independenceAt?: number } = {}): PrivateKwImportInput {
  const count = options.count ?? 12;
  return {
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: "kw-shadow-source-2026-08",
    adapter: "MANUAL_RESEARCH",
    queryText: "Manually reviewed KW pilot candidates",
    filters: { purpose: "bounded-shadow-slice" },
    capturedAt: "2026-08-01T15:00:00.000Z",
    costUsd: 0,
    records: Array.from({ length: count }, (_, index) => ({
      sourceOwnedId: `manual-business-${String(index + 1).padStart(2, "0")}`,
      sourceEvidenceUrl: `https://directory.getaxiom.ca/business-${index + 1}`,
      businessName: `Independent Service Business ${index + 1}`,
      city: CITIES[index % CITIES.length],
      region: "ON",
      country: "CA",
      niche: NICHES[index % NICHES.length],
      websiteUrl: `https://business-${index + 1}.getaxiom.ca`,
      phone: `519555${String(1000 + index)}`,
      addressLine: `${100 + index} Example Street`,
      postalCode: "N2G 1A1",
      independenceStatus: index === options.independenceAt ? "UNKNOWN" : "INDEPENDENT",
      capturedAt: "2026-08-01T14:00:00.000Z",
      sourcePayload: { manuallyReviewed: true },
    })),
  };
}

function inputFixture(source = preparePrivateKwImport(sourceInput())): PrivateKwShadowSliceInput {
  const sourcePlanDigest = buildPrivateKwPersistencePlan(source).sourcePlanDigest;
  return {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION,
    sliceKey: "kw-shadow-2026-08-pilot",
    sourceImportId: source.importId,
    sourcePlanDigest,
    createdAt: "2026-08-03T15:00:00.000Z",
    selections: source.records.slice(0, PRIVATE_KW_SHADOW_SLICE_SIZE).map((record) => ({
      businessId: record.business.id,
      evaluationCandidateId: record.evaluationCandidateId,
      sourceReview: {
        decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE",
        reviewedBy: "RILEY",
        reviewedAt: "2026-08-02T15:00:00.000Z",
        rationale: "Identity, local market, niche, and independence were manually checked.",
        identityConfirmed: true,
        marketAndNicheConfirmed: true,
        independenceConfirmed: true,
      },
    })),
    mode: "SHADOW",
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
  };
}

test("defines one balanced, manually reviewed ten-business slice with no execution authority", () => {
  const source = preparePrivateKwImport(sourceInput());
  const manifest = buildPrivateKwShadowSliceManifest(source, inputFixture(source));

  assert.equal(manifest.records.length, 10);
  assert.equal(manifest.summary.manuallyReviewed, 10);
  assert.equal(manifest.summary.independentBusinesses, 10);
  assert.deepEqual(manifest.summary.countsByCity, { KITCHENER: 4, WATERLOO: 3, CAMBRIDGE: 3 });
  assert.deepEqual(manifest.summary.countsByNiche, { ROOFING: 4, HVAC: 3, LANDSCAPING: 3 });
  assert.deepEqual(manifest.phases.map((phase) => phase.phase), [
    "SOURCE_WORKFLOW",
    "CURRENT_WEBSITE_EVIDENCE",
    "ASSESSMENT",
    "CONTACT_REVIEW",
    "OWNER_DOSSIER",
  ]);
  assert(manifest.phases.every((phase) => phase.requiresSeparateApproval && !phase.authorizedByThisManifest));
  assert.equal(manifest.summary.currentCheckpoint, "SOURCE_REVIEWED");
  assert(manifest.records.every((record) => record.independenceStatus === "INDEPENDENT"));
  assert.equal(manifest.authority.sendAuthorized, false);
  assert.equal(manifest.authority.providerOperationsAuthorized, 0);
  assert.equal(manifest.authority.costAuthorizedUsd, 0);
});

test("manifest preserves Codex delegation provenance and rejects a changed quote", () => {
  const source = preparePrivateKwImport(sourceInput());
  const input = inputFixture(source);
  const instructionQuote = "Riley delegates these ten M2 identity selection decisions to Codex.";
  const codexSourceReview = {
    decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE",
    reviewer: "CODEX",
    delegatedBy: "RILEY",
    medium: "CODEX_CHAT",
    researchReviewSha256: "a".repeat(64),
    instructionQuote,
    instructionSha256: createHash("sha256").update(instructionQuote, "utf8").digest("hex"),
    conversationRef: "01a0c1de-dd92-7d33-827b-8aadccd47412",
    scope: "M2_IDENTITY_SELECTION_ONLY",
    reviewedAt: "2026-08-02T15:00:00.000Z",
    rationale: "Synthetic identity, market, niche, and independence were checked.",
    identityConfirmed: true,
    marketAndNicheConfirmed: true,
    independenceConfirmed: true,
  } as const;
  const delegatedInput = {
    ...input,
    selections: input.selections.map((selection) => ({ ...selection, sourceReview: codexSourceReview })),
  };
  const manifest = buildPrivateKwShadowSliceManifest(source, delegatedInput);
  assert.equal("reviewer" in manifest.records[0]!.sourceReview, true);
  assert.deepEqual(manifest.records[0]!.sourceReview, codexSourceReview);
  assert.equal(manifest.records.every((record) => "reviewer" in record.sourceReview && record.sourceReview.reviewer === "CODEX"), true);

  const tampered = {
    ...delegatedInput,
    selections: delegatedInput.selections.map((selection) => ({
      ...selection,
      sourceReview: { ...codexSourceReview, instructionQuote: `${instructionQuote} altered` },
    })),
  };
  assert.throws(() => buildPrivateKwShadowSliceManifest(source, tampered), /delegation quote SHA-256/i);
});

test("manifest identity is deterministic and rejects later tampering", () => {
  const source = preparePrivateKwImport(sourceInput());
  const input = inputFixture(source);
  const reversed = { ...input, selections: [...input.selections].reverse() };
  const first = buildPrivateKwShadowSliceManifest(source, input);
  const second = buildPrivateKwShadowSliceManifest(source, reversed);
  assert.deepEqual(first, second);

  assert.throws(() => PrivateKwShadowSliceManifestSchema.parse({
    ...first,
    records: first.records.map((record, index) => index === 0 ? { ...record, businessName: "Changed later" } : record),
  }), /identity must bind the exact reviewed manifest/);

  const driftedCore = {
    ...first,
    phases: first.phases.map((phase, index) => index === 1
      ? { ...phase, boundary: "EXISTING_IGNORED_LOCAL_GATE" as const }
      : phase),
  };
  const { manifestId: _manifestId, manifestDigest: _manifestDigest, ...core } = driftedCore;
  void _manifestId;
  void _manifestDigest;
  const driftedDigest = privateKwShadowSliceDigest(core);
  assert.throws(() => PrivateKwShadowSliceManifestSchema.parse({
    ...core,
    manifestId: `kw-shadow-slice:${driftedDigest}`,
    manifestDigest: driftedDigest,
  }), /fixed integration contract/);
});

test("fails closed on an incomplete, duplicate, or source-drifted selection", () => {
  const source = preparePrivateKwImport(sourceInput());
  const input = inputFixture(source);
  assert.throws(() => buildPrivateKwShadowSliceManifest(source, {
    ...input,
    selections: input.selections.slice(0, 9),
  } as PrivateKwShadowSliceInput));
  assert.throws(() => buildPrivateKwShadowSliceManifest(source, {
    ...input,
    selections: input.selections.map((selection, index) => index === 9 ? input.selections[0] : selection),
  }), /ten unique businesses/);
  assert.throws(() => buildPrivateKwShadowSliceManifest(source, {
    ...input,
    sourcePlanDigest: "0".repeat(64),
  }), /exact private KW source plan/);
  assert.throws(() => buildPrivateKwShadowSliceManifest(source, {
    ...input,
    selections: input.selections.map((selection, index) => index === 0
      ? { ...selection, evaluationCandidateId: "evaluation-candidate:wrong" }
      : selection),
  }), /one exact source candidate/);
});

test("rejects stale or unconfirmed sources and a commercially skewed pilot", () => {
  const unknownSource = preparePrivateKwImport(sourceInput({ independenceAt: 0 }));
  assert.throws(
    () => buildPrivateKwShadowSliceManifest(unknownSource, inputFixture(unknownSource)),
    /only manually confirmed independent businesses/,
  );

  const source = preparePrivateKwImport(sourceInput());
  const input = inputFixture(source);
  assert.throws(() => buildPrivateKwShadowSliceManifest(source, {
    ...input,
    createdAt: "2027-01-03T15:00:00.000Z",
  }), /no more than 90 days old/);
  assert.throws(() => buildPrivateKwShadowSliceManifest(source, {
    ...input,
    createdAt: "2026-08-02T14:00:00.000Z",
  }), /cannot occur after manifest creation/);

  const skewedSource = preparePrivateKwImport(sourceInput({ count: 20 }));
  const skewedInput = inputFixture(skewedSource);
  const roofing = skewedSource.records.filter((record) => record.niche === "ROOFING").slice(0, 7);
  const hvac = skewedSource.records.filter((record) => record.niche === "HVAC").slice(0, 2);
  const landscaping = skewedSource.records.filter((record) => record.niche === "LANDSCAPING").slice(0, 1);
  const selected = [...roofing, ...hvac, ...landscaping];
  assert.equal(selected.length, 10);
  assert.throws(() => buildPrivateKwShadowSliceManifest(skewedSource, {
    ...skewedInput,
    selections: selected.map((record, index) => ({
      ...skewedInput.selections[index],
      businessId: record.business.id,
      evaluationCandidateId: record.evaluationCandidateId,
    })),
  }), /at least two businesses from every pilot city and niche/);
});
