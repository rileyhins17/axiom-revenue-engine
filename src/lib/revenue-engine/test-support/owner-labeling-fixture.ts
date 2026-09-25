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
import { buildPrivateKwOwnerLabelingPacket } from "@/lib/revenue-engine/private-kw-owner-labeling";
import { auditWebsiteDeterministically } from "@/lib/revenue-engine/website-audit";

const CITIES = ["KITCHENER", "WATERLOO", "CAMBRIDGE"] as const;
const NICHES = ["ROOFING", "HVAC", "LANDSCAPING"] as const;

export function buildCompleteOwnerLabelingPacketFixture() {
  const capturedAt = "2026-08-28T14:00:00.000Z";
  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: "kw-owner-labeling-complete-fixture",
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic complete owner-labeling fixture",
    filters: { synthetic: true },
    capturedAt,
    costUsd: 0,
    records: Array.from({ length: 50 }, (_, index) => {
      const number = index + 1;
      const city = CITIES[index % CITIES.length];
      const niche = NICHES[index % NICHES.length];
      const host = `quality-${String(number).padStart(2, "0")}.axiomfixtures.ca`;
      return {
        sourceOwnedId: `quality-business-${number}`,
        sourceEvidenceUrl: `https://directory.axiomfixtures.ca/quality-business-${number}`,
        businessName: number === 1 ? "Tri-City Quality Fixture" : `Synthetic Quality Business ${number}`,
        city,
        region: "ON" as const,
        country: "CA" as const,
        niche,
        websiteUrl: `https://${host}/`,
        phone: `519-555-${String(100 + index).padStart(4, "0")}`,
        addressLine: `${100 + index} Fixture Street`,
        postalCode: "N2G 1A1",
        independenceStatus: "INDEPENDENT" as const,
        capturedAt,
        sourcePayload: { synthetic: true, number },
      };
    }),
  });

  const assessments = source.records.map((record, index) => {
    const websiteUrl = `https://quality-${String(index + 1).padStart(2, "0")}.axiomfixtures.ca/`;
    const sourceUrl = record.sourceRecord.sourceEvidenceUrl;
    const artifactDigest = (index + 1).toString(16).padStart(64, "0");
    const audit = auditWebsiteDeterministically({
      businessId: record.business.id,
      businessName: record.business.canonicalName,
      niche: record.niche.toLowerCase(),
      expectedServices: [record.niche.toLowerCase()],
      expectedLocations: [record.location.city.toLowerCase()],
      sourceEvidenceUrl: sourceUrl,
      siteState: "CAPTURED",
      requestedUrl: websiteUrl,
      finalUrl: websiteUrl,
      statusCode: 200,
      redirectCount: 0,
      capturedAt: "2026-08-28T14:01:00.000Z",
      desktopArtifactRef: null,
      mobileArtifactRef: `artifact:sha256:${artifactDigest}`,
      domArtifactRef: null,
      pageSetComplete: true,
      pages: [{
        kind: "HOME",
        url: websiteUrl,
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
      resourceProbes: [{ url: `${websiteUrl}missing.css`, type: "ASSET", internal: true, statusCode: 404 }],
      mobile: {
        captured: true,
        horizontalOverflow: true,
        navigationUsable: false,
        textReadable: false,
        minimumTapTargetPx: 20,
      },
    });
    const suffix = String(index + 1).padStart(12, "0");
    const workflowReceiptId = `workflow-receipt:owner-quality:${index + 1}`;
    const receipt = {
      workflowVersion: "fixture-website-evidence-workflow-v1",
      workflowId: `12345678-1234-4234-8234-${suffix}`,
      businessId: record.business.id,
      completedAt: "2026-08-28T14:02:00.000Z",
      mode: "SHADOW" as const,
      status: "COMPLETED" as const,
      audit,
      budget: { totalCostUsd: 0, providerOperations: 0 },
    };
    return buildRevenueLeadAssessment({
      request: {
        assessmentVersion: REVENUE_LEAD_ASSESSMENT_VERSION,
        idempotencyKey: `owner-quality-assessment:${record.business.id}`,
        workflowReceiptId,
        assessedAt: "2026-08-28T14:04:00.000Z",
        mode: "SHADOW",
        businessFitScore: 90,
        timingScore: 80,
        basisClaims: [{
          basisId: `basis:owner-quality:fit:${index + 1}`,
          dimension: "BUSINESS_FIT",
          observation: "The synthetic fixture represents an established independent local service operator.",
          sourceUrl,
          capturedAt,
          method: "owner_review",
          confidence: 100,
        }, {
          basisId: `basis:owner-quality:timing:${index + 1}`,
          dimension: "TIMING",
          observation: "The synthetic fixture uses a current evidence window for owner quality testing.",
          sourceUrl,
          capturedAt,
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
        receiptJson: revenueLeadAssessmentCanonicalJson(receipt),
        recordedAt: "2026-08-28T14:03:00.000Z",
        closureStatus: "SEALED",
        terminalReceiptId: workflowReceiptId,
      },
    });
  });

  return buildPrivateKwOwnerLabelingPacket(source, assessments, "2026-08-28T14:05:00.000Z");
}
