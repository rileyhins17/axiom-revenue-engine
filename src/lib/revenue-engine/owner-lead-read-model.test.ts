import assert from "node:assert/strict";
import test from "node:test";

import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/cloudflare";
import {
  OWNER_LEAD_CANDIDATE_QUERY,
  ownerLeadContactQuery,
  readOwnerLeadList,
} from "@/lib/revenue-engine/owner-lead-read-model";
import { qualifyRevenueLead } from "@/lib/revenue-engine/qualification";
import { auditWebsiteDeterministically } from "@/lib/revenue-engine/website-audit";

const GENERATED_AT = "2026-08-25T15:00:00.000Z";

function noSiteAudit() {
  return auditWebsiteDeterministically({
    businessId: "business:one",
    businessName: "Kitchener Roofing One",
    niche: "roofing",
    expectedServices: ["roofing"],
    expectedLocations: ["Kitchener"],
    sourceEvidenceUrl: "https://directory.axiomfixtures.ca/business/one",
    siteState: "NO_SITE",
    requestedUrl: null,
    finalUrl: null,
    statusCode: 0,
    redirectCount: 0,
    capturedAt: "2026-08-22T15:00:00.000Z",
    desktopArtifactRef: null,
    mobileArtifactRef: null,
    domArtifactRef: null,
    pageSetComplete: true,
    pages: [],
    resourceProbes: [],
    mobile: {
      captured: false,
      horizontalOverflow: null,
      navigationUsable: null,
      textReadable: null,
      minimumTapTargetPx: null,
    },
  });
}

function validCandidate() {
  const audit = noSiteAudit();
  const qualification = qualifyRevenueLead({
    scores: {
      rebuildNeed: audit.rebuildNeedScore,
      businessFit: 82,
      reachability: 85,
      timing: 60,
      evidenceConfidence: audit.evidenceConfidence,
    },
    evidenceClaims: audit.claims,
    availableChannels: ["PHONE"],
  });
  return {
    businessId: "business:one",
    canonicalName: "Kitchener Roofing One",
    normalizedDomain: null,
    independenceStatus: "INDEPENDENT",
    businessStatus: "RESEARCH_ONLY",
    city: "KITCHENER",
    region: "ON",
    country: "CA",
    sourceRawPayloadJson: JSON.stringify({
      sourceEvidenceUrl: "https://directory.axiomfixtures.ca/business/one",
      websiteUrl: null,
      niche: "ROOFING",
      sourcePayload: {},
    }),
    sourceCapturedAt: "2026-08-20T15:00:00.000Z",
    auditJson: JSON.stringify(audit),
    qualificationSnapshotId: "qualification:one",
    qualificationBusinessId: "business:one",
    qualificationPolicyVersion: qualification.policyVersion,
    qualificationShadowOnly: 1,
    qualificationTotalScore: qualification.totalScore,
    qualificationRebuildNeedScore: qualification.scores.rebuildNeed,
    qualificationBusinessFitScore: qualification.scores.businessFit,
    qualificationReachabilityScore: qualification.scores.reachability,
    qualificationTimingScore: qualification.scores.timing,
    qualificationEvidenceConfidenceScore: qualification.scores.evidenceConfidence,
    qualificationBand: qualification.band,
    qualificationRecommendedChannel: qualification.recommendedChannel,
    qualificationSupportedObservationCount: qualification.supportedObservationCount,
    qualificationConversionCriticalCount: qualification.conversionCriticalCount,
    qualificationFailedGatesJson: JSON.stringify(qualification.failedGates),
    qualificationEvidenceClaimIdsJson: JSON.stringify(qualification.evidenceClaimIds),
    qualificationCreatedAt: "2026-08-22T15:05:00.000Z",
  };
}

function validPhone() {
  return {
    contactPointId: "contact:phone:one",
    businessId: "business:one",
    channel: "PHONE",
    value: "+15195550123",
    label: "Main phone",
    personName: null,
    role: null,
    sourceUrl: "https://directory.axiomfixtures.ca/business/one",
    sourceCapturedAt: "2026-08-20T15:00:00.000Z",
    automationPermitted: 0,
    contactStatus: "USABLE",
    verificationStatus: null,
    verificationCatchAll: null,
    verificationVerifiedAt: null,
    verificationStaleAfter: null,
  };
}

function fakeDatabase(candidateRows: unknown[], contactRows: unknown[]) {
  const queries: string[] = [];
  const database: D1DatabaseLike = {
    prepare(query: string): D1PreparedStatementLike {
      queries.push(query);
      let bindings: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async all<T>() {
          if (/^\s*PRAGMA\s+table_info/i.test(query)) return { results: [{ name: "id", type: "TEXT", notnull: 1, dflt_value: null }] as T[] };
          assert(bindings.length > 0);
          const rows = query.includes('FROM "RevenueBusiness"') ? candidateRows : contactRows;
          return { results: rows as T[] };
        },
        async first<T>() {
          return null as T | null;
        },
        async run() {
          throw new Error("The owner lead reader must never execute a mutation.");
        },
      };
      return statement;
    },
  };
  return { database, queries };
}

test("the D1 reader returns an authenticated-API-safe, read-only owner list", async () => {
  const fake = fakeDatabase([validCandidate()], [validPhone()]);
  const result = await readOwnerLeadList(fake.database, GENERATED_AT, 50);

  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0]?.attention, "REVIEW");
  assert.equal(result.leads[0]?.route.channel, "PHONE");
  assert.equal(result.leads[0]?.ownerActionable, false);
  assert.equal(result.leads[0]?.route.readiness, "RESEARCH_REQUIRED");
  assert.equal(result.summary.readyForReview, 0);
  assert.equal(result.summary.rejectedBusinesses, 0);
  assert.deepEqual(result.authority, {
    readOnly: true,
    mutationAuthorized: false,
    outreachAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
  assert.equal(fake.queries.length, 9);
  assert(fake.queries.slice(7).every((query) => /^\s*SELECT\b/i.test(query)));
});

test("malformed businesses are explicit and malformed contacts cannot authorize a route", async () => {
  const malformedCandidate = { ...validCandidate(), qualificationTotalScore: "ninety" };
  const incompleteContact = { ...validPhone(), sourceUrl: null };
  const fake = fakeDatabase([validCandidate(), malformedCandidate], [incompleteContact]);
  const result = await readOwnerLeadList(fake.database, GENERATED_AT, 10);

  assert.equal(result.summary.candidateRows, 2);
  assert.equal(result.summary.returned, 1);
  assert.equal(result.summary.ignoredContactRows, 1);
  assert.equal(result.summary.rejectedBusinesses, 1);
  assert.deepEqual(result.rejections, [{ businessId: "business:one", code: "INVALID_CANDIDATE_ROW" }]);
  assert.equal(result.leads[0]?.route.channel, "RESEARCH");
  assert.equal(result.leads[0]?.attention, "NEEDS_REFRESH");
  assert(result.leads[0]?.dataQuality.issues.includes("qualification_snapshot_drift"));
});

test("query builders remain bounded and contain no mutation statements", async () => {
  assert.match(OWNER_LEAD_CANDIDATE_QUERY, /LIMIT \?/);
  assert.doesNotMatch(OWNER_LEAD_CANDIDATE_QUERY, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i);
  assert.equal((ownerLeadContactQuery(3).match(/\?/g) ?? []).length, 3);
  assert.throws(() => ownerLeadContactQuery(0), /one to 100/i);
  assert.throws(() => ownerLeadContactQuery(101), /one to 100/i);

  const fake = fakeDatabase([], []);
  await assert.rejects(() => readOwnerLeadList(fake.database, GENERATED_AT, 0), /one to 100/i);
  await assert.rejects(() => readOwnerLeadList(fake.database, GENERATED_AT, 101), /one to 100/i);
  assert.equal(fake.queries.length, 0);
});

