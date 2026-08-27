import assert from "node:assert/strict";
import test from "node:test";

import {
  REVENUE_CONTACT_DISCOVERY_VERSION,
  REVENUE_CONTACT_EVIDENCE_VERSION,
  RevenueContactDiscoveryResultSchema,
  buildFixtureContactDiscoveryResult,
  contactDiscoveryDigest,
  contactDiscoveryResultMatchesRequest,
  type RevenueContactDiscoveryRequest,
  type RevenueContactObservation,
} from "@/lib/revenue-engine/contact-discovery";

const REQUESTED_AT = "2026-08-27T13:00:00.000Z";
const COMPLETED_AT = "2026-08-27T13:01:00.000Z";

function request(overrides: Partial<RevenueContactDiscoveryRequest> = {}): RevenueContactDiscoveryRequest {
  return {
    discoveryVersion: REVENUE_CONTACT_DISCOVERY_VERSION,
    requestId: `contact-discovery-request:${"a".repeat(64)}`,
    idempotencyKey: "kw-roofing-contact-fixture-1",
    businessId: "business-kw-roofing",
    websiteUrl: "https://kwroofing.ca/",
    sourceEvidenceUrl: "https://directory.example.ca/business/kw-roofing",
    requestedAt: REQUESTED_AT,
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
    ...overrides,
  };
}

function observation(overrides: Partial<RevenueContactObservation> = {}): RevenueContactObservation {
  return {
    channel: "EMAIL",
    value: "Estimates@KWRoofing.ca",
    label: "Estimate requests",
    personName: null,
    role: "Estimator",
    recipientKind: "ROLE",
    socialPlatform: null,
    evidence: {
      evidenceVersion: REVENUE_CONTACT_EVIDENCE_VERSION,
      sourceUrl: "https://kwroofing.ca/contact",
      capturedAt: "2026-08-27T12:59:00.000Z",
      method: "HTML_MAILTO",
      observation: "The public contact page displays the address for estimate requests.",
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

test("discovery canonicalizes all supported channels and preserves every evidence claim", () => {
  const observations: RevenueContactObservation[] = [
    observation(),
    observation({
      label: "Website footer",
      evidence: {
        ...observation().evidence,
        sourceUrl: "https://kwroofing.ca/",
        method: "HTML_TEXT",
        observation: "The same estimate address appears in the public website footer.",
      },
    }),
    observation({
      channel: "PHONE",
      value: "(519) 555-2345",
      label: "Main phone",
      role: null,
      recipientKind: "BUSINESS",
      evidence: {
        ...observation().evidence,
        method: "HTML_TEL",
        observation: "The public contact page exposes a tap-to-call main number.",
      },
    }),
    observation({
      channel: "FORM",
      value: "https://kwroofing.ca/contact#quote",
      label: "Quote form",
      role: null,
      recipientKind: "BUSINESS",
      evidence: {
        ...observation().evidence,
        method: "HTML_FORM",
        observation: "The public contact page contains a quote form.",
      },
    }),
    observation({
      channel: "SOCIAL",
      value: "https://www.instagram.com/kwroofing/#profile",
      label: "Instagram",
      role: null,
      recipientKind: "BUSINESS",
      socialPlatform: "INSTAGRAM",
      evidence: {
        ...observation().evidence,
        method: "HTML_SOCIAL_LINK",
        observation: "The public website links to the business Instagram profile.",
      },
    }),
  ];

  const result = buildFixtureContactDiscoveryResult({ request: request(), observations, completedAt: COMPLETED_AT });

  assert.deepEqual(result.channelsWithCandidates, ["EMAIL", "PHONE", "FORM", "SOCIAL"]);
  assert.equal(result.candidates.length, 4);
  assert.equal(result.candidates[0]!.value, "estimates@kwroofing.ca");
  assert.equal(result.candidates[0]!.evidenceClaims.length, 2);
  assert.equal(result.candidates[1]!.value, "+15195552345");
  assert.equal(result.candidates[2]!.value, "https://kwroofing.ca/contact");
  assert.equal(result.candidates[3]!.value, "https://www.instagram.com/kwroofing/");
  assert.ok(result.candidates.every((candidate) => candidate.verificationStatus === "NOT_VERIFIED"));
  assert.ok(result.candidates.every((candidate) => candidate.automationPermitted === false));
  assert.equal(result.researchRequired, false);
  assert.equal(result.authority.providerOperationsAuthorized, 0);
  assert.equal(result.authority.sendAuthorized, false);
  assert.equal(contactDiscoveryResultMatchesRequest(result, request()), true);
  assert.equal(contactDiscoveryResultMatchesRequest(result, request({ businessId: "different-business" })), false);
});

test("an email-shaped value remains an unverified candidate with no outreach authority", () => {
  const result = buildFixtureContactDiscoveryResult({ request: request(), observations: [observation()], completedAt: COMPLETED_AT });
  const candidate = result.candidates[0]!;

  assert.equal(candidate.channel, "EMAIL");
  assert.equal(candidate.verificationStatus, "NOT_VERIFIED");
  assert.equal(candidate.consentBasis, "UNASSESSED");
  assert.equal(candidate.automationPermitted, false);
  assert.equal(result.authority.verificationAuthorized, false);
  assert.equal(result.authority.outreachAuthorized, false);
});

test("no evidence-backed candidate produces research work instead of invented reachability", () => {
  const result = buildFixtureContactDiscoveryResult({ request: request(), observations: [], completedAt: COMPLETED_AT });

  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.channelsWithCandidates, []);
  assert.equal(result.researchRequired, true);
});

test("generic addresses cannot masquerade as named people", () => {
  assert.throws(() => buildFixtureContactDiscoveryResult({
    request: request(),
    completedAt: COMPLETED_AT,
    observations: [observation({
      value: "info@kwroofing.ca",
      personName: "Riley Example",
      role: null,
      recipientKind: "NAMED_PERSON",
    })],
  }), /generic email local part/i);
});

test("conflicting recipient identity and duplicate proof fail closed", () => {
  assert.throws(() => buildFixtureContactDiscoveryResult({
    request: request(),
    completedAt: COMPLETED_AT,
    observations: [
      observation(),
      observation({ personName: "Jordan", role: null, recipientKind: "NAMED_PERSON" }),
    ],
  }), /cannot disagree/i);

  assert.throws(() => buildFixtureContactDiscoveryResult({
    request: request(),
    completedAt: COMPLETED_AT,
    observations: [observation(), observation()],
  }), /duplicate contact evidence/i);
});

test("invalid methods, reserved email domains, private URLs, and stale evidence are rejected", () => {
  assert.throws(() => buildFixtureContactDiscoveryResult({
    request: request(),
    completedAt: COMPLETED_AT,
    observations: [observation({ channel: "PHONE", value: "+15195552345" })],
  }), /evidence method/i);

  assert.throws(() => buildFixtureContactDiscoveryResult({
    request: request(),
    completedAt: COMPLETED_AT,
    observations: [observation({ value: "sales@example.com" })],
  }), /valid public address/i);

  assert.throws(() => buildFixtureContactDiscoveryResult({
    request: request(),
    completedAt: COMPLETED_AT,
    observations: [observation({
      channel: "PHONE",
      value: "+1 CALL 519 555 2345",
      role: null,
      recipientKind: "BUSINESS",
      evidence: { ...observation().evidence, method: "HTML_TEL" },
    })],
  }), /Canadian E\.164/i);

  assert.throws(() => buildFixtureContactDiscoveryResult({
    request: request(),
    completedAt: COMPLETED_AT,
    observations: [observation({ evidence: { ...observation().evidence, sourceUrl: "http://127.0.0.1/contact" } })],
  }), /canonical public source URL/i);

  assert.throws(() => buildFixtureContactDiscoveryResult({
    request: request(),
    completedAt: COMPLETED_AT,
    observations: [observation({ evidence: { ...observation().evidence, capturedAt: "2026-05-01T00:00:00.000Z" } })],
  }), /current and not future-dated/i);
});

test("candidate caps and redigested result drift cannot bypass the contract", () => {
  assert.throws(() => buildFixtureContactDiscoveryResult({
    request: request({ limits: { maxCandidates: 1, maxProviderOperations: 0, maxCostUsd: 0 } }),
    completedAt: COMPLETED_AT,
    observations: [
      observation(),
      observation({ value: "sales@kwroofing.ca", role: "Sales" }),
    ],
  }), /candidate limit/i);

  const result = buildFixtureContactDiscoveryResult({ request: request(), observations: [observation()], completedAt: COMPLETED_AT });
  const drifted = { ...result, channelsWithCandidates: [] };
  const { discoveryResultDigest: _digest, discoveryResultId: _id, ...core } = drifted;
  void _digest;
  void _id;
  const digest = contactDiscoveryDigest(core);
  assert.throws(() => RevenueContactDiscoveryResultSchema.parse({
    ...drifted,
    discoveryResultDigest: digest,
    discoveryResultId: `contact-discovery-result:${digest}`,
  }), /channel summary/i);
});
