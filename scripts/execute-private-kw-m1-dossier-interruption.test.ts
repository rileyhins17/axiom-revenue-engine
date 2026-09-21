import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
import { executePrivateKwM1Dossier, parsePrivateKwM1DossierArgs } from "./execute-private-kw-m1-dossier";

const STAGES = [
  "SOURCE_MATERIALIZED",
  "ELIGIBILITY_PERSISTED",
  "WEBSITE_PROGRESS_PERSISTED",
  "ASSESSMENT_PERSISTED",
  "ASSESSMENT_PROGRESS_PERSISTED",
  "REPORT_PERSISTED",
] as const;

type Stage = (typeof STAGES)[number];

async function createFixture() {
  const suffix = `task-4c-${Date.now().toString(36)}`;
  const now = new Date(Date.now() + 5_000);
  const fixture = await createPrivateKwCurrentWebsiteEvidenceFixture({
    suffix,
    now: new Date(now.getTime() - 3.8 * 60_000),
  });
  const plan = buildPrivateKwPersistencePlan(fixture.source);
  const selected = fixture.source.records[0]!;
  const assessedAt = new Date(Date.now() + 6_000).toISOString();
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
      { basisId: "basis:task-4c:fit", dimension: "BUSINESS_FIT", observation: "Synthetic owner-reviewed local business fixture.", sourceUrl: selected.sourceRecord.sourceEvidenceUrl, capturedAt: selected.sourceRecord.capturedAt, method: "owner_review", confidence: 100 },
      { basisId: "basis:task-4c:timing", dimension: "TIMING", observation: "No stronger timing signal is supported by the fixture.", sourceUrl: selected.sourceRecord.sourceEvidenceUrl, capturedAt: selected.sourceRecord.capturedAt, method: "owner_review", confidence: 100 },
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
    source: `task-4c-${suffix}-source.json`,
    materialization: `task-4c-${suffix}-materialization.json`,
    manifest: `task-4c-${suffix}-manifest.json`,
    invocation: `task-4c-${suffix}-invocation.json`,
    websiteCheckpoint: `task-4c-${suffix}-website.json`,
    assessmentCheckpoint: `task-4c-${suffix}-assessment.json`,
    report: `task-4c-${suffix}-report.json`,
    database: `task-4c-${suffix}.sqlite`,
  };
  const files = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, new URL(name, root)])) as Record<keyof typeof names, URL>;
  const operation = {
    sourcePlan: `data/kw-evaluation/${names.source}`,
    materialization: `data/kw-evaluation/${names.materialization}`,
    manifest: `data/kw-evaluation/${names.manifest}`,
    invocation: `data/kw-evaluation/${names.invocation}`,
    websiteCheckpoint: `data/kw-evaluation/${names.websiteCheckpoint}`,
    assessmentCheckpoint: `data/kw-evaluation/${names.assessmentCheckpoint}`,
    report: `data/kw-evaluation/${names.report}`,
    database: `data/kw-evaluation/${names.database}`,
    businessId: selected.business.id,
    evaluationCandidateId: selected.evaluationCandidateId,
  };
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(files.source, `${JSON.stringify(fixture.source, null, 2)}\n`),
    writeFile(files.materialization, `${JSON.stringify(fixture.materialization, null, 2)}\n`),
    writeFile(files.manifest, `${JSON.stringify(fixture.manifest, null, 2)}\n`),
    writeFile(files.invocation, `${JSON.stringify(invocation, null, 2)}\n`),
  ]);

  async function resetDurableState() {
    await Promise.all([
      rm(files.websiteCheckpoint, { force: true }),
      rm(files.assessmentCheckpoint, { force: true }),
      rm(files.report, { force: true }),
      rm(files.database, { force: true }),
      rm(`${fileURLToPath(files.database)}-shm`, { force: true }),
      rm(`${fileURLToPath(files.database)}-wal`, { force: true }),
    ]);
    const database = new Database(fileURLToPath(files.database));
    try {
      database.pragma("foreign_keys = ON");
      applyCanonicalPrivateKwMigrations(database);
    } finally {
      database.close();
    }
  }

  async function cleanup() {
    await Promise.all([
      ...Object.values(files).map((file) => rm(file, { force: true })),
      rm(`${fileURLToPath(files.database)}-shm`, { force: true }),
      rm(`${fileURLToPath(files.database)}-wal`, { force: true }),
    ]);
  }

  return { operation, files, resetDurableState, cleanup };
}

function durablePrefix(files: Awaited<ReturnType<typeof createFixture>>["files"]) {
  const database = new Database(fileURLToPath(files.database), { fileMustExist: true });
  try {
    const count = (table: string) => (database.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as { count: number }).count;
    return {
      sourceReceipt: count("RevenuePrivateKwMaterializationReceipt"),
      eligibilityReceipt: count("RevenueCurrentWebsiteEvidenceEligibilityReceipt"),
      websiteSnapshots: count("RevenueWebsiteSnapshot"),
      assessmentReceipt: count("RevenueLeadAssessmentReceipt"),
    };
  } finally {
    database.close();
  }
}

function assertPrefix(stage: Stage, prefix: ReturnType<typeof durablePrefix>, files: Awaited<ReturnType<typeof createFixture>>["files"]) {
  const expected = {
    SOURCE_MATERIALIZED: { sourceReceipt: 1, eligibilityReceipt: 0, websiteSnapshots: 0, assessmentReceipt: 0, website: false, assessment: false, report: false },
    ELIGIBILITY_PERSISTED: { sourceReceipt: 1, eligibilityReceipt: 1, websiteSnapshots: 0, assessmentReceipt: 0, website: false, assessment: false, report: false },
    WEBSITE_PROGRESS_PERSISTED: { sourceReceipt: 1, eligibilityReceipt: 1, websiteSnapshots: 0, assessmentReceipt: 0, website: true, assessment: false, report: false },
    ASSESSMENT_PERSISTED: { sourceReceipt: 1, eligibilityReceipt: 1, websiteSnapshots: 1, assessmentReceipt: 1, website: true, assessment: false, report: false },
    ASSESSMENT_PROGRESS_PERSISTED: { sourceReceipt: 1, eligibilityReceipt: 1, websiteSnapshots: 1, assessmentReceipt: 1, website: true, assessment: true, report: false },
    REPORT_PERSISTED: { sourceReceipt: 1, eligibilityReceipt: 1, websiteSnapshots: 1, assessmentReceipt: 1, website: true, assessment: true, report: true },
  }[stage];
  assert.deepEqual(prefix, {
    sourceReceipt: expected.sourceReceipt,
    eligibilityReceipt: expected.eligibilityReceipt,
    websiteSnapshots: expected.websiteSnapshots,
    assessmentReceipt: expected.assessmentReceipt,
  });
  for (const [file, present] of [[files.websiteCheckpoint, expected.website], [files.assessmentCheckpoint, expected.assessment], [files.report, expected.report]] as const) {
    if (present) assert.equal(existsSync(fileURLToPath(file)), true, `durable file ${file} must exist`);
    else assert.equal(existsSync(fileURLToPath(file)), false, `later durable file ${file} must be absent`);
  }
}

test("keeps interruption control outside the bounded CLI argument surface", () => {
  assert.throws(
    () => parsePrivateKwM1DossierArgs([
      "--source-plan", "data/kw-evaluation/source.json",
      "--materialization", "data/kw-evaluation/materialization.json",
      "--manifest", "data/kw-evaluation/manifest.json",
      "--invocation", "data/kw-evaluation/invocation.json",
      "--website-checkpoint", "data/kw-evaluation/website.json",
      "--assessment-checkpoint", "data/kw-evaluation/assessment.json",
      "--report", "data/kw-evaluation/report.json",
      "--database", "data/kw-evaluation/revenue.sqlite",
      "--business-id", "business:fixture",
      "--evaluation-candidate-id", "candidate:fixture",
      "--failure-after-stage", "REPORT_PERSISTED",
    ]),
    /Exactly the bounded M1 dossier path and identity flags are required/i,
  );
});

test("interrupts after every durable M1 stage and resumes from the committed prefix", async () => {
  for (const stage of STAGES) {
    const fixture = await createFixture();
    try {
      await fixture.resetDurableState();
      await assert.rejects(
        () => executePrivateKwM1Dossier({ ...fixture.operation }, { failureAfterStage: stage }),
        new RegExp(`M1 test interruption after ${stage}`),
      );
      const prefix = durablePrefix(fixture.files);
      assertPrefix(stage, prefix, fixture.files);

      const resumed = await executePrivateKwM1Dossier({ ...fixture.operation });
      assert.equal(resumed.report.reportId, `private-kw-m1-dossier:${resumed.report.reportDigest}`);
      const replay = await executePrivateKwM1Dossier({ ...fixture.operation });
      assert.deepEqual(replay.report, resumed.report);
      assert.equal(replay.execution.websiteSource, "EXACT_REPLAY");
      assert.equal(replay.execution.websiteEligibility, "EXACT_REPLAY");
      assert.equal(replay.execution.assessment, "EXACT_REPLAY");
      assert.equal(replay.execution.websiteCheckpointOutput, "EXACT_REPLAY");
      assert.equal(replay.execution.assessmentCheckpointOutput, "EXACT_REPLAY");
      assert.equal(replay.execution.reportOutput, "EXACT_REPLAY");
      assert.deepEqual(replay.execution.assessmentInsertedRows, {
        websiteSnapshots: 0,
        evidenceClaims: 0,
        qualificationSnapshots: 0,
        assessmentReceipts: 0,
      });
      assert.deepEqual(durablePrefix(fixture.files), {
        sourceReceipt: 1,
        eligibilityReceipt: 1,
        websiteSnapshots: 1,
        assessmentReceipt: 1,
      });
    } finally {
      await fixture.cleanup();
    }
  }
});
