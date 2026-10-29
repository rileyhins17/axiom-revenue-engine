import assert from "node:assert/strict";
import test from "node:test";

import {
  REVENUE_LEAD_ASSESSMENT_VERSION,
  buildRevenueLeadAssessment,
  revenueLeadAssessmentCanonicalJson,
  revenueLeadAssessmentDigest,
  type RevenueLeadAssessmentRequest,
} from "@/lib/revenue-engine/lead-assessment";
import { auditWebsiteDeterministically } from "@/lib/revenue-engine/website-audit";

const BUSINESS_ID = "business:assessment-fixture";
const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const RECEIPT_ID = "workflow-receipt:assessment-fixture";
const CAPTURED_AT = "2026-08-26T13:00:00.000Z";
const ASSESSED_AT = "2026-08-26T13:05:00.000Z";

function audit() {
  return auditWebsiteDeterministically({
    businessId: BUSINESS_ID,
    businessName: "Assessment Fixture Roofing",
    niche: "roofing",
    expectedServices: ["roofing"],
    expectedLocations: ["Kitchener"],
    sourceEvidenceUrl: "https://directory.axiomfixtures.ca/assessment-fixture",
    siteState: "NO_SITE",
    requestedUrl: null,
    finalUrl: null,
    statusCode: 0,
    redirectCount: 0,
    capturedAt: CAPTURED_AT,
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

function rawReceipt() {
  return {
    workflowVersion: "website-evidence-workflow-v1",
    workflowId: WORKFLOW_ID,
    businessId: BUSINESS_ID,
    completedAt: "2026-08-26T13:01:00.000Z",
    mode: "SHADOW",
    status: "COMPLETED",
    audit: audit(),
    budget: { totalCostUsd: 0, providerOperations: 0 },
  } as const;
}

function request(overrides: Partial<RevenueLeadAssessmentRequest> = {}): RevenueLeadAssessmentRequest {
  return {
    assessmentVersion: REVENUE_LEAD_ASSESSMENT_VERSION,
    idempotencyKey: "assessment-fixture:2026-08-26",
    workflowReceiptId: RECEIPT_ID,
    assessedAt: ASSESSED_AT,
    mode: "SHADOW",
    businessFitScore: 82,
    timingScore: 35,
    basisClaims: [{
      basisId: "basis:fit",
      dimension: "BUSINESS_FIT",
      observation: "The source record identifies an established independent local roofing operator.",
      sourceUrl: "https://directory.axiomfixtures.ca/assessment-fixture",
      capturedAt: CAPTURED_AT,
      method: "source_api",
      confidence: 90,
    }, {
      basisId: "basis:timing",
      dimension: "TIMING",
      observation: "No current timing event is supported, so timing remains conservative.",
      sourceUrl: "https://directory.axiomfixtures.ca/assessment-fixture",
      capturedAt: CAPTURED_AT,
      method: "owner_review",
      confidence: 100,
    }],
    policyBlocks: [],
    ...overrides,
  };
}

function build(overrides: Partial<RevenueLeadAssessmentRequest> = {}, receipt = rawReceipt()) {
  const receiptJson = revenueLeadAssessmentCanonicalJson(receipt);
  return buildRevenueLeadAssessment({
    request: request(overrides),
    business: {
      id: BUSINESS_ID,
      canonicalName: "Assessment Fixture Roofing",
      independenceStatus: "INDEPENDENT",
      status: "RESEARCH_ONLY",
    },
    sealedReceipt: {
      workflowReceiptId: RECEIPT_ID,
      workflowRunId: WORKFLOW_ID,
      rowWorkflowVersion: receipt.workflowVersion,
      rowStatus: receipt.status,
      receiptDigest: revenueLeadAssessmentDigest(receipt),
      receiptJson,
      recordedAt: "2026-08-26T13:02:00.000Z",
      closureStatus: "SEALED",
      terminalReceiptId: RECEIPT_ID,
    },
  });
}

test("builds one deterministic evidence-bound research assessment with zero runtime authority", () => {
  const first = build();
  const second = build();

  assert.deepEqual(first, second);
  assert.match(first.assessmentId, /^assessment:[a-f0-9]{64}$/);
  assert.match(first.websiteSnapshotId, /^website:[a-f0-9]{64}$/);
  assert.match(first.qualificationSnapshotId, /^qualification:[a-f0-9]{64}$/);
  assert.equal(first.audit.auditVersion, "website-audit-deterministic-v4");
  assert.equal(first.qualification.scores.rebuildNeed, first.audit.rebuildNeedScore);
  assert.equal(first.qualification.scores.evidenceConfidence, first.audit.evidenceConfidence);
  assert.equal(first.qualification.scores.reachability, 0);
  assert.equal(first.qualification.recommendedChannel, "RESEARCH");
  assert.equal(first.qualification.band, "RESEARCH");
  assert(first.qualification.failedGates.includes("no_usable_channel"));
  assert.deepEqual(first.authority, {
    runtimeConnected: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  });
});

test("derives chain and policy blocks instead of trusting caller qualification output", () => {
  const receipt = rawReceipt();
  const receiptJson = revenueLeadAssessmentCanonicalJson(receipt);
  const result = buildRevenueLeadAssessment({
    request: request({ policyBlocks: ["LEGAL_OR_POLICY"] }),
    business: {
      id: BUSINESS_ID,
      canonicalName: "Assessment Fixture Roofing",
      independenceStatus: "FRANCHISE",
      status: "RESEARCH_ONLY",
    },
    sealedReceipt: {
      workflowReceiptId: RECEIPT_ID,
      workflowRunId: WORKFLOW_ID,
      rowWorkflowVersion: receipt.workflowVersion,
      rowStatus: receipt.status,
      receiptDigest: revenueLeadAssessmentDigest(receipt),
      receiptJson,
      recordedAt: "2026-08-26T13:02:00.000Z",
      closureStatus: "SEALED",
      terminalReceiptId: RECEIPT_ID,
    },
  });

  assert.equal(result.qualification.band, "DISQUALIFIED");
  assert(result.qualification.failedGates.includes("chain_or_franchise"));
  assert(result.qualification.failedGates.includes("legal_or_policy_block"));
});

test("rejects unbound, stale, or incomplete assessment evidence", () => {
  const receipt = rawReceipt();
  const receiptJson = revenueLeadAssessmentCanonicalJson(receipt);
  assert.throws(() => buildRevenueLeadAssessment({
    request: request(),
    business: { id: BUSINESS_ID, canonicalName: "Assessment Fixture Roofing", independenceStatus: "INDEPENDENT", status: "RESEARCH_ONLY" },
    sealedReceipt: {
      workflowReceiptId: RECEIPT_ID,
      workflowRunId: WORKFLOW_ID,
      rowWorkflowVersion: receipt.workflowVersion,
      rowStatus: receipt.status,
      receiptDigest: "f".repeat(64),
      receiptJson,
      recordedAt: "2026-08-26T13:02:00.000Z",
      closureStatus: "SEALED",
      terminalReceiptId: RECEIPT_ID,
    },
  }), /digest does not bind/i);

  assert.throws(() => build({ assessedAt: "2026-08-28T13:05:00.000Z" }), /current, non-future/i);
  assert.throws(() => build({ basisClaims: request().basisClaims.filter((claim) => claim.dimension === "BUSINESS_FIT") }), /TIMING basis/i);

  const forgedClaimId = `claim:v4:${"e".repeat(64)}`;
  const forgedAudit = audit();
  const forgedReceipt = {
    ...receipt,
    audit: {
      ...forgedAudit,
      claims: forgedAudit.claims.map((claim) => ({ ...claim, claimId: forgedClaimId })),
      checks: forgedAudit.checks.map((check) => check.claimId ? { ...check, claimId: forgedClaimId } : check),
    },
  };
  assert.throws(() => build({}, forgedReceipt), /identity does not bind/i);
});
