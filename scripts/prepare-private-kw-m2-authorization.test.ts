import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PRIVATE_KW_IMPORT_VERSION, preparePrivateKwImport } from "../src/lib/revenue-engine/private-kw-import";
import {
  PrivateKwM2ExecutionAuthorizationSchema,
  PrivateKwM2OwnerApprovalEnvelopeSchema,
  PrivateKwM2ResearchPacketSchema,
} from "../src/lib/revenue-engine/private-kw-m2-authorization";
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
  const reviewRelative = `data/kw-evaluation/m2-task-1-review-${suffix}.json`;
  const sourceFile = resolvePrivateKwDataPath(sourceRelative);
  const manifestFile = resolvePrivateKwDataPath(manifestRelative);
  const outputs = [packetRelative, authorizationRelative, ownerRelative, mappingRelative].map(resolvePrivateKwDataPath);
  const reviewFile = resolvePrivateKwDataPath(reviewRelative);
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
    const reviewPolicy = {
      reviewVersion: "kw-m2-authorization-review-v1",
      preparedAt: "2026-09-04T15:00:00.000Z",
      websitePolicy: { version: "kw-m2-website-policy-v1", networkRequestCap: 20, expiresAt: "2026-09-10T15:00:00.000Z" },
      researchPolicy: { policyVersion: "kw-m2-research-policy-v1", decisions: source.records.map((record, index) => ({
        businessId: record.business.id, sourceRights: index === 0 ? "PUBLIC_SOURCE_DERIVED" : "PUBLIC_SOURCE_REVIEWED",
        termsDecision: "PUBLIC_REVIEW_ONLY", robotsDecision: "PREFLIGHT_REQUIRED_BEFORE_FETCH",
        evidenceRetention: index === 0 ? "RAW_HTML_ALLOWED" : "DERIVED_FACTS_ONLY",
        retentionReviewDate: "2026-10-01T15:00:00.000Z",
        stopConditions: ["AMBIGUOUS_IDENTITY", "ROBOTS_OR_TERMS_UNCLEAR", "SOURCE_RIGHTS_UNCLEAR"],
      })) },
    };
    await writeFile(reviewFile, `${JSON.stringify(reviewPolicy)}\n`, { encoding: "utf8", flag: "wx" });
    const argsFor = (reviewPath: string, includeReview = true) => [
      "--source-plan", sourceRelative, "--manifest", manifestRelative,
      "--research-packet", packetRelative, "--authorization", authorizationRelative,
      "--owner-approval", ownerRelative, "--mapping-policy", mappingRelative,
      ...(includeReview ? ["--review-policy", reviewPath] : []),
    ];
    const assertOutputsAbsent = async () => {
      for (const file of outputs) await assert.rejects(readFile(file), { code: "ENOENT" });
    };
    const invalidCases: Array<{ name: string; value?: unknown; includeReview?: boolean; clock?: Date }> = [
      { name: "expired authorization", value: { ...reviewPolicy, websitePolicy: { ...reviewPolicy.websitePolicy, expiresAt: "2026-09-04T16:00:00.000Z" } } },
      { name: "expiry before preparedAt", value: { ...reviewPolicy, websitePolicy: { ...reviewPolicy.websitePolicy, expiresAt: "2026-09-04T14:00:00.000Z" } } },
      { name: "expired retention", value: { ...reviewPolicy, researchPolicy: { ...reviewPolicy.researchPolicy, decisions: reviewPolicy.researchPolicy.decisions.map((decision, index) => index === 0 ? { ...decision, retentionReviewDate: "2026-09-03T15:00:00.000Z" } : decision) } } },
      { name: "missing source rights", value: { ...reviewPolicy, researchPolicy: { ...reviewPolicy.researchPolicy, decisions: reviewPolicy.researchPolicy.decisions.map((decision, index) => index === 0 ? (() => { const { sourceRights, ...rest } = decision; void sourceRights; return rest; })() : decision) } } },
      { name: "unknown property", value: { ...reviewPolicy, unexpected: true } },
      { name: "duplicate business IDs", value: { ...reviewPolicy, researchPolicy: { ...reviewPolicy.researchPolicy, decisions: reviewPolicy.researchPolicy.decisions.map((decision, index) => index === 1 ? { ...decision, businessId: reviewPolicy.researchPolicy.decisions[0]!.businessId } : decision) } } },
      { name: "mismatched business ID", value: { ...reviewPolicy, researchPolicy: { ...reviewPolicy.researchPolicy, decisions: reviewPolicy.researchPolicy.decisions.map((decision, index) => index === 0 ? { ...decision, businessId: "not-in-manifest" } : decision) } } },
      { name: "missing review flag", includeReview: false },
      { name: "invalid clock", value: reviewPolicy, clock: new Date(Number.NaN) },
    ];
    for (const invalid of invalidCases) {
      const invalidRelative = `data/kw-evaluation/m2-task-1-invalid-${suffix}-${invalid.name.replaceAll(" ", "-")}.json`;
      const invalidFile = resolvePrivateKwDataPath(invalidRelative);
      if (invalid.value !== undefined) await writeFile(invalidFile, `${JSON.stringify(invalid.value)}\n`, { encoding: "utf8", flag: "wx" });
      await assert.rejects(
        preparePrivateKwM2AuthorizationFiles(argsFor(invalidRelative, invalid.includeReview), invalid.clock ?? new Date("2026-09-04T16:00:00.000Z")),
      );
      await assertOutputsAbsent();
      await rm(invalidFile, { force: true });
    }
    const futureReviewRelative = `data/kw-evaluation/m2-task-1-future-review-${suffix}.json`;
    const futureReviewFile = resolvePrivateKwDataPath(futureReviewRelative);
    await writeFile(futureReviewFile, `${JSON.stringify({ ...reviewPolicy, preparedAt: "2026-09-05T15:00:00.000Z" })}\n`, { encoding: "utf8", flag: "wx" });
    await assert.rejects(
      preparePrivateKwM2AuthorizationFiles([
        "--source-plan", sourceRelative, "--manifest", manifestRelative,
        "--research-packet", packetRelative, "--authorization", authorizationRelative,
        "--owner-approval", ownerRelative, "--mapping-policy", mappingRelative,
        "--review-policy", futureReviewRelative,
      ], new Date("2026-09-04T16:00:00.000Z")), /future/i,
    );
    await assertOutputsAbsent();
    await rm(futureReviewFile, { force: true });
    const result = await preparePrivateKwM2AuthorizationFiles(argsFor(reviewRelative), new Date("2026-09-04T16:00:00.000Z"));
    assert.equal(result.status, "PENDING");
    assert.equal(result.ownerApprovalStatus, "PENDING");
    assert.equal(result.fixtureOnly, true);
    const savedOwner = PrivateKwM2OwnerApprovalEnvelopeSchema.parse(JSON.parse(await readFile(outputs[2]!, "utf8")));
    assert.equal(savedOwner.status, "PENDING");
    assert.equal(savedOwner.authority.sendAuthorized, false);
    const savedPacket = PrivateKwM2ResearchPacketSchema.parse(JSON.parse(await readFile(outputs[0]!, "utf8")));
    const savedAuthorization = PrivateKwM2ExecutionAuthorizationSchema.parse(JSON.parse(await readFile(outputs[1]!, "utf8")));
    assert.equal(savedPacket.createdAt, reviewPolicy.preparedAt);
    assert.equal(savedAuthorization.createdAt, reviewPolicy.preparedAt);
    assert.equal(savedAuthorization.expiresAt, reviewPolicy.websitePolicy.expiresAt);
    assert.equal(savedOwner.expiresAt, reviewPolicy.websitePolicy.expiresAt);
    assert.equal(savedAuthorization.websitePolicyVersion, reviewPolicy.websitePolicy.version);
    assert.equal(savedAuthorization.networkRequestCap, reviewPolicy.websitePolicy.networkRequestCap);
    for (const decision of reviewPolicy.researchPolicy.decisions) {
      const candidate = savedPacket.candidates.find((item) => item.businessId === decision.businessId);
      const authorized = savedAuthorization.sourceDecisions.find((item) => item.businessId === decision.businessId);
      assert.ok(candidate);
      assert.ok(authorized);
      for (const [field, value] of Object.entries(decision)) {
        assert.deepEqual(Reflect.get(candidate, field), value);
        if (field !== "retentionReviewDate") assert.deepEqual(Reflect.get(authorized, field), value);
      }
    }
    assert.equal(savedOwner.executionAuthorizationId, savedAuthorization.authorizationId);
    assert.equal(savedOwner.executionAuthorizationDigest, savedAuthorization.authorizationDigest);
    for (const authority of [savedPacket.authority, savedAuthorization.authority, savedOwner.authority]) assert.ok(Object.values(authority).every((value) => value === false || value === 0));
    await assert.rejects(
      preparePrivateKwM2AuthorizationFiles([
        "--source-plan", sourceRelative,
        "--manifest", manifestRelative,
        "--research-packet", packetRelative,
        "--authorization", authorizationRelative,
        "--owner-approval", ownerRelative,
        "--mapping-policy", mappingRelative,
        "--review-policy", reviewRelative,
      ], new Date("2026-09-04T16:00:00.000Z")),
      /EEXIST|already exists/i,
    );
  } finally {
    await rm(sourceFile, { force: true });
    await rm(manifestFile, { force: true });
    await rm(reviewFile, { force: true });
    await rm(resolvePrivateKwDataPath(`data/kw-evaluation/m2-task-1-future-review-${suffix}.json`), { force: true });
    await Promise.all(outputs.map((file) => rm(file, { force: true })));
  }
});

test("the M2 authorization CLI rejects free-form, duplicate, and database/network flags", async () => {
  await assert.rejects(
    preparePrivateKwM2AuthorizationFiles(["--source-plan", "data/kw-evaluation/a.json", "--manifest", "data/kw-evaluation/b.json", "--database", "data/kw-evaluation/a.sqlite"]),
    /Exactly|database|Usage/i,
  );
});
