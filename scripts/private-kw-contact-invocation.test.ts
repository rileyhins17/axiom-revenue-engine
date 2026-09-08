import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  type RevenueLeadAssessmentD1Boundary,
} from "../src/lib/revenue-engine/lead-assessment-d1";
import {
  PRIVATE_KW_ASSESSMENT_APPROVAL_CONFIRMATION,
  PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION,
  type PrivateKwAssessmentInvocationInput,
} from "../src/lib/revenue-engine/private-kw-assessment-invocation";
import {
  REVENUE_CONTACT_EVIDENCE_VERSION,
} from "../src/lib/revenue-engine/contact-discovery";
import { buildRevenueContactPersistencePlan } from "../src/lib/revenue-engine/contact-persistence-plan";
import {
  PRIVATE_KW_CONTACT_INVOCATION_APPROVAL_VERSION,
  PRIVATE_KW_CONTACT_REVIEW_VERSION,
  PrivateKwContactInvocationSchema,
  PrivateKwContactReviewSchema,
  type PrivateKwContactInvocationApproval,
  type PrivateKwContactReviewDraft,
} from "../src/lib/revenue-engine/private-kw-contact-invocation";
import {
  loadPrivateKwContactInvocationDurable,
} from "../src/lib/revenue-engine/private-kw-contact-invocation-durable";
import {
  PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION,
  PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
} from "../src/lib/revenue-engine/private-kw-contact-persistence";
import {
  PRIVATE_KW_IMPORT_VERSION,
  preparePrivateKwImport,
} from "../src/lib/revenue-engine/private-kw-import";
import { buildPrivateKwPersistencePlan } from "../src/lib/revenue-engine/private-kw-persistence-plan";
import {
  PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION,
  PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
  buildPrivateKwSourceWorkflowMaterializationPlan,
  privateKwSourceWorkflowDigest,
  type PrivateKwSourceWorkflowMaterializationInput,
} from "../src/lib/revenue-engine/private-kw-source-workflow-materialization";
import {
  RevenueLeadAssessmentSchema,
  type RevenueLeadAssessment,
} from "../src/lib/revenue-engine/lead-assessment";
import {
  OWNER_LEAD_CONTACT_REVIEW_QUERY,
  projectOwnerContactReview,
} from "../src/lib/revenue-engine/owner-lead-detail-read-model";
import { executePrivateKwAssessmentFile } from "./execute-private-kw-assessment";
import { materializePrivateKwSourceWorkflowFile } from "./materialize-private-kw-source-workflow";
import {
  executePrivateKwContactInvocationForLocalDatabase,
  persistPrivateKwContactsFile,
} from "./persist-private-kw-contacts";
import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import {
  resolvePrivateKwDataPath,
  resolvePrivateKwDatabasePath,
  writePrivateKwJson,
} from "./private-kw-files";
import { preparePrivateKwContactReviewFile } from "./prepare-private-kw-contact-review";

function iso(now: number, offsetMs: number) {
  return new Date(now + offsetMs).toISOString();
}

function count(database: Database.Database, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as { count: number }).count;
}

async function readJson(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

function persistedAssessment(database: Database.Database): RevenueLeadAssessment {
  const rows = database.prepare(`SELECT "assessmentJson" FROM "RevenueLeadAssessmentReceipt" ORDER BY "id"`).all() as { assessmentJson: string }[];
  assert.equal(rows.length, 1);
  return RevenueLeadAssessmentSchema.parse(JSON.parse(rows[0]!.assessmentJson) as unknown);
}

test("prepares a read-only assessed contact review, then persists it only with a separate exact approval", async () => {
  const suffix = randomUUID();
  const sourceRelative = `data/kw-evaluation/test-contact-invocation-source-${suffix}.json`;
  const materializationRelative = `data/kw-evaluation/test-contact-invocation-materialization-${suffix}.json`;
  const assessmentRelative = `data/kw-evaluation/test-contact-invocation-assessment-${suffix}.json`;
  const draftRelative = `data/kw-evaluation/test-contact-invocation-draft-${suffix}.json`;
  const reviewRelative = `data/kw-evaluation/test-contact-invocation-review-${suffix}.json`;
  const driftApprovalRelative = `data/kw-evaluation/test-contact-invocation-drift-${suffix}.json`;
  const approvalRelative = `data/kw-evaluation/test-contact-invocation-approval-${suffix}.json`;
  const databaseRelative = `data/kw-evaluation/test-contact-invocation-${suffix}.sqlite`;
  const sourceFile = resolvePrivateKwDataPath(sourceRelative);
  const materializationFile = resolvePrivateKwDataPath(materializationRelative);
  const assessmentFile = resolvePrivateKwDataPath(assessmentRelative);
  const draftFile = resolvePrivateKwDataPath(draftRelative);
  const reviewFile = resolvePrivateKwDataPath(reviewRelative);
  const driftApprovalFile = resolvePrivateKwDataPath(driftApprovalRelative);
  const approvalFile = resolvePrivateKwDataPath(approvalRelative);
  const databaseFile = resolvePrivateKwDatabasePath(databaseRelative);
  const now = Date.now();
  const sourceCapturedAt = iso(now, -4 * 60_000);
  const auditCapturedAt = iso(now, -3.5 * 60_000);
  const evidenceCompletedAt = iso(now, -3 * 60_000);
  const materializationReviewedAt = iso(now, -2.5 * 60_000);
  const assessedAt = iso(now, -2 * 60_000);
  const discoveryRequestedAt = iso(now, -1.8 * 60_000);
  const contactCapturedAt = iso(now, -1.6 * 60_000);
  const discoveryCompletedAt = iso(now, -1.4 * 60_000);
  const verificationRequestedAt = iso(now, -1.2 * 60_000);
  const verifiedAt = iso(now, -60_000);
  const verificationCompletedAt = iso(now, -45_000);
  const contactReviewedAt = iso(now, -20_000);
  const sourceUrl = "https://directory.axiomfixtures.ca/reviewed-contact";
  const websiteUrl = "https://reviewed-contact.axiomfixtures.ca/";
  const source = preparePrivateKwImport({
    importVersion: PRIVATE_KW_IMPORT_VERSION,
    importId: `kw-contact-invocation-${suffix}`,
    adapter: "MANUAL_RESEARCH",
    queryText: "Synthetic reviewed contact invocation fixture",
    filters: { synthetic: true },
    capturedAt: sourceCapturedAt,
    costUsd: 0,
    records: [{
      sourceOwnedId: "reviewed-contact-1",
      sourceEvidenceUrl: sourceUrl,
      businessName: "Synthetic Kitchener Roofing Review",
      city: "KITCHENER",
      region: "ON",
      country: "CA",
      niche: "ROOFING",
      websiteUrl,
      phone: "519-555-0176",
      addressLine: "76 Fixture Street",
      postalCode: "N2G 1A1",
      independenceStatus: "INDEPENDENT",
      capturedAt: sourceCapturedAt,
      sourcePayload: { synthetic: true },
    }],
  });
  const selected = source.records[0]!;
  const sourcePlanDigest = buildPrivateKwPersistencePlan(source).sourcePlanDigest;
  const auditInput = {
    businessId: selected.business.id,
    businessName: selected.business.canonicalName,
    niche: "roofing",
    expectedServices: ["roofing"],
    expectedLocations: ["Kitchener"],
    sourceEvidenceUrl: sourceUrl,
    siteState: "CAPTURED" as const,
    requestedUrl: websiteUrl,
    finalUrl: websiteUrl,
    statusCode: 200,
    redirectCount: 0,
    capturedAt: auditCapturedAt,
    desktopArtifactRef: null,
    mobileArtifactRef: null,
    domArtifactRef: null,
    pageSetComplete: true,
    pages: [{
      kind: "HOME" as const,
      url: websiteUrl,
      title: "Synthetic Kitchener Roofing",
      metaDescription: null,
      visibleText: "Roofing services in Kitchener. Call our local team for an estimate.",
      actions: [{ kind: "PHONE" as const, label: "Call now", href: "tel:+15195550176", visible: true, aboveFold: false }],
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
    resourceProbes: [{ url: websiteUrl, type: "PAGE" as const, internal: true, statusCode: 200 }],
    mobile: {
      captured: false,
      horizontalOverflow: null,
      navigationUsable: null,
      textReadable: null,
      minimumTapTargetPx: null,
    },
  };
  const materialization: PrivateKwSourceWorkflowMaterializationInput = {
    materializationVersion: PRIVATE_KW_SOURCE_WORKFLOW_MATERIALIZATION_VERSION,
    sourceImportId: source.importId,
    sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    auditInputDigest: privateKwSourceWorkflowDigest(auditInput),
    auditInput,
    evidenceCompletedAt,
    approval: {
      decision: "APPROVED_FOR_LOCAL_SOURCE_WORKFLOW_MATERIALIZATION",
      reviewedBy: "RILEY",
      reviewedAt: materializationReviewedAt,
      rationale: "Approved synthetic source and website evidence for the contact invocation test.",
      confirmation: PRIVATE_KW_SOURCE_WORKFLOW_APPROVAL_CONFIRMATION,
    },
    mode: "SHADOW",
    executionKind: "IGNORED_LOCAL_SQLITE",
    localDatabaseAccessAuthorized: true,
    localSourceMutationAuthorized: true,
    localWorkflowMutationAuthorized: true,
    localAssessmentMutationAuthorized: false,
    schemaMutationAuthorized: false,
    captureAuthorized: false,
    contactDiscoveryAuthorized: false,
    contactVerificationAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };
  const materializationPlan = buildPrivateKwSourceWorkflowMaterializationPlan(source, materialization);
  const assessmentInput: PrivateKwAssessmentInvocationInput = {
    invocationVersion: PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION,
    sourceImportId: source.importId,
    sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    workflowReceiptId: materializationPlan.workflowReceiptId,
    assessedAt,
    businessFitScore: 82,
    timingScore: 35,
    basisClaims: [{
      basisId: "basis:reviewed-contact:fit",
      dimension: "BUSINESS_FIT",
      observation: "The owner-reviewed fixture is an independent Kitchener roofing operator.",
      sourceUrl,
      capturedAt: sourceCapturedAt,
      method: "owner_review",
      confidence: 100,
    }, {
      basisId: "basis:reviewed-contact:timing",
      dimension: "TIMING",
      observation: "No stronger timing event is supported by the reviewed fixture.",
      sourceUrl,
      capturedAt: sourceCapturedAt,
      method: "owner_review",
      confidence: 100,
    }],
    policyBlocks: [],
    approval: {
      decision: "APPROVED_FOR_LOCAL_SHADOW_ASSESSMENT",
      reviewedBy: "RILEY",
      reviewedAt: assessedAt,
      rationale: "Separately approved synthetic assessment for the contact invocation test.",
      confirmation: PRIVATE_KW_ASSESSMENT_APPROVAL_CONFIRMATION,
    },
    mode: "SHADOW",
    localAssessmentMutationAuthorized: true,
    sourceMutationAuthorized: false,
    workflowMutationAuthorized: false,
    contactDiscoveryAuthorized: false,
    outreachAuthorized: false,
    sendAuthorized: false,
    providerOperationsAuthorized: 0,
    costAuthorizedUsd: 0,
  };

  try {
    await mkdir(path.dirname(databaseFile), { recursive: true });
    await writePrivateKwJson(sourceFile, source);
    await writePrivateKwJson(materializationFile, materialization);
    await writePrivateKwJson(assessmentFile, assessmentInput);
    const initialDatabase = new Database(databaseFile);
    try {
      initialDatabase.pragma("foreign_keys = ON");
      applyCanonicalPrivateKwMigrations(initialDatabase);
    } finally {
      initialDatabase.close();
    }
    await materializePrivateKwSourceWorkflowFile([
      "--source-plan", sourceRelative,
      "--materialization", materializationRelative,
      "--database", databaseRelative,
    ]);
    await executePrivateKwAssessmentFile([
      "--source-plan", sourceRelative,
      "--invocation", assessmentRelative,
      "--database", databaseRelative,
    ]);

    const assessmentDatabase = new Database(databaseFile, { readonly: true });
    let assessment: RevenueLeadAssessment;
    try {
      assessment = persistedAssessment(assessmentDatabase);
      assert.equal(count(assessmentDatabase, "RevenueContactPoint"), 0);
    } finally {
      assessmentDatabase.close();
    }
    const assessmentReference = {
      assessmentReceiptId: assessment.assessmentId,
      assessmentDigest: assessment.assessmentDigest,
      workflowReceiptId: assessment.workflow.workflowReceiptId,
      websiteSnapshotId: assessment.websiteSnapshotId,
      qualificationSnapshotId: assessment.qualificationSnapshotId,
    };
    const draft: PrivateKwContactReviewDraft = {
      reviewVersion: PRIVATE_KW_CONTACT_REVIEW_VERSION,
      sourceImportId: source.importId,
      sourcePlanDigest,
      businessId: selected.business.id,
      evaluationCandidateId: selected.evaluationCandidateId,
      assessment: assessmentReference,
      discovery: {
        requestedAt: discoveryRequestedAt,
        completedAt: discoveryCompletedAt,
        observations: [{
          channel: "EMAIL",
          value: "estimator@reviewed-contact.axiomfixtures.ca",
          label: "Published estimator address",
          personName: null,
          role: "Estimator",
          recipientKind: "ROLE",
          socialPlatform: null,
          evidence: {
            evidenceVersion: REVENUE_CONTACT_EVIDENCE_VERSION,
            sourceUrl: "https://reviewed-contact.axiomfixtures.ca/contact",
            capturedAt: contactCapturedAt,
            method: "HTML_MAILTO",
            observation: "The synthetic contact page publishes a role-based estimator address.",
            confidence: 99,
            publication: {
              publiclyPublished: true,
              contraryContactStatement: "NOT_OBSERVED",
              roleRelevance: "RELEVANT",
              consentBasis: "UNASSESSED",
            },
          },
        }],
      },
      verifications: [{
        candidate: {
          channel: "EMAIL",
          value: "estimator@reviewed-contact.axiomfixtures.ca",
          socialPlatform: null,
        },
        requestedAt: verificationRequestedAt,
        completedAt: verificationCompletedAt,
        observation: {
          channel: "EMAIL",
          status: "DELIVERABLE",
          catchAll: false,
          provider: "FIXTURE",
          method: "FIXTURE_RECEIPT",
          evidenceReceiptId: `fixture-verification:${suffix}`,
          sourceUrl: `https://verification.axiomfixtures.ca/receipts/${suffix}`,
          verifiedAt,
          staleAfter: iso(now, 29 * 24 * 60 * 60_000),
          confidence: 99,
        },
      }],
      mode: "SHADOW",
      reviewOnly: true,
      databaseMutationAuthorized: false,
      contactDiscoveryExecutionAuthorized: false,
      contactVerificationExecutionAuthorized: false,
      consentDecisionAuthorized: false,
      qualificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    };
    await writePrivateKwJson(draftFile, draft);

    const prepared = await preparePrivateKwContactReviewFile([
      "--source-plan", sourceRelative,
      "--draft", draftRelative,
      "--database", databaseRelative,
      "--output", reviewRelative,
    ]);
    assert.equal(prepared.reviewOnly, true);
    assert.equal(prepared.databaseMutationPerformed, false);
    assert.equal(prepared.contactDiscoveryExecuted, false);
    assert.equal(prepared.providerOperationsAuthorized, 0);
    assert.deepEqual(prepared.summary, {
      candidates: 1,
      verificationResults: 1,
      usableRoutes: 1,
      emailReviewRoutes: 1,
      manualRoutes: 0,
      researchRoutes: 0,
      consentBasis: "UNASSESSED",
    });
    const afterReviewDatabase = new Database(databaseFile, { readonly: true });
    try {
      assert.equal(count(afterReviewDatabase, "RevenueContactDiscoveryReceipt"), 0);
      assert.equal(count(afterReviewDatabase, "RevenuePrivateKwContactInvocationReceipt"), 0);
      assert.equal(count(afterReviewDatabase, "RevenueQualificationSnapshot"), 1);
    } finally {
      afterReviewDatabase.close();
    }

    const review = PrivateKwContactReviewSchema.parse(await readJson(reviewFile));
    const persistencePlan = buildRevenueContactPersistencePlan({
      discovery: review.discovery,
      verifications: review.verifications,
    });
    const approval: PrivateKwContactInvocationApproval = {
      approvalVersion: PRIVATE_KW_CONTACT_INVOCATION_APPROVAL_VERSION,
      reviewId: review.reviewId,
      reviewDigest: review.reviewDigest,
      sourcePlanDigest,
      businessId: selected.business.id,
      assessment: assessmentReference,
      persistenceApproval: {
        materializationVersion: PRIVATE_KW_CONTACT_PERSISTENCE_VERSION,
        businessId: selected.business.id,
        discoveryResultId: review.discovery.discoveryResultId,
        discoveryResultDigest: review.discovery.discoveryResultDigest,
        persistencePlanDigest: persistencePlan.planDigest,
        verificationResults: review.verifications.map((item) => ({
          verificationResultId: item.verificationResultId,
          verificationResultDigest: item.verificationResultDigest,
        })),
        approval: {
          decision: "APPROVED_FOR_LOCAL_CONTACT_PERSISTENCE",
          reviewedBy: "RILEY",
          reviewedAt: contactReviewedAt,
          rationale: "Approved the exact synthetic evidence and verification for local contact persistence.",
          confirmation: PRIVATE_KW_CONTACT_PERSISTENCE_APPROVAL_CONFIRMATION,
        },
        mode: "SHADOW",
        executionKind: "IGNORED_LOCAL_SQLITE",
        localDatabaseAccessAuthorized: true,
        localContactMutationAuthorized: true,
        localVerificationMutationAuthorized: true,
        sourceMutationAuthorized: false,
        workflowMutationAuthorized: false,
        assessmentMutationAuthorized: false,
        schemaMutationAuthorized: false,
        captureAuthorized: false,
        contactDiscoveryAuthorized: false,
        contactVerificationAuthorized: false,
        consentDecisionAuthorized: false,
        qualificationAuthorized: false,
        outreachAuthorized: false,
        sendAuthorized: false,
        providerOperationsAuthorized: 0,
        costAuthorizedUsd: 0,
      },
      localInvocationReceiptAuthorized: true,
      consentDecisionAuthorized: false,
      qualificationAuthorized: false,
      outreachAuthorized: false,
      sendAuthorized: false,
      providerOperationsAuthorized: 0,
      costAuthorizedUsd: 0,
    };
    await writePrivateKwJson(driftApprovalFile, { ...approval, reviewDigest: "f".repeat(64) });
    await assert.rejects(
      persistPrivateKwContactsFile([
        "--source-plan", sourceRelative,
        "--review", reviewRelative,
        "--approval", driftApprovalRelative,
        "--database", databaseRelative,
      ]),
      /approval does not bind the exact review/i,
    );
    const afterDriftDatabase = new Database(databaseFile, { readonly: true });
    try {
      assert.equal(count(afterDriftDatabase, "RevenueContactDiscoveryReceipt"), 0);
      assert.equal(count(afterDriftDatabase, "RevenuePrivateKwContactPersistenceReceipt"), 0);
      assert.equal(count(afterDriftDatabase, "RevenuePrivateKwContactInvocationReceipt"), 0);
    } finally {
      afterDriftDatabase.close();
    }

    await writePrivateKwJson(approvalFile, approval);
    const rollbackDatabase = new Database(databaseFile);
    try {
      rollbackDatabase.pragma("foreign_keys = ON");
      assert.throws(
        () => executePrivateKwContactInvocationForLocalDatabase(
          rollbackDatabase,
          { source, review, approval },
          { insert() { throw new Error("FIXTURE_INVOCATION_RECEIPT_FAILURE"); } },
        ),
        /FIXTURE_INVOCATION_RECEIPT_FAILURE/,
      );
      assert.equal(count(rollbackDatabase, "RevenueContactDiscoveryReceipt"), 0);
      assert.equal(count(rollbackDatabase, "RevenueContactPoint"), 0);
      assert.equal(count(rollbackDatabase, "RevenueVerificationResult"), 0);
      assert.equal(count(rollbackDatabase, "RevenuePrivateKwContactPersistenceReceipt"), 0);
      assert.equal(count(rollbackDatabase, "RevenuePrivateKwContactInvocationReceipt"), 0);
    } finally {
      rollbackDatabase.close();
    }
    const args = [
      "--source-plan", sourceRelative,
      "--review", reviewRelative,
      "--approval", approvalRelative,
      "--database", databaseRelative,
    ];
    const first = await persistPrivateKwContactsFile(args);
    assert.equal(first.executionPath, "FRESH_COMMIT");
    assert.deepEqual(first.insertedRows, {
      contact: 4,
      verification: 1,
      materializationReceipts: 1,
      invocationReceipts: 1,
    });
    assert.equal(first.contactDiscoveryExecuted, false);
    assert.equal(first.contactVerificationExecuted, false);
    assert.equal(first.consentDecisionAuthorized, false);
    assert.equal(first.outreachAuthorized, false);
    assert.equal(first.sendAuthorized, false);
    assert.equal(first.providerOperationsAuthorized, 0);
    const replay = await persistPrivateKwContactsFile(args);
    assert.equal(replay.executionPath, "EXACT_REPLAY");
    assert.deepEqual(replay.insertedRows, {
      contact: 0,
      verification: 0,
      materializationReceipts: 0,
      invocationReceipts: 0,
    });

    const verificationDatabase = new Database(databaseFile);
    try {
      assert.equal(count(verificationDatabase, "RevenueContactPoint"), 1);
      assert.equal(count(verificationDatabase, "RevenueVerificationResult"), 1);
      assert.equal(count(verificationDatabase, "RevenuePrivateKwContactPersistenceReceipt"), 1);
      assert.equal(count(verificationDatabase, "RevenuePrivateKwContactInvocationReceipt"), 1);
      assert.equal(count(verificationDatabase, "RevenueQualificationSnapshot"), 1);
      const invocationJson = (verificationDatabase.prepare(
        `SELECT "invocationJson" FROM "RevenuePrivateKwContactInvocationReceipt"`,
      ).get() as { invocationJson: string }).invocationJson;
      const storedInvocation = JSON.parse(invocationJson) as Record<string, unknown>;
      assert.deepEqual(storedInvocation.review, review);
      const parsedInvocation = PrivateKwContactInvocationSchema.parse(storedInvocation);
      const durableBoundary: RevenueLeadAssessmentD1Boundary = {
        async batch(statements) {
          return statements.map((statement) => ({
            success: true,
            results: verificationDatabase.prepare(statement.sql).all(...statement.bindings),
            changes: 0,
          }));
        },
      };
      const durableReload = await loadPrivateKwContactInvocationDurable(
        durableBoundary,
        {
          invocationId: parsedInvocation.invocationId,
          invocationDigest: parsedInvocation.invocationDigest,
        },
      );
      assert.equal(durableReload.executionPath, "DURABLE_RELOAD");
      assert.equal(durableReload.freshnessState, "CURRENT");
      assert.equal(durableReload.invocation.invocationId, first.invocationId);
      assert.equal(durableReload.contactMaterialization.materializationId, first.materializationId);
      assert.equal(durableReload.exactAssessmentReloaded, true);
      assert.equal(durableReload.exactContactPlanRebuilt, true);
      assert.equal(durableReload.immutableWriterGuardsVerified, true);
      assert.equal(durableReload.databaseMutationPerformed, false);
      const ownerReceiptRow = verificationDatabase
        .prepare(OWNER_LEAD_CONTACT_REVIEW_QUERY)
        .get(selected.business.id) as Record<string, unknown>;
      const ownerContactReview = projectOwnerContactReview(
        ownerReceiptRow,
        {
          businessId: selected.business.id,
          websiteSnapshotId: assessment.websiteSnapshotId,
          qualificationSnapshotId: assessment.qualificationSnapshotId,
        },
      );
      assert.equal(ownerContactReview.state, "CURRENT");
      assert.equal(ownerContactReview.reviewedBy, "RILEY");
      assert.equal(ownerContactReview.consentBasis, "UNASSESSED");
      assert.equal(ownerContactReview.summary.usableRoutes, 1);
      assert.equal(ownerContactReview.summary.emailReviewRoutes, 1);
      assert.equal(ownerContactReview.authority.outreachAuthorized, false);
      assert.equal(ownerContactReview.authority.sendAuthorized, false);
      const staleOwnerContactReview = projectOwnerContactReview(ownerReceiptRow, {
        businessId: selected.business.id,
        websiteSnapshotId: assessment.websiteSnapshotId,
        qualificationSnapshotId: `qualification:${"f".repeat(64)}`,
      });
      assert.equal(staleOwnerContactReview.state, "STALE_ASSESSMENT");
      const tamperedOwnerInvocation = JSON.parse(ownerReceiptRow.invocationJson as string) as Record<string, unknown>;
      (tamperedOwnerInvocation.review as Record<string, unknown>).summary = {
        ...(tamperedOwnerInvocation.review as Record<string, unknown>).summary as Record<string, unknown>,
        usableRoutes: 25,
      };
      assert.throws(
        () => projectOwnerContactReview(
          { ...ownerReceiptRow, invocationJson: JSON.stringify(tamperedOwnerInvocation) },
          {
            businessId: selected.business.id,
            websiteSnapshotId: assessment.websiteSnapshotId,
            qualificationSnapshotId: assessment.qualificationSnapshotId,
          },
        ),
        /identity must bind|reviewed packet and lineage/i,
      );
      const missingAuthorityRow = verificationDatabase.prepare(
        `SELECT * FROM "RevenuePrivateKwContactInvocationReceipt"`,
      ).get() as Record<string, unknown>;
      const missingAuthorityInvocation = JSON.parse(
        missingAuthorityRow.invocationJson as string,
      ) as Record<string, unknown>;
      delete (missingAuthorityInvocation.authority as Record<string, unknown>).sendAuthorized;
      missingAuthorityRow.invocationJson = JSON.stringify(missingAuthorityInvocation);
      const missingAuthorityColumns = Object.keys(missingAuthorityRow);
      assert.throws(
        () => verificationDatabase.prepare(
          `INSERT INTO "RevenuePrivateKwContactInvocationReceipt" (${missingAuthorityColumns.map((column) => `"${column}"`).join(", ")}) VALUES (${missingAuthorityColumns.map(() => "?").join(", ")})`,
        ).run(...Object.values(missingAuthorityRow)),
        /REVENUE_PRIVATE_KW_CONTACT_INVOCATION_LINEAGE_MISMATCH/,
      );
      assert.throws(
        () => verificationDatabase.prepare(`UPDATE "RevenuePrivateKwContactInvocationReceipt" SET "reviewedBy" = "reviewedBy"`).run(),
        /REVENUE_PRIVATE_KW_CONTACT_INVOCATION_APPEND_ONLY/,
      );
      assert.throws(
        () => verificationDatabase.prepare(`DELETE FROM "RevenuePrivateKwContactInvocationReceipt"`).run(),
        /REVENUE_PRIVATE_KW_CONTACT_INVOCATION_APPEND_ONLY/,
      );
    } finally {
      verificationDatabase.close();
    }
  } finally {
    for (const file of [
      sourceFile,
      materializationFile,
      assessmentFile,
      draftFile,
      reviewFile,
      driftApprovalFile,
      approvalFile,
      databaseFile,
      `${databaseFile}-shm`,
      `${databaseFile}-wal`,
    ]) {
      await rm(file, { force: true });
    }
  }
});
