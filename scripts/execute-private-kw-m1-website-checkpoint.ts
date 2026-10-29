import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";
import { z } from "zod";

import {
  artifactReferenceCanonicalJson,
  artifactReferenceDigest,
} from "../src/lib/revenue-engine/artifact-reference-projection";
import {
  createArtifactManifestAvailabilityReceipt,
  type ArtifactManifestObjectAvailability,
} from "../src/lib/revenue-engine/artifact-manifest-availability";
import {
  buildArtifactReferenceAtomicPlan,
} from "../src/lib/revenue-engine/artifact-reference-atomic-snapshot";
import {
  executeArtifactReferenceD1Snapshot,
  type ArtifactReferenceFreshMaterializedD1Execution,
} from "../src/lib/revenue-engine/artifact-reference-d1-executor";
import {
  DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
  DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
  buildDurableEvidencePersistencePlan,
} from "../src/lib/revenue-engine/durable-evidence-persistence-plan";
import {
  FENCED_EVIDENCE_RESUME_PERSISTENCE_PLAN_VERSION,
  FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION,
  buildFencedEvidenceResumePersistencePlan,
} from "../src/lib/revenue-engine/fenced-evidence-resume-persistence-plan";
import {
  FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION,
  FIXTURE_WEBSITE_EVIDENCE_LEASE_VERSION,
  createFixtureWorkflowReceiptRevision,
  currentFixtureWebsiteEvidenceDefinition,
  fixtureWebsiteEvidenceRequestDigest,
} from "../src/lib/revenue-engine/fixture-website-evidence-resume-plan";
import {
  buildPrivateKwCurrentWebsiteEvidenceProof,
} from "../src/lib/revenue-engine/private-kw-current-website-evidence";
import {
  buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt,
} from "../src/lib/revenue-engine/private-kw-current-website-evidence-eligibility";
import {
  loadPrivateKwWebsiteEvidenceEligibilityD1,
  persistPrivateKwWebsiteEvidenceEligibilityD1,
} from "../src/lib/revenue-engine/private-kw-current-website-evidence-eligibility-d1";
import {
  buildPrivateKwCurrentWebsiteEvidenceProgressInput,
  buildPrivateKwCurrentWebsiteEvidenceProgressInputForPersistedCheckpoint,
} from "../src/lib/revenue-engine/private-kw-current-website-evidence-progress";
import {
  appendPrivateKwCurrentWebsiteEvidenceProgress,
} from "../src/lib/revenue-engine/private-kw-current-website-evidence-progress-append";
import {
  PrivateKwShadowSliceManifestSchema,
} from "../src/lib/revenue-engine/private-kw-shadow-slice";
import {
  appendPrivateKwShadowSliceProgress,
  buildInitialPrivateKwShadowSliceProgress,
  buildPrivateKwShadowSlicePhaseReceipt,
} from "../src/lib/revenue-engine/private-kw-shadow-slice-progress";
import {
  PrivateKwImportPlanSchema,
} from "../src/lib/revenue-engine/private-kw-import";
import {
  buildPrivateKwSourceWorkflowProgressReceiptInput,
} from "../src/lib/revenue-engine/private-kw-source-workflow-progress";
import {
  buildPrivateKwSourceWorkflowMaterializationPlan,
  PrivateKwSourceWorkflowMaterializationInputSchema,
} from "../src/lib/revenue-engine/private-kw-source-workflow-materialization";
import {
  createPrivateKwCurrentWebsiteEvidenceFixture,
} from "../src/lib/revenue-engine/test-support/private-kw-current-website-evidence-fixture";
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
import {
  executePrivateKwLocalAvailabilityReceipt,
  executePrivateKwLocalDurableEvidencePlan,
  executePrivateKwLocalFencedEvidenceResumePlan,
  runPrivateKwLocalAsyncWriteUnit,
  sqlTables,
} from "./private-kw-local-plan-executor";
import { executePrivateKwSourceWorkflowPlanForLocalDatabase } from "./materialize-private-kw-source-workflow";

const SOURCE_CLOCK_OFFSET_MS = 3.8 * 60_000;
const EVALUATION_OFFSET_MS = 40_000;
const MAX_JSON_BYTES = 50_000_000;
const MAX_DATABASE_BYTES = 512_000_000;
const REQUIRED_TABLES = [
  "RevenueSourceRun", "RevenueBusiness", "RevenueLocation", "RevenueSourceRecord",
  "RevenueWorkflowDefinition", "RevenueWorkflowRun", "RevenueWorkflowDelivery",
  "RevenueWorkflowAttempt", "RevenueWorkflowReceiptRevision", "RevenueWorkflowAttemptClosure",
  "RevenuePrivateKwMaterializationReceipt", "RevenueArtifactManifest", "RevenueArtifactManifestItem",
  "RevenueArtifactManifestAvailabilityReceipt", "RevenueArtifactReferenceCompletenessReceipt",
  "RevenueArtifactReferenceSourceSetProof", "RevenueCurrentWebsiteEvidenceEligibilityReceipt",
] as const;
const SERVICE_MUTATED_TABLES = [
  "RevenueSourceRun", "RevenueBusiness", "RevenueLocation", "RevenueSourceRecord",
  "RevenuePrivateKwMaterializationReceipt", "RevenueWorkflowDefinition", "RevenueWorkflowRun",
  "RevenueWorkflowDelivery", "RevenueWorkflowAttempt", "RevenueWorkflowLease", "RevenueWorkflowReceiptRevision",
  "RevenueWorkflowAttemptClosure", "RevenueWorkflowStepReceipt", "RevenueWorkflowCheckpointPayload",
  "RevenueWorkflowCheckpoint", "RevenueWorkflowCheckpointStateReceipt", "RevenueWorkflowCheckpointDependency",
  "RevenueArtifactRecoveryPlan", "RevenueArtifactRecoveryReceipt", "RevenueWebsitePageSelection",
  "RevenueWebsiteSelectedPage", "RevenueWebsitePageCandidate", "RevenueWebsiteAuditAssembly",
  "RevenueArtifactManifest", "RevenueArtifactManifestItem", "RevenueArtifactEvidenceUse",
  "RevenueArtifactEvidenceUseEnd", "RevenueArtifactPromotionReceipt", "RevenueArtifactPromotionUse",
  "RevenueArtifactManifestEvidenceUse", "RevenueArtifactReleaseRecord", "RevenueArtifactReleaseUse",
  "RevenueArtifactManifestAvailabilityReceipt", "RevenueArtifactReferenceSnapshotAttempt",
  "RevenueArtifactReferenceCompletenessReceipt", "RevenueArtifactReferenceSourceSetProof",
  "RevenueCurrentWebsiteEvidenceEligibilityReceipt",
] as const;

const OperationSchema = z.object({
  sourcePlan: z.string().min(1),
  materialization: z.string().min(1),
  manifest: z.string().min(1),
  database: z.string().min(1),
  output: z.string().min(1),
  now: z.string().datetime({ offset: true }),
}).strict();

const AuthoritySchema = z.object({
  fixtureOnly: z.literal(true),
  synthetic: z.literal(true),
  workerRuntimeConnected: z.literal(false),
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
const ResultSchema = z.object({
  version: z.literal("private-kw-m1-website-checkpoint-v1"),
  businessId: z.string().min(1),
  evaluationCandidateId: z.string().min(1),
  source: z.object({
    executionPath: z.enum(["FRESH_COMMIT", "EXACT_REPLAY"]),
    materializationId: z.string(),
    materializationDigest: z.string().regex(/^[a-f0-9]{64}$/),
    workflowReceiptId: z.string(),
    workflowReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sourcePhaseReceiptId: z.string(),
    sourcePhaseReceiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  eligibility: z.object({
    executionPath: z.enum(["FRESH_COMMIT", "EXACT_REPLAY"]),
    receiptId: z.string(),
    receiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    durableReload: z.literal(true),
  }).strict(),
  websiteEvidence: z.object({
    workflowExecutionPath: z.literal("FIXTURE"),
    synthetic: z.literal(true),
    availabilityReceiptKind: z.literal("SYNTHETIC_R2_HEAD_SHAPED_FIXTURE"),
    networkOperationsPerformed: z.literal(0),
    providerOperationsAuthorized: z.literal(0),
    costAuthorizedUsd: z.literal(0),
  }).strict(),
  rowCounts: RowCountsSchema,
  checkpoint: z.object({
    checkpointId: z.string().regex(/^kw-shadow-progress:[a-f0-9]{64}$/),
    checkpointDigest: z.string().regex(/^[a-f0-9]{64}$/),
    outputPath: z.string(),
    outputExecutionPath: z.enum(["FRESH_WRITE", "EXACT_REPLAY"]),
  }).strict(),
  authority: AuthoritySchema,
}).strict();

export type PrivateKwM1WebsiteCheckpointOperation = z.infer<typeof OperationSchema>;
export type PrivateKwM1WebsiteCheckpointResult = z.infer<typeof ResultSchema>;
export type PrivateKwM1WebsiteCheckpointTestHooks = Readonly<{
  afterCompleteness?: () => void;
  afterSourceMaterialized?: () => void;
  afterEligibilityPersisted?: () => void;
  afterWebsiteProgressPersisted?: () => void;
}>;

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function stableUuid(seed: string) {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 3) | 8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function parseOperation(value: unknown) {
  const operation = OperationSchema.parse(value);
  const files = {
    sourcePlan: resolvePrivateKwDataPath(operation.sourcePlan),
    materialization: resolvePrivateKwDataPath(operation.materialization),
    manifest: resolvePrivateKwDataPath(operation.manifest),
    database: resolvePrivateKwDatabasePath(operation.database),
    output: resolvePrivateKwDataPath(operation.output),
  };
  if (new Set(Object.values(files)).size !== Object.values(files).length) {
    throw new Error("Source plan, materialization, manifest, database, and output must be distinct bounded files.");
  }
  return { operation, files, now: new Date(operation.now) };
}

function availabilityObjects(manifest: { items: readonly { kind: string; artifactRef: string; objectKey: string; byteLength: number; sha256: string; etag: string }[] }) {
  return manifest.items.map((item): ArtifactManifestObjectAvailability => ({
    kind: item.kind as ArtifactManifestObjectAvailability["kind"],
    artifactRef: item.artifactRef,
    objectKey: item.objectKey,
    expectedByteLength: item.byteLength,
    expectedSha256: item.sha256,
    expectedEtag: item.etag,
    state: "PRESENT",
    observedByteLength: item.byteLength,
    observedSha256: item.sha256,
    observedEtag: item.etag,
  }));
}

function seedWebsiteEvidenceRows(database: Database.Database, fixture: Awaited<ReturnType<typeof createPrivateKwCurrentWebsiteEvidenceFixture>>, now: Date) {
  const durable = buildDurableEvidencePersistencePlan({
    ...fixture.durableEvidenceRequest,
    persistencePlanVersion: DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION,
  });
  const durableExecution = executePrivateKwLocalDurableEvidencePlan(database, durable);

  const definition = currentFixtureWebsiteEvidenceDefinition();
  const requestDigest = fixtureWebsiteEvidenceRequestDigest(fixture.workflowRequest);
  const delivery = {
    deliveryVersion: "fixture-workflow-delivery-v1" as const,
    deliveryId: `delivery:${fixture.workflowRequest.idempotencyKey}`,
    workflowId: fixture.workflowRequest.workflowId,
    workflowVersion: fixture.workflowRequest.workflowVersion,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    payloadDigest: requestDigest,
    receivedAt: fixture.workflowRequest.requestedAt,
    mode: "SHADOW" as const,
    deliveryKind: "FIXTURE" as const,
  };
  const attempt = {
    attemptVersion: FIXTURE_WEBSITE_EVIDENCE_ATTEMPT_VERSION,
    attemptId: stableUuid(`website-attempt:${fixture.workflowRequest.idempotencyKey}`),
    workflowId: fixture.workflowRequest.workflowId,
    workflowVersion: fixture.workflowRequest.workflowVersion,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    deliveryId: delivery.deliveryId,
    attemptNumber: 1,
    fencingToken: 1,
    status: "SEALED" as const,
    startedAt: fixture.workflowRequest.requestedAt,
    endedAt: fixture.workflowReceipt.completedAt,
    terminalReceiptId: `workflow-receipt:${artifactReferenceDigest(fixture.workflowReceipt)}`,
  } as const;
  const lease = {
    leaseVersion: FIXTURE_WEBSITE_EVIDENCE_LEASE_VERSION,
    leaseId: stableUuid(`website-lease:${fixture.workflowRequest.idempotencyKey}`),
    workflowId: fixture.workflowRequest.workflowId,
    workflowVersion: fixture.workflowRequest.workflowVersion,
    definitionDigest: definition.definitionDigest,
    requestDigest,
    attemptId: attempt.attemptId,
    attemptNumber: 1,
    deliveryId: delivery.deliveryId,
    ownerId: "task-4b1-fixture",
    fencingToken: 1,
    acquiredAt: fixture.workflowRequest.requestedAt,
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    mode: "SHADOW" as const,
    leaseKind: "FIXTURE" as const,
  };
  const revision = createFixtureWorkflowReceiptRevision({
    request: fixture.workflowRequest,
    definition,
    attempt,
    receipt: fixture.workflowReceipt,
    recordedAt: fixture.workflowReceipt.completedAt,
  });
  const resume = buildFencedEvidenceResumePersistencePlan({
    persistencePlanVersion: FENCED_EVIDENCE_RESUME_PERSISTENCE_PLAN_VERSION,
    targetSchemaVersion: FENCED_EVIDENCE_RESUME_TARGET_SCHEMA_VERSION,
    resumeRequest: {
      resumePlanVersion: "fixture-website-evidence-resume-plan-v1",
      plannedAt: fixture.durableEvidenceRequest.plannedAt,
      mode: "SHADOW",
      plannerKind: "FIXTURE",
      maxCostUsd: 0,
      workflowRequest: fixture.workflowRequest,
      definition,
      currentDelivery: delivery,
      persistedDeliveries: [],
      attempts: [attempt],
      leases: [lease],
      receiptRevisions: [revision],
      checkpoints: [],
      artifactRecoveries: [],
    },
  });
  const resumeExecution = executePrivateKwLocalFencedEvidenceResumePlan(database, resume);

  const availabilityExecutions = [] as Array<{ executionPath: "FRESH_COMMIT" | "EXACT_REPLAY"; insertedRows: number }>;
  for (const [index, manifest] of fixture.workflowReceipt.artifactManifests.entries()) {
    const availability = createArtifactManifestAvailabilityReceipt({
      receiptId: stableUuid(`website-availability:${fixture.workflowRequest.idempotencyKey}:${index}`),
      manifest,
      checkedAt: fixture.workflowReceipt.completedAt,
      validThrough: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
      checkerKind: "R2_HEAD",
      objects: availabilityObjects(manifest),
    });
    availabilityExecutions.push(executePrivateKwLocalAvailabilityReceipt(database, availability));
  }
  return { durable, resume, availabilityReceipts: fixture.workflowReceipt.artifactManifests.map((_, index) => index), durableExecution, resumeExecution, availabilityExecutions };
}

function counts(database: Database.Database, tables: Iterable<string>) {
  const existing = new Set((database.prepare(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table'`).all() as Array<{ name: string }>).map((row) => row.name));
  const sortedTables = [...new Set(tables)].filter((table) => existing.has(table)).sort((left, right) => left.localeCompare(right, "en-CA"));
  return Object.fromEntries(sortedTables.map((table) => [table, (database.prepare(`SELECT COUNT(*) AS "count" FROM "${table}"`).get() as { count: number }).count]));
}

function existingEligibility(database: Database.Database, businessId: string) {
  const row = database.prepare(`SELECT "id", "receiptDigest" FROM "RevenueCurrentWebsiteEvidenceEligibilityReceipt" WHERE "businessId" = ? ORDER BY "id"`).all(businessId) as Array<{ id: string; receiptDigest: string }>;
  if (row.length > 1) throw new Error("Synthetic website evidence has multiple durable eligibility receipts for one business.");
  return row[0] ?? null;
}

/**
 * Runs the bounded source-to-website half of M1. Every dependency is a local
 * fixture or the supplied SQLite handle; this module has no Worker/runtime,
 * network, provider, contact, qualification, outreach, send, or cost path.
 */
export async function executePrivateKwM1WebsiteCheckpoint(
  value: unknown,
  hooks: PrivateKwM1WebsiteCheckpointTestHooks = {},
): Promise<PrivateKwM1WebsiteCheckpointResult> {
  const { operation, files, now } = parseOperation(value);
  const [sourceRead, materializationRead, manifestRead] = await Promise.all([
    readPrivateKwJson(files.sourcePlan, MAX_JSON_BYTES),
    readPrivateKwJson(files.materialization, MAX_JSON_BYTES),
    readPrivateKwJson(files.manifest, MAX_JSON_BYTES),
  ]);
  const source = PrivateKwImportPlanSchema.parse(sourceRead.value);
  const materialization = PrivateKwSourceWorkflowMaterializationInputSchema.parse(materializationRead.value);
  const manifest = PrivateKwShadowSliceManifestSchema.parse(manifestRead.value);
  const sourceSuffix = source.importId.match(/^kw-shadow-progress-([a-z0-9._-]+)$/)?.[1];
  if (!sourceSuffix) throw new Error("The bounded synthetic source import identity is invalid.");
  const fixture = await createPrivateKwCurrentWebsiteEvidenceFixture({
    suffix: sourceSuffix,
    now: new Date(now.getTime() - SOURCE_CLOCK_OFFSET_MS),
  });
  if (
    artifactReferenceCanonicalJson(source) !== artifactReferenceCanonicalJson(fixture.source)
    || artifactReferenceCanonicalJson(materialization) !== artifactReferenceCanonicalJson(fixture.materialization)
    || artifactReferenceCanonicalJson(manifest) !== artifactReferenceCanonicalJson(fixture.manifest)
  ) throw new Error("Source, materialization, and manifest must be the exact bounded synthetic fixture inputs.");

  const databaseFile = await inspectPrivateKwDatabase(files.database, MAX_DATABASE_BYTES);
  const database = new Database(databaseFile, { fileMustExist: true, timeout: 0 });
  try {
    database.pragma("foreign_keys = ON");
    assertPrivateKwSingleDatabase(database);
    assertPrivateKwRequiredTables(database, REQUIRED_TABLES, "M1 website checkpoint");
    assertCanonicalPrivateKwRevenueSchema(database);

    const plan = buildPrivateKwSourceWorkflowMaterializationPlan(source, materialization);
    const sourceExecution = executePrivateKwSourceWorkflowPlanForLocalDatabase(database, plan);
    hooks.afterSourceMaterialized?.();
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
      recordedAt: operation.now,
    });
    const initialProgress = buildInitialPrivateKwShadowSliceProgress(manifest);
    const sourceProgress = appendPrivateKwShadowSliceProgress(manifest, initialProgress, sourceInput);
    const sourcePhaseReceipt = sourceProgress.records.find((record) => record.businessId === plan.businessId)?.phaseReceipts[0];
    if (!sourcePhaseReceipt) throw new Error("Synthetic source progress did not produce the selected business receipt.");

    const previousPhaseReceipt = buildPrivateKwShadowSlicePhaseReceipt(manifest, sourceInput);
    const evidence = buildPrivateKwCurrentWebsiteEvidenceProof({
      manifestValue: manifest,
      previousPhaseReceiptValue: previousPhaseReceipt,
      durableEvidenceRequestValue: fixture.durableEvidenceRequest,
      availabilityReceiptValues: fixture.availabilityReceipts,
      preparedAt: fixture.preparedAt,
    });
    let eligibilityResult: Awaited<ReturnType<typeof loadPrivateKwWebsiteEvidenceEligibilityD1>>;
    let eligibilityPath: "FRESH_COMMIT" | "EXACT_REPLAY";
    const websiteTables = new Set<string>(SERVICE_MUTATED_TABLES);
    const materializationTables = plan.records.flatMap((record) => [...sqlTables(record.selectSql)]);
    const atomicPlans = fixture.workflowReceipt.artifactManifests.map((artifact, index) => buildArtifactReferenceAtomicPlan({
      attemptId: stableUuid(`website-snapshot:${fixture.workflowRequest.idempotencyKey}:${index}`),
      workflowRunId: fixture.workflowRequest.workflowId,
      businessId: fixture.workflowRequest.businessId,
      lineageRootManifestId: artifact.manifestId,
      attemptNumber: 1,
      fencingToken: 1,
      ownerId: "task-4b1-fixture",
      requestedAt: fixture.workflowRequest.requestedAt,
      acquiredAt: new Date(Date.parse(fixture.workflowRequest.requestedAt) + 1_000).toISOString(),
      expiresAt: new Date(Date.parse(fixture.workflowRequest.requestedAt) + 4 * 60_000).toISOString(),
      mode: "SHADOW",
      maxCostUsd: 0,
    }));
    for (const atomicPlan of atomicPlans) for (const statement of atomicPlan.statements) for (const table of sqlTables(statement.sql)) websiteTables.add(table);
    for (const record of buildDurableEvidencePersistencePlan({ ...fixture.durableEvidenceRequest, persistencePlanVersion: DURABLE_EVIDENCE_PERSISTENCE_PLAN_VERSION, targetSchemaVersion: DURABLE_EVIDENCE_TARGET_SCHEMA_VERSION }).preflights) for (const table of sqlTables(record.selectSql)) websiteTables.add(table);
    const seeded = await runPrivateKwLocalAsyncWriteUnit(database, async () => {
      const seed = seedWebsiteEvidenceRows(database, fixture, now);
      const adapter = createPrivateKwLocalD1Adapter(database);
      const atomicExecutions = [] as Awaited<ReturnType<typeof executeArtifactReferenceD1Snapshot>>[];
      for (const atomicPlan of atomicPlans) atomicExecutions.push(await executeArtifactReferenceD1Snapshot(adapter, atomicPlan));
      if (hooks.afterCompleteness) hooks.afterCompleteness();
      const oldEligibility = existingEligibility(database, plan.businessId);
      if (!oldEligibility) {
        if (atomicExecutions.some((item) => item.executionPath !== "FRESH_COMMIT" || item.decodedSnapshot === null)) {
          throw new Error("Existing completeness rows without durable eligibility are an unsafe partial state; fresh eligibility requires every snapshot to be a fresh commit.");
        }
        const freshExecutions = atomicExecutions.filter((item): item is ArtifactReferenceFreshMaterializedD1Execution => item.executionPath === "FRESH_COMMIT" && item.decodedSnapshot !== null);
        const minimumEvaluationAt = Math.max(now.getTime() - EVALUATION_OFFSET_MS, ...freshExecutions.map((item) => Date.parse(item.receipt.recordedAt)));
        const eligibilityReceipt = buildPrivateKwCurrentWebsiteEvidenceEligibilityReceipt({ websiteEvidenceProofValue: evidence, trustedExecutionValues: freshExecutions, evaluatedAt: new Date(minimumEvaluationAt).toISOString() });
        await persistPrivateKwWebsiteEvidenceEligibilityD1(adapter, eligibilityReceipt);
        eligibilityResult = await loadPrivateKwWebsiteEvidenceEligibilityD1(adapter, { receiptId: eligibilityReceipt.receiptId, receiptDigest: eligibilityReceipt.receiptDigest });
        eligibilityPath = "FRESH_COMMIT";
      } else {
        eligibilityResult = await loadPrivateKwWebsiteEvidenceEligibilityD1(adapter, { receiptId: oldEligibility.id, receiptDigest: oldEligibility.receiptDigest });
        if (eligibilityResult.receipt.businessId !== plan.businessId || eligibilityResult.receipt.websiteEvidence.proofId !== evidence.proofId || eligibilityResult.receipt.websiteEvidence.proofDigest !== evidence.proofDigest) throw new Error("Durable eligibility reload does not match the exact validated fixture evidence.");
        eligibilityPath = "EXACT_REPLAY";
      }
      return { seed, atomicExecutions, eligibilityResult, eligibilityPath };
    });
    eligibilityResult = seeded.eligibilityResult;
    eligibilityPath = seeded.eligibilityPath;
    hooks.afterEligibilityPersisted?.();
    for (const record of seeded.seed.durable.preflights) for (const table of sqlTables(record.selectSql)) websiteTables.add(table);
    for (const record of seeded.seed.durable.mutations) for (const table of sqlTables(record.sql)) websiteTables.add(table);
    for (const record of seeded.seed.resume.preflights) for (const table of sqlTables(record.selectSql)) websiteTables.add(table);
    for (const record of seeded.seed.resume.mutations) for (const table of sqlTables(record.sql)) websiteTables.add(table);
    for (const table of materializationTables) websiteTables.add(table);
    let persistedCheckpoint: unknown;
    try {
      persistedCheckpoint = (await readPrivateKwJson(operation.output, MAX_JSON_BYTES)).value;
    } catch (error) {
      if (!(error instanceof Error) || !/ENOENT|no such file|cannot find/i.test(error.message)) throw error;
    }
    const websiteInput = persistedCheckpoint === undefined
      ? buildPrivateKwCurrentWebsiteEvidenceProgressInput({
        manifestValue: manifest,
        previousProgressValue: sourceProgress,
        websiteEvidenceProofValue: evidence,
        currentEligibilityResultValue: eligibilityResult,
        recordedAt: operation.now,
      })
      : buildPrivateKwCurrentWebsiteEvidenceProgressInputForPersistedCheckpoint({
        manifestValue: manifest,
        previousProgressValue: sourceProgress,
        websiteEvidenceProofValue: evidence,
        currentEligibilityResultValue: eligibilityResult,
        persistedCheckpointValue: persistedCheckpoint,
        canonicalRecordedAt: operation.now,
      });
    const checkpoint = appendPrivateKwCurrentWebsiteEvidenceProgress({
      manifestValue: manifest,
      previousProgressValue: sourceProgress,
      phaseInputValue: websiteInput,
    });
    const output = await writeOrVerifyPrivateKwJson(operation.output, checkpoint);
    hooks.afterWebsiteProgressPersisted?.();
    const parsed = ResultSchema.parse({
      version: "private-kw-m1-website-checkpoint-v1",
      businessId: plan.businessId,
      evaluationCandidateId: plan.evaluationCandidateId,
      source: {
        executionPath: sourceExecution.executionPath,
        materializationId: plan.materializationId,
        materializationDigest: plan.materializationDigest,
        workflowReceiptId: plan.workflowReceiptId,
        workflowReceiptDigest: plan.workflowReceiptId.slice("workflow-receipt:".length),
        sourcePhaseReceiptId: sourcePhaseReceipt.phaseReceiptId,
        sourcePhaseReceiptDigest: sourcePhaseReceipt.phaseReceiptDigest,
      },
      eligibility: {
        executionPath: eligibilityPath,
        receiptId: eligibilityResult.receipt.receiptId,
        receiptDigest: eligibilityResult.receipt.receiptDigest,
        durableReload: true,
      },
      websiteEvidence: {
        workflowExecutionPath: "FIXTURE",
        synthetic: true,
        availabilityReceiptKind: "SYNTHETIC_R2_HEAD_SHAPED_FIXTURE",
        networkOperationsPerformed: 0,
        providerOperationsAuthorized: 0,
        costAuthorizedUsd: 0,
      },
      rowCounts: counts(database, websiteTables),
      checkpoint: {
        checkpointId: checkpoint.checkpointId,
        checkpointDigest: checkpoint.checkpointDigest,
        outputPath: output.file,
        outputExecutionPath: output.executionPath,
      },
      authority: {
        fixtureOnly: true,
        synthetic: true,
        workerRuntimeConnected: false,
        networkOperationsPerformed: 0,
        providerOperationsAuthorized: 0,
        contactDiscoveryExecutionAuthorized: false,
        contactVerificationExecutionAuthorized: false,
        consentDecisionAuthorized: false,
        qualificationExecutionAuthorized: false,
        outreachAuthorized: false,
        sendAuthorized: false,
        costAuthorizedUsd: 0,
      },
    });
    return deepFreeze(parsed);
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error("Task 4B1 is a local service boundary; the final CLI is intentionally deferred.");
  process.exitCode = 1;
}

export { OperationSchema as PrivateKwM1WebsiteCheckpointOperationSchema, ResultSchema as PrivateKwM1WebsiteCheckpointResultSchema };
