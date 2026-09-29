import assert from "node:assert/strict";
import test from "node:test";

import {
  REVENUE_LEAD_ASSESSMENT_VERSION,
  buildRevenueLeadAssessment,
  revenueLeadAssessmentCanonicalJson,
  revenueLeadAssessmentDigest,
} from "@/lib/revenue-engine/lead-assessment";
import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
} from "@/lib/revenue-engine/private-kw-import";
import {
  PRIVATE_KW_OWNER_LABELING_VERSION,
  PrivateKwOwnerLabelingPacketSchema,
  applyPrivateKwOwnerLabels,
  buildPrivateKwOwnerLabelingPacket,
  type PrivateKwOwnerLabelSubmission,
} from "@/lib/revenue-engine/private-kw-owner-labeling";
import { auditWebsiteDeterministically } from "@/lib/revenue-engine/website-audit";

const SOURCE_URL = "https://directory.axiomfixtures.ca/owner-labeling";
const WEBSITE_URL = "https://owner-labeling.axiomfixtures.ca/";
const CAPTURED_AT = "2026-08-28T14:00:00.000Z";
const PREPARED_AT = "2026-08-28T14:05:00.000Z";

function sourcePlan(options: { importId?: string; businessName?: string; independenceStatus?: "INDEPENDENT" | "CHAIN" } = {}) {
  return preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: options.importId ?? "kw-owner-labeling-fixture",
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic owner-labeling fixture",
    filters: { synthetic: true },
    capturedAt: "2026-08-28T13:55:00.000Z",
    costUsd: 0,
    records: [{
      sourceOwnedId: "owner-labeling-1",
      sourceEvidenceUrl: SOURCE_URL,
      businessName: options.businessName ?? "Synthetic Kitchener Roofing",
      city: "KITCHENER",
      region: "ON",
      country: "CA",
      niche: "ROOFING",
      websiteUrl: WEBSITE_URL,
      phone: "519-555-0188",
      addressLine: "88 Fixture Street",
      postalCode: "N2G 1A1",
      independenceStatus: options.independenceStatus ?? "INDEPENDENT",
      capturedAt: "2026-08-28T13:55:00.000Z",
      sourcePayload: { synthetic: true },
    }],
  });
}

function assessment(source = sourcePlan()) {
  const record = source.records[0]!;
  const audit = auditWebsiteDeterministically({
    businessId: record.business.id,
    businessName: record.business.canonicalName,
    niche: "roofing",
    expectedServices: ["roofing"],
    expectedLocations: ["Kitchener"],
    sourceEvidenceUrl: SOURCE_URL,
    siteState: "CAPTURED",
    requestedUrl: WEBSITE_URL,
    finalUrl: WEBSITE_URL,
    statusCode: 200,
    redirectCount: 0,
    capturedAt: CAPTURED_AT,
    desktopArtifactRef: null,
    mobileArtifactRef: `artifact:sha256:${"a".repeat(64)}`,
    domArtifactRef: null,
    pageSetComplete: true,
    pages: [{
      kind: "HOME",
      url: WEBSITE_URL,
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
    resourceProbes: [{ url: `${WEBSITE_URL}missing.css`, type: "ASSET", internal: true, statusCode: 404 }],
    mobile: {
      captured: true,
      horizontalOverflow: true,
      navigationUsable: false,
      textReadable: false,
      minimumTapTargetPx: 28,
    },
  });
  const workflowReceiptId = "workflow-receipt:owner-labeling";
  const receipt = {
    workflowVersion: "fixture-website-evidence-workflow-v1",
    workflowId: "12345678-1234-4234-8234-123456789012",
    businessId: record.business.id,
    completedAt: "2026-08-28T14:01:00.000Z",
    mode: "SHADOW" as const,
    status: "COMPLETED" as const,
    audit,
    budget: { totalCostUsd: 0, providerOperations: 0 },
  };
  const receiptJson = revenueLeadAssessmentCanonicalJson(receipt);
  return buildRevenueLeadAssessment({
    request: {
      assessmentVersion: REVENUE_LEAD_ASSESSMENT_VERSION,
      idempotencyKey: `owner-labeling-assessment:${record.business.id}`,
      workflowReceiptId,
      assessedAt: "2026-08-28T14:03:00.000Z",
      mode: "SHADOW",
      businessFitScore: 90,
      timingScore: 80,
      basisClaims: [{
        basisId: "basis:owner-labeling:fit",
        dimension: "BUSINESS_FIT",
        observation: "The synthetic fixture represents an established independent local roofing operator.",
        sourceUrl: SOURCE_URL,
        capturedAt: "2026-08-28T13:55:00.000Z",
        method: "owner_review",
        confidence: 100,
      }, {
        basisId: "basis:owner-labeling:timing",
        dimension: "TIMING",
        observation: "The synthetic fixture uses a current evidence window for the owner-labeling contract.",
        sourceUrl: SOURCE_URL,
        capturedAt: "2026-08-28T13:55:00.000Z",
        method: "owner_review",
        confidence: 100,
      }],
      policyBlocks: [],
    },
    business: {
      id: record.business.id,
      canonicalName: record.business.canonicalName,
      independenceStatus: record.business.independenceStatus,
      status: record.business.status,
    },
    sealedReceipt: {
      workflowReceiptId,
      workflowRunId: receipt.workflowId,
      rowWorkflowVersion: receipt.workflowVersion,
      rowStatus: receipt.status,
      receiptDigest: revenueLeadAssessmentDigest(receipt),
      receiptJson,
      recordedAt: "2026-08-28T14:02:00.000Z",
      closureStatus: "SEALED",
      terminalReceiptId: workflowReceiptId,
    },
  });
}

function submission(packet: ReturnType<typeof buildPrivateKwOwnerLabelingPacket>): PrivateKwOwnerLabelSubmission {
  return {
    submissionVersion: PRIVATE_KW_OWNER_LABELING_VERSION,
    packetId: packet.packetId,
    packetDigest: packet.packetDigest,
    reviewedBy: "RILEY",
    reviewedAt: "2026-08-28T14:06:00.000Z",
    decisions: [{
      leadId: packet.entries[0]!.leadId,
      label: "STRONG",
      reasons: ["GOOD_COMMERCIAL_FIT", "CLEAR_REBUILD_NEED"],
      notes: "Worth keeping in the measured KW quality set.",
    }],
    reviewOnly: true,
    databaseMutationAuthorized: false,
    qualificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
}

test("builds an immutable owner-readable checkpoint from exact assessed source records", () => {
  const source = sourcePlan();
  const packet = buildPrivateKwOwnerLabelingPacket(source, [assessment(source)], PREPARED_AT);

  assert.equal(packet.entries.length, 1);
  assert.equal(packet.entries[0]?.engineAssessment.label, "STRONG");
  assert.equal(packet.entries[0]?.ownerReview.label, "UNREVIEWED");
  assert.equal(packet.summary.loaded, 1);
  assert.equal(packet.summary.reviewed, 0);
  assert.equal(packet.summary.ready, false);
  assert(packet.summary.gateReasons.includes("needs_49_more_leads"));
  assert.equal(packet.authority.databaseMutationAuthorized, false);
  assert.equal(packet.authority.outreachAuthorized, false);
  assert.equal(packet.authority.sendAuthorized, false);
  assert.equal(packet.authority.providerOperationsAuthorized, 0);
});

test("records owner decisions as a new content-bound checkpoint and preserves the parent", () => {
  const source = sourcePlan();
  const packet = buildPrivateKwOwnerLabelingPacket(source, [assessment(source)], PREPARED_AT);
  const next = applyPrivateKwOwnerLabels(packet, submission(packet));

  assert.equal(next.parentPacketId, packet.packetId);
  assert.notEqual(next.packetId, packet.packetId);
  assert.equal(next.entries[0]?.ownerReview.label, "STRONG");
  assert.deepEqual(next.entries[0]?.ownerReview.reasons, ["GOOD_COMMERCIAL_FIT", "CLEAR_REBUILD_NEED"]);
  assert.equal(next.summary.reviewed, 1);
  assert.equal(next.summary.agreements, 1);
  assert.equal(next.summary.agreementPercent, 100);
  assert.throws(() => applyPrivateKwOwnerLabels(next, {
    ...submission(packet),
    packetId: next.packetId,
    packetDigest: next.packetDigest,
  }), /cannot relabel/i);
});

test("decision drift, duplicate decisions, and predated review checkpoints fail closed", () => {
  const source = sourcePlan();
  const packet = buildPrivateKwOwnerLabelingPacket(source, [assessment(source)], PREPARED_AT);
  assert.throws(() => applyPrivateKwOwnerLabels(packet, { ...submission(packet), packetDigest: "f".repeat(64) }), /exact labeling checkpoint/i);
  assert.throws(() => applyPrivateKwOwnerLabels(packet, {
    ...submission(packet),
    decisions: [submission(packet).decisions[0]!, submission(packet).decisions[0]!],
  }));
  assert.throws(() => applyPrivateKwOwnerLabels(packet, {
    ...submission(packet),
    reviewedAt: "2026-08-28T14:04:00.000Z",
  }), /cannot predate/i);
});

test("tampered packets and source or assessment identity drift cannot become owner truth", () => {
  const source = sourcePlan();
  const exactAssessment = assessment(source);
  const packet = buildPrivateKwOwnerLabelingPacket(source, [exactAssessment], PREPARED_AT);
  const tampered = structuredClone(packet);
  tampered.entries[0]!.engineAssessment.label = "WRONG";
  assert.equal(PrivateKwOwnerLabelingPacketSchema.safeParse(tampered).success, false);

  const otherSource = sourcePlan({ importId: "kw-owner-labeling-other", businessName: "Different Roofing Identity" });
  assert.throws(
    () => buildPrivateKwOwnerLabelingPacket(otherSource, [exactAssessment], PREPARED_AT),
    /outside the exact private KW source plan|do not match/i,
  );
  const digestDrift = { ...exactAssessment, assessmentDigest: "f".repeat(64) };
  assert.throws(() => buildPrivateKwOwnerLabelingPacket(source, [digestDrift], PREPARED_AT), /content-derived exact assessment/i);
});
