import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_KW_ASSESSMENT_APPROVAL_CONFIRMATION,
  PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION,
  buildPrivateKwAssessmentInvocation,
  privateKwAssessmentIdempotencyKey,
  type PrivateKwAssessmentInvocationInput,
} from "@/lib/revenue-engine/private-kw-assessment-invocation";
import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
} from "@/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "@/lib/revenue-engine/private-kw-persistence-plan";

const ASSESSED_AT = new Date(Date.now() - 60_000).toISOString();
const SOURCE_URL = "https://directory.axiomfixtures.ca/private-kw-1";
const WORKFLOW_RECEIPT_ID = "workflow-receipt:" + "a".repeat(64);

function sourcePlan() {
  return preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: "kw-private-assessment-fixture",
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic private assessment fixture",
    filters: { synthetic: true },
    capturedAt: ASSESSED_AT,
    costUsd: 0,
    records: [{
      sourceOwnedId: "private-assessment-1",
      sourceEvidenceUrl: SOURCE_URL,
      businessName: "Synthetic Waterloo HVAC",
      city: "WATERLOO",
      region: "ON",
      country: "CA",
      niche: "HVAC",
      websiteUrl: "https://synthetic-hvac.ca",
      phone: "519-555-0123",
      addressLine: "1 Fixture Street",
      postalCode: "N2L 1A1",
      independenceStatus: "INDEPENDENT",
      capturedAt: ASSESSED_AT,
      sourcePayload: { synthetic: true },
    }],
  });
}

function invocationInput(overrides: Partial<PrivateKwAssessmentInvocationInput> = {}) {
  const source = sourcePlan();
  const selected = source.records[0];
  const sourcePlanDigest = buildPrivateKwPersistencePlan(source).sourcePlanDigest;
  return {
    invocationVersion: PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION,
    sourceImportId: source.importId,
    sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    workflowReceiptId: WORKFLOW_RECEIPT_ID,
    assessedAt: ASSESSED_AT,
    businessFitScore: 80,
    timingScore: 30,
    basisClaims: [{
      basisId: "basis:private:fit",
      dimension: "BUSINESS_FIT" as const,
      observation: "The owner-reviewed source identifies an independent local HVAC business.",
      sourceUrl: SOURCE_URL,
      capturedAt: ASSESSED_AT,
      method: "owner_review" as const,
      confidence: 100,
    }, {
      basisId: "basis:private:timing",
      dimension: "TIMING" as const,
      observation: "No stronger current timing signal is supported by the reviewed source.",
      sourceUrl: SOURCE_URL,
      capturedAt: ASSESSED_AT,
      method: "owner_review" as const,
      confidence: 100,
    }],
    policyBlocks: [],
    approval: {
      decision: "APPROVED_FOR_LOCAL_SHADOW_ASSESSMENT" as const,
      reviewedBy: "RILEY" as const,
      reviewedAt: ASSESSED_AT,
      rationale: "Synthetic record approved for the local-only assessment fixture.",
      confirmation: PRIVATE_KW_ASSESSMENT_APPROVAL_CONFIRMATION,
    },
    mode: "SHADOW" as const,
    localAssessmentMutationAuthorized: true as const,
    sourceMutationAuthorized: false as const,
    workflowMutationAuthorized: false as const,
    contactDiscoveryAuthorized: false as const,
    outreachAuthorized: false as const,
    sendAuthorized: false as const,
    providerOperationsAuthorized: 0 as const,
    costAuthorizedUsd: 0 as const,
    ...overrides,
  } satisfies PrivateKwAssessmentInvocationInput;
}

test("binds one owner-approved source candidate to a deterministic local-only assessment request", () => {
  const source = sourcePlan();
  const input = invocationInput();
  const first = buildPrivateKwAssessmentInvocation(source, input);
  const second = buildPrivateKwAssessmentInvocation(source, input);
  assert.deepEqual(first, second);
  assert.equal(first.businessId, source.records[0].business.id);
  assert.equal(first.request.idempotencyKey, privateKwAssessmentIdempotencyKey({
    sourcePlanDigest: input.sourcePlanDigest,
    businessId: input.businessId,
    workflowReceiptId: input.workflowReceiptId,
  }));
  assert.equal(first.authority.executionKind, "IGNORED_LOCAL_SQLITE");
  assert.equal(first.authority.localAssessmentMutationAuthorized, true);
  assert.equal(first.authority.sourceMutationAuthorized, false);
  assert.equal(first.authority.contactDiscoveryAuthorized, false);
  assert.equal(first.authority.outreachAuthorized, false);
  assert.equal(first.authority.sendAuthorized, false);
  assert.equal(first.authority.providerOperationsAuthorized, 0);
});

test("rejects source drift, candidate drift, unbound approval time, and unrelated basis URLs", () => {
  const source = sourcePlan();
  assert.throws(
    () => buildPrivateKwAssessmentInvocation(source, invocationInput({ sourcePlanDigest: "f".repeat(64) })),
    /exact private KW source plan/,
  );
  assert.throws(
    () => buildPrivateKwAssessmentInvocation(source, invocationInput({ evaluationCandidateId: "evaluation-candidate:wrong" })),
    /one exact KW evaluation candidate/,
  );
  assert.throws(
    () => buildPrivateKwAssessmentInvocation(source, invocationInput({
      approval: { ...invocationInput().approval, reviewedAt: new Date(Date.parse(ASSESSED_AT) - 1_000).toISOString() },
    })),
    /exact assessment timestamp/,
  );
  assert.throws(
    () => buildPrivateKwAssessmentInvocation(source, invocationInput({
      basisClaims: invocationInput().basisClaims.map((claim) => ({ ...claim, sourceUrl: "https://unrelated.example.org/" })),
    })),
    /approved source record/,
  );
});
