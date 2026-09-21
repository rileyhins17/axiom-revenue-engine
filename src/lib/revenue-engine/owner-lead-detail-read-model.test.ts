import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import Database from "better-sqlite3";

import type { D1DatabaseLike, D1PreparedStatementLike } from "@/lib/cloudflare";
import {
  OWNER_LEAD_DETAIL_QUERY,
  OWNER_LEAD_CONTACT_REVIEW_QUERY,
  OWNER_LEAD_HISTORY_QUERY,
  OWNER_LEAD_HISTORY_LIMIT,
  readOwnerLeadDetail,
} from "@/lib/revenue-engine/owner-lead-detail-read-model";
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
    addressLine: "100 King Street West",
    city: "KITCHENER",
    region: "ON",
    country: "CA",
    postalCode: "N2G 1A1",
    geoCell: "kw:kitchener:core",
    sourceRunId: "source-run:one",
    sourceAdapter: "FIXTURE",
    sourceRawPayloadJson: JSON.stringify({
      sourceEvidenceUrl: "https://directory.axiomfixtures.ca/business/one",
      websiteUrl: null,
      niche: "ROOFING",
    }),
    sourceCapturedAt: "2026-08-20T15:00:00.000Z",
    websiteSnapshotId: "website:one",
    websiteFinalUrl: audit.finalUrl,
    websiteClassification: audit.classification,
    websiteAuditVersion: audit.auditVersion,
    websiteDesktopArtifactRef: audit.desktopArtifactRef,
    websiteMobileArtifactRef: audit.mobileArtifactRef,
    websiteDomArtifactRef: audit.domArtifactRef,
    auditJson: JSON.stringify(audit),
    websiteCapturedAt: audit.capturedAt,
    websiteRefreshAfter: "2026-10-21T15:00:00.000Z",
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

function historyRows() {
  return [{
    eventType: "QUALIFICATION_SCORED",
    eventId: "qualification:one",
    occurredAt: "2026-08-22T15:05:00.000Z",
    primaryValue: "REVIEW",
    secondaryValue: "76",
    sourceUrl: null,
  }, {
    eventType: "WEBSITE_AUDITED",
    eventId: "website:one",
    occurredAt: "2026-08-22T15:00:00.000Z",
    primaryValue: "NO_SITE_NEW_BUILD",
    secondaryValue: "website-audit-deterministic-v3",
    sourceUrl: null,
  }, {
    eventType: "CONTACT_DISCOVERED",
    eventId: "contact:phone:one",
    occurredAt: "2026-08-20T15:00:00.000Z",
    primaryValue: "PHONE",
    secondaryValue: "USABLE",
    sourceUrl: "https://directory.axiomfixtures.ca/business/one",
  }, {
    eventType: "SOURCE_CAPTURED",
    eventId: "source-record:one",
    occurredAt: "2026-08-20T15:00:00.000Z",
    primaryValue: "FIXTURE",
    secondaryValue: "fixture-business-one",
    sourceUrl: null,
  }];
}

function fakeDatabase(resultSets: unknown[][]) {
  const queries: string[] = [];
  const bindings: unknown[][] = [];
  let index = 0;
  const database: D1DatabaseLike = {
    prepare(query: string): D1PreparedStatementLike {
      queries.push(query);
      let values: unknown[] = [];
      const statement: D1PreparedStatementLike = {
        bind(...bound: unknown[]) {
          values = bound;
          bindings.push(bound);
          return statement;
        },
        async all<T>() {
          if (/^\s*PRAGMA\s+table_info/i.test(query)) return { results: [{ name: "id", type: "TEXT", notnull: 1, dflt_value: null }] as T[] };
          assert(values.length > 0);
          const rows = resultSets[index] ?? [];
          index += 1;
          return { results: rows as T[] };
        },
        async first<T>() {
          throw new Error("The detail reader uses bounded all queries only.") as T;
        },
        async run() {
          throw new Error("The detail reader must never execute a mutation.");
        },
      };
      return statement;
    },
  };
  return { database, queries, bindings };
}

test("detail reader returns exact evidence, all current routes, and honest v2 history scope", async () => {
  const fake = fakeDatabase([[validCandidate()], [validPhone()], [], historyRows()]);
  const result = await readOwnerLeadDetail(fake.database, "business:one", GENERATED_AT);

  assert(result);
  assert.equal(result.lead.business.canonicalName, "Kitchener Roofing One");
  assert.equal(result.identity.sourceAdapter, "FIXTURE");
  assert.equal(result.website.siteState, "NO_SITE");
  assert.equal(result.website.artifacts.every((item) => item.availability === "NOT_CAPTURED"), true);
  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0]?.recommended, true);
  assert.equal(result.routes[0]?.readiness, "CURRENT_USABLE");
  assert.deepEqual(result.contactReview, {
    state: "NOT_RECORDED",
    consentBasis: "UNASSESSED",
    authority: {
      reviewOnly: true,
      localStorageOnly: true,
      consentDecisionAuthorized: false,
      qualificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  });
  assert.equal(result.history.events.length, 4);
  assert.equal(result.history.scope, "V2_SHADOW_ONLY");
  assert.deepEqual(result.history.unavailable.map((item) => item.area), ["OUTREACH", "REPLIES", "OPPORTUNITIES", "CLIENTS"]);
  assert.deepEqual(result.authority, {
    readOnly: true,
    mutationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
  assert.equal(fake.queries.length, 11);
  assert(fake.queries.slice(7).every((query) => /^\s*SELECT\b/i.test(query)));
  assert.deepEqual(fake.bindings[0], ["business:one"]);
  assert.deepEqual(fake.bindings[2], ["business:one"]);
  assert.deepEqual(fake.bindings[3], [
    "business:one",
    "business:one",
    "business:one",
    "business:one",
    "business:one",
    OWNER_LEAD_HISTORY_LIMIT + 1,
  ]);
});

test("detail reader returns null for an exact business with no current v2 dossier", async () => {
  const fake = fakeDatabase([[]]);
  const result = await readOwnerLeadDetail(fake.database, "business:missing", GENERATED_AT);

  assert.equal(result, null);
  assert.equal(fake.queries.length, 8);
});

test("detail reader fails closed when snapshot columns drift from the audit receipt", async () => {
  const candidate = { ...validCandidate(), websiteClassification: "REBUILD" };
  const fake = fakeDatabase([[candidate], [validPhone()]]);

  await assert.rejects(
    () => readOwnerLeadDetail(fake.database, "business:one", GENERATED_AT),
    /does not match its deterministic audit receipt/i,
  );
  assert.equal(fake.queries.length, 9);
});

test("detail reader validates identity before querying and keeps every query bounded and SELECT-only", async () => {
  const fake = fakeDatabase([]);
  await assert.rejects(() => readOwnerLeadDetail(fake.database, "", GENERATED_AT));
  assert.equal(fake.queries.length, 0);

  assert.match(OWNER_LEAD_DETAIL_QUERY, /WHERE business\."id" = \?/);
  assert.match(OWNER_LEAD_DETAIL_QUERY, /LIMIT 1/);
  assert.match(OWNER_LEAD_CONTACT_REVIEW_QUERY, /WHERE receipt\."businessId" = \?/);
  assert.match(OWNER_LEAD_CONTACT_REVIEW_QUERY, /LIMIT 1/);
  assert.match(OWNER_LEAD_HISTORY_QUERY, /LIMIT \?/);
  assert.equal((OWNER_LEAD_HISTORY_QUERY.match(/\?/g) ?? []).length, 6);
  assert.doesNotMatch(
    `${OWNER_LEAD_DETAIL_QUERY}\n${OWNER_LEAD_CONTACT_REVIEW_QUERY}\n${OWNER_LEAD_HISTORY_QUERY}`,
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i,
  );
});

test("detail, contact-review, and history SELECT contracts compile against the complete v2 migration chain", () => {
  const database = new Database(":memory:");
  try {
    const migrationsUrl = new URL("../../../migrations/", import.meta.url);
    const migrations = readdirSync(migrationsUrl)
      .filter((name) => /^00(?:5[4-9]|6[0-8])_.*\.sql$/.test(name))
      .sort((left, right) => left.localeCompare(right, "en-CA"));
    assert.equal(migrations.at(0)?.startsWith("0054_"), true);
    assert.equal(migrations.at(-1)?.startsWith("0068_"), true);
    migrations.forEach((migration) => {
      database.exec(readFileSync(new URL(migration, migrationsUrl), "utf8"));
    });
    assert.doesNotThrow(() => database.prepare(OWNER_LEAD_DETAIL_QUERY));
    assert.doesNotThrow(() => database.prepare(OWNER_LEAD_CONTACT_REVIEW_QUERY));
    assert.doesNotThrow(() => database.prepare(OWNER_LEAD_HISTORY_QUERY));
  } finally {
    database.close();
  }
});
