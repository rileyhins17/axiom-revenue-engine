import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  OwnerLeadDetail,
  OwnerLeadDetailNotFound,
  OwnerLeadDetailUnavailable,
} from "@/components/leads/owner-lead-detail";
import {
  OWNER_LEAD_DETAIL_READ_MODEL_VERSION,
  type OwnerLeadDetailResponse,
} from "@/lib/revenue-engine/owner-lead-detail-read-model";
import { OWNER_LEAD_PROJECTION_VERSION } from "@/lib/revenue-engine/owner-lead-projection";

const GENERATED_AT = "2026-08-25T18:00:00.000Z";

function fixtureDetail(): OwnerLeadDetailResponse {
  const evidence = {
    claimId: "claim:mobile-navigation",
    observation: "The mobile navigation is not usable and the page overflows horizontally.",
    category: "mobile" as const,
    confidence: 96,
    conversionCritical: true,
    sourceUrl: "https://roofing.example/evidence/mobile",
    capturedAt: "2026-08-24T15:00:00.000Z",
    artifactRef: "artifact:sha256:mobile",
    method: "browser_render" as const,
    auditVersion: "website-audit-deterministic-v3",
  };
  const projectedEvidence = {
    claimId: evidence.claimId,
    observation: evidence.observation,
    category: evidence.category,
    confidence: evidence.confidence,
    conversionCritical: evidence.conversionCritical,
    sourceUrl: evidence.sourceUrl,
    capturedAt: evidence.capturedAt,
    artifactRef: evidence.artifactRef,
  };

  return {
    readModelVersion: OWNER_LEAD_DETAIL_READ_MODEL_VERSION,
    generatedAt: GENERATED_AT,
    lead: {
      projectionVersion: OWNER_LEAD_PROJECTION_VERSION,
      projectedAt: GENERATED_AT,
      projectionKey: "owner-lead-projection-v1:business:roofing:qualification:1",
      business: {
        businessId: "business:roofing",
        canonicalName: "Tri-City Roofing",
        niche: "ROOFING",
        normalizedDomain: "roofing.example",
        websiteUrl: "https://roofing.example/",
        independenceStatus: "INDEPENDENT",
        status: "RESEARCH_ONLY",
        location: { city: "KITCHENER", region: "ON", country: "CA" },
        sourceEvidenceUrl: "https://source.example/tri-city-roofing",
        sourceCapturedAt: "2026-08-23T15:00:00.000Z",
      },
      audit: {
        classification: "REBUILD",
        auditVersion: "website-audit-deterministic-v3",
        capturedAt: "2026-08-24T15:00:00.000Z",
        finalUrl: "https://roofing.example/",
      },
      qualification: {
        snapshotId: "qualification:1",
        policyVersion: "revenue-lead-qualification-v1",
        band: "PRIORITY",
        totalScore: 82,
        scores: {
          rebuildNeed: 91,
          businessFit: 84,
          reachability: 78,
          timing: 62,
          evidenceConfidence: 93,
        },
        failedGates: [],
      },
      attention: "READY_FOR_REVIEW",
      ownerActionable: true,
      route: {
        channel: "PHONE",
        readiness: "MANUAL_ACTION",
        contactPointId: "contact:phone",
        label: "Manual phone task",
        reason: "A current business phone is available. Calling remains a manual task.",
      },
      whyThisLead: [projectedEvidence],
      evidence: [projectedEvidence],
      dataQuality: { state: "CURRENT", issues: [] },
      authority: {
        readOnly: true,
        shadowOnly: true,
        qualificationAuthorized: false,
        outreachAuthorized: false,
        sendAuthorized: false,
        mutationAuthorized: false,
        providerOperationsAuthorized: 0,
        costAuthorizedUsd: 0,
      },
    },
    identity: {
      addressLine: "100 King Street West",
      postalCode: "N2G 1A1",
      geoCell: "kw:kitchener:core",
      sourceRunId: "source-run:1",
      sourceAdapter: "OUTSCRAPER_SHADOW_FIXTURE",
    },
    website: {
      snapshotId: "website:1",
      siteState: "CAPTURED",
      classification: "REBUILD",
      auditVersion: "website-audit-deterministic-v3",
      capturedAt: "2026-08-24T15:00:00.000Z",
      refreshAfter: "2026-10-23T15:00:00.000Z",
      finalUrl: "https://roofing.example/",
      artifacts: [{
        kind: "DESKTOP",
        reference: "artifact:sha256:desktop",
        availability: "REFERENCE_RECORDED",
        previewAvailable: false,
      }, {
        kind: "MOBILE",
        reference: "artifact:sha256:mobile",
        availability: "REFERENCE_RECORDED",
        previewAvailable: false,
      }, {
        kind: "DOM",
        reference: null,
        availability: "NOT_CAPTURED",
        previewAvailable: false,
      }],
      findings: [{
        checkId: "mobile-navigation",
        outcome: "FAIL",
        severity: "CRITICAL",
        category: "mobile",
        scoreImpact: 18,
        claimId: evidence.claimId,
        claim: evidence,
      }, {
        checkId: "offer-clarity",
        outcome: "UNKNOWN",
        severity: "IMPORTANT",
        category: "offer_clarity",
        scoreImpact: 0,
        claimId: null,
        claim: null,
      }, {
        checkId: "structured-data",
        outcome: "UNKNOWN",
        severity: "MINOR",
        category: "seo",
        scoreImpact: 0,
        claimId: null,
        claim: null,
      }],
      evidence: [evidence],
      evidenceTruncated: false,
      passedCheckCount: 8,
      manualReviewReasons: ["offer_clarity_incomplete"],
    },
    routes: [{
      contactPointId: "contact:phone",
      businessId: "business:roofing",
      channel: "PHONE",
      value: "+15195550123",
      label: "Main phone",
      personName: null,
      role: null,
      recipientKind: "BUSINESS",
      sourceUrl: "https://source.example/tri-city-roofing",
      sourceCapturedAt: "2026-08-23T15:00:00.000Z",
      staleAfter: null,
      status: "USABLE",
      emailVerification: null,
      automationPermitted: false,
      recommended: true,
      readiness: "CURRENT_USABLE",
    }, {
      contactPointId: "contact:email",
      businessId: "business:roofing",
      channel: "EMAIL",
      value: "hello@roofing.example",
      label: "General email",
      personName: null,
      role: "office",
      recipientKind: "ROLE",
      sourceUrl: "https://roofing.example/contact",
      sourceCapturedAt: "2026-08-23T15:00:00.000Z",
      staleAfter: null,
      status: "CANDIDATE",
      emailVerification: { status: "UNVERIFIED", verifiedAt: null, staleAfter: null },
      automationPermitted: false,
      recommended: false,
      readiness: "UNVERIFIED",
    }],
    ignoredRouteRows: 0,
    contactReview: {
      state: "CURRENT",
      invocationId: `kw-contact-invocation:${"a".repeat(64)}`,
      reviewId: `kw-contact-review:${"b".repeat(64)}`,
      reviewedBy: "RILEY",
      reviewedAt: "2026-08-24T16:00:00.000Z",
      rationale: "The published phone and general email were supported by the exact synthetic evidence packet.",
      decision: "APPROVED_FOR_LOCAL_CONTACT_PERSISTENCE",
      consentBasis: "UNASSESSED",
      assessment: {
        receiptId: `assessment:${"c".repeat(64)}`,
        websiteSnapshotId: `website:${"d".repeat(64)}`,
        qualificationSnapshotId: `qualification:${"e".repeat(64)}`,
        classification: "REBUILD",
      },
      summary: {
        candidates: 2,
        verificationResults: 2,
        usableRoutes: 1,
        emailReviewRoutes: 1,
        manualRoutes: 1,
        researchRoutes: 0,
      },
      lineage: {
        materializationReceiptId: `kw-contact-persistence:${"f".repeat(64)}`,
        discoveryReceiptId: `contact-discovery-result:${"1".repeat(64)}`,
      },
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
    },
    history: {
      scope: "V2_SHADOW_ONLY",
      events: [{
        eventType: "QUALIFICATION_SCORED",
        eventId: "qualification:1",
        occurredAt: "2026-08-24T15:05:00.000Z",
        sourceUrl: null,
        title: "Lead quality scored",
        description: "The shadow qualification band was priority with a priority score of 82.",
      }, {
        eventType: "WEBSITE_AUDITED",
        eventId: "website:1",
        occurredAt: "2026-08-24T15:00:00.000Z",
        sourceUrl: "https://roofing.example/",
        title: "Website audit captured",
        description: "The website was classified rebuild under website-audit-deterministic-v3.",
      }],
      truncated: false,
      unavailable: [{
        area: "OUTREACH",
        state: "NOT_AVAILABLE_IN_V2",
        reason: "The v2 shadow read model does not yet contain outreach touches.",
      }, {
        area: "REPLIES",
        state: "NOT_AVAILABLE_IN_V2",
        reason: "The v2 shadow read model does not yet contain inbound reply events.",
      }, {
        area: "OPPORTUNITIES",
        state: "NOT_AVAILABLE_IN_V2",
        reason: "The v2 shadow read model does not yet contain opportunity events.",
      }, {
        area: "CLIENTS",
        state: "NOT_AVAILABLE_IN_V2",
        reason: "The v2 shadow read model does not yet contain client-conversion events.",
      }],
    },
    authority: {
      readOnly: true,
      mutationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    },
  };
}

test("lead dossier renders an owner-first decision, evidence, routes, and factual history", () => {
  const html = renderToStaticMarkup(createElement(OwnerLeadDetail, { data: fixtureDetail() }));

  assert.match(html, /<h1[^>]*>Tri-City Roofing<\/h1>/);
  assert.match(html, /Owner next step/);
  assert.match(html, /Review the recommended route manually/);
  assert.match(html, /Suggested route · read-only/);
  assert.match(html, /Top website findings/);
  assert.match(html, /3 of 3/);
  assert.match(html, /href="https:\/\/roofing\.example\/evidence\/mobile"/);
  assert.match(html, /Full website audit and evidence details/);
  const routePosition = html.indexOf("Every recorded route");
  const historyPosition = html.indexOf("Evidence and decision history");
  const fullAuditPosition = html.indexOf("Full website audit and evidence details");
  assert.ok(routePosition > -1 && routePosition < fullAuditPosition);
  assert.ok(historyPosition > -1 && historyPosition < fullAuditPosition);
  const auditDisclosure = html.slice(html.lastIndexOf("<details"), html.indexOf("Full website audit and evidence details"));
  assert.doesNotMatch(auditDisclosure, /\bopen(?:="")?(?:\s|>)/);
  assert.match(html, /Why the old score flagged this business/);
  assert.match(html, /This preview does not confirm business fit, contact readiness, or permission to reach out/);
  assert.match(html, /Business fit/);
  assert.match(html, /Rebuild need/);
  assert.match(html, /Evidence confidence/);
  assert.match(html, /Website evidence/);
  assert.match(html, /Critical/);
  assert.match(html, /Important/);
  assert.match(html, /Minor/);
  assert.match(html, /The mobile navigation is not usable/);
  assert.match(html, /Preview unavailable until private evidence storage is enabled/);
  assert.match(html, /Every recorded route/);
  assert.match(html, /\+15195550123/);
  assert.match(html, /hello@roofing\.example/);
  assert.match(html, /Not verified/);
  assert.match(html, /Reviewed contact evidence/);
  assert.match(html, /Matches current assessment/);
  assert.match(html, /Riley reviewed this exact evidence packet/);
  assert.match(html, /Consent is still unassessed/);
  assert.match(html, /local contact storage only/i);
  assert.match(html, /Evidence and decision history/);
  assert.match(html, /Outreach/);
  assert.match(html, /Replies/);
  assert.match(html, /Opportunities/);
  assert.match(html, /Clients/);
  assert.match(html, /This dossier is read-only/);
  assert.doesNotMatch(html, /<button|<form|mailto:|tel:/);
  assert.doesNotMatch(html, />Send</);
  assert.doesNotMatch(html, />Approve</);
});

test("lead dossier puts owner controls ahead of technical research and keeps research closed", () => {
  const html = renderToStaticMarkup(createElement(OwnerLeadDetail, {
    data: fixtureDetail(),
    ownerControls: createElement("section", { "data-owner-controls": "" }, "Owner action controls"),
  }));

  const actionPosition = html.indexOf("Owner action controls");
  const nextStepPosition = html.indexOf("Owner next step");
  const researchPosition = html.indexOf("Research details");
  assert.ok(actionPosition > nextStepPosition && actionPosition < researchPosition);
  assert.ok(researchPosition > -1);
  assert.match(html, /owner controls above can save a local stop or task, but cannot contact this business or approve outreach/);
  const disclosureStart = html.lastIndexOf("<details", researchPosition);
  const disclosureSummary = html.slice(disclosureStart, researchPosition);
  assert.doesNotMatch(disclosureSummary, /\bopen(?:="")?(?:\s|>)/);
  assert.match(html.slice(researchPosition), /Evidence and decision history/);
});

test("lead dossier explains that an unqualified review record needs qualification", () => {
  const base = fixtureDetail();
  const html = renderToStaticMarkup(createElement(OwnerLeadDetail, {
    data: {
      ...base,
      lead: {
        ...base.lead,
        attention: "REVIEW",
        ownerActionable: false,
        qualification: {
          ...base.lead.qualification,
          failedGates: ["rebuild_need_below_65"],
        },
        route: {
          ...base.lead.route,
          readiness: "RESEARCH_REQUIRED",
        },
      },
    },
  }));

  assert.match(html, /Needs qualification/);
  assert.match(html, /Qualification criteria remain unmet/);
  assert.match(html, /Rebuild Need Below 65/);
  assert.doesNotMatch(html, /Why the old score flagged this business/);
  assert.doesNotMatch(html, /Suggested route · read-only/);
});

test("lead dossier keeps only the top three findings in the summary and retains the full audit in a closed disclosure", () => {
  const detail = fixtureDetail();
  detail.website.findings.push({
    ...detail.website.findings[2],
    checkId: "additional-minor-finding",
    category: "other",
  });
  const html = renderToStaticMarkup(createElement(OwnerLeadDetail, { data: detail }));
  const disclosurePosition = html.indexOf("Full website audit and evidence details");
  const summary = html.slice(0, disclosurePosition);
  const disclosure = html.slice(disclosurePosition);

  assert.match(summary, /3 of 4/);
  assert.doesNotMatch(summary, /Other/);
  assert.match(disclosure, /Other/);
  assert.match(disclosure, /<\/details>/);
});

test("lead dossier distinguishes a healthy site from stale or blocked qualification", () => {
  for (const [attention, expected] of [
    ["REVIEW", /No demonstrated website opportunity/],
    ["NEEDS_REFRESH", /Evidence needs refresh/],
    ["BLOCKED", /block prevents owner review/],
  ] as const) {
    const data = fixtureDetail();
    data.lead.attention = attention;
    data.lead.ownerActionable = false;
    data.lead.audit.classification = "NO_OPPORTUNITY";
    data.lead.route.readiness = "RESEARCH_REQUIRED";
    const html = renderToStaticMarkup(createElement(OwnerLeadDetail, { data }));

    assert.match(html, expected);
    assert.doesNotMatch(html, /Why the old score flagged this business|Meets legacy rules/);
    if (attention !== "REVIEW") assert.doesNotMatch(html, /No demonstrated website opportunity/);
  }
});

test("lead dossier labels an absent owner contact review instead of implying approval", () => {
  const detail = fixtureDetail();
  detail.contactReview = {
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
  };
  const html = renderToStaticMarkup(createElement(OwnerLeadDetail, { data: detail }));

  assert.match(html, /Contact review not recorded/);
  assert.match(html, /cannot claim Riley or Aidan reviewed this exact contact packet/);
  assert.match(html, /Consent is unassessed/);
  assert.doesNotMatch(html, /Matches current assessment/);
});

test("lead dossier keeps an older contact review visible without approving the current assessment", () => {
  const detail = fixtureDetail();
  assert.notEqual(detail.contactReview.state, "NOT_RECORDED");
  if (detail.contactReview.state === "NOT_RECORDED") return;
  detail.contactReview = { ...detail.contactReview, state: "STALE_ASSESSMENT" };
  const html = renderToStaticMarkup(createElement(OwnerLeadDetail, { data: detail }));

  assert.match(html, /Older than current assessment/);
  assert.match(html, /website audit or lead score changed after this review/i);
  assert.match(html, /does not approve the current assessment/i);
  assert.doesNotMatch(html, /Matches current assessment/);
});

test("lead dossier makes every evidence link inspectable while contact values stay inert", () => {
  const html = renderToStaticMarkup(createElement(OwnerLeadDetail, { data: fixtureDetail() }));

  assert.match(html, /href="https:\/\/roofing\.example\/evidence\/mobile"/);
  assert.match(html, /href="https:\/\/source\.example\/tri-city-roofing"/);
  assert.match(html, /href="\/leads"/);
  assert.doesNotMatch(html, /href="\+15195550123"/);
  assert.doesNotMatch(html, /href="hello@roofing\.example"/);
});

test("unavailable and not-found dossier states remain plain-language and fail closed", () => {
  const unavailable = renderToStaticMarkup(createElement(OwnerLeadDetailUnavailable));
  const missing = renderToStaticMarkup(createElement(OwnerLeadDetailNotFound));

  assert.match(unavailable, /Could not verify/);
  assert.match(unavailable, /No fallback data is shown/);
  assert.match(unavailable, /read failure does not stop live automation/i);
  assert.match(missing, /Business details not found/);
  assert.match(missing, /Legacy or incomplete data is not promoted/);
  assert.match(missing, /Return to businesses/);
});
