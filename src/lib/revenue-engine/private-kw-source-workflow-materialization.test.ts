import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
} from "@/lib/revenue-engine/private-kw-import";
import {
  buildPrivateKwPersistencePlan,
} from "@/lib/revenue-engine/private-kw-persistence-plan";
import {
  PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION,
  PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
  buildPrivateKwSourceWorkflowMaterializationPlan,
  privateKwSourceWorkflowDigest,
  verifyPrivateKwSourceWorkflowPreflight,
  type PrivateKwSourceWorkflowMaterializationInput,
} from "@/lib/revenue-engine/private-kw-source-workflow-materialization";

const SOURCE_CAPTURED_AT = "2026-08-27T15:00:00.000Z";
const AUDIT_CAPTURED_AT = "2026-08-27T15:01:00.000Z";
const EVIDENCE_COMPLETED_AT = "2026-08-27T15:02:00.000Z";
const REVIEWED_AT = "2026-08-27T15:03:00.000Z";
const SOURCE_URL = "https://directory.axiomfixtures.ca/materialization-fixture";

function sourcePlan(options: { websiteUrl?: string | null } = {}) {
  return preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: "kw-materialization-unit-fixture",
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic private materialization fixture",
    filters: { synthetic: true },
    capturedAt: SOURCE_CAPTURED_AT,
    costUsd: 0,
    records: [{
      sourceOwnedId: "materialization-fixture-1",
      sourceEvidenceUrl: SOURCE_URL,
      businessName: "Synthetic Kitchener Roofing",
      city: "KITCHENER",
      region: "ON",
      country: "CA",
      niche: "ROOFING",
      websiteUrl: options.websiteUrl ?? null,
      phone: "519-555-0131",
      addressLine: "31 Fixture Road",
      postalCode: "N2G 1A1",
      independenceStatus: "INDEPENDENT",
      capturedAt: SOURCE_CAPTURED_AT,
      sourcePayload: { synthetic: true },
    }],
  });
}

function auditInput(source = sourcePlan()) {
  const selected = source.records[0];
  return {
    businessId: selected.business.id,
    businessName: selected.business.canonicalName,
    niche: "roofing",
    expectedServices: ["roofing"],
    expectedLocations: ["Kitchener"],
    sourceEvidenceUrl: SOURCE_URL,
    siteState: "NO_SITE" as const,
    requestedUrl: null,
    finalUrl: null,
    statusCode: 0,
    redirectCount: 0,
    capturedAt: AUDIT_CAPTURED_AT,
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
  };
}

function materializationInput(
  source = sourcePlan(),
  overrides: Partial<PrivateKwSourceWorkflowMaterializationInput> = {},
) {
  const selected = source.records[0];
  const audit = auditInput(source);
  return {
    materializationVersion: PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
    sourceImportId: source.importId,
    sourcePlanDigest: buildPrivateKwPersistencePlan(source).sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    auditInputDigest: privateKwSourceWorkflowDigest(audit),
    auditInput: audit,
    evidenceCompletedAt: EVIDENCE_COMPLETED_AT,
    approval: {
      decision: "APPROVED_FOR_LOCAL_SOURCE_WORKFLOW_MATERIALIZATION" as const,
      reviewedBy: "RILEY" as const,
      reviewedAt: REVIEWED_AT,
      rationale: "Approved synthetic fixture for local source and workflow materialization.",
      confirmation: PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION,
    },
    mode: "SHADOW" as const,
    executionKind: "IGNORED_LOCAL_SQLITE" as const,
    localDatabaseAccessAuthorized: true as const,
    localSourceMutationAuthorized: true as const,
    localWorkflowMutationAuthorized: true as const,
    localAssessmentMutationAuthorized: false as const,
    schemaMutationAuthorized: false as const,
    captureAuthorized: false as const,
    contactDiscoveryAuthorized: false as const,
    contactVerificationAuthorized: false as const,
    outreachAuthorized: false as const,
    sendAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
    ...overrides,
  } satisfies PrivateKwSourceWorkflowMaterializationInput;
}

test("builds one deterministic owner-approved source and sealed-workflow materialization", () => {
  const source = sourcePlan();
  const input = materializationInput(source);
  const first = buildPrivateKwSourceWorkflowMaterializationPlan(source, input);
  const second = buildPrivateKwSourceWorkflowMaterializationPlan(source, input);
  assert.deepEqual(first, second);
  assert.equal(first.records.length, 11);
  assert.equal(first.records.at(-1)?.entity, "MATERIALIZATION_RECEIPT");
  assert.deepEqual(first.summary, {
    sourceRuns: 1,
    businesses: 1,
    locations: 1,
    sourceRecords: 1,
    workflowRecords: 6,
    materializationReceipts: 1,
    qualificationRows: 0,
    contactRows: 0,
    outreachRows: 0,
    providerOperations: 0,
    costUsd: 0,
  });
  assert.equal(first.authority.localSourceMutationAuthorized, true);
  assert.equal(first.authority.localWorkflowMutationAuthorized, true);
  assert.equal(first.authority.localAssessmentMutationAuthorized, false);
  assert.equal(first.authority.captureAuthorized, false);
  assert.equal(first.authority.outreachAuthorized, false);
  assert.equal(first.authority.sendAuthorized, false);
  assert.equal(first.authority.providerOperationsAuthorized, 0);
  assert.equal(first.records.some((record) => /LIMIT\s+1/i.test(record.selectSql)), false);
});

test("rejects source, candidate, audit, and approval drift before returning SQL", () => {
  const source = sourcePlan();
  const base = materializationInput(source);
  assert.throws(
    () => buildPrivateKwSourceWorkflowMaterializationPlan(source, { ...base, sourcePlanDigest: "f".repeat(64) }),
    /exact private KW source plan/i,
  );
  assert.throws(
    () => buildPrivateKwSourceWorkflowMaterializationPlan(source, { ...base, evaluationCandidateId: "evaluation-candidate:wrong" }),
    /one exact private KW evaluation candidate/i,
  );
  assert.throws(
    () => buildPrivateKwSourceWorkflowMaterializationPlan(source, {
      ...base,
      auditInput: { ...base.auditInput, businessName: "Tampered business" },
    }),
    /exact deterministic audit input/i,
  );
  assert.throws(
    () => buildPrivateKwSourceWorkflowMaterializationPlan(source, {
      ...base,
      approval: { ...base.approval, reviewedAt: "2026-08-27T15:01:30.000Z" },
    }),
    /chronologically ordered/i,
  );
});

test("requires website presence and deterministic audit state to agree", () => {
  const source = sourcePlan({ websiteUrl: "https://synthetic-roofing.ca" });
  const audit = auditInput(source);
  const input = materializationInput(source, {
    auditInput: audit,
    auditInputDigest: privateKwSourceWorkflowDigest(audit),
  });
  assert.throws(
    () => buildPrivateKwSourceWorkflowMaterializationPlan(source, input),
    /audit of that exact canonical URL/i,
  );
});

test("preflight rejects multiple identity matches even when one row is exact", () => {
  const plan = buildPrivateKwSourceWorkflowMaterializationPlan(sourcePlan(), materializationInput());
  const business = plan.records.find((record) => record.entity === "BUSINESS");
  assert.ok(business);
  const exact = { ...business.expected };
  assert.deepEqual(verifyPrivateKwSourceWorkflowPreflight(business, []), { state: "MISSING", matches: true });
  assert.deepEqual(verifyPrivateKwSourceWorkflowPreflight(business, [exact]), { state: "EXACT_MATCH", matches: true });
  assert.deepEqual(
    verifyPrivateKwSourceWorkflowPreflight(business, [exact, { ...exact, id: "business:hidden-collision" }]),
    { state: "CONFLICT", matches: false },
  );
});
