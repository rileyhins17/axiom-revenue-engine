import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PRIVATE_KW_IMPORT_VERSION, preparePrivateKwImport } from "../src/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "../src/lib/revenue-engine/private-kw-persistence-plan";
import { PRIVATE_KW_SHADOW_SLICE_VERSION, buildPrivateKwShadowSliceManifest } from "../src/lib/revenue-engine/private-kw-shadow-slice";
import { preparePrivateKwM2AuthorizationFiles } from "./prepare-private-kw-m2-authorization";
import { resolvePrivateKwDataPath } from "./private-kw-files";

test("the M2 authorization CLI writes bounded pending outputs, fixture mapping, and refuses overwrite", async () => {
  const suffix = randomUUID();
  const sourceRelative = `data/kw-evaluation/m2-task-1-source-${suffix}.json`;
  const manifestRelative = `data/kw-evaluation/m2-task-1-manifest-${suffix}.json`;
  const packetRelative = `data/kw-evaluation/m2-task-1-packet-${suffix}.json`;
  const authorizationRelative = `data/kw-evaluation/m2-task-1-authorization-${suffix}.json`;
  const ownerRelative = `data/kw-evaluation/m2-task-1-owner-candidate-${suffix}.json`;
  const mappingRelative = `data/kw-evaluation/m2-task-1-mapping-${suffix}.json`;
  const sourceFile = resolvePrivateKwDataPath(sourceRelative);
  const manifestFile = resolvePrivateKwDataPath(manifestRelative);
  const outputs = [packetRelative, authorizationRelative, ownerRelative, mappingRelative].map(resolvePrivateKwDataPath);
  const cities = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
  const niches = ["ROOFING", "HVAC", "LANDSCAPING"] as const;
  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: `m2-task-1-${suffix}`,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic M2 authorization candidates",
    filters: { synthetic: true },
    capturedAt: "2026-09-01T15:00:00.000Z",
    costUsd: 0,
    records: Array.from({ length: 10 }, (_, index) => ({
      sourceOwnedId: `m2-cli-${index}`,
      sourceEvidenceUrl: `https://directory.getaxiom.ca/cli-${index}`,
      businessName: `CLI Synthetic Business ${index}`,
      city: cities[index % cities.length],
      region: "ON" as const,
      country: "CA" as const,
      niche: niches[index % niches.length],
      websiteUrl: `https://cli-${index}.getaxiom.ca`,
      phone: null,
      addressLine: `${index + 1} CLI Street`,
      postalCode: "N2G 1A1",
      independenceStatus: "INDEPENDENT" as const,
      capturedAt: "2026-09-01T14:00:00.000Z",
      sourcePayload: { synthetic: true },
    })),
  });
  const manifest = buildPrivateKwShadowSliceManifest(source, {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION,
    sliceKey: `m2-cli-${suffix}`,
    sourceImportId: source.importId,
    sourcePlanDigest: buildPrivateKwPersistencePlan(source).sourcePlanDigest,
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

  try {
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, `${JSON.stringify(source)}\n`, { encoding: "utf8", flag: "wx" });
    await writeFile(manifestFile, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", flag: "wx" });
    const result = await preparePrivateKwM2AuthorizationFiles([
      "--source-plan", sourceRelative,
      "--manifest", manifestRelative,
      "--research-packet", packetRelative,
      "--authorization", authorizationRelative,
      "--owner-approval", ownerRelative,
      "--mapping-policy", mappingRelative,
    ]);
    assert.equal(result.status, "PENDING");
    assert.equal(result.ownerApprovalStatus, "PENDING");
    assert.equal(result.fixtureOnly, true);
    const savedOwner = JSON.parse(await readFile(outputs[2]!, "utf8")) as { status: string; authority: { sendAuthorized: boolean } };
    assert.equal(savedOwner.status, "PENDING");
    assert.equal(savedOwner.authority.sendAuthorized, false);
    await assert.rejects(
      preparePrivateKwM2AuthorizationFiles([
        "--source-plan", sourceRelative,
        "--manifest", manifestRelative,
        "--research-packet", packetRelative,
        "--authorization", authorizationRelative,
        "--owner-approval", ownerRelative,
        "--mapping-policy", mappingRelative,
      ]),
      /EEXIST|already exists/i,
    );
  } finally {
    await rm(sourceFile, { force: true });
    await rm(manifestFile, { force: true });
    await Promise.all(outputs.map((file) => rm(file, { force: true })));
  }
});

test("the M2 authorization CLI rejects free-form, duplicate, and database/network flags", async () => {
  await assert.rejects(
    preparePrivateKwM2AuthorizationFiles(["--source-plan", "data/kw-evaluation/a.json", "--manifest", "data/kw-evaluation/b.json", "--database", "data/kw-evaluation/a.sqlite"]),
    /Exactly|database|Usage/i,
  );
});
