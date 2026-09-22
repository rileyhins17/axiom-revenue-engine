import assert from "node:assert/strict";
import test from "node:test";

import {
  OWNER_LEAD_PROJECTION_VERSION,
  projectOwnerLead,
  rankOwnerLeads,
  type OwnerLeadProjectionInput,
} from "@/lib/revenue-engine/owner-lead-projection";
import { qualifyRevenueLead, type ReachableChannel } from "@/lib/revenue-engine/qualification";
import {
  auditWebsiteDeterministically,
  type DeterministicWebsiteAuditInput,
} from "@/lib/revenue-engine/website-audit";

const BUSINESS_ID = "business:kw-roofing";
const PROJECTED_AT = "2026-08-25T15:00:00.000Z";

function weakWebsiteAudit() {
  const input: DeterministicWebsiteAuditInput = {
    businessId: BUSINESS_ID,
    businessName: "KW Roofing",
    niche: "roofing",
    expectedServices: ["roofing", "roof repair"],
    expectedLocations: ["Kitchener", "Waterloo"],
    sourceEvidenceUrl: "https://source.example/business/kw-roofing",
    siteState: "CAPTURED",
    requestedUrl: "http://kwroofing.example",
    finalUrl: "http://kwroofing.example/",
    statusCode: 200,
    redirectCount: 5,
    capturedAt: "2026-08-22T15:00:00.000Z",
    desktopArtifactRef: "artifact:sha256:desktop",
    mobileArtifactRef: "artifact:sha256:mobile",
    domArtifactRef: "artifact:sha256:dom",
    pageSetComplete: true,
    pages: [{
      kind: "HOME",
      url: "http://kwroofing.example/",
      title: null,
      metaDescription: null,
      visibleText: "Welcome to our company.",
      actions: [],
      forms: [],
      trustSignals: [],
      structuredDataTypes: [],
      contentComplete: true,
      evidenceCoverage: {
        desktopRenderCaptured: true,
        actionVisibilityComplete: true,
        formVisibilityComplete: true,
      },
    }],
    resourceProbes: [{
      url: "http://kwroofing.example/missing.css",
      type: "ASSET",
      internal: true,
      statusCode: 404,
    }],
    mobile: {
      captured: true,
      horizontalOverflow: true,
      navigationUsable: false,
      textReadable: false,
      minimumTapTargetPx: 18,
    },
  };
  return auditWebsiteDeterministically(input);
}

function healthyWebsiteAudit() {
  return auditWebsiteDeterministically({
    businessId: BUSINESS_ID,
    businessName: "KW Roofing",
    niche: "roofing",
    expectedServices: ["roofing", "roof repair"],
    expectedLocations: ["Kitchener", "Waterloo"],
    sourceEvidenceUrl: "https://source.example/business/kw-roofing",
    siteState: "CAPTURED",
    requestedUrl: "https://kwroofing.example",
    finalUrl: "https://kwroofing.example/",
    statusCode: 200,
    redirectCount: 0,
    capturedAt: "2026-08-22T15:00:00.000Z",
    desktopArtifactRef: "artifact:sha256:desktop",
    mobileArtifactRef: "artifact:sha256:mobile",
    domArtifactRef: "artifact:sha256:dom",
    pageSetComplete: true,
    pages: [{
      kind: "HOME",
      url: "https://kwroofing.example/",
      title: "KW Roofing",
      metaDescription: "Roofing services in Kitchener and Waterloo.",
      visibleText: "Roofing roof repair Kitchener Waterloo",
      actions: [{ kind: "PHONE", label: "Call us", href: "tel:+15195550123", visible: true, aboveFold: true }],
      forms: [{ visible: true, hasSubmitControl: true, disabled: false, actionUrl: "https://kwroofing.example/contact" }],
      trustSignals: ["CREDENTIAL", "WARRANTY"],
      structuredDataTypes: ["LocalBusiness"],
      contentComplete: true,
      evidenceCoverage: {
        desktopRenderCaptured: true,
        actionVisibilityComplete: true,
        formVisibilityComplete: true,
      },
    }],
    resourceProbes: [],
    mobile: {
      captured: true,
      horizontalOverflow: false,
      navigationUsable: true,
      textReadable: true,
      minimumTapTargetPx: 44,
    },
  });
}

type ContactPoint = OwnerLeadProjectionInput["contactPoints"][number];

function phoneContact(overrides: Partial<ContactPoint> = {}): ContactPoint {
  return {
    contactPointId: "contact:phone",
    businessId: BUSINESS_ID,
    channel: "PHONE",
    value: "+15195550123",
    label: "Main phone",
    personName: null,
    role: null,
    recipientKind: "BUSINESS",
    sourceUrl: "https://source.example/business/kw-roofing",
    sourceCapturedAt: "2026-08-22T14:00:00.000Z",
    staleAfter: "2026-11-20T00:00:00.000Z",
    status: "USABLE",
    emailVerification: null,
    automationPermitted: false,
    ...overrides,
  };
}

function emailContact(overrides: Partial<ContactPoint> = {}): ContactPoint {
  return {
    contactPointId: "contact:email:named",
    businessId: BUSINESS_ID,
    channel: "EMAIL",
    value: "owner@kwroofing.example",
    label: "Owner email",
    personName: "Taylor",
    role: "Owner",
    recipientKind: "NAMED_PERSON",
    sourceUrl: "https://kwroofing.example/contact",
    sourceCapturedAt: "2026-08-22T14:00:00.000Z",
    staleAfter: "2026-11-20T00:00:00.000Z",
    status: "VERIFIED",
    emailVerification: {
      status: "DELIVERABLE",
      verifiedAt: "2026-08-23T12:00:00.000Z",
      staleAfter: "2026-09-23T12:00:00.000Z",
    },
    automationPermitted: true,
    ...overrides,
  };
}

function usableChannels(contacts: ContactPoint[]): ReachableChannel[] {
  const projectedAt = Date.parse(PROJECTED_AT);
  const usableEmail = contacts.some((contact) => contact.channel === "EMAIL"
    && contact.status === "VERIFIED"
    && (contact.recipientKind === "NAMED_PERSON" || contact.recipientKind === "ROLE")
    && contact.emailVerification?.status === "DELIVERABLE"
    && contact.emailVerification.staleAfter !== null
    && Date.parse(contact.emailVerification.staleAfter) > projectedAt
    && Date.parse(contact.sourceCapturedAt) <= projectedAt
    && (!contact.staleAfter || Date.parse(contact.staleAfter) > projectedAt));
  if (usableEmail) return ["EMAIL"];
  for (const channel of ["PHONE", "FORM", "SOCIAL"] as const) {
    if (contacts.some((contact) => contact.channel === channel
      && (contact.status === "USABLE" || contact.status === "VERIFIED")
      && Date.parse(contact.sourceCapturedAt) <= projectedAt
      && (!contact.staleAfter || Date.parse(contact.staleAfter) > projectedAt))) {
      return [channel];
    }
  }
  return ["RESEARCH"];
}

function ownerInput(options: {
  businessId?: string;
  name?: string;
  contacts?: ContactPoint[];
  blocks?: string[];
  audit?: OwnerLeadProjectionInput["audit"];
  businessFit?: number;
  independenceStatus?: OwnerLeadProjectionInput["business"]["independenceStatus"];
  status?: OwnerLeadProjectionInput["business"]["status"];
} = {}): OwnerLeadProjectionInput {
  const audit = options.audit ?? weakWebsiteAudit();
  const contacts = options.contacts ?? [phoneContact()];
  const businessId = options.businessId ?? BUSINESS_ID;
  const current = qualifyRevenueLead({
    scores: {
      rebuildNeed: audit.rebuildNeedScore,
      businessFit: options.businessFit ?? 82,
      reachability: 85,
      timing: 60,
      evidenceConfidence: audit.evidenceConfidence,
    },
    evidenceClaims: audit.claims,
    availableChannels: usableChannels(contacts),
    blocks: options.blocks,
  });
  return {
    projectionVersion: OWNER_LEAD_PROJECTION_VERSION,
    projectedAt: PROJECTED_AT,
    business: {
      businessId,
      canonicalName: options.name ?? "KW Roofing",
      niche: "ROOFING",
      normalizedDomain: "kwroofing.example",
      websiteUrl: "http://kwroofing.example/",
      independenceStatus: options.independenceStatus ?? "INDEPENDENT",
      status: options.status ?? "RESEARCH_ONLY",
      location: { city: "KITCHENER", region: "ON", country: "CA" },
      sourceEvidenceUrl: "https://source.example/business/kw-roofing",
      sourceCapturedAt: "2026-08-20T15:00:00.000Z",
    },
    audit,
    qualification: {
      snapshotId: `qualification:${businessId}`,
      businessId,
      policyVersion: current.policyVersion,
      shadowOnly: true,
      totalScore: current.totalScore,
      scores: current.scores,
      band: current.band,
      recommendedChannel: current.recommendedChannel,
      supportedObservationCount: current.supportedObservationCount,
      conversionCriticalCount: current.conversionCriticalCount,
      failedGates: current.failedGates,
      evidenceClaimIds: current.evidenceClaimIds,
      createdAt: "2026-08-22T15:05:00.000Z",
    },
    contactPoints: contacts.map((contact) => ({ ...contact, businessId })),
  };
}

test("a strong non-email lead stays valuable and becomes a manual phone review", () => {
  const result = projectOwnerLead(ownerInput());

  assert.equal(result.attention, "READY_FOR_REVIEW");
  assert.equal(result.ownerActionable, true);
  assert.equal(result.route.channel, "PHONE");
  assert.equal(result.route.readiness, "MANUAL_ACTION");
  assert.equal(result.qualification.band, "PRIORITY");
  assert.equal(result.dataQuality.state, "CURRENT");
  assert.equal(result.whyThisLead.length, 3);
  assert(result.whyThisLead.every((claim) => claim.sourceUrl.startsWith("http")));
  assert.deepEqual(result.authority, {
    readOnly: true,
    shadowOnly: true,
    qualificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    mutationAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
});

test("a healthy current site with a recorded phone remains research-only without block copy", () => {
  for (const [businessFit, attention] of [[82, "REVIEW"], [20, "RESEARCH"]] as const) {
    const result = projectOwnerLead(ownerInput({ audit: healthyWebsiteAudit(), businessFit }));

    assert.equal(result.audit.classification, "NO_OPPORTUNITY");
    assert.equal(result.attention, attention);
    assert.equal(result.ownerActionable, false);
    assert.equal(result.route.channel, "PHONE");
    assert.equal(result.route.contactPointId, "contact:phone");
    assert.equal(result.route.readiness, "RESEARCH_REQUIRED");
    assert.match(result.route.reason, /qualification/i);
    assert.doesNotMatch(result.route.reason, /policy|block/i);
  }
});

test("unknown independence stays research-only for priority and review evidence", () => {
  for (const audit of [weakWebsiteAudit(), healthyWebsiteAudit()]) {
    const result = projectOwnerLead(ownerInput({ audit, independenceStatus: "UNKNOWN" }));

    assert.equal(result.attention, "RESEARCH");
    assert.equal(result.ownerActionable, false);
    assert.equal(result.route.channel, "PHONE");
    assert.equal(result.route.readiness, "RESEARCH_REQUIRED");
    assert.match(result.route.reason, /independence is unverified/i);
    assert(result.dataQuality.issues.includes("independence_unverified"));
  }
});

test("verified named email outranks role email and still grants no send authority", () => {
  const role = emailContact({
    contactPointId: "contact:email:role",
    value: "sales@kwroofing.example",
    personName: null,
    role: "Sales",
    recipientKind: "ROLE",
  });
  const named = emailContact();
  const result = projectOwnerLead(ownerInput({ contacts: [role, phoneContact(), named] }));

  assert.equal(result.route.channel, "EMAIL");
  assert.equal(result.route.contactPointId, named.contactPointId);
  assert.equal(result.route.label, "Verified named email");
  assert.equal(result.authority.sendAuthorized, false);
  assert.equal(result.authority.outreachAuthorized, false);
});

test("catch-all or stale email cannot displace a current manual route", () => {
  const catchAll = emailContact({
    contactPointId: "contact:email:catch-all",
    emailVerification: {
      status: "CATCH_ALL",
      verifiedAt: "2026-08-23T12:00:00.000Z",
      staleAfter: "2026-09-23T12:00:00.000Z",
    },
  });
  const stale = emailContact({
    contactPointId: "contact:email:stale",
    emailVerification: {
      status: "DELIVERABLE",
      verifiedAt: "2026-07-01T12:00:00.000Z",
      staleAfter: "2026-08-01T12:00:00.000Z",
    },
  });
  const result = projectOwnerLead(ownerInput({ contacts: [catchAll, stale, phoneContact()] }));

  assert.equal(result.route.channel, "PHONE");
  assert.equal(result.qualification.band, "PRIORITY");
  assert.equal(result.qualification.scores.businessFit, 82);
});

test("stale or future source facts become refresh work instead of an actionable lead", () => {
  const stale = ownerInput();
  stale.business.sourceCapturedAt = "2026-05-01T00:00:00.000Z";
  stale.audit.capturedAt = "2026-05-01T00:00:00.000Z";
  stale.audit.claims = stale.audit.claims.map((claim) => ({ ...claim, capturedAt: stale.audit.capturedAt }));
  stale.qualification.createdAt = "2026-05-01T00:05:00.000Z";
  const result = projectOwnerLead(stale);

  assert.equal(result.attention, "NEEDS_REFRESH");
  assert.equal(result.ownerActionable, false);
  assert(result.dataQuality.issues.includes("source_record_stale"));
  assert(result.dataQuality.issues.includes("website_audit_stale"));
  assert.equal(result.route.channel, "PHONE");
  assert.equal(result.route.readiness, "RESEARCH_REQUIRED");

  const future = ownerInput();
  future.business.sourceCapturedAt = "2026-08-26T00:00:00.000Z";
  const futureResult = projectOwnerLead(future);
  assert.equal(futureResult.attention, "NEEDS_REFRESH");
  assert(futureResult.dataQuality.issues.includes("source_timestamp_in_future"));
});

test("chain and suppressed businesses remain blocked despite strong scores", () => {
  const chain = ownerInput({ independenceStatus: "CHAIN", blocks: ["chain_or_franchise"] });
  const chainResult = projectOwnerLead(chain);
  assert.equal(chainResult.attention, "BLOCKED");
  assert.equal(chainResult.qualification.band, "DISQUALIFIED");
  assert.equal(chainResult.route.channel, "PHONE");
  assert.equal(chainResult.route.readiness, "RESEARCH_REQUIRED");

  const suppressed = ownerInput({ status: "SUPPRESSED", blocks: ["business_suppressed"] });
  const suppressedResult = projectOwnerLead(suppressed);
  assert.equal(suppressedResult.attention, "BLOCKED");
  assert.equal(suppressedResult.ownerActionable, false);
  assert.equal(suppressedResult.route.channel, "PHONE");
  assert.equal(suppressedResult.route.readiness, "RESEARCH_REQUIRED");
});

test("snapshot drift is visible and deterministic ranking favours current actionable leads", () => {
  const drifted = ownerInput({ name: "A Drifted Roofing" });
  drifted.qualification.band = "REVIEW";
  const lower = ownerInput({ name: "B Current Roofing" });
  lower.qualification.scores.businessFit = 61;
  lower.qualification.totalScore = 78;
  const lowerCurrent = qualifyRevenueLead({
    scores: lower.qualification.scores,
    evidenceClaims: lower.audit.claims,
    availableChannels: ["PHONE"],
  });
  Object.assign(lower.qualification, {
    totalScore: lowerCurrent.totalScore,
    band: lowerCurrent.band,
    recommendedChannel: lowerCurrent.recommendedChannel,
    supportedObservationCount: lowerCurrent.supportedObservationCount,
    conversionCriticalCount: lowerCurrent.conversionCriticalCount,
    failedGates: lowerCurrent.failedGates,
    evidenceClaimIds: lowerCurrent.evidenceClaimIds,
  });

  const ranked = rankOwnerLeads([drifted, lower]);
  assert.equal(ranked[0]?.business.canonicalName, "B Current Roofing");
  assert.equal(ranked[1]?.attention, "NEEDS_REFRESH");
  assert(ranked[1]?.dataQuality.issues.includes("qualification_snapshot_drift"));
});

test("cross-business audit and contact contamination fail before projection", () => {
  const auditMismatch = ownerInput({ businessId: "business:other" });
  assert.throws(() => projectOwnerLead(auditMismatch), /identities must match/i);

  const contactMismatch = ownerInput();
  contactMismatch.contactPoints[0] = { ...contactMismatch.contactPoints[0]!, businessId: "business:other" };
  assert.throws(() => projectOwnerLead(contactMismatch), /another business/i);
});

