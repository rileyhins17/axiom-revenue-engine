import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
} from "../src/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "../src/lib/revenue-engine/private-kw-persistence-plan";
import { PRIVATE_KW_SHADOW_SLICE_VERSION } from "../src/lib/revenue-engine/private-kw-shadow-slice";
import { resolvePrivateKwDataPath } from "./private-kw-files";
import { preparePrivateKwShadowSliceFile } from "./prepare-private-kw-shadow-slice";

test("the shadow-slice CLI writes one ignored plan-only manifest and refuses overwrite", async () => {
  const suffix = randomUUID();
  const sourceRelative = `data/kw-evaluation/test-shadow-source-${suffix}.json`;
  const selectionRelative = `data/kw-evaluation/test-shadow-selection-${suffix}.json`;
  const outputRelative = `data/kw-evaluation/test-shadow-manifest-${suffix}.json`;
  const sourceFile = resolvePrivateKwDataPath(sourceRelative);
  const selectionFile = resolvePrivateKwDataPath(selectionRelative);
  const outputFile = resolvePrivateKwDataPath(outputRelative);
  const cities = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
  const niches = ["ROOFING", "HVAC", "LANDSCAPING"] as const;
  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: `shadow-${suffix}`,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic bounded shadow slice",
    filters: { synthetic: true },
    capturedAt: "2026-08-01T15:00:00.000Z",
    costUsd: 0,
    records: Array.from({ length: 10 }, (_, index) => ({
      sourceOwnedId: `synthetic-${index}`,
      sourceEvidenceUrl: `https://directory.getaxiom.ca/synthetic-${index}`,
      businessName: `Synthetic Independent Business ${index}`,
      city: cities[index % cities.length],
      region: "ON" as const,
      country: "CA" as const,
      niche: niches[index % niches.length],
      websiteUrl: `https://synthetic-${index}.getaxiom.ca`,
      phone: `519555${String(2000 + index)}`,
      addressLine: `${index + 1} Test Street`,
      postalCode: "N2G 1A1",
      independenceStatus: "INDEPENDENT" as const,
      capturedAt: "2026-08-01T14:00:00.000Z",
      sourcePayload: { synthetic: true },
    })),
  });
  const selection = {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION,
    sliceKey: `shadow-${suffix}`,
    sourceImportId: source.importId,
    sourcePlanDigest: buildPrivateKwPersistencePlan(source).sourcePlanDigest,
    createdAt: "2026-08-03T15:00:00.000Z",
    selections: source.records.map((record) => ({
      businessId: record.business.id,
      evaluationCandidateId: record.evaluationCandidateId,
      sourceReview: {
        decision: "APPROVED_FOR_BOUNDED_SHADOW_SLICE",
        reviewedBy: "RILEY",
        reviewedAt: "2026-08-02T15:00:00.000Z",
        rationale: "Synthetic identity, market, niche, and independence were checked.",
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

  try {
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, `${JSON.stringify(source)}\n`, { encoding: "utf8", flag: "wx" });
    await writeFile(selectionFile, `${JSON.stringify(selection)}\n`, { encoding: "utf8", flag: "wx" });
    const result = await preparePrivateKwShadowSliceFile([
      "--source-plan", sourceRelative,
      "--selection", selectionRelative,
      "--output", outputRelative,
    ]);
    assert.equal(result.summary.selectedBusinesses, 10);
    assert.equal(result.planOnly, true);
    assert.equal(result.providerOperationsAuthorized, 0);
    assert.equal(result.costAuthorizedUsd, 0);
    const saved = JSON.parse(await readFile(outputFile, "utf8")) as {
      authority: { sendAuthorized: boolean; deploymentAuthorized: boolean };
    };
    assert.equal(saved.authority.sendAuthorized, false);
    assert.equal(saved.authority.deploymentAuthorized, false);
    await assert.rejects(
      preparePrivateKwShadowSliceFile([
        "--source-plan", sourceRelative,
        "--selection", selectionRelative,
        "--output", outputRelative,
      ]),
      /EEXIST/,
    );
  } finally {
    await rm(sourceFile, { force: true });
    await rm(selectionFile, { force: true });
    await rm(outputFile, { force: true });
  }
});
