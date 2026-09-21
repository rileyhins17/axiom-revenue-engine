import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Database from "better-sqlite3";

import { artifactReferenceDigest } from "../src/lib/revenue-engine/artifact-reference-projection";
import {
  PRIVATE_KW_ASSESSMENT_APPROVAL_CONFIRMATION,
  PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION,
} from "../src/lib/revenue-engine/private-kw-assessment-invocation";
import { buildPrivateKwPersistencePlan } from "../src/lib/revenue-engine/private-kw-persistence-plan";
import { createPrivateKwCurrentWebsiteEvidenceFixture } from "../src/lib/revenue-engine/test-support/private-kw-current-website-evidence-fixture";
import { applyCanonicalPrivateKwMigrations } from "./private-kw-database";
import { executePrivateKwM1Dossier, parsePrivateKwM1DossierOperation } from "./execute-private-kw-m1-dossier";

test("rejects a dossier operation that contains an untrusted SQL or URL value", () => {
  assert.throws(
    () => parsePrivateKwM1DossierOperation({
      sourcePlan: "data/kw-evaluation/source.json",
      materialization: "data/kw-evaluation/materialization.json",
      manifest: "data/kw-evaluation/manifest.json",
      invocation: "data/kw-evaluation/invocation.json",
      websiteCheckpoint: "data/kw-evaluation/website-checkpoint.json",
      assessmentCheckpoint: "data/kw-evaluation/assessment-checkpoint.json",
      report: "https://example.com/report.json",
      database: "data/kw-evaluation/revenue.sqlite",
      businessId: "business:fixture",
      evaluationCandidateId: "candidate:fixture",
      trusted: { assessment: "pretend" },
    }),
    /schema|path|trusted|URL/i,
  );
});

test("composes the assessment restart and owner dossier, then replays with stable bytes", async () => {
  const suffix = `task-4b2-${Date.now().toString(36)}`;
  const now = new Date(Date.now() + 10_000);
  const fixture = await createPrivateKwCurrentWebsiteEvidenceFixture({
    suffix,
    now: new Date(now.getTime() - 3.8 * 60_000),
  });
  const plan = buildPrivateKwPersistencePlan(fixture.source);
  const selected = fixture.source.records[0]!;
  const assessedAt = now.toISOString();
  const invocation = {
    invocationVersion: PRIVATE_KW_ASSESSMENT_INVOCATION_VERSION,
    sourceImportId: fixture.source.importId,
    sourcePlanDigest: plan.sourcePlanDigest,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
    workflowReceiptId: `workflow-receipt:${artifactReferenceDigest(fixture.workflowReceipt)}`,
    assessedAt,
    businessFitScore: 80,
    timingScore: 30,
    basisClaims: [
      { basisId: "basis:task-4b2:fit", dimension: "BUSINESS_FIT", observation: "Synthetic owner-reviewed local business fixture.", sourceUrl: selected.sourceRecord.sourceEvidenceUrl, capturedAt: selected.sourceRecord.capturedAt, method: "owner_review", confidence: 100 },
      { basisId: "basis:task-4b2:timing", dimension: "TIMING", observation: "No stronger timing signal is supported by the fixture.", sourceUrl: selected.sourceRecord.sourceEvidenceUrl, capturedAt: selected.sourceRecord.capturedAt, method: "owner_review", confidence: 100 },
    ],
    policyBlocks: [],
    approval: {
      decision: "APPROVED_FOR_LOCAL_SHADOW_ASSESSMENT",
      reviewedBy: "RILEY",
      reviewedAt: assessedAt,
      rationale: "Synthetic fixture approved for local-only assessment verification.",
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
  const root = new URL("../data/kw-evaluation/", import.meta.url);
  const names = {
    source: `task-4b2-${suffix}-source.json`, materialization: `task-4b2-${suffix}-materialization.json`, manifest: `task-4b2-${suffix}-manifest.json`, invocation: `task-4b2-${suffix}-invocation.json`, websiteCheckpoint: `task-4b2-${suffix}-website.json`, assessmentCheckpoint: `task-4b2-${suffix}-assessment.json`, report: `task-4b2-${suffix}-report.json`, database: `task-4b2-${suffix}.sqlite`,
  };
  const files = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, new URL(name, root)])) as Record<keyof typeof names, URL>;
  await mkdir(root, { recursive: true });
  const database = new Database(fileURLToPath(files.database));
  try { database.pragma("foreign_keys = ON"); applyCanonicalPrivateKwMigrations(database); } finally { database.close(); }
  await Promise.all([
    writeFile(files.source, `${JSON.stringify(fixture.source, null, 2)}\n`),
    writeFile(files.materialization, `${JSON.stringify(fixture.materialization, null, 2)}\n`),
    writeFile(files.manifest, `${JSON.stringify(fixture.manifest, null, 2)}\n`),
    writeFile(files.invocation, `${JSON.stringify(invocation, null, 2)}\n`),
  ]);
  const operation = {
    sourcePlan: `data/kw-evaluation/${names.source}`, materialization: `data/kw-evaluation/${names.materialization}`, manifest: `data/kw-evaluation/${names.manifest}`, invocation: `data/kw-evaluation/${names.invocation}`, websiteCheckpoint: `data/kw-evaluation/${names.websiteCheckpoint}`, assessmentCheckpoint: `data/kw-evaluation/${names.assessmentCheckpoint}`, report: `data/kw-evaluation/${names.report}`, database: `data/kw-evaluation/${names.database}`, businessId: selected.business.id, evaluationCandidateId: selected.evaluationCandidateId,
  };
  try {
    const first = await executePrivateKwM1Dossier(operation);
    const firstReportBytes = await readFile(files.report);
    const firstCheckpointBytes = await readFile(files.assessmentCheckpoint);
    assert.deepEqual(await readFile(files.report), firstReportBytes);
    assert.deepEqual(await readFile(files.assessmentCheckpoint), firstCheckpointBytes);
    assert.equal(first.report.reportId, `private-kw-m1-dossier:${first.report.reportDigest}`);
    assert.equal(first.report.ownerDossier.contactReview.state, "NOT_RECORDED");
    assert.equal(first.report.authority.networkOperationsPerformed, 0);
    assert.equal(first.report.authority.providerOperationsAuthorized, 0);
    assert.equal(first.report.authority.qualificationExecutionAuthorized, false);
    assert.equal(first.report.authority.outreachAuthorized, false);
    assert.equal(first.report.authority.sendAuthorized, false);
    assert.equal(first.execution.assessment, "FRESH_COMMIT");
    assert.match(first.report.assessment.checkpointId, /^kw-shadow-progress:/);
    const second = await executePrivateKwM1Dossier(operation);
    const secondReportBytes = await readFile(files.report);
    const secondCheckpointBytes = await readFile(files.assessmentCheckpoint);
    assert.deepEqual(secondReportBytes, firstReportBytes);
    assert.deepEqual(secondCheckpointBytes, firstCheckpointBytes);
    assert.equal(second.execution.websiteSource, "EXACT_REPLAY");
    assert.equal(second.execution.websiteEligibility, "EXACT_REPLAY");
    assert.equal(second.execution.assessment, "EXACT_REPLAY");
    assert.equal(second.execution.websiteCheckpointOutput, "EXACT_REPLAY");
    assert.equal(second.execution.assessmentCheckpointOutput, "EXACT_REPLAY");
    assert.equal(second.execution.reportOutput, "EXACT_REPLAY");
  } finally {
    await Promise.all(Object.values(files).map((file) => rm(file, { force: true })));
    await rm(`${fileURLToPath(files.database)}-shm`, { force: true });
    await rm(`${fileURLToPath(files.database)}-wal`, { force: true });
  }
});
