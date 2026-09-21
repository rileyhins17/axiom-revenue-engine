import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Database from "better-sqlite3";

import { artifactReferenceCanonicalJson, artifactReferenceDigest } from "../src/lib/revenue-engine/artifact-reference-projection";
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

const SOURCE_TABLES = new Set([
  "RevenueSourceRun",
  "RevenueBusiness",
  "RevenueLocation",
  "RevenueSourceRecord",
  "RevenueWorkflowDefinition",
  "RevenueWorkflowRun",
  "RevenueWorkflowDelivery",
  "RevenueWorkflowAttempt",
  "RevenueWorkflowReceiptRevision",
  "RevenueWorkflowAttemptClosure",
  "RevenuePrivateKwMaterializationReceipt",
]);

const ASSESSMENT_TABLES = new Set([
  "RevenueWebsiteSnapshot",
  "RevenueEvidenceClaim",
  "RevenueQualificationSnapshot",
  "RevenueLeadAssessmentReceipt",
]);

type RevenueTableSnapshot = {
  count: number;
  rows: string[];
  fingerprint: string;
};

type DurableSnapshot = {
  tables: Record<string, RevenueTableSnapshot>;
  identities: {
    materialization: string[];
    eligibility: string[];
    assessment: string[];
  };
};

function quoteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQLite identifier in test snapshot: ${value}`);
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeSqlValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { type: "buffer", hex: value.toString("hex") };
  if (value instanceof Uint8Array) return { type: "bytes", hex: Buffer.from(value).toString("hex") };
  return value;
}

function canonicalSqlRow(row: Record<string, unknown>) {
  return artifactReferenceCanonicalJson(Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeSqlValue(value)]),
  ));
}

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

function snapshotDatabase(files: Awaited<ReturnType<typeof createFixture>>["files"]): DurableSnapshot {
  const database = new Database(fileURLToPath(files.database), { fileMustExist: true });
  try {
    const tableNames = (database.prepare(
      `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" LIKE 'Revenue%' ORDER BY "name"`,
    ).all() as Array<{ name: string }>).map(({ name }) => name);
    const tables = Object.fromEntries(tableNames.map((table) => {
      const identifier = quoteIdentifier(table);
      const rows = (database.prepare(`SELECT * FROM ${identifier}`).all() as Array<Record<string, unknown>>)
        .map(canonicalSqlRow)
        .sort();
      return [table, {
        count: rows.length,
        rows,
        fingerprint: artifactReferenceDigest(rows),
      } satisfies RevenueTableSnapshot];
    }));
    const identityRows = (table: string, columns: readonly string[]) => {
      const identifier = quoteIdentifier(table);
      const selected = columns.map(quoteIdentifier).join(", ");
      return (database.prepare(`SELECT ${selected} FROM ${identifier} ORDER BY "id"`).all() as Array<Record<string, unknown>>)
        .map(canonicalSqlRow);
    };
    return {
      tables,
      identities: {
        materialization: identityRows("RevenuePrivateKwMaterializationReceipt", ["id", "materializationDigest"]),
        eligibility: identityRows("RevenueCurrentWebsiteEvidenceEligibilityReceipt", ["id", "receiptDigest"]),
        assessment: identityRows("RevenueLeadAssessmentReceipt", ["id", "assessmentDigest"]),
      },
    };
  } finally {
    database.close();
  }
}

function tableSnapshot(snapshot: DurableSnapshot, table: string) {
  return snapshot.tables[table] ?? { count: 0, rows: [], fingerprint: artifactReferenceDigest([]) };
}

function assertSnapshotPrefix(prefix: DurableSnapshot, complete: DurableSnapshot) {
  for (const [table, value] of Object.entries(prefix.tables)) {
    if (value.count === 0) continue;
    const later = complete.tables[table];
    assert.ok(later, `durable prefix table disappeared: ${table}`);
    assert.ok(later.count >= value.count, `durable prefix count decreased in ${table}`);
    const remaining = new Map<string, number>();
    for (const row of later.rows) remaining.set(row, (remaining.get(row) ?? 0) + 1);
    for (const row of value.rows) {
      const available = remaining.get(row) ?? 0;
      assert.ok(available > 0, `durable prefix row content changed in ${table}`);
      remaining.set(row, available - 1);
    }
  }
}

function assertStagePrefix(stage: Stage, prefix: DurableSnapshot, files: Awaited<ReturnType<typeof createFixture>>["files"]) {
  const websiteTables = Object.keys(prefix.tables).filter((table) => !SOURCE_TABLES.has(table) && !ASSESSMENT_TABLES.has(table));
  const laterTables = stage === "SOURCE_MATERIALIZED"
    ? [...websiteTables, ...ASSESSMENT_TABLES]
    : stage === "ELIGIBILITY_PERSISTED" || stage === "WEBSITE_PROGRESS_PERSISTED"
      ? [...ASSESSMENT_TABLES]
      : [];
  for (const table of laterTables) {
    assert.equal(tableSnapshot(prefix, table).count, 0, `${stage} must not retain later-stage rows in ${table}`);
  }
  const expectedFiles = {
    SOURCE_MATERIALIZED: { website: false, assessment: false, report: false },
    ELIGIBILITY_PERSISTED: { website: false, assessment: false, report: false },
    WEBSITE_PROGRESS_PERSISTED: { website: true, assessment: false, report: false },
    ASSESSMENT_PERSISTED: { website: true, assessment: false, report: false },
    ASSESSMENT_PROGRESS_PERSISTED: { website: true, assessment: true, report: false },
    REPORT_PERSISTED: { website: true, assessment: true, report: true },
  }[stage];
  for (const [file, present] of [[files.websiteCheckpoint, expectedFiles.website], [files.assessmentCheckpoint, expectedFiles.assessment], [files.report, expectedFiles.report]] as const) {
    assert.equal(existsSync(fileURLToPath(file)), present, `${stage} file prefix mismatch for ${file}`);
  }
  assert.equal(prefix.identities.materialization.length, 1, `${stage} must retain the source materialization identity`);
  const eligibilityCount = tableSnapshot(prefix, "RevenueCurrentWebsiteEvidenceEligibilityReceipt").count;
  assert.equal(eligibilityCount, stage === "SOURCE_MATERIALIZED" ? 0 : 1, `${stage} eligibility prefix mismatch`);
  if (stage === "SOURCE_MATERIALIZED") {
    assert.equal(prefix.identities.eligibility.length, 0);
    assert.equal(prefix.identities.assessment.length, 0);
  }
  if (stage === "ELIGIBILITY_PERSISTED" || stage === "WEBSITE_PROGRESS_PERSISTED") {
    assert.equal(prefix.identities.assessment.length, 0);
  }
  if (stage === "ASSESSMENT_PERSISTED" || stage === "ASSESSMENT_PROGRESS_PERSISTED" || stage === "REPORT_PERSISTED") {
    for (const table of ASSESSMENT_TABLES) {
      assert.ok(tableSnapshot(prefix, table).count > 0, `${stage} must retain assessment rows in ${table}`);
    }
    assert.equal(prefix.identities.assessment.length, 1, `${stage} must retain the assessment identity`);
  }
}

async function readDurableOutputs(files: Awaited<ReturnType<typeof createFixture>>["files"]) {
  const output = async (file: URL) => readFile(file);
  const website = await output(files.websiteCheckpoint);
  const assessment = await output(files.assessmentCheckpoint);
  const report = await output(files.report);
  const websiteValue = JSON.parse(website.toString("utf8")) as { checkpointId: string; checkpointDigest: string };
  const assessmentValue = JSON.parse(assessment.toString("utf8")) as { checkpointId: string; checkpointDigest: string };
  const reportValue = JSON.parse(report.toString("utf8")) as {
    reportId: string;
    reportDigest: string;
    assessment: { assessmentId: string; assessmentDigest: string; checkpointId: string; checkpointDigest: string };
    website: { checkpointId: string; checkpointDigest: string };
  };
  return {
    bytes: { website, assessment, report },
    identities: {
      website: { checkpointId: websiteValue.checkpointId, checkpointDigest: websiteValue.checkpointDigest },
      assessment: { checkpointId: assessmentValue.checkpointId, checkpointDigest: assessmentValue.checkpointDigest },
      report: { reportId: reportValue.reportId, reportDigest: reportValue.reportDigest },
    },
    report: reportValue,
  };
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
  let equivalentCounts: Record<string, number> | undefined;
  let assessmentCounts: Record<string, number> | undefined;
  for (const stage of STAGES) {
    const fixture = await createFixture();
    try {
      await fixture.resetDurableState();
      await assert.rejects(
        () => executePrivateKwM1Dossier({ ...fixture.operation }, { failureAfterStage: stage }),
        new RegExp(`M1 test interruption after ${stage}`),
      );
      const prefix = snapshotDatabase(fixture.files);
      assertStagePrefix(stage, prefix, fixture.files);

      const resumed = await executePrivateKwM1Dossier({ ...fixture.operation });
      const resumedSnapshot = snapshotDatabase(fixture.files);
      const resumedOutputs = await readDurableOutputs(fixture.files);
      assertSnapshotPrefix(prefix, resumedSnapshot);
      assert.equal(resumed.report.reportId, `private-kw-m1-dossier:${resumed.report.reportDigest}`);
      assert.equal(resumed.report.website.checkpointId, resumedOutputs.identities.website.checkpointId);
      assert.equal(resumed.report.website.checkpointDigest, resumedOutputs.identities.website.checkpointDigest);
      assert.equal(resumed.report.assessment.checkpointId, resumedOutputs.identities.assessment.checkpointId);
      assert.equal(resumed.report.assessment.checkpointDigest, resumedOutputs.identities.assessment.checkpointDigest);
      assert.equal(resumed.report.assessment.assessmentId, resumedSnapshot.identities.assessment[0] && JSON.parse(resumedSnapshot.identities.assessment[0]).id);
      assert.equal(resumed.report.assessment.assessmentDigest, resumedSnapshot.identities.assessment[0] && JSON.parse(resumedSnapshot.identities.assessment[0]).assessmentDigest);
      assert.equal(resumed.report.reportId, resumedOutputs.identities.report.reportId);
      assert.equal(resumed.report.reportDigest, resumedOutputs.identities.report.reportDigest);
      const resumedCounts = Object.fromEntries(Object.entries(resumedSnapshot.tables).map(([table, value]) => [table, value.count]));
      if (stage === "ELIGIBILITY_PERSISTED") equivalentCounts = resumedCounts;
      if (stage === "WEBSITE_PROGRESS_PERSISTED") assert.deepEqual(resumedCounts, equivalentCounts);
      if (stage === "ASSESSMENT_PERSISTED") assessmentCounts = resumedCounts;
      if (stage === "ASSESSMENT_PROGRESS_PERSISTED" || stage === "REPORT_PERSISTED") assert.deepEqual(resumedCounts, assessmentCounts);

      const replay = await executePrivateKwM1Dossier({ ...fixture.operation });
      const replaySnapshot = snapshotDatabase(fixture.files);
      const replayOutputs = await readDurableOutputs(fixture.files);
      assert.deepEqual(replaySnapshot, resumedSnapshot, `${stage} replay must not mutate any Revenue* row`);
      assert.deepEqual(replayOutputs.bytes, resumedOutputs.bytes, `${stage} replay must preserve all canonical output bytes`);
      assert.deepEqual(replayOutputs.identities, resumedOutputs.identities);
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
      assert.deepEqual(replaySnapshot.identities, resumedSnapshot.identities);
    } finally {
      await fixture.cleanup();
    }
  }
});
