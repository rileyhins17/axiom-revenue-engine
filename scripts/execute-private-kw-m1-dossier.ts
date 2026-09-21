import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";
import { z } from "zod";

import { artifactReferenceCanonicalJson, artifactReferenceDigest } from "../src/lib/revenue-engine/artifact-reference-projection";
import {
  loadPrivateRevenueLeadAssessmentD1,
  requireCurrentRevenueLeadAssessmentD1DurableReload,
} from "../src/lib/revenue-engine/lead-assessment-d1";
import { OwnerLeadDetailResponseSchema, readOwnerLeadDetail } from "../src/lib/revenue-engine/owner-lead-detail-read-model";
import { PrivateKwAssessmentInvocationInputSchema, buildPrivateKwAssessmentInvocation } from "../src/lib/revenue-engine/private-kw-assessment-invocation";
import { PrivateKwImportPlanSchema } from "../src/lib/revenue-engine/private-kw-import";
import { buildPrivateKwAssessmentProgressInputForPersistedWebsiteCheckpoint } from "../src/lib/revenue-engine/private-kw-assessment-progress";
import { appendPrivateKwAssessmentProgress } from "../src/lib/revenue-engine/private-kw-assessment-progress-append";
import { buildPrivateKwCurrentWebsiteEvidenceProof } from "../src/lib/revenue-engine/private-kw-current-website-evidence";
import { loadPrivateKwWebsiteEvidenceEligibilityD1 } from "../src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1";
import {
  buildPrivateKwCurrentWebsiteEvidenceProgressInput,
  buildPrivateKwCurrentWebsiteEvidenceProgressInputForPersistedCheckpoint,
} from "../src/lib/revenue-engine/private-kw-current-website-evidence-progress";
import { appendPrivateKwCurrentWebsiteEvidenceProgress } from "../src/lib/revenue-engine/private-kw-current-website-evidence-progress-append";
import { PrivateKwShadowSliceManifestSchema } from "../src/lib/revenue-engine/private-kw-shadow-slice";
import {
  PrivateKwShadowSliceProgressCheckpointSchema,
  appendPrivateKwShadowSliceProgress,
  buildInitialPrivateKwShadowSliceProgress,
  buildPrivateKwShadowSlicePhaseReceipt,
} from "../src/lib/revenue-engine/private-kw-shadow-slice-progress";
import { createPrivateKwCurrentWebsiteEvidenceFixture } from "../src/lib/revenue-engine/test-support/private-kw-current-website-evidence-fixture";
import { buildPrivateKwSourceWorkflowProgressReceiptInput } from "../src/lib/revenue-engine/private-kw-source-workflow-progress";
import {
  buildPrivateKwSourceWorkflowMaterializationPlan,
  PrivateKwSourceWorkflowMaterializationInputSchema,
} from "../src/lib/revenue-engine/private-kw-source-workflow-materialization";
import { assertExactPrivateKwSourceMaterialization } from "./private-kw-contact-prerequisites";
import {
  assertCanonicalPrivateKwRevenueSchema,
  assertPrivateKwRequiredTables,
  assertPrivateKwSingleDatabase,
} from "./private-kw-database";
import {
  inspectPrivateKwDatabase,
  readPrivateKwJson,
  resolvePrivateKwDataPath,
  resolvePrivateKwDatabasePath,
  writeOrVerifyPrivateKwJson,
} from "./private-kw-files";
import { createPrivateKwLocalD1Adapter } from "./private-kw-local-d1";
import { executePrivateKwAssessmentFile } from "./execute-private-kw-assessment";
import {
  executePrivateKwM1WebsiteCheckpoint,
  type PrivateKwM1WebsiteCheckpointResult,
} from "./execute-private-kw-m1-website-checkpoint";

const MAX_JSON_BYTES = 50_000_000;
const MAX_DATABASE_BYTES = 512_000_000;
const SOURCE_NOW_FROM_CAPTURED_AT_MS = 6 * 60_000;
const WEBSITE_OPERATION_AFTER_SOURCE_NOW_MS = 3.8 * 60_000;
const WORKFLOW_REQUESTED_AT_AFTER_SOURCE_NOW_MS = -6 * 60_000;
const REQUIRED_TABLES = [
  "RevenueSourceRun", "RevenueBusiness", "RevenueLocation", "RevenueSourceRecord",
  "RevenueWorkflowRun", "RevenueWorkflowReceiptRevision", "RevenueWorkflowAttemptClosure",
  "RevenuePrivateKwMaterializationReceipt", "RevenueArtifactManifest",
  "RevenueArtifactManifestAvailabilityReceipt", "RevenueArtifactReferenceCompletenessReceipt",
  "RevenueArtifactReferenceSourceSetProof", "RevenueCurrentWebsiteEvidenceEligibilityReceipt",
  "RevenueWebsiteSnapshot", "RevenueEvidenceClaim", "RevenueQualificationSnapshot", "RevenueLeadAssessmentReceipt",
] as const;
const ASSESSMENT_INSERTED_TABLES = {
  websiteSnapshots: "RevenueWebsiteSnapshot",
  evidenceClaims: "RevenueEvidenceClaim",
  qualificationSnapshots: "RevenueQualificationSnapshot",
  assessmentReceipts: "RevenueLeadAssessmentReceipt",
} as const;

const OperationSchema = z.object({
  sourcePlan: z.string().min(1),
  materialization: z.string().min(1),
  manifest: z.string().min(1),
  invocation: z.string().min(1),
  websiteCheckpoint: z.string().min(1),
  assessmentCheckpoint: z.string().min(1),
  report: z.string().min(1),
  database: z.string().min(1),
  businessId: z.string().trim().min(1).max(200),
  evaluationCandidateId: z.string().trim().min(1).max(200),
}).strict();

const AuthoritySchema = z.object({
  fixtureOnly: z.literal(true),
  synthetic: z.literal(true),
  workerRuntimeConnected: z.literal(false),
  localAssessmentMutationAuthorized: z.literal(true),
  networkOperationsPerformed: z.literal(0),
  providerOperationsAuthorized: z.literal(0),
  contactDiscoveryExecutionAuthorized: z.literal(false),
  contactVerificationExecutionAuthorized: z.literal(false),
  consentDecisionAuthorized: z.literal(false),
  qualificationExecutionAuthorized: z.literal(false),
  outreachAuthorized: z.literal(false),
  sendAuthorized: z.literal(false),
  costAuthorizedUsd: z.literal(0),
}).strict();

const RowCountsSchema = z.record(z.string().regex(/^Revenue[A-Za-z]+$/), z.number().int().nonnegative()).readonly();
const ExecutionPathSchema = z.enum(["FRESH_COMMIT", "EXACT_REPLAY"]);
const AssessmentInsertedRowsSchema = z.object({
  websiteSnapshots: z.number().int().nonnegative(),
  evidenceClaims: z.number().int().nonnegative(),
  qualificationSnapshots: z.number().int().nonnegative(),
  assessmentReceipts: z.number().int().nonnegative(),
}).strict();

const ReportCoreSchema = z.object({
  version: z.literal("private-kw-m1-dossier-v1"),
  businessId: z.string().min(1),
  evaluationCandidateId: z.string().min(1),
  synthetic: z.literal(true),
  source: z.object({
    materializationId: z.string(),
    materializationDigest: z.string().regex(/^[a-f0-9]{64}$/),
    workflowReceiptId: z.string(),
    workflowReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sourcePhaseReceiptId: z.string(),
    sourcePhaseReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  website: z.object({
    checkpointId: z.string().regex(/^kw-shadow-progress:[a-f0-9]{64}$/),
    checkpointDigest: z.string().regex(/^[a-f0-9]{64}$/),
    eligibilityReceiptId: z.string(),
    eligibilityReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  assessment: z.object({
    assessmentId: z.string().regex(/^assessment:[a-f0-9]{64}$/),
    assessmentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    checkpointId: z.string().regex(/^kw-shadow-progress:[a-f0-9]{64}$/),
    checkpointDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  rowCounts: RowCountsSchema,
  ownerDossier: OwnerLeadDetailResponseSchema,
  contactReview: z.object({ state: z.literal("NOT_RECORDED") }).strict(),
  authority: AuthoritySchema,
}).strict();

export const PrivateKwM1DossierReportSchema = ReportCoreSchema.extend({
  reportId: z.string().regex(/^private-kw-m1-dossier:[a-f0-9]{64}$/),
  reportDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((report, context) => {
  const { reportId: _id, reportDigest: _digest, ...core } = report;
  void _id;
  void _digest;
  const digest = artifactReferenceDigest(core);
  if (report.reportDigest !== digest || report.reportId !== `private-kw-m1-dossier:${digest}`) {
    context.addIssue({ code: "custom", path: ["reportDigest"], message: "Report identity must bind the complete canonical dossier." });
  }
});

export const PrivateKwM1DossierResultSchema = z.object({
  report: PrivateKwM1DossierReportSchema,
  execution: z.object({
    websiteSource: ExecutionPathSchema,
    websiteEligibility: ExecutionPathSchema,
    assessment: ExecutionPathSchema,
    websiteCheckpointOutput: z.enum(["FRESH_WRITE", "EXACT_REPLAY"]),
    assessmentCheckpointOutput: z.enum(["FRESH_WRITE", "EXACT_REPLAY"]),
    reportOutput: z.enum(["FRESH_WRITE", "EXACT_REPLAY"]),
    assessmentInsertedRows: AssessmentInsertedRowsSchema,
    rowCounts: z.object({ beforeAssessment: RowCountsSchema, afterAssessment: RowCountsSchema }).strict(),
  }).strict(),
}).strict();

export type PrivateKwM1DossierOperation = z.infer<typeof OperationSchema>;
export type PrivateKwM1DossierReport = z.infer<typeof PrivateKwM1DossierReportSchema>;
export type PrivateKwM1DossierResult = z.infer<typeof PrivateKwM1DossierResultSchema>;

const PATH_KEYS = [
  "sourcePlan", "materialization", "manifest", "invocation", "websiteCheckpoint",
  "assessmentCheckpoint", "report", "database",
] as const;

function rejectUntrustedPath(value: string) {
  if (/https?:\/\//i.test(value) || /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i.test(value)) {
    throw new Error("Dossier paths accept bounded local files only; SQL and URLs are rejected.");
  }
}

export function parsePrivateKwM1DossierOperation(value: unknown) {
  const operation = OperationSchema.parse(value);
  for (const key of PATH_KEYS) rejectUntrustedPath(operation[key]);
  const files = {
    sourcePlan: resolvePrivateKwDataPath(operation.sourcePlan),
    materialization: resolvePrivateKwDataPath(operation.materialization),
    manifest: resolvePrivateKwDataPath(operation.manifest),
    invocation: resolvePrivateKwDataPath(operation.invocation),
    websiteCheckpoint: resolvePrivateKwDataPath(operation.websiteCheckpoint),
    assessmentCheckpoint: resolvePrivateKwDataPath(operation.assessmentCheckpoint),
    report: resolvePrivateKwDataPath(operation.report),
    database: resolvePrivateKwDatabasePath(operation.database),
  };
  if (new Set(Object.values(files)).size !== Object.values(files).length) {
    throw new Error("Dossier input, checkpoint, report, and database files must be distinct.");
  }
  return { operation, files };
}

export function parsePrivateKwM1DossierArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Usage: npm run kw:execute-m1-dossier -- --source-plan data/kw-evaluation/source.json --materialization data/kw-evaluation/materialization.json --manifest data/kw-evaluation/manifest.json --invocation data/kw-evaluation/invocation.json --website-checkpoint data/kw-evaluation/website.json --assessment-checkpoint data/kw-evaluation/assessment.json --report data/kw-evaluation/report.json --database data/kw-evaluation/revenue.sqlite --business-id business:... --evaluation-candidate-id evaluation-candidate:...");
    }
    if (values.has(name)) throw new Error(`Duplicate argument ${name}.`);
    values.set(name, value);
  }
  const required = [
    ["--source-plan", "sourcePlan"], ["--materialization", "materialization"], ["--manifest", "manifest"],
    ["--invocation", "invocation"], ["--website-checkpoint", "websiteCheckpoint"],
    ["--assessment-checkpoint", "assessmentCheckpoint"], ["--report", "report"], ["--database", "database"],
    ["--business-id", "businessId"], ["--evaluation-candidate-id", "evaluationCandidateId"],
  ] as const;
  if (values.size !== required.length || required.some(([flag]) => !values.has(flag))) {
    throw new Error("Exactly the bounded M1 dossier path and identity flags are required.");
  }
  return parsePrivateKwM1DossierOperation(Object.fromEntries(required.map(([flag, key]) => [key, values.get(flag)!])));
}

function sourceNowFromPlan(source: z.infer<typeof PrivateKwImportPlanSchema>) {
  const timestamps = source.records.map((record) => Date.parse(record.sourceRecord.capturedAt));
  if (!timestamps.length || timestamps.some((timestamp) => !Number.isFinite(timestamp) || timestamp !== timestamps[0])) {
    throw new Error("The synthetic source plan must contain one canonical durable capture timestamp.");
  }
  return new Date(timestamps[0]! + SOURCE_NOW_FROM_CAPTURED_AT_MS);
}

function operationNow(sourceNow: Date) {
  return new Date(sourceNow.getTime() + WEBSITE_OPERATION_AFTER_SOURCE_NOW_MS);
}

function rowCounts(database: Database.Database) {
  const tables = (database.prepare(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" LIKE 'Revenue%' ORDER BY "name"`).all() as Array<{ name: string }>).map((row) => row.name);
  return Object.fromEntries(tables.map((table) => [table, (database.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as { count: number }).count]));
}

function assertAssessmentMutationEvidence(
  executionPath: "FRESH_COMMIT" | "EXACT_REPLAY",
  insertedRows: z.infer<typeof AssessmentInsertedRowsSchema>,
  before: z.infer<typeof RowCountsSchema>,
  after: z.infer<typeof RowCountsSchema>,
) {
  const tableNames = new Set([...Object.keys(before), ...Object.keys(after)]);
  if (executionPath === "EXACT_REPLAY") {
    if (Object.values(insertedRows).some((count) => count !== 0)) {
      throw new Error("Exact assessment replay must report zero inserted rows.");
    }
    for (const table of tableNames) {
      if (before[table] !== after[table]) throw new Error(`Exact assessment replay changed ${table}.`);
    }
    return;
  }
  for (const table of tableNames) {
    const delta = (after[table] ?? 0) - (before[table] ?? 0);
    const expected = (Object.entries(ASSESSMENT_INSERTED_TABLES).find(([, name]) => name === table)?.[0] as keyof typeof ASSESSMENT_INSERTED_TABLES | undefined);
    const expectedDelta = expected ? insertedRows[expected] : 0;
    if (delta !== expectedDelta) throw new Error(`Fresh assessment mutation delta for ${table} does not match insertedRows.`);
  }
}

async function readPrivateKwRowCounts(path: string) {
  const databaseFile = await inspectPrivateKwDatabase(path, MAX_DATABASE_BYTES);
  const database = new Database(databaseFile, { fileMustExist: true, timeout: 0 });
  try {
    database.pragma("foreign_keys = ON");
    assertPrivateKwSingleDatabase(database);
    assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "M1 dossier row-count snapshot");
    assertCanonicalPrivateKwRevenueSchema(database);
    return rowCounts(database);
  } finally {
    database.close();
  }
}

function createAssessmentArgs(files: ReturnType<typeof parsePrivateKwM1DossierOperation>["files"]) {
  return ["--source-plan", files.sourcePlan, "--invocation", files.invocation, "--database", files.database];
}

function sourceWorkflowReceiptDigest(workflowReceiptId: string) {
  const digest = workflowReceiptId.slice("workflow-receipt:".length);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("The durable workflow receipt identity is not canonical.");
  return digest;
}

async function waitForDurableAssessmentClock(database: Database.Database, assessedAt: string) {
  const deadline = Date.now() + 30_000;
  while (true) {
    const row = database.prepare(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS "databaseNow"`).get() as { databaseNow: string } | undefined;
    if (row && Date.parse(row.databaseNow) >= Date.parse(assessedAt)) return;
    if (Date.now() >= deadline) throw new Error("The durable assessment timestamp did not become current within the bounded local restart window.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

type WebsiteRebuild = {
  checkpoint: z.infer<typeof PrivateKwShadowSliceProgressCheckpointSchema>;
  sourceProgress: z.infer<typeof PrivateKwShadowSliceProgressCheckpointSchema>;
  websiteEvidenceProof: Awaited<ReturnType<typeof buildPrivateKwCurrentWebsiteEvidenceProof>>;
  eligibilityReceiptId: string;
  eligibilityReceiptDigest: string;
  eligibilityResult: Awaited<ReturnType<typeof loadPrivateKwWebsiteEvidenceEligibilityD1>>;
  sourcePhaseReceiptId: string;
  sourcePhaseReceiptDigest: string;
  workflowReceiptId: string;
  workflowReceiptDigest: string;
  materializationId: string;
  materializationDigest: string;
  operationNow: string;
};

async function rebuildWebsiteCheckpoint(
  files: ReturnType<typeof parsePrivateKwM1DossierOperation>["files"],
  source: z.infer<typeof PrivateKwImportPlanSchema>,
  materialization: z.infer<typeof PrivateKwSourceWorkflowMaterializationInputSchema>,
  manifest: z.infer<typeof PrivateKwShadowSliceManifestSchema>,
  storedCheckpoint: unknown,
  isWebsiteReplay: boolean,
): Promise<WebsiteRebuild> {
  const databaseFile = await inspectPrivateKwDatabase(files.database, MAX_DATABASE_BYTES);
  const database = new Database(databaseFile, { fileMustExist: true, timeout: 0 });
  try {
    database.pragma("foreign_keys = ON");
    assertPrivateKwSingleDatabase(database);
    assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "M1 dossier restart");
    assertCanonicalPrivateKwRevenueSchema(database);
    const plan = buildPrivateKwSourceWorkflowMaterializationPlan(source, materialization);
    const workflow = database.prepare(`SELECT "requestedAt" FROM "RevenueWorkflowRun" WHERE "id" = ? ORDER BY "id"`).all(plan.workflowRunId) as Array<{ requestedAt: string }>;
    if (workflow.length !== 1) throw new Error("The durable workflow timestamp is missing or ambiguous.");
    const sourceNow = new Date(Date.parse(workflow[0]!.requestedAt) - WORKFLOW_REQUESTED_AT_AFTER_SOURCE_NOW_MS);
    const now = operationNow(sourceNow);
    const fixture = await createPrivateKwCurrentWebsiteEvidenceFixture({ suffix: source.importId.replace(/^kw-shadow-progress-/, ""), now: sourceNow });
    if (
      artifactReferenceCanonicalJson(fixture.source) !== artifactReferenceCanonicalJson(source)
      || artifactReferenceCanonicalJson(fixture.materialization) !== artifactReferenceCanonicalJson(materialization)
      || artifactReferenceCanonicalJson(fixture.manifest) !== artifactReferenceCanonicalJson(manifest)
    ) throw new Error("Durable source/workflow timestamps do not reconstruct the exact synthetic fixture.");
    assertExactPrivateKwSourceMaterialization(database, source);
    const storedRecords = plan.records.map((record) => ({
      entity: record.entity,
      recordId: record.recordId,
      rows: database.prepare(record.selectSql).all(...record.selectBindings) as Record<string, unknown>[],
    }));
    const sourceInput = buildPrivateKwSourceWorkflowProgressReceiptInput({
      manifestValue: manifest,
      sourceValue: source,
      materializationValue: materialization,
      storedRecords,
      recordedAt: now.toISOString(),
    });
    const initialProgress = buildInitialPrivateKwShadowSliceProgress(manifest);
    const sourceProgress = appendPrivateKwShadowSliceProgress(manifest, initialProgress, sourceInput);
    const sourcePhaseReceipt = sourceProgress.records.find((record) => record.businessId === plan.businessId)?.phaseReceipts[0];
    if (!sourcePhaseReceipt) throw new Error("Durable source materialization did not rebuild its selected phase receipt.");
    const previousPhaseReceipt = buildPrivateKwShadowSlicePhaseReceipt(manifest, sourceInput);
    const websiteEvidenceProof = buildPrivateKwCurrentWebsiteEvidenceProof({
      manifestValue: manifest,
      previousPhaseReceiptValue: previousPhaseReceipt,
      durableEvidenceRequestValue: fixture.durableEvidenceRequest,
      availabilityReceiptValues: fixture.availabilityReceipts,
      preparedAt: fixture.preparedAt,
    });
    const eligibilityRows = database.prepare(`SELECT "id", "receiptDigest" FROM "RevenueCurrentWebsiteEvidenceEligibilityReceipt" WHERE "businessId" = ? ORDER BY "id"`).all(plan.businessId) as Array<{ id: string; receiptDigest: string }>;
    if (eligibilityRows.length !== 1) throw new Error("The durable website eligibility receipt is missing or ambiguous.");
    const eligibility = await loadPrivateKwWebsiteEvidenceEligibilityD1(
      createPrivateKwLocalD1Adapter(database),
      { receiptId: eligibilityRows[0]!.id, receiptDigest: eligibilityRows[0]!.receiptDigest },
    );
    const parsedStored = PrivateKwShadowSliceProgressCheckpointSchema.parse(storedCheckpoint);
    const rebuilt = appendPrivateKwCurrentWebsiteEvidenceProgress({
      manifestValue: manifest,
      previousProgressValue: sourceProgress,
      phaseInputValue: isWebsiteReplay
        ? buildPrivateKwCurrentWebsiteEvidenceProgressInputForPersistedCheckpoint({
          manifestValue: manifest,
          previousProgressValue: sourceProgress,
          websiteEvidenceProofValue: websiteEvidenceProof,
          currentEligibilityResultValue: eligibility,
          persistedCheckpointValue: parsedStored,
          canonicalRecordedAt: now.toISOString(),
        })
        : buildPrivateKwCurrentWebsiteEvidenceProgressInput({
          manifestValue: manifest,
          previousProgressValue: sourceProgress,
          websiteEvidenceProofValue: websiteEvidenceProof,
          currentEligibilityResultValue: eligibility,
          recordedAt: now.toISOString(),
        }),
    });
    if (
      artifactReferenceCanonicalJson(rebuilt) !== artifactReferenceCanonicalJson(parsedStored)
      || rebuilt.checkpointId !== parsedStored.checkpointId
      || rebuilt.checkpointDigest !== parsedStored.checkpointDigest
    ) throw new Error("The stored website checkpoint does not match the canonical durable rebuild.");
    return {
      checkpoint: rebuilt,
      sourceProgress,
      websiteEvidenceProof,
      eligibilityReceiptId: eligibility.receipt.receiptId,
      eligibilityReceiptDigest: eligibility.receipt.receiptDigest,
      eligibilityResult: eligibility,
      sourcePhaseReceiptId: sourcePhaseReceipt.phaseReceiptId,
      sourcePhaseReceiptDigest: sourcePhaseReceipt.phaseReceiptDigest,
      workflowReceiptId: plan.workflowReceiptId,
      workflowReceiptDigest: sourceWorkflowReceiptDigest(plan.workflowReceiptId),
      materializationId: plan.materializationId,
      materializationDigest: plan.materializationDigest,
      operationNow: now.toISOString(),
    };
  } finally {
    database.close();
  }
}

function buildReportCore(input: Omit<PrivateKwM1DossierReport, "reportId" | "reportDigest">) {
  const digest = artifactReferenceDigest(input);
  return PrivateKwM1DossierReportSchema.parse({
    ...input,
    reportId: `private-kw-m1-dossier:${digest}`,
    reportDigest: digest,
  });
}

async function readExistingReport(path: string) {
  try {
    return PrivateKwM1DossierReportSchema.parse((await readPrivateKwJson(path, MAX_JSON_BYTES)).value);
  } catch (error) {
    if (error instanceof Error && /ENOENT|no such file|cannot find/i.test(error.message)) return null;
    throw error;
  }
}

export async function executePrivateKwM1Dossier(value: unknown): Promise<PrivateKwM1DossierResult> {
  const { operation, files } = parsePrivateKwM1DossierOperation(value);
  const [sourceRead, materializationRead, manifestRead, invocationRead] = await Promise.all([
    readPrivateKwJson(files.sourcePlan, MAX_JSON_BYTES),
    readPrivateKwJson(files.materialization, MAX_JSON_BYTES),
    readPrivateKwJson(files.manifest, MAX_JSON_BYTES),
    readPrivateKwJson(files.invocation, MAX_JSON_BYTES),
  ]);
  const source = PrivateKwImportPlanSchema.parse(sourceRead.value);
  const materialization = PrivateKwSourceWorkflowMaterializationInputSchema.parse(materializationRead.value);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestRead.value);
  const invocationInput = PrivateKwAssessmentInvocationInputSchema.parse(invocationRead.value);
  const invocation = buildPrivateKwAssessmentInvocation(source, invocationInput);
  if (invocation.businessId !== operation.businessId || invocation.evaluationCandidateId !== operation.evaluationCandidateId) {
    throw new Error("The selected business and evaluation candidate must match the exact approved invocation.");
  }
  const selectedManifestRecord = manifest.records.find((record) => record.businessId === operation.businessId);
  if (!selectedManifestRecord || selectedManifestRecord.evaluationCandidateId !== operation.evaluationCandidateId) {
    throw new Error("The selected business and evaluation candidate must match the exact manifest.");
  }
  const initialNow = operationNow(sourceNowFromPlan(source)).toISOString();
  const websiteStage: Pick<PrivateKwM1WebsiteCheckpointResult, "source" | "eligibility" | "checkpoint"> = await executePrivateKwM1WebsiteCheckpoint({
    sourcePlan: files.sourcePlan,
    materialization: files.materialization,
    manifest: files.manifest,
    database: files.database,
    output: files.websiteCheckpoint,
    now: initialNow,
  });
  const storedWebsiteCheckpoint = (await readPrivateKwJson(files.websiteCheckpoint, MAX_JSON_BYTES)).value;
  const website = await rebuildWebsiteCheckpoint(
    files,
    source,
    materialization,
    manifest,
    storedWebsiteCheckpoint,
    websiteStage.checkpoint.outputExecutionPath === "EXACT_REPLAY",
  );
  const beforeAssessment = await readPrivateKwRowCounts(files.database);
  const assessmentStage = await executePrivateKwAssessmentFile(createAssessmentArgs(files));
  const databaseFile = await inspectPrivateKwDatabase(files.database, MAX_DATABASE_BYTES);
  const database = new Database(databaseFile, { fileMustExist: true, timeout: 0 });
  let assessmentCheckpointOutput: "FRESH_WRITE" | "EXACT_REPLAY";
  let reportOutput: "FRESH_WRITE" | "EXACT_REPLAY";
  try {
    database.pragma("foreign_keys = ON");
    assertPrivateKwSingleDatabase(database);
    assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "M1 dossier assessment");
    assertCanonicalPrivateKwRevenueSchema(database);
    const assessmentRows = database.prepare(`SELECT "assessmentDigest" FROM "RevenueLeadAssessmentReceipt" WHERE "id" = ? ORDER BY "id"`).all(assessmentStage.assessmentId) as Array<{ assessmentDigest: string }>;
    if (assessmentRows.length !== 1 || !/^[a-f0-9]{64}$/.test(assessmentRows[0]!.assessmentDigest)) throw new Error("The durable assessment identity is missing or ambiguous.");
    const assessmentDigest = assessmentRows[0]!.assessmentDigest;
    await waitForDurableAssessmentClock(database, invocation.request.assessedAt);
    const assessmentReload = await loadPrivateRevenueLeadAssessmentD1(
      createPrivateKwLocalD1Adapter(database),
      { assessmentId: assessmentStage.assessmentId, assessmentDigest },
    );
    const currentAssessment = requireCurrentRevenueLeadAssessmentD1DurableReload(assessmentReload);
    const assessmentInput = buildPrivateKwAssessmentProgressInputForPersistedWebsiteCheckpoint({
      manifestValue: manifest,
      previousProgressValue: website.checkpoint,
      currentWebsiteEvidenceProofValue: website.websiteEvidenceProof,
      currentAssessmentResultValue: currentAssessment,
      currentWebsiteEligibilityResultValue: website.eligibilityResult,
    });
    const rebuiltAssessmentCheckpoint = PrivateKwShadowSliceProgressCheckpointSchema.parse(appendPrivateKwAssessmentProgress({
      manifestValue: manifest,
      previousProgressValue: website.checkpoint,
      phaseInputValue: assessmentInput,
    }));
    let persistedAssessmentCheckpoint: unknown;
    try {
      persistedAssessmentCheckpoint = (await readPrivateKwJson(files.assessmentCheckpoint, MAX_JSON_BYTES)).value;
    } catch (error) {
      if (!(error instanceof Error) || !/ENOENT|no such file|cannot find/i.test(error.message)) throw error;
    }
    if (persistedAssessmentCheckpoint !== undefined) {
      const parsedPersistedAssessmentCheckpoint = PrivateKwShadowSliceProgressCheckpointSchema.parse(persistedAssessmentCheckpoint);
      if (
        artifactReferenceCanonicalJson(parsedPersistedAssessmentCheckpoint) !== artifactReferenceCanonicalJson(rebuiltAssessmentCheckpoint)
        || parsedPersistedAssessmentCheckpoint.checkpointId !== rebuiltAssessmentCheckpoint.checkpointId
        || parsedPersistedAssessmentCheckpoint.checkpointDigest !== rebuiltAssessmentCheckpoint.checkpointDigest
      ) throw new Error("The stored assessment checkpoint does not match the canonical durable rebuild.");
    }
    assessmentCheckpointOutput = (await writeOrVerifyPrivateKwJson(files.assessmentCheckpoint, rebuiltAssessmentCheckpoint)).executionPath;
    const afterAssessment = rowCounts(database);
    const insertedRows = AssessmentInsertedRowsSchema.parse(assessmentStage.insertedRows);
    const beforeAssessmentRows = RowCountsSchema.parse(beforeAssessment);
    const afterAssessmentRows = RowCountsSchema.parse(afterAssessment);
    assertAssessmentMutationEvidence(assessmentStage.executionPath, insertedRows, beforeAssessmentRows, afterAssessmentRows);
    const ownerDossier = await readOwnerLeadDetail(
      createPrivateKwLocalD1Adapter(database),
      operation.businessId,
      currentAssessment.assessment.assessedAt,
    );
    if (!ownerDossier) throw new Error("The canonical owner dossier is missing after assessment persistence.");
    const detail = OwnerLeadDetailResponseSchema.parse(ownerDossier);
    if (detail.contactReview.state !== "NOT_RECORDED") throw new Error("Assessment composition must leave contact review NOT_RECORDED.");
    const existingReport = await readExistingReport(files.report);
    const reportCore = {
      version: "private-kw-m1-dossier-v1" as const,
      businessId: operation.businessId,
      evaluationCandidateId: operation.evaluationCandidateId,
      synthetic: true as const,
      source: {
        materializationId: website.materializationId,
        materializationDigest: website.materializationDigest,
        workflowReceiptId: website.workflowReceiptId,
        workflowReceiptDigest: website.workflowReceiptDigest,
        sourcePhaseReceiptId: website.sourcePhaseReceiptId,
        sourcePhaseReceiptDigest: website.sourcePhaseReceiptDigest,
      },
      website: {
        checkpointId: website.checkpoint.checkpointId,
        checkpointDigest: website.checkpoint.checkpointDigest,
        eligibilityReceiptId: website.eligibilityReceiptId,
        eligibilityReceiptDigest: website.eligibilityReceiptDigest,
      },
      assessment: {
        assessmentId: currentAssessment.assessment.assessmentId,
        assessmentDigest: currentAssessment.assessment.assessmentDigest,
        checkpointId: rebuiltAssessmentCheckpoint.checkpointId,
        checkpointDigest: rebuiltAssessmentCheckpoint.checkpointDigest,
      },
      rowCounts: afterAssessmentRows,
      ownerDossier: detail,
      contactReview: { state: "NOT_RECORDED" as const },
      authority: {
        fixtureOnly: true as const,
        synthetic: true as const,
        workerRuntimeConnected: false as const,
        localAssessmentMutationAuthorized: true as const,
        networkOperationsPerformed: 0 as const,
        providerOperationsAuthorized: 0 as const,
        contactDiscoveryExecutionAuthorized: false as const,
        contactVerificationExecutionAuthorized: false as const,
        consentDecisionAuthorized: false as const,
        qualificationExecutionAuthorized: false as const,
        outreachAuthorized: false as const,
        sendAuthorized: false as const,
        costAuthorizedUsd: 0 as const,
      },
    };
    const report = buildReportCore(reportCore);
    if (existingReport && artifactReferenceCanonicalJson(existingReport) !== artifactReferenceCanonicalJson(report)) {
      throw new Error("The existing dossier report conflicts with the canonical durable rebuild.");
    }
    reportOutput = (await writeOrVerifyPrivateKwJson(files.report, report)).executionPath;
    return PrivateKwM1DossierResultSchema.parse({
      report,
      execution: {
        websiteSource: websiteStage.source.executionPath,
        websiteEligibility: websiteStage.eligibility.executionPath,
        assessment: assessmentStage.executionPath,
        websiteCheckpointOutput: websiteStage.checkpoint.outputExecutionPath,
        assessmentCheckpointOutput,
        reportOutput,
        assessmentInsertedRows: insertedRows,
        rowCounts: { beforeAssessment: beforeAssessmentRows, afterAssessment: afterAssessmentRows },
      },
    });
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parsedArgs = parsePrivateKwM1DossierArgs(process.argv.slice(2));
  executePrivateKwM1Dossier(parsedArgs.operation).then((result) => {
    console.log(JSON.stringify(result.execution));
    console.log("Private KW M1 dossier complete: synthetic, local, offline, and zero external authority.");
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Private KW M1 dossier failed.");
    process.exitCode = 1;
  });
}
