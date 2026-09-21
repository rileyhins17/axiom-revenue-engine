import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
} from "@/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "@/lib/revenue-engine/private-kw-persistence-plan";
import {
  PRIVATE_KW_SHADOW_SLICE_SIZE,
  PRIVATE_KW_SHADOW_SLICE_VERSION,
  buildPrivateKwShadowSliceManifest,
} from "@/lib/revenue-engine/private-kw-shadow-slice";
import {
  PRIVATE_KW_M2_DATABASE_RECEIPT_VERSION,
  PRIVATE_KW_M2_OWNER_APPROVAL_VERSION,
  PrivateKwM2AssessmentMappingPolicySchema,
  PrivateKwM2DatabaseReceiptSchema,
  PrivateKwM2ResearchPacketSchema,
  assertPrivateKwM2ApprovalChain,
  buildPrivateKwM2AssessmentMappingPolicy,
  buildPrivateKwM2ExecutionAuthorization,
  buildPrivateKwM2OwnerApprovalCandidate,
  buildPrivateKwM2ResearchPacket,
  buildPrivateKwM2ResearchPolicy,
  privateKwM2DatabaseReceiptDigest,
  privateKwM2Digest,
  recordPrivateKwM2OwnerApproval,
} from "@/lib/revenue-engine/private-kw-m2-authorization";

const CITIES = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
const NICHES = ["ROOFING", "HVAC", "LANDSCAPING"] as const;

function sourceFixture() {
  return preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: "m2-task-1-source-2026-09",
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic M2 authorization candidates",
    filters: { synthetic: true },
    capturedAt: "2026-09-01T15:00:00.000Z",
    costUsd: 0,
    records: Array.from({ length: PRIVATE_KW_SHADOW_SLICE_SIZE }, (_, index) => ({
      sourceOwnedId: `m2-synthetic-${index + 1}`,
      sourceEvidenceUrl: `https://directory.getaxiom.ca/business-${index + 1}`,
      businessName: `Synthetic Independent Business ${index + 1}`,
      city: CITIES[index % CITIES.length],
      region: "ON" as const,
      country: "CA" as const,
      niche: NICHES[index % NICHES.length],
      websiteUrl: `https://business-${index + 1}.getaxiom.ca`,
      phone: null,
      addressLine: `${index + 1} Example Street`,
      postalCode: "N2G 1A1",
      independenceStatus: "INDEPENDENT" as const,
      capturedAt: "2026-09-01T14:00:00.000Z",
      sourcePayload: { synthetic: true },
    })),
  });
}

function manifestFixture(source: ReturnType<typeof sourceFixture>) {
  const sourcePlanDigest = buildPrivateKwPersistencePlan(source).sourcePlanDigest;
  return buildPrivateKwShadowSliceManifest(source, {
    sliceVersion: PRIVATE_KW_SHADOW_SLICE_VERSION,
    sliceKey: "m2-task-1-synthetic",
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
}

function chainFixture() {
  const sourcePlan = sourceFixture();
  const manifest = manifestFixture(sourcePlan);
  const researchPacket = buildPrivateKwM2ResearchPacket({
    manifest,
    sourcePlan,
    reviewedAt: "2026-09-03T15:00:00.000Z",
  });
  const authorization = buildPrivateKwM2ExecutionAuthorization({
    researchPacket,
    manifest,
    sourcePlan,
    websitePolicy: {
      version: "kw-m2-website-policy-v1",
      networkRequestCap: 20,
      expiresAt: "2026-09-10T15:00:00.000Z",
    },
  });
  const ownerCandidate = buildPrivateKwM2OwnerApprovalCandidate({
    researchPacket,
    authorization,
    manifest,
    sourcePlan,
  });
  return { sourcePlan, manifest, researchPacket, authorization, ownerCandidate };
}

test("builds an exact ten-business research packet with facts-only retention and no authority", () => {
  const { researchPacket } = chainFixture();

  assert.equal(researchPacket.candidates.length, 10);
  assert(researchPacket.candidates.every((candidate) => candidate.evidenceRetention === "DERIVED_FACTS_ONLY"));
  assert.equal(researchPacket.authority.liveSourceAuthorized, false);
  assert.equal(researchPacket.authority.providerOperationsAuthorized, 0);
  assert.equal(researchPacket.authority.costAuthorizedUsd, 0);
  assert.equal(researchPacket.packetId, `kw-m2-research:${researchPacket.packetDigest}`);
  assert.deepEqual(PrivateKwM2ResearchPacketSchema.parse(researchPacket), researchPacket);
});

test("rejects duplicate candidates, stale evidence, unresolved rights, and packet tampering", () => {
  const { researchPacket } = chainFixture();

  assert.throws(() => PrivateKwM2ResearchPacketSchema.parse({
    ...researchPacket,
    packetDigest: researchPacket.packetDigest,
    candidates: [researchPacket.candidates[0], ...researchPacket.candidates.slice(0, 9)],
  }), /unique|identity|digest/i);

  assert.throws(() => PrivateKwM2ResearchPacketSchema.parse({
    ...researchPacket,
    candidates: researchPacket.candidates.map((candidate, index) => index === 0
      ? { ...candidate, sourceRights: "UNKNOWN" }
      : candidate),
  }), /Invalid|rights|digest/i);

  assert.throws(() => PrivateKwM2ResearchPacketSchema.parse({
    ...researchPacket,
    candidates: researchPacket.candidates.map((candidate, index) => index === 0
      ? { ...candidate, sourceCapturedAt: "2026-09-04T15:00:00.000Z" }
      : candidate),
  }), /before|captured|digest/i);
});

test("binds pending authorization and rejects copied or changed upstream values", () => {
  const { sourcePlan, manifest, researchPacket, authorization, ownerCandidate } = chainFixture();

  assert.equal(authorization.status, "PENDING");
  assert.equal(authorization.researchPacketDigest, researchPacket.packetDigest);
  assert.throws(() => assertPrivateKwM2ApprovalChain({
    researchPacket: { ...researchPacket, packetId: "kw-m2-research:" + "a".repeat(64) },
    authorization,
    ownerEnvelope: ownerCandidate,
    manifest,
    sourcePlan,
    phase: "PREPARE",
  }), /research|digest|identity/i);

  assert.throws(() => assertPrivateKwM2ApprovalChain({
    researchPacket,
    authorization: { ...authorization, researchPacketDigest: "b".repeat(64) },
    ownerEnvelope: ownerCandidate,
    manifest,
    sourcePlan,
    phase: "PREPARE",
  }), /authorization|digest|research/i);

  const changedCore = {
    ...authorization,
    sourceDecisions: authorization.sourceDecisions.map((decision, index) => index === 0
      ? { ...decision, websiteUrl: null }
      : decision),
  };
  const { authorizationId: _authorizationId, authorizationDigest: _authorizationDigest, ...changedAuthorizationCore } = changedCore;
  void _authorizationId;
  void _authorizationDigest;
  const changedAuthorizationDigest = privateKwM2Digest(changedAuthorizationCore);
  assert.throws(() => assertPrivateKwM2ApprovalChain({
    researchPacket,
    authorization: {
      ...changedAuthorizationCore,
      authorizationId: `kw-m2-execution:${changedAuthorizationDigest}`,
      authorizationDigest: changedAuthorizationDigest,
    },
    ownerEnvelope: ownerCandidate,
    manifest,
    sourcePlan,
    phase: "PREPARE",
    now: "2026-09-05T15:00:00.000Z",
  }), /source decisions|research packet/i);
});

test("keeps owner approval pending until a separate exact decision records APPROVED", () => {
  const { manifest, sourcePlan, researchPacket, authorization, ownerCandidate } = chainFixture();

  assert.equal(ownerCandidate.ownerApprovalVersion, PRIVATE_KW_M2_OWNER_APPROVAL_VERSION);
  assert.equal(ownerCandidate.status, "PENDING");
  assert.throws(() => assertPrivateKwM2ApprovalChain({
    researchPacket,
    authorization,
    ownerEnvelope: ownerCandidate,
    manifest,
    sourcePlan,
    phase: "ROBOTS",
    now: "2026-09-05T15:00:00.000Z",
  }), /APPROVED|approval/i);

  const approved = recordPrivateKwM2OwnerApproval(ownerCandidate, {
    approver: "RILEY",
    reviewedAt: "2026-09-04T15:00:00.000Z",
    expiresAt: "2026-09-10T15:00:00.000Z",
    rationale: "Reviewed the exact synthetic packet and bounded local route.",
    dedicatedConfirmation: true,
  });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.ownerApprovalId, `kw-m2-owner-approval:${approved.ownerApprovalDigest}`);
  assert.doesNotThrow(() => assertPrivateKwM2ApprovalChain({
    researchPacket,
    authorization,
    ownerEnvelope: approved,
    manifest,
    sourcePlan,
    phase: "ROBOTS",
    now: "2026-09-05T15:00:00.000Z",
  }));
  assert.throws(() => recordPrivateKwM2OwnerApproval({ ...ownerCandidate, executionAuthorizationDigest: "c".repeat(64) }, {
    approver: "RILEY",
    reviewedAt: "2026-09-04T15:00:00.000Z",
    expiresAt: "2026-09-10T15:00:00.000Z",
    rationale: "Reviewed the exact synthetic packet and bounded local route.",
    dedicatedConfirmation: true,
  }), /digest|candidate|approval/i);

  assert.throws(() => recordPrivateKwM2OwnerApproval(ownerCandidate, {
    approver: "RILEY",
    reviewedAt: "2026-09-04T15:00:00.000Z",
    expiresAt: "2026-09-11T15:00:00.000Z",
    rationale: "Reviewed the exact synthetic packet and bounded local route.",
    dedicatedConfirmation: true,
  }), /expiry|authorization|candidate/i);

  const expired = recordPrivateKwM2OwnerApproval(ownerCandidate, {
    approver: "RILEY",
    reviewedAt: "2026-09-03T15:00:00.000Z",
    expiresAt: "2026-09-04T15:00:00.000Z",
    rationale: "Reviewed the exact synthetic packet and bounded local route.",
    dedicatedConfirmation: true,
  });
  assert.throws(() => assertPrivateKwM2ApprovalChain({
    researchPacket,
    authorization,
    ownerEnvelope: expired,
    manifest,
    sourcePlan,
    phase: "GET",
    now: "2026-09-05T15:00:00.000Z",
  }), /review window|expired|approval/i);
});

test("rejects an expired authorization even when a copied owner envelope appears valid, including exact expiry boundaries", () => {
  const { sourcePlan, manifest, researchPacket, authorization, ownerCandidate } = chainFixture();
  const approved = recordPrivateKwM2OwnerApproval(ownerCandidate, {
    approver: "RILEY",
    reviewedAt: "2026-09-04T15:00:00.000Z",
    expiresAt: "2026-09-10T15:00:00.000Z",
    rationale: "Reviewed the exact synthetic packet and bounded local route.",
    dedicatedConfirmation: true,
  });
  const expiredAuthorizationCore = {
    ...authorization,
    expiresAt: "2026-09-04T15:00:00.000Z",
  };
  const { authorizationId: _authorizationId, authorizationDigest: _authorizationDigest, ...expiredAuthorizationBody } = expiredAuthorizationCore;
  void _authorizationId;
  void _authorizationDigest;
  const expiredAuthorizationDigest = privateKwM2Digest(expiredAuthorizationBody);
  const expiredAuthorization = {
    ...expiredAuthorizationBody,
    authorizationId: `kw-m2-execution:${expiredAuthorizationDigest}`,
    authorizationDigest: expiredAuthorizationDigest,
  };
  assert.throws(() => assertPrivateKwM2ApprovalChain({
    researchPacket,
    authorization: expiredAuthorization,
    ownerEnvelope: approved,
    manifest,
    sourcePlan,
    phase: "GET",
    now: "2026-09-04T15:00:00.000Z",
  }), /authorization|expired|review window/i);
  assert.throws(() => assertPrivateKwM2ApprovalChain({
    researchPacket,
    authorization,
    ownerEnvelope: approved,
    manifest,
    sourcePlan,
    phase: "GET",
    now: "not-a-timestamp",
  }), /clock|datetime|time/i);
  assert.throws(() => assertPrivateKwM2ApprovalChain({
    researchPacket,
    authorization,
    ownerEnvelope: approved,
    manifest,
    sourcePlan,
    phase: "GET",
    now: "2026-09-04T15:00:00",
  }), /clock|datetime|time/i);
  assert.throws(() => assertPrivateKwM2ApprovalChain({
    researchPacket,
    authorization,
    ownerEnvelope: approved,
    manifest,
    sourcePlan,
    phase: "GET",
    now: "2026-09-04T14:00:00.000Z",
  }), /review window|reviewed|time/i);
});

test("rebuilds every material candidate field from canonical source and policy inputs", () => {
  const { sourcePlan, manifest, researchPacket, authorization, ownerCandidate } = chainFixture();
  const mutations: Array<[string, (candidate: typeof researchPacket.candidates[number]) => typeof candidate]> = [
    ["website URL", (candidate) => ({ ...candidate, websiteUrl: "https://changed.getaxiom.ca" })],
    ["source evidence URL", (candidate) => ({ ...candidate, sourceEvidenceUrl: "https://directory.getaxiom.ca/changed" })],
    ["source method", (candidate) => ({ ...candidate, sourceMethod: "LEGACY_READ_ONLY_EXPORT" })],
    ["captured time", (candidate) => ({ ...candidate, sourceCapturedAt: "2026-08-31T14:00:00.000Z" })],
    ["source rights", (candidate) => ({ ...candidate, sourceRights: "PUBLIC_SOURCE_DERIVED" })],
    ["terms", (candidate) => ({ ...candidate, termsDecision: "TERMS_REVIEWED_FOR_FACTS" })],
    ["robots", (candidate) => ({ ...candidate, robotsDecision: "ROBOTS_REVIEWED_PUBLIC_ONLY" })],
    ["retention", (candidate) => ({ ...candidate, evidenceRetention: "RAW_HTML_ALLOWED" })],
    ["review date", (candidate) => ({ ...candidate, retentionReviewDate: "2026-09-04T15:00:00.000Z" })],
    ["stop conditions", (candidate) => ({ ...candidate, stopConditions: ["OUT_OF_SCOPE"] })],
  ];
  for (const [label, mutate] of mutations) {
    const mutatedCandidates = researchPacket.candidates.map((candidate, index) => index === 0 ? mutate(candidate) : candidate);
    const countsByCity = {
      KITCHENER: mutatedCandidates.filter((candidate) => candidate.city === "KITCHENER").length,
      WATERLOO: mutatedCandidates.filter((candidate) => candidate.city === "WATERLOO").length,
      CAMBRIDGE: mutatedCandidates.filter((candidate) => candidate.city === "CAMBRIDGE").length,
    };
    const countsByNiche = {
      ROOFING: mutatedCandidates.filter((candidate) => candidate.niche === "ROOFING").length,
      HVAC: mutatedCandidates.filter((candidate) => candidate.niche === "HVAC").length,
      LANDSCAPING: mutatedCandidates.filter((candidate) => candidate.niche === "LANDSCAPING").length,
    };
    const { packetId: _packetId, packetDigest: _packetDigest, ...packetBody } = {
      ...researchPacket,
      candidates: mutatedCandidates,
      summary: { ...researchPacket.summary, countsByCity, countsByNiche },
    };
    void _packetId;
    void _packetDigest;
    const packetDigest = privateKwM2Digest(packetBody);
    const mutatedPacket = {
      ...packetBody,
      packetId: `kw-m2-research:${packetDigest}`,
      packetDigest,
    };
    assert.throws(() => assertPrivateKwM2ApprovalChain({
      researchPacket: mutatedPacket,
      authorization,
      ownerEnvelope: ownerCandidate,
      manifest,
      sourcePlan,
      phase: "PREPARE",
      now: "2026-09-05T15:00:00.000Z",
    }), new RegExp(`${label}|summary`, "i"));
  }
});

test("rejects redigested identity, review, and independence-field tampering", () => {
  const { sourcePlan, manifest, researchPacket, authorization, ownerCandidate } = chainFixture();
  const mutations: Array<[string, (candidate: typeof researchPacket.candidates[number]) => typeof candidate]> = [
    ["business ID", (candidate) => ({ ...candidate, businessId: "changed-business" })],
    ["evaluation candidate ID", (candidate) => ({ ...candidate, evaluationCandidateId: "changed-candidate" })],
    ["business name", (candidate) => ({ ...candidate, businessName: "Changed Business" })],
    ["city", (candidate) => ({ ...candidate, city: "WATERLOO" })],
    ["niche", (candidate) => ({ ...candidate, niche: "HVAC" })],
    ["review time", (candidate) => ({ ...candidate, sourceReviewedAt: "2026-09-02T15:00:00.000Z" })],
  ];
  for (const [label, mutate] of mutations) {
    const mutatedCandidates = researchPacket.candidates.map((candidate, index) => index === 0 ? mutate(candidate) : candidate);
    const { packetId: _packetId, packetDigest: _packetDigest, ...packetBody } = { ...researchPacket, candidates: mutatedCandidates };
    void _packetId;
    void _packetDigest;
    const packetDigest = privateKwM2Digest(packetBody);
    assert.throws(() => assertPrivateKwM2ApprovalChain({
      researchPacket: {
        ...packetBody,
        packetId: `kw-m2-research:${packetDigest}`,
        packetDigest,
      },
      authorization,
      ownerEnvelope: ownerCandidate,
      manifest,
      sourcePlan,
      phase: "PREPARE",
      now: "2026-09-05T15:00:00.000Z",
    }), new RegExp(`${label}|summary`, "i"));
  }
  const independenceTamper = {
    ...researchPacket,
    candidates: researchPacket.candidates.map((candidate, index) => index === 0 ? { ...candidate, independenceStatus: "CHAIN" } : candidate),
  };
  assert.throws(() => PrivateKwM2ResearchPacketSchema.parse(independenceTamper), /Invalid|independence/i);
});

test("allows each explicit retention decision while preserving the same zero-authority chain", () => {
  const sourcePlan = sourceFixture();
  const manifest = manifestFixture(sourcePlan);
  for (const evidenceRetention of ["RAW_HTML_ALLOWED", "DERIVED_FACTS_ONLY", "BLOCKED"] as const) {
    const researchPacket = buildPrivateKwM2ResearchPacket({
      manifest,
      sourcePlan,
      reviewedAt: "2026-09-03T15:00:00.000Z",
      retentionDecisions: sourcePlan.records.map((record) => ({ businessId: record.business.id, evidenceRetention })),
    });
    assert(researchPacket.candidates.every((candidate) => candidate.evidenceRetention === evidenceRetention));
    assert.equal(researchPacket.authority.sendAuthorized, false);
    assert.equal(researchPacket.authority.providerOperationsAuthorized, 0);
  }
});

test("accepts explicit reviewed rights, terms, robots, and retention policy branches", () => {
  const sourcePlan = sourceFixture();
  const manifest = manifestFixture(sourcePlan);
  const policyDecisions = sourcePlan.records.map((record) => ({
    businessId: record.business.id,
    sourceRights: "PUBLIC_SOURCE_DERIVED" as const,
    termsDecision: "TERMS_REVIEWED_FOR_FACTS" as const,
    robotsDecision: "ROBOTS_REVIEWED_PUBLIC_ONLY" as const,
    evidenceRetention: "BLOCKED" as const,
    retentionReviewDate: "2026-09-03T15:00:00.000Z",
    stopConditions: ["OUT_OF_SCOPE"] as const,
  }));
  const policy = buildPrivateKwM2ResearchPolicy({ manifest, reviewedAt: "2026-09-03T15:00:00.000Z", policyDecisions });
  const researchPacket = buildPrivateKwM2ResearchPacket({ manifest, sourcePlan, reviewedAt: "2026-09-03T15:00:00.000Z", policyDecisions });
  const authorization = buildPrivateKwM2ExecutionAuthorization({
    researchPacket,
    manifest,
    sourcePlan,
    researchPolicy: policy,
    websitePolicy: { version: "kw-m2-website-policy-v1", networkRequestCap: 20, expiresAt: "2026-09-10T15:00:00.000Z" },
  });
  const ownerCandidate = buildPrivateKwM2OwnerApprovalCandidate({ researchPacket, authorization, manifest, sourcePlan, researchPolicy: policy });
  assert(researchPacket.candidates.every((candidate) => candidate.sourceRights === "PUBLIC_SOURCE_DERIVED" && candidate.termsDecision === "TERMS_REVIEWED_FOR_FACTS" && candidate.robotsDecision === "ROBOTS_REVIEWED_PUBLIC_ONLY" && candidate.evidenceRetention === "BLOCKED"));
  assert.doesNotThrow(() => assertPrivateKwM2ApprovalChain({ researchPacket, authorization, ownerEnvelope: ownerCandidate, manifest, sourcePlan, researchPolicy: policy, phase: "PREPARE", now: "2026-09-05T15:00:00.000Z" }));
});

test("keeps the mapping policy fixture-only and verifies the database receipt contract", () => {
  const mapping = buildPrivateKwM2AssessmentMappingPolicy({
    fieldNames: ["websiteOutcome", "limitations", "sourceProvenance"],
    outcomeVocabulary: ["COMPLETE", "PARTIAL", "BLOCKED", "RESEARCH_REQUIRED"],
    limitationVocabulary: ["NO_BROWSER", "NO_R2", "NO_CONTACT"],
  });
  assert.equal(mapping.fixtureOnly, true);
  assert.equal(mapping.productionAssessmentApprovalAuthorized, false);
  assert.deepEqual(PrivateKwM2AssessmentMappingPolicySchema.parse(mapping), mapping);

  const receiptCore = {
    receiptVersion: PRIVATE_KW_M2_DATABASE_RECEIPT_VERSION,
    databasePath: "data/kw-evaluation/m2-task-1.sqlite",
    fileIdentity: {
      device: "fixture-device",
      inode: "fixture-inode",
      byteLength: 1234,
      modificationMarker: "2026-09-03T15:00:00.000Z",
      sha256: "d".repeat(64),
    },
    schemaDigest: "e".repeat(64),
    migrationRange: "0054-0068",
    migrationFiles: ["0054_example.sql", "0068_example.sql"],
    migrationsCommit: "f".repeat(40),
    backupRestore: {
      backupPath: "data/kw-evaluation/m2-task-1-backup.sqlite",
      backupSha256: "1".repeat(64),
      restoreVerified: true,
      evidenceDigest: "2".repeat(64),
    },
    authority: {
      localOnly: true,
      remoteMigrationAuthorized: false,
      sqlExecutionAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  } as const;
  const receiptDigest = privateKwM2DatabaseReceiptDigest(receiptCore);
  const receipt = PrivateKwM2DatabaseReceiptSchema.parse({
    ...receiptCore,
    receiptId: `kw-m2-database:${receiptDigest}`,
    receiptDigest,
  });
  assert.equal(receipt.receiptId, `kw-m2-database:${receipt.receiptDigest}`);
});
