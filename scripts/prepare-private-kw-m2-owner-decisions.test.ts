import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PRIVATE_KW_IMPORT_VERSION, preparePrivateKwImport, type PrivateKwImportInput } from "../src/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "../src/lib/revenue-engine/private-kw-persistence-plan";
import {
  M2_CODEX_DELEGATION_SCOPE,
  PRIVATE_KW_M2_CODEX_DELEGATED_DECISIONS_VERSION,
  PRIVATE_KW_M2_OWNER_DECISIONS_VERSION,
} from "../src/lib/revenue-engine/private-kw-m2-owner-decisions";
import { resolvePrivateKwDataPath } from "./private-kw-files";
import { preparePrivateKwM2OwnerDecisionSelectionFile } from "./prepare-private-kw-m2-owner-decisions";

const cities = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
const niches = ["ROOFING", "HVAC", "LANDSCAPING"] as const;

function fixture() {
  const selected = Array.from({ length: 10 }, (_, index) => {
    const reviewId = `M2-${String(index + 1).padStart(2, "0")}`;
    const website = reviewId === "M2-06" ? "https://comfortairontario.ca/" : reviewId === "M2-10" ? "https://tricitylandscaper.ca/" : `https://candidate-${index + 1}.getaxiom.ca/`;
    const source = `${website}about`;
    return {
      reviewId,
      name: `Synthetic Candidate ${index + 1}`,
      officialWebsite: website,
      city: cities[index % cities.length],
      niche: niches[index % niches.length],
      primarySource: source,
      sources: [source],
      disposition: "PROPOSED_FOR_OWNER_IDENTITY_REVIEW",
      ownerIdentityReview: "PENDING",
      claims: [],
    };
  });
  const alternatives = [
    { reviewId: "M2-06", name: "Synthetic Service 1st", city: "CAMBRIDGE", niche: "LANDSCAPING", sourceUrl: "https://service1st.getaxiom.ca/about", website: "https://service1st.getaxiom.ca/" },
    { reviewId: "M2-10", name: "Synthetic Jaro", city: "KITCHENER", niche: "ROOFING", sourceUrl: "https://jaro.getaxiom.ca/about", website: "https://jaro.getaxiom.ca/" },
  ] as const;
  const sourceRecords: PrivateKwImportInput["records"] = selected.filter((candidate) => candidate.reviewId !== "M2-06" && candidate.reviewId !== "M2-10").map((candidate) => ({
    sourceOwnedId: candidate.reviewId.toLowerCase(), sourceEvidenceUrl: candidate.primarySource,
    businessName: candidate.name, city: candidate.city, region: "ON" as const, country: "CA" as const, niche: candidate.niche,
    websiteUrl: candidate.officialWebsite, phone: null, addressLine: null, postalCode: null,
    independenceStatus: "INDEPENDENT" as const, capturedAt: "2026-09-20T12:00:00.000Z", sourcePayload: { reviewId: candidate.reviewId },
  }));
  sourceRecords.push(...alternatives.map((alternate) => ({
    sourceOwnedId: alternate.name.toLowerCase().replaceAll(" ", "-"), sourceEvidenceUrl: alternate.sourceUrl,
    businessName: alternate.name, city: alternate.city, region: "ON" as const, country: "CA" as const, niche: alternate.niche,
    websiteUrl: alternate.website, phone: null, addressLine: null, postalCode: null,
    independenceStatus: "INDEPENDENT" as const, capturedAt: "2026-09-20T12:00:00.000Z", sourcePayload: { alternate: alternate.name },
  })));
  const sourcePlan = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION, importId: "codex-delegated-m2-fixture", adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic delegated M2 test", filters: { synthetic: true }, capturedAt: "2026-09-20T12:00:00.000Z", costUsd: 0,
    records: sourceRecords,
  });
  const researchReview = {
    schemaVersion: 1, protocolVersion: "m2-public-research-v1", researchOnly: true, ownerIdentityReview: "PENDING",
    selected,
    unselected: alternatives.map((alternate) => ({
      name: alternate.name, officialWebsite: alternate.website, sourceUrl: alternate.sourceUrl,
      sources: [alternate.sourceUrl], disposition: "SUPPORTED_ALTERNATE",
    })),
  };
  const researchReviewBytes = Buffer.from(JSON.stringify(researchReview));
  const decisions = {
    decisionVersion: PRIVATE_KW_M2_CODEX_DELEGATED_DECISIONS_VERSION,
    researchReviewSha256: createHash("sha256").update(researchReviewBytes).digest("hex"),
    sourcePlanDigest: buildPrivateKwPersistencePlan(sourcePlan).sourcePlanDigest,
    reviewer: "CODEX", delegatedBy: "RILEY", medium: "CODEX_CHAT",
    instructionQuote: "Riley delegates these ten M2 identity selection decisions to Codex.",
    instructionSha256: createHash("sha256").update("Riley delegates these ten M2 identity selection decisions to Codex.", "utf8").digest("hex"),
    conversationRef: "01a0c1de-dd92-7d33-827b-8aadccd47412",
    scope: M2_CODEX_DELEGATION_SCOPE,
    reviewedAt: "2026-09-23T15:00:00.000Z",
    decisions: selected.map((candidate) => {
      const alternate = alternatives.find((item) => item.reviewId === candidate.reviewId);
      return alternate ? {
        reviewId: candidate.reviewId, action: "REPLACE", rationale: "The documented capture block requires a supported alternate.",
        replacement: {
          name: alternate.name, city: alternate.city, niche: alternate.niche,
          sourceEvidenceUrl: alternate.sourceUrl, websiteUrl: alternate.website,
          identityConfirmed: true, marketAndNicheConfirmed: true, independenceConfirmed: true,
          rationale: "The alternate is supported by the saved research and source plan.",
        },
      } : {
        reviewId: candidate.reviewId, action: "KEEP", rationale: "The listed identity and market fit the reviewed research evidence.",
        identityConfirmed: true, marketAndNicheConfirmed: true, independenceConfirmed: true,
      };
    }),
  };
  return { sourcePlan, researchReview, researchReviewBytes, decisions };
}

test("private M2 CLI prepares delegated Codex selections with zero authority", async () => {
  const suffix = randomUUID();
  const paths = {
    review: `data/kw-evaluation/test-codex-m2-review-${suffix}.json`,
    source: `data/kw-evaluation/test-codex-m2-source-${suffix}.json`,
    decisions: `data/kw-evaluation/test-codex-m2-decisions-${suffix}.json`,
    output: `data/kw-evaluation/test-codex-m2-selection-${suffix}.json`,
  };
  const files = Object.values(paths).map(resolvePrivateKwDataPath);
  const values = fixture();
  try {
    await mkdir(path.dirname(files[0]!), { recursive: true });
    await writeFile(files[0]!, values.researchReviewBytes, { flag: "wx" });
    await writeFile(files[1]!, `${JSON.stringify(values.sourcePlan)}\n`, { flag: "wx" });
    await writeFile(files[2]!, `${JSON.stringify(values.decisions)}\n`, { flag: "wx" });
    const result = await preparePrivateKwM2OwnerDecisionSelectionFile([
      "--research-review", paths.review, "--source-plan", paths.source, "--decisions", paths.decisions, "--output", paths.output,
    ], new Date("2026-09-23T16:00:00.000Z"));
    assert.equal(result.selectedBusinesses, 10);
    assert.equal("reviewer" in result && result.reviewer, "CODEX");
    assert.equal("delegatedBy" in result && result.delegatedBy, "RILEY");
    assert.equal(result.planOnly, true);
    assert.equal(result.providerOperationsAuthorized, 0);
    assert.equal(result.costAuthorizedUsd, 0);
    const output = JSON.parse(await readFile(files[3]!, "utf8")) as {
      selections: Array<{ sourceReview: { reviewer?: string; delegatedBy?: string } }>;
      authority: { browserCaptureAuthorized: boolean; sendAuthorized: boolean };
    };
    assert.equal(output.selections.length, 10);
    assert.equal(output.selections.every((selection) => selection.sourceReview.reviewer === "CODEX" && selection.sourceReview.delegatedBy === "RILEY"), true);
    assert.equal(output.authority.browserCaptureAuthorized, false);
    assert.equal(output.authority.sendAuthorized, false);
  } finally {
    await Promise.all(files.map((file) => rm(file, { force: true })));
  }
});

test("private M2 CLI still accepts the v1 owner-only ledger", async () => {
  const suffix = randomUUID();
  const values = fixture();
  const ownerLedger = {
    decisionVersion: PRIVATE_KW_M2_OWNER_DECISIONS_VERSION,
    researchReviewSha256: values.decisions.researchReviewSha256,
    sourcePlanDigest: values.decisions.sourcePlanDigest,
    reviewedBy: "RILEY",
    reviewedAt: values.decisions.reviewedAt,
    decisions: values.decisions.decisions,
  };
  const paths = {
    review: `data/kw-evaluation/test-owner-m2-review-${suffix}.json`,
    source: `data/kw-evaluation/test-owner-m2-source-${suffix}.json`,
    decisions: `data/kw-evaluation/test-owner-m2-decisions-${suffix}.json`,
    output: `data/kw-evaluation/test-owner-m2-selection-${suffix}.json`,
  };
  const files = Object.values(paths).map(resolvePrivateKwDataPath);
  try {
    await mkdir(path.dirname(files[0]!), { recursive: true });
    await writeFile(files[0]!, values.researchReviewBytes, { flag: "wx" });
    await writeFile(files[1]!, `${JSON.stringify(values.sourcePlan)}\n`, { flag: "wx" });
    await writeFile(files[2]!, `${JSON.stringify(ownerLedger)}\n`, { flag: "wx" });
    const result = await preparePrivateKwM2OwnerDecisionSelectionFile([
      "--research-review", paths.review, "--source-plan", paths.source, "--decisions", paths.decisions, "--output", paths.output,
    ], new Date("2026-09-23T16:00:00.000Z"));
    assert.equal("reviewedBy" in result && result.reviewedBy, "RILEY");
    assert.equal("reviewer" in result, false);
    assert.equal(result.planOnly, true);
  } finally {
    await Promise.all(files.map((file) => rm(file, { force: true })));
  }
});

test("CLI usage rejects a delegated ledger when the instruction digest is wrong", async () => {
  const values = fixture();
  const tampered = { ...values.decisions, instructionSha256: "0".repeat(64) };
  assert.notEqual(tampered.decisionVersion, PRIVATE_KW_M2_OWNER_DECISIONS_VERSION);
  // The builder rejects before the CLI can create an output, even if the ledger
  // has a plausible reviewer and valid packet/source-plan digests.
  const suffix = randomUUID();
  const paths = {
    review: `data/kw-evaluation/test-codex-m2-bad-review-${suffix}.json`,
    source: `data/kw-evaluation/test-codex-m2-bad-source-${suffix}.json`,
    decisions: `data/kw-evaluation/test-codex-m2-bad-decisions-${suffix}.json`,
    output: `data/kw-evaluation/test-codex-m2-bad-selection-${suffix}.json`,
  };
  const files = Object.values(paths).map(resolvePrivateKwDataPath);
  try {
    await mkdir(path.dirname(files[0]!), { recursive: true });
    await writeFile(files[0]!, values.researchReviewBytes, { flag: "wx" });
    await writeFile(files[1]!, `${JSON.stringify(values.sourcePlan)}\n`, { flag: "wx" });
    await writeFile(files[2]!, `${JSON.stringify(tampered)}\n`, { flag: "wx" });
    await assert.rejects(preparePrivateKwM2OwnerDecisionSelectionFile([
      "--research-review", paths.review, "--source-plan", paths.source, "--decisions", paths.decisions, "--output", paths.output,
    ]));
  } finally {
    await Promise.all(files.map((file) => rm(file, { force: true })));
  }
});
