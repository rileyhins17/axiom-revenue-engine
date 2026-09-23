import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  M2_CODEX_DELEGATION_SCOPE,
  PRIVATE_KW_M2_CODEX_DELEGATED_DECISIONS_VERSION,
  PRIVATE_KW_M2_OWNER_DECISIONS_VERSION,
  PrivateKwM2CodexDelegatedOwnerDecisionsSchema,
  PrivateKwM2OwnerDecisionsSchema,
  buildPrivateKwM2OwnerDecisionSelection,
} from "./private-kw-m2-owner-decisions";
import { PRIVATE_KW_IMPORT_VERSION, preparePrivateKwImport } from "./private-kw-import";
import { buildPrivateKwPersistencePlan } from "./private-kw-persistence-plan";

const CITIES = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
const NICHES = ["ROOFING", "HVAC", "LANDSCAPING"] as const;

function createFixture(includeAlternate = false) {
  const reviewId = "m2-owner-decisions-test";
  const capturedAt = "2026-09-20T12:00:00.000Z";
  const selected = Array.from({ length: 10 }, (_, index) => {
    const id = `M2-${String(index + 1).padStart(2, "0")}`;
    const name = `Synthetic Business ${index + 1}`;
    const website = index === 5
      ? "https://comfortairontario.ca/"
      : index === 9
        ? "https://tricitylandscaper.ca/"
        : `https://business-${index + 1}.getaxiom.ca`;
    const source = `${website}/about`;
    return {
      reviewId: id,
      name,
      officialWebsite: website,
      primarySource: source,
      sources: [source],
      city: CITIES[index % CITIES.length],
      niche: NICHES[index % NICHES.length],
      disposition: "PROPOSED_FOR_OWNER_IDENTITY_REVIEW",
      ownerIdentityReview: "PENDING",
      claims: [
        { field: "name", value: name, sourceUrl: source },
        { field: "city", value: CITIES[index % CITIES.length], sourceUrl: source },
        { field: "niche", value: NICHES[index % NICHES.length], sourceUrl: source },
        { field: "independence", value: "Independent owner operated", sourceUrl: source },
      ],
    };
  });
  const alternate = {
    name: "Synthetic Alternate HVAC",
    officialWebsite: "https://alternate.getaxiom.ca",
    sourceUrl: "https://alternate.getaxiom.ca/about",
    sources: ["https://alternate.getaxiom.ca/about"],
    disposition: "SUPPORTED_ALTERNATE",
    claims: [
      { field: "name", value: "Synthetic Alternate HVAC", sourceUrl: "https://alternate.getaxiom.ca/about" },
      { field: "niche", value: "HVAC heating and cooling", sourceUrl: "https://alternate.getaxiom.ca/about" },
      { field: "independence", value: "Locally owned", sourceUrl: "https://alternate.getaxiom.ca/about" },
    ],
  };
  const alternate2 = {
    name: "Synthetic Alternate Roofing",
    officialWebsite: "https://alternate-roofing.getaxiom.ca",
    sourceUrl: "https://alternate-roofing.getaxiom.ca/about",
    sources: ["https://alternate-roofing.getaxiom.ca/about"],
    disposition: "SUPPORTED_ALTERNATE",
    claims: [
      { field: "name", value: "Synthetic Alternate Roofing", sourceUrl: "https://alternate-roofing.getaxiom.ca/about" },
      { field: "niche", value: "Roofing services", sourceUrl: "https://alternate-roofing.getaxiom.ca/about" },
      { field: "independence", value: "Locally owned", sourceUrl: "https://alternate-roofing.getaxiom.ca/about" },
    ],
  };
  const inputs = selected.map((candidate, index) => ({
    sourceOwnedId: `m2-${String(index + 1).padStart(2, "0")}`,
    sourceEvidenceUrl: candidate.primarySource,
    businessName: candidate.name,
    city: candidate.city,
    region: "ON" as const,
    country: "CA" as const,
    niche: candidate.niche,
    websiteUrl: candidate.officialWebsite,
    phone: null,
    addressLine: null,
    postalCode: null,
    independenceStatus: "INDEPENDENT" as const,
    capturedAt,
    sourcePayload: { reviewId: candidate.reviewId },
  }));
  if (includeAlternate) inputs.push({
    sourceOwnedId: "alternate-service1st",
    sourceEvidenceUrl: alternate.sourceUrl,
    businessName: alternate.name,
    city: "CAMBRIDGE",
    region: "ON" as const,
    country: "CA" as const,
    niche: "HVAC" as const,
    websiteUrl: alternate.officialWebsite,
    phone: null,
    addressLine: null,
    postalCode: null,
    independenceStatus: "INDEPENDENT" as const,
    capturedAt,
    sourcePayload: { reviewId: "M2-ALT" },
  });
  if (includeAlternate) inputs.push({
    sourceOwnedId: "alternate-roofing",
    sourceEvidenceUrl: alternate2.sourceUrl,
    businessName: alternate2.name,
    city: "CAMBRIDGE",
    region: "ON" as const,
    country: "CA" as const,
    niche: "ROOFING" as const,
    websiteUrl: alternate2.officialWebsite,
    phone: null,
    addressLine: null,
    postalCode: null,
    independenceStatus: "INDEPENDENT" as const,
    capturedAt,
    sourcePayload: { reviewId: "M2-ALT-2" },
  });
  const sourcePlan = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: reviewId,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic owner-decision test",
    filters: { synthetic: true },
    capturedAt,
    costUsd: 0,
    records: inputs,
  });
  const researchReview = {
    schemaVersion: 1,
    protocolVersion: "m2-public-research-v1",
    researchOnly: true,
    ownerIdentityReview: "PENDING",
    selected,
    unselected: [alternate, alternate2],
  };
  const decisions = {
    decisionVersion: PRIVATE_KW_M2_OWNER_DECISIONS_VERSION,
    researchReviewSha256: createHash("sha256").update(JSON.stringify(researchReview)).digest("hex"),
    sourcePlanDigest: buildPrivateKwPersistencePlan(sourcePlan).sourcePlanDigest,
    reviewedBy: "RILEY",
    reviewedAt: "2026-09-21T12:00:00.000Z",
    decisions: selected.map((candidate) => ({
      reviewId: candidate.reviewId,
      action: candidate.reviewId === "M2-06" || candidate.reviewId === "M2-10" ? "KEEP_AS_BLOCKED" : "KEEP",
      rationale: candidate.reviewId === "M2-06" || candidate.reviewId === "M2-10"
        ? "Identity is accepted for evaluation; documented access denial remains blocked."
        : "The listed identity and market fit the reviewed research evidence.",
      identityConfirmed: true,
      marketAndNicheConfirmed: true,
      independenceConfirmed: true,
    })),
  };
  return { researchReview, sourcePlan, decisions, alternate, alternate2 };
}

function replaceBlockedSelections(fixture: ReturnType<typeof createFixture>, decisions = fixture.decisions.decisions) {
  return decisions.map((decision) => {
    if (decision.reviewId !== "M2-06" && decision.reviewId !== "M2-10") return decision;
    const alternate = decision.reviewId === "M2-06" ? fixture.alternate : fixture.alternate2;
    return {
      reviewId: decision.reviewId,
      action: "REPLACE",
      rationale: "The blocked business is replaced for this cohort.",
      replacement: {
        name: alternate.name,
        city: "CAMBRIDGE",
        niche: decision.reviewId === "M2-06" ? "HVAC" : "ROOFING",
        sourceEvidenceUrl: alternate.sourceUrl,
        websiteUrl: alternate.officialWebsite,
        identityConfirmed: true,
        marketAndNicheConfirmed: true,
        independenceConfirmed: true,
        rationale: "The alternate's local identity, services and ownership were reviewed.",
      },
    };
  });
}

function codexDelegatedLedger(fixture: ReturnType<typeof createFixture>) {
  const instructionQuote = "Riley delegates these ten M2 identity selection decisions to Codex.";
  return {
    decisionVersion: PRIVATE_KW_M2_CODEX_DELEGATED_DECISIONS_VERSION,
    researchReviewSha256: fixture.decisions.researchReviewSha256,
    sourcePlanDigest: fixture.decisions.sourcePlanDigest,
    reviewer: "CODEX",
    delegatedBy: "RILEY",
    medium: "CODEX_CHAT",
    instructionQuote,
    instructionSha256: createHash("sha256").update(instructionQuote, "utf8").digest("hex"),
    conversationRef: "01a0c1de-dd92-7d33-827b-8aadccd47412",
    scope: M2_CODEX_DELEGATION_SCOPE,
    reviewedAt: "2026-09-23T15:00:00.000Z",
    decisions: replaceBlockedSelections(fixture),
  };
}

test("builds a plan-only exact-ten selection from explicit confirmed owner decisions", () => {
  const fixture = createFixture(true);
  const selection = buildPrivateKwM2OwnerDecisionSelection({
    researchReview: fixture.researchReview,
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    sourcePlan: fixture.sourcePlan,
    decisions: { ...fixture.decisions, decisions: replaceBlockedSelections(fixture) },
    createdAt: "2026-09-22T12:00:00.000Z",
  });

  assert.equal(selection.selections.length, 10);
  assert.equal(selection.authority.browserCaptureAuthorized, false);
  assert.equal(selection.authority.providerOperationsAuthorized, 0);
  assert.equal(selection.authority.costAuthorizedUsd, 0);
  assert(selection.selections.every((entry) => entry.sourceReview.decision === "APPROVED_FOR_BOUNDED_SHADOW_SLICE"));
});

test("accepts a truthful delegated Codex ledger and carries provenance into the selection", () => {
  const fixture = createFixture(true);
  const ledger = codexDelegatedLedger(fixture);
  assert.equal(PrivateKwM2CodexDelegatedOwnerDecisionsSchema.parse(ledger).reviewer, "CODEX");
  const selection = buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions: ledger,
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-23T16:00:00.000Z",
  });
  assert.equal(selection.selections.length, 10);
  const sourceReview = selection.selections[0]?.sourceReview;
  assert(sourceReview && "reviewer" in sourceReview);
  assert.equal(sourceReview.reviewer, "CODEX");
  assert.equal(sourceReview.delegatedBy, "RILEY");
  assert.equal(sourceReview.medium, "CODEX_CHAT");
  assert.equal(sourceReview.researchReviewSha256, fixture.decisions.researchReviewSha256);
  assert.equal(sourceReview.instructionSha256, ledger.instructionSha256);
  assert.equal(sourceReview.conversationRef, ledger.conversationRef);
  assert.equal(sourceReview.scope, "M2_IDENTITY_SELECTION_ONLY");
  assert.equal(selection.authority.browserCaptureAuthorized, false);
  assert.equal(selection.authority.providerOperationsAuthorized, 0);
  assert.equal(selection.authority.costAuthorizedUsd, 0);
});

test("delegated ledger rejects quote-hash drift, spoofed roles, wrong scope, and malformed conversation references", () => {
  const fixture = createFixture(true);
  const valid = codexDelegatedLedger(fixture);
  assert.equal(PrivateKwM2CodexDelegatedOwnerDecisionsSchema.safeParse(valid).success, true);
  for (const changed of [
    { instructionSha256: "0".repeat(64) },
    { reviewer: "RILEY" },
    { delegatedBy: "AIDAN" },
    { medium: "OWNER_UI" },
    { scope: "M2_AND_CAPTURE" },
    { conversationRef: "not-a-thread-id" },
    { sourcePlanDigest: undefined },
    { instructionQuote: undefined },
    { extraAuthority: true },
    { decisions: valid.decisions.map((decision, index) => index === 9 ? { ...decision, reviewId: "M2-09" } : decision) },
  ]) {
    assert.equal(PrivateKwM2CodexDelegatedOwnerDecisionsSchema.safeParse({ ...valid, ...changed }).success, false);
  }
});

test("delegated selection still binds exact review bytes and source-plan digest", () => {
  const fixture = createFixture(true);
  const decisions = codexDelegatedLedger(fixture);
  const input = {
    ...fixture,
    decisions,
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-23T16:00:00.000Z",
  };
  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...input,
    decisions: { ...decisions, researchReviewSha256: "0".repeat(64) },
  }), /research review digest/i);
  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...input,
    decisions: { ...decisions, sourcePlanDigest: "0".repeat(64) },
  }), /source plan digest/i);
});

test("allows identity decisions before a source-plan digest exists, then validates identities against the supplied plan", () => {
  const fixture = createFixture(true);
  const decisions = {
    ...fixture.decisions,
    sourcePlanDigest: undefined,
    decisions: replaceBlockedSelections(fixture),
  };
  delete (decisions as { sourcePlanDigest?: string }).sourcePlanDigest;

  assert.doesNotThrow(() => PrivateKwM2OwnerDecisionsSchema.parse(decisions));
  const selection = buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions,
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-22T12:00:00.000Z",
  });
  assert.equal(selection.sourcePlanDigest, buildPrivateKwPersistencePlan(fixture.sourcePlan).sourcePlanDigest);
  assert.equal(selection.selections.length, 10);

  const changedSourcePlan = structuredClone(fixture.sourcePlan);
  const changedCandidate = changedSourcePlan.records.find((record) => record.sourceOwnedId === "m2-01");
  assert(changedCandidate);
  changedCandidate.sourceRecord.sourceEvidenceUrl = "https://changed.getaxiom.ca/about";
  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    sourcePlan: changedSourcePlan,
    decisions,
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-22T12:00:00.000Z",
  }), /source plan identity, market, niche, independence, or source does not match M2-01/i);
});

test("requires one decision for every proposed M2 identity", () => {
  const fixture = createFixture();
  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    decisions: { ...fixture.decisions, decisions: fixture.decisions.decisions.slice(1) },
    createdAt: "2026-09-22T12:00:00.000Z",
  }), /exactly one decision for each proposed M2 identity/i);
});

test("rejects a decision packet bound to different review or source-plan digests", () => {
  const fixture = createFixture();
  const changedReview = { ...fixture.researchReview, auditNote: "changed" };
  const changedReviewBytes = Buffer.from(JSON.stringify(changedReview));
  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    researchReview: changedReview,
    researchReviewBytes: changedReviewBytes,
    createdAt: "2026-09-22T12:00:00.000Z",
  }), /research review digest/i);

  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions: { ...fixture.decisions, sourcePlanDigest: "0".repeat(64) },
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-22T12:00:00.000Z",
  }), /source plan digest/i);
});

test("does not emit a selection while any proposed candidate is held or rejected", () => {
  const fixture = createFixture(true);
  const decisions = replaceBlockedSelections(fixture).map((decision, index) => index === 0
    ? { reviewId: decision.reviewId, action: "HOLD", rationale: "Owner needs more evidence before deciding." }
    : decision);
  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions: { ...fixture.decisions, decisions },
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-22T12:00:00.000Z",
  }), /exactly ten confirmed candidates/i);
});

test("replacement must be an exact supported alternate in the supplied source plan", () => {
  const fixture = createFixture();
  const decisions = fixture.decisions.decisions.map((decision, index) => index === 0
    ? {
      reviewId: decision.reviewId,
      action: "REPLACE",
      rationale: "The proposed business is replaced after review.",
      replacement: {
        name: fixture.alternate.name,
        city: "CAMBRIDGE",
        niche: "HVAC",
        sourceEvidenceUrl: fixture.alternate.sourceUrl,
        websiteUrl: fixture.alternate.officialWebsite,
        identityConfirmed: true,
        marketAndNicheConfirmed: true,
        independenceConfirmed: true,
        rationale: "The alternate's local identity, services and ownership were reviewed.",
      },
    }
    : decision);

  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions: { ...fixture.decisions, decisions },
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-22T12:00:00.000Z",
  }), /replacement.*source plan/i);

});

test("accepts keep-as-blocked in the owner ledger but never emits a shadow selection containing it", () => {
  const fixture = createFixture();
  const decisions = fixture.decisions.decisions;
  assert.doesNotThrow(() => PrivateKwM2OwnerDecisionsSchema.parse({ ...fixture.decisions, decisions }));
  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions: { ...fixture.decisions, decisions },
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-22T12:00:00.000Z",
  }), /remains explicitly blocked.*cannot enter a shadow selection/i);
});

test("a blocked site can leave the next-phase cohort only through a reviewed source-plan replacement", () => {
  const fixture = createFixture(true);
  const decisions = replaceBlockedSelections(fixture);
  const selection = buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions: { ...fixture.decisions, decisions },
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-22T12:00:00.000Z",
  });
  assert.equal(selection.selections.length, 10);
  const m2_06 = fixture.sourcePlan.records.find((record) => record.sourceOwnedId === "m2-06");
  const m2_10 = fixture.sourcePlan.records.find((record) => record.sourceOwnedId === "m2-10");
  const alternate = fixture.sourcePlan.records.find((record) => record.sourceOwnedId === "alternate-service1st");
  const alternate2 = fixture.sourcePlan.records.find((record) => record.sourceOwnedId === "alternate-roofing");
  assert(m2_06 && m2_10 && alternate && alternate2);
  assert(!selection.selections.some((entry) => entry.businessId === m2_06.business.id));
  assert(!selection.selections.some((entry) => entry.businessId === m2_10.business.id));
  assert(selection.selections.some((entry) => entry.businessId === alternate.business.id));
  assert(selection.selections.some((entry) => entry.businessId === alternate2.business.id));
  assert.equal(selection.authority.browserCaptureAuthorized, false);
});

test("requires blocked disposition for the documented denied sites and rejects it elsewhere", () => {
  const fixture = createFixture();
  const plainKeep = fixture.decisions.decisions.map((decision) => decision.reviewId === "M2-06"
    ? { ...decision, action: "KEEP" }
    : decision);
  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions: { ...fixture.decisions, decisions: plainKeep },
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-22T12:00:00.000Z",
  }), /documented access denial.*requires KEEP_AS_BLOCKED/i);

  const falseBlock = fixture.decisions.decisions.map((decision) => decision.reviewId === "M2-01"
    ? { ...decision, action: "KEEP_AS_BLOCKED" }
    : decision);
  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions: { ...fixture.decisions, decisions: falseBlock },
    researchReviewBytes: Buffer.from(JSON.stringify(fixture.researchReview)),
    createdAt: "2026-09-22T12:00:00.000Z",
  }), /no documented access denial.*cannot use KEEP_AS_BLOCKED/i);
});

test("the research review digest binds raw file bytes and owner confirmations cannot be omitted", () => {
  const fixture = createFixture(true);
  const rawBytes = Buffer.from(`${JSON.stringify(fixture.researchReview)}\n`);
  const decisions = {
    ...fixture.decisions,
    researchReviewSha256: createHash("sha256").update(rawBytes).digest("hex"),
    decisions: replaceBlockedSelections(fixture).map((decision, index) => index === 0
      ? { reviewId: decision.reviewId, action: "KEEP", rationale: decision.rationale, identityConfirmed: true, marketAndNicheConfirmed: true }
      : decision),
  };
  assert.throws(() => buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions,
    researchReviewBytes: rawBytes,
    createdAt: "2026-09-22T12:00:00.000Z",
  }), /independenceConfirmed/i);

  const selection = buildPrivateKwM2OwnerDecisionSelection({
    ...fixture,
    decisions: { ...decisions, decisions: replaceBlockedSelections(fixture) },
    researchReviewBytes: rawBytes,
    createdAt: "2026-09-22T12:00:00.000Z",
  });
  assert.equal(selection.selections.length, 10);
  assert.equal(selection.authority.sendAuthorized, false);
});
