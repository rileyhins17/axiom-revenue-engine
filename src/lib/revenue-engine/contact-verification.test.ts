import assert from "node:assert/strict";
import test from "node:test";

import {
  REVENUE_CONTACT_DISCOVERY_VERSION,
  REVENUE_CONTACT_EVIDENCE_VERSION,
  buildFixtureContactDiscoveryResult,
  contactDiscoveryDigest,
  type RevenueContactDiscoveryCandidate,
  type RevenueContactDiscoveryRequest,
  type RevenueContactObservation,
} from "@/lib/revenue-engine/contact-discovery";
import {
  REVENUE_CONTACT_VERIFICATION_VERSION,
  RevenueContactVerificationResultSchema,
  buildFixtureContactVerificationResult,
  contactVerificationResultMatchesCandidate,
  contactVerificationResultMatchesRequest,
  type RevenueContactVerificationObservation,
  type RevenueContactVerificationRequest,
} from "@/lib/revenue-engine/contact-verification";

const REQUESTED_AT = "2026-08-27T13:00:00.000Z";
const VERIFIED_AT = "2026-08-27T13:02:00.000Z";
const STALE_AFTER = "2026-09-26T13:02:00.000Z";
const COMPLETED_AT = "2026-08-27T13:03:00.000Z";

function discoveryRequest(): RevenueContactDiscoveryRequest {
  return {
    discoveryVersion: REVENUE_CONTACT_DISCOVERY_VERSION,
    requestId: `contact-discovery-request:${"a".repeat(64)}`,
    idempotencyKey: "kw-roofing-contact-fixture-1",
    businessId: "business-kw-roofing",
    websiteUrl: "https://kwroofing.ca/",
    sourceEvidenceUrl: "https://directory.example.ca/business/kw-roofing",
    requestedAt: "2026-08-27T12:50:00.000Z",
    mode: "SHADOW",
    adapterKind: "FIXTURE",
    limits: { maxCandidates: 10, maxProviderOperations: 0, maxCostUsd: 0 },
    authority: {
      runtimeConnected: false,
      contactPersistenceAuthorized: false,
      verificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
}

function candidateObservation(
  channel: RevenueContactObservation["channel"] = "EMAIL",
  overrides: Partial<RevenueContactObservation> = {},
): RevenueContactObservation {
  const byChannel: Record<RevenueContactObservation["channel"], Pick<RevenueContactObservation, "value" | "label" | "personName" | "role" | "recipientKind" | "socialPlatform"> & { method: RevenueContactObservation["evidence"]["method"] }> = {
    EMAIL: { value: "estimates@kwroofing.ca", label: "Estimator", personName: null, role: "Estimator", recipientKind: "ROLE", socialPlatform: null, method: "HTML_MAILTO" },
    PHONE: { value: "+15195552345", label: "Main phone", personName: null, role: null, recipientKind: "BUSINESS", socialPlatform: null, method: "HTML_TEL" },
    FORM: { value: "https://kwroofing.ca/contact", label: "Quote form", personName: null, role: null, recipientKind: "BUSINESS", socialPlatform: null, method: "HTML_FORM" },
    SOCIAL: { value: "https://www.instagram.com/kwroofing/", label: "Instagram", personName: null, role: null, recipientKind: "BUSINESS", socialPlatform: "INSTAGRAM", method: "HTML_SOCIAL_LINK" },
  };
  const base = byChannel[channel];
  return {
    channel,
    value: base.value,
    label: base.label,
    personName: base.personName,
    role: base.role,
    recipientKind: base.recipientKind,
    socialPlatform: base.socialPlatform,
    evidence: {
      evidenceVersion: REVENUE_CONTACT_EVIDENCE_VERSION,
      sourceUrl: "https://kwroofing.ca/contact",
      capturedAt: "2026-08-27T12:55:00.000Z",
      method: base.method,
      observation: `The public website exposes a ${channel.toLocaleLowerCase("en-CA")} route.`,
      confidence: 98,
      publication: {
        publiclyPublished: true,
        contraryContactStatement: "NOT_OBSERVED",
        roleRelevance: "RELEVANT",
        consentBasis: "UNASSESSED",
      },
    },
    ...overrides,
  } as RevenueContactObservation;
}

function candidate(
  channel: RevenueContactObservation["channel"] = "EMAIL",
  overrides: Partial<RevenueContactObservation> = {},
): RevenueContactDiscoveryCandidate {
  return buildFixtureContactDiscoveryResult({
    request: discoveryRequest(),
    observations: [candidateObservation(channel, overrides)],
    completedAt: "2026-08-27T12:56:00.000Z",
  }).candidates[0]!;
}

function request(
  contactCandidate: RevenueContactDiscoveryCandidate,
  overrides: Partial<RevenueContactVerificationRequest> = {},
): RevenueContactVerificationRequest {
  return {
    verificationVersion: REVENUE_CONTACT_VERIFICATION_VERSION,
    requestId: `contact-verification-request:${"b".repeat(64)}`,
    idempotencyKey: `verify-${contactCandidate.candidateId}`,
    businessId: contactCandidate.businessId,
    candidate: contactCandidate,
    requestedAt: REQUESTED_AT,
    mode: "SHADOW",
    verifierKind: "FIXTURE",
    limits: { maxProviderOperations: 0, maxCostUsd: 0 },
    authority: {
      runtimeConnected: false,
      verificationPersistenceAuthorized: false,
      qualificationPersistenceAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
    ...overrides,
  };
}

function verificationObservation(
  channel: RevenueContactVerificationObservation["channel"] = "EMAIL",
  overrides: Partial<RevenueContactVerificationObservation> = {},
): RevenueContactVerificationObservation {
  const status = channel === "EMAIL" ? "DELIVERABLE"
    : channel === "PHONE" ? "PUBLISHED"
      : channel === "FORM" ? "AVAILABLE"
        : "ACTIVE";
  return {
    channel,
    status,
    ...(channel === "EMAIL" ? { catchAll: false } : {}),
    provider: "FIXTURE",
    method: "FIXTURE_RECEIPT",
    evidenceReceiptId: `fixture-verification:${channel.toLocaleLowerCase("en-CA")}-1`,
    sourceUrl: "https://verification.example.ca/receipts/fixture-1",
    verifiedAt: VERIFIED_AT,
    staleAfter: STALE_AFTER,
    confidence: 99,
    ...overrides,
  } as RevenueContactVerificationObservation;
}

test("a deliverable relevant email becomes owner-reviewable but never autonomous", () => {
  const contactCandidate = candidate();
  const result = buildFixtureContactVerificationResult({
    request: request(contactCandidate),
    observation: verificationObservation(),
    completedAt: COMPLETED_AT,
  });

  assert.equal(result.ownerProjection.status, "VERIFIED");
  assert.equal(result.ownerProjection.emailVerification?.status, "DELIVERABLE");
  assert.equal(result.usableRoute, true);
  assert.equal(result.recommendedAction, "REVIEW_EMAIL");
  assert.equal(result.consentBasis, "UNASSESSED");
  assert.equal(result.complianceReviewRequired, true);
  assert.equal(result.autonomousEmailEligible, false);
  assert.equal(result.authority.verificationPersistenceAuthorized, false);
  assert.equal(result.authority.outreachAuthorized, false);
  assert.equal(result.authority.sendAuthorized, false);
  assert.equal(contactVerificationResultMatchesCandidate(result, contactCandidate), true);
  assert.equal(contactVerificationResultMatchesRequest(result, request(contactCandidate)), true);
  assert.equal(contactVerificationResultMatchesRequest(result, request(contactCandidate, { idempotencyKey: "different-verification-key" })), false);
});

test("deliverability cannot make a generic business inbox owner-ready", () => {
  const contactCandidate = candidate("EMAIL", {
    value: "hello@kwroofing.ca",
    role: null,
    recipientKind: "BUSINESS",
  });
  const result = buildFixtureContactVerificationResult({
    request: request(contactCandidate),
    observation: verificationObservation(),
    completedAt: COMPLETED_AT,
  });

  assert.equal(result.ownerProjection.status, "CANDIDATE");
  assert.equal(result.usableRoute, false);
  assert.equal(result.recommendedAction, "RESEARCH");
});

test("catch-all and unknown email verification remain research-only", () => {
  const contactCandidate = candidate();
  for (const observation of [
    verificationObservation("EMAIL", { status: "CATCH_ALL", catchAll: true }),
    verificationObservation("EMAIL", { status: "UNKNOWN", catchAll: false }),
  ]) {
    const result = buildFixtureContactVerificationResult({
      request: request(contactCandidate),
      observation,
      completedAt: COMPLETED_AT,
    });
    assert.equal(result.ownerProjection.status, "CANDIDATE");
    assert.equal(result.usableRoute, false);
    assert.equal(result.recommendedAction, "RESEARCH");
  }
});

test("positive phone, form, and social evidence creates manual routes only", () => {
  const expectations = [
    ["PHONE", "MANUAL_PHONE"],
    ["FORM", "MANUAL_FORM"],
    ["SOCIAL", "MANUAL_SOCIAL"],
  ] as const;

  for (const [channel, recommendedAction] of expectations) {
    const contactCandidate = candidate(channel);
    const result = buildFixtureContactVerificationResult({
      request: request(contactCandidate),
      observation: verificationObservation(channel),
      completedAt: COMPLETED_AT,
    });
    assert.equal(result.ownerProjection.status, "USABLE");
    assert.equal(result.ownerProjection.emailVerification, null);
    assert.equal(result.ownerProjection.automationPermitted, false);
    assert.equal(result.usableRoute, true);
    assert.equal(result.recommendedAction, recommendedAction);
    assert.equal(result.autonomousEmailEligible, false);
  }
});

test("negative and unknown non-email checks cannot create a manual action", () => {
  const phoneCandidate = candidate("PHONE");
  for (const status of ["UNAVAILABLE", "UNKNOWN"] as const) {
    const result = buildFixtureContactVerificationResult({
      request: request(phoneCandidate),
      observation: verificationObservation("PHONE", { status }),
      completedAt: COMPLETED_AT,
    });
    assert.equal(result.usableRoute, false);
    assert.equal(result.ownerProjection.status, status === "UNAVAILABLE" ? "INVALID" : "CANDIDATE");
    assert.equal(result.recommendedAction, "RESEARCH");
  }
});

test("cross-business and cross-channel verification fail before projection", () => {
  const emailCandidate = candidate();
  assert.throws(() => buildFixtureContactVerificationResult({
    request: request(emailCandidate, { businessId: "another-business" }),
    observation: verificationObservation(),
    completedAt: COMPLETED_AT,
  }), /business and candidate identities/i);

  assert.throws(() => buildFixtureContactVerificationResult({
    request: request(emailCandidate),
    observation: verificationObservation("PHONE"),
    completedAt: COMPLETED_AT,
  }), /channel must match/i);
});

test("verification freshness, sequence, catch-all semantics, and public evidence fail closed", () => {
  const emailCandidate = candidate();
  assert.throws(() => buildFixtureContactVerificationResult({
    request: request(emailCandidate),
    observation: verificationObservation("EMAIL", { staleAfter: "2026-10-27T13:02:00.000Z" }),
    completedAt: COMPLETED_AT,
  }), /no longer than 30 days/i);

  assert.throws(() => buildFixtureContactVerificationResult({
    request: request(emailCandidate),
    observation: verificationObservation("EMAIL", {
      verifiedAt: "2026-08-27T12:59:00.000Z",
      staleAfter: "2026-09-26T12:59:00.000Z",
    }),
    completedAt: COMPLETED_AT,
  }), /cannot predate/i);

  assert.throws(() => buildFixtureContactVerificationResult({
    request: request(emailCandidate),
    observation: verificationObservation("EMAIL", { status: "CATCH_ALL", catchAll: false }),
    completedAt: COMPLETED_AT,
  }), /catch-all state/i);

  assert.throws(() => buildFixtureContactVerificationResult({
    request: request(emailCandidate),
    observation: verificationObservation("EMAIL", { sourceUrl: "http://localhost/receipt" }),
    completedAt: COMPLETED_AT,
  }), /canonical public source URL/i);
});

test("candidate digest binding and derived result semantics resist redigested drift", () => {
  const contactCandidate = candidate();
  const result = buildFixtureContactVerificationResult({
    request: request(contactCandidate),
    observation: verificationObservation(),
    completedAt: COMPLETED_AT,
  });
  assert.equal(contactVerificationResultMatchesCandidate(result, { ...contactCandidate, label: "Forged label" }), false);

  const drifted = { ...result, usableRoute: false };
  const { verificationResultDigest: _digest, verificationResultId: _id, ...core } = drifted;
  void _digest;
  void _id;
  const digest = contactDiscoveryDigest(core);
  assert.throws(() => RevenueContactVerificationResultSchema.parse({
    ...drifted,
    verificationResultDigest: digest,
    verificationResultId: `contact-verification-result:${digest}`,
  }), /route semantics/i);
});
